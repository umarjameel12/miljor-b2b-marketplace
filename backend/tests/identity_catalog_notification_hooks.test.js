'use strict';
// Real modules, isolated adapters: no config/db, environment files or providers loaded.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {getEventDefinition,buildEventKey} = require('../src/services/ucpNotificationEventCatalog');
function load(file, deps) {
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    module, require(name) {
      if (Object.hasOwn(deps,name)) return deps[name];
      // Pure delivery policy; the real OTP service still uses the injected DB.
      if(file==='services/emailService.js'&&name==='./notificationDeliveryPolicy')return require('../src/services/notificationDeliveryPolicy');
      throw Error('Unexpected dependency '+name);
    },
    process:{env:{JWT_SECRET:'isolated-test-secret',NODE_ENV:'test'}}, console:{error() {},log() {},warn() {}}, Buffer
  }, {filename:file});
  return module.exports;
}
function adapter(options={}) {
  const calls=[]; const hookCalls=[]; const enqueues=[];
  const user={id:19,role:'SUPPLIER',verification_status:'UNVERIFIED',...options.user};
  const conn={
    async query(sql,args) {
      calls.push({sql,args});
      if (options.query) { const result=await options.query(sql,args); if(result!==undefined)return result; }
      if(sql.includes("role IN (")) return [options.adminRows || [{id:99,role:'SUPER_ADMIN'}]];
      if(sql.includes('FROM users')) return [[user]];
      return [{affectedRows:1,insertId:75}];
    },
    async beginTransaction(){calls.push({sql:'BEGIN'});}, async commit(){calls.push({sql:'COMMIT'});},
    async rollback(){calls.push({sql:'ROLLBACK'});hookCalls.length=0;enqueues.length=0;}, release(){calls.push({sql:'RELEASE'});}
  };
  // Run the real adapter; only the durable SQL enqueue boundary is substituted.
  // No inbox/email projector is loaded or claimed to have delivered anything.
  const durable = load('services/ucpTransactionalNotifications.js', {
    './ucpNotificationEventCatalog': {getEventDefinition,buildEventKey},
    './notificationService': {async enqueueEvent(tx,event) {
      assert.equal(tx,conn);
      assert.ok(Number.isSafeInteger(event.entityId) && event.entityId > 0, 'positive persisted entity reference required');
      assert.deepEqual(Object.keys(event).sort(), ['entityId','eventKey','eventType','role','userId']);
      assert.ok(!calls.some(c=>c.sql==='COMMIT'));
      if(options.failNotice || options.failEnqueueAt === enqueues.length + 1)throw Error('notice failed');
      calls.push({sql:'ENQUEUE',event});enqueues.push(event);
      return [{affectedRows:1}];
    }}
  });
  const writer={async recordInAppOnConnection(tx,event){
    assert.equal(tx,conn); assert.ok(!calls.some(c=>c.sql==='COMMIT'));
    getEventDefinition(event.type); buildEventKey(event);
    assert.ok(event.recipients.every(r=>r.userId===19||r.userId===99));
    assert.ok(!/secret|address|iban|token|document/i.test(JSON.stringify(event)));
    await durable.recordInAppOnConnection(tx,event);
    calls.push({sql:'NOTICE',event});hookCalls.push(event);
  }};
  return {conn,calls,hookCalls,enqueues,user,writer,db:{getConnection:async()=>conn,query:conn.query}};
}
function profileHarness(options={}) {
  const h=adapter(options);
  const profile={supplier_id:19,verification_status:'NOT_SUBMITTED',role:'SUPPLIER',lahore_service_area:'old',...options.profile};
  const repo={
    async findBySupplierId(){return {...profile};}, async ensureProfileExists(){return {...profile};},
    async lockForUpdate(){h.calls.push({sql:'LOCK PROFILE'});Object.assign(profile,options.locked);return {...profile};},
    async submitForReview(id,tx){assert.equal(tx,h.conn);h.calls.push({sql:'SUBMIT'});return {...profile,submitted_at:'now'};},
    async updateProfileDetails(id,data,tx){assert.equal(tx,h.conn);h.calls.push({sql:'UPDATE PROFILE'});return {...profile,...data};},
    async triggerReReview(){h.calls.push({sql:'REVIEW'});}
  };
  h.service=load('services/supplierProfileService.js',{
    '../config/db':h.db,'../repositories/supplierProfileRepository':repo,
    './supplierValidationService':{validateProfileData:data=>({valid:!options.invalid,errors:['invalid'],sanitized:data}),maskIban:()=>null},
    './ucpTransactionalNotifications':h.writer,crypto,'node:crypto':crypto
  });
  return h;
}
test('verification submission writes owner receipt and authorized escalation before commit',async()=>{
  const h=profileHarness(); await h.service.submitVerification(19);
  assert.equal(h.hookCalls.length,1);assert.equal(h.hookCalls[0].type,'IDENTITY.VERIFICATION_SUBMITTED');
  assert.deepEqual(h.enqueues.map(e=>[e.userId,e.role,e.eventType,e.entityId]), [[19,'SUPPLIER','IDENTITY.VERIFICATION_SUBMITTED',19],[99,'SUPER_ADMIN','IDENTITY.VERIFICATION_SUBMITTED',19]]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.hookCalls[0].recipients)),[{userId:19,role:'SUPPLIER'},{userId:99,role:'SUPER_ADMIN'}]);
  assert.ok(h.calls.findIndex(c=>c.sql==='SUBMIT')<h.calls.findIndex(c=>c.sql==='NOTICE'));
});
test('concurrent submission rechecks pending status under profile lock',async()=>{
  const h=profileHarness({locked:{verification_status:'PENDING_REVIEW'}});
  assert.equal((await h.service.submitVerification(19)).alreadyPending,true);
  assert.equal(h.hookCalls.length,0);assert.ok(!h.calls.some(c=>c.sql==='SUBMIT'));
});
test('notification failure rolls verification mutation back',async()=>{
  const h=profileHarness({failNotice:true});await assert.rejects(h.service.submitVerification(19),/notice failed/);
  assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));
});

