'use strict';
// PR61 Part 3: deterministic fail-closed safety gate; NO genuine provider traffic.
// A locally generated HMAC is NOT evidence of a Safepay-origin payment.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const checkout=read('src/services/safepayCheckoutService.js');
const subscription=read('src/services/supplierSubscriptionCheckoutService.js');
const finance=read('src/services/financialSettlementService.js');
const notifications=read('src/services/notificationEventPolicy.js');
const legacy=read('tests/safepay_sandbox_live_payment_acceptance.test.js');
const provider=read('src/services/paymentProviderService.js');
const {inspect}=require('../scripts/safepaySandboxPreflight');

test('unsigned webhook event-type header cannot elevate failed signed payload',()=>{
  assert.match(checkout,/signedEventType=parsedPayload\.type/);
  assert.match(checkout,/eventType\s*&&\s*eventType!==signedEventType/);
  assert.match(checkout,/WEBHOOK_EVENT_TYPE_MISMATCH/);
  assert.match(checkout,/const effectiveEventType = signedEventType/);
});
test('both buyer and subscription reconciliation require positive nested capture',()=>{
  for(const s of [checkout,subscription]){
    assert.match(s,/transaction\.status\|\|transaction\.state/);
    assert.match(s,/\['SUCCESS','SUCCEEDED','PAID','CAPTURED','COMPLETED'\]/);
  }
  assert.match(subscription,/PROVIDER_TRANSACTION_ID_MISSING/);
  assert.match(checkout,/INVALID_TRANSACTION_SIGNATURE/);
  assert.match(checkout,/AMOUNT_MISMATCH/);
  assert.match(checkout,/CURRENCY_MISMATCH/);
});
test('refund approval never misreports external execution',()=>{
  assert.match(provider,/REFUND_PENDING_GATEWAY/);
  assert.match(finance,/External refund and payout execution are strictly DISABLED/);
  assert.match(finance,/external_execution_status/);
  assert.match(finance,/REFUND_ASSESSED/);
  assert.match(finance,/REFUND_APPROVED/);
  assert.match(notifications,/REFUND_APPROVED:\['Refund obligation approved; provider execution pending'/);
  assert.doesNotMatch(finance,/\bexecuteExternalPayout\s*\(/);
});
test('payment, refund and subscription notifications have transactional receipt boundaries',()=>{
  assert.match(checkout,/eventType:'PAYMENT_VERIFIED'/);
  assert.match(checkout,/notificationService\.enqueueEvent\(connection/);
  assert.match(finance,/notificationService\.enqueueEvent\(connection/);
  assert.match(subscription,/eventType:'SUBSCRIPTION_ACTIVATED'/);
  assert.match(subscription,/notificationService\.enqueueEvent\(connection/);
  assert.match(notifications,/SUBSCRIPTION_ACTIVATED/);
});
test('synthetic signature tests cannot masquerade as genuine Safepay evidence',()=>{
  assert.match(legacy,/crypto\.createHmac\('sha512'/);
  assert.match(read('tests/p0_safepay_signed_http_acceptance.js'),/NOT a provider-originated callback/);
  const result=inspect({
    SAFEPAY_ENV:'sandbox',ALLOW_EXTERNAL_MONEY_MOVEMENT:'false',
    DB_NAME:'miljor_test_db'
  },{adapter:read('src/services/safepayAdapter.js'),provider,settlement:finance});
  assert.equal(result.safe_to_attempt_provider_test,false);
  assert.equal(result.provider_checkout,'BLOCKED_NOT_EXECUTED');
  assert.match(result.provider_refund,/BLOCKED/);
  assert.match(result.provider_bank_payout,/BLOCKED/);
  assert.equal(result.real_funds_moved,false);
});
test('synthetic HMAC validates only raw-body signature handling',()=>{
  process.env.SAFEPAY_ENV='sandbox';
  const secret='pr61-part3-unit-only-synthetic-hmac-signature';
  process.env.SAFEPAY_WEBHOOK_SECRET=secret;
  const Adapter=require('../src/services/safepayAdapter').constructor;
  const adapter=new Adapter();
  const payload=Buffer.from(JSON.stringify({
    type:'payment.failed',data:{tracker:'track_unit_only'}}));
  const signature=crypto.createHmac('sha512',secret).update(payload).digest('hex');
  assert.equal(adapter.verifyWebhookSignature({rawBody:payload,signature}),true);
  const tampered=Buffer.from(payload.toString().replace('failed','succeeded'));
  assert.equal(adapter.verifyWebhookSignature({rawBody:tampered,signature}),false);
});
