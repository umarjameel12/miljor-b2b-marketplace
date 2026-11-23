'use strict';
// Actual B6 award reconciliation and supplier fulfillment methods; isolated
// deterministic SQL adapter. Does not mark any external money as received.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const root=path.resolve(__dirname,'../src/services');
const exact=require('../src/services/exactDecimal');
function service(file,deps){
  const filename=path.join(root,file),m=new Module(filename,module);
  m.filename=filename;
  const source=fs.readFileSync(filename,'utf8');
  new Function('module','exports','require',source)(m,m.exports,id=>{
    if(id==='../config/db')return deps.db;
    if(id==='./exactDecimal')return exact;
    if(id==='./feeService')return {};
    if(id==='./procurementMatchingService')return {};
    if(id==='./procurementAwardPolicy')return {buildAwardPreview:()=>({})};
    if(id==='./reservationEventService')return {};
    if(id==='./supplierEligibilityPolicy')return {evaluateSupplierEligibility:()=>({eligible:true})};
    if(id==='./notificationService')return deps.notifications||service('notificationService.js',deps);
    if(id==='./ucpTransactionalNotifications')return service('ucpTransactionalNotifications.js',deps);
    if(['./ucpNotificationEventCatalog','./notificationEventPolicy','./notificationDeliveryPolicy','./deliveryQuantityPolicy'].includes(id))return require(path.join(root,id));
    if(id==='crypto'||id==='node:crypto')return require('node:crypto');
    if(id==='./orderAdminApprovalService')return {assertOrderAdminApproved:async(_conn,id)=>({id,admin_approval_status:'ADMIN_APPROVED'})};
    throw Error('Unexpected dependency: '+id);
  });
  return m.exports;
}
// Run the real canonical adapter and outbox writer; only SQL is replaced.
function transitionFixture(options={}){
  const order={id:101,order_code:'B6-101',buyer_id:4,supplier_id:11,
    pool_id:null,reservation_id:null,payment_status:options.unpaid?'PENDING':'PAID',
    fulfillment_status:'AWAITING_SUPPLIER_ACKNOWLEDGEMENT',order_status:'PAID',
    admin_approval_status:'ADMIN_APPROVED'};
  const notices=[],milestones=[],attempts=[];
  const tx={active:false,commits:0,rollbacks:0,releases:0};
  let snapshot;
  const conn={
    async beginTransaction(){
      assert.equal(tx.active,false);tx.active=true;
      snapshot={order:{...order},notices:notices.length,milestones:milestones.length};
    },
    async commit(){assert.equal(tx.active,true);tx.commits++;tx.active=false;},
    async rollback(){
      Object.assign(order,snapshot.order);notices.length=snapshot.notices;
      milestones.length=snapshot.milestones;tx.rollbacks++;tx.active=false;
    },
    release(){tx.releases++;},
    async query(sql,args=[]){
      if(sql.startsWith('SET TRANSACTION'))return [[]];
      if(sql.includes('FROM users u'))return [[{id:11,role:'SUPPLIER'}]];
      if(sql.includes('FROM orders WHERE'))return [[{...order}]];
      if(sql==='SELECT id,role FROM users WHERE id=?')return [[{id:args[0],role:options.wrongRole?'ADMIN':args[0]===4?'BUYER':'SUPPLIER'}]];
      if(sql.includes('UPDATE orders SET fulfillment_status')){
        assert.equal(tx.active,true);order.fulfillment_status=args[0];order.order_status='PROCESSING';
        return [{affectedRows:1}];
      }
      if(sql.includes('INSERT INTO order_fulfillment_events')){
        milestones.push(args);return [{insertId:1}];
      }
      if(sql.includes('SELECT * FROM order_fulfillment_events'))return [milestones.length?[{id:1}]:[]];
      if(sql.includes('INSERT INTO procurement_notifications')){
        assert.equal(tx.active,true);assert.equal(order.fulfillment_status,'PREPARING');
        assert.equal(milestones.length,1,'milestone must precede canonical outbox writes');
        attempts.push(args);
        if(options.failNotice===attempts.length)throw Error('canonical outbox failed');
        notices.push(args);return [{affectedRows:1}];
      }
      throw Error('Unexpected transition SQL: '+sql);
    }
  };
  const fulfillment=service('fulfillmentService.js',{db:{getConnection:async()=>conn}});
  return {order,notices,milestones,attempts,tx,
    advance:(actor={id:11,role:'SUPPLIER'})=>fulfillment.transitionSupplierFulfillment({
      orderId:101,actor,toStatus:'PREPARING',idempotencyKey:'paid-prepare-101',
      metadata:{buyer_id:999,supplier_id:998}})};
}
async function main(){
  let passed=0;const check=(name,fn)=>{fn();console.log('PASS '+(++passed)+': '+name)};
  const states={101:'PAID',102:'PENDING'},updates=[],notificationEvents=[];
  const conn={
    async query(sql,args){
      if(sql.includes('SELECT award_id FROM procurement_award_orders'))return [[{award_id:9}]];
      if(sql.includes('FROM procurement_awards WHERE id=? FOR UPDATE'))
        return [[{id:9,request_id:5,status:'AWAITING_PAYMENT'}]];
      if(sql.includes('SELECT ao.order_id,o.payment_status'))
        return [[{order_id:101,payment_status:states[101]},{order_id:102,payment_status:states[102]}]];
      if(sql.includes('UPDATE supplier_inventory_allocations')){updates.push({kind:'allocation',id:args[0]});return [{affectedRows:1}]}
      if(sql.includes('UPDATE procurement_awards')){updates.push({kind:'award',status:args[0]});return [{affectedRows:1}]}
      if(sql.includes('UPDATE procurement_requests')){updates.push({kind:'request',id:args[0]});return [{affectedRows:1}]}
      if(sql.includes('FROM users u')&&sql.includes('LEFT JOIN supplier_profiles sp'))
        return [[{id:args[0],role:'SUPPLIER',is_verified:1,verification_status:'VERIFIED',profile_verification_status:'VERIFIED'}]];
      const qualifying=[101,102].filter(id=>states[id]==='PAID'&&(id===101?11:12)===args[0]);
      if(sql.includes('SELECT COUNT(*) AS total')&&sql.includes('FROM orders o'))
        return [[{total:qualifying.length}]];
      if(sql.includes('FROM orders o')&&sql.includes('LEFT JOIN pools p'))
        return [qualifying.map(id=>({id,order_code:'B6-'+id,pool_id:null,buyer_id:4,
          supplier_id:id===101?11:12,total_qty:10,payment_status:'PAID',
          fulfillment_status:'AWAITING_SUPPLIER_ACKNOWLEDGEMENT',order_status:'PAID',created_at:new Date()}))];
      throw Error('Unexpected SQL: '+sql.slice(0,90));
    },release(){}
  };
  const db={getConnection:async()=>conn};
  const notifications={async enqueueEvent(connection,event){
    assert.equal(connection,conn,'notification must use caller connection');
    notificationEvents.push({...event});
    throw Error('Reconciliation and fulfillment reads must not enqueue notifications');
  }};
  const award=service('procurementAwardService.js',{db,notifications});
  const fulfillment=service('fulfillmentService.js',{db,notifications});
  const first=await award.reconcilePaidOrder(conn,101);
  check('first paid supplier award stays PARTIALLY_PAID',()=>{
    assert.equal(first.status,'PARTIALLY_PAID');
    assert.equal(first.paid_orders,1);
    assert.equal(first.total_orders,2);
    assert.equal(updates.filter(x=>x.kind==='allocation').length,1);
    assert.equal(updates.filter(x=>x.kind==='request').length,0);
    assert.equal(notificationEvents.length,0);
  });
  const firstSupplier=await fulfillment.listSupplierFulfillmentOrders({actor:{id:11,role:'SUPPLIER'}});
  check('supplier 11 sees its paid poolless B6 order',()=>{
    assert.equal(firstSupplier.pagination.total,1);
    assert.equal(firstSupplier.orders[0].order_id,101);
    assert.equal(firstSupplier.orders[0].pool_id,null);
    assert.equal(notificationEvents.length,0);
  });
  const secondBefore=await fulfillment.listSupplierFulfillmentOrders({actor:{id:12,role:'SUPPLIER'}});
  check('supplier 12 cannot see its unpaid B6 order',()=>{
    assert.equal(secondBefore.pagination.total,0);
    assert.equal(secondBefore.orders.length,0);
    assert.equal(notificationEvents.length,0);
  });
  states[102]='PAID';
  const second=await award.reconcilePaidOrder(conn,102);
  const secondAfter=await fulfillment.listSupplierFulfillmentOrders({actor:{id:12,role:'SUPPLIER'}});
  check('second paid order finalizes award and becomes supplier-12 fulfillment',()=>{
    assert.equal(second.status,'PAID');
    assert.equal(second.paid_orders,2);
    assert.equal(secondAfter.orders[0].order_id,102);
    assert.ok(updates.some(x=>x.kind==='request'&&x.id===5));
    assert.deepEqual(updates.filter(x=>x.kind==='allocation').map(x=>x.id),[101,102]);
    assert.equal(notificationEvents.length,0);
  });
  const preparing=transitionFixture();
  await preparing.advance();
  check('paid PREPARING writes real canonical notices for persisted participants',()=>{
    assert.deepEqual(preparing.notices.map(n=>[n[0],n[1],n[3]]),[
      [4,'BUYER','FULFILLMENT.ACCEPTED'],[11,'SUPPLIER','FULFILLMENT.ACCEPTED'],
      [4,'BUYER','FULFILLMENT.PACKING'],[11,'SUPPLIER','FULFILLMENT.PACKING']]);
    for(const n of preparing.notices)assert.deepEqual(JSON.parse(n[4]),{entityId:101,schemaVersion:1});
    assert.match(preparing.notices[0][2],/^FULFILLMENT\.ACCEPTED:[a-f0-9]{64}$/);
    assert.equal(preparing.notices[0][2],preparing.notices[1][2]);
    assert.match(preparing.notices[2][2],/^FULFILLMENT\.PACKING:[a-f0-9]{64}$/);
    assert.equal(preparing.order.order_status,'PROCESSING');assert.equal(preparing.tx.commits,1);
  });
  assert.equal((await preparing.advance()).is_replay,true);
  check('PREPARING replay neither duplicates evidence nor canonical notices',()=>{
    assert.equal(preparing.notices.length,4);assert.equal(preparing.milestones.length,1);
    assert.equal(preparing.attempts.length,4);
  });
  for(const failNotice of [1,2,3,4]){
    const h=transitionFixture({failNotice});
    await assert.rejects(h.advance(),/canonical outbox failed/);
    check('canonical recipient write '+failNotice+' failure restores order, evidence and notices',()=>{
      assert.equal(h.order.fulfillment_status,'AWAITING_SUPPLIER_ACKNOWLEDGEMENT');
      assert.equal(h.order.order_status,'PAID');assert.equal(h.milestones.length,0);
      assert.equal(h.notices.length,0);assert.equal(h.tx.commits,0);
      assert.equal(h.tx.rollbacks,1);assert.equal(h.tx.releases,1);
    });
  }
  for(const [options,actor,code] of [
    [{},{id:99,role:'SUPPLIER'},'FORBIDDEN'],
    [{unpaid:true},{id:11,role:'SUPPLIER'},'UNPAID_ORDER_NOT_IN_FULFILLMENT'],
    [{wrongRole:true},{id:11,role:'SUPPLIER'},'NOTIFICATION_RECIPIENT_ROLE_MISMATCH']
  ]){
    const h=transitionFixture(options);
    await assert.rejects(h.advance(actor),e=>e.code===code||e.message===code);
    check(code+' prevents committed PREPARING and notices',()=>{
      assert.equal(h.order.fulfillment_status,'AWAITING_SUPPLIER_ACKNOWLEDGEMENT');
      assert.equal(h.milestones.length,0);assert.equal(h.notices.length,0);
      assert.equal(h.tx.commits,0);assert.equal(h.tx.rollbacks,1);assert.equal(h.tx.releases,1);
    });
  }
  console.log('B6 PAID FULFILLMENT SERVICE: '+passed+'/'+passed+' PASS (mocked SQL only)');
}
main().catch(e=>{console.error(e);process.exitCode=1});
