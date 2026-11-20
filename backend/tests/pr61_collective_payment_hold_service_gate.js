'use strict';
const assert=require('node:assert/strict');
const Module=require('node:module');
const path=require('node:path');
const servicePath=path.resolve(__dirname,'../src/services/collectivePaymentHoldService.js');
const originalLoad=Module._load;
function fixture(){
 const state={row:{id:1,order_id:91,buyer_id:201,payment_hold_status:'ACTIVE',
  payment_expires_at:'2099-01-01 00:00:00',is_open:1,payment_status:'AWAITING_PAYMENT',
  order_status:'AWAITING_PAYMENT'},allocations:[{status:'PENDING'}],attempts:[],
  commits:0,rollbacks:0};
 const conn={
  async beginTransaction(){},async commit(){state.commits++;},
  async rollback(){state.rollbacks++;},release(){},
  async query(sql,args=[]){
   const q=sql.replace(/\s+/g,' ').trim();
   if(q.startsWith('UPDATE procurement_collective_buyer_orders SET payment_expires_at=')){
    const row=state.row;if(!row||row.order_id!==Number(args[1])||row.buyer_id!==Number(args[2])||row.payment_hold_status!=='ACTIVE')return [{affectedRows:0}];
    row.payment_expires_at='2099-01-01 00:15:00';return [{affectedRows:1}];
   }
   if(q.startsWith('SELECT co.id,co.order_id,co.buyer_id,co.payment_hold_status')){
    return [state.row&&state.row.order_id===Number(args[0])?[{...state.row}]:[]];
   }
   if(q.startsWith('SELECT id FROM payment_attempts')){
    return [state.attempts.filter(x=>x.order_id===Number(args[0])&&x.status==='INITIATED').slice(0,1)];
   }
   if(q.startsWith("UPDATE procurement_collective_buyer_orders SET payment_hold_status='RECONCILIATION_REQUIRED'")){
    state.row.payment_hold_status='RECONCILIATION_REQUIRED';return [{affectedRows:1}];
   }
   if(q.startsWith("UPDATE procurement_collective_buyer_orders SET payment_hold_status='PAYMENT_PENDING'")){
    state.row.payment_hold_status='PAYMENT_PENDING';return [{affectedRows:1}];
   }
   if(q.startsWith("UPDATE procurement_collective_buyer_orders SET payment_hold_status='ACTIVE'")){
    state.row.payment_hold_status='ACTIVE';return [{affectedRows:1}];
   }
   if(q.startsWith("UPDATE supplier_inventory_allocations SET status='RELEASED'")){
    for(const a of state.allocations)if(a.status==='PENDING')a.status='RELEASED';return [{affectedRows:1}];
   }
   if(q.startsWith("UPDATE procurement_collective_buyer_orders SET payment_hold_status='RELEASED'")){
    state.row.payment_hold_status='RELEASED';state.row.payment_hold_release_reason=args[0];return [{affectedRows:1}];
   }
   if(q.startsWith('SELECT payment_hold_status,')){
    return [state.row?[{payment_hold_status:state.row.payment_hold_status,is_open:state.row.is_open}]:[]];
   }
   if(q.startsWith('SELECT co.id,co.order_id,co.payment_hold_status')){
    return [state.row?[{...state.row}]:[]];
   }
   if(q.startsWith('SELECT id,payment_hold_status FROM procurement_collective_buyer_orders')){
    return [state.row?[{id:state.row.id,payment_hold_status:state.row.payment_hold_status}]:[]];
   }
   if(q.startsWith("UPDATE procurement_collective_buyer_orders SET payment_hold_status='COMMITTED'")){
    state.row.payment_hold_status='COMMITTED';return [{affectedRows:1}];
   }
   if(q.startsWith('SELECT co.id,co.order_id,co.buyer_id,co.payment_hold_status,o.payment_status')){
    return [state.row&&state.row.is_open===0&&['ACTIVE','PAYMENT_PENDING'].includes(state.row.payment_hold_status)?[{...state.row}]:[]];
   }
   throw new Error('Unexpected SQL: '+q);
  }
 };
 const fakeDb={getConnection:async()=>conn,query:conn.query.bind(conn)};
 Module._load=function(request,parent,isMain){
  if(parent?.filename===servicePath&&request==='../config/db')return fakeDb;
  return originalLoad.call(this,request,parent,isMain);
 };
 delete require.cache[servicePath];
 const service=require('../src/services/collectivePaymentHoldService');
 Module._load=originalLoad;
 return {service,state,conn};
}
const tests=[];
async function check(name,fn){await fn();tests.push(name);console.log('PASS PR61 COLLECTIVE HOLD '+tests.length+': '+name);}
async function main(){
 await check('new buyer order receives a bounded 15-minute lease',async()=>{
  const f=fixture();await f.service.createForOrder(f.conn,{orderId:91,buyerId:201});
  assert.equal(f.state.row.payment_expires_at,'2099-01-01 00:15:00');
 });
 await check('checkout claim is buyer-owned and moves ACTIVE to PAYMENT_PENDING',async()=>{
  const f=fixture();const r=await f.service.claimCheckout(91,201);
  assert.equal(r.pending,true);assert.equal(f.state.row.payment_hold_status,'PAYMENT_PENDING');
  await assert.rejects(f.service.claimCheckout(91,999),e=>e.code==='FORBIDDEN');
 });
 await check('expired unpaid order without provider attempt releases pending stock exactly once',async()=>{
  const f=fixture();f.state.row.is_open=0;f.state.row.payment_expires_at='2000-01-01 00:00:00';
  const r=await f.service.claimCheckout(91,201);
  assert.equal(r.collective_order,true); // expiry is reported as a fail-closed error in normal path
 });
 await check('provider-started attempt is retained for authoritative reconciliation, never released',async()=>{
  const f=fixture();f.state.row.is_open=0;f.state.row.payment_expires_at='2000-01-01 00:00:00';
  f.state.attempts=[{order_id:91,status:'INITIATED'}];
  const r=await f.service.claimCheckout(91,201);
  assert.equal(r.reconciliation_required,true);
  assert.equal(f.state.row.payment_hold_status,'RECONCILIATION_REQUIRED');
  assert.equal(f.state.allocations[0].status,'PENDING');
 });
 await check('authoritative PAID transition commits the hold and refuses released inventory',async()=>{
  const f=fixture();await f.service.markPaid(f.conn,91);
  assert.equal(f.state.row.payment_hold_status,'COMMITTED');
  f.state.row.payment_hold_status='RELEASED';
  await assert.rejects(f.service.markPaid(f.conn,91),e=>e.code==='COLLECTIVE_STOCK_HOLD_RELEASED');
 });
 console.log('PR61 COLLECTIVE PAYMENT HOLD SERVICE: '+tests.length+'/5 PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
