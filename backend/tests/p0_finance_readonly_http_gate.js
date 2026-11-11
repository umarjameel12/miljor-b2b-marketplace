'use strict';
// Actual Express HTTP + InnoDB read-only acceptance against disposable miljor_test_db.
// Do not seed, insert, update or delete any business data here.
const assert=require('node:assert/strict');
const jwt=require('jsonwebtoken');
assert.equal(process.env.NODE_ENV,'test','Test-only execution');
assert.equal(process.env.MILJOR_TEST_ONLY_MIGRATIONS,'1','Test-only execution');
assert.equal(process.env.DB_NAME,'miljor_test_db','Protected database forbidden');
assert.equal(process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT,'false','External money must be disabled');
assert.ok(process.env.JWT_SECRET,'JWT_SECRET must be explicit in CI');
const db=require('../src/config/db');
const app=require('../server');
const auth=(id,role)=>jwt.sign({id,role,verification_status:'VERIFIED'},process.env.JWT_SECRET,
  {expiresIn:'15m',issuer:'miljor-api',audience:'miljor-app'});
const tables=['orders','payments','supplier_payables','financial_holds','refund_obligations',
  'supplier_disbursement_instructions'];
async function fingerprint(){
  const snapshot={};
  for(const table of tables){
    const [[row]]=await db.query('SELECT COUNT(*) AS n FROM '+table);
    snapshot[table]=Number(row.n);
  }
  const [[historical]]=await db.query(
    "SELECT order_code,payment_status,order_status,total_amount,supplier_commission_percent FROM orders WHERE order_code='P0-HIST-054'");
  assert.ok(historical,'Historical 053→054 synthetic fixture must exist');
  snapshot.historical=JSON.stringify(historical);
  return snapshot;
}
async function run(){
  const [[identity]]=await db.query('SELECT DATABASE() AS name');
  assert.equal(identity.name,'miljor_test_db');
  const before=await fingerprint();
  const [[historical]]=await db.query(
    "SELECT id FROM orders WHERE order_code='P0-HIST-054'");
  const orderId=historical.id;
  const server=app.listen(0);
  const base='http://127.0.0.1:'+server.address().port;
  const get=async(endpoint,token)=>{
    const response=await fetch(base+endpoint,{headers:token?{Authorization:'Bearer '+token}:{},
      signal:AbortSignal.timeout(10000)});
    return {status:response.status,body:await response.json()};
  };
  try{
    const url='/api/v1/settlements/admin/orders/'+orderId+'/integrity';
    const anonymous=await get(url);
    assert.equal(anonymous.status,401,'Unauthenticated ledger access must fail');
    const buyer=await get(url,auth(5,'BUYER'));
    assert.equal(buyer.status,403,'Buyer cannot read financial ledger');
    const supplier=await get(url,auth(2,'SUPPLIER'));
    assert.equal(supplier.status,403,'Supplier cannot read finance admin audit');
    console.log('PASS finance ledger unauthenticated/buyer/supplier denied 401/403');

    const admin=auth(1,'SUPER_ADMIN');
    const malformed=await get('/api/v1/settlements/admin/orders/nope/integrity',admin);
    assert.equal(malformed.status,400,'Bad order identifiers rejected');
    const unknown=await get('/api/v1/settlements/admin/orders/2147483647/integrity',admin);
    assert.equal(unknown.status,404,'Missing order returns 404');
    console.log('PASS finance ledger invalid and nonexistent order validation');

    const ok=await get(url,admin);
    assert.equal(ok.status,200,JSON.stringify(ok.body));
    assert.equal(ok.body.success,true);
    assert.equal(Number(ok.body.data.order_id),Number(orderId));
    assert.ok(['PASS','RECONCILIATION_REQUIRED'].includes(ok.body.data.status));
    assert.ok(Array.isArray(ok.body.data.checks));
    assert.ok(ok.body.data.checks.some(c=>c.name==='BUYER_ORDER_COMPONENTS'));
    assert.match(ok.body.data.limitations,/no provider custody/i);
    assert.ok(!JSON.stringify(ok.body.data).includes('password_hash'));
    console.log('PASS real HTTP finance admin read model',ok.body.data.status,
      'checks:',ok.body.data.checks.length);
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
  const after=await fingerprint();
  assert.deepEqual(after,before,'Ledger audit must not alter any financial/business row counts or historical order');
  console.log('PASS financial order integrity endpoint is read-only on disposable MySQL');
}
run().then(()=>process.exit(0)).catch(error=>{
  console.error('FAIL P0 FINANCE READ-ONLY HTTP ACCEPTANCE',error.stack||error);
  process.exit(1);
});
