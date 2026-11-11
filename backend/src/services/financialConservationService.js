'use strict';
// F4 read-only, reproducible internal financial conservation snapshot.
// This is NOT proof that Safepay holds funds or that platform bank settlement
// occurred. It performs no updates, payouts, refunds, or schema migrations.
const db=require('../config/db');
const exact=require('./exactDecimal');
const financeRoles=new Set(['ADMIN','SUPER_ADMIN','FINANCE_ADMIN']);
function error(code,message,statusCode=409){
  const e=new Error(message);e.code=code;e.statusCode=statusCode;return e;
}
function money(x){return exact.toCanonical(x,2);}
function add(...xs){return exact.exactDecimalSum(xs.map(money),2);}
function minus(a,b){const p=money(b);return add(a,p==='0.00'?'0.00':'-'+p);}
function percentFee(gross,rate){
  const pct=money(rate);
  if(!exact.exactDecimalGte(pct,'0.00',2)||
     !exact.exactDecimalGte('100.00',pct,2))
    throw error('INVALID_COMMISSION_SNAPSHOT','Invalid commission snapshot');
  const bp=BigInt(pct.replace('.',''));
  const decimal=(bp/10000n).toString()+'.'+(bp%10000n).toString().padStart(4,'0');
  return exact.exactMultiplyRound(money(gross),decimal,2);
}
const relevantRefundStatuses=new Set([
  'REQUESTED','UNDER_REVIEW','APPROVED','CONFIRMED',
  'AWAITING_EXTERNAL_EXECUTION','EXTERNAL_PROCESSING'
]);
class FinancialConservationService {
  async getOrderIntegrity({orderId,actor}){
    if(!actor||!actor.id||!financeRoles.has(actor.role))
      throw error('FINANCIAL_AUDIT_FORBIDDEN','Only authorized finance admins may audit order money',403);
    const n=Number(orderId);
    if(!Number.isSafeInteger(n)||n<=0)
      throw error('INVALID_ORDER_ID','A valid numeric order ID is required',400);
    const conn=await db.getConnection();
    let begun=false;
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await conn.beginTransaction();begun=true;
      const [orders]=await conn.query(
        'SELECT * FROM orders WHERE id=?',[n]);
      if(orders.length!==1)
        throw error('ORDER_NOT_FOUND','Financial audit order not found',404);
      const order=orders[0];
      const [payments]=await conn.query(
        `SELECT id,amount,status,transaction_ref
         FROM payments WHERE order_id=? ORDER BY id`,[n]);
      const [payables]=await conn.query(
        `SELECT id,order_id,payment_id,gross_amount,delivery_fee_amount,
                commission_rate_percent,commission_amount,net_payable_amount,
                refund_deduction_amount,held_amount,available_amount,
                disbursed_amount,status
         FROM supplier_payables WHERE order_id=? ORDER BY id`,[n]);
      const [holds]=await conn.query(
        `SELECT id,supplier_payable_id,hold_amount,status
         FROM financial_holds WHERE order_id=? ORDER BY id`,[n]);
      const [refunds]=await conn.query(
        `SELECT id,payment_id,total_refund_amount,assessed_refund_amount,
                fee_refund_amount,status,currency
         FROM refund_obligations WHERE order_id=? ORDER BY id`,[n]);
      const [instructions]=await conn.query(
        `SELECT id,supplier_payable_id,amount,status,external_execution_status
         FROM supplier_disbursement_instructions WHERE order_id=? ORDER BY id`,[n]);
      await conn.commit();begun=false;

      const checks=[],flag=(name,passed,expected,actual)=>{
        checks.push({name,passed,expected,actual});
      };
      try{
        const expected=add(order.subtotal_amount,order.delivery_fee||'0.00',
          order.buyer_platform_fee||'0.00');
        flag('BUYER_ORDER_COMPONENTS',exact.exactDecimalEquals(expected,order.total_amount,2),
          expected,money(order.total_amount));
        if (['PAID','PARTIALLY_REFUNDED','REFUNDED'].includes(order.payment_status))
          flag('PAID_ORDER_HAS_CAPTURED_PAYMENT',payments.length===1,
            '1 confirmed payment',String(payments.length));
        flag('SINGLE_CAPTURED_PAYMENT',payments.length<=1,
          '0 or 1 payment record',String(payments.length));
        const payment=payments[0];
        if(payment){
          flag('PAYMENT_CAPTURE_AMOUNT',exact.exactDecimalEquals(payment.amount,order.total_amount,2),
            money(order.total_amount),money(payment.amount));
          const confirmed=add(...refunds.filter(r=>r.status==='CONFIRMED').map(r=>r.total_refund_amount));
          flag('CAPTURED_REFUND_CEILING',exact.exactDecimalGte(payment.amount,confirmed,2),
            'confirmed <= '+money(payment.amount),'confirmed '+confirmed);
          const remaining=minus(payment.amount,confirmed);
          const expectStatus=exact.exactDecimalEquals(confirmed,'0.00',2)?'PAID':
            exact.exactDecimalEquals(remaining,'0.00',2)?'REFUNDED':'PARTIALLY_REFUNDED';
          if(['PAID','PARTIALLY_REFUNDED','REFUNDED'].includes(payment.status))
            flag('PAYMENT_REFUND_STATUS',payment.status===expectStatus,
              expectStatus,payment.status);
          flag('REFUND_PAYMENT_LINK',refunds.every(x=>Number(x.payment_id)===Number(payment.id)),
            'refund payment_id '+payment.id,'linked refunds '+refunds.length);
        }else if(refunds.length){
          flag('REFUND_WITHOUT_CAPTURE',false,'payment required','refund obligations '+refunds.length);
        }
        flag('SINGLE_SUPPLIER_PAYABLE',payables.length<=1,'0 or 1',String(payables.length));
        if(payables.length===1){
          const p=payables[0];
          // The payable rate must match immutable order-time commercial terms.
          // A missing column is a migration/reconciliation blocker, never an
          // excuse to substitute a mutable supplier profile percentage.
          flag('IMMUTABLE_SUPPLIER_COMMISSION',
            order.supplier_commission_percent!==null &&
            order.supplier_commission_percent!==undefined &&
            exact.exactDecimalEquals(order.supplier_commission_percent,p.commission_rate_percent,2),
            order.supplier_commission_percent===null ||
              order.supplier_commission_percent===undefined
              ? 'order-time commission snapshot REQUIRED'
              : money(order.supplier_commission_percent),
            money(p.commission_rate_percent));
          const comm=percentFee(p.gross_amount,p.commission_rate_percent);
          flag('COMMISSION_EXACT',exact.exactDecimalEquals(comm,p.commission_amount,2),
            comm,money(p.commission_amount));
          const net=minus(add(p.gross_amount,p.delivery_fee_amount),p.commission_amount);
          flag('SUPPLIER_NET_ENTITLEMENT',exact.exactDecimalEquals(net,p.net_payable_amount,2),
            net,money(p.net_payable_amount));
          const expectedAvailable=minus(
            minus(minus(p.net_payable_amount,p.refund_deduction_amount),
              p.held_amount),p.disbursed_amount||'0.00');
          flag('PAYABLE_CONSERVATION',
            exact.exactDecimalGte(expectedAvailable,'0.00',2) &&
            exact.exactDecimalEquals(expectedAvailable,p.available_amount,2),
            expectedAvailable,money(p.available_amount));
          const activeHold=add(...holds.filter(h=>h.status==='ACTIVE'&&
            Number(h.supplier_payable_id)===Number(p.id)).map(h=>h.hold_amount));
          flag('ACTIVE_HOLD_COVERAGE',
            exact.exactDecimalEquals(activeHold,p.held_amount,2),
            money(p.held_amount),activeHold);
          const approvedDeductions=add(...refunds.filter(r=>
            ['APPROVED','CONFIRMED','AWAITING_EXTERNAL_EXECUTION','EXTERNAL_PROCESSING'].includes(r.status))
            .map(r=>r.assessed_refund_amount));
          flag('REFUND_SUPPLIER_DEDUCTIONS',
            exact.exactDecimalEquals(approvedDeductions,p.refund_deduction_amount,2),
            approvedDeductions,money(p.refund_deduction_amount));
          const payouts=instructions.filter(i=>i.supplier_payable_id===p.id);
          flag('SINGLE_PAYOUT_INSTRUCTION',payouts.length<=1,'0 or 1',String(payouts.length));
          flag('NO_EXTERNAL_PAYOUT_EXECUTION',
            payouts.every(i=>i.external_execution_status==='DISABLED'),
            'DISABLED',payouts.map(i=>i.external_execution_status).join(',')||'none');
          flag('PAYABLE_PAYMENT_LINK',!payment ||
            Number(p.payment_id)===Number(payment.id),
            payment?String(payment.id):'not captured',String(p.payment_id));
        }
        for(const refund of refunds){
          if(!relevantRefundStatuses.has(refund.status))continue;
          flag('REFUND_'+refund.id+'_AMOUNT',
            exact.exactDecimalEquals(
              add(refund.assessed_refund_amount,refund.fee_refund_amount),refund.total_refund_amount,2),
            add(refund.assessed_refund_amount,refund.fee_refund_amount),
            money(refund.total_refund_amount));
        }
      }catch(e){
        checks.push({name:'AUDIT_CALCULATION_FAILED',passed:false,
          expected:'valid exact decimal financial inputs',actual:e.code||e.message});
      }
      return {
        order_id:n,order_code:order.order_code,
        status:checks.every(c=>c.passed)?'PASS':'RECONCILIATION_REQUIRED',
        checks,counts:{payments:payments.length,payables:payables.length,
          financial_holds:holds.length,refunds:refunds.length,
          payout_instructions:instructions.length},
        limitations:'Internal ledger snapshot only; no provider custody, bank statement, or actual Safepay payout proof'
      };
    }catch(e){if(begun)await conn.rollback();throw e;}
    finally{conn.release();}
  }
}
module.exports=new FinancialConservationService();
