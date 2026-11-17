'use strict';
// No provider traffic: injected fetch fake inspects exact request.
const test=require('node:test');
const assert=require('node:assert/strict');
const {SafepayV3SandboxClient}=require('../src/services/safepayV3SandboxClient');
const env={SAFEPAY_ENV:'sandbox',ALLOW_EXTERNAL_MONEY_MOVEMENT:'false',
  DB_NAME:'miljor_test_db',SAFEPAY_V3_SANDBOX_ENABLED:'true',
  SAFEPAY_PUBLIC_KEY:'sec_sandbox_public_123456789',
  SAFEPAY_SECRET_KEY:'secret_test_only_123456789'};
const tracker='track_safe_sandbox_v3';
const reply={data:{tracker:{
  token:tracker,environment:'sandbox',mode:'payment',state:'TRACKER_STARTED',
  metadata:{order_id:'MILJOR-100'},
  purchase_totals:{quote_amount:{currency:'PKR',amount:114500}}}}};
test('strict environment guard rejects production/protected DB/external movement/disabled',async()=>{
  for(const change of [
    {SAFEPAY_ENV:'production'},{DB_NAME:'miljor_db'},
    {ALLOW_EXTERNAL_MONEY_MOVEMENT:'true'},{SAFEPAY_V3_SANDBOX_ENABLED:'false'},
    {SAFEPAY_SECRET_KEY:''}
  ]){
    let n=0;
    const client=new SafepayV3SandboxClient({env:{...env,...change},
      fetchImpl:async()=>{n++;throw Error('Should not call provider')}});
    await assert.rejects(()=>client.createPaymentTracker({
      amountPkr:'1145.00',orderCode:'MILJOR-100'
    }));
    assert.equal(n,0,'Unsafe env may not create provider tracker');
  }
});
test('documented v3 Sandbox POST is exact, validates response, does not mark paid',async()=>{
  let calls=0;
  const client=new SafepayV3SandboxClient({env,fetchImpl:async(url,options)=>{
    calls++;
    assert.equal(url,'https://sandbox.api.getsafepay.com/order/payments/v3/');
    assert.equal(options.method,'POST');
    assert.equal(options.headers['X-SFPY-MERCHANT-SECRET'],env.SAFEPAY_SECRET_KEY);
    const payload=JSON.parse(options.body);
    assert.equal(payload.amount,114500);
    assert.equal(payload.currency,'PKR');
    assert.equal(payload.mode,'payment');
    assert.equal(payload.merchant_api_key,env.SAFEPAY_PUBLIC_KEY);
    assert.equal(payload.metadata.order_id,'MILJOR-100');
    return {status:201,json:async()=>reply};
  }});
  const result=await client.createPaymentTracker({
    amountPkr:'1145.00',orderCode:'MILJOR-100'
  });
  assert.equal(calls,1);
  assert.equal(result.captured,false);
  assert.equal(result.providerOriginVerified,false);
  assert.equal(result.trackerToken,tracker);
  assert.ok(!JSON.stringify(result).includes(env.SAFEPAY_SECRET_KEY));
});
test('v3 Sandbox reporter is read-only and cannot credit a buyer from state alone',async()=>{
  let n=0;
  const client=new SafepayV3SandboxClient({env,fetchImpl:async(url,options)=>{
    n++;
    assert.equal(url,'https://sandbox.api.getsafepay.com/reporter/api/v1/payments/'+tracker);
    assert.equal(options.method,'GET');
    assert.equal(options.headers['X-SFPY-MERCHANT-SECRET'],env.SAFEPAY_SECRET_KEY);
    return {status:200,json:async()=>({data:{tracker:{...reply.data.tracker,
      state:'TRACKER_ENDED'}}})};
  }});
  const report=await client.inspectPaymentTracker({trackerToken:tracker,
    amountPkr:'1145.00',orderCode:'MILJOR-100'});
  assert.equal(n,1);
  assert.equal(report.state,'TRACKER_ENDED');
  assert.equal(report.canMarkOrderPaid,false);
  assert.equal(report.providerSignedWebhookVerified,false);
  assert.equal(report.readOnly,true);
});
test('v3 reporter rejects wrong order, amount, tracker and malformed path before network',async()=>{
  for(const mutated of [
    {...reply.data.tracker,token:'track_other_999',state:'TRACKER_ENDED'},
    {...reply.data.tracker,metadata:{order_id:'OTHER-ORDER'},state:'TRACKER_ENDED'},
    {...reply.data.tracker,purchase_totals:{quote_amount:{currency:'PKR',amount:1145}},state:'TRACKER_ENDED'},
    {...reply.data.tracker,environment:'production',state:'TRACKER_ENDED'}
  ]){
    const client=new SafepayV3SandboxClient({env,fetchImpl:async()=>({
      status:200,json:async()=>({data:{tracker:mutated}})
    })});
    await assert.rejects(()=>client.inspectPaymentTracker({trackerToken:tracker,
      amountPkr:'1145.00',orderCode:'MILJOR-100'}));
  }
  let n=0;
  const client=new SafepayV3SandboxClient({env,fetchImpl:async()=>{n++;throw Error('Unexpected')}});
  await assert.rejects(()=>client.inspectPaymentTracker({trackerToken:'track_../../etc',
    amountPkr:'1145.00',orderCode:'MILJOR-100'}),
    error=>error.code==='INVALID_TRACKER_TOKEN');
  assert.equal(n,0);
});
test('provider wrong amount, wrong order and unknown network cannot confirm',async()=>{
  for(const provider of [
    {status:201,json:async()=>({data:{tracker:{...reply.data.tracker,
      purchase_totals:{quote_amount:{currency:'PKR',amount:1145}}}}})},
    {status:201,json:async()=>({data:{tracker:{...reply.data.tracker,
      metadata:{order_id:'ANOTHER-ORDER'}}}})},
    {status:401,json:async()=>({})}
  ]){
    const client=new SafepayV3SandboxClient({env,fetchImpl:async()=>provider});
    await assert.rejects(()=>client.createPaymentTracker({
      amountPkr:'1145.00',orderCode:'MILJOR-100'}));
  }
  const client=new SafepayV3SandboxClient({env,fetchImpl:async()=>{throw Error('Timeout')}});
  await assert.rejects(()=>client.createPaymentTracker({
    amountPkr:'1145.00',orderCode:'MILJOR-100'
  }),e=>e.code==='SAFEPAY_V3_NETWORK_UNKNOWN'&&!e.message.includes(env.SAFEPAY_SECRET_KEY));
});
