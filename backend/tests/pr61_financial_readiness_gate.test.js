'use strict';
// Deterministic and DB-mock-only finance policy tests. No money movement.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {evaluate,SafepayRefundReadinessService}=require('../src/services/safepayRefundReadinessService');
const now=Date.parse('2026-11-16T12:00:00Z');
const base={
  refund:{id:41,order_id:101,buyer_id:5,payment_id:77,total_refund_amount:'5000.00',
    currency:'PKR',status:'APPROVED',order_payment_status:'PAID'},
  payment:{status:'PAID',amount:'25000.00',paid_at:new Date(now-48*3600000)},
  attempt:{provider:'SAFEPAY',environment:'sandbox',order_id:101,buyer_id:5}
};
test('20 kg shortage on one buyer order creates read-only exact 5000 PKR refund assessment',()=>{
  const output=evaluate({...base,now});
  assert.equal(output.requested_amount_pkr,'5000.00');
  assert.equal(output.internal_financial_check,'PASS');
  assert.equal(output.recommended_provider_action,'PROVIDER_REFUND_REVIEW');
  assert.equal(output.can_execute_external_refund,false);
  assert.equal(output.external_execution_status,'DISABLED');
});
test('first 24 hours recommend reversal review, not fabricated settled refund',()=>{
  const output=evaluate({...base,payment:{...base.payment,paid_at:new Date(now-8*3600000)},now});
  assert.equal(output.recommended_provider_action,'PROVIDER_REVERSAL_REVIEW');
  assert.equal(output.can_execute_external_refund,false);
});
test('90-day card refund window and missing timestamp fail closed',()=>{
  const old=evaluate({...base,payment:{...base.payment,paid_at:new Date(now-91*86400000)},now});
  assert.ok(old.blocking_reasons.includes('PROVIDER_CARD_REFUND_WINDOW_EXCEEDED'));
  const missing=evaluate({...base,payment:{...base.payment,paid_at:null},now});
  assert.ok(missing.blocking_reasons.includes('CAPTURE_TIMESTAMP_UNVERIFIED'));
});
test('refund ceiling includes other approved/confirmed refunds with integer PKR cents',()=>{
  const tooMuch=evaluate({...base,otherApprovedMinor:2000001n,now});
  assert.ok(tooMuch.blocking_reasons.includes('CAPTURED_REFUND_CEILING_EXCEEDED'));
  const exactCap=evaluate({...base,otherApprovedMinor:2000000n,now});
  assert.equal(exactCap.internal_financial_check,'PASS');
});
test('unapproved, unverified provider, other buyer or currency mismatch fails closed',()=>{
  for(const input of [
    {refund:{...base.refund,status:'REQUESTED'}},
    {attempt:{...base.attempt,buyer_id:999}},
    {attempt:{...base.attempt,environment:'production'}},
    {payment:{...base.payment,status:'PENDING'}},
    {refund:{...base.refund,currency:'USD'}}
  ]){
    const result=evaluate({...base,...input,now});
    assert.equal(result.internal_financial_check,'BLOCKED');
    assert.equal(result.can_execute_external_refund,false);
  }
});
test('read-only admin route queries ownership and cap but cannot write or execute refunds',async()=>{
  const data={
    ...base.refund,captured_amount:base.payment.amount,captured_status:'PAID',
    paid_at:base.payment.paid_at,transaction_ref:'track_fixture_999'
  };
  let count=0;
  const db={query:async(sql,args)=>{
    count++;
    assert.match(sql,/^SELECT /);
    if(sql.includes('FROM refund_obligations r')){assert.deepEqual(args,[41]);return [[data]];}
    if(sql.includes('FROM payment_attempts')){assert.deepEqual(args,['track_fixture_999']);return [[base.attempt]];}
    if(sql.includes('AND status IN')){assert.deepEqual(args,[77,41]);return [[]];}
    throw Error('Unexpected SQL: '+sql);
  }};
  const svc=new SafepayRefundReadinessService(db);
  await assert.rejects(()=>svc.inspect({actor:{id:5,role:'BUYER'},refundId:41,now}),e=>e.code==='FORBIDDEN');
  assert.equal(count,0,'buyer access must be rejected before any data lookup');
  const result=await svc.inspect({actor:{id:1,role:'SUPER_ADMIN'},refundId:41,now});
  assert.equal(result.internal_financial_check,'PASS');
  assert.equal(count,3);
  assert.equal(result.provider_origin_confirmation,'NOT_OBTAINED');
  const routes=fs.readFileSync(path.join(__dirname,'../src/routes/v1/financialSettlementRoutes.js'),'utf8');
  assert.match(routes,/\/refunds\/:id\/provider-readiness/);
  assert.match(routes,/authorizeStrict\('ADMIN','SUPER_ADMIN','FINANCE_ADMIN'\)/);
});
