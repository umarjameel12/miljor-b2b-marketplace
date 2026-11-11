'use strict';
// MilJor F1-F5 financial-only source acceptance. All modules run with
// injected fake DB; no MySQL connection, Safepay or external money movement.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const exact=require('../src/services/exactDecimal');
const source=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
let factory;
const db={getConnection:async()=>{
  if(!factory)throw Error('Unexpected DB access');
  return factory();
}};
const fakeModule=(code,other={})=>{
  const m={exports:{}};
  vm.runInNewContext(code,{
    module:m,exports:m.exports,console,Buffer,process:{env:{NODE_ENV:'test'}},
    require:name=>{
      if(name==='../config/db')return db;
      if(name==='./exactDecimal')return exact;
      if(name==='crypto')return crypto;
      if(name==='./feeService'||name==='./reservationEventService')return {};
      if(other[name])return other[name];
      throw Error('Unexpected module '+name);
    }
  },{timeout:5000});
  return m.exports;
};
const financial=fakeModule(source('../src/services/financialSettlementService.js'));
const ledger=fakeModule(source('../src/services/financialConservationService.js'));
let count=0;
function pass(name){count++;console.log('PASS',name);}
async function rejects(fn,code){await assert.rejects(fn,x=>x.code===code);}
const order={id:1,order_code:'ORD-1',total_amount:'113.00',subtotal_amount:'100.00',
  supplier_commission_percent:'2.50',delivery_fee:'10.00',buyer_platform_fee:'3.00',
  payment_status:'PAID',fulfillment_status:'BUYER_CONFIRMED'};
const payment={id:5,amount:'113.00',status:'PAID',transaction_ref:'track_123'};
const payable={id:7,order_id:1,payment_id:5,gross_amount:'100.00',
  delivery_fee_amount:'10.00',commission_rate_percent:'2.50',
  commission_amount:'2.50',net_payable_amount:'107.50',
  refund_deduction_amount:'0.00',held_amount:'0.00',available_amount:'107.50',
  disbursed_amount:'0.00',status:'ACCRUED'};
