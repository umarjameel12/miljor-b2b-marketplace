'use strict';
// PR61 Part 2: exercise the real collective delivery service against a
// deterministic transactional SQL adapter. CI also runs the real MySQL order,
// payment, stock and fulfilment acceptance gates; this gate isolates route
// consent/state-machine edge cases without touching any developer database.
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');
const servicePath=path.resolve(__dirname,'../src/services/procurementCollectiveDeliveryService.js');
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
  if(parent?.filename===servicePath&&request==='./notificationService')
    return {enqueueEvent:async(conn,event)=>{conn.state.notifications.push(event);}};
  return originalLoad.call(this,request,parent,isMain);
};
const {ProcurementCollectiveDeliveryService}=require('../src/services/procurementCollectiveDeliveryService');
Module._load=originalLoad;

const date='2026-11-25',window='10:00-12:00',supplier=22,group=10;
function fixture(overrides={}){
 const state={
  group:{id:group,status:'QUALIFIED',qualification_snapshot:JSON.stringify({supplier_id:supplier})},
  prior:[],members:[{buyer_id:201},{buyer_id:202}],
  orders:[
   {order_id:1001,buyer_id:201,supplier_id:supplier,delivery_fee:'25.00',
    accepted_delivery_snapshot:JSON.stringify({cluster_id:4,delivery_mode:'STANDARD_CLUSTERED',address_id:301,address_revision:1}),
    payment_status:'PAID',fulfillment_status:'AWAITING_SUPPLIER_ACKNOWLEDGEMENT',order_status:'PAID'},
   {order_id:1002,buyer_id:202,supplier_id:supplier,delivery_fee:'35.00',
    accepted_delivery_snapshot:JSON.stringify({cluster_id:4,delivery_mode:'STANDARD_CLUSTERED',address_id:302,address_revision:1}),
    payment_status:'PAID',fulfillment_status:'AWAITING_SUPPLIER_ACKNOWLEDGEMENT',order_status:'PAID'}
  ],
  addresses:[{id:301,user_id:201,revision:1,cluster_id:4,user_confirmation_status:'CONFIRMED',manual_review_required:0},
   {id:302,user_id:202,revision:1,cluster_id:4,user_confirmation_status:'CONFIRMED',manual_review_required:0}],
  disputeCount:0,run:null,route:null,stops:[],acceptances:[],notifications:[],
  nextStop:700,nextAcceptance:800,commits:0,rollbacks:0
 };
 Object.assign(state,overrides);
 const conn={
  state,
  async beginTransaction(){},
  async commit(){state.commits++;},
  async rollback(){state.rollbacks++;},
  release(){},
  async query(sql,args=[]){
   const q=sql.replace(/\s+/g,' ').trim();
   if(q.startsWith('SELECT id,status,qualification_snapshot FROM procurement_collective_groups'))return [[state.group].filter(Boolean)];
   if(q.includes('FROM procurement_collective_delivery_routes c JOIN procurement_delivery_runs r'))return [state.prior];
   if(q.startsWith('SELECT (? >= UTC_DATE()'))return [[{day_valid:1}]];
   if(q.startsWith('SELECT buyer_id FROM procurement_collective_participants'))return [state.members];
   if(q.startsWith('SELECT co.order_id,co.buyer_id,co.supplier_id'))return [state.orders];
   if(q.startsWith('SELECT COUNT(*) AS count FROM order_disputes'))return [[{count:state.disputeCount}]];
   if(q.startsWith('SELECT id,revision,cluster_id,user_confirmation_status'))return [state.addresses.filter(a=>a.id===Number(args[0])&&a.user_id===Number(args[1]))];
   if(q.startsWith('INSERT INTO procurement_delivery_runs')){
    state.run={id:501,supplier_id:args[0],cluster_id:args[1],delivery_day:args[2],delivery_window:args[3],status:'PROPOSED',locked_delivery_fee_total:args[4],planned_stops:args[5],idempotency_key:args[6],request_hash:args[7],snapshot:args[8]};
    return [{insertId:501,affectedRows:1}];
   }
   if(q.startsWith('INSERT INTO procurement_collective_delivery_routes')){
    state.route={id:601,group_id:args[0],run_id:args[1],supplier_id:args[2]};return [{insertId:601,affectedRows:1}];
   }
   if(q.startsWith('INSERT INTO procurement_delivery_stops')){
    const stop={id:state.nextStop++,run_id:args[0],order_id:args[1],buyer_id:args[2],address_id:args[3],locked_delivery_fee:args[4],status:args[5]||'ASSIGNED',snapshot:args[6]};
    state.stops.push(stop);return [{insertId:stop.id,affectedRows:1}];
   }
   if(q.startsWith('INSERT INTO procurement_collective_route_acceptances')){
    const a={id:state.nextAcceptance++,route_id:args[0],stop_id:args[1],buyer_id:args[2],status:'PENDING'};
    state.acceptances.push(a);return [{insertId:a.id,affectedRows:1}];
   }
   if(q.startsWith('SELECT r.id AS run_id,r.delivery_day')) {
    const buyer=Number(args[0]);const stop=state.stops.find(s=>s.buyer_id===buyer);
    const a=state.acceptances.find(x=>x.stop_id===stop?.id&&x.buyer_id===buyer);
    return [stop&&a&&state.run? [{run_id:state.run.id,delivery_day:state.run.delivery_day,
      delivery_window:state.run.delivery_window,run_status:state.run.status,cluster_id:state.run.cluster_id,
      order_id:stop.order_id,stop_status:stop.status,approval_status:a.status,accepted_at:a.accepted_at||null}]:[]];
   }
   if(q.startsWith('SELECT cr.id,cr.run_id,r.status,r.delivery_day,r.delivery_window')){
    return [state.route&&state.run?[{id:state.route.id,run_id:state.run.id,status:state.run.status,
      delivery_day:state.run.delivery_day,delivery_window:state.run.delivery_window}]:[]];
   }
   if(q.startsWith('SELECT a.id,a.status AS decision_status,a.buyer_id')){
    const buyer=Number(args[1]);const a=state.acceptances.find(x=>x.route_id===Number(args[0])&&x.buyer_id===buyer);
    const order=state.orders.find(x=>x.buyer_id===buyer);
    return [a&&order?[{id:a.id,decision_status:a.status,buyer_id:buyer,order_id:order.order_id,payment_status:order.payment_status}]:[]];
   }
   if(q.startsWith('UPDATE procurement_collective_route_acceptances SET status=')){
    const a=state.acceptances.find(x=>x.id===Number(args[4]));
    if(a){a.status=args[0];a.accepted_snapshot=args[1];a.accepted_at=args[2]==='ACCEPTED'?'NOW':null;a.rejection_reason=args[3];}
    return [{affectedRows:a?1:0}];
   }
   if(q.startsWith('SELECT status FROM procurement_collective_route_acceptances WHERE route_id=')){
    return [state.acceptances.filter(x=>x.route_id===Number(args[0])).map(x=>({status:x.status}))];
   }
   if(q.startsWith("UPDATE procurement_delivery_runs SET status='EXCEPTION'")){if(state.run)state.run.status='EXCEPTION';return [{affectedRows:1}];}
   if(q.startsWith("UPDATE procurement_delivery_runs SET status='CONFIRMED'")){if(state.run&&state.run.status==='PROPOSED')state.run.status='CONFIRMED';return [{affectedRows:1}];}
   if(q.startsWith('SELECT order_id,buyer_id FROM procurement_delivery_stops'))return [state.stops.filter(x=>x.run_id===Number(args[0])).map(x=>({order_id:x.order_id,buyer_id:x.buyer_id}))];
   if(q.startsWith('SELECT id FROM procurement_collective_buyer_orders'))return [[{id:group}]];
   if(q.startsWith('SELECT r.status,a.status AS consent'))return [[{status:state.run?.status,consent:state.acceptances.find(x=>x.buyer_id===state.orders.find(o=>o.order_id===Number(args[0]))?.buyer_id)?.status}].filter(x=>x.status)];
   if(q.startsWith('SELECT s.id AS stop_id,s.run_id')){const stop=state.stops.find(x=>x.order_id===Number(args[0]));return [stop?[{stop_id:stop.id,run_id:stop.run_id}]:[]];}
   if(q.startsWith('UPDATE procurement_delivery_stops SET status=')){const stop=state.stops.find(x=>x.id===Number(args[1]));if(stop)stop.status=args[0];return [{affectedRows:stop?1:0}];}
   if(q.startsWith('SELECT status FROM procurement_delivery_stops WHERE run_id='))return [state.stops.filter(x=>x.run_id===Number(args[0])).map(x=>({status:x.status}))];
   if(q.startsWith("UPDATE procurement_delivery_runs SET status='DELIVERED'")){state.run.status='DELIVERED';return [{affectedRows:1}];}
   if(q.startsWith("UPDATE procurement_delivery_runs SET status='DISPATCHED'")){if(state.run.status==='CONFIRMED')state.run.status='DISPATCHED';return [{affectedRows:1}];}
   throw new Error('Unexpected SQL in collective delivery gate: '+q);
  }
 };
 return {state,db:{getConnection:async()=>conn,query:conn.query.bind(conn)},conn,service:new ProcurementCollectiveDeliveryService({getConnection:async()=>conn,query:conn.query.bind(conn)})};
}
const key='collective-route-test-2026-001';
const tests=[];
const check=async(name,fn)=>{await fn();tests.push(name);console.log('PASS PR61 PART2 '+tests.length+': '+name);};
async function main(){
 await check('Supplier proposes one route only after both paid buyer orders and confirmed same-cluster addresses',async()=>{
  const f=fixture(),r=await f.service.propose(supplier,group,{delivery_day:date,delivery_window:window},key);
  assert.equal(r.status,'PROPOSED');assert.equal(r.planned_stops,2);assert.equal(r.supplier_may_dispatch,false);
  assert.equal(f.state.run.locked_delivery_fee_total,'60.00');assert.equal(f.state.stops.length,2);
  assert.deepEqual(f.state.acceptances.map(x=>x.status),['PENDING','PENDING']);assert.equal(f.state.notifications.length,2);
 });
 await check('Identical route proposal replay is idempotent; conflicting reschedule is blocked',async()=>{
  const f=fixture();const fingerprint=require('node:crypto').createHash('sha256').update(JSON.stringify({supplier,gid:group,date,window})).digest('hex');
  f.state.prior=[{id:501,idempotency_key:key,request_hash:fingerprint,status:'PROPOSED'}];
  const replay=await f.service.propose(supplier,group,{delivery_day:date,delivery_window:window},key);
  assert.equal(replay.is_replay,true);
  await assert.rejects(f.service.propose(supplier,group,{delivery_day:date,delivery_window:'12:00-14:00'},'collective-route-test-2026-002'),e=>e.code==='DELIVERY_ROUTE_ALREADY_PROPOSED');
 });
 await check('Only the qualified winning supplier may propose delivery',async()=>{
  const f=fixture();await assert.rejects(f.service.propose(99,group,{delivery_day:date,delivery_window:window},key),e=>e.code==='SUPPLIER_NOT_ASSIGNED');
 });
 await check('Unpaid buyer, unresolved dispute, incompatible cluster and stale address fail closed',async()=>{
  const unpaid=fixture();unpaid.state.orders[1].payment_status='AWAITING_PAYMENT';
  await assert.rejects(unpaid.service.propose(supplier,group,{delivery_day:date,delivery_window:window},key),e=>e.code==='GROUP_PAYMENTS_INCOMPLETE');
  const dispute=fixture();dispute.state.disputeCount=1;
  await assert.rejects(dispute.service.propose(supplier,group,{delivery_day:date,delivery_window:window},key),e=>e.code==='GROUP_DISPUTE_UNRESOLVED');
  const cluster=fixture();cluster.state.orders[1].accepted_delivery_snapshot=JSON.stringify({cluster_id:5,delivery_mode:'STANDARD_CLUSTERED',address_id:302,address_revision:1});
  await assert.rejects(cluster.service.propose(supplier,group,{delivery_day:date,delivery_window:window},key),e=>e.code==='CLUSTER_NOT_COMPATIBLE');
  const stale=fixture();stale.state.addresses[0].revision=2;
  await assert.rejects(stale.service.propose(supplier,group,{delivery_day:date,delivery_window:window},key),e=>e.code==='DELIVERY_ADDRESS_CHANGED');
 });
 await check('Each buyer can see only their own stop and cannot decide for another buyer',async()=>{
  const f=fixture();await f.service.propose(supplier,group,{delivery_day:date,delivery_window:window},key);
  assert.equal((await f.service.getBuyer(201,group)).order_id,1001);
  await assert.rejects(f.service.getBuyer(999,group),e=>e.code==='ROUTE_NOT_FOUND');
  await assert.rejects(f.service.decide(999,group,{run_id:501,decision:'ACCEPT'}),e=>e.code==='ROUTE_NOT_OWNED');
 });
 await check('Every paid buyer must independently accept before route becomes dispatchable',async()=>{
  const f=fixture();await f.service.propose(supplier,group,{delivery_day:date,delivery_window:window},key);
  const first=await f.service.decide(201,group,{run_id:501,decision:'ACCEPT'});
  assert.equal(first.status,'ACCEPTED_PENDING_GROUP_CONFIRMATION');assert.equal(f.state.run.status,'PROPOSED');
  await assert.rejects(f.service.assertDispatchReady(f.conn,1001),e=>e.code==='COLLECTIVE_ROUTE_CONSENT_REQUIRED');
  const second=await f.service.decide(202,group,{run_id:501,decision:'ACCEPT'});
  assert.equal(second.status,'ACCEPTED_PENDING_GROUP_CONFIRMATION');assert.equal(f.state.run.status,'CONFIRMED');
  assert.equal((await f.service.assertDispatchReady(f.conn,1001)).is_collective,true);
  assert.equal((await f.service.assertDispatchReady(f.conn,1002)).is_collective,true);
  const replay=await f.service.decide(201,group,{run_id:501,decision:'ACCEPT'});
  assert.equal(replay.is_replay,true);assert.equal(f.state.notifications.length,4);
 });
 await check('Unpaid buyer cannot consent; one buyer rejection blocks the entire shared route',async()=>{
  const f=fixture();await f.service.propose(supplier,group,{delivery_day:date,delivery_window:window},key);
  f.state.orders[0].payment_status='AWAITING_PAYMENT';
  await assert.rejects(f.service.decide(201,group,{run_id:501,decision:'ACCEPT'}),e=>e.code==='BUYER_PAYMENT_NOT_VERIFIED');
  f.state.orders[0].payment_status='PAID';
  await assert.rejects(f.service.decide(201,group,{run_id:501,decision:'REJECT',reason:'No access at this time'}),e=>e.code==='REJECTION_REASON_REQUIRED');
  const rejected=await f.service.decide(201,group,{run_id:501,decision:'REJECT',reason:'Delivery window does not work'});
  assert.equal(rejected.status,'EXCEPTION');assert.equal(f.state.run.status,'EXCEPTION');
  await assert.rejects(f.service.assertDispatchReady(f.conn,1001),e=>e.code==='COLLECTIVE_ROUTE_CONSENT_REQUIRED');
 });
 await check('Collective fulfilment synchronizes each stop and closes route only after every buyer receipt',async()=>{
  const f=fixture();await f.service.propose(supplier,group,{delivery_day:date,delivery_window:window},key);
  await f.service.decide(201,group,{run_id:501,decision:'ACCEPT'});
  await f.service.decide(202,group,{run_id:501,decision:'ACCEPT'});
  await f.service.syncFulfillment(f.conn,1001,'DISPATCHED');
  await f.service.syncFulfillment(f.conn,1001,'SUPPLIER_DELIVERED');
  await f.service.syncFulfillment(f.conn,1001,'BUYER_CONFIRMED');
  assert.equal(f.state.run.status,'DISPATCHED');
  await f.service.syncFulfillment(f.conn,1002,'DISPATCHED');
  await f.service.syncFulfillment(f.conn,1002,'SUPPLIER_DELIVERED');
  await f.service.syncFulfillment(f.conn,1002,'BUYER_CONFIRMED');
  assert.equal(f.state.run.status,'DELIVERED');
  assert.deepEqual(f.state.stops.map(x=>x.status),['BUYER_CONFIRMED','BUYER_CONFIRMED']);
 });
 await check('Any stop exception marks the collective run exceptional without auto-refund',async()=>{
  const f=fixture();await f.service.propose(supplier,group,{delivery_day:date,delivery_window:window},key);
  await f.service.decide(201,group,{run_id:501,decision:'ACCEPT'});
  await f.service.decide(202,group,{run_id:501,decision:'ACCEPT'});
  await f.service.syncFulfillment(f.conn,1001,'EXCEPTION');
  assert.equal(f.state.run.status,'EXCEPTION');
  assert.equal(f.state.notifications.length,4);
 });
 console.log('PR61 PART 2 COLLECTIVE DELIVERY SERVICE: '+tests.length+'/'+tests.length+' PASS (real service, deterministic transactional SQL adapter; no money movement)');
}
main().catch(error=>{console.error('FAIL PR61 PART2 COLLECTIVE DELIVERY',error.stack||error);process.exit(1);});
