'use strict';
// Executes the real FulfillmentService discrepancy method against an isolated,
// transactional in-memory adapter; no MySQL or payments are contacted.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../src/services/fulfillmentService.js'),'utf8');
function instantiate(options={}){
  const events=[],updates=[],businessEvents=[];
  const order={
    id:70, order_code:'TEST-ORDER-70', buyer_id:11, supplier_id:12,
    payment_status:'PAID', fulfillment_status:'SUPPLIER_DELIVERED',
    exception_reason:null,total_qty:'100.00',pool_id:17,reservation_id:18
  };
  const tx={commit:0,rollback:0,release:0};
  const connection={
    async query(sql,params){
      if(sql.includes('SELECT * FROM orders WHERE id = ? FOR UPDATE'))return [[order]];
      if(sql.includes('COUNT(*) AS line_count') && sql.includes('procurement_award_lines'))
        return [[{line_count:options.awardLines||0}]];
      if(sql.includes('UPDATE orders')){updates.push(params);return [{affectedRows:1}]}
      if(sql.includes('INSERT INTO order_fulfillment_events')){events.push(params);return [{insertId:1}]}
      if(sql.includes('INSERT INTO reservation_business_events')){businessEvents.push(params);return [{insertId:1}]}
      if(sql.includes('SET TRANSACTION'))return [[]];
      throw Error('Unexpected SQL: '+sql);
    },
    async beginTransaction(){},
    async commit(){tx.commit++},
    async rollback(){tx.rollback++},
    release(){tx.release++}
  };
  const moduleRef={exports:{}};
  const policy=require('../src/services/deliveryQuantityPolicy');
  vm.runInNewContext(source,{
    module:moduleRef,exports:moduleRef.exports,process,
    require(name){
      if(name==='crypto')return require('node:crypto');
      if(name==='../config/db')return {getConnection:async()=>connection};
      if(name==='./reservationEventService')return {generateEventId:()=> 'TEST-EVENT-70'};
      if(name==='./supplierEligibilityPolicy')return {evaluateSupplierEligibility:()=>({eligible:true})};
      if(name==='./deliveryQuantityPolicy')return policy;
      throw Error('Unexpected dependency: '+name);
    }
  },{filename:'fulfillmentService.js'});
  return {service:moduleRef.exports,events,updates,businessEvents,tx};
}
async function execute(){
  let passed=0;
  const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+passed+': '+name)};
  const payload={
    orderId:70,actor:{id:11,role:'BUYER'},reason:'QUANTITY_MISMATCH',
    description:'Delivered 80 kg from the ordered 100 kg',
    reportedQuantity:'80.00',idempotencyKey:'demo-discrepancy-70',
    metadata:{short_quantity:'999.00',reported_quantity:'999.00',expected_quantity:'999.00'}
  };
  await check('100/80/20 evidence and authoritative metadata',async()=>{
    const x=instantiate();
    const response=await x.service.reportBuyerDiscrepancy(payload);
    assert.equal(response.fulfillment_status,'EXCEPTION');
    assert.equal(response.receipt_summary.ordered_quantity,'100.00');
    assert.equal(response.receipt_summary.received_quantity,'80.00');
    assert.equal(response.receipt_summary.short_quantity,'20.00');
    assert.equal(x.tx.commit,1);
    assert.equal(x.tx.rollback,0);
    assert.equal(x.events.length,1);
    assert.equal(x.businessEvents.length,1);
    const evidence=JSON.parse(x.events[0].find(v=>typeof v==='string'&&v.includes('"short_quantity"')));
    assert.equal(evidence.reported_quantity,'80.00');
    assert.equal(evidence.expected_quantity,'100.00');
    assert.equal(evidence.short_quantity,'20.00');
    const outbox=JSON.parse(x.businessEvents[0].find(v=>typeof v==='string'&&v.includes('"short_quantity"')));
    assert.equal(outbox.short_quantity,'20.00');
    assert.equal(x.updates.length,1);
  });
  await check('over-delivery refuses mutation and rolls back',async()=>{
    const x=instantiate();
    await assert.rejects(x.service.reportBuyerDiscrepancy({...payload,reportedQuantity:'101.00'}),
      e=>e.code==='RECEIVED_QUANTITY_EXCEEDS_ORDER');
    assert.equal(x.tx.rollback,1);
    assert.equal(x.events.length,0);
    assert.equal(x.updates.length,0);
  });
  await check('B6 awarded order requires line-specific evidence',async()=>{
    const x=instantiate({awardLines:2});
    await assert.rejects(x.service.reportBuyerDiscrepancy(payload),
      e=>e.code==='LINE_ITEM_RECEIPT_REQUIRED'&&e.statusCode===409);
    assert.equal(x.tx.rollback,1);
    assert.equal(x.events.length,0);
    assert.equal(x.updates.length,0);
  });
  await check('other buyer cannot mutate delivery evidence',async()=>{
    const x=instantiate();
    await assert.rejects(x.service.reportBuyerDiscrepancy({...payload,actor:{id:99,role:'BUYER'}}),
      e=>e.code==='FORBIDDEN');
    assert.equal(x.tx.rollback,1);
    assert.equal(x.events.length,0);
  });
  console.log('FULFILLMENT DISCREPANCY SERVICE: '+passed+'/'+passed+' PASS (in-memory transactions only)');
}
execute().catch(e=>{console.error(e);process.exitCode=1});
