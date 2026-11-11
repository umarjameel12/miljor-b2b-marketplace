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
        'X-SFPY-EVENT-TYPE':'payment.succeeded','X-SFPY-TIMESTAMP':new Date().toISOString()},
      body:options.tamper?Buffer.concat([bytes,Buffer.from(' ')]):bytes
    });
    return {status:res.status,data:await res.json()};
  }
  const payload=(tracker,amount=1145,currency='PKR')=>({
    token:'evt_'+id(),type:'payment.succeeded',data:{tracker:{token:tracker,amount,currency}}
  });
  try{
    const [o]=await db.query(
      'INSERT INTO orders(order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,delivery_fee,buyer_platform_fee,total_amount,supplier_commission_percent,currency,delivery_type,delivery_address,payment_status,order_status) VALUES(?,5,2,10.0000,100.00,1000.00,120.00,25.00,1145.00,2.50,?,?,?, ?,?)',
      ['SFP-'+crypto.randomBytes(4).toString('hex'),'PKR','DOORSTEP','Synthetic Lahore address','AWAITING_PAYMENT','AWAITING_PAYMENT']
    );
    const order=o.insertId,tracker='track_p0_'+id();
    await db.query(
      'INSERT INTO payment_attempts(attempt_code,order_id,buyer_id,provider,environment,provider_tracker_token,amount,currency,status,idempotency_key) VALUES(?,?,5,?,?,?,?,?,?,?)',
      ['P0A-'+id(),order,'SAFEPAY','sandbox',tracker,1145,'PKR','INITIATED','P0-I-'+id()]
    );
    let r=await post(payload(tracker),{signature:'invalid'});
    assert.equal(r.status,401,'Invalid signature must be rejected');
    r=await post(payload(tracker),{tamper:true});
    assert.equal(r.status,401,'Tampered raw bytes must be rejected');
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
    const event=payload(tracker),eventId='evt_final_'+id();
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
    const [[counts]]=await db.query(
      'SELECT (SELECT COUNT(*) FROM payments WHERE order_id=?) AS payments,(SELECT COUNT(*) FROM payment_webhook_events WHERE order_id=? AND processed_status=?) AS processed',
      [order,order,'PROCESSED']);
    assert.equal(Number(counts.payments),1);
    assert.equal(Number(counts.processed),1);
    console.log('PASS repeated signed callbacks produce exactly one PAID payment');
    console.log('PASS P0 SYNTHETIC SIGNED HTTP ACCEPTANCE; REAL PROVIDER CALLBACK NOT ATTESTED');
  }finally{await new Promise(resolve=>server.close(resolve))}
}
main().then(()=>process.exit(0)).catch(e=>{
  console.error('FAIL P0 SYNTHETIC SAFEPAY',e.stack||e);process.exit(1)
});
