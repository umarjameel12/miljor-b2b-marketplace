'use strict';
// MilJor UCP-3/4/5 deferred source gate. Do not confuse with live acceptance.
// Execute at the final consolidated isolated testing phase:
//   cd backend && node tests/ucp_3_to_5_source_gate.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),frontend=path.resolve(root,'../frontend/src');
const source=relative=>fs.readFileSync(path.resolve(root,relative),'utf8');
const ui=relative=>fs.readFileSync(path.resolve(frontend,relative),'utf8');
let passed=0;
function gate(value,message){assert.ok(value,message);console.log('PASS',++passed,message)}
const supplier=source('src/routes/v1/supplierRoutes.js');
const operations=source('src/services/poolOperationsService.js');
const discovery=source('src/services/unifiedPoolDiscoveryService.js');
const poolRepo=source('src/repositories/poolRepo.js');
const routes=source('src/routes/v1/unifiedPoolRoutes.js');
const flash=source('src/services/flashPoolService.js');
const procurement=source('src/routes/v1/procurementRoutes.js');
const server=source('server.js');
const supplierPage=ui('pages/SupplierPoolsPage.jsx');
const supplierPanel=ui('components/supplier/SupplierPoolOperationsPanel.jsx');
const pools=ui('pages/PoolsPage.jsx');
const buyerCard=ui('components/pools/BuyerPoolCard.jsx');
const buyerOrders=ui('components/pools/FlashBuyerOrdersPanel.jsx');
const reservations=ui('components/pools/BuyerRegularReservationsPanel.jsx');
const ordersPage=ui('pages/OrdersPage.jsx');
const flashLegacy=ui('pages/FlashPoolsPage.jsx');
for(const endpoint of ['/pools/delivery-context','/pools/inventory','/pools/insights','/pools/alerts'])
  gate(supplier.includes(endpoint),'Supplier operations endpoint '+endpoint);
gate(supplier.includes("authorizeStrict('SUPPLIER')"),'No cross-role supplier operational reads');
gate(operations.includes("WHERE sl.supplier_id=?")&&operations.includes("WHERE h.buyer_id=?")===false,
  'Supplier-only inventory projection does not expose buyer hold list');
gate(operations.includes("supplier_inventory_allocations")&&operations.includes("status IN ('PENDING','COMMITTED')"),
  'Availability uses original allocation ledger');
gate(operations.includes('exact.exactDecimalSum')&&operations.includes('RECONCILIATION_REQUIRED'),
  'Exact stock arithmetic with mismatch fail-closed');
gate(operations.includes('supplierDelivery.getSupplierSettings'),
  'Delivery context reuses configured G2 supplier rates');
gate(operations.includes('revenue_pkr:null')&&operations.includes('savings_pkr:null'),
  'No invented settlement revenue or savings');
gate(operations.includes("delivery_channel:'IN_APP_READ_ONLY'"),
  'Notifications are accurately labeled real in-app status alerts only');
gate(operations.includes('supplier_id=?')&&operations.includes("o.payment_status='AWAITING_PAYMENT'"),
  'Supplier-scoped outstanding payment alerts');
gate(routes.includes("router.get('/pool-discovery'")&&server.includes('unifiedPoolRoutes'),
  'Buyer combined public read API mounted');
// Reconcile PR #8's buyer-discovery eligibility without replacing canonical
// pool delivery/analytics/read models or weakening B4/B5 transactional engines.
for(const rule of [
  "u.role='SUPPLIER'","u.is_verified=1","u.verification_status='VERIFIED'",
  "profile.verification_status='VERIFIED'","sl.status='ACTIVE'",
  "spec.id=p.product_spec_id","spec.supplier_id=p.supplier_id",
  "spec.lifecycle_status='PUBLISHED'","spec.approval_status='APPROVED'",
  "sku.status='PUBLISHED'","prod.status='PUBLISHED'",
  "fam.approval_status='APPROVED'","cat.approval_status='APPROVED'"
]){
  gate(poolRepo.includes(rule),'Regular buyer discovery requires '+rule);
}
gate(poolRepo.includes("p.expires_at > UTC_TIMESTAMP()"),
  'Regular discovery uses authoritative UTC expiry');
gate(discovery.includes('poolRepo.findAllActive')&&discovery.includes('flash.getActive'),
  'Both authoritative B4 and B5 discovery engines are delegated');
gate(discovery.includes("ps.lifecycle_status='PUBLISHED'")&&
  discovery.includes("sku.status='PUBLISHED'"),'Legacy physical variants excluded');
gate(discovery.includes('categoryId')&&discovery.includes('familyId')&&discovery.includes('clusterId'),
  'Buyer canonical and Lahore cluster filters');
gate(discovery.includes('clusterModeIds')&&discovery.includes("r.mode='STANDARD_CLUSTERED'"),
  'Delivery modes and Flash standard coverage checked exactly');
gate(discovery.includes('next_cursor')&&discovery.includes('INVALID_CURSOR'),
  'Scoped cursor pagination');
gate(!discovery.includes('procurement_collective_groups')&&!discovery.includes('procurement_awards'),
  'B6 groups and procurement awards not shown as pools');
gate(flash.includes('BUYER_ADDRESS_NOT_VERIFIED')&&
  flash.includes('FLASH_DELIVERY_AREA_UNAVAILABLE'),'Verified buyer address and area checked before Flash holds');
gate(flash.includes('async listHoldsForBuyer')&&procurement.includes("'/flash-pools/holds/mine'"),
  'Buyer-owned Flash hold recovery');
gate(supplierPage.includes('delivery_clusters')&&supplierPage.includes('SUPPLIER_PICKUP'),
  'Regular create/edit uses authentic delivery clusters and pickup');
gate(supplierPanel.includes('available_to_allocate')&&supplierPanel.includes('unavailable_reason'),
  'Supplier inventory and truthful analytics UI');
gate(pools.includes('BuyerPoolCard')&&pools.includes('poolType')&&pools.includes('loadMore'),
  'Unified buyer marketplace, type filters and pagination');
gate(buyerCard.includes("apiClient.post('/reservations'")&&buyerCard.includes('unifiedPoolsApi.holdFlash'),
  'Regular reservation and Flash purchase remain independent');
gate(buyerCard.includes('delivery_address_id')&&buyerCard.includes("apiClient.get('/buyer/addresses')"),
  'Flash buyer chooses owned saved Lahore address');
gate(buyerCard.includes('window.location.assign')&&buyerCard.includes('initiateCheckout'),
  'Buyer explicitly starts verified Safepay checkout');
gate(buyerOrders.includes('hold_expires_at')&&buyerOrders.includes('reconcile'),
  'Flash buyer payment expiry, recovery and provider reconciliation');
gate(reservations.includes("'/reservations/my'")&&reservations.includes("X-Idempotency-Key"),
  'Regular buyer reservations remain visible and cancellation idempotent');
gate(ordersPage.includes('BuyerRegularReservationsPanel')&&ordersPage.includes('FlashBuyerOrdersPanel'),
  'Both types remain independently visible in orders');
gate(flashLegacy.includes('Navigate to="/pools?type=FLASH"'),
  'Old Flash discovery link redirects without duplicate source of truth');
gate(!pools.includes('urdu_name')&&!supplierPage.includes('urdu_name')&&
  !buyerCard.includes('16 staple'),'No Urdu or old 16-staple catalog in new pool UI');
console.log('UCP-3 TO UCP-5 SOURCE GATE:',passed,'PASS (source assertions; NOT E2E testing)');
