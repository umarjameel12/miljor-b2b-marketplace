'use strict';
// PR61 Phase 4: isolated negative security + release boundary acceptance.
// No real provider traffic, no DB mutation, no claims of provider-origin payment.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const {SupplierVerificationDocumentService}=require('../src/services/supplierVerificationDocumentService');
const safepayAdapter=require('../src/services/safepayAdapter');
const {inspect}=require('../scripts/safepaySandboxPreflight');

const throwBeforeDb={getConnection:async()=>{throw Error('UNEXPECTED_DB_ACCESS');}};
const service=new SupplierVerificationDocumentService(throwBeforeDb);
const key='part4-upload-reject-key-2026';
const makePayload=(contents,filename='proof.pdf',mime_type='application/pdf')=>({
  kind:'BUSINESS_LICENSE',filename,mime_type,base64:Buffer.from(contents).toString('base64')
});
async function rejected(payload,code){
  await assert.rejects(()=>service.upload(7,payload,key),e=>e.code===code);
}
test('verification evidence extension/mime mismatch blocked before DB access',async()=>{
  await rejected(makePayload('%PDF-1.4\n%%EOF','proof.png'),'DOCUMENT_EXTENSION_MISMATCH');
});
test('PDF scripting, launch actions, encryption and truncation blocked before DB access',async()=>{
  for(const name of ['/JavaScript','/JS','/OpenAction','/AA','/Launch','/EmbeddedFile','/Encrypt']){
    await rejected(makePayload('%PDF-1.7\n'+name+' (unsafe)\n%%EOF'),'UNSAFE_DOCUMENT');
  }
  await rejected(makePayload('%PDF-1.7\nmissing EOF'),'UNSAFE_DOCUMENT');
});
test('malformed PNG container blocked before DB access',async()=>{
  const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(48)]);
  await rejected(makePayload(bytes,'image.png','image/png'),'UNSAFE_DOCUMENT');
});
test('Safepay tracker is an opaque path segment and cannot escape provider endpoint',async()=>{
  safepayAdapter.validateConfig=()=>{};
  const mock={fetchTracker:async token=>({data:{token}})};
  for(const token of ['track_../../admin','track_abc?secret=x','track_abc/../','https://example.com','track_%2fetc','track_abc#fragment','track_abc\nx']){
    await assert.rejects(()=>safepayAdapter.fetchTracker(token,{mockClient:mock}),e=>e.code==='INVALID_TRACKER_TOKEN');
  }
  const response=await safepayAdapter.fetchTracker('track_safe_12345',{mockClient:mock});
  assert.equal(response.data.token,'track_safe_12345');
});
test('refund/payout remain disabled and cannot masquerade as certified',()=>{
  const provider=read('src/services/paymentProviderService.js');
  const finance=read('src/services/financialSettlementService.js');
  assert.match(provider,/REFUND_PENDING_GATEWAY/);
  assert.match(finance,/External refund and payout execution are strictly DISABLED/);
  assert.match(finance,/external_execution_status/);
  const readiness=inspect({SAFEPAY_ENV:'sandbox',ALLOW_EXTERNAL_MONEY_MOVEMENT:'false',DB_NAME:'miljor_test_db'},
    {adapter:read('src/services/safepayAdapter.js'),provider,settlement:finance});
  assert.equal(readiness.safe_to_attempt_provider_test,false);
  assert.equal(readiness.provider_checkout,'BLOCKED_NOT_EXECUTED');
  assert.equal(readiness.provider_bank_payout,'BLOCKED_NO_VERIFIED_SANDBOX_DISBURSEMENT_CONTRACT');
  assert.equal(readiness.real_funds_moved,false);
});
test('production security, role separation and raw-body HMAC remain enforced',()=>{
  const server=read('server.js');
  const webhook=read('src/services/safepayCheckoutService.js');
  const routes=read('src/routes/v1/financialSettlementRoutes.js');
  assert.match(server,/app\.use\(helmet\(\)\)/);
  assert.match(server,/app\.use\(cors\(/);
  assert.match(server,/req\.rawBody = buf/);
  assert.match(server,/webhookLimiter/);
  assert.match(server,/authLimiter/);
  assert.match(webhook,/verifyWebhookSignature/);
  assert.match(webhook,/WEBHOOK_EVENT_TYPE_MISMATCH/);
  assert.match(routes,/authorizeAdmin/);
});
