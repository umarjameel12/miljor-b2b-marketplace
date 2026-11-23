'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.TEST_DB_NAME,'miljor_test_db');assert.ok(['33319','33321'].includes(process.env.DB_PORT));
assert.ok(['127.0.0.1','localhost'].includes(process.env.DB_HOST||'localhost'),'Local isolated test database only');
process.env.APP_FRONTEND_URL='http://127.0.0.1:5173';
const db=require('../src/config/db'),service=require('../src/services/notificationService');
const operations=require('../src/services/notificationOperationsService');
async function main(){
 let userId,adminId;const tag=crypto.randomUUID();
 const eventIds=[];
 try{
  const [[identity]]=await db.query('SELECT DATABASE() AS database_name');
  assert.equal(identity.database_name,'miljor_test_db','Connected DB identity must be proven before fixtures');
  const [user]=await db.query("INSERT INTO users(full_name,email,role) VALUES ('Control gate',?,'BUYER')",[tag+'@example.invalid']);userId=user.insertId;
  const prefs={locale:'ur',optional_email:true,optional_sms:false,muted_info:false,quiet_start:'00:00',quiet_end:'23:59',timezone_offset_minutes:0};
  await service.setPreferences(userId,prefs);
  assert.deepEqual(await service.getPreferences(userId),prefs);
  const enqueue=async(type,key)=>{const c=await db.getConnection();try{await c.beginTransaction();const [r]=await service.enqueueEvent(c,{userId,role:'BUYER',eventType:type,eventKey:tag+key,entityId:userId});await c.commit();eventIds.push(r.insertId);return r.insertId;}catch(e){await c.rollback();throw e;}finally{c.release();}};
  const normal=await enqueue('QUOTE_RECEIVED','normal');
  const critical=await enqueue('PAYMENT_VERIFIED','critical');
  const totals=await service.processPending({limit:10,eventIds:[normal,critical],clock:()=>new Date('2026-11-16T12:00:00Z')});
  assert.equal(totals.failed,0);assert.equal(totals.projected,2);
  const [emails]=await db.query('SELECT payload_json,next_attempt_at FROM transactional_email_outbox WHERE recipient_user_id=? ORDER BY id',[userId]);
  assert.equal(emails.length,2);assert.equal(JSON.parse(typeof emails[0].payload_json==='string'?emails[0].payload_json:JSON.stringify(emails[0].payload_json)).locale,'ur');
  assert.ok(emails[0].next_attempt_at,'optional email waits until quiet period ends');assert.equal(emails[1].next_attempt_at,null,'critical email bypasses quiet hours');
  await service.setPreferences(userId,{...prefs,muted_info:true,optional_email:false});
  const routine=await enqueue('REQUEST_CREATED','muted');
  await service.processPending({limit:1,eventIds:[routine]});
  const [[muted]]=await db.query('SELECT status FROM procurement_notifications WHERE id=?',[routine]);assert.equal(muted.status,'SUPPRESSED');
  const [[hidden]]=await db.query('SELECT COUNT(*) n FROM platform_notifications WHERE user_id=? AND event_key=?',[userId,tag+'muted']);assert.equal(hidden.n,0);
  process.env.NOTIFICATION_OPTIONAL_EMAIL_LIMIT_PER_HOUR='1';
  const c=await db.getConnection();try{await c.beginTransaction();const first=await service.reserveOptionalEmailSlot(c,userId,new Date('2026-12-01T12:00:00Z'));const second=await service.reserveOptionalEmailSlot(c,userId,new Date('2026-12-01T12:00:00Z'));assert.equal(second-first,3600000);await c.rollback();}finally{c.release();}
  await service.setPreferences(userId,{...prefs,muted_info:false,quiet_start:null,quiet_end:null});process.env.NOTIFICATION_DIGEST_ENABLED='true';
  const digest=await enqueue('REQUEST_CREATED','digest');await service.processPending({limit:1,eventIds:[digest]});
  await db.query('UPDATE notification_digest_events SET ready_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE recipient_id=?',[userId]);
  const batches=await service.processDigests({limit:10});assert.equal(batches.queued,1);
  const [[queued]]=await db.query('SELECT status FROM notification_digest_events WHERE notice_id=?',[digest]);assert.equal(queued.status,'QUEUED');
  // All operations targets belong to this gate's recipient; the operator is a
  // separate persisted account. These tests never invoke email transport.
  const adminName='Ops private name '+tag;
  const adminEmail='ops-admin-'+tag+'@example.invalid';
  const [admin]=await db.query(
    "INSERT INTO users(full_name,email,role,is_verified,verification_status) VALUES (?,?,'SUPPORT_ADMIN',1,'VERIFIED')",
    [adminName,adminEmail]);adminId=admin.insertId;
  const operator={id:adminId,role:'BUYER'}; // Persisted role, not caller claim, authorizes recovery.
  const buyer={id:userId,role:'SUPER_ADMIN'};
  const poison=await enqueue('REQUEST_CREATED','poison-digest');
  const tx=await db.getConnection();let goodDigest;
  try{
    await tx.beginTransaction();
    const [created]=await service.enqueueEvent(tx,{userId:adminId,role:'SUPPORT_ADMIN',eventType:'REQUEST_CREATED',eventKey:tag+'good-digest',entityId:adminId});
    goodDigest=created.insertId;await tx.commit();
  }catch(error){await tx.rollback();throw error;}finally{tx.release();}
  await service.processPending({limit:2,eventIds:[poison,goodDigest]});
  await db.query('UPDATE users SET email=? WHERE id=?',['malformed-email',userId]);
  await db.query('UPDATE notification_digest_events SET ready_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE notice_id IN (?,?)',[poison,goodDigest]);
  const isolated=await service.processDigests({limit:10});assert.equal(isolated.failed,1);assert.equal(isolated.queued,1);
  const [digestStates]=await db.query('SELECT notice_id,status FROM notification_digest_events WHERE notice_id IN (?,?) ORDER BY notice_id',[poison,goodDigest]);
  assert.deepEqual(digestStates.map(row=>row.status),['FAILED','QUEUED'],'bad recipient must not roll back a different digest');
  await db.query('UPDATE users SET email=? WHERE id=?',[tag+'@example.invalid',userId]);
  const opsEvent=await enqueue('QUOTE_RECEIVED','ops-event');
  await db.query("UPDATE procurement_notifications SET status='FAILED',attempt_count=5,last_error_code='EMAIL_QUEUE_FAILED',next_attempt_at=UTC_TIMESTAMP()+INTERVAL 1 HOUR WHERE id=?",[opsEvent]);
  const privatePayload='OPS_PRIVATE_PAYLOAD_'+tag;
  const seedEmail=async key=>{
    const [result]=await db.query(
      `INSERT INTO transactional_email_outbox
       (recipient_email,recipient_user_id,template_name,subject,payload_json,status,attempt_count,last_error,idempotency_key)
       VALUES (?,?,'platform_notification',?,?,'FAILED',3,?,?)`,
      [tag+'@example.invalid',userId,'Private subject '+tag,JSON.stringify({fixture:privatePayload}),
        'Provider failed for '+tag+'@example.invalid: '+privatePayload,key]);
    return result.insertId;
  };
  const linkedEmail=await seedEmail('notice:'+crypto.createHash('sha256').update(userId+':'+tag+'ops-event').digest('hex'));
  const directEmail=await seedEmail(tag+':ops-email');
  const auditRows=async()=>{
    const [rows]=await db.query(
      `SELECT actor_id,notice_id,email_id,action,previous_attempt_count,previous_email_attempt_count,reason
       FROM notification_admin_events WHERE notice_id=? OR email_id IN (?,?) ORDER BY id`,
      [opsEvent,linkedEmail,directEmail]);return rows;
  };
  const savedTargets=async()=>{
    const [[event]]=await db.query('SELECT status,attempt_count,last_error_code,next_attempt_at FROM procurement_notifications WHERE id=?',[opsEvent]);
    const [emails]=await db.query('SELECT id,status,attempt_count,claim_token,claim_expires_at,next_attempt_at FROM transactional_email_outbox WHERE id IN (?,?) ORDER BY id',[linkedEmail,directEmail]);
    return {event,emails};
  };
  const failedTargets=await savedTargets();
  const reason='  Isolated operations recovery verified  ';
  for(const request of [()=>operations.retryNotice({actor:buyer,id:opsEvent,reason}),
    ()=>operations.retryEmail({actor:buyer,id:directEmail,reason}),()=>operations.health({actor:buyer})]){
    await assert.rejects(request,error=>error.statusCode===403,'Buyer cannot impersonate an operations administrator');
  }
  await assert.rejects(()=>operations.retryNotice({actor:operator,id:opsEvent}),error=>error.statusCode===400);
  await assert.rejects(()=>operations.retryEmail({actor:operator,id:directEmail}),error=>error.statusCode===400);
  assert.deepEqual(await savedTargets(),failedTargets,'Rejected actions preserve both failed queues');
  assert.equal((await auditRows()).length,0,'Rejected actions cannot record a successful retry');

  const health=await operations.health({actor:operator});
  assert.ok(health.projection.deadLetter>=1);assert.ok(health.email.terminalFailed>=2);
  assert.ok(health.failures.some(row=>row.id===opsEvent&&row.channel==='EVENT'));
  for(const id of [linkedEmail,directEmail]){
    const row=health.failures.find(row=>row.id===id&&row.channel==='EMAIL');
    assert.ok(row,'Own failed email appears in health');assert.equal(row.lastErrorCode,'EMAIL_DELIVERY_FAILED');
  }
  for(const row of health.failures)assert.deepEqual(Object.keys(row).sort(),['attemptCount','channel','createdAt','eventType','id','lastErrorCode','status']);
  const healthJson=JSON.stringify(health);
  for(const privateValue of [tag,adminName,adminEmail,privatePayload,'recipient_email','payload_json','subject']){
    assert.ok(!healthJson.includes(privateValue),'Health must omit recipient, payload, subject and raw provider details');
  }

  assert.deepEqual(await operations.retryNotice({actor:operator,id:opsEvent,reason}),{id:opsEvent,status:'PENDING'});
  const eventRetried=await savedTargets();
  assert.equal(eventRetried.event.status,'PENDING');assert.equal(eventRetried.event.attempt_count,0);
  assert.equal(eventRetried.event.last_error_code,null);assert.equal(eventRetried.event.next_attempt_at,null);
  const recoveredEmail=eventRetried.emails.find(row=>row.id===linkedEmail);
  assert.equal(recoveredEmail.status,'QUEUED');assert.equal(recoveredEmail.attempt_count,0);
  assert.equal(recoveredEmail.claim_token,null);assert.equal(recoveredEmail.claim_expires_at,null);assert.equal(recoveredEmail.next_attempt_at,null);
  assert.equal(eventRetried.emails.find(row=>row.id===directEmail).status,'FAILED','EVENT retry cannot reset an unrelated email');
  assert.deepEqual(await auditRows(),[{actor_id:adminId,notice_id:opsEvent,email_id:null,action:'RETRY',previous_attempt_count:5,previous_email_attempt_count:3,reason:reason.trim()}]);
  await assert.rejects(()=>operations.retryNotice({actor:operator,id:opsEvent,reason}),error=>error.statusCode===409);
  assert.deepEqual(await savedTargets(),eventRetried,'EVENT replay cannot alter the recovered state');
  assert.equal((await auditRows()).length,1,'EVENT replay must not add a second audit');

  assert.deepEqual(await operations.retryEmail({actor:operator,id:directEmail,reason}),{id:directEmail,status:'QUEUED'});
  const emailRetried=await savedTargets();
  const recoveredDirect=emailRetried.emails.find(row=>row.id===directEmail);
  assert.equal(recoveredDirect.status,'QUEUED');assert.equal(recoveredDirect.attempt_count,0);
  assert.equal(recoveredDirect.claim_token,null);assert.equal(recoveredDirect.claim_expires_at,null);assert.equal(recoveredDirect.next_attempt_at,null);
  assert.deepEqual((await auditRows())[1],{actor_id:adminId,notice_id:null,email_id:directEmail,action:'EMAIL_RETRY',previous_attempt_count:0,previous_email_attempt_count:3,reason:reason.trim()});
  await assert.rejects(()=>operations.retryEmail({actor:operator,id:directEmail,reason}),error=>error.statusCode===409);
  assert.deepEqual(await savedTargets(),emailRetried,'EMAIL replay cannot alter the recovered state');
  assert.equal((await auditRows()).length,2,'One persisted audit per successful EVENT/EMAIL retry');
  console.log('PASS: MySQL operations persisted authorization, EVENT/EMAIL recovery, exact audit evidence, replay409, health privacy');
  console.log('PASS: MySQL Urdu preferences, quiet deferral, mandatory override, mute suppression, locked hourly budget, durable digest');
 }finally{
  try{
   // Audit FKs must be removed before either the fixture email or actor.
   const actors=[userId,adminId].filter(id=>id!==undefined);
   if(actors.length)await db.query('DELETE FROM notification_admin_events WHERE actor_id IN ('+actors.map(()=>'?').join(',')+')',actors);
   if(userId){
    await db.query('DELETE FROM notification_digest_events WHERE recipient_id=?',[userId]);
    await db.query('DELETE FROM transactional_email_outbox WHERE recipient_user_id=?',[userId]);
    await db.query('DELETE FROM platform_notifications WHERE user_id=?',[userId]);
    await db.query('DELETE FROM procurement_notifications WHERE recipient_id=?',[userId]);
    await db.query('DELETE FROM notification_email_budgets WHERE user_id=?',[userId]);
    await db.query('DELETE FROM notification_preferences WHERE user_id=?',[userId]);
    await db.query('DELETE FROM users WHERE id=?',[userId]);
   }
   if(adminId){
    await db.query('DELETE FROM notification_digest_events WHERE recipient_id=?',[adminId]);
    await db.query('DELETE FROM transactional_email_outbox WHERE recipient_user_id=?',[adminId]);
    await db.query('DELETE FROM platform_notifications WHERE user_id=?',[adminId]);
    await db.query('DELETE FROM procurement_notifications WHERE recipient_id=?',[adminId]);
    await db.query('DELETE FROM notification_email_budgets WHERE user_id=?',[adminId]);
    await db.query('DELETE FROM notification_preferences WHERE user_id=?',[adminId]);
    await db.query('DELETE FROM users WHERE id=?',[adminId]);
   }
  }finally{await db.end();}
 }
}
main().catch(e=>{console.error(e.code||'ASSERTION',e.message);process.exitCode=1});
