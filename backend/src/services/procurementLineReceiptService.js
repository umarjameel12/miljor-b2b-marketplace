'use strict';
const crypto=require('node:crypto');
const exact=require('./exactDecimal');
const policy=require('./procurementLineReceiptPolicy');
const {fail,id}=policy;
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const financialFlags=()=>({financial_status:'BLOCKED',
 financial_block_reason:'ALL_FINAL_LINE_RECEIPTS_REQUIRED',
 refund_obligation_created:false,hold_applied:false,settlement_authorized:false,
 external_execution_status:'DISABLED'});
const canonicalFlags=()=>({...financialFlags(),financial_status:'CANONICAL_FULL_RECEIPT',
 financial_block_reason:null,canonical_settlement_required:true});

class ProcurementLineReceiptService {
 constructor(database,dependencies={}){this.database=database;this.dependencies=dependencies;}
 get db(){return this.database||require('../config/db');}
 _buyer(actor){
  if(!actor||actor.role!=='BUYER')throw fail('FORBIDDEN','Only the owning buyer may access line receipts.',403);
  return id(actor.id);
 }
 async _order(conn,orderId,buyer){
  const [rows]=await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE',[orderId]);
  if(!rows.length||String(rows[0].buyer_id)!==String(buyer))throw fail('ORDER_NOT_FOUND','Buyer order not found.',404);
  return rows[0];
 }
 async _lines(conn,orderId){
  const [lines]=await conn.query(`SELECT al.* FROM procurement_award_lines al
   JOIN procurement_award_orders ao ON ao.id=al.award_order_id AND ao.award_id=al.award_id
   WHERE ao.order_id=? ORDER BY al.id FOR UPDATE`,[orderId]);
  if(!lines.length)throw fail('PROCUREMENT_AWARD_REQUIRED','Order has no procurement award lines.',409);
  return lines;
 }
 async _verifiedPayment(conn,order){
  if(order.payment_status!=='PAID')throw fail('VERIFIED_PAYMENT_REQUIRED','Order must have a verified paid payment.',409);
  // Reuse the Safepay engine's durable completed-attempt + processed-event evidence.
  // A PAID string alone, client callbacks or arbitrary mock payments are insufficient.
  const [payments]=await conn.query(`SELECT p.* FROM payments p
   JOIN payment_attempts pa ON pa.order_id=p.order_id AND pa.buyer_id=p.buyer_id
     AND pa.provider='SAFEPAY' AND pa.status='COMPLETED' AND pa.amount=p.amount
     AND pa.currency=?
   JOIN payment_webhook_events pe ON pe.attempt_id=pa.id AND pe.order_id=p.order_id
     AND pe.provider='SAFEPAY' AND pe.provider_tracker_token=pa.provider_tracker_token
     AND pe.processed_status='PROCESSED' AND pe.event_type IN ('payment.succeeded','payment:succeeded','payment.completed','payment:completed','payment.settled','payment:settled','payment.reconciled','payment:created','payment.created')
   WHERE p.order_id=? AND p.buyer_id=? AND p.status='PAID' AND p.amount=? AND p.procurement_delivery_contract_id IS NULL AND pa.procurement_delivery_contract_id IS NULL
     AND (BINARY p.transaction_ref=BINARY pa.provider_tracker_token OR
       BINARY JSON_UNQUOTE(JSON_EXTRACT(p.provider_response,'$.tracker_token'))=BINARY pa.provider_tracker_token)
   ORDER BY p.id DESC LIMIT 1`,[order.currency,order.id,order.buyer_id,order.total_amount]);
  if(!payments.length)throw fail('VERIFIED_PAYMENT_REQUIRED','Authoritative Safepay payment evidence is required.',409);
  return payments[0];
 }
 async recordBuyerReceipt({orderId,actor,lines,feePolicy,idempotencyKey}){
  const buyer=this._buyer(actor),oid=id(orderId);
  if(typeof idempotencyKey!=='string'||!/^[-A-Za-z0-9_.:]{1,120}$/.test(idempotencyKey))
   throw fail('IDEMPOTENCY_KEY_REQUIRED','Use a 1–120 character ASCII idempotency key.',400);
  const consent=policy.assertFeePolicyConsent(feePolicy);
  const payload={...policy.normalizeSubmission({lines}),fee_policy:consent};
  const hash=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const conn=await this.db.getConnection();
  try{
   await conn.beginTransaction();
   const order=await this._order(conn,oid,buyer);
   const [previous]=await conn.query(`SELECT payload_hash,response_snapshot FROM procurement_line_receipt_submissions
    WHERE order_id=? AND buyer_id=? AND idempotency_key=? FOR UPDATE`,[oid,buyer,idempotencyKey]);
   if(previous.length){
    if(previous[0].payload_hash!==hash)throw fail('IDEMPOTENCY_PAYLOAD_MISMATCH','Key already recorded with different receipt evidence.',409);
    await conn.commit();return {receipt:parse(previous[0].response_snapshot),is_replay:true};
   }
   const payment=await this._verifiedPayment(conn,order);
   if(!['SUPPLIER_DELIVERED','EXCEPTION'].includes(order.fulfillment_status))
    throw fail('ORDER_NOT_DELIVERED','Line receipt requires supplier-reported delivery or an existing delivery exception.',409);
   if(order.currency!=='PKR')throw fail('UNSUPPORTED_RECEIPT_CURRENCY','Only PKR procurement receipts are supported.',409);
   const awardLines=await this._lines(conn,oid);
   const byId=new Map(awardLines.map(line=>[id(line.id),line]));
   const assessed=payload.lines.map(claim=>{
    const line=byId.get(claim.award_line_id);
    if(!line)throw fail('FOREIGN_AWARD_LINE','Receipt line does not belong to this buyer order.',403);
    return policy.assessLine(line,claim);
   });
   const [existing]=await conn.query('SELECT * FROM procurement_line_receipts WHERE order_id=? ORDER BY award_line_id FOR UPDATE',[oid]);
   if(assessed.some(line=>existing.some(row=>String(row.award_line_id)===String(line.award_line_id))))
    throw fail('FINAL_LINE_RECEIPT_ALREADY_RECORDED','Final receipt is immutable; an administrator must reconcile subsequent evidence.',409);
   // Bound MONEY across lines, never sum heterogeneous purchasing quantities.
   const itemTotal=exact.exactDecimalSum(awardLines.map(line=>policy.decimal(line.subtotal,2)),2);
   const assessmentTotal=exact.exactDecimalSum([...existing,...assessed].map(line=>line.refund_assessment_amount),2);
   if(!exact.exactDecimalEquals(itemTotal,order.subtotal_amount,2)||
    !exact.exactDecimalGte(itemTotal,assessmentTotal,2)||
    !exact.exactDecimalGte(payment.amount,assessmentTotal,2))
    throw fail('RECEIPT_FINANCIAL_BOUND_EXCEEDED','Line assessments must reconcile to the captured immutable order contract.',409);
   const disputed=assessed.some(line=>line.disputed_quantity!=='0.0000');
   const response={order_id:oid,currency:'PKR',fee_policy:consent,lines:assessed,
    ...financialFlags(),dispute_recorded:disputed,order_exception_applied:disputed,
    quantities_are_per_line:true,final_line_receipts:true};
   const [insert]=await conn.query(`INSERT INTO procurement_line_receipt_submissions
    (order_id,buyer_id,payment_id,idempotency_key,payload_hash,fee_policy_version,fee_policy_accepted,response_snapshot)
    VALUES (?,?,?,?,?,?,1,NULL)`,[oid,buyer,payment.id,idempotencyKey,hash,consent.version]);
   const disputeEngine=this.dependencies.disputes||require('./disputeService');
   for(const line of assessed){
    const [recorded]=await conn.query(`INSERT INTO procurement_line_receipts
    (submission_id,order_id,award_line_id,ordered_quantity,received_quantity,accepted_quantity,
     disputed_quantity,purchasing_unit,unit_price,subtotal,refund_assessment_amount,hold_assessment_amount,reason,evidence_notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[insert.insertId,oid,line.award_line_id,line.ordered_quantity,
    line.received_quantity,line.accepted_quantity,line.disputed_quantity,line.purchasing_unit,
    line.unit_price,line.subtotal,line.refund_assessment_amount,line.hold_assessment_amount,line.reason,line.evidence_notes]);
    if(line.disputed_quantity!=='0.0000')await disputeEngine.recordProcurementLineDisputeWithinTransaction(conn,{receiptId:recorded.insertId,actor});
   }
   // Never advance to BUYER_CONFIRMED or clear an exception here.
   if(disputed)await conn.query(`UPDATE orders SET fulfillment_status='EXCEPTION',order_status='DISPUTED',
    exception_reason=COALESCE(exception_reason,'LINE_RECEIPT_DISPUTE'),
    exception_recorded_at=COALESCE(exception_recorded_at,NOW()),updated_at=NOW() WHERE id=?`,[oid]);
   const financeEngine=this.dependencies.finance||require('./financialSettlementService');
   const financial=await financeEngine.assessProcurementReceiptsWithinTransaction(conn,{orderId:oid,actor});
   Object.assign(response,financial);
   const notifier=this.dependencies.notifications||require('./notificationService');
   if(disputed)for(const [userId,role] of [[order.buyer_id,'BUYER'],[order.supplier_id,'SUPPLIER']]){
    for(const eventType of ['PARTIAL_DELIVERY','DISPUTE_OPENED'])await notifier.enqueueEvent(conn,{userId,role,eventType,eventKey:'line-receipt:'+insert.insertId+':'+eventType,entityId:oid});
   }
   response.lines=response.lines.map(line=>{
    const allocation=financial.line_allocations?.find(row=>String(row.award_line_id)===String(line.award_line_id));
    return {...line,financial_status:financial.financial_status,financial_block_reason:financial.financial_block_reason,
     refund_obligation_created:!!allocation?.refund_obligation_id,hold_applied:!!allocation?.hold_id,
     ...(allocation||{})};
   });
   // Snapshot is finalized once, before commit, never rewritten after publication.
   await conn.query('UPDATE procurement_line_receipt_submissions SET response_snapshot=? WHERE id=? AND response_snapshot IS NULL',
    [JSON.stringify(response),insert.insertId]);
   await conn.commit();return {receipt:response,is_replay:false};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 }
 async getBuyerReceipts({orderId,actor}){
  const buyer=this._buyer(actor),oid=id(orderId),conn=await this.db.getConnection();
  try{
   await conn.beginTransaction();
   const order=await this._order(conn,oid,buyer);
   const lines=await this._lines(conn,oid);
   const [receipts]=await conn.query('SELECT * FROM procurement_line_receipts WHERE order_id=? ORDER BY award_line_id',[oid]);
   const [assessments]=await conn.query('SELECT allocation_snapshot FROM procurement_receipt_financial_assessments WHERE order_id=?',[oid]);
   const result={order_id:oid,fulfillment_status:order.fulfillment_status,...financialFlags(),quantities_are_per_line:true,
    lines:lines.map(line=>({award_line_id:line.id,ordered_quantity:line.quantity,
     purchasing_unit:line.purchasing_unit,unit_price:line.unit_price,subtotal:line.subtotal,
     receipt:receipts.find(row=>String(row.award_line_id)===String(line.id))||null}))};
   if(assessments.length)Object.assign(result,parse(assessments[0].allocation_snapshot));
   else if(receipts.length===lines.length&&receipts.every(row=>exact.exactDecimalEquals(row.disputed_quantity,'0.00',4)))
    Object.assign(result,canonicalFlags());
   result.lines=result.lines.map(line=>{
    if(!line.receipt||result.financial_status==='BLOCKED')return line;
    const allocation=result.line_allocations?.find(row=>String(row.award_line_id)===String(line.award_line_id));
    return {...line,receipt:{...line.receipt,financial_status:result.financial_status,
     financial_block_reason:result.financial_block_reason,refund_obligation_created:!!allocation?.refund_obligation_id,
     hold_applied:!!allocation?.hold_id,...(allocation||{})}};
   });
   await conn.commit();return result;
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 }
 // Integration hook: caller MUST already own the orders row lock in this transaction.
 // Physical acceptance only; this is never permission to bypass financial guards.
 async assertFullyAcceptedWithinTransaction(conn,orderId){
  const oid=id(orderId),lines=await this._lines(conn,oid);
  const [receipts]=await conn.query('SELECT * FROM procurement_line_receipts WHERE order_id=? ORDER BY award_line_id FOR UPDATE',[oid]);
  if(lines.some(line=>!receipts.some(row=>String(row.award_line_id)===String(line.id)&&
    exact.exactDecimalEquals(row.accepted_quantity,line.quantity,4)&&
    exact.exactDecimalEquals(row.disputed_quantity,'0',4))))
   throw fail('LINE_RECEIPTS_NOT_FULLY_ACCEPTED','Every award line requires a final undisputed buyer receipt.',409);
  return {physical_receipts_accepted:true,...canonicalFlags()};
 }
}
module.exports=new ProcurementLineReceiptService();
module.exports.ProcurementLineReceiptService=ProcurementLineReceiptService;
