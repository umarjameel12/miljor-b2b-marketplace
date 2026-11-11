'use strict';
// P0 financial-only concurrency simulation using actual signed-refund service.
// No real DB pool, network or financial movement. InnoDB acceptance is separate.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const exact=require('../src/services/exactDecimal');
const event=(token='evt_REFUND_123456789')=>Buffer.from(JSON.stringify({
  token,type:'payment.refunded',
  data:{tracker:'track_abcdefgh1234',currency:'PKR',
    state:'TRACKER_PARTIAL_REFUND',refund_amount:1000,
    metadata:{order_id:'ORD-12'}}
}));
const state={
  attempt:{id:2,order_id:12,status:'COMPLETED'},
  order:{id:12,order_code:'ORD-12',payment_status:'PAID'},
  payment:{id:3,amount:'100.00',status:'PAID',transaction_ref:'track_abcdefgh1234'},
  approved:[{id:4,payment_id:3,total_refund_amount:'10.00',status:'APPROVED'}],
  confirmed:'0.00',events:[],paymentUpdates:0,refundUpdates:0,
  commits:0,rollbacks:0,locked:false,waiters:[]
};
const lock=async()=>{if(!state.locked){state.locked=true;return;}await new Promise(r=>state.waiters.push(r));};
const unlock=()=>{const next=state.waiters.shift();if(next)next();else state.locked=false;};
const db={getConnection:async()=>{
  let locked=false,changes=[],active=true;
  return {
    beginTransaction:async()=>{},
    query:async(sql,params=[])=>{
      if(sql.includes('FROM payment_attempts')&&sql.includes('FOR UPDATE')){
        await lock();locked=true;return [[{...state.attempt}]];
      }
      if(sql.includes('FROM orders'))return [[{...state.order}]];
      if(sql.includes('FROM payment_webhook_events'))return [state.events.filter(e=>e.event_id===params[0])];
      if(sql.includes('FROM payments')&&sql.includes('SELECT'))return [[{...state.payment}]];
      if(sql.includes('FROM refund_obligations')&&sql.includes("status='APPROVED'"))
        return [state.approved.map(x=>({...x}))];
      if(sql.includes('FROM refund_obligations')&&sql.includes("status='CONFIRMED'"))
        return [[{confirmed_amount:state.confirmed}]];
      if(sql.includes('INSERT INTO payment_webhook_events')){
        changes.push({type:'event',row:{
          event_id:params[0],order_id:params[1],provider:'SAFEPAY',
          event_type:'payment.refunded',attempt_id:params[2],
          provider_tracker_token:params[3],processed_status:'PROCESSED',
          raw_payload:params[6]
        }});
        return [{affectedRows:1}];
      }
      if(sql.includes('UPDATE refund_obligations')){
        if(state.approved.length!==1||state.approved[0].id!==params[1])return [{affectedRows:0}];
        changes.push({type:'refund',id:params[1],amount:params[3]});
        return [{affectedRows:1}];
      }
      if(sql.includes('UPDATE payments SET status=')){
        if(!['PAID','PARTIALLY_REFUNDED'].includes(state.payment.status))return [{affectedRows:0}];
        changes.push({type:'payment',status:params[0]});
        return [{affectedRows:1}];
      }
      throw Error('Unexpected SQL in concurrency gate '+sql);
    },
    commit:async()=>{
      if(!active)throw Error('transaction already finished');
      state.commits++;
      for(const x of changes){
        if(x.type==='event')state.events.push(x.row);
        if(x.type==='refund'){
          state.approved=[];state.refundUpdates++;
          state.confirmed=exact.exactDecimalSum([state.confirmed,x.amount],2);
        }
        if(x.type==='payment'){
          state.payment.status=x.status;state.paymentUpdates++;
        }
      }
      changes=[];active=false;
      if(locked){locked=false;unlock();}
    },
    rollback:async()=>{state.rollbacks++;changes=[];active=false;if(locked){locked=false;unlock();}},
    release:()=>{}
  };
}};
const adapter={verifyWebhookSignature:()=>true};
const financial={_logAuditEvent:async()=>{}};
const moduleRef={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,
  '../src/services/safepayRefundWebhookService.js'),'utf8'),{
  require(name){
    if(name==='../config/db')return db;
    if(name==='./exactDecimal')return exact;
    if(name==='./safepayAdapter')return adapter;
    if(name==='./financialSettlementService')return financial;
    throw Error('Forbidden module: '+name);
  },
  module:moduleRef,exports:moduleRef.exports,
  Buffer,console,process:{env:{MILJOR_SAFEPAY_REFUND_UNIT_VERIFIED:'PAISA'}}
},{timeout:5000});
const svc=moduleRef.exports;
(async()=>{
  // Bound the test: a broken fake lock queue must produce FAIL, not hang CI.
  let watchdog;
  const same=await Promise.race([
    Promise.allSettled([
      svc.receive({rawBody:event(),signature:'signed'}),
      svc.receive({rawBody:event(),signature:'signed'})
    ]),
    new Promise((_,reject)=>{
      watchdog=setTimeout(()=>reject(new Error(
        'CONCURRENCY_TEST_TIMEOUT: simulated lock was not released')),2500);
    })
  ]).finally(()=>clearTimeout(watchdog));
  assert.equal(same.filter(x=>x.status==='fulfilled').length,2);
  assert.equal(same.filter(x=>x.status==='fulfilled'&&x.value.duplicate===true).length,1);
  assert.equal(state.events.length,1);
  assert.equal(state.refundUpdates,1);
  assert.equal(state.paymentUpdates,1);
  assert.equal(state.confirmed,'10.00');
  console.log('PASS: simultaneous same event exactly once');

  // A second authenticated event identifier must not confirm the same
  // refund obligation twice. One claim was already confirmed.
  await assert.rejects(
    ()=>svc.receive({rawBody:event('evt_REFUND_DIFFERENT_001'),signature:'signed'}),
    e=>e.code==='REFUND_OBLIGATION_AMBIGUOUS'
  );
  assert.equal(state.events.length,1);
  assert.equal(state.refundUpdates,1);
  assert.equal(state.paymentUpdates,1);
  assert.equal(state.confirmed,'10.00');
  console.log('PASS: new event ID cannot reuse already-confirmed obligation');
  assert.equal(state.commits,2);
  assert.equal(state.rollbacks,1);
  console.log('PASS: simulated commit/rollback accounting exactly once');
  console.log('P0 signed refund concurrency simulation: 3 PASS');
})().catch(e=>{console.error('P0 concurrency simulation failed',e);process.exitCode=1;});
