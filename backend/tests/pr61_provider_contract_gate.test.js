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
  provider:read('src/services/paymentProviderService.js'),
  settlement:read('src/services/financialSettlementService.js')
};
const example={
  SAFEPAY_ENV:'sandbox',ALLOW_EXTERNAL_MONEY_MOVEMENT:'false',
  DB_NAME:'miljor_test_db',SAFEPAY_PUBLIC_KEY:'sandbox-public-unit-only',
  SAFEPAY_SECRET_KEY:'sandbox-secret-unit-only',
  SAFEPAY_WEBHOOK_SECRET:'sandbox-webhook-unit-only'
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
