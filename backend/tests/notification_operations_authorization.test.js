'use strict';
// Isolated production modules with injected SQL/router adapters; no DB, env files,
// provider transports, server, or scheduler are imported.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
function load(file,deps){
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{
    module,require(name){if(Object.hasOwn(deps,name))return deps[name];throw Error('Unexpected import '+name);},
    process:{env:{}},console:{error(){},log(){}},Date
  },{filename:file});return module.exports;
}
const actor={id:5,role:'SUPPORT_ADMIN'};
const reason=' Delivery recovery reviewed ';
function harness(options={}){
  const state={admin:{id:5,role:'SUPPORT_ADMIN',verification_status:'VERIFIED',buyer_trust_status:'CONTACT_VERIFIED',...options.admin},
    notice:{id:31,recipient_id:19,event_key:'persisted-event',status:'FAILED',attempt_count:5,...options.notice},
    email:options.noEmail?null:{id:43,recipient_user_id:19,status:'FAILED',attempt_count:3,claim_active:0,claim_token:null,claim_expires_at:null,...options.email},audits:[]};
  const calls=[];let snapshot;let gets=0;
  const connection={
    async beginTransaction(){calls.push({sql:'BEGIN'});snapshot=structuredClone(state);},
    async commit(){calls.push({sql:'COMMIT'});},
    async rollback(){calls.push({sql:'ROLLBACK'});Object.assign(state,snapshot);},release(){calls.push({sql:'RELEASE'});},
    async query(sql,args=[]){
      calls.push({sql,args:Array.from(args)});
      if(sql.includes('FROM users'))return [options.noAdmin?[]:[{...state.admin}]];
      if(sql.includes('FROM procurement_notifications'))return [options.noNotice?[]:[{...state.notice}]];
      if(sql.includes('FROM transactional_email_outbox'))return [state.email?[{...state.email}]:[]];
      if(sql.includes('INSERT INTO notification_admin_events')){
        if(options.failAudit)throw Error('audit unavailable');
        state.audits.push({sql,args:Array.from(args)});return [{insertId:71,affectedRows:1}];
      }
      if(sql.includes('UPDATE transactional_email_outbox')){
        if(options.failEmail)throw Error('email mutation failed');
        if(options.zeroEmail)return [{affectedRows:0}];
        state.email.status='QUEUED';state.email.attempt_count=0;state.email.claim_token=null;state.email.claim_expires_at=null;return [{affectedRows:1}];
      }
      if(sql.includes('UPDATE procurement_notifications')){
        if(options.failEvent)throw Error('event mutation failed');
        if(options.zeroEvent)return [{affectedRows:0}];
        state.notice.status='PENDING';state.notice.attempt_count=0;return [{affectedRows:1}];
      }
      throw Error('Unexpected SQL '+sql);
    }
  };
  const database={async getConnection(){gets++;return connection;},query:connection.query};
  const {NotificationOperationsService}=load('services/notificationOperationsService.js',{'../config/db':{},'node:crypto':crypto});
  return {service:new NotificationOperationsService(database),state,calls,connection,database,get gets(){return gets;}};
}
const invoke=(h,channel,extra={})=>h.service[channel==='EVENT'?'retryNotice':'retryEmail']({actor,id:channel==='EVENT'?31:43,reason,...extra});
const writes=h=>h.calls.filter(call=>/^\s*(UPDATE|INSERT)/.test(call.sql));
function rolledBack(h){assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));assert.equal(h.state.audits.length,0);assert.equal(h.calls.at(-1).sql,'RELEASE');}
for(const channel of ['EVENT','EMAIL']){
  test(channel+' retry persists audited reset on its transaction',async()=>{
    const h=harness();const result=await invoke(h,channel);
    assert.equal(result.status,channel==='EVENT'?'PENDING':'QUEUED');assert.equal(h.state.audits.length,1);
    assert.deepEqual(h.state.audits[0].args,channel==='EVENT'?[5,31,5,3,reason.trim()]:[5,43,3,reason.trim()]);
    assert.ok(h.state.audits[0].sql.includes(channel==='EVENT'?"'RETRY'":"'EMAIL_RETRY'"));
    assert.equal(h.state.email.status,'QUEUED');assert.equal(h.state.email.attempt_count,0);
    assert.equal(h.calls.at(-2).sql,'COMMIT');assert.equal(h.calls.at(-1).sql,'RELEASE');
    assert.ok(h.calls.find(c=>c.sql.includes('FROM users')).sql.includes('FOR UPDATE'),'live retry authorization is locked through commit');
  });
  for(const role of ['BUYER','SUPPLIER','FINANCE_ADMIN','OPERATIONS_ADMIN','VERIFICATION_ADMIN'])test(channel+' rejects persisted '+role+' despite claimed admin role',async()=>{
    const h=harness({admin:{role}});await assert.rejects(invoke(h,channel,{actor:{id:5,role:'SUPER_ADMIN'}}),e=>e.statusCode===403);
    assert.equal(writes(h).length,0);rolledBack(h);
  });
  for(const account of [{verification_status:'BLOCKED'},{buyer_trust_status:'SUSPENDED'}])test(channel+' rejects inactive persisted operator '+Object.keys(account)[0],async()=>{
    const h=harness({admin:account});await assert.rejects(invoke(h,channel),e=>e.statusCode===403);assert.equal(writes(h).length,0);rolledBack(h);
  });
  for(const invalidReason of [undefined,null,'','short','          ','x'.repeat(501)])test(channel+' rejects invalid recovery reason '+String(invalidReason).slice(0,12),async()=>{
    const h=harness();await assert.rejects(invoke(h,channel,{reason:invalidReason}),e=>e.statusCode===400);assert.equal(h.gets,0);assert.equal(writes(h).length,0);
  });
  for(const invalidId of [0,-1,'abc',1.5,Number.MAX_SAFE_INTEGER+1])test(channel+' rejects invalid event ID '+invalidId,async()=>{
    const h=harness();await assert.rejects(invoke(h,channel,{id:invalidId}),e=>e.statusCode===400);assert.equal(h.gets,0);
  });
  test(channel+' audit failure prevents reset',async()=>{
    const h=harness({failAudit:true});await assert.rejects(invoke(h,channel),/audit unavailable/);assert.equal(h.state.email.status,'FAILED');assert.equal(h.state.notice.status,'FAILED');rolledBack(h);
  });
  test(channel+' reset failure rolls audit back',async()=>{
    const h=harness(channel==='EVENT'?{failEvent:true}:{failEmail:true});await assert.rejects(invoke(h,channel),/mutation failed/);assert.equal(h.state.email.status,'FAILED');assert.equal(h.state.notice.status,'FAILED');rolledBack(h);
  });
  test(channel+' missing target rolls back with 404',async()=>{
    const h=harness(channel==='EVENT'?{noNotice:true}:{noEmail:true});await assert.rejects(invoke(h,channel),e=>e.statusCode===404);assert.equal(writes(h).length,0);rolledBack(h);
  });
}
for(const status of ['SENT','PENDING','SUPPRESSED'])test('EVENT refuses '+status+' projection',async()=>{
  const h=harness({notice:{status}});await assert.rejects(invoke(h,'EVENT'),e=>e.statusCode===409);assert.equal(writes(h).length,0);rolledBack(h);
});
for(const channel of ['EVENT','EMAIL'])for(const status of ['SENT','QUEUED','SENDING','PROVIDER_ACCEPTED','DELIVERED_WHEN_CONFIRMED'])test(channel+' refuses '+status+' email without altering delivery',async()=>{
  const h=harness({email:{status}});await assert.rejects(invoke(h,channel),e=>e.statusCode===409);assert.equal(writes(h).length,0);assert.equal(h.state.email.status,status);rolledBack(h);
});
test('EVENT retry binds linked email to persisted recipient and event key',async()=>{
  const h=harness();await invoke(h,'EVENT',{recipientId:999,eventKey:'forged',emailId:999});
  const key='notice:'+crypto.createHash('sha256').update('19:persisted-event').digest('hex');
  assert.deepEqual(h.calls.find(c=>c.sql.includes('idempotency_key=?')).args,[key]);
});
test('EVENT refuses mismatched linked email ownership before audit',async()=>{
  const h=harness({email:{recipient_user_id:88}});await assert.rejects(invoke(h,'EVENT'),e=>e.statusCode===409);assert.equal(writes(h).length,0);rolledBack(h);
});
test('EVENT retry with no existing email resets only the projection',async()=>{
  const h=harness({noEmail:true});await invoke(h,'EVENT');assert.equal(h.state.notice.status,'PENDING');assert.equal(h.state.audits[0].args[3],null);assert.ok(!writes(h).some(c=>c.sql.includes('UPDATE transactional_email_outbox')));
});
for(const channel of ['EVENT','EMAIL'])test(channel+' rejects a failed email with a live delivery claim',async()=>{
  const h=harness({email:{claim_active:1,claim_token:'live-claim'}});await assert.rejects(invoke(h,channel),e=>e.statusCode===409);assert.equal(writes(h).length,0);rolledBack(h);
});
function routeHarness(overrides={}){
  const routes=[],middleware=[],calls=[];
  const router={use(fn){middleware.push(fn);}};
  for(const verb of ['get','post','put','patch'])router[verb]=(url,handler)=>routes.push({verb,url,handler});
  const protect=()=>{};
  const ops={health:async args=>{calls.push(['health',args]);return {};},retryNotice:async args=>{calls.push(['EVENT',args]);return {status:'PENDING'};},retryEmail:async args=>{calls.push(['EMAIL',args]);return {status:'QUEUED'};},...overrides.ops};
  const notifications={markAsRead:async(...args)=>{calls.push(['read',args]);return false;},listUserNotifications:async(...args)=>{calls.push(['list',args]);return [];},getUnreadCount:async(...args)=>{calls.push(['count',args]);return 0;},markAllAsRead:async(...args)=>{calls.push(['all',args]);return 0;},getPreferences:async(...args)=>{calls.push(['preferences',args]);return {};},...overrides.notifications};
  load('routes/v1/notificationRoutes.js',{express:{Router:()=>router},'../../services/notificationService':notifications,'../../services/notificationOperationsService':ops,'../../middlewares/authGuard':{protect}});
  return {routes,middleware,protect,calls,handler(verb,url){return routes.find(r=>r.verb===verb&&r.url===url).handler;}};
}
const response=()=>({statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}});
for(const [url,method] of [['/operations/:id/retry','retryNotice'],['/operations/email/:id/retry','retryEmail']]){
  test(url+' forwards authenticated actor and route ID, ignores body ownership',async()=>{
    const h=routeHarness(),res=response();await h.handler('post',url)({user:actor,params:{id:'31'},body:{reason,userId:999,actor:{id:999},id:999}},res);
    assert.equal(res.statusCode,200);assert.equal(h.calls[0][1].actor,actor);assert.equal(h.calls[0][1].id,'31');assert.deepEqual(Object.keys(h.calls[0][1]).sort(),['actor','id','reason']);assert.equal(h.middleware[0],h.protect);
  });
  test(url+' missing body reaches reason validation with 400',async()=>{
    const h=routeHarness({ops:{[method]:async args=>{assert.equal(args.reason,undefined);throw Object.assign(Error('Recovery reason required'),{statusCode:400});}}}),res=response();
    await h.handler('post',url)({user:actor,params:{id:'31'}},res);assert.equal(res.statusCode,400);
  });
  test(url+' preserves authorization rejection and sanitizes unexpected errors',async()=>{
    for(const error of [Object.assign(Error('Access denied'),{statusCode:403}),Error('private provider credential')]){
      const h=routeHarness({ops:{[method]:async()=>{throw error;}}}),res=response();await h.handler('post',url)({user:actor,params:{id:'31'},body:{reason}},res);
      assert.equal(res.statusCode,error.statusCode||500);assert.ok(!JSON.stringify(res.body).includes('private provider credential'));
    }
  });
}
test('read API retains authenticated ownership for another user notice',async()=>{
  const h=routeHarness(),res=response();await h.handler('patch','/:id/read')({user:{id:19},params:{id:'88'},body:{userId:88}},res);
  assert.deepEqual(h.calls[0],['read',[19,88]]);assert.equal(res.body.data.updated,false);
});
const policy=load('services/notificationDeliveryPolicy.js',{});
test('delivery policy cannot mute, expire, digest or defer mandatory events',()=>{
  const now=new Date('2026-11-17T20:00:00Z');const plan=policy.deliveryPlan({projection:{mandatory:true,routine:true,transient:true,email:true},preference:{optional_email:false,muted_info:true,quiet_start:'22:00',quiet_end:'08:00',timezone_offset_minutes:300},now,occurredAt:new Date('2020-01-01'),digestEnabled:true});
  assert.equal(plan.sendEmail,true);assert.equal(plan.stale,false);assert.equal(plan.muted,false);assert.equal(plan.digest,false);assert.equal(plan.notBefore,null);assert.equal(plan.visibleUntil,null);
});
test('delivery policy stale routine events cannot enter an email digest',()=>{
  const plan=policy.deliveryPlan({projection:{routine:true,email:true},preference:{optional_email:true},now:new Date('2026-11-17T20:00:00Z'),occurredAt:new Date('2020-01-01'),digestEnabled:true});
  assert.equal(plan.stale,true);assert.equal(plan.sendEmail,false);assert.equal(plan.digest,false);
});
test('quiet window end is exclusive and offset/day rollover is preserved',()=>{
  const preference={quiet_start:'22:00',quiet_end:'08:00',timezone_offset_minutes:300};
  assert.equal(policy.quietUntil(preference,new Date('2026-11-17T18:00:00Z')).toISOString(),'2026-11-18T03:00:00.000Z');
  assert.equal(policy.quietUntil(preference,new Date('2026-11-18T03:00:00Z')),null);
});
test('preference input cannot set another recipient owner',()=>{
  assert.throws(()=>policy.validatePreferences({locale:'en',optional_email:true,optional_sms:false,user_id:88}),e=>e.statusCode===400);
});
for(const channel of ['EVENT','EMAIL'])for(const role of ['ADMIN','SUPER_ADMIN','SUPPORT_ADMIN'])test(channel+' permits live '+role+' without trusting stale caller role',async()=>{
  const h=harness({admin:{role}});await invoke(h,channel,{actor:{id:5,role:'BUYER'}});assert.equal(h.state.audits.length,1);assert.equal(h.state.audits[0].args[0],5);
  const authorization=h.calls.find(c=>c.sql.includes('FROM users'));
  assert.ok(authorization.sql.includes('verification_status'));assert.ok(authorization.sql.includes('buyer_trust_status'));
  const email=h.calls.find(c=>c.sql.includes('FROM transactional_email_outbox'));
  assert.ok(email.sql.includes('claim_expires_at>NOW()'));assert.ok(email.sql.includes('FOR UPDATE'));
  if(channel==='EVENT')assert.ok(email.sql.includes('recipient_user_id'));
});
for(const channel of ['EVENT','EMAIL'])test(channel+' missing persisted operator never reaches target reads',async()=>{
  const h=harness({noAdmin:true});await assert.rejects(invoke(h,channel),e=>e.statusCode===403);assert.equal(writes(h).length,0);
  assert.ok(!h.calls.some(c=>c.sql.includes('FROM procurement_notifications')||c.sql.includes('FROM transactional_email_outbox')));rolledBack(h);
});
for(const role of ['BUYER','SUPPLIER','OPERATIONS_ADMIN'])test('health rejects '+role+' before reading queue data',async()=>{
  const h=harness({admin:{role}});await assert.rejects(h.service.health({actor:{id:5,role:'ADMIN'}}),e=>e.statusCode===403);
  assert.equal(h.calls.length,1);assert.ok(h.calls[0].sql.includes('FROM users'));
});
test('health maps aggregate counts and suppresses raw email failure details',async()=>{
  const h=harness();h.database.query=async(sql)=>{
    if(sql.includes('FROM users'))return [[h.state.admin]];
    if(sql.includes('SUM(status=\'PENDING\')'))return [[{pending:'2',failed:'1',deadLetter:null,suppressed:'4'}]];
    if(sql.includes('SUM(status=\'QUEUED\')'))return [[{queued:'3',sending:'1',failed:'2',terminalFailed:'1'}]];
    if(sql.includes('FROM procurement_notifications'))return [[{id:31,event_type:'IDENTITY.REGISTERED',status:'FAILED',attempt_count:5,last_error_code:'EMAIL_QUEUE_FAILED',created_at:'timestamp',payload_json:'private secret'}]];
    if(sql.includes('FROM transactional_email_outbox'))return [[{id:43,template_name:'platform_notification',status:'FAILED',attempt_count:3,last_error:'Provider rejected owner@example.test: private secret',created_at:'timestamp',recipient_email:'private@example.test'}]];
    throw Error('Unexpected health SQL');
  };
  const result=await h.service.health({actor});assert.equal(result.projection.pending,2);assert.equal(result.projection.deadLetter,0);assert.equal(result.email.queued,3);
  assert.equal(result.failures[1].lastErrorCode,'EMAIL_DELIVERY_FAILED');assert.ok(!/private|example.test|payload_json|recipient_email/.test(JSON.stringify(result)));
});
test('health route delegates only authenticated actor and denies unauthorized access',async()=>{
  const h=routeHarness({ops:{health:async args=>{assert.equal(args.actor,actor);assert.deepEqual(Object.keys(args),['actor']);throw Object.assign(Error('Access denied'),{statusCode:403});}}}),res=response();
  await h.handler('get','/operations')({user:actor,query:{userId:999,actor:{id:999}}},res);assert.equal(res.statusCode,403);
});
test('listing, unread counts, mark-all and preferences retain authenticated ownership',async()=>{
  const h=routeHarness();const req={user:{id:19},query:{userId:88},body:{userId:88},params:{}};
  await h.handler('get','/')(req,response());await h.handler('get','/unread-count')(req,response());
  await h.handler('patch','/mark-all-read')(req,response());await h.handler('get','/preferences')(req,response());
  for(const call of h.calls)assert.equal(call[1][0],19);
});
test('simultaneous EVENT retries produce one audited reset',async()=>{
  let holder=null;const waiters=[],transactions=[],audits=[];
  const notice={id:31,recipient_id:19,event_key:'persisted-event',status:'FAILED',attempt_count:5};
  const unlock=tx=>{if(holder===tx){holder=null;const next=waiters.shift();if(next)next();}};
  const database={async query(){throw Error('GLOBAL_POOL_FORBIDDEN');},async getConnection(){
    const tx={async beginTransaction(){},async query(sql,args){
      if(sql.includes('FROM users')){
        assert.ok(sql.includes('FOR UPDATE'));if(holder)await new Promise(resolve=>waiters.push(resolve));holder=this;
        return [[{role:'SUPPORT_ADMIN',verification_status:'VERIFIED'}]];
      }
      assert.equal(holder,this);
      if(sql.includes('FROM procurement_notifications'))return [[{...notice}]];
      if(sql.includes('FROM transactional_email_outbox'))return [[]];
      if(sql.includes('INSERT INTO notification_admin_events')){audits.push(Array.from(args));return [{affectedRows:1}];}
      if(sql.includes('UPDATE procurement_notifications')){notice.status='PENDING';notice.attempt_count=0;return [{affectedRows:1}];}
      throw Error('Unexpected retry SQL');
    },async commit(){this.committed=true;unlock(this);},async rollback(){this.rolledBack=true;unlock(this);},release(){this.released=true;}};
    transactions.push(tx);return tx;
  }};
  const {NotificationOperationsService}=load('services/notificationOperationsService.js',{'../config/db':{},'node:crypto':crypto});
  const service=new NotificationOperationsService(database);
  const results=await Promise.allSettled([service.retryNotice({actor,id:31,reason}),service.retryNotice({actor,id:31,reason})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409);
  assert.equal(audits.length,1);assert.equal(notice.status,'PENDING');assert.equal(transactions.filter(tx=>tx.committed).length,1);
  assert.ok(transactions.every(tx=>tx.released));assert.equal(holder,null);
});
const eventPolicy=require('../src/services/notificationEventPolicy');
function alertHarness(options={}){
  const calls=[],alerts=[];const existing=new Set(options.existing||[]);
  const emails=options.emails||[],events=options.events||[];
  const database={async query(sql,args){
    calls.push({sql,args:Array.from(args)});
    const isEmail=sql.includes('FROM transactional_email_outbox');
    const prefix=isEmail?'notice-failure:email-':'notice-failure:';
    const code=isEmail?'EMAIL_DELIVERY_EXHAUSTED':'EVENT_DELIVERY_EXHAUSTED';
    const limit=args.at(-1);
    let rows=(isEmail?emails:events).filter(row=>row.status==='FAILED'&&row.attempt_count>=(isEmail?3:5));
    if(isEmail)rows=rows.filter(row=>row.template_name==='UCP_NOTIFICATION'||row.mandatory===true);
    else if(sql.includes('event_type IN'))rows=rows.filter(row=>args.slice(0,-1).includes(row.event_type));
    if(sql.includes('NOT EXISTS'))rows=rows.filter(row=>isEmail?!existing.has(prefix+row.id+':'+code):![...existing].some(key=>key.startsWith(prefix+row.id+':')));
    rows.sort((a,b)=>/ORDER BY (?:\w+\.)?id ASC/.test(sql)?a.id-b.id:b.id-a.id);
    return [rows.slice(0,limit).map(row=>({id:row.id,event_type:row.event_type}))];
  }};
  const notificationService={async alertDeliveryFailure(connection,id,code){
    assert.equal(connection,database);assert.ok(['EMAIL_DELIVERY_EXHAUSTED','EVENT_DELIVERY_EXHAUSTED'].includes(code));
    assert.ok(/^(email-)?[1-9]\d*$/.test(String(id)));
    if(options.failAlert)throw Error('alert persistence failed');
    alerts.push({id,code});existing.add('notice-failure:'+id+':'+code);
  }};
  const {NotificationOperationsService}=load('services/notificationOperationsService.js',{'../config/db':{},'node:crypto':crypto,
    './notificationService':notificationService,'./notificationEventPolicy':eventPolicy});
  return {service:new NotificationOperationsService(database),calls,alerts,existing};
}
test('email alert scan skips alerted latest rows and reaches oldest unalerted failure',async()=>{
  const h=alertHarness({emails:[{id:1,status:'FAILED',attempt_count:3,mandatory:true},{id:2,status:'FAILED',attempt_count:3,mandatory:true}],
    existing:['notice-failure:email-2:EMAIL_DELIVERY_EXHAUSTED']});
  assert.equal((await h.service.alertExhaustedEmails({limit:1})).checked,1);
  assert.deepEqual(h.alerts,[{id:'email-1',code:'EMAIL_DELIVERY_EXHAUSTED'}]);
  assert.equal((await h.service.alertExhaustedEmails({limit:1})).checked,0);
  assert.equal(h.alerts.length,1);assert.ok(h.calls[0].sql.includes("event_type='NOTIFICATION_DELIVERY_EXCEPTION'"));
});
test('terminal event alert scan filters mandatory policy before its bounded limit',async()=>{
  const events=Array.from({length:30},(_,i)=>({id:i+1,status:'FAILED',attempt_count:5,event_type:'REQUEST_CREATED'}));
  events.push({id:31,status:'FAILED',attempt_count:5,event_type:'PAYMENT_VERIFIED'},
    {id:32,status:'FAILED',attempt_count:5,event_type:'IDENTITY.SECURITY_ALERT'},
    {id:33,status:'FAILED',attempt_count:4,event_type:'PAYMENT_FAILED'},
    {id:34,status:'SENT',attempt_count:5,event_type:'PAYMENT_FAILED'});
  const h=alertHarness({events,existing:['notice-failure:32:EMAIL_QUEUE_FAILED']});
  assert.equal((await h.service.alertExhaustedEvents({limit:1})).checked,1);
  assert.deepEqual(h.alerts,[{id:31,code:'EVENT_DELIVERY_EXHAUSTED'}]);
  assert.equal((await h.service.alertExhaustedEvents({limit:1})).checked,0);
  const types=h.calls[0].args.slice(0,-1);assert.ok(types.length>0);assert.ok(types.every(eventPolicy.mandatory));
  assert.ok(h.calls[0].sql.includes('NOT EXISTS'));assert.ok(h.calls[0].sql.includes("event_type='NOTIFICATION_DELIVERY_EXCEPTION'"));
});
for(const method of ['alertExhaustedEmails','alertExhaustedEvents']){
  test(method+' advances fairly across bounded batches without repeating persisted alerts',async()=>{
    const rows=Array.from({length:5},(_,i)=>({id:i+1,status:'FAILED',attempt_count:5,mandatory:true,event_type:'PAYMENT_FAILED'}));
    const h=alertHarness({emails:rows,events:rows});
    assert.equal((await h.service[method]({limit:2})).checked,2);
    assert.equal((await h.service[method]({limit:2})).checked,2);
    assert.equal((await h.service[method]({limit:2})).checked,1);
    assert.equal((await h.service[method]({limit:2})).checked,0);
    assert.deepEqual(h.alerts.map(a=>String(a.id).replace('email-','')),['1','2','3','4','5']);
    assert.ok(h.calls.every(call=>call.args.at(-1)===2));
  });
  for(const limit of [0,-1,101,1.5,'20'])test(method+' rejects invalid batch '+limit+' before SQL',async()=>{
    const h=alertHarness();await assert.rejects(h.service[method]({limit}),e=>e.statusCode===400);assert.equal(h.calls.length,0);
  });
  test(method+' propagates persistence failure rather than claiming an alert',async()=>{
    const row={id:1,status:'FAILED',attempt_count:5,mandatory:true,event_type:'PAYMENT_FAILED'};
    const h=alertHarness({emails:[row],events:[row],failAlert:true});await assert.rejects(h.service[method]({limit:1}),/alert persistence failed/);assert.equal(h.alerts.length,0);assert.equal(h.existing.size,0);
  });
}
