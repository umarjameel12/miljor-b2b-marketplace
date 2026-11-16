'use strict';
// Self-owned InnoDB fixtures. Empty Flash tables must never produce a skipped PASS.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
for(const [k,v] of Object.entries({NODE_ENV:'test',DB_NAME:'miljor_test_db',TEST_DB_NAME:'miljor_test_db'}))assert.equal(process.env[k],v,k);
const port=Number(process.env.DB_PORT||(process.env.GITHUB_ACTIONS==='true'?3306:0));
assert.ok([33319,33321].includes(port)||(process.env.GITHUB_ACTIONS==='true'&&port===3306),'Explicit disposable local/CI port required');
process.env.DB_PORT=String(port);assert.ok(['127.0.0.1','localhost'].includes(process.env.DB_HOST||'localhost'));
Object.assign(process.env,{ALLOW_EXTERNAL_MONEY_MOVEMENT:'false',TRANSACTIONAL_EMAIL_MODE:'mock',NOTIFICATION_DIGEST_ENABLED:'false',APP_FRONTEND_URL:'http://127.0.0.1:5173',SAFEPAY_WEBHOOK_SECRET:'phase-ab-owned-signing-key'});
const db=require('../src/config/db'),notices=require('../src/services/notificationService'),writer=require('../src/services/ucpTransactionalNotifications');
const {recordFlashTimerReminders,runFlashRecoveryBatch}=require('../src/services/ucpRecoveryService');
const {cleanupOwnedNotificationFixtures}=require('./cleanupOwnedNotificationFixtures');
const tag=crypto.randomBytes(5).toString('hex'),owned={users:[],products:[],offers:[],orders:[],holds:[],attempts:[],webhooks:[]};
let supplier,buyer,otherBuyer,stranger,product,epoch,seq=0,ready=false,groupIndex=0;const groups=[],parse=v=>typeof v==='string'?JSON.parse(v):v,code=()=>`AB${tag}${++seq}`;
const only=process.env.UCP_PHASE_AB_ONLY_GROUP?Number(process.env.UCP_PHASE_AB_ONLY_GROUP):0;
assert.ok(Number.isInteger(only)&&only>=0&&only<=10,'Invalid diagnostic group');
async function acquire(at=epoch){const c=await db.getConnection();try{const [[r]]=await c.query('SELECT DATABASE() db,@@port port');assert.equal(r.db,'miljor_test_db');assert.equal(r.port,port);await c.query("SET time_zone='+00:00'");await c.query('SET SESSION innodb_lock_wait_timeout=5');await c.query('SET timestamp=?',[at]);return c;}catch(e){c.release();throw e;}}
async function release(c){try{await c.query('SET timestamp=0');}finally{c.release();}}
async function tx(at,work){const c=await acquire(at);try{await c.beginTransaction();const r=await work(c);await c.commit();return r;}catch(e){await c.rollback();throw e;}finally{await release(c);}}
async function checked(name,work){const index=++groupIndex;if(only&&only!==index)return;await work();groups.push(name);console.log('PASS '+index+': '+name);}
async function offer({duration=14400,remaining=duration,status='ACTIVE'}={}){
 const [r]=await db.query(`INSERT INTO flash_pools(flash_code,supplier_id,product_id,total_stock,remaining_stock,discounted_unit_price,original_unit_price,clearance_reason,status,created_at,expiry_time,configured_duration_minutes,published_at) VALUES (?,?,?,1000,1000,100,120,'Owned timer fixture',?,FROM_UNIXTIME(?),FROM_UNIXTIME(?),?,FROM_UNIXTIME(?))`,[code(),supplier,product,status,epoch+remaining-duration,epoch+remaining,Math.ceil(duration/60),epoch+remaining-duration]);owned.offers.push(r.insertId);return r.insertId;
}
async function hold(id,{owner=buyer,duration=900,remaining=duration,status='HELD',attempt=null,paid=false,paymentStatus=null}={}){
 // Synthetic persisted states test guards; PAID seeds are not provider-payment evidence.
 const [o]=await db.query(`INSERT INTO orders(order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,total_amount,order_status,payment_status) VALUES (?,?,?,1,100,100,100,?,?)`,[code(),owner,supplier,paid?'PAID':'AWAITING_PAYMENT',paymentStatus||(paid?'PAID':'AWAITING_PAYMENT')]);owned.orders.push(o.insertId);
 const [h]=await db.query(`INSERT INTO flash_purchase_holds(flash_pool_id,buyer_id,quantity,locked_unit_price,status,expires_at,order_id,idempotency_key,created_at) VALUES (?,?,1,100,?,FROM_UNIXTIME(?),?,?,FROM_UNIXTIME(?))`,[id,owner,status,epoch+remaining,o.insertId,code(),epoch+remaining-duration]);owned.holds.push(h.insertId);
 if(['HELD','PAYMENT_PENDING','PAID'].includes(status))await db.query('UPDATE flash_pools SET remaining_stock=remaining_stock-1,held_stock=held_stock+?,committed_stock=committed_stock+? WHERE id=?',[status==='PAID'?0:1,status==='PAID'?1:0,id]);
 if(attempt){const [a]=await db.query(`INSERT INTO payment_attempts(attempt_code,order_id,buyer_id,amount,currency,status,idempotency_key,created_at) VALUES (?,?,?,100,'PKR',?,?,FROM_UNIXTIME(?))`,[code(),o.insertId,owner,attempt,code(),epoch-172800]);owned.attempts.push(a.insertId);}
 return {id:h.insertId,orderId:o.insertId};
}
async function audits(id){return (await db.query("SELECT new_value FROM system_audit_logs WHERE entity_name='flash_pools' AND entity_id=? AND action='FLASH_TIMER_REMINDER' ORDER BY id",[id]))[0].map(r=>parse(r.new_value));}
async function events(id){return (await db.query("SELECT recipient_id,event_key,event_type,payload FROM procurement_notifications WHERE recipient_id IN (?) AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId'))=? ORDER BY id",[owned.users,String(id)]))[0];}
async function main(){
 const c=await db.getConnection();try{const [[r]]=await c.query('SELECT DATABASE() db,@@port port,UNIX_TIMESTAMP(UTC_TIMESTAMP()) epoch');assert.equal(r.db,'miljor_test_db');assert.equal(r.port,port);epoch=Number(r.epoch);ready=true;}finally{c.release();}
 for(const role of ['SUPPLIER','BUYER','BUYER','BUYER']){const [u]=await db.query("INSERT INTO users(full_name,email,role,is_verified,verification_status) VALUES (?,?,?,1,'VERIFIED')",['Phase AB '+tag,code()+'@example.invalid',role]);owned.users.push(u.insertId);}
 [supplier,buyer,otherBuyer,stranger]=owned.users;const [p]=await db.query("INSERT INTO products(title,category,brand,variety,processing_type,grade,pack_size) VALUES (?,'test','fixture','fixture','fixture','fixture','1 kg')",['Owned phase AB '+tag]);product=p.insertId;owned.products.push(product);
 await checked('v2 SQL clock/persisted actor/replay/rollback and v1 projection compatibility',async()=>{
  const id=await offer(),transition=code(),event={type:'UCP.POOL_CLOSING',aggregateId:'flash-'+id,aggregateVersion:2,transitionId:transition,recipients:[{userId:buyer,role:'BUYER'}],title:'Fixture deadline',message:'Owned fixture',payload:{pool_id:id},actorId:buyer,actorRole:'BUYER',causationId:'cause-'+transition,correlationId:'flash-'+id};let key;
  const c=await acquire(epoch);try{await c.beginTransaction();key=(await writer.recordInAppOnConnection(c,event)).eventKey;const [[r]]=await c.query('SELECT payload FROM procurement_notifications WHERE recipient_id=? AND event_key=?',[buyer,key]);const m=parse(r.payload);assert.equal(m.schemaVersion,2);assert.equal(m.eventId,key);assert.equal(m.actorId,buyer);assert.equal(m.actorRole,'BUYER');assert.equal(m.aggregateVersion,2);assert.equal(m.occurredAt,new Date(epoch*1000).toISOString());await c.rollback();}finally{await c.rollback();await release(c);}
  assert.equal((await db.query('SELECT id FROM procurement_notifications WHERE recipient_id=? AND event_key=?',[buyer,key]))[0].length,0);
  await tx(epoch,c=>writer.recordInAppOnConnection(c,event));const [[first]]=await db.query('SELECT id,payload FROM procurement_notifications WHERE recipient_id=? AND event_key=?',[buyer,key]);
  await tx(epoch+1,c=>writer.recordInAppOnConnection(c,event));const [replay]=await db.query('SELECT id,payload FROM procurement_notifications WHERE recipient_id=? AND event_key=?',[buyer,key]);assert.equal(replay.length,1);assert.deepEqual(parse(replay[0].payload),parse(first.payload));
  await tx(epoch,async c=>{await assert.rejects(()=>writer.recordInAppOnConnection(c,{...event,transitionId:code(),actorRole:'SUPPLIER'}),/actor/i);await assert.rejects(()=>writer.recordInAppOnConnection(c,{...event,transitionId:code(),occurredAt:'2026-02-30T00:00:00Z'}),/occurrence/i);await assert.rejects(()=>writer.recordInAppOnConnection(c,{...event,transitionId:code(),aggregateVersion:-1}),/IDENTITY|aggregate/i);});
  assert.equal((await events(id)).length,1,'Rejected metadata must not commit source events');
  const legacyKey=code();await tx(epoch,c=>notices.enqueueEvent(c,{userId:buyer,role:'BUYER',eventType:'UCP.POOL_CLOSING',eventKey:legacyKey,entityId:id}));const [[legacy]]=await db.query('SELECT id,payload FROM procurement_notifications WHERE recipient_id=? AND event_key=?',[buyer,legacyKey]);assert.deepEqual(parse(legacy.payload),{entityId:id,schemaVersion:1});
  const result=await notices.processPending({limit:2,eventIds:[Number(first.id),Number(legacy.id)],clock:()=>new Date((epoch+5)*1000)});assert.equal(result.failed,0);assert.equal(result.projected,2);
 });
 await checked('24h/1h/15m exact SQL boundaries and replay notify only persisted owners',async()=>{
  const id=await offer({duration:90000});await hold(id,{status:'PAID',paid:true});
  const foreign=await offer();await hold(foreign,{owner:stranger,status:'PAID',paid:true});
  await db.query('UPDATE flash_pools SET version_number=7 WHERE id=?',[id]);
  const select='SELECT total_stock,remaining_stock,held_stock,committed_stock,expiry_time,version_number FROM flash_pools WHERE id=?',before=(await db.query(select,[id]))[0][0];
  assert.equal(await tx(epoch,c=>recordFlashTimerReminders(c,id)),0);for(const at of [epoch+3600,epoch+86400,epoch+89100]){assert.equal(await tx(at,c=>recordFlashTimerReminders(c,id)),1);assert.equal(await tx(at,c=>recordFlashTimerReminders(c,id)),0);}assert.equal(await tx(epoch+90000,c=>recordFlashTimerReminders(c,id)),0);
  assert.deepEqual((await audits(id)).map(a=>a.threshold_seconds),[86400,3600,900]);const rows=await events(id);assert.equal(rows.length,6);assert(rows.every(r=>[supplier,buyer].includes(r.recipient_id)));assert(rows.every(r=>parse(r.payload).aggregateVersion===7));assert.equal(new Set(rows.map(r=>r.event_key)).size,3);assert.deepEqual((await db.query(select,[id]))[0][0],before);
 });
 await checked('short windows, exact expiry and inactive offers do not manufacture reminders',async()=>{
  for(const options of [{duration:899,remaining:899},{duration:90000,remaining:0},{duration:90000,remaining:-1},{duration:90000,remaining:900,status:'CANCELLED'}]){const id=await offer(options);assert.equal(await tx(epoch,c=>recordFlashTimerReminders(c,id)),0);assert.equal((await audits(id)).length,0);}
 });
 await checked('exact15m hold is buyer-only; pending/paid/expired/aged unknown payments excluded',async()=>{
  const id=await offer(),eligible=await hold(id);await hold(id,{duration:899});await hold(id,{remaining:0});await hold(id,{status:'PAYMENT_PENDING'});await hold(id,{status:'PAID',paid:true});await hold(id,{attempt:'INITIATED'});await hold(id,{attempt:'RECONCILIATION_REQUIRED'});await hold(id,{paid:true});
  assert.equal(await tx(epoch,c=>recordFlashTimerReminders(c,id)),1);assert.equal(await tx(epoch,c=>recordFlashTimerReminders(c,id)),0);const rows=await audits(id);assert.equal(rows.length,1);assert.equal(rows[0].commitment_id,eligible.id);assert.equal(rows[0].threshold_seconds,900);const emitted=await events(id);assert.equal(emitted.length,1);assert.equal(emitted[0].recipient_id,buyer);assert.equal(emitted[0].event_type,'UCP.HOLD_EXPIRING');
 });
 await checked('10 concurrent InnoDB transactions produce one hold reminder/event',async()=>{
  const id=await offer();await hold(id);const result=await Promise.all(Array.from({length:10},()=>tx(epoch,c=>recordFlashTimerReminders(c,id))));assert.equal(result.reduce((a,b)=>a+b,0),1);assert.equal((await audits(id)).length,1);assert.equal((await events(id)).length,1);
 });
 await checked('100-row batches skip recorded reminders and reach later commitments',async()=>{
  const id=await offer();for(let n=0;n<102;n++)await hold(id);assert.equal(await tx(epoch,c=>recordFlashTimerReminders(c,id)),100);assert.equal(await tx(epoch,c=>recordFlashTimerReminders(c,id)),2);assert.equal(await tx(epoch,c=>recordFlashTimerReminders(c,id)),0);assert.equal((await audits(id)).length,102);
 });
 await checked('observed parent-lock wait and deadline crossing use a fresh post-lock SQL statement',async()=>{
  const id=await offer({duration:90000,remaining:1}),blocker=await acquire(epoch),waiter=await acquire(epoch);let signal,pending;const started=new Promise(r=>{signal=r;});
  try{await blocker.beginTransaction();await blocker.query('SELECT id FROM flash_pools WHERE id=? FOR UPDATE',[id]);const [[identity]]=await waiter.query('SELECT CONNECTION_ID() id');await waiter.beginTransaction();
   const proxy={query:async(sql,args)=>{if(sql.includes('FROM flash_pools')&&sql.includes('FOR UPDATE')){const p=waiter.query(sql,args);signal();const r=await p;await waiter.query('SET timestamp=?',[epoch+1]);return r;}return waiter.query(sql,args);}};
   pending=recordFlashTimerReminders(proxy,id);await started;let waiting=false;for(let n=0;n<40&&!waiting;n++){const [[state]]=await db.query('SELECT EXISTS(SELECT 1 FROM performance_schema.data_lock_waits w JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID WHERE t.PROCESSLIST_ID=?) waiting',[identity.id]);waiting=Boolean(state.waiting);}assert.equal(waiting,true,'Observe actual lock wait, not a guessed sleep');await blocker.commit();assert.equal(await pending,0);await waiter.commit();assert.equal((await audits(id)).length,0);
  }finally{await blocker.rollback();if(pending)await pending.catch(()=>{});await waiter.rollback();await release(blocker);await release(waiter);}
 });
 await checked('outbox failure rolls back audit and earlier recipient; retry recovers once',async()=>{
  const id=await offer({duration:90000,remaining:86400});await hold(id,{status:'PAID',paid:true});const c=await acquire(epoch);
  try{await c.beginTransaction();const proxy={query:async(sql,args)=>{if(sql.includes('INSERT INTO procurement_notifications')&&Number(args[0])===buyer)throw Error('INJECTED_OUTBOX_FAILURE');return c.query(sql,args);}};await assert.rejects(()=>recordFlashTimerReminders(proxy,id),/INJECTED_OUTBOX_FAILURE/);await c.rollback();}finally{await c.rollback();await release(c);}
  assert.equal((await audits(id)).length,0);assert.equal((await events(id)).length,0);assert.equal(await tx(epoch,c=>recordFlashTimerReminders(c,id)),1);assert.equal((await events(id)).length,2);
 });
 await checked('actual worker lease excludes peers and recovers after holder disconnect',async()=>{
  const lease='ucp_flash_recovery:miljor_test_db',holder=await acquire(epoch);const [[l]]=await holder.query('SELECT GET_LOCK(?,0) acquired',[lease]);assert.equal(l.acquired,1);
  try{const r=await runFlashRecoveryBatch({database:db,flashService:{reclaimExpiredUninitiatedHolds(){throw Error('PEER_MUST_NOT_RUN');}},limit:1});assert.equal(r.skipped,true);}finally{holder.destroy();}
  const peer=await acquire(epoch);try{const [[l]]=await peer.query('SELECT GET_LOCK(?,2) acquired',[lease]);assert.equal(l.acquired,1);await peer.query('SELECT RELEASE_LOCK(?)',[lease]);}finally{await release(peer);}
 });
 await checked('signed failed callback binds owned attempt/replays once and cannot downgrade PAID',async()=>{
  const id=await offer(),h=await hold(id,{status:'PAID',paid:true,attempt:'COMPLETED'}),tracker='track_'+code(),eventId=code();owned.webhooks.push(eventId);await db.query('UPDATE payment_attempts SET provider_tracker_token=? WHERE order_id=?',[tracker,h.orderId]);
  const rawBody=Buffer.from(JSON.stringify({type:'payment.failed',data:{tracker,amount:100,currency:'PKR'}})),signature=crypto.createHmac('sha512',process.env.SAFEPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');const service=require('../src/services/safepayCheckoutService'),request={rawBody,signature,eventId,eventType:'payment.failed',timestamp:String(epoch)};
  assert.equal((await service.processWebhookEvent(request)).success,true);assert.equal((await service.processWebhookEvent(request)).is_duplicate,true);const [receipts]=await db.query('SELECT provider_tracker_token FROM payment_webhook_events WHERE event_id=?',[eventId]);assert.equal(receipts.length,1);assert.equal(receipts[0].provider_tracker_token,tracker);const [[o]]=await db.query('SELECT order_status,payment_status FROM orders WHERE id=?',[h.orderId]);assert.deepEqual(o,{order_status:'PAID',payment_status:'PAID'});
  const invalidId=code();owned.webhooks.push(invalidId);await assert.rejects(()=>service.processWebhookEvent({...request,eventId:invalidId,signature:'invalid'}),e=>e.code==='INVALID_WEBHOOK_SIGNATURE');assert.equal((await db.query('SELECT id FROM payment_webhook_events WHERE event_id=?',[invalidId]))[0].length,0);
 });
 if(owned.orders.length){const [[money]]=await db.query('SELECT COUNT(*) n FROM payments WHERE order_id IN (?)',[owned.orders]);assert.equal(money.n,0);}
 if(!only)assert.equal(groups.length,10,'Every mandatory Phase A/B group must execute');
 console.log(`${only?'UCP_PHASE_AB_DIAGNOSTIC_PASS':'UCP_PHASE_AB_CONTRACT_GATE_PASS'} ${groups.length} groups; ${only?'selected group '+only:'0 skipped'}; ${port}/miljor_test_db; no provider/transport calls`);
}
async function cleanup(){if(!ready)return;await cleanupOwnedNotificationFixtures(db,owned.users);
 if(owned.webhooks.length)await db.query('DELETE FROM payment_webhook_events WHERE event_id IN (?)',[owned.webhooks]);if(owned.attempts.length)await db.query('DELETE FROM payment_attempts WHERE id IN (?)',[owned.attempts]);
 if(owned.offers.length)await db.query("DELETE FROM system_audit_logs WHERE entity_name='flash_pools' AND entity_id IN (?) AND action='FLASH_TIMER_REMINDER'",[owned.offers]);if(owned.holds.length)await db.query('DELETE FROM flash_purchase_holds WHERE id IN (?)',[owned.holds]);if(owned.orders.length)await db.query('DELETE FROM orders WHERE id IN (?)',[owned.orders]);if(owned.offers.length)await db.query('DELETE FROM flash_pools WHERE id IN (?)',[owned.offers]);if(owned.products.length)await db.query('DELETE FROM products WHERE id IN (?)',[owned.products]);if(owned.users.length)await db.query('DELETE FROM users WHERE id IN (?)',[owned.users]);console.log('CLEANUP PASS: only owned fixtures removed; no foreign-key overrides');}
main().catch(e=>{console.error('UCP_PHASE_AB_CONTRACT_GATE_FAIL',e.stack);process.exitCode=1;}).finally(async()=>{try{await cleanup();}catch(e){console.error('OWNED_FIXTURE_CLEANUP_FAILED',e.stack);process.exitCode=1;}finally{await db.end();}});
