'use strict';
// Read-only, admin-scoped Safepay refund readiness. NEVER issues a refund.
// Separate buyer refunds in grouped orders; never assume external settlement.
const db=require('../config/db');
const exact=require('./exactDecimal');
const VALID_ROLES=new Set(['ADMIN','SUPER_ADMIN','FINANCE_ADMIN']);
const error=(code,statusCode,message)=>Object.assign(new Error(message),{code,statusCode});
function cents(value){
  const s=exact.toCanonicalString(value,2);
  if(s.startsWith('-'))throw error('INVALID_AMOUNT',422,'Refund amount must be non-negative');
  const [a,b]=s.split('.');
  return BigInt(a)*100n+BigInt(b);
}
function evaluate({refund,payment,attempt,otherApprovedMinor=0n,now=Date.now()}){
  const faults=[];
  const state=String(refund.status||'');
  if(state!=='APPROVED')faults.push('ADMIN_APPROVAL_REQUIRED');
  if(refund.currency!=='PKR')faults.push('UNSUPPORTED_CURRENCY');
  if(payment.status!=='PAID'||refund.order_payment_status!=='PAID')
    faults.push('CAPTURE_NOT_VERIFIED');
  if(!attempt||attempt.provider!=='SAFEPAY'||attempt.environment!=='sandbox'||
     Number(attempt.order_id)!==Number(refund.order_id)||
     Number(attempt.buyer_id)!==Number(refund.buyer_id))
    faults.push('PROVIDER_TRACKER_OWNERSHIP_UNVERIFIED');
  const requested=cents(refund.total_refund_amount);
  const paid=cents(payment.amount);
  if(requested<=0n)faults.push('NON_POSITIVE_REFUND');
  if(requested>paid||requested+otherApprovedMinor>paid)
    faults.push('CAPTURED_REFUND_CEILING_EXCEEDED');
  const time=new Date(payment.paid_at).getTime();
  const ageHours=(now-time)/3600000;
  if(!Number.isFinite(time)||!Number.isFinite(ageHours)||ageHours<0)
    faults.push('CAPTURE_TIMESTAMP_UNVERIFIED');
  else if(ageHours>90*24)faults.push('PROVIDER_CARD_REFUND_WINDOW_EXCEEDED');
  const method=Number.isFinite(ageHours)&&ageHours>=0&&ageHours<24?
    'PROVIDER_REVERSAL_REVIEW':'PROVIDER_REFUND_REVIEW';
  // Even if business/financial rules pass, operator must verify merchant
  // refund API, payment provider and actual signed completion.
  return {
    refund_id:Number(refund.id),order_id:Number(refund.order_id),
    currency:'PKR',requested_amount_pkr:exact.toCanonicalString(refund.total_refund_amount,2),
    provider:'SAFEPAY',recommended_provider_action:method,
    internal_financial_check:faults.length===0?'PASS':'BLOCKED',
    blocking_reasons:faults,external_execution_status:'DISABLED',
    can_execute_external_refund:false,
    provider_origin_confirmation:'NOT_OBTAINED',
    note:'This is a read-only assessment, not a refund request or confirmation.'
  };
}
class SafepayRefundReadinessService{
  constructor(database=db){this.db=database;}
  async inspect({actor,refundId,now=Date.now()}){
    if(!actor||!VALID_ROLES.has(actor.role))
      throw error('FORBIDDEN',403,'Finance/admin authorization required');
    const id=Number(refundId);
    if(!Number.isSafeInteger(id)||id<=0)
      throw error('INVALID_REFUND_ID',400,'Positive numeric refund ID required');
    const [rows]=await this.db.query(
      `SELECT r.id,r.order_id,r.buyer_id,r.payment_id,r.total_refund_amount,
       r.currency,r.status,o.payment_status AS order_payment_status,
       p.amount AS captured_amount,p.status AS captured_status,p.paid_at,p.transaction_ref
       FROM refund_obligations r
       JOIN orders o ON o.id=r.order_id
       JOIN payments p ON p.id=r.payment_id AND p.order_id=r.order_id AND p.buyer_id=r.buyer_id
       WHERE r.id=?`,[id]);
    if(rows.length!==1)throw error('REFUND_NOT_FOUND',404,'Refund obligation not found');
    const refund=rows[0];
    const [attempts]=await this.db.query(
      'SELECT provider,environment,order_id,buyer_id FROM payment_attempts WHERE provider_tracker_token=? LIMIT 2',
      [refund.transaction_ref]);
    const [others]=await this.db.query(
      `SELECT total_refund_amount FROM refund_obligations
       WHERE payment_id=? AND id<>? AND status IN ('APPROVED','CONFIRMED')`,
      [refund.payment_id,id]);
    const aggregate=others.reduce((s,x)=>s+cents(x.total_refund_amount),0n);
    return evaluate({refund,
      payment:{status:refund.captured_status,amount:refund.captured_amount,paid_at:refund.paid_at},
      attempt:attempts.length===1?attempts[0]:null,otherApprovedMinor:aggregate,now});
  }
}
module.exports=new SafepayRefundReadinessService();
module.exports.SafepayRefundReadinessService=SafepayRefundReadinessService;
module.exports.evaluate=evaluate;
