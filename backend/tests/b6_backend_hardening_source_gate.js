// MilJor B6 backend hardening: static acceptance guard.
// Run: node tests/b6_backend_hardening_source_gate.js
// Source assertions are NOT a substitute for live MySQL/API/security integration tests.
'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert').strict;
const root=path.resolve(__dirname,'..');
let count=0;
function source(p){return fs.readFileSync(path.join(root,p),'utf8')}
function check(test,message){assert.ok(test,message);count++}
const chat=source('src/services/messagingService.js');
check(chat.includes('callerRole')&&chat.includes('callerId'),'Caller-identity validation');
check(chat.includes('ORDER_CONTEXT_FORBIDDEN')&&chat.includes('POOL_CONTEXT_FORBIDDEN'),'Ownership enforced for message context');
check(chat.includes('DIRECT_CONTACT_NOT_ALLOWED'),'Block contact sharing');
check(chat.includes("randomUUID().replace(/-/g, '')"),'Collision-safe conversation code fits column');
const marketplace=source('src/controllers/marketplaceOperationsController.js');
check(marketplace.includes('callerId: req.user.id')&&marketplace.includes('callerRole: req.user.role'),'Trusted caller from auth guard');
const promo=source('src/services/promotionService.js');
check(promo.includes('PENDING_REVIEW')&&!promo.includes("VALUES (?,?,?,?,?,?,?,?, 'ACTIVE')"),'No self-activated campaign');
check(promo.includes('CAMPAIGN_TARGET_FORBIDDEN')&&promo.includes('SUPPLIER_NOT_VERIFIED'),'Campaign ownership/verification');
check(promo.includes('return [];'),'No unbilled public promotional impressions');
const routes=source('src/routes/v1/procurementRoutes.js');
check(routes.includes('LEGACY_PROCUREMENT_ENDPOINT_RETIRED'),'Legacy procurement writes fail closed');
for(const endpoint of ["/rfqs'","/rfqs/:id/quotes'","/rfqs/:id/quotes/:quoteId/accept'","/recurring'","/match-suppliers'"]) {
  check(routes.includes(endpoint+', protect, legacyDisabled')||routes.includes(endpoint+', legacyDisabled'),endpoint+' disabled');
}
check(routes.includes("authorizeStrict('BUYER', 'SUPPLIER')"),'Demand requester RBAC');
const demand=source('src/services/procurementService.js');
check(demand.includes('requester_role')&&demand.includes('REQUESTER_NOT_VERIFIED'),'Role-aware demand requester');
check(demand.includes('INCOMPATIBLE_FAMILY_UNIT'),'Demand family units');
check(demand.includes('f.name AS commodity_name')&&!demand.includes('buyer_business_name'),'Anonymized public demand');
const catalog=source('src/controllers/productController.js');
const specs=source('src/controllers/productSpecificationController.js');
check(catalog.includes('SUPPLIER_OWNED_PRODUCTS')&&specs.includes('SUPPLIER_OWNED_VARIANTS'),'No centrally authored physical variants');
const review=source('src/services/reviewService.js');
check(review.includes('Number.isInteger(value)')&&review.includes('avg_rating: stats[0].avg_rating == null ? null'),'Valid ratings and honest empty averages');
const invoice=source('src/services/invoiceService.js');
check(invoice.includes('procurement_award_lines')&&invoice.includes('INVOICE_AMOUNT_MISMATCH'),'Immutable invoice lines and financial reconciliation');
const fees=source('src/services/feeService.js');
check(fees.includes('return await this.calculateBuyerFeeExact')||fees.includes('const result = await this.calculateBuyerFeeExact'),'Legacy buyer fee exact-money');
check(fees.includes('const result = await this.calculateSupplierFeeExact'),'Legacy supplier fee exact-money');
const sql=source('database/migrations/047_demand_requester_role.sql');
check(sql.includes('ADD COLUMN requester_role')&&!sql.includes('DROP TABLE'),'Additive role migration');
const family=source('database/migrations/046_expand_canonical_product_families.sql');
check((family.match(/'FAM-[A-Z-]+'/g)||[]).length===12,'12 new families catalog expansion');
const listing=source('src/controllers/supplierListingController.js');
const listingRepo=source('src/repositories/supplierListingRepo.js');
const listingMutation=source('src/services/supplierListingMutationService.js');
check(listing.includes('SUPPLIER_OWNED_SKU_REQUIRED')&&listing.includes('INVALID_SUPPLIER_SKU_BRIDGE'),'Legacy global physical listing writes disabled');
check(listingRepo.includes("ps.lifecycle_status = 'PUBLISHED'")&&
  listingRepo.includes("sku.status='PUBLISHED'")&&listingRepo.includes('u.is_verified = 1'),'Public offers require verified published supplier SKU');
check(listingMutation.includes("item.lifecycle_status !== 'PUBLISHED'"),'Archived/legacy listing cannot reactivate');
const service=source('src/services/catalogService.js');
check(service.includes('Legacy variant requests are read-only')&&service.includes('Physical variants belong to suppliers'),'Historical variant requests cannot mutate new catalog');
const migrations=source('database/runMigrations.js');
check(migrations.includes('MIGRATION_RECOVERY_REQUIRED')&&migrations.includes('GET_LOCK')&&
  migrations.includes('sha256'),'Migrations fail closed after partial DDL and serialize concurrent runs');
check(review.includes("o.payment_status !== 'PAID'")&&review.includes('ER_DUP_ENTRY'),'Verified paid purchase and concurrent review duplicate guard');
const catalogController=source('src/controllers/catalogController.js');
check(catalogController.includes('FAMILY_IDENTITY_LOCKED'),'Family dimensional identity locked after published references');
console.log('PASS '+count+'/'+count+' B6 backend hardening source assertions (no MySQL run)');
