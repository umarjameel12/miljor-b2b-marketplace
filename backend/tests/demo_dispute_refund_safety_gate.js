'use strict';
// Executes the actual dispute/refund service methods using a deterministic,
// memory-only SQL adapter. No MySQL, provider, or monetary mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname,'../src/services');
const source = name => fs.readFileSync(path.join(root,name),'utf8');
const exact = require('../src/services/exactDecimal');
const quantity = require('../src/services/deliveryQuantityPolicy');

function service(name, sql) {
  const m = new Module(path.join(root,name),module);
  m.filename=path.join(root,name);
  m.paths=module.paths;
  const ownRequire = id => {
    if (id==='../config/db')return {getConnection:async()=>sql};
    if (id==='./exactDecimal')return exact;
    if (id==='./deliveryQuantityPolicy')return quantity;
    if (id==='./feeService')return {};
    if (id==='./reservationEventService')return {generateEventId:()=> 'TEST-OUTBOX-EVENT'};
    if (id==='./supplierEligibilityPolicy')return {};
    return require(id);
  };
  const fn = new Function('require','module','exports','__filename','__dirname',source(name));
  fn(ownRequire,m,m.exports,m.filename,root);
  return m.exports;
}
function fixture(cfg={}) {
  const trace={writes:[],commits:0,rollbacks:0};
  const order={
    id:31,order_code:'DEMO-31',buyer_id:4,supplier_id:8,
    payment_status:'PAID',fulfillment_status:'SUPPLIER_DELIVERED',
    total_qty:'100.00',unit_price:'250.00',subtotal_amount:'25000.00',
    captured_amount:'25000.00',payment_row_id:12,
    delivery_fee:'0.00',buyer_platform_fee:'0.00',currency:'PKR'
  };
  const sql={
    async query(query,args) {
      if(query.startsWith('SET TRANSACTION'))return [[]];
      if(query.includes('SELECT * FROM orders WHERE id = ? FOR UPDATE'))return [[order]];
      if(query.includes('JOIN payments p ON p.order_id'))return [[order]];
      if(query.includes('FROM refund_obligations WHERE idempotency_key=?'))
        return [cfg.replay?[{id:81,order_id:31,buyer_id:4,dispute_id:17,refund_type:'PARTIAL',disputed_quantity:'20.00'}]:[]];
      if(query.includes('FROM order_disputes WHERE id=? AND order_id=?'))
        return [cfg.unrelated?[]:[{id:17,order_id:31,buyer_id:4,disputed_quantity:'20.00',status:'OPEN'}]];
      if(query.includes('FROM refund_obligations')&&query.includes("status IN ('REQUESTED'"))
        return [cfg.duplicate?[{id:81}]:[]];
      if(query.includes('SELECT SUM(total_refund_amount)'))return [[{total_refunded:'0.00'}]];
      if(query.includes('COUNT(*) AS line_count'))return [[{line_count:cfg.multiLine?2:0}]];
      if(query.includes('FROM order_disputes WHERE order_id = ? AND idempotency_key'))return [[]];
      if(query.includes('SELECT id, dispute_code, disputed_quantity'))return [[]];
      if(query.includes('FROM supplier_payables'))return [[]];
      if(query.includes('SELECT * FROM refund_obligations WHERE id ='))return [[{id:100}]];
      if(query.includes('INSERT INTO')||query.includes('UPDATE ')){
        trace.writes.push({query,args});return [{insertId:100,affectedRows:1}];
      }
      throw Error('Unexpected SQL '+query.slice(0,100));
    },
    async beginTransaction(){},
    async commit(){trace.commits++},
    async rollback(){trace.rollbacks++},
    release(){}
  };
  return {sql,trace,order};
}
async function run() {
  let n=0;
  const check=async(name,fn)=>{await fn();console.log('PASS '+(++n)+': '+name)};
  const disputeParams={orderId:31,actor:{id:4,role:'BUYER'},category:'SHORT_QUANTITY',
    description:'Only eighty kilograms received, missing twenty kilograms',
    reportedQuantity:'80',disputedQuantity:'20',idempotencyKey:'demo-dispute-key-123'};
  await check('100/80/20 dispute creates exact PKR 5000 claim',async()=>{
    const f=fixture();const s=service('disputeService.js',f.sql);
    const result=await s.createBuyerDispute(disputeParams);
    assert.equal(result.disputed_quantity,20);
    assert.equal(result.claimed_amount,'5000.00');
    assert.equal(f.trace.commits,1);
    assert.equal(f.trace.rollbacks,0);
    assert.ok(f.trace.writes.some(x=>x.query.includes('INSERT INTO order_disputes')));
  });
  for(const [name,changes,code,flags] of [
    ['wrong disputed quantity',{disputedQuantity:'30'},'DISPUTED_QUANTITY_MISMATCH',{}],
    ['received more than ordered',{reportedQuantity:'101'},'RECEIVED_QUANTITY_EXCEEDS_ORDER',{}],
    ['buyer ownership mismatch',{actor:{id:99,role:'BUYER'}},'FORBIDDEN',{}],
    ['B6 multi-line requires per-line dispute',{},'LINE_ITEM_DISPUTE_REQUIRED',{multiLine:true}]
  ]) await check(name,async()=>{
    const f=fixture(flags),s=service('disputeService.js',f.sql);
    await assert.rejects(s.createBuyerDispute({...disputeParams,...changes}),e=>e.code===code);
    assert.equal(f.trace.rollbacks,1);
    assert.equal(f.trace.writes.length,0);
  });
  const refundParams={orderId:31,actor:{id:4,role:'BUYER'},refundType:'PARTIAL',
    disputeId:17,disputedQuantity:'20',reason:'Twenty kilograms short',
    idempotencyKey:'demo-refund-key-123'};
  for(const [name,changes,code,flags] of [
    ['partial buyer refund requires dispute',{disputeId:null},'PARTIAL_REFUND_DISPUTE_REQUIRED',{}],
    ['refund blocks unrelated dispute',{},'REFUND_DISPUTE_MISMATCH',{unrelated:true}],
    ['refund quantity cannot exceed dispute',{disputedQuantity:'30'},'REFUND_QUANTITY_EXCEEDS_DISPUTE',{}],
    ['refund rejects second obligation on same dispute',{},'REFUND_ALREADY_ASSESSED_FOR_DISPUTE',{duplicate:true}],
    ['B6 partial refund cannot use aggregate SKU price',{},'LINE_ITEM_REFUND_ALLOCATION_REQUIRED',{multiLine:true}]
  ])await check(name,async()=>{
    const f=fixture(flags),s=service('financialSettlementService.js',f.sql);
    await assert.rejects(s.assessRefundObligation({...refundParams,...changes}),e=>e.code===code);
    assert.equal(f.trace.rollbacks,1);
    assert.equal(f.trace.writes.length,0);
  });
  await check('identical retry returns same refund without writes',async()=>{
    const f=fixture({replay:true}),s=service('financialSettlementService.js',f.sql);
    const res=await s.assessRefundObligation(refundParams);
    assert.equal(res.data.refund.id,81);
    assert.equal(f.trace.commits,1);
    assert.equal(f.trace.writes.length,0);
  });
  console.log('DISPUTE + REFUND SAFETY: '+n+'/'+n+' PASS (in-memory service tests)');
}
run().catch(e=>{console.error(e);process.exitCode=1});
