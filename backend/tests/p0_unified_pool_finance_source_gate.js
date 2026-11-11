'use strict';
// Zero-DB regression: the single buyer/supplier UI must keep authoritative
// B4/B5 payment and inventory semantics; financial audit must remain read-only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
let passes=0;
const pass=(title,fn)=>{fn();console.log('PASS',++passes,title)};
const buyer=read('frontend/src/pages/PoolsPage.jsx');
const card=read('frontend/src/components/pools/BuyerPoolCard.jsx');
const supplier=read('frontend/src/pages/SupplierPoolsPage.jsx');
const legacy=read('frontend/src/pages/FlashPoolsPage.jsx');
const route=read('backend/src/routes/v1/financialSettlementRoutes.js');
const ctl=read('backend/src/controllers/financialSettlementController.js');
const svc=read('backend/src/services/financialConservationService.js');
pass('Buyer discovery is ALL and cannot split into public Regular/Flash tabs',()=>{
  assert.match(buyer,/const poolType='ALL'/);
  assert.doesNotMatch(buyer,/\['ALL','REGULAR','FLASH'\]/);
  assert.match(buyer,/unifiedPoolsApi\.discover/);
  assert.match(buyer,/next_cursor/);
});
pass('Legacy Flash direct link redirects to one canonical marketplace',()=>{
  assert.match(legacy,/to="\/pools"/);
  assert.doesNotMatch(legacy,/type=FLASH/);
});
pass('Buyer card uses one Pool identity and backend-enforced payment differences',()=>{
  assert.match(card,/>Pool<\/span>/);
  assert.match(card,/holdFlash/);
  assert.match(card,/apiClient\.post\('\/reservations'/);
  assert.match(card,/initiateCheckout/);
  assert.match(card,/CountdownTimer/);
  assert.match(card,/purchaseKey\.current/);
  assert.match(card,/savedAddresses/);
});
pass('Supplier board has one pool marketplace with status-only filters',()=>{
  assert.match(supplier,/Supplier Portal · Unified Pools/);
  assert.match(supplier,/\['ALL','DRAFT','ACTIVE'\]/);
  assert.doesNotMatch(supplier,/\['ALL','REGULAR','FLASH','DRAFT','ACTIVE'\]/);
  assert.match(supplier,/unifiedPoolsApi\.overview\(\)/);
  assert.match(supplier,/saveRegularDraft/);
  assert.match(supplier,/saveFlashDraft/);
  assert.match(supplier,/publishRegular/);
  assert.match(supplier,/publishFlash/);
});
pass('Finance audit rejects non-finance roles at the HTTP route',()=>{
  assert.match(route,/'\/admin\/orders\/:id\/integrity'/);
  assert.match(route,/authorizeStrict\('ADMIN','SUPER_ADMIN','FINANCE_ADMIN'\)/);
});
pass('Finance audit controller delegates actor to read-only independent service',()=>{
  assert.match(ctl,/financialConservationService\.getOrderIntegrity/);
  assert.match(ctl,/actor:req\.user/);
});
pass('Finance service uses repeatable-read transaction and immutable commission',()=>{
  assert.match(svc,/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ/);
  assert.match(svc,/supplier_commission_percent/);
  assert.match(svc,/IMMUTABLE_SUPPLIER_COMMISSION/);
  assert.match(svc,/RECONCILIATION_REQUIRED/);
  assert.doesNotMatch(svc,/\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]+|DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i);
});
console.log('PASS UNIFIED POOL + FINANCE SOURCE GATE',passes+'/'+passes);
