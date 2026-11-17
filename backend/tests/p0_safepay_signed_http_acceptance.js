'use strict';
// TEST-ONLY synthetic signed Safepay HTTP integration. NOT a provider-originated callback.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.DB_NAME,'miljor_test_db');
assert.equal(process.env.MILJOR_TEST_ONLY_MIGRATIONS,'1');
assert.equal(process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT,'false');
assert.equal(process.env.SAFEPAY_ENV,'sandbox');
assert.equal(process.env.SAFEPAY_WEBHOOK_SECRET,'p0-only-synthetic-safepay-callback-key-2026');
const db=require('../src/config/db'),app=require('../server');
const adapter=require('../src/services/safepayAdapter');
assert.equal(adapter.webhookSecret,process.env.SAFEPAY_WEBHOOK_SECRET);
const id=()=>crypto.randomBytes(7).toString('hex');
const hmac=buf=>crypto.createHmac('sha512',process.env.SAFEPAY_WEBHOOK_SECRET).update(buf).digest('hex');
async function main(){
  const [[identity]]=await db.query('SELECT DATABASE() AS db');
  assert.equal(identity.db,'miljor_test_db');
  const server=app.listen(0),base='http://127.0.0.1:'+server.address().port;
  async function post(payload,options={}){
    const bytes=Buffer.from(JSON.stringify(payload));
    const res=await fetch(base+'/api/v1/webhooks/safepay',{
      method:'POST',signal:AbortSignal.timeout(12000),
      headers:{'Content-Type':'application/json','X-SFPY-SIGNATURE':options.signature||hmac(bytes),
        'X-SFPY-EVENT-ID':options.eventId||'evt_p0_'+id(),
        'X-SFPY-EVENT-TYPE':options.eventType||'payment.succeeded','X-SFPY-TIMESTAMP':new Date().toISOString()},
      body:options.tamper?Buffer.concat([bytes,Buffer.from(' ')]):bytes
    });
    return {status:res.status,data:await res.json()};
  }
  const payload=(tracker,amount=1145,currency='PKR')=>({
    token:'evt_'+id(),type:'payment.succeeded',data:{tracker:{token:tracker,amount,currency}}
  });
  try{
    const [o]=await db.query(
      'INSERT INTO orders(order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,delivery_fee,buyer_platform_fee,total_amount,supplier_commission_percent,currency,delivery_type,delivery_address,payment_status,order_status) VALUES(?,5,2,100.0000,10.00,1000.00,120.00,25.00,1145.00,2.50,?,?,?, ?,?)',
      ['SFP-'+crypto.randomBytes(4).toString('hex'),'PKR','DOORSTEP','Synthetic Lahore address','AWAITING_PAYMENT','AWAITING_PAYMENT']
    );
    // Exact test-only 100kg / PKR10 fixture for downstream 80-received/20-short integration.
    // It is never a genuine provider-originated payment or a production order.
    const order=o.insertId,tracker='track_p0_'+id();
    await db.query(
      'INSERT INTO payment_attempts(attempt_code,order_id,buyer_id,provider,environment,provider_tracker_token,amount,currency,status,idempotency_key) VALUES(?,?,5,?,?,?,?,?,?,?)',
      ['P0A-'+id(),order,'SAFEPAY','sandbox',tracker,1145,'PKR','INITIATED','P0-I-'+id()]
    );
    let r=await post(payload(tracker),{signature:'invalid'});
    assert.equal(r.status,401,'Invalid signature must be rejected');
    r=await post(payload(tracker),{tamper:true});
    assert.equal(r.status,401,'Tampered raw bytes must be rejected');
    r=await post({type:'payment.failed',token:'evt_'+id(),
      data:{tracker:{token:tracker,amount:1145,currency:'PKR'}}});
    assert.equal(r.status,422,'Unsigned header cannot convert signed failed event to success');
    r=await post({type:'payment.failed',token:'evt_'+id(),
      data:{tracker:{token:tracker,amount:1145,currency:'PKR'}}},
      {eventType:'payment.failed'});
    assert.equal(r.status,200,'Signed failed event is recorded without payment transition');
    let [[state]]=await db.query('SELECT order_status FROM orders WHERE id=?',[order]);
    assert.equal(state.order_status,'AWAITING_PAYMENT');
    console.log('PASS signed HTTP invalid/tampered HMAC cannot pay an order');
    r=await post(payload(tracker,1144.99));assert.equal(r.status,422,'Amount tampering');
    r=await post(payload(tracker,1145,'USD'));assert.equal(r.status,422,'Currency tampering');
    [[state]]=await db.query('SELECT order_status FROM orders WHERE id=?',[order]);
    assert.equal(state.order_status,'AWAITING_PAYMENT');
    console.log('PASS signed HTTP amount and currency mismatch fail closed');
    const unknown='track_unknown_'+id();
    r=await post(payload(unknown));assert.equal(r.status,200);
    assert.equal(r.data.data.status,'RECONCILIATION_REQUIRED');
    console.log('PASS untracked signed provider token quarantined');
    // Unsigned header collision must not suppress a different signed event.
    const collidedHeader='evt_unsigned_collision_'+id();
    // A provider may reuse the same authenticated token for distinct statuses.
    // A failed event must never suppress the later succeeded transition.
    const sharedSignedToken='evt_shared_'+id();
    const signedFailed={token:sharedSignedToken,type:'payment.failed',
      data:{tracker:{token:tracker,amount:1145,currency:'PKR'}}};
    r=await post(signedFailed,{eventId:collidedHeader,eventType:'payment.failed'});
    assert.equal(r.status,200,'Authenticated failed event should be recorded without charging');
    const event={...payload(tracker),token:sharedSignedToken},eventId=collidedHeader;
    const signedPayloadId=p=>'evt_sha256_'+crypto.createHash('sha256')
      .update(Buffer.from(JSON.stringify(p))).digest('hex');
    assert.notEqual(signedPayloadId(event),signedPayloadId(signedFailed),
      'Different authenticated transitions must have distinct dedupe identities');
    r=await post(event,{eventId});assert.equal(r.status,200,JSON.stringify(r.data));
    assert.equal(r.data.data.payment_status,'PAID');
    const [orders]=await db.query('SELECT order_status,payment_status,fulfillment_status FROM orders WHERE id=?',[order]);
    assert.equal(orders[0].order_status,'PAID');
    assert.equal(orders[0].payment_status,'PAID');
    assert.equal(orders[0].fulfillment_status,'AWAITING_SUPPLIER_ACKNOWLEDGEMENT');
    const [payments]=await db.query('SELECT amount,status,escrow_status FROM payments WHERE order_id=?',[order]);
    assert.equal(payments.length,1);
    assert.equal(String(payments[0].amount),'1145.00');
    assert.equal(payments[0].status,'PAID');
    assert.equal(payments[0].escrow_status,'HELD_IN_ESCROW');
    const [attempts]=await db.query('SELECT status FROM payment_attempts WHERE order_id=?',[order]);
    assert.equal(attempts[0].status,'COMPLETED');
    console.log('PASS synthetic provider-signed callback -> exact payment and HELD escrow');
    r=await post(event,{eventId});
    assert.equal(r.status,200);assert.equal(r.data.data.is_duplicate,true);
    r=await post(event,{eventId:'evt_retry_'+id()});
    assert.equal(r.status,200);assert.equal(r.data.data.is_duplicate,true);
    const [[signedEventCount]]=await db.query(
      'SELECT COUNT(*) AS n FROM payment_webhook_events WHERE event_id=?',[signedPayloadId(event)]);
    assert.equal(Number(signedEventCount.n),1,'Exact authenticated payload identity must be stable under changed unsigned headers');
    const [[failedEventCount]]=await db.query(
      'SELECT COUNT(*) AS n FROM payment_webhook_events WHERE event_id=?',[signedPayloadId(signedFailed)]);
    assert.equal(Number(failedEventCount.n),1,'Failed and successful signed statuses sharing a token must not collide');
    const [[ignoredHeaderCount]]=await db.query(
      'SELECT COUNT(*) AS n FROM payment_webhook_events WHERE event_id=?',[collidedHeader]);
    assert.equal(Number(ignoredHeaderCount.n),0,'Unsigned event header must not become authoritative record identity');
    const [[counts]]=await db.query(
      'SELECT (SELECT COUNT(*) FROM payments WHERE order_id=?) AS payments,(SELECT COUNT(*) FROM payment_webhook_events WHERE order_id=? AND processed_status=?) AS processed',
      [order,order,'PROCESSED']);
    assert.equal(Number(counts.payments),1);
    assert.equal(Number(counts.processed),1);
    console.log('PASS repeated signed callbacks produce exactly one PAID payment');

    // V3 provider webhooks use integer minor units. This test pins the contract
    // on the durable attempt and proves 100x values cannot be guessed/accepted.
    const v3OrderCode='SFPV3-'+crypto.randomBytes(4).toString('hex');
    const [v3OrderInsert]=await db.query(
      'INSERT INTO orders(order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,delivery_fee,buyer_platform_fee,total_amount,supplier_commission_percent,currency,delivery_type,delivery_address,payment_status,order_status) VALUES(?,5,2,100.0000,10.00,1000.00,120.00,25.00,1145.00,2.50,?,?,?, ?,?)',
      [v3OrderCode,'PKR','DOORSTEP','Synthetic V3 test address','AWAITING_PAYMENT','AWAITING_PAYMENT']
    );
    const v3OrderId=v3OrderInsert.insertId,v3Tracker='track_p0_v3_'+id();
    await db.query(
      "INSERT INTO payment_attempts(attempt_code,order_id,buyer_id,provider,environment,provider_contract,provider_tracker_token,amount,currency,status,idempotency_key) VALUES(?,?,5,'SAFEPAY','sandbox','payments-v3-minor',?,?,'PKR','INITIATED',?)",
      ['P0V3-'+id(),v3OrderId,v3Tracker,'1145.00','P0V3-I-'+id()]
    );
    const v3Event=()=>({token:'evt_v3_'+id(),version:'2.0.0',
      merchant_api_key:process.env.SAFEPAY_PUBLIC_KEY,type:'payment.succeeded',
      data:{tracker:v3Tracker,state:'TRACKER_ENDED',amount:114500,currency:'PKR',
        metadata:{order_id:v3OrderCode}}});
    r=await post({...v3Event(),data:{...v3Event().data,amount:114499}});
    assert.equal(r.status,422,'V3 minor-unit amount mismatch must fail');
    r=await post({...v3Event(),data:{...v3Event().data,state:'TRACKER_AUTHORIZED'}});
    assert.equal(r.status,422,'V3 authorization is not capture');
    r=await post({...v3Event(),merchant_api_key:'sec_wrong_merchant'});
    assert.equal(r.status,422,'V3 merchant mismatch must fail');
    r=await post({...v3Event(),data:{...v3Event().data,metadata:{}}});
    assert.equal(r.status,422,'V3 signed callback missing order reference must fail closed');
    r=await post(v3Event());
    assert.equal(r.status,200,JSON.stringify(r.data));
    assert.equal(r.data.data.payment_status,'PAID');
    const [[v3Payment]]=await db.query('SELECT amount,status,escrow_status FROM payments WHERE order_id=?',[v3OrderId]);
    assert.equal(String(v3Payment.amount),'1145.00');
    assert.equal(v3Payment.status,'PAID');
    assert.equal(v3Payment.escrow_status,'HELD_IN_ESCROW');
    const [[v3Attempt]]=await db.query('SELECT status,provider_contract FROM payment_attempts WHERE order_id=?',[v3OrderId]);
    assert.equal(v3Attempt.status,'COMPLETED');
    assert.equal(v3Attempt.provider_contract,'payments-v3-minor');
    console.log('PASS Safepay v3 signed webhook converts exact 114500 minor units to PKR 1145.00 and HELD escrow');
    // Supplier one-time plan invoices are isolated from buyer escrow/payment.
    // An HMAC-authenticated v3 callback must journal exact capture evidence
    // and activate the supplier's paid entitlement exactly once.
    const [[plan]]=await db.query(
      'SELECT monthly_price_pkr,max_active_listings FROM subscription_plans WHERE plan_code=?',
      ['GROWTH']);
    assert.ok(plan,'GROWTH plan must be seeded in disposable MySQL');
    await db.query(
      "UPDATE supplier_profiles SET verification_status='VERIFIED',subscription_plan='STARTER' WHERE supplier_id=2");
    const [[beforeSubs]]=await db.query(
      'SELECT COUNT(*) AS count FROM supplier_subscriptions WHERE supplier_id=2');
    const subTracker='track_sub_'+id();
    const [newAttempt]=await db.query(
      "INSERT INTO supplier_subscription_checkout_attempts (supplier_id,plan_code,amount_pkr,idempotency_key,status,provider_contract,tracker_token) VALUES (2,'GROWTH',?,?,'INITIATED','payments-v3-minor',?)",
      [plan.monthly_price_pkr,'P0SUB-'+id(),subTracker]);
    const subId=newAttempt.insertId,subCode='MILJOR-SUB-'+subId;
    const minor=Number(require('../src/services/safepayV3ContractService').toMinorPkr(plan.monthly_price_pkr));
    const subEvent={token:'evt_subscription_'+id(),type:'payment.succeeded',
      merchant_api_key:process.env.SAFEPAY_PUBLIC_KEY,
      data:{tracker:subTracker,state:'TRACKER_ENDED',amount:minor,
        currency:'PKR',metadata:{order_id:subCode}}};
    r=await post({...subEvent,merchant_api_key:'sec_wrong_merchant'});
    assert.equal(r.status,422,'Other merchant cannot credit supplier subscription');
    r=await post({...subEvent,data:{...subEvent.data,amount:minor-1}});
    assert.equal(r.status,422,'Wrong minor-unit amount cannot activate supplier subscription');
    r=await post({...subEvent,data:{...subEvent.data,metadata:{order_id:'MILJOR-SUB-999999'}}});
    assert.notEqual(r.status,200,'Wrong supplier invoice cannot activate a plan');
    r=await post({...subEvent,data:{...subEvent.data,state:'TRACKER_AUTHORIZED'}});
    assert.equal(r.status,422,'Authorized but uncaptured supplier charge cannot activate plan');
    const [[beforeAttempt]]=await db.query(
      'SELECT status FROM supplier_subscription_checkout_attempts WHERE id=?',[subId]);
    assert.equal(beforeAttempt.status,'INITIATED');
    r=await post(subEvent);
    assert.equal(r.status,200,JSON.stringify(r.data));
    assert.equal(r.data.data.payment_status,'PAID');
    const [[activated]]=await db.query(
      'SELECT subscription_plan FROM supplier_profiles WHERE supplier_id=2');
    assert.equal(activated.subscription_plan,'GROWTH');
    const [[paidAttempt]]=await db.query(
      'SELECT status,paid_subscription_id FROM supplier_subscription_checkout_attempts WHERE id=?',[subId]);
    assert.equal(paidAttempt.status,'PAID');
    assert.ok(paidAttempt.paid_subscription_id);
    const [[captureCount]]=await db.query(
      'SELECT COUNT(*) AS count FROM supplier_subscription_capture_events WHERE checkout_attempt_id=?',[subId]);
    assert.equal(Number(captureCount.count),1,'Signed supplier capture must be journaled once');
    r=await post(subEvent);
    assert.equal(r.status,200);
    assert.equal(r.data.data.is_duplicate,true);
    // Even after activation, changed merchant/amount is not a valid replay.
    r=await post({...subEvent,merchant_api_key:'sec_wrong_merchant'});
    assert.equal(r.status,422,'Paid supplier must still reject a different merchant');
    r=await post({...subEvent,data:{...subEvent.data,amount:minor+1}});
    assert.equal(r.status,422,'Paid supplier must still reject a different captured amount');
    r=await post({...subEvent,token:'evt_independent_retry_'+id()});
    assert.equal(r.status,200);
    assert.equal(r.data.data.is_duplicate,true);
    const [[afterSubs]]=await db.query(
      'SELECT COUNT(*) AS count FROM supplier_subscriptions WHERE supplier_id=2');
    assert.equal(Number(afterSubs.count),Number(beforeSubs.count)+1,
      'Provider callback retries may activate only ONE supplier paid subscription');
    const [[postCaptureCount]]=await db.query(
      'SELECT COUNT(*) AS count FROM supplier_subscription_capture_events WHERE checkout_attempt_id=?',[subId]);
    assert.equal(Number(postCaptureCount.count),1);
    console.log('PASS v3 supplier HMAC callback -> exact one-time paid plan/journal; merchant/amount/state tampering blocked; replay safe');
    console.log('PASS P0 SYNTHETIC SIGNED HTTP ACCEPTANCE; REAL PROVIDER CALLBACK NOT ATTESTED');
  }finally{await new Promise(resolve=>server.close(resolve))}
}
main().then(()=>process.exit(0)).catch(e=>{
  console.error('FAIL P0 SYNTHETIC SAFEPAY',e.stack||e);process.exit(1)
});
