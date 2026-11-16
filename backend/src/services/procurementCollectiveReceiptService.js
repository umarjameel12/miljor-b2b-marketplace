'use strict';
// Buyer-owned exact physical line receipt. Shortages are immutable evidence,
// not an automatic provider refund, not a settlement authorization.
const crypto=require('node:crypto');
const db=require('../config/db');
const exact=require('./exactDecimal');
const notify=require('./notificationService');
const groupDelivery=require('./procurementCollectiveDeliveryService');
const fail=(code,message,statusCode=409)=>Object.assign(new Error(message),{code,statusCode});
const id=v=>{
 if(v==null||typeof v==='boolean'||!/^[1-9]\d*$/.test(String(v))||!Number.isSafeInteger(Number(v)))
   throw fail('INVALID_ID','Positive integer ID required',400);
 return Number(v);
};
const key=v=>{
 if(typeof v!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(v))
   throw fail('INVALID_IDEMPOTENCY_KEY','Valid idempotency key required',400);
 return v;
};
const money=v=>exact.toCanonical(v,2),qty=v=>exact.toCanonical(v,4);
const isDiscrete=u=>['bag','tin','carton','sack','bundle','pack'].includes(u);
class ProcurementCollectiveReceiptService{
 constructor(database=db){this.database=database;}
 async submit(buyerId,orderId,payload,rawKey){
  const buyer=id(buyerId),order=id(orderId),idem=key(rawKey);
  if(!Array.isArray(payload?.lines)||payload.lines.length<1||payload.lines.length>50)
    throw fail('RECEIPT_LINES_REQUIRED','Provide a received quantity for each accepted SKU',400);
  const provided=payload.lines.map(line=>{
    const lineId=id(line.line_id),received=qty(line.received_quantity);
    if(!exact.exactDecimalGte(received,'0.0000',4))
      throw fail('INVALID_RECEIVED_QUANTITY','Received quantity cannot be negative',400);
    return {lineId,received};
  }).sort((a,b)=>a.lineId-b.lineId);
  if(new Set(provided.map(l=>l.lineId)).size!==provided.length)
    throw fail('DUPLICATE_RECEIPT_LINE','Each physical SKU line must appear once',400);
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({buyer,order,provided})).digest('hex');
  const conn=await this.database.getConnection();
  try{
   await conn.beginTransaction();
   const [orders]=await conn.query('SELECT id,buyer_id,supplier_id,payment_status,fulfillment_status,notes FROM orders WHERE id=? FOR UPDATE',[order]);
   const o=orders[0];
   if(!o||Number(o.buyer_id)!==buyer||o.notes!=='COLLECTIVE_INDIVIDUAL_PAYMENT')
     throw fail('RECEIPT_ORDER_NOT_OWNED','Only the purchasing buyer may record group receipt',403);
   const [previous]=await conn.query('SELECT id,status,shortage_value,idempotency_key,request_hash FROM procurement_collective_receipt_submissions WHERE order_id=? FOR UPDATE',[order]);
   if(previous.length){
    if(previous[0].idempotency_key!==idem||previous[0].request_hash!==fingerprint)
      throw fail('RECEIPT_ALREADY_SUBMITTED','This order already has an immutable receipt submission');
    await conn.commit();
    return {order_id:order,receipt_id:previous[0].id,status:previous[0].status,
      shortage_value:money(previous[0].shortage_value),is_replay:true};
   }
   if(o.payment_status!=='PAID'||o.fulfillment_status!=='SUPPLIER_DELIVERED')
     throw fail('RECEIPT_PREREQUISITE_NOT_MET','Paid supplier-delivered order is required');
   const [lines]=await conn.query(`SELECT gl.id,gl.quantity,gl.purchasing_unit,gl.unit_price,
     gl.subtotal FROM procurement_collective_order_lines gl
     JOIN procurement_collective_buyer_orders co ON co.id=gl.collective_order_id
     WHERE co.order_id=? ORDER BY gl.id FOR UPDATE`,[order]);
   if(!lines.length||lines.length!==provided.length)
     throw fail('RECEIPT_LINE_COUNT_MISMATCH','All accepted physical lines must be acknowledged');
   const lookup=new Map(lines.map(line=>[Number(line.id),line]));
   const assessed=[];
   for(const x of provided){
    const contract=lookup.get(x.lineId);
    if(!contract)throw fail('RECEIPT_LINE_NOT_OWNED','Line does not belong to this buyer order',403);
    const unit=String(contract.purchasing_unit).toLowerCase(),ordered=qty(contract.quantity);
    if(!exact.exactDecimalGte(ordered,x.received,4)||
       (isDiscrete(unit)&&!/^\d+\.0000$/.test(x.received)))
      throw fail('INVALID_RECEIVED_QUANTITY','Received quantity exceeds the locked physical line or is fractional packaging',400);
    const shortage=exact.exactDecimalSum([ordered,'-'+x.received],4);
    const loss=exact.exactMultiplyRound(shortage,contract.unit_price,2);
    assessed.push({line_id:x.lineId,ordered,received:x.received,shortage,unit,
      price:money(contract.unit_price),shortage_value:loss});
   }
   const shortTotal=exact.exactDecimalSum(assessed.map(a=>a.shortage_value),2);
   const hasShortage=assessed.some(x=>exact.exactDecimalGte(x.shortage,'0.0001',4));
   const status=hasShortage?'EXCEPTION':'BUYER_CONFIRMED';
   const [saved]=await conn.query(`INSERT INTO procurement_collective_receipt_submissions
     (order_id,buyer_id,supplier_id,status,shortage_value,idempotency_key,request_hash,immutable_summary)
     VALUES (?,?,?,?,?,?,?,?)`,
     [order,buyer,o.supplier_id,status,shortTotal,idem,fingerprint,JSON.stringify({lines:assessed})]);
   for(const x of assessed){
    await conn.query(`INSERT INTO procurement_collective_receipt_lines
      (receipt_id,collective_order_line_id,ordered_quantity,received_quantity,shortage_quantity,
       unit,locked_unit_price,shortage_value,immutable_snapshot)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [saved.insertId,x.line_id,x.ordered,x.received,x.shortage,x.unit,x.price,
        x.shortage_value,JSON.stringify(x)]);
   }
   if(hasShortage){
    await conn.query(`UPDATE orders SET fulfillment_status='EXCEPTION',
      order_status='DISPUTED',exception_reason='QUANTITY_MISMATCH',
      exception_details=?,exception_recorded_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
      WHERE id=?`,['Line-specific short delivery: review immutable receipt evidence #'+saved.insertId,order]);
    await groupDelivery.syncFulfillment(conn,order,'EXCEPTION');
    for(const [role,userId] of [['BUYER',buyer],['SUPPLIER',o.supplier_id]]){
      await notify.enqueueEvent(conn,{userId,role,eventType:'PARTIAL_DELIVERY',
        eventKey:'collective:receipt:'+saved.insertId+':partial:'+role,entityId:order});
    }
   }else{
    await conn.query(`UPDATE orders SET fulfillment_status='BUYER_CONFIRMED',
      order_status='DELIVERED',buyer_confirmed_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
      WHERE id=?`,[order]);
    await groupDelivery.syncFulfillment(conn,order,'BUYER_CONFIRMED');
    for(const [role,userId] of [['BUYER',buyer],['SUPPLIER',o.supplier_id]])
      await notify.enqueueEvent(conn,{userId,role,eventType:'RECEIPT_CONFIRMED',
        eventKey:'collective:receipt:'+saved.insertId+':complete:'+role,entityId:order});
   }
   await conn.commit();
   return {receipt_id:saved.insertId,order_id:order,status,shortage_value:shortTotal,
     needs_independent_dispute_refund_review:hasShortage,refund_executed:false,
     supplier_settlement_authorized:false,is_replay:false,lines:assessed};
  }catch(error){await conn.rollback();if(error.code==='ER_DUP_ENTRY')
    throw fail('RECEIPT_CONFLICT','Concurrent receipt was already recorded');
    throw error;}finally{conn.release();}
 }
 async get(buyerId,orderId){
  const buyer=id(buyerId),order=id(orderId);
  const [rows]=await this.database.query(`SELECT r.id,r.order_id,r.status,r.shortage_value,r.created_at
    FROM procurement_collective_receipt_submissions r
    WHERE r.order_id=? AND r.buyer_id=?`,[order,buyer]);
  if(!rows.length)throw fail('RECEIPT_NOT_FOUND','Owned group receipt not found',404);
  const [lines]=await this.database.query(`SELECT collective_order_line_id,ordered_quantity,
    received_quantity,shortage_quantity,unit,locked_unit_price,shortage_value
    FROM procurement_collective_receipt_lines WHERE receipt_id=? ORDER BY id`,[rows[0].id]);
  return {...rows[0],lines,refund_executed:false};
 }
}
module.exports=new ProcurementCollectiveReceiptService();
module.exports.ProcurementCollectiveReceiptService=ProcurementCollectiveReceiptService;
