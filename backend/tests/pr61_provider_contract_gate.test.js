'use strict';
// Safety-only Safepay provider contract gate. No network, DB or money movement.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const adapter=require('../src/services/safepayAdapter');
const {inspect}=require('../scripts/safepaySandboxPreflight');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const sources={
  adapter:read('src/services/safepayAdapter.js'),
  v3Client:read('src/services/safepayV3SandboxClient.js'),
  v3Contract:read('src/services/safepayV3ContractService.js'),
  provider:read('src/services/paymentProviderService.js'),
  settlement:read('src/services/financialSettlementService.js')
};
const example={
  SAFEPAY_ENV:'sandbox',ALLOW_EXTERNAL_MONEY_MOVEMENT:'false',
  DB_NAME:'miljor_test_db',SAFEPAY_PUBLIC_KEY:'sec_sand_randompublickey1234',
  SAFEPAY_SECRET_KEY:'sec_sand_randomsecretkey1234',
  SAFEPAY_WEBHOOK_SECRET:'sandbox-long-random-hmac-123456789abc'
};
test('unknown provider contract or v3 minor units cannot pass legacy v1 readiness',()=>{
  for(const extra of [
    {},
    {SAFEPAY_TRACKER_CONTRACT:'payments-v3-minor',SAFEPAY_LEGACY_CONTRACT_VERIFIED:'true'},
    {SAFEPAY_TRACKER_CONTRACT:'legacy-v1-major',SAFEPAY_LEGACY_CONTRACT_VERIFIED:'false'}
  ]){
    const outcome=inspect({...example,...extra},sources);
    assert.equal(outcome.safe_to_attempt_provider_test,false);
    assert.equal(outcome.provider_checkout,'BLOCKED_NOT_EXECUTED');
    assert.match(outcome.tracker_contract_review,/BLOCKED/);
    assert.equal(outcome.real_funds_moved,false);
  }
});
test('confirmed legacy contract permits only an attempted Sandbox test, not certification',()=>{
  const outcome=inspect({...example,SAFEPAY_TRACKER_CONTRACT:'legacy-v1-major',SAFEPAY_LEGACY_CONTRACT_VERIFIED:'true'},sources);
  assert.equal(outcome.safe_to_attempt_provider_test,true);
  assert.equal(outcome.provider_checkout,'READY_FOR_AUTHORIZED_SANDBOX_ATTEMPT_NOT_YET_EXECUTED');
  assert.equal(outcome.real_funds_moved,false);
  assert.match(outcome.provider_refund,/BLOCKED/);
});
test('Payments v3 contract is ready only when explicitly enabled and implementation sources exist',()=>{
  const outcome=inspect({...example,SAFEPAY_TRACKER_CONTRACT:'payments-v3-minor',
    SAFEPAY_V3_SANDBOX_ENABLED:'true'},sources);
  assert.equal(outcome.safe_to_attempt_provider_test,true);
  assert.equal(outcome.checks.v3_hosted_checkout_and_reporter_present,true);
  assert.equal(outcome.checks.v3_amount_and_webhook_contract_present,true);
  assert.match(outcome.tracker_contract_review,/PAYMENTS_V3_MINOR_IMPLEMENTED/);
});
test('supplier unverified contract does not create INITIATING or UNKNOWN attempt',async()=>{
  const {SupplierSubscriptionCheckoutService}=require('../src/services/supplierSubscriptionCheckoutService');
  let dbTouches=0;
  const db={getConnection:async()=>{dbTouches++;throw Error('DB_MUST_NOT_BE_TOUCHED');},
    query:async()=>{dbTouches++;throw Error('DB_MUST_NOT_BE_TOUCHED')}};
  const fakeAdapter={assertTrackerContract:()=>{
    const error=Error('not verified');error.code='SAFEPAY_TRACKER_CONTRACT_UNVERIFIED';throw error;
  }};
  const svc=new SupplierSubscriptionCheckoutService(db,fakeAdapter);
  const previous={env:process.env.SAFEPAY_ENV,flag:process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT};
  try{
    process.env.SAFEPAY_ENV='sandbox';process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT='false';
    await assert.rejects(()=>svc.start({
      actor:{id:9,role:'SUPPLIER'},
      planCode:'GROWTH',idempotencyKey:'contract-reject-1234'
    }),e=>e.code==='SAFEPAY_TRACKER_CONTRACT_UNVERIFIED');
    assert.equal(dbTouches,0);
  }finally{
    if(previous.env===undefined)delete process.env.SAFEPAY_ENV;
    else process.env.SAFEPAY_ENV=previous.env;
    if(previous.flag===undefined)delete process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT;
    else process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT=previous.flag;
  }
});
test('real adapter checkout blocks before outgoing HTTPS if merchant contract unverified',async()=>{
  const old={
    env:adapter.env,publicKey:adapter.publicKey,
    contract:process.env.SAFEPAY_TRACKER_CONTRACT,
    attested:process.env.SAFEPAY_LEGACY_CONTRACT_VERIFIED
  };
  try{
    adapter.env='sandbox';adapter.publicKey='test-public-only';
    process.env.SAFEPAY_TRACKER_CONTRACT='payments-v3-minor';
    process.env.SAFEPAY_LEGACY_CONTRACT_VERIFIED='true';
    await assert.rejects(
      adapter.createTracker({amount:1250,currency:'PKR',orderCode:'UNIT-NO-NETWORK'}),
      error=>error.code==='SAFEPAY_TRACKER_CONTRACT_UNVERIFIED'
    );
    process.env.SAFEPAY_TRACKER_CONTRACT='legacy-v1-major';
    process.env.SAFEPAY_LEGACY_CONTRACT_VERIFIED='false';
    await assert.rejects(
      adapter.createTracker({amount:1250,currency:'PKR',orderCode:'UNIT-NO-NETWORK'}),
      error=>error.code==='SAFEPAY_TRACKER_CONTRACT_UNVERIFIED'
    );
    const status=adapter.validateConfig();
    assert.deepEqual(status,{env:'sandbox',configured:true});
    assert.ok(!JSON.stringify(status).includes('test-public-only'));
  }finally{
    adapter.env=old.env;adapter.publicKey=old.publicKey;
    if(old.contract===undefined)delete process.env.SAFEPAY_TRACKER_CONTRACT;
    else process.env.SAFEPAY_TRACKER_CONTRACT=old.contract;
    if(old.attested===undefined)delete process.env.SAFEPAY_LEGACY_CONTRACT_VERIFIED;
    else process.env.SAFEPAY_LEGACY_CONTRACT_VERIFIED=old.attested;
  }
});

