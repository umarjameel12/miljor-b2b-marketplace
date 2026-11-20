'use strict';
// PR61 Part 2: bounded stock leases for each independently payable collective order.
// A provider-started attempt is never released on a local timeout; it moves to
// RECONCILIATION_REQUIRED until an authoritative provider result is available.
const db=require('../config/db');
const HOLD_MINUTES=15;
const fail=(code,message,statusCode=409)=>Object.assign(new Error(message),{code,statusCode});
class CollectivePaymentHoldService{
 async createForOrder(conn,{orderId,buyerId}){
  if(![orderId,buyerId].every(v=>Number.isSafeInteger(Number(v))&&Number(v)>0))
   throw fail('INVALID_COLLECTIVE_HOLD_CONTEXT','Valid collective order and buyer are required',400);
  const [r]=await conn.query(`UPDATE procurement_collective_buyer_orders
   SET payment_expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? MINUTE),
       payment_hold_status='ACTIVE',checkout_started_at=NULL,
       payment_hold_released_at=NULL,payment_hold_release_reason=NULL
   WHERE order_id=? AND buyer_id=? AND payment_hold_status='ACTIVE'`,
   [HOLD_MINUTES,orderId,buyerId]);
  if(r.affectedRows!==1)throw fail('COLLECTIVE_HOLD_CREATE_FAILED','Could not create the collective payment lease',500);
 }
 async _release(conn,row,reason){
  await conn.query(`UPDATE supplier_inventory_allocations SET status='RELEASED'
   WHERE allocation_type='ORDER_DIRECT' AND reference_id=? AND status='PENDING'`,[row.order_id]);
  await conn.query(`UPDATE procurement_collective_buyer_orders
   SET payment_hold_status='RELEASED',payment_hold_released_at=UTC_TIMESTAMP(),
       payment_hold_release_reason=?
   WHERE id=? AND payment_hold_status IN ('ACTIVE','PAYMENT_PENDING')`,[reason,row.id]);
 }
 async claimCheckout(orderId,buyerId){
  const conn=await db.getConnection();let expired=false;
  try{
   await conn.beginTransaction();
   const [rows]=await conn.query(`SELECT co.id,co.order_id,co.buyer_id,co.payment_hold_status,
     co.payment_expires_at,(co.payment_expires_at>UTC_TIMESTAMP()) AS is_open,
     o.payment_status,o.order_status
     FROM procurement_collective_buyer_orders co JOIN orders o ON o.id=co.order_id
     WHERE co.order_id=? FOR UPDATE`,[orderId]);
   const row=rows[0];
   if(!row){await conn.commit();return {collective_order:false};}
   if(Number(row.buyer_id)!==Number(buyerId))throw fail('FORBIDDEN','Cannot start another buyer collective checkout',403);
   if(row.payment_status==='PAID'||row.payment_hold_status==='COMMITTED'){
    await conn.commit();return {collective_order:true,paid:true};
   }
   // Rows created before this lease migration retain their historical policy.
   if(!row.payment_expires_at){
    await conn.commit();return {collective_order:true,legacy:true,pending:true};
   }
   if(row.payment_hold_status==='RELEASED')throw fail('COLLECTIVE_PAYMENT_HOLD_EXPIRED','This group order stock hold has expired; request a fresh group award');
   if(row.payment_hold_status==='RECONCILIATION_REQUIRED'){
    await conn.commit();return {collective_order:true,reconciliation_required:true};
   }
   if(!row.payment_expires_at||Number(row.is_open)!==1){
    const [attempts]=await conn.query("SELECT id FROM payment_attempts WHERE order_id=? AND status='INITIATED' LIMIT 1 FOR UPDATE",[orderId]);
    if(attempts.length){
     await conn.query("UPDATE procurement_collective_buyer_orders SET payment_hold_status='RECONCILIATION_REQUIRED' WHERE id=?",[row.id]);
     await conn.commit();return {collective_order:true,reconciliation_required:true};
    }
    await this._release(conn,row,'PAYMENT_WINDOW_EXPIRED');expired=true;
   }else{
    await conn.query(`UPDATE procurement_collective_buyer_orders
      SET payment_hold_status='PAYMENT_PENDING',checkout_started_at=COALESCE(checkout_started_at,UTC_TIMESTAMP())
      WHERE id=? AND payment_hold_status IN ('ACTIVE','PAYMENT_PENDING')`,[row.id]);
   }
   await conn.commit();
   if(expired)throw fail('COLLECTIVE_PAYMENT_HOLD_EXPIRED','This 15-minute payment window ended; stock was released and the group must be requalified');
   return {collective_order:true,pending:true};
  }catch(e){await conn.rollback().catch(()=>{});throw e;}finally{conn.release();}
 }
 async assertCanCreateFreshCheckout(orderId,buyerId){
  const [rows]=await db.query(`SELECT payment_hold_status,
   (payment_expires_at>UTC_TIMESTAMP()) AS is_open
   FROM procurement_collective_buyer_orders WHERE order_id=? AND buyer_id=?`,[orderId,buyerId]);
  if(!rows.length||rows[0].is_open==null)return; // Legacy orders have no retroactive deadline.
  if(!['ACTIVE','PAYMENT_PENDING'].includes(rows[0].payment_hold_status)||Number(rows[0].is_open)!==1)
   throw fail('COLLECTIVE_PAYMENT_HOLD_CLOSED','Collective stock hold is closed; no new Safepay session may be created');
 }
 async releaseCheckoutClaim(orderId,buyerId){
  const conn=await db.getConnection();
  try{
   await conn.beginTransaction();
   const [rows]=await conn.query(`SELECT co.id,co.order_id,co.payment_hold_status,
     (co.payment_expires_at>UTC_TIMESTAMP()) AS is_open,o.payment_status
     FROM procurement_collective_buyer_orders co JOIN orders o ON o.id=co.order_id
     WHERE co.order_id=? AND co.buyer_id=? FOR UPDATE`,[orderId,buyerId]);
   const row=rows[0];if(!row){await conn.commit();return;}
   const [attempts]=await conn.query("SELECT id FROM payment_attempts WHERE order_id=? AND status='INITIATED' LIMIT 1 FOR UPDATE",[orderId]);
   if(attempts.length||row.payment_status==='PAID'){
    await conn.query("UPDATE procurement_collective_buyer_orders SET payment_hold_status='RECONCILIATION_REQUIRED' WHERE id=? AND payment_hold_status<>'COMMITTED'",[row.id]);
   }else if(Number(row.is_open)===1){
    await conn.query("UPDATE procurement_collective_buyer_orders SET payment_hold_status='ACTIVE',checkout_started_at=NULL WHERE id=? AND payment_hold_status='PAYMENT_PENDING'",[row.id]);
   }else{
    await this._release(conn,row,'CHECKOUT_NOT_CREATED_BEFORE_EXPIRY');
   }
   await conn.commit();
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 }
 async markPaid(conn,orderId){
  const [rows]=await conn.query('SELECT id,payment_hold_status FROM procurement_collective_buyer_orders WHERE order_id=? FOR UPDATE',[orderId]);
  if(!rows.length)return {handled:false};
  if(rows[0].payment_hold_status==='RELEASED')
   throw fail('COLLECTIVE_STOCK_HOLD_RELEASED','Provider reports payment after the stock hold was released; manual reconciliation required',409);
  await conn.query(`UPDATE procurement_collective_buyer_orders
   SET payment_hold_status='COMMITTED',checkout_started_at=COALESCE(checkout_started_at,UTC_TIMESTAMP())
   WHERE id=? AND payment_hold_status IN ('ACTIVE','PAYMENT_PENDING','RECONCILIATION_REQUIRED','COMMITTED')`,[rows[0].id]);
  return {handled:true};
 }
 async processExpiredBatch(limit=100){
  const size=Math.max(1,Math.min(500,Number(limit)||100));
  const conn=await db.getConnection();const result={checked:0,released:0,reconciliation_required:0,committed:0};
  try{
   await conn.beginTransaction();
   const [rows]=await conn.query(`SELECT co.id,co.order_id,co.buyer_id,co.payment_hold_status,o.payment_status
    FROM procurement_collective_buyer_orders co JOIN orders o ON o.id=co.order_id
    WHERE co.payment_expires_at<=UTC_TIMESTAMP()
      AND co.payment_hold_status IN ('ACTIVE','PAYMENT_PENDING')
    ORDER BY co.payment_expires_at,co.id LIMIT ? FOR UPDATE SKIP LOCKED`,[size]);
   for(const row of rows){
    result.checked++;
    if(row.payment_status==='PAID'){
     await conn.query("UPDATE procurement_collective_buyer_orders SET payment_hold_status='RECONCILIATION_REQUIRED' WHERE id=?",[row.id]);
     result.reconciliation_required++;continue;
    }
    const [attempts]=await conn.query("SELECT id FROM payment_attempts WHERE order_id=? AND status='INITIATED' LIMIT 1 FOR UPDATE",[row.order_id]);
    if(attempts.length){
     await conn.query("UPDATE procurement_collective_buyer_orders SET payment_hold_status='RECONCILIATION_REQUIRED' WHERE id=?",[row.id]);
     result.reconciliation_required++;continue;
    }
    await this._release(conn,row,'PAYMENT_WINDOW_EXPIRED');result.released++;
   }
   await conn.commit();return result;
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 }
}
module.exports=new CollectivePaymentHoldService();
module.exports.CollectivePaymentHoldService=CollectivePaymentHoldService;
