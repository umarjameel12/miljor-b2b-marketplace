'use strict';
process.env.NODE_ENV='test';
process.env.TEST_DB_NAME='miljor_test_db';
process.env.TRANSACTIONAL_EMAIL_MODE='mock';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const db=require('../src/config/db');
const requests=require('../src/services/procurementRequestService');
const notifications=require('../src/services/notificationService');
const email=require('../src/services/emailService');
const ownedUsers=[],ownedRequests=[];
const tag=crypto.randomUUID();
async function run(){
  const [[identity]]=await db.query('SELECT DATABASE() AS name');
  assert.equal(identity.name,'miljor_test_db');
  for(const role of ['BUYER','BUYER']){
    const [created]=await db.query(
      "INSERT INTO users(full_name,email,role,is_verified,verification_status) VALUES (?,?,?,1,'VERIFIED')",
      ['Notification acceptance '+tag,'notification-'+ownedUsers.length+'-'+tag+'@example.invalid',role]);
    ownedUsers.push(created.insertId);
  }
  const [buyer,otherBuyer]=ownedUsers;
  const [families]=await db.query("SELECT id,allowed_purchasing_units FROM catalog_product_families WHERE is_active=1 AND approval_status='APPROVED' ORDER BY id LIMIT 1");
  assert.ok(families.length,'Approved catalog fixture required');
  const units=typeof families[0].allowed_purchasing_units==='string'?JSON.parse(families[0].allowed_purchasing_units):families[0].allowed_purchasing_units;
  const unit=units.find(value=>['kg','g','l','ml','bag','tin','carton','sack','bundle','pack'].includes(value));
  assert.ok(unit,'Supported purchasing unit required');
  const input={delivery_area:'Lahore',quote_deadline:new Date(Date.now()+3600000).toISOString(),
    items:[{family_id:families[0].id,quantity:'1',unit}]};
  const created=await requests.createDraft(buyer,input,'notification-create-'+tag);
  ownedRequests.push(created.request.id);
  await requests.createDraft(buyer,input,'notification-create-'+tag);
  await requests.publish(buyer,created.request.id,created.request.version_number,'notification-publish-'+tag);
  const [events]=await db.query('SELECT id,event_type FROM procurement_notifications WHERE recipient_id=? ORDER BY id',[buyer]);
  assert.deepEqual(events.map(row=>row.event_type),['REQUEST_CREATED','REQUEST_PUBLISHED']);
  await notifications.setPreferences(buyer,{locale:'ur',optional_email:true,optional_sms:false});
  const options={limit:2,eventIds:events.map(row=>Number(row.id)),emailService:email};
  await Promise.all([notifications.processPending(options),notifications.processPending(options)]);
  const inbox=await notifications.listUserNotifications(buyer);
  assert.equal(inbox.length,2);assert.equal(await notifications.getUnreadCount(buyer),2);
  assert.ok(inbox.every(row=>/[\u0600-\u06ff]/.test(row.title)));
  assert.equal(await notifications.getUnreadCount(otherBuyer),0);
  assert.equal(await notifications.markAsRead(otherBuyer,inbox[0].id),false);
  assert.equal(await notifications.markAsRead(buyer,inbox[0].id),true);
  assert.equal(await notifications.getUnreadCount(buyer),1);
  await notifications.processPending(options);
  const [emails]=await db.query('SELECT status,recipient_email FROM transactional_email_outbox WHERE recipient_user_id=?',[buyer]);
  assert.equal(emails.length,1);assert.equal(emails[0].status,'QUEUED');
  assert.equal(email.emailMode,'mock');
  const connection=await db.getConnection();
  try{
    await connection.beginTransaction();
    await notifications.enqueueEvent(connection,{userId:buyer,role:'BUYER',eventType:'REQUEST_CREATED',
      eventKey:'rollback:'+tag,entityId:created.request.id});
    await connection.rollback();
  }finally{connection.release();}
  const [[rolledBack]]=await db.query('SELECT COUNT(*) AS total FROM procurement_notifications WHERE event_key=?',['rollback:'+tag]);
  assert.equal(rolledBack.total,0);
  assert.equal((await notifications.listUserNotifications(buyer)).length,2);
  console.log('NOTIFICATION_MYSQL_ACTION_PASS: actual request create/publish/replay; transaction rollback; concurrent projection; Urdu; recipient isolation; durable unread; email QUEUED only; no provider dispatch');
}
run().catch(error=>{console.error(error.code||'NOTIFICATION_MYSQL_ACTION_FAIL',error.message);process.exitCode=1;})
.finally(async()=>{
  try{
    const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.equal(identity.name,'miljor_test_db');
    for(const userId of ownedUsers){
      await db.query('DELETE FROM transactional_email_outbox WHERE recipient_user_id=?',[userId]);
      await db.query('DELETE FROM notification_digest_events WHERE recipient_id=?',[userId]);
      await db.query('DELETE FROM notification_email_budgets WHERE user_id=?',[userId]);
      await db.query('DELETE FROM platform_notifications WHERE user_id=?',[userId]);
      await db.query('DELETE FROM procurement_notifications WHERE recipient_id=?',[userId]);
      await db.query('DELETE FROM notification_preferences WHERE user_id=?',[userId]);
    }
    for(const requestId of ownedRequests){
      await db.query('DELETE FROM procurement_request_mutations WHERE request_id=?',[requestId]);
      await db.query('DELETE FROM procurement_request_items WHERE request_id=?',[requestId]);
      await db.query('DELETE FROM procurement_requests WHERE id=?',[requestId]);
    }
    for(const userId of ownedUsers)await db.query('DELETE FROM users WHERE id=? AND email LIKE ?',[userId,'%'+tag+'@example.invalid']);
  }catch(error){console.error('OWNED_FIXTURE_CLEANUP_FAILED',error.code||error.message);process.exitCode=1;}
  await db.end();
});
