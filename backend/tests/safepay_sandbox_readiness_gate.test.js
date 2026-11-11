'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { inspect, configured } = require('../scripts/safepaySandboxPreflight');
const source = {
 adapter: 'sandbox.api.getsafepay.com createTracker verifyWebhookSignature timingSafeEqual',
 provider: 'initiateRefund REFUND_PENDING_GATEWAY',
 settlement: 'External refund and payout execution are strictly DISABLED'
};
const valid = {
 SAFEPAY_ENV:'sandbox', ALLOW_EXTERNAL_MONEY_MOVEMENT:'false',
 DB_NAME:'miljor_test_db', SAFEPAY_PUBLIC_KEY:'sec_sand_randompublickey1234',
 SAFEPAY_SECRET_KEY:'sec_sand_randomsecretkey1234',
 SAFEPAY_WEBHOOK_SECRET:'safepay-sandbox-hmac-secret-unique1234'
};
test('no placeholders qualify as real credentials', () => {
 assert.equal(configured('sec_sand_placeholder_public_key'),false);
 assert.equal(configured('YOUR_SANDBOX_SECRET'),false);
 assert.equal(configured('sec_sand_randompublickey1234'),true);
});
test('safe sandbox configuration is ready for provider attempts but not certified', () => {
 const result=inspect(valid,source);
 assert.equal(result.safe_to_attempt_provider_test,true);
 assert.equal(result.real_funds_moved,false);
 assert.match(result.provider_checkout,/NOT_YET_EXECUTED/);
 assert.match(result.provider_refund,/BLOCKED/);
 assert.match(result.provider_bank_payout,/BLOCKED/);
});
test('production Safepay configuration fails closed', () => {
 const result=inspect({...valid,SAFEPAY_ENV:'production'},source);
 assert.equal(result.safe_to_attempt_provider_test,false);
 assert.ok(result.faults.length);
});
test('any external-money movement flag fails closed', () => {
 assert.equal(inspect({...valid,ALLOW_EXTERNAL_MONEY_MOVEMENT:'true'},source).safe_to_attempt_provider_test,false);
});
test('protected database names fail closed', () => {
 assert.equal(inspect({...valid,DB_NAME:'miljor_db'},source).safe_to_attempt_provider_test,false);
});
test('production host override fails closed', () => {
 assert.equal(inspect({...valid,SAFEPAY_HOST:'https://api.getsafepay.com'},source).safe_to_attempt_provider_test,false);
});
test('missing secrets report variable names only, never values', () => {
 const result=inspect({...valid,SAFEPAY_WEBHOOK_SECRET:'placeholder'},source);
 assert.deepEqual(result.missing_configuration,['SAFEPAY_WEBHOOK_SECRET']);
 assert.equal(result.safe_to_attempt_provider_test,false);
});
test('gateway refund stub does not masquerade as real refund', () => {
 const result=inspect(valid,source);
 assert.equal(result.checks.refund_gateway_implemented,false);
});
test('supplier payout remains unverified even for sandbox credentials', () => {
 const result=inspect(valid,source);
 assert.equal(result.provider_bank_payout,'BLOCKED_NO_VERIFIED_SANDBOX_DISBURSEMENT_CONTRACT');
});
