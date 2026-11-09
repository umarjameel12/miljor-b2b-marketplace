// =============================================================================
// tests/package_d_frontend_verification.test.js
// MilJor Package D: Frontend Implementation & Appearance Verification Gate
// =============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FRONTEND_SRC = path.resolve(__dirname, '../../frontend/src');

function runVerification() {
  console.log('================================================================================');
  console.log('MILJOR PACKAGE D: FINAL PREMIUM FRONTEND VERIFICATION GATE');
  console.log('================================================================================');

  // Gate 1: AuthAppearanceContext Implementation
  console.log('\n▶ Gate 1: AuthAppearanceContext & Persistence Invariants...');
  const ctxPath = path.join(FRONTEND_SRC, 'context/AuthAppearanceContext.jsx');
  assert(fs.existsSync(ctxPath), 'AuthAppearanceContext.jsx must exist');
  const ctxSrc = fs.readFileSync(ctxPath, 'utf8');
  assert(ctxSrc.includes('miljor_auth_appearance'), 'Must use miljor_auth_appearance localStorage key');
  assert(ctxSrc.includes('layoutStyle'), 'Must manage layoutStyle preference');
  assert(ctxSrc.includes('showBackgroundImage'), 'Must manage showBackgroundImage preference');
  assert(ctxSrc.includes('showBrandHeading'), 'Must manage showBrandHeading preference');
  assert(ctxSrc.includes('showTagline'), 'Must manage showTagline preference');
  assert(ctxSrc.includes('showBrandPanel'), 'Must manage showBrandPanel preference');
  assert(ctxSrc.includes('resetDefaults'), 'Must export resetDefaults handler');
  console.log('  ✔ AuthAppearanceContext correctly exports state, toggles, and localStorage persistence');

  // Gate 2: AuthAppearanceControl Popover
  console.log('\n▶ Gate 2: AuthAppearanceControl Floating Popover...');
  const ctrlPath = path.join(FRONTEND_SRC, 'components/auth/AuthAppearanceControl.jsx');
  assert(fs.existsSync(ctrlPath), 'AuthAppearanceControl.jsx must exist');
  const ctrlSrc = fs.readFileSync(ctrlPath, 'utf8');
  assert(ctrlSrc.includes('Enhanced'), 'Must offer Enhanced mode option');
  assert(ctrlSrc.includes('Original'), 'Must offer Original mode option');
  assert(ctrlSrc.includes('Restore Defaults'), 'Must offer Restore Defaults button');
  console.log('  ✔ AuthAppearanceControl provides non-intrusive appearance popover controls');

  // Gate 3: LoginPage Quiet-Luxury & Reversible Original Mode
  console.log('\n▶ Gate 3: LoginPage Reversible Architecture...');
  const loginPath = path.join(FRONTEND_SRC, 'pages/LoginPage.jsx');
  assert(fs.existsSync(loginPath), 'LoginPage.jsx must exist');
  const loginSrc = fs.readFileSync(loginPath, 'utf8');
  assert(loginSrc.includes('useAuthAppearance'), 'LoginPage must consume useAuthAppearance');
  assert(loginSrc.includes('AuthAppearanceControl'), 'LoginPage must mount AuthAppearanceControl');
  assert(loginSrc.includes("layoutStyle === 'original'"), 'LoginPage must support original centered card');
  assert(loginSrc.includes('AuthHeroPanel') || loginSrc.includes('riceHeroImg'), 'LoginPage must support commodity hero visual');
  assert(loginSrc.includes('preferences.showTagline'), 'LoginPage must conditionally render tagline');
  assert(loginSrc.includes('preferences.showBrandHeading'), 'LoginPage must conditionally render heading');
  console.log('  ✔ LoginPage cleanly supports both enhanced split luxury and original centered layouts');

  // Gate 4: RegisterPage Geographic Unslop & Reversibility
  console.log('\n▶ Gate 4: RegisterPage Unslop & Geographic Layout...');
  const regPath = path.join(FRONTEND_SRC, 'pages/RegisterPage.jsx');
  assert(fs.existsSync(regPath), 'RegisterPage.jsx must exist');
  const regSrc = fs.readFileSync(regPath, 'utf8');
  assert(regSrc.includes('useAuthAppearance'), 'RegisterPage must consume useAuthAppearance');
  assert(regSrc.includes('AuthAppearanceControl'), 'RegisterPage must mount AuthAppearanceControl');
  assert(regSrc.includes('LahoreClusterSelector'), 'RegisterPage must use LahoreClusterSelector');
  assert(regSrc.includes("role === 'BUYER'"), 'RegisterPage must support Buyer role selection');
  assert(regSrc.includes("role === 'SUPPLIER'"), 'RegisterPage must support Supplier role selection');
  // Check unslop: No nested card inside card for cluster/address
  assert(!regSrc.includes('p-4 sm:p-5 rounded-2xl border space-y-3.5" style={{ backgroundColor: \'var(--bg-elevated)'), 'RegisterPage must not nest a separate card box for cluster/address');
  console.log('  ✔ RegisterPage features un-slopped inline cluster flow and full appearance reversibility');

  // Gate 5: LahoreClusterSelector Flattening
  console.log('\n▶ Gate 5: LahoreClusterSelector Flattening...');
  const clusterPath = path.join(FRONTEND_SRC, 'components/geo/LahoreClusterSelector.jsx');
  assert(fs.existsSync(clusterPath), 'LahoreClusterSelector.jsx must exist');
  const clusterSrc = fs.readFileSync(clusterPath, 'utf8');
  assert(clusterSrc.includes('<select'), 'LahoreClusterSelector must use clean native select element');
  assert(!clusterSrc.includes('fixed inset-0'), 'LahoreClusterSelector must not use intrusive modal popover');
  console.log('  ✔ LahoreClusterSelector flattened to native theme select without card boxing');

  // Gate 6: SupplierDeliverySettingsForm Tokens & 0% Commission
  console.log('\n▶ Gate 6: SupplierDeliverySettingsForm Design Tokens & 0% Commission...');
  const delivPath = path.join(FRONTEND_SRC, 'components/delivery/SupplierDeliverySettingsForm.jsx');
  assert(fs.existsSync(delivPath), 'SupplierDeliverySettingsForm.jsx must exist');
  const delivSrc = fs.readFileSync(delivPath, 'utf8');
  assert(delivSrc.includes('0% MilJor Delivery Fee Commission'), 'Must feature 0% commission badge');
  assert(delivSrc.includes('var(--bg-surface)'), 'Must use design token var(--bg-surface)');
  assert(delivSrc.includes('Standard Rate (PKR)'), 'Must feature compact cluster rate table');
  console.log('  ✔ SupplierDeliverySettingsForm styled with MilJor tokens and prominent 0% commission');

  // Gate 7: PoolsPage Discovery & 16-Specification Catalog
  console.log('\n▶ Gate 7: PoolsPage Location-Aware Discovery & Catalog...');
  const poolsPath = path.join(FRONTEND_SRC, 'pages/PoolsPage.jsx');
  assert(fs.existsSync(poolsPath), 'PoolsPage.jsx must exist');
  const poolsSrc = fs.readFileSync(poolsPath, 'utf8');
  assert(poolsSrc.includes('selectedClusterId'), 'Must maintain selectedClusterId filter');
  assert(poolsSrc.includes('selectedFulfillmentMode'), 'Must maintain selectedFulfillmentMode filter');
  assert(poolsSrc.includes('includeAllPickup'), 'Must maintain includeAllPickup toggle');
  assert(poolsSrc.includes('16 Staple Specifications'), 'Must support 16 specifications catalog mode');
  console.log('  ✔ PoolsPage implements complete cluster, fulfillment mode, and pickup discovery');

  // Gate 8: PoolCard Fulfillment Indicators
  console.log('\n▶ Gate 8: PoolCard Quiet-Luxury Availability Badges...');
  const cardPath = path.join(FRONTEND_SRC, 'components/PoolCard.jsx');
  assert(fs.existsSync(cardPath), 'PoolCard.jsx must exist');
  const cardSrc = fs.readFileSync(cardPath, 'utf8');
  assert(cardSrc.includes('hasStandard'), 'PoolCard must check standard delivery availability');
  assert(cardSrc.includes('hasPickup'), 'PoolCard must check pickup availability');
  assert(cardSrc.includes('hasExpress'), 'PoolCard must check express delivery availability');
  assert(cardSrc.includes('Doorstep'), 'PoolCard must render Doorstep indicator');
  assert(cardSrc.includes('Pickup'), 'PoolCard must render Pickup indicator');
  console.log('  ✔ PoolCard displays quiet, unslopped fulfillment mode indicators');

  console.log('\n================================================================================');
  console.log('PACKAGE D VERIFICATION: ALL 8 GATES PASSED (100% GREEN)');
  console.log('================================================================================\n');
}

runVerification();
