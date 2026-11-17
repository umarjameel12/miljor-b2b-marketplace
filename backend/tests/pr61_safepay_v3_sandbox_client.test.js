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
  token:tracker,client:env.SAFEPAY_PUBLIC_KEY,environment:'sandbox',mode:'payment',state:'TRACKER_STARTED',
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
test('hosted Express Checkout creates tracker then passport token and allowlisted hosted URL',async()=>{
  const calls=[];
  const client=new SafepayV3SandboxClient({env:{...env,FRONTEND_URL:'https://miljor.example'},
    fetchImpl:async(url,options)=>{
      calls.push({url,options});
      if(url.endsWith('/order/payments/v3/'))return {status:201,json:async()=>reply};
      if(url.endsWith('/client/passport/v1/token'))return {status:200,json:async()=>({data:'temporary_passport_token_123456'})};
      throw Error('Unexpected provider path');
    }});
  const result=await client.createHostedCheckout({amountPkr:'1145.00',
    orderCode:'MILJOR-100'});
  assert.equal(calls.length,2);
  assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[1].options.method,'POST');
  const url=new URL(result.checkoutUrl);
  assert.equal(url.origin,'https://sandbox.api.getsafepay.com');
  assert.equal(url.pathname,'/checkout/pay');
  assert.equal(url.searchParams.get('beacon'),tracker);
  assert.equal(url.searchParams.get('tbt'),'temporary_passport_token_123456');
  assert.equal(url.searchParams.get('source'),'hosted');
  assert.equal(url.searchParams.get('env'),'sandbox');
  assert.equal(url.searchParams.get('webhooks'),'true');
  assert.equal(new URL(url.searchParams.get('redirect_url')).origin,'https://miljor.example');
});
test('hosted checkout rejects external redirect before any provider tracker is created',async()=>{
  let calls=0;
  const client=new SafepayV3SandboxClient({env:{...env,FRONTEND_URL:'https://miljor.example'},
    fetchImpl:async()=>{calls++;throw Error('Must not call')}});
  await assert.rejects(()=>client.createHostedCheckout({amountPkr:'10.00',
    orderCode:'MILJOR-100',redirectUrl:'https://attacker.example/steal'}),e=>
      e.code==='SAFEPAY_V3_REDIRECT_ORIGIN_INVALID');
  assert.equal(calls,0);
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
    {...reply.data.tracker,metadata:{},state:'TRACKER_ENDED'},
    {...reply.data.tracker,metadata:undefined,state:'TRACKER_ENDED'},
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
test('provider wrong amount, wrong order, mismatched or missing merchant cannot confirm',async()=>{
  for(const badClient of ['sec_other_sandbox_merchant',undefined]){
    let calls=0;
    const client=new SafepayV3SandboxClient({env,fetchImpl:async()=>{
      calls++;
      return {status:201,json:async()=>({data:{tracker:{...reply.data.tracker,client:badClient}}})};
    }});
    await assert.rejects(()=>client.createPaymentTracker({amountPkr:'1145.00',orderCode:'MILJOR-100'}),
      e=>e.code==='SAFEPAY_V3_RESPONSE_UNVERIFIED');
    assert.equal(calls,1);
  }
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
