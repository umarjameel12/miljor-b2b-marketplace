'use strict';
// Real InnoDB proof of atomic domain events plus post-commit channel projection.
// Only owned synthetic fixtures are cleaned; no email/payment provider is called.
const assert=require('node:assert/strict');
if(process.env.NODE_ENV!=='test'||process.env.TEST_DB_NAME!=='miljor_test_db')throw Error('EXPLICIT_TEST_DB_REQUIRED');
process.env.APP_FRONTEND_URL=process.env.APP_FRONTEND_URL||'http://127.0.0.1:5173';
const db=require('../src/config/db');
const {recordOrderOnConnection}=require('../src/services/ucpTransactionalNotifications');
const notifications=require('../src/services/notificationService');
async function main(){
  const connection=await db.getConnection();
  const tag=require('node:crypto').randomBytes(6).toString('hex');
  let orderId,ownedUsers=[],committed=false;
  try{
    const [[target]]=await connection.query('SELECT DATABASE() AS name');
    assert.equal(target.name,'miljor_test_db');
    const [[schema]]=await connection.query("SELECT DATA_TYPE FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='platform_notifications' AND COLUMN_NAME='event_type'");
    assert.equal(schema.DATA_TYPE,'varchar','migration 092 or equivalent widening is required; no automatic DDL');
    await connection.beginTransaction();
    const [buyer]=await connection.query("INSERT INTO users(full_name,email,role) VALUES (?,?,'BUYER')",['UCP fixture buyer',tag+'b@example.test']);
    const [supplier]=await connection.query("INSERT INTO users(full_name,email,role) VALUES (?,?,'SUPPLIER')",['UCP fixture supplier',tag+'s@example.test']);
    const [stranger]=await connection.query("INSERT INTO users(full_name,email,role) VALUES (?,?,'BUYER')",['UCP fixture stranger',tag+'x@example.test']);
    const [order]=await connection.query(`INSERT INTO orders(order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,total_amount)
      VALUES (?,?,?,1,100,100,100)`,['UCP-'+tag,buyer.insertId,supplier.insertId]);
    orderId=order.insertId;
    ownedUsers=[buyer.insertId,supplier.insertId,stranger.insertId];
    const event={orderId,type:'PAYMENT.CONFIRMED',transitionId:'paid'};
    await recordOrderOnConnection(connection,event);
    await recordOrderOnConnection(connection,event);
    const [[events]]=await connection.query('SELECT COUNT(*) AS n FROM procurement_notifications WHERE recipient_id IN (?,?)',[buyer.insertId,supplier.insertId]);
    assert.equal(events.n,2,'replay stores one durable event per owner');
    const [[notices]]=await connection.query('SELECT COUNT(*) AS n FROM platform_notifications WHERE user_id IN (?,?)',[buyer.insertId,supplier.insertId]);
    assert.equal(notices.n,0,'inbox projection cannot escape an uncommitted domain event');
    const [[emails]]=await connection.query('SELECT COUNT(*) AS n FROM transactional_email_outbox WHERE recipient_user_id IN (?,?)',[buyer.insertId,supplier.insertId]);
    assert.equal(emails.n,0,'email cannot be queued before domain commit');
    const [[foreign]]=await connection.query('SELECT COUNT(*) AS n FROM platform_notifications WHERE user_id=?',[stranger.insertId]);
    assert.equal(foreign.n,0,'unrelated buyer receives nothing');
    const [[money]]=await connection.query('SELECT COUNT(*) AS n FROM payments WHERE order_id=?',[orderId]);
    assert.equal(money.n,0,'notification receipt cannot fabricate payment evidence');
    await connection.rollback();
    const [[gone]]=await connection.query('SELECT COUNT(*) AS n FROM orders WHERE id=?',[orderId]);
    assert.equal(gone.n,0,'transaction rollback removes order fixture');
    const [[ghosts]]=await connection.query('SELECT COUNT(*) AS n FROM platform_notifications WHERE user_id IN (?,?)',[buyer.insertId,supplier.insertId]);
    assert.equal(ghosts.n,0,'rollback removes notifications');
    const [[ghostEmail]]=await connection.query('SELECT COUNT(*) AS n FROM transactional_email_outbox WHERE recipient_user_id IN (?,?)',[buyer.insertId,supplier.insertId]);
    assert.equal(ghostEmail.n,0,'rollback removes email outbox entries');
    const [[ghostEvents]]=await connection.query('SELECT COUNT(*) AS n FROM procurement_notifications WHERE recipient_id IN (?,?)',[buyer.insertId,supplier.insertId]);
    assert.equal(ghostEvents.n,0,'rollback removes durable source events');

    await connection.beginTransaction();
    await connection.query("INSERT INTO users(id,full_name,email,role) VALUES (?,'UCP buyer',?,'BUYER'),(?,'UCP supplier',?,'SUPPLIER'),(?,'UCP stranger',?,'BUYER')",
      [buyer.insertId,tag+'b@example.test',supplier.insertId,tag+'s@example.test',stranger.insertId,tag+'x@example.test']);
    await connection.query(`INSERT INTO orders(id,order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,total_amount)
      VALUES (?,?,?,?,1,100,100,100)`,[orderId,'UCP-'+tag,buyer.insertId,supplier.insertId]);
    await recordOrderOnConnection(connection,event);
    await connection.commit();committed=true;
    const [pending]=await connection.query('SELECT id FROM procurement_notifications WHERE recipient_id IN (?,?)',[buyer.insertId,supplier.insertId]);
    const ids=pending.map(row=>Number(row.id));
    const projected=await notifications.processPending({limit:10,eventIds:ids});
    assert.equal(projected.projected,2);assert.equal(projected.failed,0);
    const replay=await notifications.processPending({limit:10,eventIds:ids});
    assert.equal(replay.processed,0,'committed events project once');
    const [[delivered]]=await connection.query('SELECT COUNT(*) AS n FROM platform_notifications WHERE user_id IN (?,?)',[buyer.insertId,supplier.insertId]);
    const [[queued]]=await connection.query('SELECT COUNT(*) AS n FROM transactional_email_outbox WHERE recipient_user_id IN (?,?)',[buyer.insertId,supplier.insertId]);
    assert.equal(delivered.n,2);assert.equal(queued.n,2);
    console.log('PASS: real MySQL owner isolation, domain rollback, post-commit inbox/email projection and replay dedupe, zero money movement');
  }finally{
    await connection.rollback();
    if(committed){
      await connection.query('DELETE FROM transactional_email_outbox WHERE recipient_user_id IN (?)',[ownedUsers]);
      await connection.query('DELETE FROM platform_notifications WHERE user_id IN (?)',[ownedUsers]);
      await connection.query('DELETE FROM procurement_notifications WHERE recipient_id IN (?)',[ownedUsers]);
      await connection.query('DELETE FROM orders WHERE id=?',[orderId]);
      await connection.query('DELETE FROM users WHERE id IN (?)',[ownedUsers]);
    }
    connection.release();await db.end();
  }
}
main().catch(e=>{console.error('UCP_NOTIFICATION_MYSQL_GATE_FAIL',e.code||'ASSERTION',e.message);process.exitCode=1;});
