'use strict';
// Run only on the parent's disposable canonical MySQL server. No dotenv/config
// bootstrap, migrations, provider calls, HTTP server, or notification dispatcher.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
assert.equal(process.env.NODE_ENV,'test','NODE_ENV must explicitly be test');
assert.equal(process.env.TEST_DB_NAME,'miljor_test_db','TEST_DB_NAME must explicitly be miljor_test_db');
assert.ok(['33319','33321'].includes(process.env.DB_PORT),'Explicit isolated runtime/final-canonical test port required');
const testPort=Number(process.env.DB_PORT);
if(process.env.DB_NAME)assert.equal(process.env.DB_NAME,'miljor_test_db');
if(process.env.DB_HOST)assert(['127.0.0.1','localhost'].includes(process.env.DB_HOST));
const mysql=require('mysql2/promise');
const pool=mysql.createPool({host:'127.0.0.1',port:testPort,user:'root',password:'',database:'miljor_test_db',
  connectionLimit:6,connectTimeout:5000,timezone:'Z',multipleStatements:false});
async function identity(connection){
  const [[row]]=await connection.query('SELECT DATABASE() AS db,@@port AS port');
  assert.equal(row.db,'miljor_test_db');assert.equal(Number(row.port),testPort);
}
const database={query:async(...args)=>{const c=await database.getConnection();try{return await c.query(...args);}finally{c.release();}},
  getConnection:async()=>{const c=await pool.getConnection();try{await identity(c);
    await c.query("SET SESSION time_zone='+00:00'");await c.query('SET timestamp=0');await c.query('SET SESSION innodb_lock_wait_timeout=5');return c;
  }catch(error){c.release();throw error;}}};
// Only the configuration entry point is replaced. All domain SQL, row locking,
// audit, deterministic event generation and notification persistence are real.
const config=require.resolve('../src/config/db');
assert(!require.cache[config],'Application DB configuration must not have loaded');
require.cache[config]={id:config,filename:config,loaded:true,exports:database};
const {CommercialLifecycleService:lifecycle}=require('../src/services/commercialLifecycleService');
const {RegularPoolPaymentHoldService}=require('../src/services/regularPoolPaymentHoldService');
const {UcpRegularRecoveryService}=require('../src/services/ucpRegularRecoveryService');
const canonicalNotices=require('../src/services/ucpTransactionalNotifications');
const tag='UR'+crypto.randomBytes(6).toString('hex');
let sequence=0,ready=false;
const owned={users:[],products:[],specs:[],listings:[],pools:[],orders:[],keys:[]};
const code=()=>tag+(++sequence);
const placeholders=values=>values.map(()=>'?').join(',');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const results=[];
async function checked(name,work){await work();results.push(name);console.log('PASS '+name);}
async function insert(sql,args){return (await database.query(sql,args))[0].insertId;}
async function user(role){const value=await insert("INSERT INTO users(full_name,email,role,is_verified,verification_status) VALUES (?,?,?,1,'VERIFIED')",[tag+' '+role,code()+'@example.invalid',role]);owned.users.push(value);return value;}
// Real canonical outbox writer, restricted to owned recipients so a concurrent
// test's/admin seed's inbox never receives this test's global admin fan-out.
const notices={...canonicalNotices,recordInAppOnConnection:async(connection,event)=>{
  const recipients=event.recipients.filter(recipient=>owned.users.includes(recipient.userId));
  assert(recipients.length,'Expected owned notification recipients');
  return canonicalNotices.recordInAppOnConnection(connection,{...event,recipients});
}};
const holds=new RegularPoolPaymentHoldService({database,notifications:notices});
const service=new UcpRegularRecoveryService({database,lifecycle,holds,notifications:notices});
let supplier,replacement,admin,buyers,product,spec,listing,holdPool;