test('v3 supplier checkout blocks before DB and payment network until signed capture activation exists',async()=>{
  const {SupplierSubscriptionCheckoutService}=require('../src/services/supplierSubscriptionCheckoutService');
  let dbCalls=0,providerCalls=0;
  const forbidden=async()=>{dbCalls++;throw Error('V3_SUBSCRIPTION_MUST_NOT_TOUCH_DB');};
  const db={query:forbidden,getConnection:forbidden};
  const adapter={createTracker:async()=>{providerCalls++;throw Error('UNEXPECTED_PROVIDER_CHARGE');}};
  const svc=new SupplierSubscriptionCheckoutService(db,adapter);
  const prior={env:process.env.SAFEPAY_ENV,
    flag:process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT,
    contract:process.env.SAFEPAY_TRACKER_CONTRACT,
    enabled:process.env.SAFEPAY_V3_SANDBOX_ENABLED};
  try{
    process.env.SAFEPAY_ENV='sandbox';
    process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT='false';
    process.env.SAFEPAY_TRACKER_CONTRACT='payments-v3-minor';
    process.env.SAFEPAY_V3_SANDBOX_ENABLED='true';
    await assert.rejects(()=>svc.start({
      actor:{id:9,role:'SUPPLIER'},planCode:'GROWTH',
      idempotencyKey:'subscription-v3-locked-123'
    }),e=>e.code==='V3_SUBSCRIPTION_CAPTURE_PROOF_REQUIRED'&&e.statusCode===409);
    assert.equal(dbCalls,0,'Cannot create a stranded v3 checkout attempt');
    assert.equal(providerCalls,0,'Cannot initiate an unfulfillable Sandbox charge');
  }finally{
    for(const [key,val] of Object.entries(prior)){
      const name={env:'SAFEPAY_ENV',flag:'ALLOW_EXTERNAL_MONEY_MOVEMENT',
        contract:'SAFEPAY_TRACKER_CONTRACT',enabled:'SAFEPAY_V3_SANDBOX_ENABLED'}[key];
      if(val===undefined)delete process.env[name];else process.env[name]=val;
    }
  }
});
