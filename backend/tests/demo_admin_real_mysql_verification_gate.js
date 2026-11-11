'use strict';
const assert=require('node:assert/strict');
const jwt=require('jsonwebtoken');
const db=require('../src/config/db');
const app=require('../server');
let passed=0;
const pass=x=>console.log('PASS ADMIN MYSQL '+(++passed)+': '+x);
async function main(){
  for(const [k,value] of Object.entries({
    NODE_ENV:'test',DB_NAME:'miljor_test_db',TEST_DB_NAME:'miljor_test_db',
    MILJOR_TEST_ONLY_MIGRATIONS:'1'
  }))assert.equal(process.env[k],value,'PROTECTED_DB_ABORT '+k);
  const [[identity]]=await db.query('SELECT DATABASE() AS db');
  assert.equal(identity.db,'miljor_test_db');
  const [[buyer]]=await db.query('SELECT id,role,is_verified,verification_status FROM users WHERE id=5');
  const [[supplier]]=await db.query('SELECT id,role,is_verified,verification_status FROM users WHERE id=2');
  const [[profile]]=await db.query(
    'SELECT supplier_id,verification_status,verification_level,subscription_plan,max_active_listings,transaction_fee_percent,rejection_reason,verified_at FROM supplier_profiles WHERE supplier_id=2');
  assert.equal(buyer.role,'BUYER');assert.equal(supplier.role,'SUPPLIER');assert.ok(profile);
  const server=app.listen(0);
  const base='http://127.0.0.1:'+server.address().port;
  const token=(id,role)=>jwt.sign({id,role},process.env.JWT_SECRET,
    {issuer:'miljor-api',audience:'miljor-app',expiresIn:'5m'});
  async function api(endpoint,id,role,method='GET',body){
    const response=await fetch(base+'/api/v1/admin'+endpoint,{
      method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token(id,role)},
      body:body==null?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    return {status:response.status,data:await response.json()};
  }
  try{
    await db.query("UPDATE users SET role='ADMIN' WHERE id=5 AND role='BUYER'");
    await db.query("UPDATE supplier_profiles SET verification_status='PENDING_REVIEW' WHERE supplier_id=2");
    const denied=await api('/suppliers/pending',2,'SUPPLIER');
    assert.equal(denied.status,403,JSON.stringify(denied.data));
    pass('Supplier account denied admin queue');
    const queue=await api('/suppliers/pending',5,'ADMIN');
    assert.equal(queue.status,200,JSON.stringify(queue.data));
    const row=queue.data.data.suppliers.find(x=>Number(x.supplier_id)===2);
    assert.ok(row,'Real pending supplier missing');
    assert.equal(Object.hasOwn(row,'bank_iban'),false);
    pass('ADMIN role receives pending applications without raw bank credentials');
    const self=await api('/suppliers/5/verify',5,'ADMIN','PUT',{verification_status:'VERIFIED'});
    assert.equal(self.status,403);assert.equal(self.data.error.code,'SELF_VERIFICATION_PROHIBITED');
    pass('Self-approval prohibited');
    const noReason=await api('/suppliers/2/verify',5,'ADMIN','PUT',{
      verification_status:'REJECTED',rejection_reason:''});
    assert.equal(noReason.status,400);assert.equal(noReason.data.error.code,'REASON_REQUIRED');
    pass('Rejected status requires guidance');
    const info=await api('/suppliers/2/verify',5,'ADMIN','PUT',{
      verification_status:'MORE_INFORMATION_REQUIRED',
      rejection_reason:'Please provide updated food registration',
      subscription_plan:'STARTER',max_active_listings:4});
    assert.equal(info.status,200,JSON.stringify(info.data));
    const [[needsInfo]]=await db.query('SELECT verification_status FROM supplier_profiles WHERE supplier_id=2');
    assert.equal(needsInfo.verification_status,'MORE_INFORMATION_REQUIRED');
    pass('More information state does not reject application');
    const approved=await api('/suppliers/2/verify',5,'ADMIN','PUT',{
      verification_status:'VERIFIED',verification_level:'LEVEL_2_BUSINESS',
      subscription_plan:'STARTER',max_active_listings:4,transaction_fee_percent:1.5});
    assert.equal(approved.status,200,JSON.stringify(approved.data));
    const [[verified]]=await db.query(
      'SELECT verification_status,subscription_plan,max_active_listings FROM supplier_profiles WHERE supplier_id=2');
    assert.equal(verified.verification_status,'VERIFIED');
    assert.equal(verified.subscription_plan,'STARTER');
    assert.equal(Number(verified.max_active_listings),4);
    const [[u]]=await db.query('SELECT role,is_verified FROM users WHERE id=2');
    assert.equal(u.role,'SUPPLIER');assert.equal(Number(u.is_verified),1);
    const [[audit]]=await db.query(
      "SELECT COUNT(*) AS n FROM system_audit_logs WHERE actor_id=5 AND entity_name='supplier_profiles' AND entity_id=2 AND action='SUPPLIER_VERIFICATION_UPDATE'");
    assert.ok(Number(audit.n)>=2);
    pass('Audited real supplier approval and plan entitlement');
    console.log('REAL MYSQL ADMIN APPROVAL: '+passed+'/'+passed+' PASS (disposable DB only)');
  } finally {
    await Promise.allSettled([
      db.query('UPDATE users SET role=?,is_verified=?,verification_status=? WHERE id=5',
        [buyer.role,buyer.is_verified,buyer.verification_status]),
      db.query('UPDATE users SET role=?,is_verified=?,verification_status=? WHERE id=2',
        [supplier.role,supplier.is_verified,supplier.verification_status]),
      db.query('UPDATE supplier_profiles SET verification_status=?,verification_level=?,subscription_plan=?,max_active_listings=?,transaction_fee_percent=?,rejection_reason=?,verified_at=? WHERE supplier_id=2',
        [profile.verification_status,profile.verification_level,profile.subscription_plan,
         profile.max_active_listings,profile.transaction_fee_percent,
         profile.rejection_reason,profile.verified_at])
    ]);
    await new Promise(resolve=>server.close(resolve));
  }
}
main().then(()=>process.exit(0)).catch(err=>{
 console.error('FAIL REAL MYSQL ADMIN APPROVAL',err.stack||err);process.exit(1);
});