async function schemaReady(){
  const required={users:['id','role'],products:['id'],product_specifications:['spec_hash'],supplier_listings:['available_stock'],
    supplier_profiles:['supplier_id'],pools:['supplier_confirmation_deadline','buyer_commitment_deadline','promised_delivery_at'],
    reservations:['status'],orders:['payment_status','reservation_id'],regular_pool_payment_holds:['expires_at','status'],
    payment_attempts:['provider_tracker_token','status'],supplier_inventory_allocations:['allocated_qty'],
    pool_commercial_snapshots:['participating_reservations_summary'],pool_supplier_commercial_decisions:['decision'],
    pool_buyer_commercial_decisions:['decision'],reservation_business_events:['event_id'],
    system_audit_logs:['new_value'],idempotency_records:['resource_type','response_body'],
    procurement_notifications:['recipient_id','event_key','event_type'],ucp_recovery_cursors:['last_flash_id']};
  const [columns]=await database.query('SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE FROM information_schema.columns WHERE table_schema=DATABASE()');
  for(const [table,names] of Object.entries(required))for(const name of names)
    assert(columns.some(c=>c.TABLE_NAME===table&&c.COLUMN_NAME===name),`SCHEMA_NOT_READY ${table}.${name}; finish canonical migrations first`);
  for(const status of ['INITIATED','RECONCILIATION_REQUIRED'])assert(columns.find(c=>c.TABLE_NAME==='payment_attempts'&&c.COLUMN_NAME==='status').COLUMN_TYPE.includes("'"+status+"'"));
  ready=true;
}
async function makePool(status){
  const value=await insert(`INSERT INTO pools(pool_code,supplier_id,product_id,product_spec_id,supplier_listing_id,
    current_qty,target_qty,max_capacity,supplier_min_qty,buyer_min_qty,current_price_per_unit,pool_unit,status,expires_at,
    supplier_confirmation_deadline,buyer_commitment_deadline,promised_delivery_at)
    VALUES (?,?,?,?,?,5,5,100,5,1,100,'kg',?,DATE_SUB(NOW(),INTERVAL 2 DAY),
      DATE_SUB(NOW(),INTERVAL 1 DAY),DATE_SUB(NOW(),INTERVAL 1 HOUR),DATE_ADD(NOW(),INTERVAL 2 DAY))`,
    [code(),supplier,product,spec,listing,status]);owned.pools.push(value);
  await database.query(`INSERT INTO supplier_inventory_allocations(supplier_listing_id,allocation_type,reference_id,allocated_qty,unit,status)
    VALUES (?,'REGULAR_POOL',?,100,'kg','COMMITTED')`,[listing,value]);return value;
}
async function reservation(poolId,buyer,status='RESERVED'){
  return insert('INSERT INTO reservations(reservation_code,pool_id,buyer_id,quantity,unit_price,total_price,status) VALUES (?,?,?,1,100,100,?)',[code(),poolId,buyer,status]);
}
async function order(poolId,reservationId,buyer){
  const value=await insert(`INSERT INTO orders(order_code,reservation_id,buyer_id,supplier_id,pool_id,total_qty,unit_price,subtotal_amount,total_amount)
    VALUES (?,?,?,?,?,1,100,100,100)`,[code(),reservationId,buyer,supplier,poolId]);owned.orders.push(value);return value;
}
async function snapshot(poolId,reservations,status){
  return insert(`INSERT INTO pool_commercial_snapshots(snapshot_code,pool_id,qualification_status,participation_cutoff,
    supplier_id,supplier_listing_id,product_id,product_spec_id,pool_unit,eligible_aggregate_qty,supplier_min_qty,target_qty,
    max_capacity,candidate_unit_price,participating_reservations_count,participating_reservations_summary,delivery_type,
    supplier_confirmation_deadline,buyer_commitment_deadline,status)
    VALUES (?,?,'TARGET_MET',DATE_SUB(NOW(),INTERVAL 2 DAY),?,?,?,?,'kg',5,5,5,100,100,?,?,'DOORSTEP',
      DATE_SUB(NOW(),INTERVAL 1 DAY),DATE_SUB(NOW(),INTERVAL 1 HOUR),?)`,
    [code(),poolId,supplier,listing,product,spec,reservations.length,JSON.stringify(reservations.map(id=>({id}))),status]);
}
async function stock(){
  const [allocations]=await database.query(`SELECT id,reference_id,allocated_qty,status FROM supplier_inventory_allocations
    WHERE supplier_listing_id=? ORDER BY id`,[listing]);
  const [[row]]=await database.query('SELECT available_stock FROM supplier_listings WHERE id=?',[listing]);
  return {allocations,available_stock:row.available_stock};
}
async function fixture(){
  supplier=await user('SUPPLIER');replacement=await user('SUPPLIER');admin=await user('ADMIN');buyers=[];
  for(let n=0;n<7;n++)buyers.push(await user('BUYER'));
  for(const supplierId of [supplier,replacement])await database.query("INSERT INTO supplier_profiles(supplier_id,verification_status) VALUES (?,'VERIFIED')",[supplierId]);
  product=await insert(`INSERT INTO products(title,category,brand,variety,processing_type,grade,pack_size,unit)
    VALUES (?,'Rice','Synthetic','Synthetic','Raw','Synthetic','1 kg','kg')`,[tag]);owned.products.push(product);
  spec=await insert(`INSERT INTO product_specifications(product_id,supplier_id,spec_code,title,variety,packaging_type,pack_size,pack_unit,spec_hash)
    VALUES (?,?,?,?,'Synthetic','bag',1,'kg',?)`,[product,supplier,code(),tag,crypto.randomBytes(32).toString('hex')]);owned.specs.push(spec);
  listing=await insert(`INSERT INTO supplier_listings(listing_code,supplier_id,product_spec_id,available_stock,base_unit_price,delivery_zones)
    VALUES (?,?,?,1000,100,'[]')`,[code(),supplier,spec]);owned.listings.push(listing);
  holdPool=await makePool('SUPPLIER_FAILED');
}
async function run(){
  await schemaReady();console.log(`TARGET miljor_test_db @ 127.0.0.1:${testPort}; canonical schema ready`);
  await fixture();
  const contexts=[];
  for(const [index,status,attemptStatus,future] of [[0,'HELD',null,false],[1,'HELD','INITIATED',false],
    [2,'HELD','RECONCILIATION_REQUIRED',false],[3,'PAYMENT_PENDING',null,false],[4,'HELD',null,true]]){
    const r=await reservation(holdPool,buyers[index],'CONFIRMED'),o=await order(holdPool,r,buyers[index]);
    const holdId=await insert(`INSERT INTO regular_pool_payment_holds(order_id,reservation_id,pool_id,buyer_id,status,expires_at)
      VALUES (?,?,?,?,?,${future?'DATE_ADD':'DATE_SUB'}(UTC_TIMESTAMP(),INTERVAL 1 HOUR))`,[o,r,holdPool,buyers[index],status]);
    if(attemptStatus)await database.query(`INSERT INTO payment_attempts(attempt_code,order_id,buyer_id,amount,status,provider_tracker_token,created_at)
      VALUES (?,?,?,100,?,NULL,DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY))`,[code(),o,buyers[index],attemptStatus]);
    contexts.push({r,o,holdId,buyer:buyers[index]});
  }
  const beforeStock=await stock();
  const [beforeOrders]=await database.query(`SELECT id,payment_status,order_status,total_amount FROM orders WHERE pool_id=? ORDER BY id`,[holdPool]);
  await checked('real concurrent expiry commits each hold transition once; old unknown outcomes retain inventory',async()=>{
    const outcomes=await Promise.all([service.recoverPool(holdPool),service.recoverPool(holdPool)]);
    assert.equal(outcomes.reduce((sum,r)=>sum+r.holds.expired,0),1);
    assert.equal(outcomes.reduce((sum,r)=>sum+r.holds.reconciliation,0),3);
    const [rows]=await database.query('SELECT status FROM regular_pool_payment_holds WHERE pool_id=? ORDER BY id',[holdPool]);
    assert.deepEqual(rows.map(r=>r.status),['EXPIRED','RECONCILIATION_REQUIRED','RECONCILIATION_REQUIRED','RECONCILIATION_REQUIRED','HELD']);
    await service.recoverPool(holdPool);
    const [[audit]]=await database.query("SELECT COUNT(*) AS n FROM system_audit_logs WHERE entity_name='pools' AND entity_id=? AND action='REGULAR_PAYMENT_HOLD_TIMEOUT'",[holdPool]);
    assert.equal(Number(audit.n),4);
    const [events]=await database.query(`SELECT event_type,COUNT(*) AS n FROM procurement_notifications WHERE recipient_id IN (${placeholders(owned.users)})
      AND event_type IN ('UCP.HOLD_EXPIRED','PAYMENT.RECONCILIATION_EXCEPTION') GROUP BY event_type ORDER BY event_type`,owned.users);
    assert.deepEqual(events.map(r=>[r.event_type,Number(r.n)]),[['PAYMENT.RECONCILIATION_EXCEPTION',6],['UCP.HOLD_EXPIRED',2]]);
    assert.deepEqual(await stock(),beforeStock);
    assert.deepEqual((await database.query('SELECT id,payment_status,order_status,total_amount FROM orders WHERE pool_id=? ORDER BY id',[holdPool]))[0],beforeOrders);
  });
  await checked('both unresolved attempt statuses block fresh sessions and checkout-claim release at any age',async()=>{
    for(const context of contexts.slice(1,3)){
      await assert.rejects(holds.assertCanCreateFreshCheckout(context.o,context.buyer),{code:'REGULAR_PAYMENT_RECONCILIATION_REQUIRED'});
      assert.equal((await holds.claimCheckout(context.o,context.buyer)).pending,true);
      await holds.releaseCheckoutClaim(context.o,context.buyer);
      const [[hold]]=await database.query('SELECT status FROM regular_pool_payment_holds WHERE id=?',[context.holdId]);
      assert.equal(hold.status,'RECONCILIATION_REQUIRED');
    }
    const exceptions=await service.listExceptions({actor:{id:admin,role:'ADMIN'},limit:100});
    const item=exceptions.items.find(item=>Number(item.pool_id)===holdPool);
    assert(item);assert.equal(Number(item.unresolved_attempt_count),2);assert.deepEqual(await stock(),beforeStock);
  });
  await checked('authorization, audited admin replay, payload conflict and atomic HTTP response persistence',async()=>{
    const request={actor:{id:admin,role:'ADMIN'},poolId:holdPool,idempotencyKey:code(),input:{action:'ACKNOWLEDGE_EXCEPTION',reason:'Synthetic isolated MySQL verification'}};
    await assert.rejects(service.recover({...request,actor:{id:buyers[0],role:'BUYER'}}),{statusCode:403});
    await assert.rejects(service.getPoolRecovery({actor:{id:replacement,role:'SUPPLIER'},poolId:holdPool}),{statusCode:403});
    await assert.rejects(service.getPoolRecovery({actor:{id:buyers[6],role:'BUYER'},poolId:holdPool}),{statusCode:403});
    await assert.rejects(service.recover({...request,input:{action:'CANCEL_AND_REFUND',reason:'Synthetic'}}),{code:'UNSUPPORTED_RECOVERY_ACTION'});
    owned.keys.push(request.idempotencyKey);
    await database.query(`INSERT INTO idempotency_records(idempotency_key,user_id,request_path,request_hash,status,response_status,response_body)
      VALUES (?,?,'POST:synthetic-regular-recovery',?,'PENDING',0,'{}')`,[request.idempotencyKey,admin,'a'.repeat(64)]);
    const [a,b]=await Promise.all([service.recover(request),service.recover(request)]);assert.deepEqual(a,b);
    await assert.rejects(service.recover({...request,input:{...request.input,reason:'Conflicting synthetic request'}}),{code:'IDEMPOTENCY_CONFLICT'});
    const [[record]]=await database.query('SELECT status,response_status,response_body FROM idempotency_records WHERE idempotency_key=?',[request.idempotencyKey]);
    assert.equal(record.status,'COMPLETED');assert.equal(record.response_status,200);assert.deepEqual(parse(record.response_body),{success:true,data:a});
    const [[audit]]=await database.query("SELECT COUNT(*) AS n FROM system_audit_logs WHERE entity_name='pools' AND entity_id=? AND action='REGULAR_ADMIN_RECOVERY'",[holdPool]);
    assert.equal(Number(audit.n),1);assert.deepEqual(await stock(),beforeStock);
  });
  await checked('replacement requires explicit owning buyer consent; replay is audited without replacement or money movement',async()=>{
    const proposal=await service.recover({actor:{id:admin,role:'ADMIN'},poolId:holdPool,idempotencyKey:code(),
      input:{action:'PROPOSE_REPLACEMENT',reason:'Synthetic supplier-failure review',reservation_id:contexts[0].r,replacement_supplier_id:replacement}});
    assert.equal(proposal.status,'BUYER_CONSENT_REQUIRED');
    const request={actor:{id:buyers[0],role:'BUYER'},poolId:holdPool,proposalId:proposal.proposal_id,idempotencyKey:code(),input:{consent:true}};
    await assert.rejects(service.consent({...request,actor:{id:buyers[1],role:'BUYER'}}),{statusCode:403});
    await assert.rejects(service.consent({...request,actor:{id:admin,role:'ADMIN'}}),{statusCode:403});
    await assert.rejects(service.consent({...request,input:{consent:'true'}}),{code:'EXPLICIT_BUYER_CONSENT_REQUIRED'});
    const [a,b]=await Promise.all([service.consent(request),service.consent(request)]);assert.deepEqual(a,b);
    assert.equal(a.replacement_executed,false);assert.equal(a.status,'CONSENT_RECORDED_RECONTRACT_REQUIRED');
    await assert.rejects(service.consent({...request,input:{consent:false}}),{code:'CONSENT_ALREADY_RECORDED'});
    const [[audit]]=await database.query("SELECT COUNT(*) AS n FROM system_audit_logs WHERE entity_name='pools' AND entity_id=? AND action='REGULAR_REPLACEMENT_CONSENT'",[holdPool]);
    assert.equal(Number(audit.n),1);
    const [[p]]=await database.query('SELECT supplier_id,status FROM pools WHERE id=?',[holdPool]);assert.equal(p.supplier_id,supplier);assert.equal(p.status,'SUPPLIER_FAILED');
    assert.deepEqual(await stock(),beforeStock);
    assert.deepEqual((await database.query('SELECT id,payment_status,order_status,total_amount FROM orders WHERE pool_id=? ORDER BY id',[holdPool]))[0],beforeOrders);
  });
  await checked('supplier deadline timeout serializes to one real event without rewriting historical snapshot or creating decisions',async()=>{
    const p=await makePool('AWAITING_SUPPLIER_CONFIRMATION');const r=await reservation(p,buyers[5]);const s=await snapshot(p,[r],'PENDING_SUPPLIER_DECISION');
    const [[before]]=await database.query('SELECT * FROM pool_commercial_snapshots WHERE id=?',[s]);
    const outcomes=await Promise.all([service.recoverPool(p),service.recoverPool(p)]);
    assert.equal(outcomes.filter(o=>o.deadlines.supplierTimedOut).length,1);
    const [[after]]=await database.query('SELECT * FROM pool_commercial_snapshots WHERE id=?',[s]);assert.deepEqual(after,before);
    const [[events]]=await database.query("SELECT COUNT(*) AS n FROM reservation_business_events WHERE pool_id=? AND event_type='SUPPLIER_CONFIRMATION_TIMED_OUT'",[p]);assert.equal(Number(events.n),1);
    const [[decisions]]=await database.query('SELECT COUNT(*) AS n FROM pool_supplier_commercial_decisions WHERE pool_id=?',[p]);assert.equal(Number(decisions.n),0);
  });
  await checked('buyer deadline expires only unanswered snapshot commitments and preserves supplier acceptance',async()=>{
    const p=await makePool('CONFIRMED'),pending=await reservation(p,buyers[5]),committed=await reservation(p,buyers[6],'CONFIRMED');
    const s=await snapshot(p,[pending,committed],'ACCEPTED');
    await database.query(`INSERT INTO pool_supplier_commercial_decisions(decision_code,pool_id,snapshot_id,supplier_id,actor_id,actor_role,decision,agreed_aggregate_qty,agreed_unit_price)
      VALUES (?,?,?,?,?,'SUPPLIER','ACCEPT',5,100)`,[code(),p,s,supplier,supplier]);
    const [[before]]=await database.query('SELECT * FROM pool_commercial_snapshots WHERE id=?',[s]);
    await service.recoverPool(p);await service.recoverPool(p);
    const [reservations]=await database.query('SELECT status FROM reservations WHERE pool_id=? ORDER BY id',[p]);assert.deepEqual(reservations.map(r=>r.status),['EXPIRED','CONFIRMED']);
    const [[after]]=await database.query('SELECT * FROM pool_commercial_snapshots WHERE id=?',[s]);assert.deepEqual(after,before);
    const [[events]]=await database.query("SELECT COUNT(*) AS n FROM reservation_business_events WHERE pool_id=? AND event_type='BUYER_COMMITMENT_TIMED_OUT'",[p]);assert.equal(Number(events.n),1);
    const [[decisions]]=await database.query('SELECT COUNT(*) AS n FROM pool_buyer_commercial_decisions WHERE pool_id=?',[p]);assert.equal(Number(decisions.n),0);
  });
  await checked('real MySQL 24h/1h/15m reminder clocks, concurrent replay, owner isolation and production discovery SQL',async()=>{
    const [[clock]]=await database.query('SELECT UNIX_TIMESTAMP(NOW()) AS epoch');const epoch=Number(clock.epoch);
    const p=await makePool('ACTIVE');await reservation(p,buyers[5]);
    await database.query(`UPDATE pools SET created_at=FROM_UNIXTIME(?),published_at=FROM_UNIXTIME(?),
      expires_at=FROM_UNIXTIME(?),published_terms_snapshot=? WHERE id=?`,[epoch-100000,epoch-100000,epoch+90000,JSON.stringify({fixture:tag,version:1}),p]);
    const [[before]]=await database.query('SELECT expires_at,published_terms_snapshot FROM pools WHERE id=?',[p]);
    function timed(at){
      const timedDb={query:database.query,getConnection:async()=>{const c=await database.getConnection();await c.query('SET timestamp=?',[at]);return c;}};
      return new UcpRegularRecoveryService({database:timedDb,lifecycle,holds,notifications:notices});
    }
    assert.equal((await timed(epoch+3599).recoverPool(p)).reminders,0);
    const first=await Promise.all([timed(epoch+3600).recoverPool(p),timed(epoch+3600).recoverPool(p)]);
    assert.equal(first.reduce((sum,r)=>sum+r.reminders,0),2);
    assert.equal((await timed(epoch+86400).recoverPool(p)).reminders,2);
    assert.equal((await timed(epoch+89100).recoverPool(p)).reminders,2);
    assert.equal((await timed(epoch+89100).recoverPool(p)).reminders,0);
    assert.equal(await timed(epoch+90000).transaction(c=>timed(epoch+90000).recordTimerReminders(c,p)),0);
    const [audit]=await database.query("SELECT new_value FROM system_audit_logs WHERE entity_name='pools' AND entity_id=? AND action='REGULAR_TIMER_REMINDER' ORDER BY id",[p]);
    const reminders=audit.map(a=>parse(a.new_value));
    assert.deepEqual(reminders.map(r=>r.threshold_seconds),[86400,86400,3600,3600,900,900]);
    assert.equal(new Set(reminders.map(r=>r.reminder_key)).size,6);assert.equal(new Set(reminders.map(r=>r.deadline_utc)).size,1);
    const [recipients]=await database.query("SELECT recipient_id FROM procurement_notifications WHERE event_type='UCP.POOL_CLOSING' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.entityId'))=?",[String(p)]);
    assert.equal(recipients.length,6);assert(recipients.every(r=>[supplier,buyers[5]].includes(r.recipient_id)));
    assert.deepEqual((await database.query('SELECT expires_at,published_terms_snapshot FROM pools WHERE id=?',[p]))[0][0],before);
    // Capture the existing worker's actual candidate statement, then execute
    // it read-only against MySQL. Never launch a global mutable test sweep.
    let discovery;
    await new UcpRegularRecoveryService({database:{getConnection:async()=>({release(){},query:async(sql,args)=>{
      if(sql.includes('DATABASE()'))return [[{name:'miljor_test_db'}]];
      if(sql.includes('GET_LOCK'))return [[{acquired:1}]];
      if(sql.includes('RELEASE_LOCK'))return [[{}]];
      if(sql.startsWith('SELECT last_flash_id'))return [[]];
      if(sql.startsWith('SELECT p.id FROM pools')){discovery={sql,args};return [[]];}
      throw Error('Unexpected discovery query');
    }})}}).runBatch({limit:100});
    const c=await database.getConnection();try{
      await c.query('SET timestamp=?',[epoch+3600]);const [selected]=await c.query(discovery.sql,discovery.args);
      assert(selected.some(row=>row.id===p),'Existing worker must discover an unexpired 24h reminder candidate');
    }finally{c.release();}
  });
  await checked('real MySQL 15m hold reminder is buyer-only and excludes both unresolved attempt statuses',async()=>{
    const [[clock]]=await database.query('SELECT UNIX_TIMESTAMP(NOW()) AS epoch');const epoch=Number(clock.epoch);
    const p=await makePool('PAYMENT_PENDING');
    for(const [index,attemptStatus] of [[0,null],[1,'INITIATED'],[2,'RECONCILIATION_REQUIRED']]){
      const r=await reservation(p,buyers[index],'CONFIRMED'),o=await order(p,r,buyers[index]);
      await database.query(`INSERT INTO regular_pool_payment_holds(order_id,reservation_id,pool_id,buyer_id,status,expires_at)
        VALUES (?,?,?,?,'HELD',FROM_UNIXTIME(?))`,[o,r,p,buyers[index],epoch+900]);
      if(attemptStatus)await database.query(`INSERT INTO payment_attempts(attempt_code,order_id,buyer_id,amount,status,provider_tracker_token,created_at)
        VALUES (?,?,?,100,?,NULL,DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY))`,[code(),o,buyers[index],attemptStatus]);
    }
    const before=await stock();
    const [a,b]=await Promise.all([service.recoverPool(p),service.recoverPool(p)]);assert.equal(a.reminders+b.reminders,1);
    const [recipients]=await database.query("SELECT recipient_id FROM procurement_notifications WHERE event_type='UCP.HOLD_EXPIRING' AND recipient_id IN (?,?,?,?)",[supplier,...buyers.slice(0,3)]);
    assert.deepEqual(recipients.map(r=>r.recipient_id),[buyers[0]]);
    const [audit]=await database.query("SELECT new_value FROM system_audit_logs WHERE entity_name='pools' AND entity_id=? AND action='REGULAR_TIMER_REMINDER'",[p]);
    assert.equal(audit.length,1);assert.equal(parse(audit[0].new_value).threshold_seconds,900);assert.deepEqual(await stock(),before);
  });
  await checked('no payments created and no notification dispatch',async()=>{
    const [[payments]]=await database.query(`SELECT COUNT(*) AS n FROM payments WHERE order_id IN (${placeholders(owned.orders)})`,owned.orders);assert.equal(Number(payments.n),0);
    const [notifications]=await database.query(`SELECT status FROM procurement_notifications WHERE recipient_id IN (${placeholders(owned.users)})`,owned.users);
    assert(notifications.length);assert(notifications.every(row=>row.status==='PENDING'));
    assert(!require.cache[require.resolve('dotenv')],'dotenv must never load');
  });
}
async function cleanup(){
  if(!ready)return;
  const connection=await database.getConnection();
  try{
    await identity(connection);await connection.beginTransaction();
    async function remove(table,column,values,extra='',extraArgs=[]){if(values.length)await connection.query(`DELETE FROM ${table} WHERE ${column} IN (${placeholders(values)}) ${extra}`,[...values,...extraArgs]);}
    // IDs are captured immediately after each successful fixture INSERT. No
    // TRUNCATE, foreign-key disabling, broad name matching, or historical reset.
    await remove('transactional_email_outbox','recipient_user_id',owned.users);
    await remove('platform_notifications','user_id',owned.users);
    await remove('procurement_notifications','recipient_id',owned.users);
    await remove('idempotency_records','idempotency_key',owned.keys);
    await remove('system_audit_logs','entity_id',owned.pools,"AND entity_name='pools'");
    await remove('reservation_business_events','pool_id',owned.pools);
    await remove('regular_pool_payment_holds','pool_id',owned.pools);
    await remove('payment_attempts','order_id',owned.orders);
    await remove('pool_buyer_commercial_decisions','pool_id',owned.pools);
    await remove('orders','id',owned.orders);
    await remove('pool_supplier_commercial_decisions','pool_id',owned.pools);
    await remove('reservations','pool_id',owned.pools);
    await remove('pool_commercial_snapshots','pool_id',owned.pools);
    await remove('supplier_inventory_allocations','supplier_listing_id',owned.listings);
    await remove('pools','id',owned.pools);
    await remove('supplier_listings','id',owned.listings);
    await remove('product_specifications','id',owned.specs);
    await remove('products','id',owned.products,'AND title=?',[tag]);
    await remove('supplier_profiles','supplier_id',owned.users);
    await remove('users','id',owned.users,'AND full_name LIKE ?',[tag+' %']);
    await connection.commit();
    for(const [table,ids] of [['users',owned.users],['pools',owned.pools],['orders',owned.orders],['products',owned.products],['supplier_listings',owned.listings]]){
      if(ids.length){const [[remaining]]=await connection.query(`SELECT COUNT(*) AS n FROM ${table} WHERE id IN (${placeholders(ids)})`,ids);assert.equal(Number(remaining.n),0,table+' fixture cleanup');}
    }
    console.log('CLEANUP PASS: exact owned fixtures removed; no foreign-key overrides');
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
}
run().catch(error=>{console.error('REGULAR_RECOVERY_MYSQL_FAIL',error.stack);process.exitCode=1;})
  .finally(async()=>{
    try{await cleanup();}catch(error){console.error('OWNED_FIXTURE_CLEANUP_FAILED',error.stack);process.exitCode=1;}
    await pool.end();
    if(!process.exitCode)console.log(`REGULAR_RECOVERY_MYSQL_PASS: ${results.length} scenario groups; miljor_test_db:${testPort}; provider/dispatch not invoked`);
  });
