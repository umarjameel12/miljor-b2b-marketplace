'use strict';
// Financial-only deterministic concurrency simulation. The fake transaction
// scheduler serializes writes by tracker, like a pessimistic parent-row lock.
// This does NOT substitute for actual MySQL/InnoDB tests.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const exact=require('../src/services/exactDecimal');
const raw=(token='evt_REFUND_123456789')=>Buffer.from(JSON.stringify({
  type:'payment.refunded',token,
  data:{tracker:'track_abcdefgh1234',currency:'PKR',
    state:'TRACKER_PARTIAL_REFUND',refund_amount:1000,
    metadata:{order_id:'ORD-12'}}
}));
let owner=false;
const queue=[];
async function acquire(){
  if(!owner){owner=true;return;}
  await new Promise(resolve=>queue.push(resolve));
}
function unlock(){
  const next=queue.shift();
  if(next)next();else owner=false;
}
const state={
  event:null,confirmed:'0.00',refundApproved:true,
  paymentStatus:'PAID',insertCount:0,refundUpdates:0,
  paymentUpdates:0,commits:0,rollbacks:0
};
const db={getConnection:async()=>{
  let active=false,staged=[],done=false;
  return {
    beginTransaction:async()=>{await acquire();active=true;},
    query:async(sql,params=[])=>{
      if(sql.includes('FROM payment_attempts'))
        return [[{id:2,order_id:12,status:'COMPLETED'}]];
      if(sql.includes('FROM orders'))
        return [[{id:12,order_code:'ORD-12',payment_status:'PAID'}]];
      if(sql.includes('FROM payment_webhook_events'))
        return [state.event&&state.event.event_id===params[0]?[state.event]:[]];
      if(sql.includes('FROM payments')&&sql.includes('SELECT'))
        return [[{id:3,amount:'100.00',status:state.paymentStatus}]];
      if(sql.includes('FROM refund_obligations')&&sql.includes("status='APPROVED'"))
        return [state.refundApproved?
          [{id:4,payment_id:3,total_refund_amount:'10.00',status:'APPROVED'}]:[]];
      if(sql.includes('FROM refund_obligations')&&sql.includes("status='CONFIRMED'"))
        return [[{confirmed_amount:state.confirmed}]];
      if(sql.includes('INSERT INTO payment_webhook_events')){
        staged.push({kind:'event',event:{
          event_id:params[0],provider:'SAFEPAY',
          event_type:'payment.refunded',order_id:params[1],
          attempt_id:params[2],provider_tracker_token:params[3],
          raw_payload:params[6],processed_status:'PROCESSED'
        }});
        return [{affectedRows:1}];
      }
      if(sql.includes('UPDATE refund_obligations')){
        if(!state.refundApproved)return [{affectedRows:0}];
        staged.push({kind:'refund',amount:params[3]});
        return [{affectedRows:1}];
      }
      if(sql.includes('UPDATE payments SET status=')){
        if(!['PAID','PARTIALLY_REFUNDED'].includes(state.paymentStatus))
          return [{affectedRows:0}];
        staged.push({kind:'payment',status:params[0]});
        return [{affectedRows:1}];
      }
      throw Error('Unexpected SQL '+sql);
    },
    commit:async()=>{
      if(!active||done)throw Error('Invalid test transaction state');
      for(const operation of staged){
        if(operation.kind==='event'){state.event=operation.event;state.insertCount++;}
        if(operation.kind==='refund'){
          state.refundApproved=false;state.refundUpdates++;
          state.confirmed=exact.exactDecimalSum([state.confirmed,operation.amount],2);
        }
        if(operation.kind==='payment'){
          state.paymentStatus=operation.status;state.paymentUpdates++;
        }
      }
      state.commits++;done=true;active=false;unlock();
    },
    rollback:async()=>{
      if(done)throw Error('Rollback after commit');
      state.rollbacks++;staged=[];done=true;
      if(active){active=false;unlock();}
    },
    release:()=>{}
  };
}};
const moduleRef={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,
  '../src/services/safepayRefundWebhookService.js'),'utf8'),{
  require(name){
    if(name==='../config/db')return db;
    if(name==='./exactDecimal')return exact;
    if(name==='./safepayAdapter')return {verifyWebhookSignature:()=>true};
    if(name==='./financialSettlementService')return {_logAuditEvent:async()=>{}};
    throw Error('Unexpected module '+name);
  },
  module:moduleRef,exports:moduleRef.exports,
  Buffer,console,process:{env:{MILJOR_SAFEPAY_REFUND_UNIT_VERIFIED:'PAISA'}}
},{timeout:5000});
const svc=moduleRef.exports;
(async()=>{
  const responses=await Promise.allSettled([
    svc.receive({rawBody:raw(),signature:'signed'}),
    svc.receive({rawBody:raw(),signature:'signed'})
  ]);
  assert.equal(responses.filter(r=>r.status==='fulfilled').length,2);
  assert.equal(responses.filter(r=>r.status==='fulfilled'&&r.value.duplicate).length,1);
  assert.equal(state.insertCount,1);
  assert.equal(state.refundUpdates,1);
  assert.equal(state.paymentUpdates,1);
  assert.equal(state.confirmed,'10.00');
  console.log('PASS: concurrent duplicate signed events commit one refund');

  await assert.rejects(
    ()=>svc.receive({rawBody:raw('evt_REFUND_DIFFERENT_001'),signature:'signed'}),
    e=>e.code==='REFUND_OBLIGATION_AMBIGUOUS');
  assert.equal(state.refundUpdates,1);
  assert.equal(state.paymentUpdates,1);
  assert.equal(state.insertCount,1);
  assert.equal(state.commits,2);
  assert.equal(state.rollbacks,1);
  console.log('PASS: different event ID cannot claim confirmed refund');
  console.log('PASS: concurrent commit/rollback conservation');
  console.log('P0 refund concurrency simulated acceptance: 3 PASS');
})().catch(e=>{console.error('FAIL concurrency simulation:',e);process.exitCode=1;});
