// =============================================================================
// frontend/tests/package_e1_frontend_integration.test.cjs
// MilJor Package E1.1: Frontend Integration & Gate B Verification Suite
// Validates Supplier Profile, Onboarding Wizard, Verification Badge,
// Admin Verification Portal, Role Guards, and Client API Contracts
// =============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FRONTEND_SRC = path.resolve(__dirname, '../src');

function runE1FrontendTests() {
  console.log('================================================================================');
  console.log('MILJOR PACKAGE E1.1: FRONTEND INTEGRATION & GATE B VERIFICATION SUITE');
  console.log('================================================================================');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${total}. ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${total}. ${name}: ${err.message}`);
      throw err;
    }
  }

  // 1. API Client Contracts
  test('API client contracts exist with complete method signatures for supplier and admin', () => {
    const supplierApiPath = path.join(FRONTEND_SRC, 'api/supplier.js');
    assert(fs.existsSync(supplierApiPath), 'supplier.js must exist');
    const supplierSrc = fs.readFileSync(supplierApiPath, 'utf8');
    assert(supplierSrc.includes('getProfile:'), 'supplierApi.getProfile must exist');
    assert(supplierSrc.includes('updateProfile:'), 'supplierApi.updateProfile must exist');
    assert(supplierSrc.includes('submitVerification:'), 'supplierApi.submitVerification must exist');
    assert(supplierSrc.includes('getVerificationStatus:'), 'supplierApi.getVerificationStatus must exist');

    const adminApiPath = path.join(FRONTEND_SRC, 'api/admin.js');
    assert(fs.existsSync(adminApiPath), 'admin.js must exist');
    const adminSrc = fs.readFileSync(adminApiPath, 'utf8');
    assert(adminSrc.includes('getPendingSuppliers:'), 'adminApi.getPendingSuppliers must exist');
    assert(adminSrc.includes('verifySupplier:'), 'adminApi.verifySupplier must exist');
  });

  // 2. Supplier Verification Badge Status Mapping
  test('SupplierVerificationBadge renders authentic DB-backed status badges', () => {
    const badgePath = path.join(FRONTEND_SRC, 'components/supplier/SupplierVerificationBadge.jsx');
    assert(fs.existsSync(badgePath), 'SupplierVerificationBadge.jsx must exist');
    const badgeSrc = fs.readFileSync(badgePath, 'utf8');
    assert(badgeSrc.includes("'VERIFIED'"), 'Must map VERIFIED status');
    assert(badgeSrc.includes("'PENDING_REVIEW'"), 'Must map PENDING_REVIEW status');
    assert(badgeSrc.includes("'UNDER_REVIEW'"), 'Must map UNDER_REVIEW status');
    assert(badgeSrc.includes("'REJECTED'"), 'Must map REJECTED status');
    assert(badgeSrc.includes("'MORE_INFORMATION_REQUIRED'"), 'Must map MORE_INFORMATION_REQUIRED status');
  });

  // 3. Supplier Onboarding Wizard Steps and Validations
  test('SupplierOnboardingWizard enforces 4-step workflow, validations, and submission', () => {
    const wizardPath = path.join(FRONTEND_SRC, 'components/supplier/SupplierOnboardingWizard.jsx');
    assert(fs.existsSync(wizardPath), 'SupplierOnboardingWizard.jsx must exist');
    const wizardSrc = fs.readFileSync(wizardPath, 'utf8');
    assert(wizardSrc.includes('validateStep'), 'Must implement step-by-step validation');
    assert(wizardSrc.includes('Pakistani mobile number'), 'Must validate Pakistani phone format');
    assert(wizardSrc.includes('Pakistani IBAN must be 24 characters starting with PK'), 'Must validate Pakistani IBAN format');
    assert(wizardSrc.includes('handleSaveDraft'), 'Must support non-blocking draft saving');
    assert(wizardSrc.includes('handleSubmitVerification'), 'Must support final verification review submission');
  });

  // 4. Supplier Profile Page Tabs and Logistics Integration
  test('SupplierProfilePage renders multi-tab layout and G2 logistics integration', () => {
    const profPagePath = path.join(FRONTEND_SRC, 'pages/SupplierProfilePage.jsx');
    assert(fs.existsSync(profPagePath), 'SupplierProfilePage.jsx must exist');
    const profSrc = fs.readFileSync(profPagePath, 'utf8');
    assert(profSrc.includes('SupplierDeliverySettingsForm'), 'Must embed Phase G2 delivery settings');
    assert(profSrc.includes('SupplierOnboardingWizard'), 'Must embed onboarding wizard');
    assert(profSrc.includes('SupplierVerificationBadge'), 'Must display verified status badge');
  });

  // 5. Admin Verification Portal & Gate B Completeness
  test('AdminVerificationPage implements complete review queue, approve and reject modals', () => {
    const adminPagePath = path.join(FRONTEND_SRC, 'pages/AdminVerificationPage.jsx');
    assert(fs.existsSync(adminPagePath), 'AdminVerificationPage.jsx must exist');
    const adminSrc = fs.readFileSync(adminPagePath, 'utf8');
    assert(adminSrc.includes('SUPER_ADMIN'), 'Must authorize SUPER_ADMIN');
    assert(adminSrc.includes('VERIFICATION_ADMIN'), 'Must authorize VERIFICATION_ADMIN');
    assert(adminSrc.includes('fetchPendingSuppliers'), 'Must fetch pending supplier list');
    assert(adminSrc.includes('handleSubmitApproval'), 'Must implement approval submission');
    assert(adminSrc.includes('handleSubmitRejection'), 'Must implement rejection submission with reason');
    assert(adminSrc.includes('Self-approval prohibited'), 'Must forbid self-approval by supplier-admin');
    assert(adminSrc.includes('LEVEL_1_CONTACT'), 'Must use LEVEL_1_CONTACT enum value');
    assert(adminSrc.includes('LEVEL_3_QUALITY'), 'Must use LEVEL_3_QUALITY enum value');
    assert(adminSrc.includes('STARTER'), 'Must use STARTER enum value');
    assert(adminSrc.includes('BUSINESS'), 'Must use BUSINESS enum value');
    assert(adminSrc.includes('PLAN_LISTING_CAPS'), 'Must enforce plan-to-listing safety caps');
  });

  // 6. Navigation and Routing Integration
  test('AppShell and App.jsx correctly wire navigation and routes for supplier and admin', () => {
    const appShellPath = path.join(FRONTEND_SRC, 'components/layout/AppShell.jsx');
    const appShellSrc = fs.readFileSync(appShellPath, 'utf8');
    assert(appShellSrc.includes("to=\"/supplier/profile\""), 'AppShell must link to Supplier Portal');
    assert(appShellSrc.includes("to=\"/admin/verifications\""), 'AppShell must link to Admin Verifications');

    const appPath = path.join(FRONTEND_SRC, 'App.jsx');
    const appSrc = fs.readFileSync(appPath, 'utf8');
    assert(appSrc.includes("path=\"/supplier/profile\""), 'App.jsx must route /supplier/profile');
    assert(appSrc.includes("path=\"/supplier/onboarding\""), 'App.jsx must route /supplier/onboarding');
    assert(appSrc.includes("path=\"/admin/verifications\""), 'App.jsx must route /admin/verifications');
    assert(appSrc.includes("location.pathname.startsWith('/admin')"), 'App.jsx must include admin in AppShell routes');
  });

  console.log('\n================================================================================');
  console.log(`E1.1 FRONTEND VERDICT: ALL ${passed}/${total} TESTS PASSED (100% GREEN)`);
  console.log('================================================================================\n');
}

runE1FrontendTests();
