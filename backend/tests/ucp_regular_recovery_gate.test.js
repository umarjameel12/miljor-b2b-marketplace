'use strict';
// Entirely injected SQL model: no DB driver, .env, provider, network, or fixtures.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const config=require.resolve('../src/config/db');
require.cache[config]={id:config,filename:config,loaded:true,exports:{getConnection(){throw Error('REAL_DB_FORBIDDEN');}}};
const {CommercialLifecycleService:lifecycle}=require('../src/services/commercialLifecycleService');
const {RegularPoolPaymentHoldService}=require('../src/services/regularPoolPaymentHoldService');
const {UcpRegularRecoveryService}=require('../src/services/ucpRegularRecoveryService');
const {getEventDefinition}=require('../src/services/ucpNotificationEventCatalog');
const clone=v=>structuredClone(v);
const actor={id:9,role:'ADMIN'};

function fixture({status='AWAITING_SUPPLIER_CONFIRMATION',now=100,snapshotStatus='PENDING_SUPPLIER_DECISION'}={}){
  let state={pool:{id:1,supplier_id:2,status,product_spec_id:3,supplier_listing_id:4,
    supplier_confirmation_deadline:100,buyer_commitment_deadline:200,expires_at:50},
    snapshot:{id:7,pool_id:1,supplier_id:2,snapshot_version:1,status:snapshotStatus,
      supplier_confirmation_deadline:100,buyer_commitment_deadline:200,
      participating_reservations_summary:[{id:11},{id:12}]},
    reservations:[{id:11,pool_id:1,buyer_id:3,status:'RESERVED'},{id:12,pool_id:1,buyer_id:4,status:'RESERVED'}],
    holds:[],orders:[],attempts:[],supplierDecisions:[],buyerDecisions:[],events:[],notices:[],audits:[],responses:[],cursor:0};
  let tail=Promise.resolve(),lease=false,clock=now,released=0,failNotices=false;
  const log=[];
  const database={query:async(sql,args)=>connection().query(sql,args),getConnection:async()=>connection()};
  function connection(){
    let unlock=null,saved=null;
    return {beginTransaction:async()=>{},commit:async()=>{saved=null;if(unlock){unlock();unlock=null;}},
      rollback:async()=>{if(saved)state=saved;if(unlock){unlock();unlock=null;}},release:()=>{released++;},
      query:async function(raw,args=[]){
        const sql=raw.replace(/\s+/g,' ').trim();log.push({sql,args:clone(args)});
        if(sql==='SELECT DATABASE() AS name')return [[{name:'miljor_test_db'}]];
        if(sql.includes('GET_LOCK')){if(lease)return [[{acquired:0}]];lease=true;return [[{acquired:1}]];}
        if(sql.includes('RELEASE_LOCK')){lease=false;return [[{released:1}]];}
        if(sql.startsWith('SELECT last_flash_id'))return [[{last_flash_id:state.cursor}]];
        if(sql.startsWith('INSERT INTO ucp_recovery_cursors')){state.cursor=args[0];return [{affectedRows:1}];}
        if(sql.startsWith('UPDATE idempotency_records')){state.responses.push(JSON.parse(args[0]));return [{affectedRows:1}];}
        if(sql.startsWith('SELECT p.id FROM pools'))return [[{id:1}]];
        if(sql==='SELECT * FROM pools WHERE id=? FOR UPDATE'||sql==='SELECT id FROM pools WHERE id=? FOR UPDATE'){
          if(!unlock){const previous=tail;tail=new Promise(resolve=>{unlock=resolve;});await previous;saved=clone(state);}
          return [[clone(state.pool)]];
        }
        if(sql.startsWith('SELECT * FROM pool_commercial_snapshots'))return state.snapshot?[[clone(state.snapshot)]]:[[]];
        if(sql.startsWith('SELECT (NOW()>=?)'))return [[{supplier_expired:args[0]!=null&&clock>=args[0]?1:0,buyer_expired:args[1]!=null&&clock>=args[1]?1:0}]];
        if(sql.startsWith('SELECT (expires_at<=NOW())'))return [[{expired:clock>=state.pool.expires_at?1:0}]];
        if(sql.startsWith('SELECT DATE_FORMAT(?,') )return [[{deadline_utc:'deadline-'+args[0],seconds_remaining:args[1]-clock,window_seconds:args[3]-args[2]}]];
        if(sql.startsWith('SELECT DATE_FORMAT(expires_at,')){
          const hold=state.holds.find(h=>h.id===args[0]);return [[{deadline_utc:'deadline-'+hold.expires_at,seconds_remaining:hold.expires_at-clock}]];
        }
        if(sql.startsWith('SELECT status,(promised_delivery_at'))return [[{status:state.pool.status,breached:state.pool.promised_delivery_at!=null&&clock>=state.pool.promised_delivery_at?1:0}]];
        if(sql.startsWith('SELECT id,decision FROM pool_supplier')||sql.startsWith('SELECT id,decision,decision_timestamp FROM pool_supplier'))return [clone(state.supplierDecisions)];
        if(sql.startsWith('SELECT r.id,r.buyer_id FROM reservations')){
          const cohort=sql.includes('AND r.id IN (')?args.slice(1,-3):null;
          const [kind,deadlineKey,threshold]=args.slice(-3);
          return [clone(state.reservations.filter(r=>r.status==='RESERVED'&&(!cohort||cohort.includes(r.id))&&
            !state.buyerDecisions.some(d=>d.reservation_id===r.id)&&!state.orders.some(o=>o.reservation_id===r.id)&&
            !state.audits.some(a=>a.action==='REGULAR_TIMER_REMINDER'&&a.value.kind===kind&&a.value.commitment_id===r.id&&a.value.deadline_key===deadlineKey&&a.value.threshold_seconds===Number(threshold))).slice(0,100))];
        }
        if(sql.startsWith('SELECT r.* FROM reservations'))return [clone(state.reservations.filter(r=>r.status==='RESERVED'&&args.slice(1,-1).includes(r.id)&&!state.buyerDecisions.some(d=>d.reservation_id===r.id)&&!state.orders.some(o=>o.reservation_id===r.id)).slice(0,args.at(-1)))];
        if(sql.startsWith('UPDATE pools')){assert(sql.includes("status='SUPPLIER_FAILED'"));state.pool.status='SUPPLIER_FAILED';return [{affectedRows:1}];}
        if(sql.startsWith('UPDATE reservations')){state.reservations.find(r=>r.id===args[0]).status='EXPIRED';return [{affectedRows:1}];}
        if(sql.startsWith('SELECT h.* FROM regular_pool_payment_holds h WHERE h.order_id='))return [clone(state.holds.filter(h=>h.order_id===args[0]))];
        if(sql.startsWith('SELECT h.* FROM regular_pool_payment_holds'))return [clone(state.holds.filter(h=>['HELD','PAYMENT_PENDING'].includes(h.status)&&h.expires_at<=clock).slice(0,args[1]))];
        if(sql==='SELECT pool_id FROM orders WHERE id=?')return [clone(state.orders.filter(o=>o.id===args[0]).map(o=>({pool_id:o.pool_id})))];
        if(sql.startsWith('SELECT h.id,h.order_id FROM regular_pool_payment_holds'))return [clone(state.holds.filter(h=>{
          const order=state.orders.find(o=>o.id===h.order_id);
          return h.status==='HELD'&&h.expires_at>clock&&h.expires_at-clock<=900&&order?.order_status==='AWAITING_PAYMENT'&&order.payment_status==='AWAITING_PAYMENT'&&
            !state.attempts.some(a=>a.order_id===h.order_id&&['INITIATED','RECONCILIATION_REQUIRED'].includes(a.status))&&
            !state.audits.some(a=>a.action==='REGULAR_TIMER_REMINDER'&&a.value.kind==='PAYMENT_HOLD'&&a.value.commitment_id===h.id&&a.value.deadline_utc==='deadline-'+h.expires_at);
        }).slice(0,100))];
        if(sql.startsWith('SELECT id,pool_id,reservation_id,buyer_id FROM orders')||sql.startsWith('SELECT id,buyer_id,pool_id FROM orders')||sql.startsWith('SELECT id,pool_id,buyer_id,reservation_id,payment_status'))return [clone(state.orders.filter(o=>o.id===args[0]))];
        if(sql.startsWith('SELECT * FROM regular_pool_payment_holds WHERE id='))return [clone(state.holds.filter(h=>h.id===args[0]))];
        if(sql.startsWith('SELECT (expires_at<=UTC_TIMESTAMP())'))return [[{expired:state.holds.find(h=>h.id===args[0]).expires_at<=clock?1:0}]];
        if(sql.startsWith('SELECT (expires_at>UTC_TIMESTAMP())'))return [[{is_open:state.holds.find(h=>h.id===args[0]).expires_at>clock?1:0}]];
        if(sql.startsWith('SELECT id FROM payment_attempts')||sql.startsWith('SELECT pa.id FROM payment_attempts')){
          const statuses=sql.includes("status IN ('INITIATED','RECONCILIATION_REQUIRED')")?['INITIATED','RECONCILIATION_REQUIRED']:['INITIATED'];
          return [clone(state.attempts.filter(a=>a.order_id===args[0]&&statuses.includes(a.status)))];
        }
        if(sql.startsWith('SELECT id FROM regular_pool_payment_holds WHERE order_id='))return [clone(state.holds.filter(h=>h.order_id===args[0]&&h.buyer_id===args[1]&&h.status==='PAYMENT_PENDING'))];
        if(sql.startsWith('UPDATE regular_pool_payment_holds SET status=?')){state.holds.find(h=>h.id===args[1]).status=args[0];return [{affectedRows:1}];}
        if(sql.startsWith("UPDATE regular_pool_payment_holds SET status='PAID'")){
          for(const hold of state.holds)if(hold.order_id===args[0]&&['HELD','PAYMENT_PENDING','EXPIRED','RECONCILIATION_REQUIRED'].includes(hold.status))hold.status='PAID';
          return [{affectedRows:1}];
        }
        if(sql.startsWith('SELECT new_value FROM system_audit_logs')){
          const key=sql.includes('$.request_key')?'request_key':sql.includes('$.result.proposal_id')?'proposal_id':'consent';
          return [state.audits.filter(a=>{
            if(key==='request_key')return a.action==='REGULAR_ADMIN_RECOVERY'&&a.value.request_key===args[1];
            if(key==='proposal_id')return a.action==='REGULAR_ADMIN_RECOVERY'&&a.value.result?.proposal_id===args[1];
            return a.action==='REGULAR_REPLACEMENT_CONSENT'&&a.value.proposal_id===args[1];
          }).map(a=>({new_value:clone(a.value)}))];
        }
        if(sql.startsWith('SELECT id FROM system_audit_logs'))return [state.audits.filter(a=>sql.includes("'REGULAR_TIMER_REMINDER'")?
          a.action==='REGULAR_TIMER_REMINDER'&&a.value.reminder_key===args[1]:a.action==='REGULAR_DELIVERY_SLA_BREACHED')];
        if(sql.startsWith('INSERT INTO system_audit_logs')){
          const action=sql.includes("'REGULAR_ADMIN_RECOVERY'")?'REGULAR_ADMIN_RECOVERY':
            sql.includes("'REGULAR_REPLACEMENT_CONSENT'")?'REGULAR_REPLACEMENT_CONSENT':
            sql.includes("'REGULAR_DELIVERY_SLA_BREACHED'")?'REGULAR_DELIVERY_SLA_BREACHED':
            sql.includes("'REGULAR_PAYMENT_HOLD_TIMEOUT'")?'REGULAR_PAYMENT_HOLD_TIMEOUT':args[0];
          const effectiveAction=sql.includes("'REGULAR_TIMER_REMINDER'")?'REGULAR_TIMER_REMINDER':action;
          state.audits.push({action:effectiveAction,value:JSON.parse(args.at(-1))});return [{affectedRows:1}];
        }
        if(sql.startsWith('SELECT id,buyer_id FROM reservations WHERE id=')||sql.startsWith('SELECT buyer_id FROM reservations WHERE id='))
          return [clone(state.reservations.filter(r=>r.id===Number(args[0])&&r.pool_id===Number(args[1])))];
        if(sql.startsWith('SELECT u.role,u.is_verified'))return [[{role:'SUPPLIER',is_verified:1,verification_status:'VERIFIED',supplier_profile_verification:'VERIFIED'}]];
        if(sql.startsWith('SELECT id,role FROM users')||sql.startsWith('SELECT DISTINCT u.id,u.role FROM users')){
          return [[{id:2,role:'SUPPLIER'},{id:3,role:'BUYER'}]];
        }
        if(sql.startsWith('SELECT id,supplier_id,status,'))return [[clone(state.pool)]];
        if(sql.startsWith('SELECT id FROM reservations WHERE pool_id='))return [clone(state.reservations.filter(r=>r.buyer_id===Number(args[1])))];
        throw Error('UNMODELED_SQL: '+sql);
      }};
  }
  const notices={recordInAppOnConnection:async(conn,event)=>{
    getEventDefinition(event.type);if(failNotices)throw Error('OUTBOX_FAILURE');state.notices.push(clone(event));
  },recordOrderOnConnection:async(conn,event)=>{getEventDefinition(event.type);if(failNotices)throw Error('OUTBOX_FAILURE');state.notices.push(clone(event));}};
  const events={generateEventId:event=>crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex'),
    recordEvent:async(event,conn)=>{assert(conn.query);assert(!state.events.some(e=>e.event_id===event.event_id),'duplicate domain event');state.events.push(clone(event));}};
  const holds=new RegularPoolPaymentHoldService({database,notifications:notices});
  const service=new UcpRegularRecoveryService({database,lifecycle,holds,notifications:notices,eventService:events});
  return {get state(){return state;},database,service,holds,events,notices,log,
    clock:value=>{clock=value;},failNotices:()=>{failNotices=true;},get released(){return released;},
    lease:value=>{lease=value;},connection};
}

