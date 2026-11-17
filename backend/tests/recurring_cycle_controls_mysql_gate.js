'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.DB_NAME,'miljor_test_db');assert.equal(process.env.TEST_DB_NAME,'miljor_test_db');
const db=require('../src/config/db');
const requests=require('../src/services/procurementRequestService');
const recurring=require('../src/services/procurementRecurringService');
const {ProcurementRecurringService}=require('../src/services/procurementRecurringService');
const tag=crypto.randomUUID(),users=[],requestIds=[];let contractId,count=0;
const pass=label=>{console.log('PASS '+(++count)+' '+label);};
const deny=(fn,code)=>assert.rejects(fn,error=>error.code===code);
async function main(){
 assert.equal((await db.query('SELECT DATABASE() AS name'))[0][0].name,'miljor_test_db');
 const [[before]]=await db.query('SELECT (SELECT COUNT(*) FROM orders) orders,(SELECT COUNT(*) FROM payments) payments');
 for(let index=0;index<2;index++){
  const [created]=await db.query("INSERT INTO users(full_name,email,role,is_verified,verification_status) VALUES (?,?,'BUYER',1,'VERIFIED')",['Recurring controls fixture',index+'-'+tag+'@example.invalid']);users.push(created.insertId);
 }
 const [buyer,other]=users;
 const [families]=await db.query("SELECT f.id FROM catalog_product_families f JOIN catalog_categories c ON c.id=f.category_id AND c.is_active=1 AND c.approval_status='APPROVED' WHERE f.is_active=1 AND f.approval_status='APPROVED' AND JSON_CONTAINS(f.allowed_purchasing_units,JSON_QUOTE('bag')) ORDER BY f.id LIMIT 1");assert.ok(families.length);
 const draft=await requests.createDraft(buyer,{frequency:'BIWEEKLY',delivery_area:'Lahore',items:[{family_id:families[0].id,quantity:'2',unit:'bag'}]},'rec-inputs-template-'+tag);requestIds.push(draft.request.id);
 const tomorrow=new Date(Date.now()+86400000);const starts=tomorrow.toISOString().slice(0,10);
 const created=await recurring.createDraft(buyer,draft.request.id,{cadence:'BIWEEKLY',weekday_number:tomorrow.getUTCDay(),local_run_time:'23:59',starts_on:starts},'rec-inputs-contract-'+tag);contractId=created.contract.id;
 await recurring.changeStatus(buyer,contractId,'ACTIVATE',1,true);
 const scheduled=await recurring.scheduleUpcomingForBuyer(buyer,contractId,{limit:4});assert.equal(scheduled.cycles.length,4);pass('Owned biweekly future cycles scheduled');
 const [first,second,third,fourth]=scheduled.cycles.map(c=>c.cycle_id);
 const inputs=await recurring.cycleInputs(buyer,contractId,first);assert.equal(inputs.revision,0);
 const payload={expected_revision:0,items:inputs.items.map(item=>({template_item_id:item.template_item_id,quantity:'3'})),delivery_preference:{mode:'PICKUP'}};
 await deny(()=>recurring.updateCycleInputs(other,contractId,first,payload,'rec-other-'+tag),'CONTRACT_NOT_FOUND');
 await deny(()=>recurring.updateCycleInputs(buyer,contractId,first,{...payload,items:[{...payload.items[0],quantity:'1.5'}]},'rec-fraction-'+tag),'INVALID_PROCUREMENT_QUANTITY');pass('Cross-buyer and fractional packaging denied');
 const edits=await Promise.all([recurring.updateCycleInputs(buyer,contractId,first,payload,'rec-edit-'+tag),recurring.updateCycleInputs(buyer,contractId,first,payload,'rec-edit-'+tag)]);
 assert.equal(edits.filter(result=>result.is_replay).length,1);assert.equal(edits[0].revision,1);pass('Concurrent same intent applies one immutable cycle revision');
 await deny(()=>recurring.updateCycleInputs(buyer,contractId,first,{...payload,items:[{...payload.items[0],quantity:'4'}]},'rec-edit-'+tag),'IDEMPOTENCY_CONFLICT');
 await deny(()=>recurring.updateCycleInputs(buyer,contractId,first,payload,'rec-stale-'+tag),'CYCLE_REVISION_CONFLICT');pass('Changed intent and stale revisions denied');
 const unchanged=await recurring.updateCycleInputs(buyer,contractId,first,{...payload,expected_revision:1},'rec-nochange-'+tag);assert.equal(unchanged.revision,1);assert.equal(unchanged.unchanged,true);pass('Unchanged save records intent without a fabricated change notification');
 const failing=new ProcurementRecurringService(db,{enqueueEvent:async()=>{throw Error('outbox unavailable');}});
 await assert.rejects(()=>failing.updateCycleInputs(buyer,contractId,first,{...payload,expected_revision:1,items:[{...payload.items[0],quantity:'4'}]},'rec-rollback-'+tag),/outbox unavailable/);
 assert.equal((await recurring.cycleInputs(buyer,contractId,first)).revision,1);pass('Notification enqueue failure rolls back input revision');
 const [clusters]=await db.query('SELECT id FROM geographic_clusters WHERE is_active=1 ORDER BY id LIMIT 1');assert.ok(clusters.length);
 const [address]=await db.query("INSERT INTO buyer_delivery_addresses(user_id,cluster_id,society_area,full_address,geographic_match_status) VALUES (?,?,'Fixture','Owned fixture address','VERIFIED')",[other,clusters[0].id]);
 await deny(()=>recurring.updateCycleInputs(buyer,contractId,first,{...payload,expected_revision:1,delivery_preference:{mode:'EXPRESS',address_id:address.insertId}},'rec-address-'+tag),'CYCLE_ADDRESS_UNAVAILABLE');pass('Another buyer address cannot become recurring preference');
 const [ownedAddress]=await db.query("INSERT INTO buyer_delivery_addresses(user_id,cluster_id,society_area,full_address,geographic_match_status) VALUES (?,?,'Fixture','Own verified destination','VERIFIED')",[buyer,clusters[0].id]);
 const otherInputs=await recurring.cycleInputs(buyer,contractId,second);
 const preferenceEdit=await recurring.updateCycleInputs(buyer,contractId,second,{expected_revision:0,items:otherInputs.items.map(item=>({template_item_id:item.template_item_id,quantity:item.quantity})),delivery_preference:{mode:'EXPRESS',address_id:ownedAddress.insertId}},'rec-own-address-'+tag);
 assert.equal(preferenceEdit.delivery_preference.address_id,ownedAddress.insertId);assert.ok(Number.isSafeInteger(preferenceEdit.delivery_preference.address_revision));assert.equal(preferenceEdit.delivery_requires_fresh_quote,true);pass('Own verified preference stores server address revision without approving fee');
 await db.query('UPDATE procurement_recurring_cycles SET due_at_utc=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR) WHERE id IN (?,?)',[second,third]);
 await db.query('UPDATE procurement_recurring_cycles SET due_at_utc=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 3 DAY) WHERE id=?',[first]);
 // Scope background candidate discovery to this test's own contract; actual SQL/locks/outbox remain real.
 const scoped={getConnection:()=>db.getConnection(),query:(sql,params)=>db.query(sql.replace("WHERE cy.status='SCHEDULED'","WHERE cy.contract_id="+Number(contractId)+" AND cy.status='SCHEDULED'"),params)};
 const worker=new ProcurementRecurringService(scoped);
 const failingReminders=new ProcurementRecurringService(scoped,{enqueueEvent:async()=>{throw Error('outbox unavailable');}});
 assert.equal((await failingReminders.runReminderBatch()).failed,2);
 const [[reminderEvents]]=await db.query("SELECT COUNT(*) total FROM procurement_recurring_cycle_events WHERE cycle_id IN (?,?) AND event_key='UPCOMING_24H'",[second,third]);assert.equal(Number(reminderEvents.total),0);pass('Reminder enqueue failure rolls back durable reminder identity for retry');
 await db.query('UPDATE users SET is_verified=0 WHERE id=?',[buyer]);
 assert.equal((await worker.runReminderBatch({limit:1})).checked,0);
 await db.query('UPDATE users SET is_verified=1 WHERE id=?',[buyer]);pass('Ineligible buyers excluded before bounded reminder selection');
 const reminders=await Promise.all([worker.runReminderBatch(),worker.runReminderBatch()]);assert.equal(reminders.reduce((n,r)=>n+r.enqueued,0),2);pass('Concurrent cutoff workers enqueue once per owned cycle');
 // Real InnoDB lifecycle locks with an explicitly mocked transport. A pause or
 // skip cannot finish and then be followed by dispatch from an earlier check.
 const emailDb={getConnection:()=>db.getConnection(),query:(sql,args)=>db.query(/(?:FROM|UPDATE) transactional_email_outbox/.test(sql)?sql.replace(/\bWHERE\b/,'WHERE recipient_user_id='+Number(buyer)+' AND'):sql,args)};
 const emailModule={exports:{}};
 new Function('require','module','exports','process',require('node:fs').readFileSync(require('node:path').resolve(__dirname,'../src/services/emailService.js'),'utf8'))(name=>{
  if(name==='../config/db')return emailDb;if(name==='crypto')return crypto;
  if(name==='nodemailer')return {createTransport(){throw Error('Real transport forbidden');}};
  if(name==='./recurringReminderPolicy')return require('../src/services/recurringReminderPolicy');
  if(name==='./notificationDeliveryPolicy')return require('../src/services/notificationDeliveryPolicy');
  throw Error('Unexpected email dependency '+name);
 },emailModule,emailModule.exports,{env:{NODE_ENV:'test',TRANSACTIONAL_EMAIL_MODE:'mock',APP_FRONTEND_URL:'https://app.miljor.test'}});
 const email=emailModule.exports;let entered,releaseDispatch;
 const started=new Promise(resolve=>{entered=resolve;}),released=new Promise(resolve=>{releaseDispatch=resolve;});
 email.transporter={sendMail:async()=>{entered();await released;return {messageId:'fixture-only-no-provider'};}};
 await email.enqueueEmail(emailDb,{recipientEmail:'recurring-'+tag+'@example.invalid',recipientUserId:buyer,templateName:'platform_notification',payload:{title:'Upcoming cutoff',message:'Review cycle',reminderContext:{contractId,cycleId:third}},idempotencyKey:'recurring-lock-'+tag});
 const dispatch=email.processOutboxBatch();
 let timer;
 try{await Promise.race([started,dispatch.then(()=>{throw Error('Reminder dispatch did not reach controlled transport');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out waiting for controlled transport')),10000);})]);}
 finally{clearTimeout(timer);}
 let skipCompleted=false;
 const skipping=recurring.skipCycle(buyer,contractId,third).then(result=>{skipCompleted=true;return result;});
 let lockFailure;
 try{await new Promise(resolve=>setTimeout(resolve,100));assert.equal(skipCompleted,false,'Skip must wait for existing in-flight reminder dispatch');}catch(error){lockFailure=error;}finally{releaseDispatch();}
 const [dispatched]=await Promise.all([dispatch,skipping]);if(lockFailure)throw lockFailure;
 assert.equal(dispatched.succeeded,1);pass('Skip completion serialized with already in-flight mocked email dispatch');
 const paused=await recurring.changeStatus(buyer,contractId,'PAUSE',2,false);assert.equal(paused.version_number,3);
 assert.equal((await worker.runReminderBatch()).enqueued,0);pass('Paused cycles emit no active reminders');
 await db.query('UPDATE procurement_recurring_cycles SET due_at_utc=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?',[second]);
 await recurring.changeStatus(buyer,contractId,'RESUME',3,false);
 const cycles=await recurring.listCycles(buyer,contractId);assert.equal(cycles.find(c=>c.id===second).status,'SKIPPED');assert.equal(cycles.find(c=>c.id===second).failure_code,'PAUSED_CUTOFF_MISSED');assert.equal(Number(cycles.find(c=>c.id===first).contract_version),4);pass('Resume reconciles pending versions and records missed paused cutoff without catch-up');
 await db.query('UPDATE procurement_request_items SET quantity=9 WHERE request_id=?',[draft.request.id]);
 assert.equal((await recurring.cycleInputs(buyer,contractId,third)).items[0].quantity,'2.0000');pass('Scheduled item snapshot resists later template edits');
 await db.query('UPDATE procurement_recurring_cycles SET due_at_utc=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?',[first]);
 await deny(()=>recurring.updateCycleInputs(buyer,contractId,first,{...payload,expected_revision:1},'rec-late-'+tag),'CYCLE_CUTOFF_PASSED');
 const prepared=await Promise.all([recurring.prepareDueCycle(buyer,contractId,first),recurring.prepareDueCycle(buyer,contractId,first)]);assert.equal(prepared.filter(p=>p.is_replay).length,1);requestIds.push(prepared[0].request_id);
 assert.deepEqual(prepared[0].delivery_preference,prepared[1].delivery_preference);assert.equal(prepared[0].delivery_preference.mode,'PICKUP');
 const generated=await requests.getMine(buyer,prepared[0].request_id);assert.equal(generated.items[0].quantity,'3.0000');assert.equal(generated.status,'DRAFT');pass('Due preparation clones cycle revision once, not edited standing template');
 await deny(()=>recurring.skipCycle(buyer,contractId,first),'CYCLE_ALREADY_COMMITTED');
 await recurring.skipCycle(buyer,contractId,third);await recurring.skipCycle(buyer,contractId,third);
 await deny(()=>recurring.skipCycle(other,contractId,fourth),'CONTRACT_NOT_FOUND');pass('Skip is owner-only, replay-safe and cannot cancel generated draft');
 const [notices]=await db.query("SELECT id,recipient_id,event_type,event_key FROM procurement_notifications WHERE recipient_id=? AND event_type IN ('CYCLE_QUANTITY_MODIFIED','CYCLE_DELIVERY_PREFERENCE_UPDATED','CYCLE_DRAFT_READY','CYCLE_MISSED','CYCLE_CUTOFF_UPCOMING','CYCLE_SKIPPED','RECURRING_PAUSED','RECURRING_RESUMED')",[buyer]);
 for(const [type,expected] of [['CYCLE_QUANTITY_MODIFIED',1],['CYCLE_DELIVERY_PREFERENCE_UPDATED',1],['CYCLE_DRAFT_READY',1],['CYCLE_MISSED',1],['CYCLE_CUTOFF_UPCOMING',2],['CYCLE_SKIPPED',1],['RECURRING_PAUSED',1],['RECURRING_RESUMED',1]])assert.equal(notices.filter(n=>n.event_type===type).length,expected,type);
 pass('Real backend events target only owner and do not duplicate under replay');
 const reminderIds=notices.filter(n=>n.event_type==='CYCLE_CUTOFF_UPCOMING').map(n=>n.id);
 const projected=await require('../src/services/notificationService').processPending({limit:2,eventIds:reminderIds,emailService:{enqueueEmail:async()=>{throw Error('Stale reminder must not queue email');}}});
 assert.equal(projected.projected,0);assert.equal(projected.failed,2);
 const [suppressed]=await db.query("SELECT status,attempt_count,last_error_code FROM procurement_notifications WHERE id IN (?,?)",reminderIds);
 assert.ok(suppressed.every(n=>n.status==='FAILED'&&n.attempt_count===5&&n.last_error_code==='STALE_REMINDER_SUPPRESSED'));pass('Real projection suppresses skipped/missed reminders without fabricated delivery');
 await recurring.changeStatus(buyer,contractId,'PAUSE',4,false);await recurring.changeStatus(buyer,contractId,'RESUME',5,false);
 const [saved]=await db.query('SELECT status,generated_request_id FROM procurement_recurring_cycles WHERE id=?',[first]);assert.equal(saved[0].generated_request_id,prepared[0].request_id);assert.equal(saved[0].status,'AWAITING_BUYER_APPROVAL');
 const [[after]]=await db.query('SELECT (SELECT COUNT(*) FROM orders) orders,(SELECT COUNT(*) FROM payments) payments');assert.deepEqual(after,before);pass('Generated history preserved, zero orders/payments created');
 console.log('RECURRING_CYCLE_CONTROLS_MYSQL_PASS '+count+'/'+count);
}
main().catch(error=>{console.error(error.code||'RECURRING_CONTROLS_FAILED',error.stack||error.message);process.exitCode=1;}).finally(async()=>{
 try{
  assert.equal((await db.query('SELECT DATABASE() AS name'))[0][0].name,'miljor_test_db');
  if(contractId){await db.query('DELETE FROM procurement_recurring_cycle_events WHERE cycle_id IN (SELECT id FROM procurement_recurring_cycles WHERE contract_id=?)',[contractId]);await db.query('DELETE FROM procurement_recurring_cycles WHERE contract_id=?',[contractId]);await db.query('DELETE FROM procurement_recurring_contracts WHERE id=?',[contractId]);}
  for(const requestId of requestIds){await db.query('DELETE FROM procurement_request_mutations WHERE request_id=?',[requestId]);await db.query('DELETE FROM procurement_request_items WHERE request_id=?',[requestId]);await db.query('DELETE FROM procurement_requests WHERE id=?',[requestId]);}
  for(const userId of users){await db.query('DELETE FROM transactional_email_outbox WHERE recipient_user_id=?',[userId]);await db.query('DELETE FROM platform_notifications WHERE user_id=?',[userId]);await db.query('DELETE FROM procurement_notifications WHERE recipient_id=?',[userId]);await db.query('DELETE FROM buyer_delivery_addresses WHERE user_id=?',[userId]);await db.query('DELETE FROM users WHERE id=?',[userId]);}
 }catch(error){console.error('OWNED_FIXTURE_CLEANUP_FAILED',error.code||error.message);process.exitCode=1;}
 await db.end();
});
