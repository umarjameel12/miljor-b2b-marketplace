'use strict';
// B4 Regular Pool payment deadline. Never merges B5 flash holds or B6 procurement awards.
// This lease gates NEW checkout starts; initiated Safepay payments must be reconciled,
// even after the displayed countdown reaches zero.
const db = require('../config/db');
const HOLD_MINUTES = 15;
const fail=(code,message,statusCode=409)=>Object.assign(new Error(message),{code,statusCode});
class RegularPoolPaymentHoldService {
  async createForOrder(conn,{orderId,reservationId,poolId,buyerId}) {
    if (![orderId,reservationId,poolId,buyerId].every(x=>Number.isSafeInteger(Number(x))&&Number(x)>0))
      throw fail('INVALID_REGULAR_HOLD_CONTEXT','Valid regular pool commitment is required.',400);
    // Called inside the same transaction that inserts the committed B4 order.
    await conn.query(
      `INSERT INTO regular_pool_payment_holds
       (order_id,reservation_id,pool_id,buyer_id,status,expires_at)
       VALUES (?,?,?,?,'HELD',DATE_ADD(UTC_TIMESTAMP(),INTERVAL ? MINUTE))`,
      [orderId,reservationId,poolId,buyerId,HOLD_MINUTES]
    );
  }
  async claimCheckout(orderId,buyerId) {
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      const [orders]=await conn.query('SELECT id,pool_id,reservation_id,buyer_id FROM orders WHERE id=? FOR UPDATE',[orderId]);
      const order=orders[0];
      if(!order || !order.pool_id || !order.reservation_id){await conn.commit();return {regular_pool_order:false};}
      if(Number(order.buyer_id)!==Number(buyerId))throw fail('FORBIDDEN','Cannot start another buyer checkout.',403);
      const [rows]=await conn.query(
        `SELECT h.*, (h.expires_at>UTC_TIMESTAMP()) AS is_open
         FROM regular_pool_payment_holds h WHERE h.order_id=? FOR UPDATE`,[orderId]
      );
      // Pre-migration historical orders are not retroactively assigned fake deadlines.
      if(!rows.length){await conn.commit();return {regular_pool_order:true,historical:true};}
      const hold=rows[0];
      if(Number(hold.buyer_id)!==Number(buyerId) || Number(hold.pool_id)!==Number(order.pool_id))
        throw fail('REGULAR_HOLD_OWNERSHIP_MISMATCH','Payment reservation does not match this buyer/pool.');
      if(hold.status==='PAID'){await conn.commit();return {regular_pool_order:true,paid:true};}
      if(hold.status==='PAYMENT_PENDING'){
        await conn.commit();return {regular_pool_order:true,pending:true};
      }
      if(hold.status!=='HELD' || !hold.is_open){
        if(hold.status==='HELD') {
          await conn.query("UPDATE regular_pool_payment_holds SET status='EXPIRED' WHERE id=? AND status='HELD'",[hold.id]);
        }
        await conn.commit();
        throw fail('REGULAR_PAYMENT_HOLD_EXPIRED','This 15-minute payment window has ended. Contact support for a safe reauthorization.');
      }
      await conn.query(
        "UPDATE regular_pool_payment_holds SET status='PAYMENT_PENDING',checkout_started_at=UTC_TIMESTAMP() WHERE id=?",
        [hold.id]
      );
      await conn.commit();
      return {regular_pool_order:true,pending:true};
    } catch(error){await conn.rollback().catch(()=>{});throw error;} finally{conn.release();}
  }
  async assertCanCreateFreshCheckout(orderId,buyerId) {
    const [rows]=await db.query(
      `SELECT status,(expires_at>UTC_TIMESTAMP()) AS is_open
       FROM regular_pool_payment_holds WHERE order_id=? AND buyer_id=?`,
      [orderId,buyerId]
    );
    if(!rows.length)return; // Existing historical orders predate this migration.
    const hold=rows[0];
    if(hold.status!=='HELD' && hold.status!=='PAYMENT_PENDING')
      throw fail('REGULAR_PAYMENT_HOLD_CLOSED','Payment hold is closed. Do not create a new Safepay session.');
    if(!hold.is_open)
      throw fail('REGULAR_PAYMENT_HOLD_EXPIRED','The payment hold has expired. Provider reconciliation remains available.');
  }
  async releaseCheckoutClaim(orderId,buyerId) {
    const conn=await db.getConnection();
    try {
      await conn.beginTransaction();
      const [orders]=await conn.query('SELECT id,buyer_id FROM orders WHERE id=? FOR UPDATE',[orderId]);
      if(!orders[0] || Number(orders[0].buyer_id)!==Number(buyerId)){await conn.commit();return;}
      const [rows]=await conn.query(
        "SELECT id FROM regular_pool_payment_holds WHERE order_id=? AND buyer_id=? AND status='PAYMENT_PENDING' FOR UPDATE",
        [orderId,buyerId]
      );
      if(rows.length) await conn.query(
        `UPDATE regular_pool_payment_holds
         SET status=CASE WHEN expires_at>UTC_TIMESTAMP() THEN 'HELD' ELSE 'EXPIRED' END,
             checkout_started_at=NULL WHERE id=?`,[rows[0].id]
      );
      await conn.commit();
    } catch(e){await conn.rollback();throw e;}finally{conn.release();}
  }
  async markPaid(conn,orderId) {
    // Invoked INSIDE verified Safepay webhook/provider-reconciliation transaction.
    await conn.query(
      `UPDATE regular_pool_payment_holds
       SET status='PAID',paid_at=UTC_TIMESTAMP()
       WHERE order_id=? AND status IN ('HELD','PAYMENT_PENDING','EXPIRED','RECONCILIATION_REQUIRED')`,
      [orderId]
    );
  }
  async readForOrder(orderId,buyerId) {
    const [rows]=await db.query(
      `SELECT h.status,DATE_FORMAT(h.expires_at,'%Y-%m-%dT%H:%i:%sZ') AS expires_at_utc,
              DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-%dT%H:%i:%sZ') AS server_time_utc,
              (h.expires_at>UTC_TIMESTAMP()) AS can_start,
              h.checkout_started_at IS NOT NULL AS checkout_started
       FROM regular_pool_payment_holds h
       WHERE h.order_id=? AND h.buyer_id=?`,[orderId,buyerId]
    );
    if(!rows[0])return null;
    const r=rows[0];
    return {kind:'REGULAR',status:r.status==='HELD'&&!r.can_start?'EXPIRED':r.status,
      expires_at:r.expires_at_utc,server_time:r.server_time_utc,
      checkout_started:Boolean(r.checkout_started),can_start_checkout:r.status==='HELD'&&Boolean(r.can_start)};
  }
}
module.exports=new RegularPoolPaymentHoldService();