for (const status of ['PENDING_REVIEW','UNDER_REVIEW','VERIFIED']) {
  test('submission '+status+' is a no-op',async()=>{
    const h=profileHarness({profile:{verification_status:status}});await h.service.submitVerification(19);
    assert.equal(h.hookCalls.length,0);assert.ok(!h.calls.some(c=>c.sql==='SUBMIT'));
  });
}
test('invalid submission does not mutate or notify',async()=>{
  const h=profileHarness({invalid:true});await assert.rejects(h.service.submitVerification(19),/incomplete/);
  assert.equal(h.calls.length,0);
});
for (const [name,data,profile,types] of [
  ['area change',{lahore_service_area:'new'},{},['CATALOG.SERVICE_AREA_CHANGED']],
  ['same area',{lahore_service_area:'old'},{},[]],
  ['material change',{business_name:'new'},{business_name:'old',verification_status:'VERIFIED'},['IDENTITY.VERIFICATION_SUBMITTED']],
  ['ordinary draft',{business_description:'description'},{},[]]
]) test(name+' profile receipts',async()=>{
  const h=profileHarness({profile});await h.service.updateProfile(19,data);
  assert.deepEqual(h.hookCalls.map(n=>n.type),types);
});
function deliveryHarness(options={}) {
  const h=adapter(options);let config={supplier_id:19,standard_delivery_enabled:1,pickup_enabled:0,express_enabled:0,version:1};
  let rates=[{cluster_id:1,mode:'STANDARD_CLUSTERED',is_eligible:1,fee_pkr:5}];
  let points=[{id:2,supplier_id:19,cluster_id:1,is_active:1,address_line:'private address',pickup_handling_fee_pkr:0}];
  const repo={
    async getSupplierConfiguration(id,tx){assert.equal(tx,h.conn);return {...config};},
    async getSupplierClusterRates(){return rates.map(r=>({...r}));},async getSupplierPickupPoints(){return points.map(p=>({...p}));},
    async upsertSupplierConfiguration(id,value,tx){assert.equal(tx,h.conn);h.calls.push({sql:'SAVE CONFIG'});config={...config,...value,version:config.version+1};return config;},
    async upsertSupplierClusterRate(value){h.calls.push({sql:'SAVE RATE'});rates=[value];},
    async createPickupPoint(value,tx){assert.equal(tx,h.conn);h.calls.push({sql:'SAVE POINT'});points.push({...value,id:3,is_active:1});return 3;},
    async updatePickupPoint(id,supplier,value,tx){assert.equal(tx,h.conn);const p=points.find(p=>p.id===id&&p.supplier_id===supplier);if(!p)return false;h.calls.push({sql:'UPDATE POINT'});Object.assign(p,value);return true;}
  };
  h.service=load('services/supplierDeliveryService.js',{'../config/db':h.db,'./exactDecimal':require('../src/services/exactDecimal'),
    '../repositories/supplierDeliveryRepository':repo,'../repositories/geographicRepository':{getClusterById:async()=>({is_active:1})},
    './supplierProfileService':{recordIdentityEvent:async(...args)=>{
      // Use the real resolver with this transaction and writer.
      const resolver=load('services/supplierProfileService.js',{'../config/db':h.db,'../repositories/supplierProfileRepository':{},
        './supplierValidationService':{},'./ucpTransactionalNotifications':h.writer,'node:crypto':crypto});
      return resolver.recordIdentityEvent(...args);
    }} });
  return h;
}
for(const [name,payload,count] of [
  ['mode change',{pickup_enabled:true},1],['same settings',{},0],
  ['rate only',{cluster_rates:[{cluster_id:1,mode:'STANDARD_CLUSTERED',fee_pkr:10}]},0],
  ['coverage disabled',{cluster_rates:[{cluster_id:1,mode:'STANDARD_CLUSTERED',fee_pkr:5,is_eligible:false}]},1],
  ['draft modes',{is_draft:true,pickup_enabled:true},0]
])test('delivery '+name,async()=>{
  const h=deliveryHarness();await h.service.updateSupplierSettings(19,payload);
  assert.equal(h.hookCalls.length,count);if(count)assert.equal(h.hookCalls[0].type,'CATALOG.SERVICE_AREA_CHANGED');
  assert.equal(h.enqueues.length,count);
  for(const event of h.enqueues){assert.equal(event.entityId,19);assert.equal(event.eventType,'CATALOG.SERVICE_AREA_CHANGED');}
  assert.equal(h.calls.at(-2).sql,'COMMIT');assert.equal(h.calls.at(-1).sql,'RELEASE');
});
test('invalid delivery rate rolls back without enqueues',async()=>{
  const h=deliveryHarness();await assert.rejects(h.service.updateSupplierSettings(19,{cluster_rates:[{cluster_id:1,mode:'EXPRESS',fee_pkr:-1}]}),/non-negative/);
  assert.equal(h.hookCalls.length,0);assert.ok(!h.calls.some(c=>c.sql==='SAVE CONFIG'));assert.equal(h.calls.at(-2).sql,'ROLLBACK');
});
test('delivery notice failure rolls settings back',async()=>{
  const h=deliveryHarness({failNotice:true});await assert.rejects(h.service.updateSupplierSettings(19,{pickup_enabled:true}),/notice failed/);
  assert.ok(h.calls.some(c=>c.sql==='SAVE CONFIG'));assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));assert.equal(h.hookCalls.length,0);
});
test('pickup creation emits coverage receipt without location details',async()=>{
  const h=deliveryHarness();await h.service.addPickupPoint(19,{point_name:'warehouse',cluster_id:1,address_line:'private address'});
  assert.equal(h.hookCalls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.hookCalls[0].payload)),{account_id:19});
});
for(const [name,data,count] of [['changed cluster',{cluster_id:4},1],['same cluster',{cluster_id:1},0],['deactivated',{is_active:false},1],['fee only',{pickup_handling_fee_pkr:10},0]]) {
  test('pickup '+name,async()=>{const h=deliveryHarness();await h.service.updatePickupPoint(2,19,data);assert.equal(h.hookCalls.length,count);});
}
test('pickup ownership failure never notifies',async()=>{
  const h=deliveryHarness();await assert.rejects(h.service.updatePickupPoint(999,19,{cluster_id:2}),/unauthorized/);assert.equal(h.hookCalls.length,0);
});
function catalogHarness(options={}) {
  const h=adapter(options);const sku={id:6,supplier_id:19,supplier_product_id:3,family_id:4,category_id:2,status:'DRAFT',linked_spec_id:8,
    category_is_active:1,category_approval_status:'APPROVED',family_is_active:1,family_approval_status:'APPROVED',...options.sku};
  const repo={findSupplierSkuById:async()=>({...sku}),findSupplierProductById:async()=>({id:3,supplier_id:19,status:options.productStatus || 'PUBLISHED'}),
    transitionSupplierProductStatus:async()=>{},findFamilyById:async()=>({id:4,default_product_id:9}),
    publishSupplierSku:async(id,spec,tx)=>{assert.equal(tx,h.conn);h.calls.push({sql:'PUBLISH SKU'});return {...sku,status:'PUBLISHED'};}};
  h.service=load('services/catalogService.js',{'../config/db':h.db,'../repositories/catalogRepository':repo,
    '../repositories/productRepo':{findById:async()=>({id:9})},'../repositories/productSpecificationRepo':{},
    './specificationService':{},'./ucpTransactionalNotifications':h.writer,'node:crypto':crypto,
    './subscriptionEntitlementService':{assertCanPublishInFamily:async()=>{if(options.entitlementFailure)throw Error('not entitled');}}});
  return h;
}
test('SKU publication records persisted supplier after publication before commit',async()=>{
  const h=catalogHarness();await h.service.publishSupplierSku(19,6);assert.equal(h.hookCalls[0].type,'CATALOG.SKU_PUBLISHED');
  assert.equal(h.hookCalls[0].recipients[0].userId,19);
  assert.deepEqual(h.enqueues.map(e=>[e.userId,e.eventType,e.entityId]),[[19,'CATALOG.SKU_PUBLISHED',6]]);assert.ok(h.calls.findIndex(c=>c.sql==='PUBLISH SKU')<h.calls.findIndex(c=>c.sql==='NOTICE'));
});
for(const [name,options,error] of [['ownership',{sku:{supplier_id:20}},/own/],['archived',{sku:{status:'ARCHIVED'}},/Archived/],['entitlement',{entitlementFailure:true},/entitled/]]) {
  test('SKU '+name+' failure does not notify',async()=>{const h=catalogHarness(options);await assert.rejects(h.service.publishSupplierSku(19,6),error);assert.equal(h.hookCalls.length,0);assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));});
}
test('SKU publish replay does not notify',async()=>{const h=catalogHarness({sku:{status:'PUBLISHED'}});await h.service.publishSupplierSku(19,6);assert.equal(h.hookCalls.length,0);});
test('SKU notification failure rolls publication back',async()=>{const h=catalogHarness({failNotice:true});await assert.rejects(h.service.publishSupplierSku(19,6),/notice failed/);assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));});
function identityResolver(h) {
  return load('services/supplierProfileService.js',{'../config/db':h.db,'../repositories/supplierProfileRepository':{},
    './supplierValidationService':{},'./ucpTransactionalNotifications':h.writer,'node:crypto':crypto});
}
function response(){return {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
function controllerHarness(options={}) {
  const h=adapter(options);const identity=identityResolver(h);
  h.controller=load('controllers/adminController.js',{'../config/db':h.db,'../services/supplierProfileService':identity,
    '../services/orderAdminApprovalService':{},'../services/encryptionService':{},'../services/supplierValidationService':{}});
  return h;
}
for(const [status,type] of [['VERIFIED','IDENTITY.VERIFICATION_APPROVED'],['REJECTED','IDENTITY.VERIFICATION_REJECTED'],['MORE_INFORMATION_REQUIRED','IDENTITY.VERIFICATION_INFO_REQUESTED'],['UNDER_REVIEW','IDENTITY.VERIFICATION_UNDER_REVIEW'],['SUSPENDED','IDENTITY.VERIFICATION_SUSPENDED']]) {
  test('administrative '+status+' receipt follows persisted decision',async()=>{
    const h=controllerHarness({query(sql){if(sql.includes('FROM supplier_profiles'))return [[{supplier_id:19,verification_status:'PENDING_REVIEW'}]];}});
    const res=response();await h.controller.verifySupplier({params:{id:'19'},user:{id:99,role:'SUPER_ADMIN'},body:{verification_status:status,rejection_reason:'private document guidance'}},res);
    assert.equal(res.statusCode,200);assert.equal(h.hookCalls[0].type,type);assert.equal(h.hookCalls[0].recipients.length,1);
    assert.ok(h.calls.findIndex(c=>c.sql.includes('UPDATE users'))<h.calls.findIndex(c=>c.sql==='NOTICE'));
  });
}
test('repeated verification decision does not notify',async()=>{
  const h=controllerHarness({query(sql){if(sql.includes('FROM supplier_profiles'))return [[{supplier_id:19,verification_status:'VERIFIED'}]];}});
  const res=response();await h.controller.verifySupplier({params:{id:'19'},user:{id:99,role:'SUPER_ADMIN'},body:{verification_status:'VERIFIED'}},res);
  assert.equal(res.statusCode,200);assert.equal(h.hookCalls.length,0);
});
test('self verification blocked without mutation',async()=>{
  const h=controllerHarness();const res=response();await h.controller.verifySupplier({params:{id:'19'},user:{id:19,role:'SUPPLIER'},body:{verification_status:'VERIFIED'}},res);
  assert.equal(res.statusCode,403);assert.equal(h.calls.length,0);
});
test('verification notice failure prevents commit',async()=>{
  const h=controllerHarness({failNotice:true,query(sql){if(sql.includes('FROM supplier_profiles'))return [[{supplier_id:19,verification_status:'PENDING_REVIEW'}]];}});
  const res=response();await h.controller.verifySupplier({params:{id:'19'},user:{id:99,role:'SUPER_ADMIN'},body:{verification_status:'VERIFIED'}},res);
  assert.equal(res.statusCode,500);assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));
});
for (const [method,previous,type] of [['suspendUser','VERIFIED','IDENTITY.ACCOUNT_LOCKED'],['reactivateUser','BLOCKED','IDENTITY.ACCOUNT_UNLOCKED']]) {
  test(method+' emits real account state transition',async()=>{
    const h=controllerHarness({user:{verification_status:previous}});const res=response();
    await h.controller[method]({params:{id:'19'},user:{id:99,role:'SUPER_ADMIN'},body:{reason:'private security reason'}},res);
    assert.equal(res.statusCode,200);assert.equal(h.hookCalls[0].type,type);assert.equal(h.calls.at(-2).sql,'COMMIT');
  });
}
test('repeated suspension does not notify',async()=>{
  const h=controllerHarness({user:{verification_status:'BLOCKED',buyer_trust_status:'SUSPENDED'}});const res=response();
  await h.controller.suspendUser({params:{id:'19'},user:{id:99,role:'SUPER_ADMIN'},body:{}},res);assert.equal(res.statusCode,200);assert.equal(h.hookCalls.length,0);
});
function authHarness(options={}) {
  const h=adapter(options);const identity=identityResolver(h);
  h.controller=load('controllers/authController.js',{'../config/db':h.db,crypto,
    bcryptjs:{hash:async()=> 'isolated-hash'},jsonwebtoken:{sign:()=> 'session'},
    '../middlewares/authGuard':{JWT_ISSUER:'test',JWT_AUDIENCE:'test'},'../services/googleAuthService':{},
    '../services/emailService':options.createEmailService ? options.createEmailService(h) : {verifyAndConsumeOtp:async()=>{if(options.invalidOtp)throw Object.assign(Error('invalid OTP'),{statusCode:400});},verifyOtpHmac:()=>!options.invalidOtp},
    '../services/sessionService':{revokeAllUserSessions:async(id,reason,tx)=>{assert.equal(tx,h.conn);h.calls.push({sql:'REVOKE SESSIONS'});},clearRefreshCookie(){}},
    '../services/supplierProfileService':identity});
  return h;
}
for(const role of ['BUYER','SUPPLIER'])test(role+' registration emits only after user and profile persistence',async()=>{
  const h=authHarness({user:{id:19,role},query(sql){
    if(sql.includes('WHERE (email IS NOT NULL'))return [[]];if(sql.includes('FROM geographic_clusters'))return [[{id:1,name:'Central',district:'Lahore'}]];
    if(sql.includes('INSERT INTO users'))return [{insertId:19,affectedRows:1}];
  }});
  const res=response();await h.controller.register({body:{email:'owner@example.test',password:'Password123',role,base_cluster_id:1}},res);
  assert.equal(res.statusCode,201);assert.equal(h.hookCalls[0].type,'IDENTITY.REGISTERED');assert.equal(h.hookCalls[0].recipients[0].role,role);
});
test('invalid registration never emits',async()=>{const h=authHarness();const res=response();await h.controller.register({body:{password:'bad'}},res);assert.equal(res.statusCode,400);assert.equal(h.calls.length,0);});
test('registration writer failure rolls user back',async()=>{
  const h=authHarness({failNotice:true,query(sql){if(sql.includes('WHERE (email IS NOT NULL'))return [[]];if(sql.includes('INSERT INTO users'))return [{insertId:19}];}});
  const res=response();await h.controller.register({body:{email:'owner@example.test',password:'Password123',role:'SUPPLIER'}},res);
  assert.equal(res.statusCode,500);assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));
});
for(const [status,isVerified,count] of [['UNVERIFIED',0,1],['EMAIL_VERIFIED',1,1],['BLOCKED',0,1]])test('email verification '+status+' records email proof independently of account status',async()=>{
  const h=authHarness({user:{role:'BUYER',verification_status:status,is_verified:isVerified}});const res=response();
  await h.controller.verifyEmail({user:{id:19},body:{otp:'123456'}},res);assert.equal(res.statusCode,200);assert.equal(h.hookCalls.length,count);
});
test('invalid email OTP does not mutate account or notify',async()=>{
  const h=authHarness({invalidOtp:true});const res=response();await h.controller.verifyEmail({user:{id:19},body:{otp:'bad'}},res);
  assert.equal(res.statusCode,400);assert.equal(h.hookCalls.length,0);assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!h.calls.some(c=>c.sql.includes('UPDATE users')));
});
for(const invalidOtp of [false,true])test('password reset '+(invalidOtp?'failure':'success')+' receipt',async()=>{
  const h=authHarness({invalidOtp,query(sql){if(sql.includes('FROM email_verifications'))return [[{id:75,email:'owner@example.test',attempts_count:0,is_expired:0,otp_hash:'isolated'}]];}});
  const res=response();await h.controller.resetPassword({body:{email:'owner@example.test',otp:'123456',new_password:'Password123'},headers:{}},res);
  assert.equal(res.statusCode,invalidOtp?400:200);assert.equal(h.hookCalls.length,invalidOtp?0:1);
  if(!invalidOtp){assert.equal(h.hookCalls[0].type,'IDENTITY.SECURITY_ALERT');assert.ok(h.calls.findIndex(c=>c.sql==='REVOKE SESSIONS')<h.calls.findIndex(c=>c.sql==='NOTICE'));}
});
function googleHarness(options={}) {
  const h=adapter(options);h.service=load('services/googleAuthService.js',{'../config/db':h.db,
    'google-auth-library':{OAuth2Client:class{}},'./supplierProfileService':identityResolver(h)});
  h.service.verifyIdToken=async()=>({sub:'opaque-google-id',email:'owner@example.test',email_verified:true});return h;
}
for(const [method,user,count] of [
  ['linkGoogleAccount',{google_id:null},1],['linkGoogleAccount',{google_id:'opaque-google-id'},0],
  ['unlinkGoogleAccount',{google_id:'opaque-google-id',password_hash:'isolated'},1]
])test('Google '+method+' records only meaningful changes',async()=>{
  const h=googleHarness({user,query(sql){if(sql.includes('google_id = ? AND id !='))return [[]];}});
  await h.service[method]({userId:19,idToken:'private credential'});assert.equal(h.hookCalls.length,count);
  if(count)assert.equal(h.hookCalls[0].type,'IDENTITY.SECURITY_ALERT');assert.equal(h.calls.at(-2).sql,'COMMIT');
});
test('Google unlink prevents lockout without receipt',async()=>{
  const h=googleHarness({user:{google_id:'opaque-google-id',password_hash:null}});
  await assert.rejects(h.service.unlinkGoogleAccount({userId:19}),/password/);assert.equal(h.hookCalls.length,0);assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));
});
test('Google linking receipt failure rolls mutation back',async()=>{
  const h=googleHarness({failNotice:true,query(sql){if(sql.includes('google_id = ? AND id !='))return [[]];}});
  await assert.rejects(h.service.linkGoogleAccount({userId:19,idToken:'private credential'}),/notice failed/);assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));
});
test('Google onboarding registration is atomic',async()=>{
  const h=googleHarness({user:{role:'BUYER'},query(sql){if(sql.includes('WHERE google_id =')||sql.includes('WHERE email ='))return [[]];if(sql.includes('INSERT INTO users'))return [{insertId:19}];}});
  assert.equal((await h.service.authenticateGoogleUser({idToken:'private credential'})).isNewUser,true);
  assert.equal(h.hookCalls[0].type,'IDENTITY.REGISTERED');assert.ok(h.calls.findIndex(c=>c.sql==='NOTICE')<h.calls.findIndex(c=>c.sql==='COMMIT'));
});
test('supplier application creates receipt on the same transaction without changing BUYER role',async()=>{
  const h=authHarness({user:{role:'BUYER'},query(sql){if(sql.includes('FROM supplier_profiles'))return [[]];}});
  const res=response();await h.controller.applyForSupplier({user:{id:19,role:'BUYER'},body:{business_name:'Business',address:'private address'}},res);
  assert.equal(res.statusCode,201);assert.equal(h.hookCalls[0].type,'IDENTITY.VERIFICATION_SUBMITTED');
  assert.equal(h.hookCalls[0].recipients[0].role,'BUYER');assert.ok(h.calls.some(c=>c.sql==='COMMIT'));
});
test('concurrent application is rejected after locked ownership check',async()=>{
  let reads=0;
  const h=authHarness({user:{role:'BUYER'},query(sql){if(sql.includes('FROM supplier_profiles'))return [++reads===1?[]:[{supplier_id:19}]];}});
  const res=response();await h.controller.applyForSupplier({user:{id:19,role:'BUYER'},body:{}},res);
  assert.equal(res.statusCode,409);assert.equal(h.hookCalls.length,0);assert.ok(!h.calls.some(c=>c.sql.includes('UPDATE users')));
});
test('password reset notice failure rolls back and does not return success',async()=>{
  const h=authHarness({failNotice:true,query(sql){if(sql.includes('FROM email_verifications'))return [[{id:75,attempts_count:0,is_expired:0}]];}});
  const res=response();await h.controller.resetPassword({body:{email:'owner@example.test',otp:'123456',new_password:'Password123'},headers:{}},res);
  assert.equal(res.statusCode,500);assert.ok(h.calls.some(c=>c.sql==='REVOKE SESSIONS'));assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));
});
test('caller-owned delivery transaction is neither committed nor released by service',async()=>{
  const h=deliveryHarness();await h.service.updateSupplierSettings(19,{pickup_enabled:true},h.conn);
  assert.equal(h.hookCalls.length,1);assert.ok(!h.calls.some(c=>['BEGIN','COMMIT','RELEASE'].includes(c.sql)));
});
test('specialized admin receives account security event',async()=>{
  const h=controllerHarness({user:{role:'OPERATIONS_ADMIN',verification_status:'VERIFIED'}});const res=response();
  await h.controller.suspendUser({params:{id:'19'},user:{id:99,role:'SUPER_ADMIN'},body:{}},res);
  assert.equal(res.statusCode,200);assert.equal(h.enqueues.length,1);assert.equal(h.enqueues[0].role,'OPERATIONS_ADMIN');assert.ok(h.calls.some(c=>c.sql==='COMMIT'));
});
test('two simultaneous verification submissions serialize to one receipt',async()=>{
  let status='NOT_SUBMITTED', initialReads=0, openInitial;
  const bothRead=new Promise(resolve=>{openInitial=resolve;});
  let releaseLock;let lockHeld=false;const waiters=[];const hookCalls=[];const connections=[];
  const db={async getConnection(){
    const tx={holding:false,async beginTransaction(){},async query(sql){
      if(sql.includes("role IN ("))return [[]];return [[{id:19,role:'SUPPLIER'}]];
    },async commit(){this.unlock();},async rollback(){this.unlock();},release(){},unlock(){if(this.holding){this.holding=false;lockHeld=false;const next=waiters.shift();if(next)next();}}};
    connections.push(tx);return tx;
  }};
  const repo={async findBySupplierId(id,tx){
    if(!tx){const value={supplier_id:19,verification_status:status};if(++initialReads===2)openInitial();await bothRead;return value;}
    return {supplier_id:19,verification_status:status};
  },async lockForUpdate(id,tx){
    if(lockHeld)await new Promise(resolve=>waiters.push(resolve));lockHeld=true;tx.holding=true;
  },async submitForReview(id,tx){assert.ok(tx.holding);status='PENDING_REVIEW';return {supplier_id:19,submitted_at:'now'};}};
  const service=load('services/supplierProfileService.js',{'../config/db':db,'../repositories/supplierProfileRepository':repo,
    './supplierValidationService':{validateProfileData:()=>({valid:true})},'node:crypto':crypto,
    './ucpTransactionalNotifications':{async recordInAppOnConnection(tx,event){assert.ok(tx.holding);hookCalls.push(event);}}});
  const results=await Promise.all([service.submitVerification(19),service.submitVerification(19)]);
  assert.equal(results.filter(r=>r.alreadyPending).length,1);assert.equal(hookCalls.length,1);assert.equal(connections.length,2);assert.equal(lockHeld,false);
});
function catalogLifecycleHarness(options={}) {
  const h=adapter({...options,query:async(sql,args)=>{
    if(options.query){const result=await options.query(sql,args);if(result!==undefined)return result;}
    if(sql.includes('FROM pools p'))return [options.openPool?[{id:12,status:'OPEN'}]:[]];
    if(sql.includes('FROM supplier_skus'))return [options.children || []];
  }});
  let request={id:7,supplier_id:19,request_type:'NEW_FAMILY',status:'SUBMITTED',category_id:2,proposed_family_name:'Rice family',normalized_payload:{},...options.request};
  let product={id:3,supplier_id:19,status:'DRAFT',family_id:4,...options.product};
  let sku={id:6,supplier_id:19,status:'PUBLISHED',linked_spec_id:8,...options.sku};
  const category={id:2,name:'Food',is_active:1,approval_status:'APPROVED'};
  const write=(label,row,values,tx)=>{assert.equal(tx,h.conn);h.calls.push({sql:label});Object.assign(row,values);return {...row};};
  const repo={
    findCategoryById:async()=>category,
    findFamilyBySlugOrName:async()=>options.existingFamily?{id:4,family_code:'FAM-4'}:null,
    findActiveDuplicateRequest:async()=>options.duplicate?{id:88}:null,
    async findCatalogRequestById(id,tx,lock){if(tx){assert.equal(tx,h.conn);assert.equal(lock,true);}return {...request};},
    async createCatalogRequest(data,tx){request={...data,id:7};return write('CREATE REQUEST',request,{},tx);},
    async updateCatalogRequest(id,data,tx){return write('UPDATE REQUEST',request,data,tx);},
    async insertModerationLog(data,tx){assert.equal(tx,h.conn);h.calls.push({sql:'MODERATION LOG'});},
    async findSupplierProductById(id,tx,lock){assert.equal(tx,h.conn);assert.equal(lock,true);return {...product};},
    async transitionSupplierProductStatus(id,status,tx){return write('PRODUCT '+status,product,{status},tx);},
    async findSupplierSkuById(id,tx,lock){assert.equal(tx,h.conn);assert.equal(lock,true);return {...sku};},
    async archiveSupplierSku(id,tx){return write('ARCHIVE SKU',sku,{status:'ARCHIVED'},tx);}
  };
  h.service=load('services/catalogService.js',{'../config/db':h.db,'node:crypto':crypto,'./ucpTransactionalNotifications':h.writer,
    '../repositories/catalogRepository':repo,'../repositories/productRepo':{},'../repositories/productSpecificationRepo':{},
    './specificationService':{normalizeText:value=>value==null?'':String(value).trim(),slugify:value=>value.toLowerCase().replaceAll(' ','-'),computeCatalogRequestHash:()=> 'hash'},
    './subscriptionEntitlementService':{assertCanPublishInFamily:async()=>{if(options.entitlementFailure)throw Error('not entitled');}}});
  return h;
}
function assertQueued(h,type,id,count=1){
  assert.equal(h.enqueues.length,count);
  for(const event of h.enqueues){assert.equal(event.eventType,type);assert.equal(event.entityId,id);assert.equal(event.userId,19);}
  assert.ok(h.calls.findIndex(c=>c.sql==='ENQUEUE')<h.calls.findIndex(c=>c.sql==='COMMIT'));
}
for(const draft of [false,true])test('family request creation '+(draft?'draft stays silent':'enqueues submission'),async()=>{
  const h=catalogLifecycleHarness();await h.service.createSupplierCatalogRequest(19,{request_type:'NEW_FAMILY',category_id:2,proposed_family_name:'Rice family',save_as_draft:draft});
  if(draft)assert.equal(h.enqueues.length,0);else assertQueued(h,'CATALOG.FAMILY_REQUEST_SUBMITTED',7);
  assert.ok(h.calls.some(c=>c.sql==='MODERATION LOG'));assert.ok(h.calls.some(c=>c.sql==='COMMIT'));
});
for(const status of ['DRAFT','REJECTED'])test('family '+status+' resubmission enqueues under row lock',async()=>{
  const h=catalogLifecycleHarness({request:{status}});await h.service.updateSupplierCatalogRequest(19,7,{});assertQueued(h,'CATALOG.FAMILY_REQUEST_SUBMITTED',7);
});
test('family draft edit stays silent',async()=>{const h=catalogLifecycleHarness({request:{status:'DRAFT'}});await h.service.updateSupplierCatalogRequest(19,7,{save_as_draft:true});assert.equal(h.enqueues.length,0);});
for(const method of ['createSupplierCatalogRequest','updateSupplierCatalogRequest'])test(method+' notification failure rolls mutation back',async()=>{
  const h=catalogLifecycleHarness({request:{status:'DRAFT'},failNotice:true});
  await assert.rejects(method==='createSupplierCatalogRequest'?h.service[method](19,{request_type:'NEW_FAMILY',category_id:2,proposed_family_name:'Rice family'}):h.service[method](19,7,{}),/notice failed/);
  assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));assert.equal(h.enqueues.length,0);
});
for(const [name,options,error] of [['ownership',{request:{supplier_id:20,status:'DRAFT'}},/authorized/],['state',{request:{status:'SUBMITTED'}},/cannot be edited/],['duplicate',{request:{status:'DRAFT'},duplicate:true},/identical/]])test('family resubmission '+name+' validation never enqueues',async()=>{
  const h=catalogLifecycleHarness(options);await assert.rejects(h.service.updateSupplierCatalogRequest(19,7,{}),error);assert.equal(h.enqueues.length,0);assert.ok(!h.calls.some(c=>c.sql==='UPDATE REQUEST'));
});
test('family review enqueues after moderation evidence',async()=>{
  const h=catalogLifecycleHarness();await h.service.markRequestUnderReview(7,99,'VERIFICATION_ADMIN','private review');assertQueued(h,'CATALOG.FAMILY_REQUEST_REVIEWED',7);
  assert.ok(h.calls.findIndex(c=>c.sql==='MODERATION LOG')<h.calls.findIndex(c=>c.sql==='ENQUEUE'));
});
test('repeated family review stays silent',async()=>{const h=catalogLifecycleHarness({request:{status:'UNDER_REVIEW'}});await h.service.markRequestUnderReview(7,99,'ADMIN');assert.equal(h.enqueues.length,0);});
test('family approval enqueues actual canonical family decision',async()=>{
  const h=catalogLifecycleHarness({existingFamily:true});await h.service.approveCatalogRequest(7,99,'VERIFICATION_ADMIN');assertQueued(h,'CATALOG.FAMILY_REQUEST_APPROVED',7);
});
test('family approval replay stays silent',async()=>{const h=catalogLifecycleHarness({request:{status:'APPROVED'}});assert.equal((await h.service.approveCatalogRequest(7,99,'ADMIN')).alreadyApproved,true);assert.equal(h.enqueues.length,0);});
test('family rejection enqueues without private reason',async()=>{const h=catalogLifecycleHarness();await h.service.rejectCatalogRequest(7,99,'ADMIN','private document reason');assertQueued(h,'CATALOG.FAMILY_REQUEST_REJECTED',7);});
test('invalid family rejection remains silent',async()=>{const h=catalogLifecycleHarness();await assert.rejects(h.service.rejectCatalogRequest(7,99,'ADMIN','bad'),/mandatory/);assert.equal(h.calls.length,0);});
for(const [method,args] of [['markRequestUnderReview',[7,99,'ADMIN']],['approveCatalogRequest',[7,99,'ADMIN']],['rejectCatalogRequest',[7,99,'ADMIN','valid reason']]])test(method+' event failure rolls moderation back',async()=>{
  const h=catalogLifecycleHarness({existingFamily:true,failNotice:true});await assert.rejects(h.service[method](...args),/notice failed/);assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));
});
test('product publication queues owner event',async()=>{const h=catalogLifecycleHarness();await h.service.publishSupplierProduct(19,3);assertQueued(h,'CATALOG.PRODUCT_PUBLISHED',3);});
test('product publish replay stays silent',async()=>{const h=catalogLifecycleHarness({product:{status:'PUBLISHED'}});await h.service.publishSupplierProduct(19,3);assert.equal(h.enqueues.length,0);});
test('product archive queues product plus changed child SKUs after archive writes',async()=>{
  const h=catalogLifecycleHarness({children:[{id:6,supplier_id:19,status:'PUBLISHED'},{id:8,supplier_id:19,status:'DRAFT'}]});await h.service.archiveSupplierProduct(19,3);
  assert.deepEqual(h.enqueues.map(e=>[e.eventType,e.entityId]),[['CATALOG.PRODUCT_ARCHIVED',3],['CATALOG.SKU_ARCHIVED',6],['CATALOG.SKU_ARCHIVED',8]]);
  assert.ok(h.calls.findIndex(c=>c.sql.includes('UPDATE supplier_listings'))<h.calls.findIndex(c=>c.sql==='ENQUEUE'));
});
test('product archive replay stays silent',async()=>{const h=catalogLifecycleHarness({product:{status:'ARCHIVED'}});await h.service.archiveSupplierProduct(19,3);assert.equal(h.enqueues.length,0);});
test('SKU archive queues actual archive event',async()=>{const h=catalogLifecycleHarness();await h.service.archiveSupplierSku(19,6);assertQueued(h,'CATALOG.SKU_ARCHIVED',6);});
test('SKU archive replay stays silent',async()=>{const h=catalogLifecycleHarness({sku:{status:'ARCHIVED'}});await h.service.archiveSupplierSku(19,6);assert.equal(h.enqueues.length,0);});
for(const method of ['publishSupplierProduct','archiveSupplierProduct','archiveSupplierSku'])test(method+' ownership failure remains silent',async()=>{
  const h=catalogLifecycleHarness({product:{supplier_id:20},sku:{supplier_id:20}});await assert.rejects(h.service[method](19,method==='archiveSupplierSku'?6:3),/own/);assert.equal(h.enqueues.length,0);
});
for(const method of ['archiveSupplierProduct','archiveSupplierSku'])test(method+' open pool blocker prevents archive and enqueue',async()=>{
  const h=catalogLifecycleHarness({openPool:true});await assert.rejects(h.service[method](19,method==='archiveSupplierSku'?6:3),/non-terminal/);assert.equal(h.enqueues.length,0);
});
for(const method of ['publishSupplierProduct','archiveSupplierProduct','archiveSupplierSku'])test(method+' enqueue failure rolls transaction back',async()=>{
  const h=catalogLifecycleHarness({failNotice:true});await assert.rejects(h.service[method](19,method==='archiveSupplierSku'?6:3),/notice failed/);assert.equal(h.enqueues.length,0);assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));
});
test('verification administrator gets only genuine submission escalation',async()=>{
  const h=profileHarness({adminRows:[{id:99,role:'VERIFICATION_ADMIN'}]});await h.service.submitVerification(19);
  assert.deepEqual(h.enqueues.map(e=>[e.userId,e.role,e.eventType]),[[19,'SUPPLIER','IDENTITY.VERIFICATION_SUBMITTED'],[99,'VERIFICATION_ADMIN','IDENTITY.VERIFICATION_SUBMITTED']]);
});
for(const role of ['FINANCE_ADMIN','OPERATIONS_ADMIN','VERIFICATION_ADMIN','SUPPORT_ADMIN'])test(role+' account lock receipt is supported',async()=>{
  const h=controllerHarness({user:{role,verification_status:'VERIFIED'}});const res=response();await h.controller.suspendUser({params:{id:'19'},user:{id:99,role:'SUPER_ADMIN'},body:{}},res);
  assert.equal(res.statusCode,200);assert.equal(h.enqueues[0].role,role);assert.equal(h.enqueues[0].eventType,'IDENTITY.ACCOUNT_LOCKED');
});
test('publishing SKU also enqueues actual parent product publication',async()=>{
  const h=catalogHarness({productStatus:'DRAFT'});await h.service.publishSupplierSku(19,6);
  assert.deepEqual(h.enqueues.map(e=>[e.eventType,e.entityId]),[['CATALOG.PRODUCT_PUBLISHED',3],['CATALOG.SKU_PUBLISHED',6]]);
});
test('direct and cascaded SKU archive share durable idempotency identity',async()=>{
  const direct=catalogLifecycleHarness();await direct.service.archiveSupplierSku(19,6);
  const cascade=catalogLifecycleHarness({children:[{id:6,supplier_id:19,status:'PUBLISHED'}]});await cascade.service.archiveSupplierProduct(19,3);
  assert.equal(direct.enqueues[0].eventKey,cascade.enqueues.find(e=>e.eventType==='CATALOG.SKU_ARCHIVED').eventKey);
});
test('child archive enqueue failure rolls back the entire product archive batch',async()=>{
  const h=catalogLifecycleHarness({failEnqueueAt:2,children:[{id:6,supplier_id:19,status:'PUBLISHED'}]});
  await assert.rejects(h.service.archiveSupplierProduct(19,3),/notice failed/);
  assert.ok(h.calls.some(c=>c.sql==='ENQUEUE'));assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));assert.equal(h.enqueues.length,0);
});
for(const status of ['UNDER_REVIEW','SUSPENDED','REJECTED','MORE_INFORMATION_REQUIRED'])test('repeated '+status+' verification decision does not enqueue',async()=>{
  const h=controllerHarness({query(sql){if(sql.includes('FROM supplier_profiles'))return [[{supplier_id:19,verification_status:status}]];}});
  const res=response();await h.controller.verifySupplier({params:{id:'19'},user:{id:99,role:'VERIFICATION_ADMIN'},body:{verification_status:status,rejection_reason:'private guidance'}},res);
  assert.equal(res.statusCode,200);assert.equal(h.enqueues.length,0);
});
function emailVerificationHarness(options={}) {
  let state={user:{id:19,role:'BUYER',verification_status:'UNVERIFIED',is_verified:0,buyer_trust_status:'CONTACT_VERIFIED',...options.user},
    attempts:options.attempts || 0,consumed:false,audited:false};
  const h=authHarness({...options,createEmailService(h){
    const email=load('services/emailService.js',{crypto,nodemailer:{},'../config/db':{query:async()=>{throw Error('GLOBAL_OTP_POOL_FORBIDDEN');}}});
    const realVerify=email.verifyAndConsumeOtp.bind(email);
    email.verifyAndConsumeOtp=async args=>{
      assert.equal(args.connection,h.conn);assert.equal(args.purpose,'REGISTRATION_VERIFY');
      assert.ok(h.calls.some(c=>c.sql.includes('FROM users')&&c.sql.includes('FOR UPDATE')),'user locked before OTP');
      return realVerify(args);
    };
    return email;
  },async query(sql,args){
    if(sql.includes('FROM users'))return [options.missingUser?[]:[{...state.user}]];
    if(sql.includes('FROM email_verifications'))return [state.consumed?[]:[{id:8,email:'owner@example.test',otp_hash:crypto.createHash('sha256').update('123456').digest('hex'),
      expires_at:'2026-11-17',attempts_count:state.attempts,is_expired:0}]];
    if(sql.includes('AS is_expired'))return [[{is_expired:options.expired?1:0}]];
    if(sql.includes('SET attempts_count')){state.attempts++;return [{affectedRows:1}];}
    if(sql.includes('UPDATE email_verifications SET consumed_at')){state.consumed=true;return [{affectedRows:1}];}
    if(sql.includes('UPDATE users')){
      assert.notEqual(state.user.verification_status,'BLOCKED');assert.notEqual(state.user.buyer_trust_status,'SUSPENDED');
      if(state.user.verification_status!=='VERIFIED')state.user.verification_status='EMAIL_VERIFIED';state.user.is_verified=1;
      return [{affectedRows:1}];
    }
    if(sql.includes('INSERT INTO system_audit_logs')){
      if(options.failAudit)throw Object.assign(Error('audit failed'),{otpAttemptRecorded:Boolean(options.auditAttemptFlag)});state.audited=true;return [{insertId:75,affectedRows:1}];
    }
    throw Error('Unexpected email verification SQL: '+sql);
  }});
  h.db.query=async()=>{throw Error('GLOBAL_AUTH_POOL_FORBIDDEN');};
  let saved, savedEnqueues, savedHooks;
  const begin=h.conn.beginTransaction.bind(h.conn), rollback=h.conn.rollback.bind(h.conn);
  h.conn.beginTransaction=async()=>{saved=structuredClone(state);savedEnqueues=[...h.enqueues];savedHooks=[...h.hookCalls];await begin();};
  h.conn.rollback=async()=>{state=saved;await rollback();h.enqueues.push(...savedEnqueues);h.hookCalls.push(...savedHooks);};
  h.state=()=>state;
  return h;
}
test('email verification locks user then atomically consumes OTP, verifies, audits and enqueues',async()=>{
  const h=emailVerificationHarness();const res=response();await h.controller.verifyEmail({user:{id:19},body:{otp:'123456'}},res);
  assert.equal(res.statusCode,200,JSON.stringify(res.body));assert.equal(h.state().consumed,true);assert.equal(h.state().user.verification_status,'EMAIL_VERIFIED');assert.equal(h.state().audited,true);
  assertQueued(h,'IDENTITY.EMAIL_VERIFIED',19);
  const index=needle=>h.calls.findIndex(c=>c.sql.includes(needle));
  assert.ok(index('FROM users')<index('FROM email_verifications'));assert.ok(index('SET consumed_at')<index('UPDATE users'));
  assert.ok(index('UPDATE users')<index('INSERT INTO system_audit_logs'));assert.ok(index('INSERT INTO system_audit_logs')<index('ENQUEUE'));
});
for(const [name,options,otp,status,attempts,consumed] of [
  ['invalid code',{attempts:0},'999999',400,1,false],
  ['last permitted invalid attempt',{attempts:4},'999999',400,5,false],
  ['maximum attempts burns challenge',{attempts:5},'123456',429,5,true]
])test('email OTP '+name+' commits only durable brute-force protection',async()=>{
  const h=emailVerificationHarness(options);const res=response();await h.controller.verifyEmail({user:{id:19},body:{otp}},res);
  assert.equal(res.statusCode,status);assert.equal(h.state().attempts,attempts);assert.equal(h.state().consumed,consumed);
  assert.equal(h.state().user.verification_status,'UNVERIFIED');assert.equal(h.state().user.is_verified,0);assert.equal(h.state().audited,false);
  assert.equal(h.enqueues.length,0);assert.ok(h.calls.some(c=>c.sql==='COMMIT'));assert.ok(!h.calls.some(c=>c.sql==='ROLLBACK'));
  assert.ok(!h.calls.some(c=>c.sql.includes('UPDATE users')||c.sql.includes('INSERT INTO system_audit_logs')));
  assert.equal(h.calls.at(-1).sql,'RELEASE');
});
for(const [name,options,otp,status] of [['expired',{expired:true},'123456',410],['malformed',{},'bad',400]])test('email OTP '+name+' rolls back without attempt writes',async()=>{
  const h=emailVerificationHarness(options);const res=response();await h.controller.verifyEmail({user:{id:19},body:{otp}},res);
  assert.equal(res.statusCode,status);assert.equal(h.state().attempts,0);assert.equal(h.state().consumed,false);assert.equal(h.enqueues.length,0);
  assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));
});
for(const options of [{failAudit:true},{failNotice:true},{failAudit:true,auditAttemptFlag:true}])test('email verification '+(options.failNotice?'enqueue':'audit')+' failure restores OTP and account',async()=>{
  const h=emailVerificationHarness(options);const res=response();await h.controller.verifyEmail({user:{id:19},body:{otp:'123456'}},res);
  assert.equal(res.statusCode,500);assert.equal(h.state().attempts,0);assert.equal(h.state().consumed,false);assert.equal(h.state().audited,false);
  assert.equal(h.state().user.verification_status,'UNVERIFIED');assert.equal(h.state().user.is_verified,0);
  assert.equal(h.enqueues.length,0);assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));
});
for(const user of [{verification_status:'BLOCKED',is_verified:0},{verification_status:'VERIFIED',is_verified:1,buyer_trust_status:'SUSPENDED'},{role:'SUPPLIER',verification_status:'PENDING_SUPPLIER_VERIFICATION',is_verified:0}])test('email proof preserves '+(user.role||user.verification_status)+' account restrictions',async()=>{
  const h=emailVerificationHarness({user});const res=response();await h.controller.verifyEmail({user:{id:19,role:'ADMIN'},body:{otp:'123456'}},res);
  assert.equal(res.statusCode,200);assert.equal(h.state().user.verification_status,user.verification_status);assert.equal(h.state().user.is_verified,user.is_verified);
  assert.ok(!h.calls.some(c=>c.sql.includes('UPDATE users')||c.sql.includes('supplier_profiles')));
  assertQueued(h,'IDENTITY.EMAIL_VERIFIED',19);assert.equal(h.enqueues[0].role,user.role || 'BUYER');
});
test('public email verification resolves normalized identity under transaction lock without pool query',async()=>{
  const h=emailVerificationHarness();const res=response();await h.controller.verifyEmail({body:{email:' Owner@Example.Test ',otp:'123456'}},res);
  assert.equal(res.statusCode,200);const lookup=h.calls.find(c=>c.sql.includes('WHERE email = ? FOR UPDATE'));
  assert.ok(lookup);assert.deepEqual(Array.from(lookup.args),['owner@example.test']);assertQueued(h,'IDENTITY.EMAIL_VERIFIED',19);
});
test('missing persisted user rolls back before consuming OTP',async()=>{
  const h=emailVerificationHarness({missingUser:true});const res=response();await h.controller.verifyEmail({body:{email:'missing@example.test',otp:'123456'}},res);
  assert.equal(res.statusCode,400);assert.ok(!h.calls.some(c=>c.sql.includes('FROM email_verifications')));assert.equal(h.enqueues.length,0);assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));
});
test('email OTP replay cannot enqueue a second verification event',async()=>{
  const h=emailVerificationHarness();const first=response();await h.controller.verifyEmail({user:{id:19},body:{otp:'123456'}},first);
  const second=response();await h.controller.verifyEmail({user:{id:19},body:{otp:'123456'}},second);
  assert.equal(first.statusCode,200);assert.equal(second.statusCode,404);assert.equal(second.body.error.code,'OTP_NOT_FOUND');
  assert.equal(h.enqueues.length,1);assert.equal(h.state().consumed,true);assert.equal(h.state().user.verification_status,'EMAIL_VERIFIED');
});
test('simultaneous email verification consumes a challenge and enqueues proof once',async()=>{
  const user={id:19,role:'BUYER',verification_status:'UNVERIFIED',is_verified:0};
  let consumed=false,attempts=0,owner=null;const waiting=[],events=[],transactions=[];
  const unlock=tx=>{if(owner===tx){owner=null;const next=waiting.shift();if(next)next();}};
  const db={async query(){throw Error('GLOBAL_POOL_FORBIDDEN');},async getConnection(){
    const tx={async beginTransaction(){},async query(sql,args){
      if(sql.includes('FROM users')){
        if(sql.includes('FOR UPDATE')){if(owner)await new Promise(resolve=>waiting.push(resolve));owner=this;}
        return [[{...user}]];
      }
      assert.equal(owner,this,'all verification SQL remains under the user lock');
      if(sql.includes('FROM email_verifications'))return [consumed?[]:[{id:8,email:'owner@example.test',otp_hash:crypto.createHash('sha256').update('123456').digest('hex'),expires_at:'2026-11-17',attempts_count:attempts,is_expired:0}]];
      if(sql.includes('AS is_expired'))return [[{is_expired:0}]];
      if(sql.includes('SET attempts_count')){attempts++;return [{affectedRows:1}];}
      if(sql.includes('UPDATE email_verifications SET consumed_at')){assert.equal(consumed,false);consumed=true;return [{affectedRows:1}];}
      if(sql.includes('UPDATE users')){user.verification_status='EMAIL_VERIFIED';user.is_verified=1;return [{affectedRows:1}];}
      if(sql.includes('INSERT INTO system_audit_logs'))return [{insertId:75}];
      throw Error('Unexpected concurrent verification SQL: '+sql);
    },async commit(){this.committed=true;unlock(this);},async rollback(){this.rolledBack=true;unlock(this);},release(){this.released=true;}};
    transactions.push(tx);return tx;
  }};
  const email=load('services/emailService.js',{crypto,nodemailer:{},'../config/db':db});
  const durable=load('services/ucpTransactionalNotifications.js',{'./ucpNotificationEventCatalog':{getEventDefinition,buildEventKey},
    './notificationService':{async enqueueEvent(tx,event){assert.equal(tx,owner);events.push(event);return [{affectedRows:1}];}}});
  const identity=load('services/supplierProfileService.js',{'../config/db':db,'../repositories/supplierProfileRepository':{},
    './supplierValidationService':{},'node:crypto':crypto,'./ucpTransactionalNotifications':durable});
  const controller=load('controllers/authController.js',{'../config/db':db,crypto,bcryptjs:{},jsonwebtoken:{},
    '../middlewares/authGuard':{},'../services/googleAuthService':{},'../services/emailService':email,
    '../services/sessionService':{},'../services/supplierProfileService':identity});
  const first=response(),second=response();
  await Promise.all([controller.verifyEmail({user:{id:19},body:{otp:'123456'}},first),controller.verifyEmail({user:{id:19},body:{otp:'123456'}},second)]);
  assert.deepEqual([first.statusCode,second.statusCode].sort(),[200,404]);assert.equal(attempts,1);assert.equal(events.length,1);assert.equal(events[0].eventType,'IDENTITY.EMAIL_VERIFIED');
  assert.equal(transactions.filter(tx=>tx.committed).length,1);assert.equal(transactions.filter(tx=>tx.rolledBack).length,1);
  assert.ok(transactions.every(tx=>tx.released));assert.equal(owner,null);
});
