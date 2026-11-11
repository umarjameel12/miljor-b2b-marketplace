'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const controllerSrc=fs.readFileSync(path.join(__dirname,'../src/controllers/adminController.js'),'utf8');
const guardSrc=fs.readFileSync(path.join(__dirname,'../src/middlewares/authGuard.js'),'utf8');
process.env.JWT_SECRET ||= 'admin-isolated-test-secret-that-exceeds-32-characters';
let passes=0;
const check=async(name,fn)=>{await fn(); console.log('PASS '+(++passes)+': '+name)};
function mockResponse(){
  return {statusCode:200,body:null,status(n){this.statusCode=n;return this},json(x){this.body=x;return this}};
}
let writes=[];
const db={
  async query(sql,args){
    if(sql.includes('FROM supplier_profiles WHERE supplier_id = ?'))
      return [[{supplier_id:Number(args[0]),verification_status:'PENDING_REVIEW'}]];
    if(sql.includes('FROM supplier_profiles sp')&&sql.includes('JOIN users u'))
      return [[{supplier_id:2,business_name:'Test Wholesale Supplier',bank_iban:'PK1234567890123456789012',
        verification_status:'PENDING_REVIEW',subscription_plan:'STARTER'}]];
    throw Error('Unexpected top-level SQL: '+sql.slice(0,80));
  },
  async getConnection(){
    return {
      async beginTransaction(){writes.push('BEGIN')},
      async query(sql,args){
        if(sql.startsWith('UPDATE supplier_profiles')){writes.push({table:'supplier_profiles',args});return [{affectedRows:1}]}
        if(sql.startsWith('UPDATE users')){writes.push({table:'users',args});return [{affectedRows:1}]}
        if(sql.includes('INSERT INTO system_audit_logs')){writes.push({table:'system_audit_logs',args});return [{insertId:1}]}
        throw Error('Unexpected transaction SQL: '+sql.slice(0,80));
      },
      async commit(){writes.push('COMMIT')},
      async rollback(){writes.push('ROLLBACK')},
      release(){}
    };
  }
};
const load=(source,requireStub)=>{
  const m={exports:{}};
  new Function('module','exports','require','process',source)(m,m.exports,requireStub,process);
  return m.exports;
};
const guard=load(guardSrc,id=>{
  if(id==='jsonwebtoken')return {};
  if(id==='../config/db')return db;
  if(id==='../services/sessionService')return {};
  throw Error('Unexpected guard require: '+id);
});
const controller=load(controllerSrc,id=>{
  if(id==='../config/db')return db;
  if(id==='../services/encryptionService')return {isEncrypted:()=>false};
  if(id==='../services/supplierValidationService')return {maskIban:()=>{throw Error('Plaintext should never be decrypted')}};
  throw Error('Unexpected controller require: '+id);
});
async function main(){
  for(const role of ['ADMIN','VERIFICATION_ADMIN','SUPER_ADMIN']){
    await check(role+' can reach verification queue with valid session',async()=>{
      const res=mockResponse();let allowed=false;
      guard.authorizeVerification({user:{id:99,role}},res,()=>{allowed=true});
      assert.equal(allowed,true);
    });
  }
  for(const role of ['SUPPLIER','BUYER','OPERATIONS_ADMIN']){
    await check(role+' cannot approve suppliers',async()=>{
      const res=mockResponse();let allowed=false;
      guard.authorizeVerification({user:{id:2,role}},res,()=>{allowed=true});
      assert.equal(allowed,false);assert.equal(res.statusCode,403);
    });
  }
  await check('pending queue never exposes unencrypted IBAN',async()=>{
    const res=mockResponse();
    await controller.getPendingSuppliers({user:{id:99,role:'ADMIN'}},res);
    assert.equal(res.statusCode,200);
    assert.equal(res.body.data.suppliers.length,1);
    const row=res.body.data.suppliers[0];
    assert.equal(Object.hasOwn(row,'bank_iban'),false);
    assert.match(row.bank_iban_masked,/LEGACY_MIGRATION_REQUIRED/);
  });
  await check('admin approval updates supplier, user and audit in transaction',async()=>{
    writes=[];const res=mockResponse();
    await controller.verifySupplier({params:{id:'2'},user:{id:99,role:'ADMIN'},
      body:{verification_status:'VERIFIED',verification_level:'LEVEL_2_BUSINESS',
        subscription_plan:'STARTER',max_active_listings:4,transaction_fee_percent:1.5}},res);
    assert.equal(res.statusCode,200,JSON.stringify(res.body));
    assert.equal(res.body.data.verification_status,'VERIFIED');
    assert.equal(writes.filter(w=>w?.table==='supplier_profiles').length,1);
    assert.equal(writes.filter(w=>w?.table==='users').length,1);
    assert.equal(writes.filter(w=>w?.table==='system_audit_logs').length,1);
    assert.equal(writes.includes('COMMIT'),true);
  });
  await check('self-approval prohibited even for ADMIN',async()=>{
    const res=mockResponse();await controller.verifySupplier({
      params:{id:'99'},user:{id:99,role:'ADMIN'},body:{verification_status:'VERIFIED'}
    },res);assert.equal(res.statusCode,403);assert.equal(res.body.error.code,'SELF_VERIFICATION_PROHIBITED');
  });
  await check('reject without explanation refused',async()=>{
    const res=mockResponse();await controller.verifySupplier({
      params:{id:'2'},user:{id:99,role:'ADMIN'},body:{verification_status:'REJECTED',rejection_reason:''}
    },res);assert.equal(res.statusCode,400);assert.equal(res.body.error.code,'REASON_REQUIRED');
  });
  await check('request more information is not a rejection',async()=>{
    writes=[];const res=mockResponse();await controller.verifySupplier({
      params:{id:'2'},user:{id:99,role:'ADMIN'},
      body:{verification_status:'MORE_INFORMATION_REQUIRED',rejection_reason:'Please supply food licence'}
    },res);assert.equal(res.statusCode,200);
    assert.equal(res.body.data.verification_status,'MORE_INFORMATION_REQUIRED');
    assert.equal(writes.filter(w=>w?.table==='system_audit_logs').length,1);
  });
  console.log('ADMIN VERIFICATION ROLE AND DECISION CONTRACT: '+passes+'/'+passes+' PASS (mock transaction, not real MySQL)');
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
