'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path');
const dbPath=require.resolve('../src/config/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{}};
const {NotificationService}=require('../src/services/notificationService');
test('poison digest becomes a visible failure without blocking a different recipient',async()=>{
 const statuses=new Map(),queued=[];let snapshot;
 const conn={async beginTransaction(){},async commit(){},async rollback(){throw Error('Whole batch rollback forbidden');},release(){},
  async query(sql,args=[]){
   if(sql.startsWith('SELECT id,recipient_id'))return [[{id:1,recipient_id:7},{id:2,recipient_id:8}]];
   if(sql.startsWith('SAVEPOINT')){snapshot=queued.length;return [{}];}
   if(sql.startsWith('ROLLBACK TO')){queued.length=snapshot;return [{}];}
   if(sql.startsWith('RELEASE SAVEPOINT'))return [{}];
   if(sql.includes('FROM notification_preferences'))return [[{locale:'en',optional_email:1}]];
   if(sql.includes('FROM users'))return [[{id:args[0],email:args[0]===7?'invalid':'valid@example.invalid',db_now:new Date()}]];
   if(sql.startsWith('UPDATE transactional_email_outbox'))return [{}];
   if(sql.startsWith('UPDATE notification_digest_events')){
    const failed=sql.includes("status='FAILED'");statuses.set(failed?args[0][0]:args[2][0],failed?'FAILED':args[0]);return [{}];
   }
   throw Error('Unexpected digest SQL '+sql);
  }};
 const service=new NotificationService({getConnection:async()=>conn});
 service.reserveOptionalEmailSlot=async(c,u,date)=>date;
 const result=await service.processDigests({emailService:{enqueueEmail:async(c,input)=>{
  if(input.recipientUserId===7)throw Error('Invalid recipient');queued.push(input);return {outbox_id:10};}}});
 assert.deepEqual(result,{queued:1,suppressed:0,failed:1});
 assert.equal(statuses.get(1),'FAILED');assert.equal(statuses.get(2),'QUEUED');assert.equal(queued.length,1);
});
test('optional digest and projection exceptions cannot stop mandatory outbox dispatch',async()=>{
 const tasks=[],calls=[],module={exports:{}};
 const dependencies={
  'node-cron':{schedule:(pattern,callback)=>{tasks.push({pattern,callback});return {stop(){}};}},
  './poolClosureService':{},
  './notificationService':{processPending:async()=>{throw Error('Projection failed');},processDigests:async()=>{throw Error('Digest failed');}},
  './notificationOperationsService':{alertExhaustedEvents:async()=>calls.push('event-alert'),alertExhaustedEmails:async()=>calls.push('email-alert')},
  './emailService':{processOutboxBatch:async()=>calls.push('email-worker')}
 };
 new Function('require','module','exports','process','console',fs.readFileSync(path.resolve(__dirname,'../src/services/schedulerService.js'),'utf8'))(
  name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];},module,module.exports,
  {env:{NOTIFICATION_WORKER_ENABLED:'true',NOTIFICATION_DIGEST_ENABLED:'true',NOTIFICATION_EMAIL_DELIVERY_ENABLED:'true'}},
  {log(){},error(){},warn(){}});
 module.exports.startScheduler();await tasks.find(task=>task.pattern==='* * * * *').callback();
 assert.deepEqual(calls,['event-alert','email-worker','email-alert']);module.exports.stopScheduler();
});
test('pool-wide recipients include confirmed and paid commitments and exclude terminal buyers',async()=>{
 const writer=require('../src/services/ucpTransactionalNotifications'),writes=[];
 const buyers=[{id:10,status:'RESERVED'},{id:11,status:'CONFIRMED'},{id:12,status:'PAID'},{id:13,status:'CANCELLED'},{id:14,status:'EXPIRED'}];
 const conn={query:async(sql,args)=>{
  if(sql.includes('FROM pools'))return [[{supplier_id:2}]];
  if(sql.includes('SELECT DISTINCT buyer_id')){
   assert.ok(sql.includes(require('../src/services/reservationDemandPolicy').SQL_ELIGIBLE_DEMAND_CONDITION));
   return [buyers.filter(b=>require('../src/services/reservationDemandPolicy').isDemandEligible(b.status)).map(b=>({buyer_id:b.id}))];
  }
  if(sql.includes('FROM users'))return [[{id:args[0],role:args[0]===2?'SUPPLIER':'BUYER'}]];
  if(sql.includes('INSERT INTO procurement_notifications')){writes.push(args[0]);return [{affectedRows:1}];}
  throw Error('Unexpected SQL '+sql);
 }};
 await writer.recordReservationEventOnConnection(conn,{event_type:'TARGET_REACHED',event_id:'target',pool_id:1});
 assert.deepEqual(writes,[2,10,11,12]);
});
