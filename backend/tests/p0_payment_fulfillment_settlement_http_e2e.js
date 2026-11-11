'use strict';
// Real Express + disposable MySQL integration. Safepay HMAC is SYNTHETIC,
// never evidence of merchant-provider cash settlement or legal escrow.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),jwt=require('jsonwebtoken');
for(const [k,v] of Object.entries({NODE_ENV:'test',DB_NAME:'miljor_test_db',
 TEST_DB_NAME:'miljor_test_db',MILJOR_TEST_ONLY_MIGRATIONS:'1',
 ALLOW_EXTERNAL_MONEY_MOVEMENT:'false',SAFEPAY_ENV:'sandbox',
 SAFEPAY_WEBHOOK_SECRET:'p0-only-synthetic-safepay-callback-key-2026'}))
 assert.equal(process.env[k],v,'Unsafe environment: '+k);
assert.ok(process.env.JWT_SECRET?.length>=32);
const db=require('../src/config/db'),app=require('../server');
const random=()=>crypto.randomBytes(7).toString('hex');
const jwtFor=(id,role)=>jwt.sign({id,role,verification_status:'VERIFIED'},process.env.JWT_SECRET,
 {issuer:'miljor-api',audience:'miljor-app',expiresIn:'15m'});
const exact=v=>Number(v).toFixed(2);
async function main(){
 const [[identity]]=await db.query('SELECT DATABASE() AS name');
 assert.equal(identity.name,'miljor_test_db');
 const [users]=await db.query('SELECT id,role FROM users WHERE id IN (1,2,5,6) ORDER BY id');
 assert.deepEqual(users.map(x=>x.role),['SUPER_ADMIN','SUPPLIER','BUYER','BUYER']);
 const [[verified]]=await db.query('SELECT verification_status FROM supplier_profiles WHERE supplier_id=2');
 assert.equal(verified.verification_status,'VERIFIED');
 const [insert]=await db.query(
  'INSERT INTO orders(order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,delivery_fee,buyer_platform_fee,total_amount,supplier_commission_percent,currency,delivery_type,delivery_address,payment_status,order_status) '+
  "VALUES (?,5,2,10.0000,100.00,1000.00,120.00,25.00,1145.00,2.50,'PKR','DOORSTEP','Synthetic Lahore address','AWAITING_PAYMENT','AWAITING_PAYMENT')",
  ['E2E-'+random()]);
 const orderId=insert.insertId,tracker='track_e2e_'+random();
 await db.query(
  'INSERT INTO payment_attempts(attempt_code,order_id,buyer_id,provider,environment,provider_tracker_token,amount,currency,status,idempotency_key) '+
  "VALUES(?,?,5,'SAFEPAY','sandbox',?,1145.00,'PKR','INITIATED',?)",
  ['E2EA-'+random(),orderId,tracker,'E2E-I-'+random()]);
 const server=app.listen(0),base='http://127.0.0.1:'+server.address().port;
 const post=async(path,{role='BUYER',id=5,body={},key}={})=>{
   const res=await fetch(base+'/api/v1'+path,{method:'POST',signal:AbortSignal.timeout(15000),
     headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwtFor(id,role),
       ...(key?{'X-Idempotency-Key':key}:{})},body:JSON.stringify(body)});
   return {status:res.status,body:await res.json()};
 };
 const eq=(res,code)=>assert.equal(res.status,code,JSON.stringify(res.body));
 const signed=async(payload,signature)=>{
   const bytes=Buffer.from(JSON.stringify(payload));
   const sig=signature||crypto.createHmac('sha512',process.env.SAFEPAY_WEBHOOK_SECRET)
      .update(bytes).digest('hex');
   const res=await fetch(base+'/api/v1/webhooks/safepay',{method:'POST',
     signal:AbortSignal.timeout(15000),
     headers:{'Content-Type':'application/json','X-SFPY-SIGNATURE':sig,
       'X-SFPY-EVENT-ID':payload.token,'X-SFPY-EVENT-TYPE':payload.type,
       'X-SFPY-TIMESTAMP':new Date().toISOString()},body:bytes});
   return {status:res.status,body:await res.json()};
 };
 const payment={token:'evt_e2e_'+random(),type:'payment.succeeded',
   data:{tracker:{token:tracker,amount:1145,currency:'PKR'}}};
 try{
   let r=await post('/fulfillment/supplier/orders/'+orderId+'/transition',{
     role:'SUPPLIER',id:2,body:{to_status:'PREPARING'},key:'unpaid-'+random()});
   eq(r,422);assert.equal(r.body.error.code,'UNPAID_ORDER_NOT_IN_FULFILLMENT');
   r=await post('/settlements/payables/accrue',{role:'SUPER_ADMIN',id:1,body:{order_id:orderId}});
   eq(r,422);
   console.log('PASS G1 unpaid order blocks fulfillment and supplier accrual');
   r=await signed(payment,'bad-signature');eq(r,401);
   console.log('PASS G2 invalid Safepay signature denied');
   r=await signed(payment);eq(r,200);assert.equal(r.body.data.payment_status,'PAID');
   r=await signed(payment);eq(r,200);assert.equal(r.body.data.is_duplicate,true);
   const [[paid]]=await db.query('SELECT payment_status,fulfillment_status FROM orders WHERE id=?',[orderId]);
   assert.equal(paid.payment_status,'PAID');
   assert.equal(paid.fulfillment_status,'AWAITING_SUPPLIER_ACKNOWLEDGEMENT');
   const [payments]=await db.query('SELECT status,amount,escrow_status FROM payments WHERE order_id=?',[orderId]);
   assert.equal(payments.length,1);assert.equal(payments[0].status,'PAID');
   assert.equal(exact(payments[0].amount),'1145.00');
   assert.equal(payments[0].escrow_status,'HELD_IN_ESCROW');
   console.log('PASS G3 synthetic signed HTTP callback creates ONE PAID order/payment, replay safe');
   r=await post('/settlements/payables/accrue',{role:'SUPER_ADMIN',id:1,body:{order_id:orderId}});
   eq(r,201);
   const [payables]=await db.query('SELECT * FROM supplier_payables WHERE order_id=?',[orderId]);
   assert.equal(payables.length,1);
   const payable=payables[0];assert.equal(exact(payable.commission_amount),'25.00');
   assert.equal(exact(payable.net_payable_amount),'1095.00');
   console.log('PASS G4 exact commission, delivery, supplier payable conservation');
   const prepare=()=>post('/settlements/disbursements/prepare',{
     role:'SUPER_ADMIN',id:1,key:'e2e-disburse-'+orderId,
     body:{payable_id:payable.id,beneficiary_title:'Synthetic Supplier Business',
       beneficiary_iban:'PK00TEST0000000000000000'}});
   r=await prepare();eq(r,422);assert.equal(r.body.error.code,'ORDER_NOT_BUYER_CONFIRMED');
   r=await post('/fulfillment/buyer/orders/'+orderId+'/confirm-receipt',{
     key:'e2e-early-'+random()});eq(r,422);
   console.log('PASS G5 no settlement or buyer receipt before supplier delivery');
   for(const status of ['PREPARING','READY_FOR_DISPATCH','DISPATCHED','SUPPLIER_DELIVERED']){
     const key='e2e-'+orderId+'-'+status;
     const body={to_status:status};
     if(status==='DISPATCHED'){
       body.delivery_method='SUPPLIER_FLEET';
       body.supplier_delivery_reference='LOCAL-E2E-'+orderId;
     }
     r=await post('/fulfillment/supplier/orders/'+orderId+'/transition',{
       role:'SUPPLIER',id:2,key,body});
     eq(r,200);assert.equal(r.body.data.fulfillment_status,status);
     if(status==='PREPARING'){
       const replay=await post('/fulfillment/supplier/orders/'+orderId+'/transition',{
         role:'SUPPLIER',id:2,key,body});eq(replay,200);
       assert.equal(replay.body.data.fulfillment_status,status);
     }
   }
   const [[delivered]]=await db.query('SELECT fulfillment_status,buyer_confirmed_at FROM orders WHERE id=?',[orderId]);
   assert.equal(delivered.fulfillment_status,'SUPPLIER_DELIVERED');
   assert.equal(delivered.buyer_confirmed_at,null);
   r=await prepare();eq(r,422);
   console.log('PASS G6 four verified supplier milestones, delivery NOT buyer confirmation');
   r=await post('/fulfillment/buyer/orders/'+orderId+'/confirm-receipt',{
     role:'SUPPLIER',id:2,key:'e2e-fraud-'+random()});eq(r,403);
   r=await post('/fulfillment/buyer/orders/'+orderId+'/confirm-receipt',{
     role:'BUYER',id:6,key:'e2e-wrong-buyer-'+random()});eq(r,403);
   const confirmKey='e2e-confirm-'+orderId;
   r=await post('/fulfillment/buyer/orders/'+orderId+'/confirm-receipt',{
     key:confirmKey,body:{notes:'Ten units received'}});eq(r,200);
   assert.equal(r.body.data.fulfillment_status,'BUYER_CONFIRMED');
   r=await post('/fulfillment/buyer/orders/'+orderId+'/confirm-receipt',{key:confirmKey});
   eq(r,200);assert.equal(r.body.data.fulfillment_status,'BUYER_CONFIRMED');
   console.log('PASS G7 independent buyer-only receipt and idempotency');
   r=await prepare();eq(r,201);
   const [instructions]=await db.query(
     'SELECT amount,status,external_execution_status FROM supplier_disbursement_instructions WHERE order_id=?',
     [orderId]);
   assert.equal(instructions.length,1);
   assert.equal(exact(instructions[0].amount),'1095.00');
   assert.equal(instructions[0].status,'PREPARED');
   assert.equal(instructions[0].external_execution_status,'DISABLED');
   r=await prepare();eq(r,201);
   const [[totals]]=await db.query(
     'SELECT (SELECT COUNT(*) FROM payments WHERE order_id=?) AS payments,'+
     '(SELECT COUNT(*) FROM supplier_payables WHERE order_id=?) AS payables,'+
     '(SELECT COUNT(*) FROM supplier_disbursement_instructions WHERE order_id=?) AS instructions,'+
     '(SELECT COUNT(*) FROM order_fulfillment_events WHERE order_id=?) AS events',
     [orderId,orderId,orderId,orderId]);
   assert.deepEqual([totals.payments,totals.payables,totals.instructions,totals.events].map(Number),
     [1,1,1,5]);
   console.log('PASS G8 settlement prepared only after receipt: one payable, one instruction, external execution DISABLED');
   console.log('PASS REAL HTTP+MYSQL E2E with synthetic signed Safepay event; real provider and bank settlement NOT VERIFIED');
 }finally{await new Promise(resolve=>server.close(resolve));}
}
main().then(()=>process.exit(0)).catch(e=>{console.error('FAIL PAYMENT→FULFILLMENT→BUYER RECEIPT→SETTLEMENT E2E',e.stack||e);process.exit(1)});