test('supplier timeout at exact post-lock deadline is authoritative, immutable, and replay safe',async()=>{
  const f=fixture();const snapshot=clone(f.state.snapshot);
  const result=await f.service.recoverPool(1);
  assert.equal(result.deadlines.supplierTimedOut,true);assert.equal(f.state.pool.status,'SUPPLIER_FAILED');
  assert.deepEqual(f.state.snapshot,snapshot);assert.deepEqual(f.state.supplierDecisions,[]);
  assert.equal(f.state.events[0].event_type,'SUPPLIER_CONFIRMATION_TIMED_OUT');assert.equal(f.state.events[0].actor_role,'SYSTEM');
  assert.equal(f.state.notices[0].type,'UCP.POOL_FAILED');
  await f.service.recoverPool(1);assert.equal(f.state.events.length,1);assert.equal(f.state.notices.length,1);
  assert.equal(f.log[0].sql,'SELECT * FROM pools WHERE id=? FOR UPDATE');
});
test('deadline is not evaluated from stale pre-lock request clock',async()=>{
  const f=fixture({now:99});
  const barrier=f.connection();await barrier.beginTransaction();await barrier.query('SELECT * FROM pools WHERE id=? FOR UPDATE',[1]);
  const waiting=f.service.recoverPool(1);f.clock(100);await barrier.commit();
  assert.equal((await waiting).deadlines.supplierTimedOut,true);
});
test('before deadline no supplier failure; snapshot deadline overrides changed pool deadline',async()=>{
  const f=fixture({now:99});f.state.pool.supplier_confirmation_deadline=1;
  await f.service.recoverPool(1);assert.equal(f.state.pool.status,'AWAITING_SUPPLIER_CONFIRMATION');assert.equal(f.state.events.length,0);
});
test('competing workers serialize supplier timeout to one committed event',async()=>{
  const f=fixture();await Promise.all([f.service.recoverPool(1),f.service.recoverPool(1)]);
  assert.equal(f.state.events.length,1);assert.equal(f.state.notices.length,1);
});
test('supplier decision conflict fails closed without overwriting evidence',async()=>{
  const f=fixture();f.state.supplierDecisions=[{id:8,decision:'ACCEPT'}];
  await assert.rejects(f.service.recoverPool(1),/RECOVERY_DECISION_STATE_CONFLICT/);
  assert.equal(f.state.pool.status,'AWAITING_SUPPLIER_CONFIRMATION');assert.equal(f.state.events.length,0);
});
test('buyer timeout expires only snapshot cohort with no decision and no order',async()=>{
  const f=fixture({status:'CONFIRMED',snapshotStatus:'ACCEPTED',now:200});
  f.state.supplierDecisions=[{id:8,decision:'ACCEPT'}];
  f.state.reservations.push({id:13,buyer_id:5,pool_id:1,status:'RESERVED'});
  f.state.buyerDecisions=[{reservation_id:12,decision:'ACCEPT'}];
  const before=clone(f.state.snapshot);const result=await f.service.recoverPool(1);
  assert.equal(result.deadlines.buyersTimedOut,1);
  assert.deepEqual(f.state.reservations.map(r=>r.status),['EXPIRED','RESERVED','RESERVED']);
  assert.deepEqual(f.state.snapshot,before);assert.deepEqual(f.state.buyerDecisions,[{reservation_id:12,decision:'ACCEPT'}]);
  assert.equal(f.state.events[0].event_type,'BUYER_COMMITMENT_TIMED_OUT');
  await f.service.recoverPool(1);assert.equal(f.state.events.length,1);
});
test('buyer timeout never expires order-backed or already committed reservations',async()=>{
  const f=fixture({status:'CONFIRMED',snapshotStatus:'ACCEPTED',now:200});f.state.supplierDecisions=[{id:8,decision:'ACCEPT'}];
  f.state.orders=[{id:6,reservation_id:11}];f.state.reservations[1].status='CONFIRMED';
  await f.service.recoverPool(1);assert.equal(f.state.events.length,0);assert.equal(f.state.orders.length,1);
});
test('notification failure rolls back timeout, event and audit as one transaction',async()=>{
  const f=fixture();f.failNotices();await assert.rejects(f.service.recoverPool(1),/OUTBOX_FAILURE/);
  assert.equal(f.state.pool.status,'AWAITING_SUPPLIER_CONFIRMATION');assert.deepEqual(f.state.events,[]);assert.deepEqual(f.state.audits,[]);
});
for(const [holdStatus,attemptStatus,expected] of [['HELD',null,'EXPIRED'],['HELD','INITIATED','RECONCILIATION_REQUIRED'],['HELD','RECONCILIATION_REQUIRED','RECONCILIATION_REQUIRED'],['PAYMENT_PENDING',null,'RECONCILIATION_REQUIRED'],['PAYMENT_PENDING','INITIATED','RECONCILIATION_REQUIRED'],['PAYMENT_PENDING','RECONCILIATION_REQUIRED','RECONCILIATION_REQUIRED']]){
  test(`hold ${holdStatus}, attempt ${attemptStatus}: ${expected} without money/order/stock mutation`,async()=>{
    const f=fixture({status:'SUPPLIER_FAILED'});
    f.state.holds=[{id:21,pool_id:1,buyer_id:3,reservation_id:11,order_id:31,status:holdStatus,expires_at:100}];
    f.state.orders=[{id:31,pool_id:1,buyer_id:3,reservation_id:11,payment_status:'AWAITING_PAYMENT'}];
    if(attemptStatus)f.state.attempts=[{id:44,order_id:31,status:attemptStatus,provider_tracker_token:null,created_at:-100000}];
    const original=clone(f.state.orders);await f.service.recoverPool(1);
    assert.equal(f.state.holds[0].status,expected);assert.deepEqual(f.state.orders,original);
    assert.equal(f.state.notices[0].type,expected==='EXPIRED'?'UCP.HOLD_EXPIRED':'PAYMENT.RECONCILIATION_EXCEPTION');
    await f.service.recoverPool(1);assert.equal(f.state.notices.length,1);
    const locks=f.log.filter(row=>row.sql.includes('FOR UPDATE'));
    assert.equal(locks[0].sql,'SELECT * FROM pools WHERE id=? FOR UPDATE');
  });
}
test('SLA breach escalates once without changing pool, money or decisions',async()=>{
  const f=fixture({status:'FULFILLING',now:300});f.state.pool.promised_delivery_at=300;
  await f.service.recoverPool(1);await f.service.recoverPool(1);
  assert.equal(f.state.pool.status,'FULFILLING');assert.equal(f.state.audits.length,1);assert.equal(f.state.notices[0].type,'FULFILLMENT.SLA_BREACHED');
});
test('verified provider completion remains possible after reconciliation or expiry',async()=>{
  const f=fixture({status:'SUPPLIER_FAILED'});
  f.state.holds=[{id:21,pool_id:1,buyer_id:3,reservation_id:11,order_id:31,status:'PAYMENT_PENDING',expires_at:100}];
  f.state.orders=[{id:31,pool_id:1,buyer_id:3,reservation_id:11,payment_status:'AWAITING_PAYMENT'}];
  await f.service.recoverPool(1);assert.equal(f.state.holds[0].status,'RECONCILIATION_REQUIRED');
  await f.holds.markPaid(f.connection(),31);assert.equal(f.state.holds[0].status,'PAID');
  await f.service.recoverPool(1);assert.equal(f.state.holds[0].status,'PAID');assert.equal(f.state.notices.length,1);
});
for(const attemptStatus of ['INITIATED','RECONCILIATION_REQUIRED'])test(`checkout preserves aged ${attemptStatus} outcome at the exact hold boundary`,async()=>{
  const f=fixture({status:'SUPPLIER_FAILED'});
  f.state.holds=[{id:21,pool_id:1,buyer_id:3,reservation_id:11,order_id:31,status:'HELD',expires_at:100}];
  f.state.orders=[{id:31,pool_id:1,buyer_id:3,reservation_id:11,payment_status:'AWAITING_PAYMENT'}];
  f.state.attempts=[{id:44,order_id:31,status:attemptStatus,provider_tracker_token:null,created_at:-100000}];
  assert.equal((await f.holds.claimCheckout(31,3)).pending,true);
  assert.equal(f.state.holds[0].status,'RECONCILIATION_REQUIRED');
  const locks=f.log.filter(q=>q.sql.includes('FOR UPDATE'));
  assert.equal(locks[0].sql,'SELECT id FROM pools WHERE id=? FOR UPDATE');
  assert.equal((await f.holds.claimCheckout(31,3)).pending,true);assert.equal(f.state.notices.length,1);
});
for(const attemptStatus of ['INITIATED','RECONCILIATION_REQUIRED'])test(`release and fresh-checkout guards protect ${attemptStatus} without a tracker`,async()=>{
  const f=fixture({status:'SUPPLIER_FAILED'});
  f.state.holds=[{id:21,pool_id:1,buyer_id:3,reservation_id:11,order_id:31,status:'PAYMENT_PENDING',expires_at:100}];
  f.state.orders=[{id:31,pool_id:1,buyer_id:3,reservation_id:11,payment_status:'AWAITING_PAYMENT'}];
  f.state.attempts=[{id:44,order_id:31,status:attemptStatus,provider_tracker_token:null,created_at:-100000}];
  await f.holds.releaseCheckoutClaim(31,3);
  assert.equal(f.state.holds[0].status,'PAYMENT_PENDING');assert.equal(f.state.notices.length,0);
  await assert.rejects(f.holds.assertCanCreateFreshCheckout(31,3),{code:'REGULAR_PAYMENT_RECONCILIATION_REQUIRED'});
  assert.equal(f.state.attempts.length,1);assert.equal(f.state.orders[0].payment_status,'AWAITING_PAYMENT');
});
test('hold/order ownership mismatch rolls back without closing another commitment',async()=>{
  const f=fixture({status:'SUPPLIER_FAILED'});
  f.state.holds=[{id:21,pool_id:1,buyer_id:3,reservation_id:11,order_id:31,status:'HELD',expires_at:100}];
  f.state.orders=[{id:31,pool_id:1,buyer_id:4,reservation_id:11,payment_status:'AWAITING_PAYMENT'}];
  await assert.rejects(f.service.recoverPool(1),{code:'REGULAR_HOLD_OWNERSHIP_MISMATCH'});
  assert.equal(f.state.holds[0].status,'HELD');assert.equal(f.state.notices.length,0);
});
test('hold sweep caps a transaction at 100 and continues remaining work on replay',async()=>{
  const f=fixture({status:'SUPPLIER_FAILED'});
  for(let n=1;n<=101;n++){
    f.state.holds.push({id:n,pool_id:1,buyer_id:3,reservation_id:11,order_id:n,status:'HELD',expires_at:100});
    f.state.orders.push({id:n,pool_id:1,buyer_id:3,reservation_id:11,payment_status:'AWAITING_PAYMENT'});
  }
  assert.equal((await f.service.recoverPool(1)).holds.expired,100);
  assert.equal(f.state.holds.at(-1).status,'HELD');
  assert.equal((await f.service.recoverPool(1)).holds.expired,1);assert.equal(f.state.notices.length,101);
});
test('leased batch skips a peer and durable cursor survives a restarted worker',async()=>{
  const f=fixture({status:'SUPPLIER_FAILED'});f.lease(true);
  assert.equal((await f.service.runBatch()).skipped,true);assert.equal(f.state.cursor,0);
  f.lease(false);assert.equal((await f.service.runBatch()).processed,1);assert.equal(f.state.cursor,1);
  const restarted=new UcpRegularRecoveryService({database:f.database,lifecycle,holds:f.holds,notifications:f.notices,eventService:f.events});
  assert.equal((await restarted.runBatch()).processed,1);assert.equal(f.state.cursor,1);
  assert(f.log.some(row=>row.sql.includes('ORDER BY (p.id<=?)')&&row.args[0]===1));
  await assert.rejects(f.service.runBatch({limit:101}),/INVALID_RECOVERY_LIMIT/);
});
test('batch failure advances fair cursor, releases lease, and retains work for retry',async()=>{
  const f=fixture();f.failNotices();const result=await f.service.runBatch();
  assert.equal(result.failed,1);assert.equal(result.processed,0);assert.equal(f.state.cursor,1);
  assert.equal(f.state.pool.status,'AWAITING_SUPPLIER_CONFIRMATION');assert(f.log.some(q=>q.sql.includes('RELEASE_LOCK')));
});
test('qualification reuses existing engine on the locked transaction and stable key',async()=>{
  const f=fixture({status:'ACTIVE'});let invocation;
  f.service.lifecycle={qualifyPoolParticipation:async args=>{invocation=args;return {qualified:true};},
    expireCommercialDeadlinesOnConnection:async()=>({supplierTimedOut:false,buyersTimedOut:0})};
  await f.service.recoverPool(1);
  assert.equal(invocation.actor.role,'SYSTEM');assert.equal(invocation.idempotencyKey,'regular-recovery-qualify-1');assert(invocation.options.connection.query);
  assert.equal(f.log[0].sql,'SELECT * FROM pools WHERE id=? FOR UPDATE');
});
test('legacy and missing deadline recovery fail closed',async()=>{
  const f=fixture();f.state.pool.product_spec_id=null;
  await assert.rejects(f.service.recoverPool(1),/LEGACY_POOL_READ_ONLY/);
  f.state.pool.product_spec_id=3;f.state.pool.supplier_confirmation_deadline=null;f.state.snapshot.supplier_confirmation_deadline=null;
  await assert.rejects(f.service.recoverPool(1),/RECOVERY_DEADLINE_REQUIRED/);
  assert.equal(f.state.events.length,0);
});
test('admin recovery enforces role, strict inputs, reason, idempotent replay and conflict',async()=>{
  const f=fixture({status:'SUPPLIER_FAILED'});
  await assert.rejects(f.service.recover({actor:{id:3,role:'BUYER'}}),/FORBIDDEN/);
  await assert.rejects(f.service.listExceptions({actor:{id:3,role:'SUPPORT_ADMIN'}}),/FORBIDDEN/);
  const request={actor,poolId:1,idempotencyKey:'review-1',input:{action:'ACKNOWLEDGE_EXCEPTION',reason:'Reviewed provider evidence'}};
  const [a,b]=await Promise.all([f.service.recover(request),f.service.recover(request)]);
  assert.deepEqual(a,b);assert.equal(f.state.audits.length,1);assert.equal(f.state.notices.length,1);
  assert.deepEqual(f.state.responses[0],{success:true,data:a},'HTTP replay response commits with its domain audit');
  await assert.rejects(f.service.recover({...request,input:{...request.input,reason:'changed'}}),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(f.service.recover({...request,input:{action:'CANCEL_AND_REFUND',reason:'x'}}),/UNSUPPORTED_RECOVERY_ACTION/);
  await assert.rejects(f.service.recover({...request,input:{...request.input,buyer_id:6}}),/INVALID_RECOVERY_INPUT/);
});
test('replacement is proposal only; explicit owning buyer consent is immutable and never replaces supplier',async()=>{
  const f=fixture({status:'SUPPLIER_FAILED'});
  const proposal=await f.service.recover({actor,poolId:1,idempotencyKey:'proposal-1',
    input:{action:'PROPOSE_REPLACEMENT',reason:'Supplier missed confirmation',reservation_id:11,replacement_supplier_id:6}});
  assert.equal(proposal.status,'BUYER_CONSENT_REQUIRED');assert.equal(f.state.pool.supplier_id,2);
  const request={actor:{id:3,role:'BUYER'},poolId:1,proposalId:proposal.proposal_id,idempotencyKey:'consent-1',input:{consent:true}};
  await assert.rejects(f.service.consent({...request,actor:{id:4,role:'BUYER'}}),/FORBIDDEN/);
  await assert.rejects(f.service.consent({...request,actor}),/FORBIDDEN/);
  await assert.rejects(f.service.consent({...request,input:{consent:'true'}}),/EXPLICIT_BUYER_CONSENT_REQUIRED/);
  const result=await f.service.consent(request);assert.equal(result.replacement_executed,false);assert.equal(result.status,'CONSENT_RECORDED_RECONTRACT_REQUIRED');
  assert.deepEqual(await f.service.consent(request),result);
  await assert.rejects(f.service.consent({...request,input:{consent:false}}),/CONSENT_ALREADY_RECORDED/);
  assert.equal(f.state.pool.supplier_id,2);assert.equal(f.state.audits.filter(a=>a.action==='REGULAR_REPLACEMENT_CONSENT').length,1);
});
test('recovery read denies other suppliers and buyers without a reservation',async()=>{
  const f=fixture();
  await assert.rejects(f.service.getPoolRecovery({actor:{id:6,role:'SUPPLIER'},poolId:1}),/FORBIDDEN/);
  await assert.rejects(f.service.getPoolRecovery({actor:{id:6,role:'BUYER'},poolId:1}),/FORBIDDEN/);
  await assert.rejects(f.service.getPoolRecovery({actor:{id:6,role:'FINANCE_ADMIN'},poolId:1}),/FORBIDDEN/);
});
test('GET/POST routes enforce authentication, exact roles, mandatory idempotency and guarded queries',async()=>{
  const {createRecoveryRouter}=require('../src/routes/v1/ucpRecoveryRoutes');
  const routes=[],shared=[];let writes=0;
  const router={use:fn=>shared.push(fn),get:(path,...handlers)=>routes.push({method:'GET',path,handlers}),post:(path,...handlers)=>routes.push({method:'POST',path,handlers})};
  createRecoveryRouter({express:{Router:()=>router},service:{
    listExceptions:async()=>({items:[]}),recover:async args=>{writes++;return {key:args.idempotencyKey};},
    consent:async()=>{writes++;return {};},getPoolRecovery:async()=>({})},
    auth:{protect:(req,res,next)=>req.user?next():res.status(401).json({}),
      authorizeStrict:(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({})},
    idempotencyGuard:{required:(req,res,next)=>{if(!req.headers.key)return res.status(400).json({});req.idempotency={key:req.headers.key};return next();}}});
  async function dispatch(method,path,{role='ADMIN',authenticated=true,key='one',query={}}={}){
    const route=routes.find(r=>r.method===method&&r.path===path);
    const req={user:authenticated?{id:9,role}:null,headers:{key},query,params:{poolId:'1',proposalId:'a'.repeat(64)},body:{action:'ACKNOWLEDGE_EXCEPTION',reason:'review'}};
    let status=200,body;
    const res={status:value=>{status=value;return res;},json:value=>{body=value;return res;}};
    const stack=[...shared,...route.handlers];let index=0;
    const next=async()=>{if(index<stack.length)return stack[index++](req,res,next);};await next();return {status,body};
  }
  assert.equal((await dispatch('GET','/exceptions',{authenticated:false})).status,401);
  assert.equal((await dispatch('GET','/exceptions',{role:'SUPPLIER'})).status,403);
  assert.equal((await dispatch('GET','/exceptions',{query:{limit:'1.5'}})).status,400);
  assert.equal((await dispatch('POST','/pools/:poolId/recover',{role:'OPERATIONS_ADMIN'})).status,403);
  assert.equal((await dispatch('POST','/pools/:poolId/recover',{key:''})).status,400);
  assert.equal(writes,0);
  assert.equal((await dispatch('POST','/pools/:poolId/recover')).body.data.key,'one');
  assert.equal((await dispatch('POST','/pools/:poolId/proposals/:proposalId/consent')).status,403);
  assert.equal((await dispatch('POST','/pools/:poolId/proposals/:proposalId/consent',{role:'BUYER'})).status,200);
  assert.equal(writes,2);
});

function participationFixture(){
  const f=fixture({status:'ACTIVE',now:100});f.state.pool.created_at=1;f.state.pool.expires_at=200000;
  f.state.pool.published_terms_snapshot={version:1};return f;
}
test('existing leased worker discovers upcoming pools and commits each 24h/1h/15m threshold once per owner commitment',async()=>{
  const f=participationFixture();
  for(const [remaining,expected] of [[86401,0],[86400,3],[86400,3],[3600,6],[900,9]]){
    f.clock(200000-remaining);await f.service.runBatch();assert.equal(f.state.notices.length,expected);
  }
  assert.deepEqual(f.state.audits.map(a=>a.value.threshold_seconds),[86400,86400,86400,3600,3600,3600,900,900,900]);
  assert(f.state.notices.every(e=>e.type==='UCP.POOL_CLOSING'&&e.recipients.length===1&&[2,3,4].includes(e.recipients[0].userId)));
  assert(f.log.some(q=>q.sql.startsWith('SELECT p.id FROM pools')&&q.sql.includes('p.expires_at>NOW()')));
  assert.equal(new Set(f.state.audits.map(a=>a.value.reminder_key)).size,9);
});
test('late worker emits only nearest threshold; short windows skip inapplicable thresholds',async()=>{
  const late=participationFixture();late.clock(199400);await late.service.recoverPool(1);
  assert.equal(late.state.notices.length,3);assert(late.state.audits.every(a=>a.value.threshold_seconds===900));
  const short=participationFixture();short.state.pool.created_at=198200;short.clock(198800);
  await short.service.recoverPool(1);assert.equal(short.state.notices.length,0);
  short.clock(199100);await short.service.recoverPool(1);assert.equal(short.state.notices.length,3);
});
test('supplier reminder belongs only to the owning supplier and uses immutable snapshot deadline/version',async()=>{
  const f=fixture({now:113600});f.state.snapshot.supplier_confirmation_deadline=200000;
  f.state.snapshot.qualification_timestamp=1;f.state.snapshot.snapshot_version=4;
  await f.service.recoverPool(1);assert.equal(f.state.notices.length,1);
  assert.deepEqual(f.state.notices[0].recipients,[{userId:2,role:'SUPPLIER'}]);
  assert.equal(f.state.notices[0].aggregateVersion,4);assert.equal(f.state.audits[0].value.deadline_utc,'deadline-200000');
  const first=f.state.notices[0].transitionId;
  f.state.snapshot={...f.state.snapshot,id:8,snapshot_version:5};await f.service.recoverPool(1);
  assert.equal(f.state.notices.length,2);assert.notEqual(f.state.notices[1].transitionId,first);
  f.state.snapshot={...f.state.snapshot,id:9,snapshot_version:6,supplier_confirmation_deadline:199999};
  await f.service.recoverPool(1);assert.equal(f.state.notices.length,3);
  assert.equal(f.state.audits.at(-1).value.deadline_utc,'deadline-199999');
});
test('buyer reminder excludes accepted decisions, order-backed rows, and buyers outside snapshot cohort',async()=>{
  const f=fixture({status:'CONFIRMED',snapshotStatus:'ACCEPTED',now:113600});
  f.state.snapshot.buyer_commitment_deadline=200000;
  f.state.supplierDecisions=[{id:8,decision:'ACCEPT',decision_timestamp:1}];
  f.state.buyerDecisions=[{reservation_id:12,decision:'ACCEPT'}];
  f.state.reservations.push({id:13,pool_id:1,buyer_id:5,status:'RESERVED'});
  await f.service.recoverPool(1);assert.equal(f.state.notices.length,1);
  assert.deepEqual(f.state.notices[0].recipients,[{userId:3,role:'BUYER'}]);
  assert.equal(f.state.notices[0].payload.reservation_id,11);
  f.state.orders=[{id:31,reservation_id:11}];f.clock(196400);await f.service.recoverPool(1);assert.equal(f.state.notices.length,1);
});
test('payment reminders address only unpaid hold owner; unresolved attempts at any age suppress reminders',async()=>{
  const f=fixture({status:'PAYMENT_PENDING',now:100});
  for(let n=1;n<=4;n++){
    f.state.holds.push({id:n,pool_id:1,buyer_id:n+2,reservation_id:n+10,order_id:n,status:'HELD',expires_at:1000});
    f.state.orders.push({id:n,pool_id:1,buyer_id:n+2,reservation_id:n+10,payment_status:n===4?'PAID':'AWAITING_PAYMENT',order_status:'AWAITING_PAYMENT'});
  }
  f.state.attempts=[{order_id:2,status:'INITIATED',created_at:-100000},{order_id:3,status:'RECONCILIATION_REQUIRED',provider_tracker_token:null,created_at:-100000}];
  await Promise.all([f.service.recoverPool(1),f.service.recoverPool(1)]);
  assert.equal(f.state.notices.length,1);assert.equal(f.state.notices[0].type,'UCP.HOLD_EXPIRING');
  assert.deepEqual(f.state.notices[0].recipients,[{userId:3,role:'BUYER'}]);
  assert.equal(f.state.audits[0].value.threshold_seconds,900);
  f.state.pool.status='SUPPLIER_FAILED';f.state.holds[0].expires_at=999;
  await f.service.recoverPool(1);assert.equal(f.state.notices.length,1,'failed pool must not solicit payment');
});
test('reminder rechecks DB clock after parent lock wait and never emits after expiry',async()=>{
  const f=participationFixture();f.clock(199999);
  const barrier=f.connection();await barrier.beginTransaction();await barrier.query('SELECT * FROM pools WHERE id=? FOR UPDATE',[1]);
  const waiting=f.service.transaction(c=>f.service.recordTimerReminders(c,1));f.clock(200000);await barrier.commit();
  assert.equal(await waiting,0);assert.equal(f.state.notices.length,0);
});
test('reminder audit and outbox roll back together; replay cannot lose an event',async()=>{
  const f=participationFixture();f.clock(199100);f.failNotices();
  await assert.rejects(f.service.recoverPool(1),/OUTBOX_FAILURE/);
  assert.equal(f.state.audits.length,0);assert.equal(f.state.notices.length,0);
});
test('reminder batches skip already recorded rows before limit and reach later commitments',async()=>{
  const f=participationFixture();f.clock(199100);
  f.state.reservations=Array.from({length:101},(_,i)=>({id:i+11,pool_id:1,buyer_id:i+3,status:'RESERVED'}));
  await f.service.recoverPool(1);assert.equal(f.state.notices.length,101);
  await f.service.recoverPool(1);assert.equal(f.state.notices.length,102);
  assert.equal(f.state.notices.at(-1).recipients[0].userId,103);
});
