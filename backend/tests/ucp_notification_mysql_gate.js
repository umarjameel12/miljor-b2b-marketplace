'use strict';
// Real InnoDB proof, rolled back in full. Never contacts email/payment providers.
const assert=require('node:assert/strict');
if(process.env.NODE_ENV!=='test'||process.env.TEST_DB_NAME!=='miljor_test_db')throw Error('EXPLICIT_TEST_DB_REQUIRED');
const db=require('../src/config/db');
const {recordOrderOnConnection}=require('../src/services/ucpTransactionalNotifications');
async function main(){
  const connection=await db.getConnection();
  const tag=require('node:crypto').randomBytes(6).toString('hex');
  let orderId;
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
    const event={orderId,type:'PAYMENT.CONFIRMED',transitionId:'paid'};
    await recordOrderOnConnection(connection,event);
    await recordOrderOnConnection(connection,event);
    const [[notices]]=await connection.query('SELECT COUNT(*) AS n FROM platform_notifications WHERE user_id IN (?,?)',[buyer.insertId,supplier.insertId]);
    assert.equal(notices.n,2,'replay creates one in-app receipt per persisted owner');
    const [[emails]]=await connection.query('SELECT COUNT(*) AS n FROM transactional_email_outbox WHERE recipient_user_id IN (?,?)',[buyer.insertId,supplier.insertId]);
    assert.equal(emails.n,2,'replay queues exactly one email per owner');
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
    console.log('PASS: real MySQL UCP ownership, replay dedupe, in-app/email atomic rollback, zero money movement');
  }finally{await connection.rollback();connection.release();await db.end();}
}
main().catch(e=>{console.error('UCP_NOTIFICATION_MYSQL_GATE_FAIL',e.code||'ASSERTION',e.message);process.exitCode=1;});
