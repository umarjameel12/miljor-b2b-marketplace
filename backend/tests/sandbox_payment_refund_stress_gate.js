'use strict';
// MilJor P0: deterministic concurrent synthetic Safepay payment/refund stress.
// NO provider traffic, NO actual money movement, NO shared database mutation.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const jwt=require('jsonwebtoken');
for(const [key,value] of Object.entries({
  NODE_ENV:'test',DB_NAME:'miljor_test_db',TEST_DB_NAME:'miljor_test_db',
  MILJOR_TEST_ONLY_MIGRATIONS:'1',ALLOW_EXTERNAL_MONEY_MOVEMENT:'false',
  SAFEPAY_ENV:'sandbox',SAFEPAY_WEBHOOK_SECRET:'ci-synthetic-safepay-stress-only-2026'
}))assert.equal(process.env[key],value,'Unsafe stress-test environment: '+key);
assert.ok(process.env.JWT_SECRET?.length>=32);
const db=require('../src/config/db');
const app=require('../server');
const uid=()=>crypto.randomBytes(8).toString('hex');
const token=(id,role)=>jwt.sign({id,role,verification_status:'VERIFIED'},process.env.JWT_SECRET,{issuer:'miljor-api',audience:'miljor-app',expiresIn:'15m'});
const round=v=>Number(v).toFixed(2);
async function run(){
  const [[database]]=await db.query('SELECT DATABASE() AS name');
  assert.equal(database.name,'miljor_test_db');
  const [users]=await db.query('SELECT id,role FROM users WHERE id IN (1,2,5,6) ORDER BY id');
  assert.deepEqual(users.map(x=>x.role),['SUPER_ADMIN','SUPPLIER','BUYER','BUYER']);
  const [created]=await db.query(
    'INSERT INTO orders(order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,delivery_fee,buyer_platform_fee,total_amount,supplier_commission_percent,currency,delivery_type,delivery_address,payment_status,order_status) '+
    "VALUES (?,5,2,10.0000,100.00,1000.00,120.00,25.00,1145.00,2.50,'PKR','DOORSTEP','Stress-only Lahore address','AWAITING_PAYMENT','AWAITING_PAYMENT')",
    ['STR-'+uid()]);
  const orderId=created.insertId, tracker='track_stress_'+uid(), evt='evt_stress_'+uid();
  await db.query(
    'INSERT INTO payment_attempts(attempt_code,order_id,buyer_id,provider,environment,provider_tracker_token,amount,currency,status,idempotency_key) '+
    "VALUES(?,?,5,'SAFEPAY','sandbox',?,1145.00,'PKR','INITIATED',?)",
    ['STA-'+uid(),orderId,tracker,'STRESS-'+uid()]);
  const server=app.listen(0);
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const send=async(path,{method='POST',body={},id=5,role='BUYER',key}={})=>{
    const r=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token(id,role),...(key?{'X-Idempotency-Key':key}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
    return {status:r.status,data:await r.json()};
  };
  const webhook=async(obj,signature=null)=>{
    const raw=Buffer.from(JSON.stringify(obj));
    const sig=signature===null?crypto.createHmac('sha512',process.env.SAFEPAY_WEBHOOK_SECRET).update(raw).digest('hex'):signature;
    const r=await fetch(base+'/api/v1/webhooks/safepay',{method:'POST',headers:{
      'Content-Type':'application/json','X-SFPY-SIGNATURE':sig,'X-SFPY-EVENT-ID':obj.token,
      'X-SFPY-EVENT-TYPE':obj.type,'X-SFPY-TIMESTAMP':new Date().toISOString()
    },body:raw,signal:AbortSignal.timeout(25000)});
    return {status:r.status,data:await r.json()};
  };
  const event={token:evt,type:'payment.succeeded',data:{tracker:{token:tracker,amount:1145,currency:'PKR'}}};
  const eq=(res,expected)=>assert.equal(res.status,expected,JSON.stringify(res.data).slice(0,750));
  try{
    let x=await webhook(event,'invalid-hmac');eq(x,401);
    const badAmount={token:'evt_wrong_amount_'+uid(),type:'payment.succeeded',
      data:{tracker:{token:tracker,amount:1,currency:'PKR'}}};
    x=await webhook(badAmount);
    assert.notEqual(x.status,200,'Forged incorrect amount cannot become paid');
    const [[initial]]=await db.query('SELECT payment_status FROM orders WHERE id=?',[orderId]);
    assert.equal(initial.payment_status,'AWAITING_PAYMENT');
    console.log('PASS S01 invalid signature and mismatched amount cannot mark PAID');

    // Burst 30 identical concurrent signed callbacks: only ONE paid transaction
    // and ONE invoice, all requests must be safely acknowledged/idempotent.
    const burst=await Promise.all(Array.from({length:30},()=>webhook(event)));
    const failures=burst.filter(x=>x.status!==200);
    assert.equal(failures.length,0,'Concurrent duplicate webhook must not 500: '+JSON.stringify(failures.slice(0,3)));
    const [paymentRows]=await db.query('SELECT id,amount,status,escrow_status FROM payments WHERE order_id=?',[orderId]);
    const [events]=await db.query('SELECT event_id FROM payment_webhook_events WHERE event_id=?',[evt]);
    const [invoiceRows]=await db.query('SELECT id FROM invoices WHERE order_id=?',[orderId]);
    const [[order]]=await db.query('SELECT payment_status,fulfillment_status FROM orders WHERE id=?',[orderId]);
    assert.equal(order.payment_status,'PAID');
    assert.equal(paymentRows.length,1);
    assert.equal(events.length,1);
    assert.equal(invoiceRows.length,1);
    assert.equal(paymentRows[0].escrow_status,'HELD_IN_ESCROW');
    assert.equal(round(paymentRows[0].amount),'1145.00');
    console.log('PASS S02 30 concurrent valid sandbox-signed webhook events give 1 payment / 1 event / 1 invoice');

    // Parallel duplicate provider callbacks after processing must remain idempotent.
    const replay=await Promise.all(Array.from({length:50},()=>webhook(event)));
    assert.ok(replay.every(r=>r.status===200),'Replayed callback burst must all acknowledge');
    const [[after]]=await db.query('SELECT COUNT(*) AS count FROM payments WHERE order_id=?',[orderId]);
    assert.equal(Number(after.count),1);
    console.log('PASS S03 50 webhook retries do not create duplicate money');

    x=await send('/settlements/payables/accrue',{id:1,role:'SUPER_ADMIN',body:{order_id:orderId}});eq(x,201);
    const [[payable]]=await db.query('SELECT id,available_amount FROM supplier_payables WHERE order_id=?',[orderId]);
    x=await send('/settlements/disbursements/prepare',{id:1,role:'SUPER_ADMIN',key:'early-payout-'+uid(),
      body:{payable_id:payable.id,beneficiary_title:'Test Supplier',beneficiary_iban:'PK00TEST0000000000000000'}});eq(x,422);
    console.log('PASS S04 cannot prepare supplier payout before buyer receipt');

    // Assess FULL refund on the synthetic paid order, approve internally.
    // The buyer gets a recorded obligation, NOT a fake provider-confirmed refund.
    const refundKey='stress-refund-'+uid();
    x=await send('/settlements/refunds/assess',{key:refundKey,body:{order_id:orderId,refund_type:'FULL',reason:'Sandbox-only full refund scenario'}});eq(x,201);
    const refund=x.data.data.refund;
    assert.equal(round(refund.total_refund_amount),'1145.00');
    assert.equal(refund.external_execution_status,'DISABLED');
    let r=await send('/settlements/refunds/assess',{key:refundKey,body:{order_id:orderId,refund_type:'FULL',reason:'Sandbox-only full refund scenario'}});
    eq(r,201);assert.equal(Number(r.data.data.refund.id),Number(refund.id));
    r=await send('/settlements/refunds/'+refund.id+'/approve',{id:2,role:'SUPPLIER'});eq(r,403);
    r=await send('/settlements/refunds/'+refund.id+'/approve',{id:1,role:'SUPER_ADMIN'});eq(r,200);
    const [[approved]]=await db.query('SELECT status,external_execution_status,total_refund_amount FROM refund_obligations WHERE id=?',[refund.id]);
    assert.equal(approved.status,'APPROVED');
    assert.equal(approved.external_execution_status,'DISABLED');
    assert.equal(round(approved.total_refund_amount),'1145.00');
    r=await send('/settlements/refunds/'+refund.id+'/confirm-manual',{id:1,role:'SUPER_ADMIN'});eq(r,409);
    assert.equal(r.data.error.code,'PROVIDER_REFUND_VERIFICATION_REQUIRED');
    console.log('PASS S05 synthetic full refund assessed and approved once; provider money return NOT fabricated');

    // No second full refund can exceed captured money after an approved claim.
    r=await send('/settlements/refunds/assess',{key:'refund-overpay-'+uid(),
      body:{order_id:orderId,refund_type:'FULL',reason:'Attempt second full refund'}});
    eq(r,422);
    console.log('PASS S06 full refund is capped; duplicate and privilege-escalation attempts rejected');

    console.log('PASS ALL SAFEPAY SYNTHETIC PAYMENT + REFUND + CONCURRENCY ACCEPTANCE TESTS');
  }finally{await new Promise(resolve=>server.close(resolve));}
}
run().then(()=>process.exit(0)).catch(e=>{console.error('FAIL sandbox/refund stress gate',e.stack||e);process.exit(1)});
