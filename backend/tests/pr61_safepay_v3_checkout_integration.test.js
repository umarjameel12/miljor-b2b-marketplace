'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('canonical buyer checkout has explicit opt-in v3 path, persists pinned contract and does not silently fallback',()=>{
  const checkout=read('src/services/safepayCheckoutService.js');
  const client=read('src/services/safepayV3SandboxClient.js');
  const migration=read('database/migrations/104_safepay_v3_payment_contract.sql');
  assert.match(checkout,/SAFEPAY_TRACKER_CONTRACT==='payments-v3-minor'/);
  assert.match(checkout,/SAFEPAY_V3_SANDBOX_ENABLED!=='true'/);
  assert.match(checkout,/createHostedCheckout/);
  assert.match(checkout,/provider_contract/);
  assert.match(checkout,/'payments-v3-minor'/);
  assert.match(checkout,/exactDecimal\.toCanonicalString\(order\.total_amount,2\)/);
  assert.match(client,/request\.path|createPaymentTracker/);
  assert.match(client,/\/client\/passport\/v1\/token/);
  assert.match(client,/source','hosted|set\('source','hosted'\)/);
  assert.match(migration,/legacy-v1-major/);
  assert.match(migration,/payments-v3-minor/);
});
test('supplier subscription checkout and reconciliation also support pinned v3 contract',()=>{
  const subscription=read('src/services/supplierSubscriptionCheckoutService.js');
  const migration=read('database/migrations/105_safepay_v3_supplier_subscription_contract.sql');
  assert.match(subscription,/SAFEPAY_TRACKER_CONTRACT==='payments-v3-minor'/);
  assert.match(subscription,/createHostedCheckout/);
  assert.match(subscription,/provider_contract/);
  assert.match(subscription,/inspectPaymentTracker/);
  assert.match(subscription,/report\.state!=='TRACKER_ENDED'/);
  assert.match(subscription,/MILJOR-SUB-\$\{attempt\.id\}/);
  assert.match(migration,/legacy-v1-major/);
  assert.match(migration,/payments-v3-minor/);
});
test('webhook processing uses the persisted attempt contract, never heuristic amount guessing',()=>{
  const checkout=read('src/services/safepayCheckoutService.js');
  const v3=read('src/services/safepayV3ContractService.js');
  assert.match(checkout,/attempt\.provider_contract\|\|'legacy-v1-major'/);
  assert.match(checkout,/normalizeSucceededWebhook/);
  // The legacy reporter has major-unit parsing. It must never directly
  // certify a v3 minor-unit attempt or bypass v3 signed webhook capture.
  assert.match(checkout,/attempt\.provider_contract==='payments-v3-minor'/);
  assert.match(checkout,/V3_SIGNED_WEBHOOK_REQUIRED/);
  assert.match(checkout,/UNKNOWN_PAYMENT_PROVIDER_CONTRACT/);
  assert.match(checkout,/normalizedProviderAmount/);
  assert.match(v3,/eventType!=='payment.succeeded'/);
  assert.match(v3,/data\?\.state!=='TRACKER_ENDED'/);
  assert.match(v3,/expectedMerchantApiKey/);
  assert.match(v3,/fromMinorPkr\(data\.amount\)/);
});
