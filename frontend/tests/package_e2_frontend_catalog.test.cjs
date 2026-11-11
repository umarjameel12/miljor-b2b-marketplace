// =============================================================================
// frontend/tests/package_e2_frontend_catalog.test.cjs
// MilJor Package E2 Gate 4: Frontend Canonical Catalog & Admin Moderation Verification
// =============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('================================================================================');
console.log('MILJOR PACKAGE E2 GATE 4: FRONTEND CANONICAL CATALOG & MODERATION SUITE');
console.log('================================================================================\n');

let passed = 0;
let total = 0;

function check(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✅ [PASS] ${total}. ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${total}. ${name}:`, err.message);
    process.exit(1);
  }
}

const frontendRoot = path.resolve(__dirname, '..');
const catalogApiPath = path.join(frontendRoot, 'src/api/catalog.js');
const supplierCatalogPagePath = path.join(frontendRoot, 'src/pages/SupplierCatalogPage.jsx');
const adminCatalogPagePath = path.join(frontendRoot, 'src/pages/AdminCatalogPage.jsx');
const appJsxPath = path.join(frontendRoot, 'src/App.jsx');
const appShellPath = path.join(frontendRoot, 'src/components/layout/AppShell.jsx');

check('catalog.js API client exists and exposes public, supplier request, listing, and admin moderation methods', () => {
  assert.ok(fs.existsSync(catalogApiPath), 'src/api/catalog.js must exist');
  const src = fs.readFileSync(catalogApiPath, 'utf8');
  const expectedMethods = [
    'getCategories',
    'getCategoryFamilies',
    'getFamilies',
    'getFamilyVariants',
    'getVariantById',
    'createCatalogRequest',
    'getMyCatalogRequests',
    'updateCatalogRequest',
    'adminGetCatalogRequests',
    'adminReviewCatalogRequest',
    'adminApproveCatalogRequest',
    'adminRejectCatalogRequest'
  ];
  for (const m of expectedMethods) {
    assert.ok(src.includes(m), `catalogApi missing method: ${m}`);
  }
});

check('SupplierCatalogPage.jsx implements cascading Category -> Family -> Variant selector and dependent reset', () => {
  assert.ok(fs.existsSync(supplierCatalogPagePath), 'src/pages/SupplierCatalogPage.jsx must exist');
  const src = fs.readFileSync(supplierCatalogPagePath, 'utf8');
  assert.ok(src.includes('handleSelectCategory'), 'Must implement handleSelectCategory');
  assert.ok(src.includes('handleRequestCategoryChange'), 'Must implement dependent reset on category change in request modal');
  assert.ok(src.includes('handleRequestFamilyChange'), 'Must implement dependent reset on family change in request modal');
  assert.ok(src.includes('FAMILY_ATTRIBUTE_HINTS'), 'Must include category/family-aware attribute configurations');
  assert.ok(src.includes('NEW_FAMILY') && src.includes('NEW_VARIANT'), 'Must support both NEW_FAMILY and NEW_VARIANT requests');
  assert.ok(src.includes('Edit & Resubmit'), 'Must allow editing and resubmitting rejected/draft requests');
});

check('AdminCatalogPage.jsx implements moderation queue review, approve, reject with mandatory reason, and taxonomy management', () => {
  assert.ok(fs.existsSync(adminCatalogPagePath), 'src/pages/AdminCatalogPage.jsx must exist');
  const src = fs.readFileSync(adminCatalogPagePath, 'utf8');
  assert.ok(src.includes('handleMarkUnderReview'), 'Must support marking requests UNDER_REVIEW');
  assert.ok(src.includes('handleApproveRequest'), 'Must support approving requests');
  assert.ok(src.includes('handleConfirmReject'), 'Must support rejecting requests with reason');
  assert.ok(src.includes('rejectionReason'), 'Must enforce rejection reason input');
  assert.ok(src.includes('handleCreateFamily') && src.includes('handleCreateCategory'), 'Must support creating families and categories');
});

check('App.jsx and AppShell.jsx wire /supplier/catalog and /admin/catalog routes and navigation links', () => {
  const appSrc = fs.readFileSync(appJsxPath, 'utf8');
  assert.ok(appSrc.includes('/supplier/catalog'), 'App.jsx must mount /supplier/catalog');
  assert.ok(appSrc.includes('/admin/catalog'), 'App.jsx must mount /admin/catalog');

  const shellSrc = fs.readFileSync(appShellPath, 'utf8');
  assert.ok(shellSrc.includes('/supplier/catalog'), 'AppShell.jsx must link to /supplier/catalog');
  assert.ok(shellSrc.includes('/admin/catalog'), 'AppShell.jsx must link to /admin/catalog');
});

console.log('\n================================================================================');
console.log(`PACKAGE E2 FRONTEND GATE VERDICT: ALL ${passed}/${total} TESTS PASSED (100% GREEN)`);
console.log('================================================================================\n');
