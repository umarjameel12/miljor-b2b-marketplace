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
    // One canonical dispute per short physical line, with its OWN ordered
    // quantity, actual receipt, immutable SKU price and exact claimed PKR.
    // Never use orders.total_qty=1 (basket placeholder) for line shortages.
    for(const line of assessed.filter(x=>exact.exactDecimalGte(x.shortage,'0.0001',4))){
      const code='DSP-P1-'+order+'-'+crypto.randomBytes(3).toString('hex');
      const disputeKey='collective-receipt-'+saved.insertId+'-line-'+line.line_id;
      const [existingDisputes]=await conn.query(`SELECT id FROM order_disputes WHERE
        order_id=? AND status NOT IN ('CLOSED','RESOLVED_REJECTED','SUPPLIER_REMEDIATION_COMPLETED')
        FOR UPDATE`,[order]);
      // This dedicated receipt is the sole originator of shortage disputes.
      // No overlap may already exist for this order before creating new claims.
      if(existingDisputes.some(d=>!assessed.some(x=>x.dispute_id===d.id)))
        throw fail('EXISTING_DISPUTE_REQUIRES_REVIEW',
          'An independent open dispute exists; manual financial review required');
      const [dispute]=await conn.query(`INSERT INTO order_disputes
        (dispute_code,order_id,reservation_id,buyer_id,supplier_id,reason,dispute_category,
         reporting_actor_role,description,expected_quantity,reported_quantity,
         disputed_quantity,claimed_amount,currency,evidence_metadata,status,
         idempotency_key,created_at,updated_at)
        VALUES (?,?,NULL,?,?,'SHORTAGE_IN_QUANTITY','SHORT_QUANTITY',
          'BUYER',?,?,?,?,?,'PKR',?,'OPEN',?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
        [code,order,buyer,o.supplier_id,
         'Buyer recorded exact short delivery for SKU line '+line.line_id,
         line.ordered,line.received,line.shortage,line.shortage_value,
         JSON.stringify({receipt_id:saved.insertId,line_id:line.line_id,
           unit:line.unit,unit_price:line.price,source:'PR61_COLLECTIVE_RECEIPT'}),
         disputeKey]);
      line.dispute_id=dispute.insertId;
      await notify.enqueueEvent(conn,{userId:buyer,role:'BUYER',eventType:'DISPUTE_OPENED',
        eventKey:'collective:receipt:'+saved.insertId+':dispute:'+dispute.insertId,entityId:order});
    }
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
 async getContract(buyerId,orderId){
  const buyer=id(buyerId),order=id(orderId);
  const [orders]=await this.database.query(`SELECT co.order_id,o.payment_status,o.fulfillment_status
    FROM procurement_collective_buyer_orders co JOIN orders o ON o.id=co.order_id
    WHERE co.order_id=? AND co.buyer_id=?`,[order,buyer]);
  if(!orders.length)throw fail('GROUP_ORDER_NOT_FOUND','Owned collective order not found',404);
  const [lines]=await this.database.query(`SELECT gl.id AS line_id,gl.supplier_sku_id,
    gl.quantity,gl.purchasing_unit,gl.unit_price,gl.subtotal,gl.physical_snapshot
    FROM procurement_collective_order_lines gl
    JOIN procurement_collective_buyer_orders co ON co.id=gl.collective_order_id
    WHERE co.order_id=? AND co.buyer_id=? ORDER BY gl.id`,[order,buyer]);
  return {order_id:order,payment_status:orders[0].payment_status,
    fulfillment_status:orders[0].fulfillment_status,lines:lines.map(l=>({
      line_id:l.line_id,supplier_sku_id:l.supplier_sku_id,
      ordered_quantity:String(l.quantity),unit:l.purchasing_unit,
      unit_price:money(l.unit_price),subtotal:money(l.subtotal),
      physical_specification:typeof l.physical_snapshot==='string'?
        JSON.parse(l.physical_snapshot):l.physical_snapshot
    }))};
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
  const [disputes]=await this.database.query(
    `SELECT d.id,d.disputed_quantity,d.claimed_amount,
       CAST(JSON_UNQUOTE(JSON_EXTRACT(d.evidence_metadata,'$.line_id')) AS UNSIGNED) AS contract_line_id
     FROM order_disputes d WHERE d.order_id=? AND d.buyer_id=?
       AND d.dispute_category='SHORT_QUANTITY'
       AND JSON_UNQUOTE(JSON_EXTRACT(d.evidence_metadata,'$.source'))='PR61_COLLECTIVE_RECEIPT'`,
    [order,buyer]);
  const disputeByLine=new Map(disputes.map(d=>[Number(d.contract_line_id),{
    dispute_id:Number(d.id),claimed_amount:money(d.claimed_amount),
    disputed_quantity:qty(d.disputed_quantity)}]));
  const exposed=lines.map(l=>({...l,
    dispute:disputeByLine.get(Number(l.collective_order_line_id))||null}));
  return {...rows[0],lines:exposed,refund_executed:false};
 }
}
module.exports=new ProcurementCollectiveReceiptService();
module.exports.ProcurementCollectiveReceiptService=ProcurementCollectiveReceiptService;
