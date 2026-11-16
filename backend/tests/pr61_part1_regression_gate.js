'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
function load(relative,modules){
  const filename=path.resolve(root,relative),code=fs.readFileSync(filename,'utf8');
  const module={exports:{}};
  vm.runInNewContext('(function(require,module,exports){'+code+'\n})',{},{filename})(name=>{
    if(Object.prototype.hasOwnProperty.call(modules,name))return modules[name];
    throw Error('Unmocked dependency '+name+' in '+relative);
  },module,module.exports);
  return module.exports;
}
const fakeMatching={inbox:async id=>[{invitation_id:11,request_id:21,request_code:'RFQ-21',status:'INVITED',quote_deadline:'2099-01-01',items:[{family_id:1,quantity:10,unit:'kg'}]}]};
const fakeCollective={supplierInbox:async id=>[{invitation_id:12,group_id:22,status:'INVITED',quote_deadline:'2099-02-01',minimum_buyers:2,items:[{family_id:2,unit:'kg'}]}]};
const Opportunities=load('backend/src/services/supplierProcurementOpportunitiesService.js',{
  './procurementMatchingService':fakeMatching,'./procurementCollectiveBidService':fakeCollective
}).SupplierProcurementOpportunitiesService;
async function opportunities(){
  const s=new Opportunities(fakeMatching,fakeCollective),actor={role:'SUPPLIER',id:123};
  const all=await s.list(actor);
  assert.equal(all.items.length,2);
  assert.equal(Array.from(all.items,x=>x.type).sort().join(','),'grouped,single');
  assert.equal(all.items.some(x=>'buyer_id' in x||'bank_iban' in x),false);
  assert.equal((await s.list(actor,{type:'single'})).items.length,1);
  assert.equal((await s.list(actor,{type:'grouped'})).items.length,1);
  await assert.rejects(s.list({role:'BUYER',id:1}),e=>e.statusCode===403);
  await assert.rejects(s.list(actor,{type:'WRONG'}),e=>e.statusCode===400);
  await assert.rejects(s.list({role:'SUPPLIER',id:'not-an-id'}),e=>e.statusCode===400);
}
function makeAdminHarness(currentStatus='PENDING_REVIEW'){
  const writes=[],conn={
    beginTransaction:async()=>writes.push('BEGIN'),
    commit:async()=>writes.push('COMMIT'),
    rollback:async()=>writes.push('ROLLBACK'),
    release:()=>writes.push('RELEASE'),
    query:async(sql,params)=>{
      writes.push({sql,params});
      if(sql.includes('SELECT supplier_id, verification_status'))return [[{
        supplier_id:8,verification_status:currentStatus,verification_level:'LEVEL_1_CONTACT',
        subscription_plan:'STARTER',is_verified:0
      }]];
      return [[]];
    }
  };
  const database={getConnection:async()=>conn,query:async()=>{throw Error('Unexpected non-transactional query')}};
  const admin=load('backend/src/controllers/adminController.js',{
    '../config/db':database,'../services/encryptionService':{},
    '../services/supplierValidationService':{}
  });
  const res={statusCode:200,status(code){this.statusCode=code;return this;},
    json(body){this.body=body;return this;}};
  return {admin,res,writes};
}
async function decision(status,body={}){
  const {admin,res,writes}=makeAdminHarness();
  await admin.verifySupplier({params:{id:'8'},user:{id:10,role:'SUPER_ADMIN'},
    body:{verification_status:status,...body}},res);
  return {res,writes};
}
async function adminRegressions(){
  for(const status of ['MORE_INFORMATION_REQUIRED','REJECTED','UNDER_REVIEW']){
    const {res,writes}=await decision(status,{rejection_reason:'Please update tax certificate'});
    assert.equal(res.statusCode,200,status);
    const commands=writes.filter(x=>x&&x.sql).map(x=>x.sql);
    assert.equal(commands.some(x=>/UPDATE users/i.test(x)),false,status+' must not reset user identity');
    const sql=commands.find(x=>/UPDATE supplier_profiles SET/i.test(x));
    assert.ok(sql);
    assert.doesNotMatch(sql,/subscription_plan\s*=|max_active_listings\s*=|transaction_fee_percent\s*=/i);
    assert.ok(writes.includes('COMMIT'));
  }
  for(const status of ['MORE_INFORMATION_REQUIRED','REJECTED','VERIFIED']){
    const {res,writes}=await decision(status,{rejection_reason:'Document required',subscription_plan:'GROWTH'});
    assert.equal(res.statusCode,400,status);
    assert.equal(writes.length,0,'billing mutation must be rejected before transaction');
  }
  const approved=await decision('VERIFIED');
  assert.equal(approved.res.statusCode,200);
  assert.equal(approved.writes.some(x=>x&&x.sql&&/UPDATE users SET role/i.test(x.sql)),true);
  const stale=makeAdminHarness('VERIFIED');
  await stale.admin.verifySupplier({params:{id:'8'},user:{id:10,role:'SUPER_ADMIN'},
    body:{verification_status:'REJECTED',rejection_reason:'Certificate invalid'}},stale.res);
  assert.equal(stale.res.statusCode,409);
  assert.equal(stale.writes.some(x=>x&&x.sql&&/UPDATE supplier_profiles SET/i.test(x.sql)),false);
  const self=makeAdminHarness();
  await self.admin.verifySupplier({params:{id:'8'},user:{id:8,role:'SUPER_ADMIN'},
    body:{verification_status:'VERIFIED'}},self.res);
  assert.equal(self.res.statusCode,403);
}
function staticRegressions(){
  const profile=fs.readFileSync(path.join(root,'backend/src/services/supplierProfileService.js'),'utf8');
  const controller=fs.readFileSync(path.join(root,'backend/src/controllers/supplierProfileController.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'frontend/src/pages/AdminVerificationPage.jsx'),'utf8');
  const routes=fs.readFileSync(path.join(root,'backend/src/routes/v1/procurementRoutes.js'),'utf8');
  const app=fs.readFileSync(path.join(root,'frontend/src/App.jsx'),'utf8');
  assert.match(profile,/VERIFICATION_PROFILE_LOCKED/);
  assert.match(profile,/lockForUpdate\(supplierId, connection\)/);
  assert.doesNotMatch(profile,/review within 2 business days/i);
  assert.match(controller,/res\.status\(409\)/);
  assert.match(routes,/procurement\/supplier\/opportunities/);
  assert.match(app,/SupplierOpportunitiesPage/);
  const submit=ui.slice(ui.indexOf('const handleSubmitApproval'),ui.indexOf('const handleSubmitRejection'));
  assert.doesNotMatch(submit,/subscription_plan:|transaction_fee_percent:|max_active_listings:/);
}
(async()=>{
  await opportunities();console.log('PASS: supplier-scoped unified inbox/filters and invalid actor');
  await adminRegressions();console.log('PASS: review billing isolation, stale review, self-approval and approval');
  staticRegressions();console.log('PASS: pending lock, API conflict, SLA, frontend route/payload');
})().catch(e=>{console.error('FAIL: PR61 Part1 regression:',e);process.exitCode=1;});
