'use strict';
// B4 Regular Pool payment deadline. Never merges B5 flash holds or B6 procurement awards.
// This lease gates NEW checkout starts; unresolved Safepay payments must be reconciled,
// even after the displayed countdown reaches zero.
const HOLD_MINUTES = 15;
const fail=(code,message,statusCode=409)=>Object.assign(new Error(message),{code,statusCode});
class RegularPoolPaymentHoldService {
  constructor({database,notifications}={}) { this.database=database; this.notifications=notifications; }
  get db() { return this.database || require('../config/db'); }
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
    const conn=await this.db.getConnection();
    try {
      await conn.beginTransaction();
      const [context]=await conn.query('SELECT pool_id FROM orders WHERE id=?',[orderId]);
      if(context[0]?.pool_id) await conn.query('SELECT id FROM pools WHERE id=? FOR UPDATE',[context[0].pool_id]);
      const [orders]=await conn.query('SELECT id,pool_id,reservation_id,buyer_id FROM orders WHERE id=? FOR UPDATE',[orderId]);
      const order=orders[0];
      if(!order || !order.pool_id || !order.reservation_id){await conn.commit();return {regular_pool_order:false};}
      if(Number(order.pool_id)!==Number(context[0]?.pool_id))throw fail('REGULAR_HOLD_OWNERSHIP_MISMATCH','Order pool changed while acquiring locks.');
      if(Number(order.buyer_id)!==Number(buyerId))throw fail('FORBIDDEN','Cannot start another buyer checkout.',403);
      const [rows]=await conn.query(
        `SELECT h.*
         FROM regular_pool_payment_holds h WHERE h.order_id=? FOR UPDATE`,[orderId]
      );
      // Pre-migration historical orders are not retroactively assigned fake deadlines.
      if(!rows.length){await conn.commit();return {regular_pool_order:true,historical:true};}
      const hold=rows[0];
      const [[clock]]=await conn.query('SELECT (expires_at>UTC_TIMESTAMP()) AS is_open FROM regular_pool_payment_holds WHERE id=?',[hold.id]);
      hold.is_open=Number(clock.is_open)===1;
      if(Number(hold.buyer_id)!==Number(buyerId) || Number(hold.pool_id)!==Number(order.pool_id))
        throw fail('REGULAR_HOLD_OWNERSHIP_MISMATCH','Payment reservation does not match this buyer/pool.');
      if(hold.status==='PAID'){await conn.commit();return {regular_pool_order:true,paid:true};}
      if(['PAYMENT_PENDING','RECONCILIATION_REQUIRED'].includes(hold.status)){
        await conn.commit();return {regular_pool_order:true,pending:true};
      }
      if(hold.status!=='HELD' || !hold.is_open){
        if(hold.status==='HELD') {
          const [attempts]=await conn.query("SELECT id FROM payment_attempts WHERE order_id=? AND status IN ('INITIATED','RECONCILIATION_REQUIRED') LIMIT 1 FOR UPDATE",[orderId]);
          await this.recordExpiryOnConnection(conn,hold,attempts.length?'RECONCILIATION_REQUIRED':'EXPIRED');
          if(attempts.length){await conn.commit();return {regular_pool_order:true,pending:true};}
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
    // Call BEFORE reserving this request's new attempt. The checkout service
    // must also serialize its reservation under the order lock: this read is
    // a fail-closed guard, not a substitute for atomic session allocation.
    const [unresolved]=await this.db.query(`SELECT pa.id FROM payment_attempts pa JOIN orders o ON o.id=pa.order_id
      WHERE pa.order_id=? AND o.buyer_id=? AND o.pool_id IS NOT NULL AND o.reservation_id IS NOT NULL
      AND pa.status IN ('INITIATED','RECONCILIATION_REQUIRED') LIMIT 1`,[orderId,buyerId]);
    if(unresolved.length)throw fail('REGULAR_PAYMENT_RECONCILIATION_REQUIRED','An unresolved provider attempt already exists. Reconcile it before creating another checkout.');
    const [rows]=await this.db.query(
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
    const conn=await this.db.getConnection();
    try {
      await conn.beginTransaction();
      const [context]=await conn.query('SELECT pool_id FROM orders WHERE id=?',[orderId]);
      if(context[0]?.pool_id) await conn.query('SELECT id FROM pools WHERE id=? FOR UPDATE',[context[0].pool_id]);
      const [orders]=await conn.query('SELECT id,buyer_id,pool_id FROM orders WHERE id=? FOR UPDATE',[orderId]);
      if(!orders[0] || Number(orders[0].buyer_id)!==Number(buyerId)){await conn.commit();return;}
      if(Number(orders[0].pool_id)!==Number(context[0]?.pool_id))throw fail('REGULAR_HOLD_OWNERSHIP_MISMATCH','Order pool changed while acquiring locks.');
      const [rows]=await conn.query(
        "SELECT id FROM regular_pool_payment_holds WHERE order_id=? AND buyer_id=? AND status='PAYMENT_PENDING' FOR UPDATE",
        [orderId,buyerId]
      );
      // A durable reservation with no tracker is also an unknown provider
      // outcome. Neither its age nor absence of a tracker authorizes release.
      const [unresolved]=await conn.query(
        "SELECT id FROM payment_attempts WHERE order_id=? AND status IN ('INITIATED','RECONCILIATION_REQUIRED') LIMIT 1 FOR UPDATE",
        [orderId]
      );
      if(rows.length && !unresolved.length){
        const [[clock]]=await conn.query('SELECT (expires_at>UTC_TIMESTAMP()) AS is_open FROM regular_pool_payment_holds WHERE id=?',[rows[0].id]);
        if(Number(clock.is_open))await conn.query("UPDATE regular_pool_payment_holds SET status='HELD',checkout_started_at=NULL WHERE id=?",[rows[0].id]);
        else await this.recordExpiryOnConnection(conn,{id:rows[0].id,order_id:orderId,pool_id:context[0].pool_id},'EXPIRED');
      }
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
    const [rows]=await this.db.query(
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
  // Caller holds parent pool lock. Never release inventory, cancel an order, or
  // infer a provider outcome. PAYMENT_PENDING also covers an in-flight API call
  // which has a RECONCILIATION_REQUIRED reservation without a tracker, or has
  // not yet persisted an attempt in a historical checkout path.
  async expireForPoolOnConnection(conn,poolId,{limit=100}={}) {
    if(!Number.isInteger(limit)||limit<1||limit>100)throw fail('INVALID_RECOVERY_LIMIT','Invalid batch size.',400);
    const [holds]=await conn.query(`SELECT h.* FROM regular_pool_payment_holds h
      WHERE h.pool_id=? AND h.status IN ('HELD','PAYMENT_PENDING') AND h.expires_at<=UTC_TIMESTAMP()
      ORDER BY h.id LIMIT ?`,[poolId,limit]);
    let expired=0,reconciliation=0;
    for(const candidate of holds){
      const [[order]]=await conn.query('SELECT id,pool_id,buyer_id,reservation_id,payment_status FROM orders WHERE id=? FOR UPDATE',[candidate.order_id]);
      const [[hold]]=await conn.query('SELECT * FROM regular_pool_payment_holds WHERE id=? FOR UPDATE',[candidate.id]);
      const [[clock]]=await conn.query('SELECT (expires_at<=UTC_TIMESTAMP()) AS expired FROM regular_pool_payment_holds WHERE id=?',[candidate.id]);
      if(!hold || !Number(clock.expired) || !['HELD','PAYMENT_PENDING'].includes(hold.status))continue;
      if(!order)throw fail('REGULAR_HOLD_ORDER_MISSING','Hold order missing.');
      if(Number(hold.pool_id)!==Number(poolId)||Number(order.pool_id)!==Number(poolId)||
        Number(order.buyer_id)!==Number(hold.buyer_id)||Number(order.reservation_id)!==Number(hold.reservation_id))
        throw fail('REGULAR_HOLD_OWNERSHIP_MISMATCH','Payment hold does not match its order.');
      const [attempts]=await conn.query("SELECT id FROM payment_attempts WHERE order_id=? AND status IN ('INITIATED','RECONCILIATION_REQUIRED') LIMIT 1 FOR UPDATE",[hold.order_id]);
      const pending=hold.status==='PAYMENT_PENDING'||attempts.length>0||order.payment_status==='PAID';
      const status=pending?'RECONCILIATION_REQUIRED':'EXPIRED';
      await this.recordExpiryOnConnection(conn,hold,status);
      pending?reconciliation++:expired++;
    }
    return {expired,reconciliation};
  }
  async recordExpiryOnConnection(conn,hold,status){
    await conn.query('UPDATE regular_pool_payment_holds SET status=? WHERE id=?',[status,hold.id]);
    const transitionId=`regular-hold-${hold.id}-${status}`;
    await conn.query(`INSERT INTO system_audit_logs
      (actor_id,actor_role,action,entity_name,entity_id,new_value)
      VALUES (NULL,'SYSTEM','REGULAR_PAYMENT_HOLD_TIMEOUT','pools',?,?)`,
      [hold.pool_id,JSON.stringify({hold_id:hold.id,order_id:hold.order_id,status,transition_id:transitionId})]);
    await (this.notifications||require('./ucpTransactionalNotifications')).recordOrderOnConnection(conn,{
      orderId:hold.order_id,type:status==='EXPIRED'?'UCP.HOLD_EXPIRED':'PAYMENT.RECONCILIATION_EXCEPTION',transitionId});
  }
}
module.exports=new RegularPoolPaymentHoldService();
module.exports.RegularPoolPaymentHoldService=RegularPoolPaymentHoldService;