let fixture;
function reset(){
  fixture={orders:[{...order}],payments:[{...payment}],payables:[{...payable}],
    holds:[],refunds:[],instructions:[]};
  factory=async()=>({
    query:async(sql)=>{
      if(sql.startsWith('SET TRANSACTION'))return [[]];
      const match=sql.match(/FROM (orders|payments|supplier_payables|financial_holds|refund_obligations|supplier_disbursement_instructions)/);
      if(!match)throw Error('Unexpected read-only SQL: '+sql);
      const key={orders:'orders',payments:'payments',supplier_payables:'payables',
        financial_holds:'holds',refund_obligations:'refunds',
        supplier_disbursement_instructions:'instructions'}[match[1]];
      return [fixture[key]];
    },
    beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{}
  });
}
const admin={id:17,role:'FINANCE_ADMIN'};
(async()=>{
  factory=null;
  await rejects(()=>ledger.getOrderIntegrity({orderId:1,actor:{id:5,role:'BUYER'}}),
    'FINANCIAL_AUDIT_FORBIDDEN');
  pass('F5 unauthorized buyer cannot inspect ledger');
  await rejects(()=>financial.reconcileProviderSettlementBatch({
    batchReference:'batch01',grossAmount:'100.00',providerFee:'1.00',
    netAmount:'99.00',actor:admin
  }),'PROVIDER_SETTLEMENT_EVIDENCE_REQUIRED');
  pass('F2 admin-entered matching totals never prove provider settlement');
  await rejects(()=>financial.reconcileProviderSettlementBatch({
    batchReference:'batch01',actor:{id:9,role:'SUPPORT_ADMIN'}
  }),'UNAUTHORIZED_ROLE');
  pass('F5 financial reconciliation is finance-admin-only');

  reset();
  let x=await ledger.getOrderIntegrity({orderId:1,actor:admin});
  assert.equal(x.status,'PASS');
  assert.ok(x.checks.length>=14);
  pass('F4 valid buyer and supplier financial conservation');
  reset();fixture.orders[0].buyer_platform_fee='4.00';
  x=await ledger.getOrderIntegrity({orderId:1,actor:admin});
  assert.equal(x.status,'RECONCILIATION_REQUIRED');
  assert.equal(x.checks.find(c=>c.name==='BUYER_ORDER_COMPONENTS').passed,false);
  pass('F4 incorrect buyer fee is detected');
  reset();fixture.orders[0].supplier_commission_percent=null;
  x=await ledger.getOrderIntegrity({orderId:1,actor:admin});
  assert.equal(x.checks.find(c=>c.name==='IMMUTABLE_SUPPLIER_COMMISSION').passed,false);
  pass('F4 missing order-time supplier commission is a reconciliation blocker');
  reset();fixture.payables[0].commission_rate_percent='3.00';
  x=await ledger.getOrderIntegrity({orderId:1,actor:admin});
  assert.equal(x.checks.find(c=>c.name==='IMMUTABLE_SUPPLIER_COMMISSION').passed,false);
  pass('F4 mutable profile-based payable commission cannot overwrite order snapshot');
  reset();fixture.payables[0].commission_amount='3.50';
  x=await ledger.getOrderIntegrity({orderId:1,actor:admin});
  assert.equal(x.checks.find(c=>c.name==='COMMISSION_EXACT').passed,false);
  pass('F4 incorrect supplier commission is detected');
  reset();fixture.payables[0].available_amount='120.00';
  x=await ledger.getOrderIntegrity({orderId:1,actor:admin});
  assert.equal(x.checks.find(c=>c.name==='PAYABLE_CONSERVATION').passed,false);
  pass('F4 payable conservation discrepancy detected');
  reset();fixture.payables[0].held_amount='20.00';
  fixture.payables[0].available_amount='87.50';
  x=await ledger.getOrderIntegrity({orderId:1,actor:admin});
  assert.equal(x.checks.find(c=>c.name==='ACTIVE_HOLD_COVERAGE').passed,false);
  pass('F4 missing active hold backing detected');
  reset();fixture.refunds=[{id:4,payment_id:5,total_refund_amount:'120.00',
    assessed_refund_amount:'120.00',fee_refund_amount:'0.00',status:'CONFIRMED'}];
  fixture.payments[0].status='REFUNDED';
  x=await ledger.getOrderIntegrity({orderId:1,actor:admin});
  assert.equal(x.checks.find(c=>c.name==='CAPTURED_REFUND_CEILING').passed,false);
  pass('F4 over-refunded buyer captured amount detected');
  reset();fixture.instructions=[{id:8,supplier_payable_id:7,
    amount:'107.50',status:'APPROVED',external_execution_status:'EXECUTED'}];
  x=await ledger.getOrderIntegrity({orderId:1,actor:admin});
  assert.equal(x.checks.find(c=>c.name==='NO_EXTERNAL_PAYOUT_EXECUTION').passed,false);
  pass('F4 unsafe external execution state detected');

  factory=null;
  await rejects(()=>financial.approveSupplierDisbursement({
    disbursementId:8,actor:{id:1,role:'SUPPORT_ADMIN'}
  }),'UNAUTHORIZED_ROLE');
  pass('F3 support-admin cannot approve payout');
  await rejects(()=>financial.prepareSupplierDisbursement({
    payableId:7,actor:{id:1,role:'OPERATIONS_ADMIN'}
  }),'UNAUTHORIZED_ROLE');
  pass('F3 operations-admin cannot prepare supplier payout');
  // F3 refund-specific holds cannot be manually released to create an
  // unbacked supplier payout, even by an authorized finance administrator.
  let writes=0,rolledBack=0;
  factory=async()=>({
    beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rolledBack++;},
    release:()=>{},
    query:async(sql)=>{
      if(sql.includes('SELECT supplier_payable_id FROM financial_holds'))
        return [[{supplier_payable_id:7}]];
      if(sql.includes('FROM supplier_payables sp'))
        return [[{id:7,order_id:1}]];
      if(sql.includes('SELECT * FROM financial_holds'))
        return [[{id:20,supplier_payable_id:7,status:'ACTIVE',
          hold_code:'HOLD-RFND-4-1250'}]];
      if(sql.includes('UPDATE')){writes++;return [{affectedRows:1}];}
      throw Error('Unexpected hold-release SQL '+sql);
    }
  });
  await rejects(()=>financial.releaseFinancialHold({holdId:20,actor:admin}),
    'REFUND_HOLD_RELEASE_FORBIDDEN');
  assert.equal(writes,0);assert.equal(rolledBack,1);
  pass('F3 refund-specific financial holds cannot be freed by generic release');

  // Four-eyes: the admin who prepared the supplier payout cannot approve it.
  writes=0;rolledBack=0;
  factory=async()=>({
    beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rolledBack++;},
    release:()=>{},
    query:async(sql)=>{
      if(sql.includes('SELECT supplier_payable_id FROM supplier_disbursement_instructions'))
        return [[{supplier_payable_id:7}]];
      if(sql.includes('SELECT * FROM supplier_payables WHERE id'))
        return [[{id:7}]];
      if(sql.includes('FROM supplier_disbursement_instructions d'))
        return [[{id:8,prepared_by:17,status:'PREPARED'}]];
      if(sql.includes('UPDATE')){writes++;return [{affectedRows:1}];}
      throw Error('Unexpected approval SQL '+sql);
    }
  });
  await rejects(()=>financial.approveSupplierDisbursement({disbursementId:8,actor:admin}),
    'DISBURSEMENT_DUAL_CONTROL_REQUIRED');
  assert.equal(writes,0);assert.equal(rolledBack,1);
  pass('F3 self-approved supplier payout blocked by dual control');

  // A refund approval may not create a liability without an accrued supplier
  // payable, and cannot overtake a previously prepared supplier payout.
  async function refundApprovalScenario(hasPayable,hasPayout){
    let updates=0,rollbacks=0;
    factory=async()=>({
      beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rollbacks++;},
      release:()=>{},
      query:async(sql)=>{
        if(sql.includes('FROM refund_obligations r'))
          return [[{id:4,order_id:1,payment_id:5,status:'REQUESTED'}]];
        if(sql.includes('FROM supplier_payables WHERE order_id'))
          return [hasPayable?[{id:7}]:[]];
        if(sql.includes('FROM supplier_disbursement_instructions'))
          return [hasPayout?[{id:8}]:[]];
        if(sql.includes('UPDATE')){updates++;return [{affectedRows:1}];}
        throw Error('Unexpected refund liability SQL '+sql);
      }
    });
    return {getWrites:()=>updates,getRollbacks:()=>rollbacks};
  }
  let checks=await refundApprovalScenario(false,false);
  await rejects(()=>financial.approveRefundObligation({refundId:4,actor:admin}),
    'REFUND_PAYABLE_RECONCILIATION_REQUIRED');
  assert.equal(checks.getWrites(),0);assert.equal(checks.getRollbacks(),1);
  pass('F2 refund approval blocked without funded supplier liability');
  checks=await refundApprovalScenario(true,true);
  await rejects(()=>financial.approveRefundObligation({refundId:4,actor:admin}),
    'REFUND_DISBURSEMENT_CONFLICT');
  assert.equal(checks.getWrites(),0);assert.equal(checks.getRollbacks(),1);
  pass('F2 refund approval blocked once supplier payout prepared');

  console.log('F1-F5 offline financial acceptance:',count,'PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
