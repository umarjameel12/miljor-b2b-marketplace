'use strict';
// Real Express HTTP against disposable MySQL. Test-only unpaid order fixture.
// Validates tenant isolation, buyer/supplier visibility and financial boundaries.
// Does NOT initiate provider payment or claim full fulfillment E2E.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const jwt=require('jsonwebtoken');
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.DB_NAME,'miljor_test_db');
assert.equal(process.env.TEST_DB_NAME,'miljor_test_db');
assert.equal(process.env.MILJOR_TEST_ONLY_MIGRATIONS,'1');
assert.equal(process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT,'false');
const db=require('../src/config/db');
const app=require('../server');
const pass=x=>console.log('PASS P0 ORDER HTTP: '+x);
async function main(){
  const [[identity]]=await db.query('SELECT DATABASE() AS db');
  assert.equal(identity.db,'miljor_test_db');
  const [[pool]]=await db.query(
    "SELECT p.id,p.supplier_id FROM pools p JOIN users s ON s.id=p.supplier_id WHERE s.role='SUPPLIER' ORDER BY p.id DESC LIMIT 1"
  );
  assert.ok(pool,'Historical B4/B5 gate must seed a supplier-owned Regular pool');
  const nonce=crypto.randomBytes(5).toString('hex');
  const created=[];
  const createBuyer=async role=>{
    const [x]=await db.query(
      "INSERT INTO users (full_name,email,phone,password_hash,role,verification_status,is_verified,buyer_trust_status,city,area) VALUES (?,?,?,'testhash','BUYER','VERIFIED',1,'CONTACT_VERIFIED','Lahore','Gulberg')",
      ['P0 Order HTTP '+role,role+'_'+nonce+'@miljor.test','+92318'+String(Math.floor(Math.random()*1e7)).padStart(7,'0')]
    );
    created.push(x.insertId);
    return x.insertId;
  };
  const buyer=await createBuyer('owner');
  const unrelated=await createBuyer('unrelated');
  const code='ISO-'+crypto.randomBytes(4).toString('hex');
  const [insert]=await db.query(
    `INSERT INTO orders (order_code,buyer_id,supplier_id,pool_id,total_qty,unit_price,subtotal_amount,delivery_fee,buyer_platform_fee,total_amount,supplier_commission_percent,currency,delivery_type,delivery_address,payment_status,order_status)
     VALUES (?,?,?,?,10,100,1000,120,25,1145,2.50,'PKR','DOORSTEP','Gulberg Lahore Pakistan','AWAITING_PAYMENT','AWAITING_PAYMENT')`,
    [code,buyer,pool.supplier_id,pool.id]
  );
  const orderId=insert.insertId;
  const secret=process.env.JWT_SECRET;
  assert.ok(secret&&secret.length>=32,'CI test JWT secret required');
  const token=(id,role)=>jwt.sign({id,role,verification_status:'VERIFIED'},secret,
    {expiresIn:'10m',issuer:'miljor-api',audience:'miljor-app'});
  const server=app.listen(0);
  const base='http://127.0.0.1:'+server.address().port;
  const req=async(path,id,role,method='GET')=>{
    const res=await fetch(base+'/api/v1'+path,{method,
      headers:{Authorization:'Bearer '+token(id,role),
        'Content-Type':'application/json','X-Idempotency-Key':'P0-AUTHZ-'+nonce+'-'+role+'-'+id},
      body:method==='POST'?'{}':undefined,signal:AbortSignal.timeout(15000)});
    const raw=await res.text();
    let body;try{body=JSON.parse(raw)}catch{body={raw}};
    return {status:res.status,body};
  };
  try{
    const ownerList=await req('/orders',buyer,'BUYER');
    assert.equal(ownerList.status,200,JSON.stringify(ownerList.body));
    assert.ok(ownerList.body.data.orders.some(x=>Number(x.id)===orderId),
      'Buyer cannot see owned unpaid order');
    pass('Buyer sees own unpaid order in order list');

    const supplierList=await req('/orders',pool.supplier_id,'SUPPLIER');
    assert.equal(supplierList.status,200,JSON.stringify(supplierList.body));
    assert.ok(supplierList.body.data.orders.some(x=>Number(x.id)===orderId),
      'Assigned supplier cannot see own order');
    pass('Assigned supplier sees legitimate unpaid order');

    const otherList=await req('/orders',unrelated,'BUYER');
    assert.equal(otherList.status,200,JSON.stringify(otherList.body));
    assert.ok(!otherList.body.data.orders.some(x=>Number(x.id)===orderId),
      'Unrelated buyer leaked another buyer order in list');
    pass('Unrelated buyer order listing is tenant isolated');

    const ownDetail=await req('/orders/'+orderId,buyer,'BUYER');
    assert.equal(ownDetail.status,200,JSON.stringify(ownDetail.body));
    assert.equal(ownDetail.body.data.order.payment_status,'AWAITING_PAYMENT');
    assert.equal(ownDetail.body.data.order.financial_breakdown.total_payable_amount,1145);
    pass('Owned order detail preserves exact test payable and unpaid state');

    assert.equal((await req('/orders/'+orderId,pool.supplier_id,'SUPPLIER')).status,200);
    assert.equal((await req('/orders/'+orderId,unrelated,'BUYER')).status,403);
    pass('Only owner/assigned supplier may read order detail');

    const buyerStatus=await req('/orders/'+orderId+'/payment-status',buyer,'BUYER');
    assert.equal(buyerStatus.status,200,JSON.stringify(buyerStatus.body));
    assert.equal(buyerStatus.body.data.payment_status,'AWAITING_PAYMENT');
    assert.equal(buyerStatus.body.data.lifecycle_phase,'CHECKOUT_NOT_STARTED');
    pass('Unpaid order status is truthful and has no implicit provider success');

    assert.equal((await req('/orders/'+orderId+'/payment-status',unrelated,'BUYER')).status,403);
    assert.equal((await req('/orders/'+orderId+'/payment-status',pool.supplier_id,'SUPPLIER')).status,403);
    pass('Provider payment metadata is restricted to owning buyer');

    assert.equal((await req('/orders/'+orderId+'/checkout',pool.supplier_id,'SUPPLIER','POST')).status,403);
    assert.equal((await req('/orders/'+orderId+'/checkout',unrelated,'BUYER','POST')).status,403);
    pass('Supplier and unrelated buyer cannot initiate checkout');

    const [[after]]=await db.query('SELECT payment_status,order_status,total_amount FROM orders WHERE id=?',[orderId]);
    assert.equal(after.payment_status,'AWAITING_PAYMENT');
    assert.equal(after.order_status,'AWAITING_PAYMENT');
    assert.equal(Number(after.total_amount),1145);
    const [[attempts]]=await db.query('SELECT COUNT(*) AS total FROM payment_attempts WHERE order_id=?',[orderId]);
    assert.equal(Number(attempts.total),0);
    pass('Cross-role negative tests did not create payment attempts or mutate order');

    console.log('PASS P0 REAL EXPRESS ORDER TENANT AUTHORIZATION GATE; provider checkout and fulfillment E2E NOT TESTED');
  }finally{
    await new Promise(resolve=>server.close(resolve));
    // Disposable DB only: leave fixture in CI-owned environment for diagnostics.
  }
}
main().then(()=>process.exit(0)).catch(e=>{
  console.error('FAIL P0 REAL EXPRESS ORDER TENANT AUTHORIZATION',e.stack||e);
  process.exit(1);
});
