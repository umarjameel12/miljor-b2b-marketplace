'use strict';
// Exercises the ACTUAL B7 disputeService against a deterministic mock transaction.
// Not a claim of real MySQL integration. Verifies service-level sequencing,
// idempotency, tenancy, exact quantities and outbox routing.
const assert=require('node:assert/strict');
const dbPath=require.resolve('../src/config/db');
let database;
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{
 getConnection:()=>database.getConnection(),query:(sql,p)=>database.query(sql,p)
}};
const dispute=require('../src/services/disputeService');
const order={id:91,order_code:'MJQ-TEST-SUPPLIER-ORDER',buyer_id:5,supplier_id:2,
 payment_status:'PAID',fulfillment_status:'SUPPLIER_DELIVERED',
 notes:'SMART_PROCUREMENT_BASKET',pool_id:null,reservation_id:null,
 total_qty:'1.0000',unit_price:'8000.00',total_amount:'8150.00',currency:'PKR'};
function fake(overrides={}){
 const state={begin:0,commits:0,rollbacks:0,writes:[],notificationKeys:[]};
 const testOrder={...order,...(overrides.order||{})};
 const connection={
  async beginTransaction(){state.begin++},
  async commit(){state.commits++},
  async rollback(){state.rollbacks++},
  release(){},
  async query(sql,params=[]){
   if(sql.startsWith('SET TRANSACTION'))return [{}];
   if(sql.includes('SELECT * FROM orders WHERE id'))return [[testOrder]];
   if(sql.includes('SELECT * FROM order_disputes WHERE order_id')&&sql.includes('idempotency_key'))
    return [overrides.replay?[overrides.replay]:[]];
   if(sql.includes('FROM procurement_award_orders ao')&&sql.includes('JOIN procurement_award_lines'))
    return [overrides.lines??[{
     id:601,quantity:'100.0000',purchasing_unit:'kg',
     unit_price:'80.00',supplier_sku_id:1001
    }]];
   if(sql.includes('SELECT id,disputed_quantity,evidence_metadata FROM order_disputes'))
    return [overrides.activeClaims||[]];
   if(sql.includes('SELECT id FROM users WHERE id=? AND role=?'))
    return [[{id:params[0]}]];
   if(sql.includes('INSERT INTO procurement_notifications')){
    state.notificationKeys.push(params[2]);return [{insertId:42}];
   }
   if(sql.includes('INSERT INTO order_disputes')){
    state.writes.push({kind:'dispute',params});return [{insertId:77}];
   }
   if(sql.includes('INSERT INTO reservation_business_events'))
    throw Error('BUG: pool-less B6 award tried legacy FK outbox');
   if(sql.includes('UPDATE orders')||sql.includes('INSERT INTO order_dispute_events')||
      sql.includes('INSERT INTO system_audit_logs')){
    state.writes.push({kind:sql.includes('UPDATE orders')?'order':'audit',params});
    return [{affectedRows:1,insertId:88}];
   }
   throw Error('Unexpected mock SQL: '+sql.slice(0,120));
  }
 };
 return {state,connection,getConnection:async()=>connection,query:connection.query};
}
function request(overrides={}){return {
 orderId:91,actor:{id:5,role:'BUYER'},
 category:'SHORT_QUANTITY',description:'Only 80 kg delivered out of 100 kg of Grade A rice.',
 evidenceMetadata:{award_line_id:601,received_quantity:'80.0000'},
 idempotencyKey:'B7-TEST-SHORTAGE-601',
 ...overrides
}}
async function run(){
 let n=0;const pass=s=>console.log('PASS '+(++n)+': '+s);
 database=fake();
 const result=await dispute.createBuyerDispute(request());
 assert.equal(result.claimed_amount,'1600.00');
 assert.equal(result.disputed_quantity,20);
 assert.equal(database.state.commits,1);
 assert.equal(database.state.rollbacks,0);
 pass('Actual disputeService atomically files 100->80 B6 SKU shortfall');
 const inserted=database.state.writes.find(x=>x.kind==='dispute');
 assert.equal(inserted.params[10],20);
 assert.equal(inserted.params[11],'1600.00');
 const snapshot=JSON.parse(inserted.params[13]);
 assert.equal(snapshot.award_line_id,601);
 assert.equal(snapshot.source,'IMMUTABLE_B6_AWARD_LINE');
 pass('Persisted physical line, quantity and locked price are authoritative');
 assert.equal(database.state.notificationKeys.length,2);
 assert.equal(database.state.writes.some(x=>x.kind==='order'),true);
 pass('Pool-less award emits buyer/supplier private notices, never legacy pool FK');
 database=fake({order:{buyer_id:6}});
 await assert.rejects(()=>dispute.createBuyerDispute(request()),e=>e.code==='FORBIDDEN');
 assert.equal(database.state.rollbacks,1);assert.equal(database.state.writes.length,0);
 pass('Unrelated buyer rejected before any write');
 database=fake({order:{payment_status:'AWAITING_PAYMENT'}});
 await assert.rejects(()=>dispute.createBuyerDispute(request()),e=>e.code==='UNPAID_ORDER_NOT_DISPUTABLE');
 assert.equal(database.state.writes.length,0);
 pass('No operational shortage claim on unpaid B6 order');
 database=fake({activeClaims:[{disputed_quantity:'90.0000',evidence_metadata:JSON.stringify({award_line_id:601})}]});
 await assert.rejects(()=>dispute.createBuyerDispute(request()),
  e=>e.code==='DISPUTED_QUANTITY_EXCEEDS_ORDER_LIMIT');
 assert.equal(database.state.writes.length,0);
 pass('Overlapping active SKU shortfalls cannot exceed awarded quantity');
 database=fake({replay:{id:77,dispute_code:'DSP-A',status:'OPEN',
  dispute_category:'SHORT_QUANTITY',evidence_metadata:JSON.stringify({award_line_id:601,received_quantity:'90.0000'})}});
 await assert.rejects(()=>dispute.createBuyerDispute(request()),
  e=>e.code==='IDEMPOTENCY_PAYLOAD_CONFLICT');
 pass('Same idempotency key with changed received quantity rejects replay');
 database=fake({lines:[]});
 await assert.rejects(()=>dispute.createBuyerDispute(request()),e=>e.code==='AWARD_LINE_NOT_FOUND');
 assert.equal(database.state.rollbacks,1);
 pass('Missing/foreign physical award line fails closed and rolls back');
 console.log('B7 ACTUAL DISPUTE SERVICE (MOCK DB): '+n+'/'+n+' PASS');
}
run().then(()=>process.exit(0)).catch(e=>{console.error('B7 DISPUTE SERVICE TEST FAILED',e);process.exit(1)});
