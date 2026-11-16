'use strict';
process.env.NODE_ENV='test';
const assert=require('node:assert/strict');
const test=require('node:test');
const dbPath=require.resolve('../src/config/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{}};
const {NotificationService}=require('../src/services/notificationService');
const {eventProjection,eventTypes}=require('../src/services/notificationEventPolicy');
function fixture({type='PAYMENT_VERIFIED',optionalEmail=0,email='buyer@example.invalid',failEmail=false}={}){
  const pending=[{id:1,recipient_id:7,recipient_role:'BUYER',event_key:'event:one',event_type:type,
    payload:{schemaVersion:1,entityId:12},status:'PENDING',attempt_count:0}];
  const inbox=[],emails=[];
  let inboxSnapshot,emailSnapshot,statusSnapshot;
  const connection={
    async beginTransaction(){inboxSnapshot=inbox.length;emailSnapshot=emails.length;statusSnapshot={...pending[0]};},
    async commit(){},async rollback(){inbox.length=inboxSnapshot;emails.length=emailSnapshot;Object.assign(pending[0],statusSnapshot);},release(){},
    async query(sql,args=[]){
      if(sql.includes('SELECT * FROM procurement_notifications'))return [pending.filter(row=>row.status==='PENDING')];
      if(sql.includes('FROM users'))return [[{id:7,role:'BUYER',email}]];
      if(sql.includes('FROM notification_preferences'))return [[{locale:'ur',optional_email:optionalEmail}]];
      if(sql.includes('INSERT INTO platform_notifications')){inbox.push(args);return [{insertId:inbox.length}];}
      if(sql.includes('SAVEPOINT'))return [{affectedRows:0}];
      if(sql.includes('UPDATE procurement_notifications')){pending[0].status=sql.includes("status='FAILED'")?'FAILED':'SENT';pending[0].last_error_code=args[0];pending[0].attempt_count++;return [{affectedRows:1}];}
      throw Error('Unexpected SQL '+sql);
    }
  };
  const database={getConnection:async()=>connection,query:async(sql,args)=>{
    assert.ok(sql.includes("status='FAILED'"));pending[0].status='FAILED';pending[0].attempt_count++;return [{affectedRows:1}];
  }};
  const emailService={enqueueEmail:async(conn,input)=>{assert.equal(conn,connection);if(failEmail)throw Error('email queue failure');emails.push(input);}};
  return {service:new NotificationService(database),inbox,emails,pending,emailService};
}
test('all catalog events have English/Urdu safe projections and unique event names',()=>{
  assert.equal(new Set(eventTypes).size,eventTypes.length);
  for(const eventType of eventTypes){
    const english=eventProjection({eventType,entityId:12});
    const urdu=eventProjection({eventType,entityId:12,locale:'ur'});
    assert.notEqual(english.title,urdu.title);
    assert.match(urdu.title,/[\u0600-\u06ff]/);
    assert.match(english.deepLink,/^\/(procurement|orders|profile|pools|catalog)\?/);
    assert.equal(english.deepLink,urdu.deepLink);
    assert.equal(eventProjection({eventType,entityId:12,locale:'unsupported'}).locale,'en');
  }
});
test('mandatory payment ignores optional-email opt-out; projection does not assert provider delivery',async()=>{
  const state=fixture();
  assert.deepEqual(await state.service.processPending({limit:1,emailService:state.emailService}),{processed:1,projected:1,failed:0});
  assert.equal(state.inbox.length,1);assert.equal(state.emails.length,1);
  assert.equal(state.emails[0].payload.locale,'ur');
  assert.equal(state.pending[0].status,'SENT');
  assert.equal(state.emails[0].templateName,'platform_notification');
  assert.match(state.emails[0].idempotencyKey,/^notice:[a-f0-9]{64}$/);
});
test('optional email preferences suppress nonfinancial email without hiding inbox',async()=>{
  const state=fixture({type:'QUOTE_RECEIVED'});
  await state.service.processPending({limit:1,emailService:state.emailService});
  assert.equal(state.inbox.length,1);assert.equal(state.emails.length,0);
});
test('missing email preserves inbox with visible channel failure code',async()=>{
  const state=fixture({email:null});
  await state.service.processPending({limit:1,emailService:state.emailService});
  assert.equal(state.inbox.length,1);assert.equal(state.emails.length,0);
  assert.equal(state.pending[0].last_error_code,'EMAIL_DESTINATION_UNAVAILABLE');
});
test('email queue failure preserves independent inbox and records bounded retry',async()=>{
  const state=fixture({failEmail:true});
  const result=await state.service.processPending({limit:1,emailService:state.emailService});
  assert.equal(result.failed,1);assert.equal(state.inbox.length,1);assert.equal(state.emails.length,0);
  assert.equal(state.pending[0].status,'FAILED');assert.equal(state.pending[0].attempt_count,1);
});
