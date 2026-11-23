'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {toMinorPkr,fromMinorPkr,buildPaymentV3,validateCreatedTracker,normalizeSucceededWebhook,refundPreview}
  =require('../src/services/safepayV3ContractService');
const key='sec_sandboxmerchantpublickey_2026';
const tracker='track_8ad42dcd-test';
test('exact PKR major -> v3 minor conversion without binary floating point',()=>{
  for(const [major,minor] of [['0.01','1'],['10','1000'],['1145.00','114500'],
    ['192450.99','19245099'],['999999.99','99999999']]){
    assert.equal(toMinorPkr(major),minor);
    assert.equal(fromMinorPkr(minor),require('../src/services/exactDecimal').toCanonicalString(major,2));
  }
});
test('invalid/overflow or fractional-paisa values cannot reach provider',()=>{
  for(const value of ['0.00','-1','NaN','1e3','0.001','10.999','1.001',null,
    '90071992547410.00']){
    assert.throws(()=>toMinorPkr(value));
  }
  for(const value of ['-1','1.2','1e3','NaN','01',null,{},'9007199254740992']){
    assert.throws(()=>fromMinorPkr(value));
  }
});
test('build exact v3 merchant-authorized payload and immutable order reference',()=>{
  const a=buildPaymentV3({amountPkr:'1145.00',merchantApiKey:key,orderCode:'ORD-123'});
  assert.equal(a.path,'/order/payments/v3/');
  assert.equal(a.sandboxHost,'sandbox.api.getsafepay.com');
  assert.deepEqual(a.body,{merchant_api_key:key,intent:'CYBERSOURCE',mode:'payment',
    entry_mode:'raw',currency:'PKR',amount:114500,
    metadata:{source:'miljor',order_id:'ORD-123'}});
  assert.equal(Object.isFrozen(a.body),true);
  assert.throws(()=>buildPaymentV3({amountPkr:'1.00',merchantApiKey:'abc',orderCode:'ORD-1'}));
});
test('v3 tracker creation must match amount, sandbox, order, mode and expected STARTED',()=>{
  const response={data:{tracker:{token:tracker,client:key,environment:'sandbox',
    mode:'payment',state:'TRACKER_STARTED',
    purchase_totals:{quote_amount:{currency:'PKR',amount:114500}},
    metadata:{order_id:'ORD-123'}}}};
  assert.deepEqual(validateCreatedTracker({response,expectedAmountPkr:'1145.00',
    expectedOrderCode:'ORD-123',expectedMerchantApiKey:key}),{trackerToken:tracker,
      providerContract:'payments-v3-minor',amountPkr:'1145.00',
      currency:'PKR',captured:false,providerOriginVerified:false});
  for(const patch of [
    {purchase_totals:{quote_amount:{currency:'PKR',amount:1145}}},
    {purchase_totals:{quote_amount:{currency:'USD',amount:114500}}},
    {state:'TRACKER_ENDED'},{environment:'production'},
    {mode:'instrument'},{metadata:{order_id:'ORD-DIFFERENT'}},
    {metadata:{}},{client:'sec_another_merchant'}, {client:undefined},
    {token:'track_../../other'}
  ]){
    const mutated={data:{tracker:{...response.data.tracker,...patch}}};
    assert.throws(()=>validateCreatedTracker({response:mutated,
      expectedAmountPkr:'1145.00',expectedOrderCode:'ORD-123',expectedMerchantApiKey:key}));
  }
});
test('signed v3 payment webhook requires capture, merchant, tracker and locked order identity',()=>{
  const data={state:'TRACKER_ENDED',amount:114500,currency:'PKR',
    tracker,metadata:{order_id:'ORD-123'}};
  const args={eventType:'payment.succeeded',data,merchantApiKey:key,
    expectedMerchantApiKey:key,expectedTrackerToken:tracker,expectedOrderCode:'ORD-123',expectedAmountPkr:'1145.00'};
  assert.deepEqual(normalizeSucceededWebhook(args),{
    trackerToken:tracker,amountPkr:'1145.00',currency:'PKR',
    state:'TRACKER_ENDED',eventType:'payment.succeeded',
    providerContract:'payments-v3-minor'
  });
  for(const patch of [
    {state:'TRACKER_STARTED'},{state:'TRACKER_AUTHORIZED'},{amount:1145},
    {currency:'USD'},{metadata:{order_id:'OTHER'}},{metadata:{}},
    {metadata:undefined},{tracker:'track_wrong'}
  ]){
    assert.throws(()=>normalizeSucceededWebhook({...args,data:{...data,...patch}}));
  }
  assert.throws(()=>normalizeSucceededWebhook({...args,merchantApiKey:'sec_other'}));
  assert.throws(()=>normalizeSucceededWebhook({...args,eventType:'payment.failed'}));
});
test('refund v3 preview remains nonexecutable for exact buyer item shortage',()=>{
  const r=refundPreview({trackerToken:tracker,amountPkr:'5000.00'});
  assert.equal(r.payload.amount,500000);
  assert.equal(r.executable,false);
  assert.equal(r.providerConfirmation,'NOT_VERIFIED');
  assert.throws(()=>refundPreview({trackerToken:'../../attack',amountPkr:'10'}));
});
