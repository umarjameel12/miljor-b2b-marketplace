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
  const captureJournal=read('database/migrations/106_supplier_subscription_signed_capture_journal.sql');
  assert.match(subscription,/SAFEPAY_TRACKER_CONTRACT==='payments-v3-minor'/);
  assert.match(subscription,/createHostedCheckout/);
  assert.match(subscription,/provider_contract/);
  assert.match(subscription,/acceptSignedV3Capture/);
  assert.match(subscription,/AWAITING_SIGNED_CAPTURE/);
  assert.match(subscription,/MILJOR-SUB-\$\{attemptId\}/);
  assert.match(migration,/legacy-v1-major/);
  assert.match(migration,/payments-v3-minor/);
  assert.match(subscription,/SAFEPAY_V3_SUBSCRIPTION_SIGNED_CAPTURE_ENABLED/);
  assert.match(subscription,/normalizeSucceededWebhook/);
  assert.match(captureJournal,/UNIQUE KEY uq_supplier_capture_attempt/);
  const payment=read('src/services/safepayCheckoutService.js');
  assert.match(payment,/acceptSignedV3Capture/);
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

test('actual buyer reconciliation rejects v3 before legacy provider lookup or DB writes',async()=>{
  const checkout=read('src/services/safepayCheckoutService.js');
  let providerCalls=0,writeConnections=0,reads=0;
  let contract='payments-v3-minor';
  const db={
    query:async(sql,args)=>{
      assert.match(sql,/^SELECT /,'Reconciliation proof check cannot issue writes');
      assert.deepEqual(args,[17]);
      reads++;
      if(sql.includes('FROM orders o'))return [[{
        id:17,buyer_id:5,order_status:'AWAITING_PAYMENT',
        payment_status:'PAYMENT_INITIATED',total_amount:'1145.00',
        currency:'PKR'
      }]];
      if(sql.includes('FROM payment_attempts'))return [[{
        id:45,order_id:17,provider_contract:contract,
        status:'INITIATED',provider_tracker_token:'track_signed_only_123'
      }]];
      throw Error('Unexpected read '+sql);
    },
    getConnection:async()=>{writeConnections++;throw Error('DB_WRITE_NOT_PERMITTED');}
  };
  const adapter={fetchTracker:async()=>{
    providerCalls++;
    throw Object.assign(Error('Legacy provider reached'),{code:'LEGACY_REPORTER_CALLED'});
  }};
  const mockModule={exports:{}};
  new Function('require','module','exports',checkout)(
    name=>name==='../config/db'?db:
      name==='./safepayAdapter'?adapter:
      name==='./exactDecimal'?require('../src/services/exactDecimal'):
      name==='crypto'?require('node:crypto'):
      // Other dependencies are not exercised on the fail-closed path.
      name.startsWith('./')?{}:require(name),
    mockModule,mockModule.exports
  );
  const svc=mockModule.exports;
  await assert.rejects(()=>svc.reconcilePaymentWithProvider({
    orderId:17,actor:{id:5,role:'BUYER'}
  }),e=>e.code==='V3_SIGNED_WEBHOOK_REQUIRED'&&e.statusCode===409);
  assert.equal(reads,2);
  assert.equal(providerCalls,0);
  assert.equal(writeConnections,0);
  contract='not-a-contract';
  await assert.rejects(()=>svc.reconcilePaymentWithProvider({
    orderId:17,actor:{id:5,role:'BUYER'}
  }),e=>e.code==='UNKNOWN_PAYMENT_PROVIDER_CONTRACT');
  assert.equal(providerCalls,0);
  contract='legacy-v1-major';
  await assert.rejects(()=>svc.reconcilePaymentWithProvider({
    orderId:17,actor:{id:5,role:'BUYER'}
  }),e=>e.code==='LEGACY_REPORTER_CALLED');
  assert.equal(providerCalls,1,'Legacy contract still uses its existing provider adapter');
  assert.equal(writeConnections,0);
});

test('supplier checkout failure remains visible after refreshing attempts',()=>{
  const page=fs.readFileSync(path.resolve(root,'../frontend/src/pages/SupplierSubscriptionPage.jsx'),'utf8');
  const start=page.slice(page.indexOf('const startCheckout = async'),page.indexOf('const verifyPayment = async'));
  assert.match(start,/setSubmitting\(false\);\s*await refresh\(\);\s*setError\(e\.message \|\| 'Subscription checkout unavailable\.'\)/);
  assert.match(start,/body\.error\?\.message/,'Server-reported capture-proof rejection must surface to supplier');
});
