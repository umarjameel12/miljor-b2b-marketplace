'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {summarize,REQUIRED_KEYS}=require('./smart_hub_paid_browser_provider_readiness');
test('presence audit never exports credentials or mutates the process environment',()=>{
  const before={...process.env},secret='DO_NOT_DISCLOSE_fixture_value';
  const result=summarize(REQUIRED_KEYS.map(key=>key+'='+secret).join('\n'));
  assert.deepEqual(Object.values(result.keys),REQUIRED_KEYS.map(()=> 'PRESENT'));
  assert.equal(JSON.stringify(result).includes(secret),false);
  assert.deepEqual({...process.env},before);
  assert.equal(result.genuine_provider_verified,false);
});
test('empty, quoted-empty and absent settings report missing without claiming verification',()=>{
  const result=summarize('SAFEPAY_PUBLIC_KEY=""\nSAFEPAY_SECRET_KEY=   \nIGNORED=private');
  assert.deepEqual(Object.values(result.keys),REQUIRED_KEYS.map(()=> 'MISSING'));
  assert.equal(JSON.stringify(result).includes('private'),false);
});
test('SMTP presence cannot claim real delivery or provider-origin payment',()=>{
  const result=summarize('SMTP_HOST=private.example\nSMTP_USER=private-user\nSMTP_PASS=private-password\nSMS_API_KEY=private-sms-key\nSMS_SENDER=private-sender');
  for(const key of ['SMTP_HOST','SMTP_USER','SMTP_PASS'])assert.equal(result.keys[key],'PRESENT');
  assert.equal(result.genuine_provider_verified,false);assert.equal(result.genuine_email_delivery_verified,false);
  for(const value of ['private.example','private-user','private-password','private-sms-key','private-sender'])assert.equal(JSON.stringify(result).includes(value),false);
  assert.ok(result.prerequisites.some(item=>item.includes('untouched raw JSON bytes')));
  assert.ok(result.prerequisites.some(item=>item.includes('previous cross-path receipt mismatch is fixed')));
  assert.equal(result.required_user_inputs.length,1);
});
test('explicit user waiver excludes SMS inspection, gates and recipient prerequisites',()=>{
  const result=summarize('SMS_API_KEY=private-sms-key\nSMS_SENDER=private-sender');
  assert.equal(result.user_sms_scope.status,'EXCLUDED_USER_WAIVED');
  assert.match(result.user_sms_scope.reason,/not a global application setting/);
  assert.equal(Object.hasOwn(result.keys,'SMS_API_KEY'),false);assert.equal(Object.hasOwn(result.keys,'SMS_SENDER'),false);
  assert.ok(result.prerequisites.every(item=>!item.includes('SMS')));assert.ok(result.required_user_inputs.every(item=>!item.includes('SMS')));
  assert.equal(JSON.stringify(result).includes('private-sms-key'),false);
});
