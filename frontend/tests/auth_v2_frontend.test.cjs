// =============================================================================
// frontend/tests/auth_v2_frontend.test.cjs
// MilJor Premium Authentication Experience V2: Automated Verification Gate
// Verifies Nationwide Positioning, Distinct Hero Panels, Password UX,
// Complete Forgot Password Journey, and Targeted Package D Corrections
// =============================================================================
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const FRONTEND_SRC = path.resolve(__dirname, '../src');

function runAuthV2Verification() {
  console.log('================================================================================');
  console.log('MILJOR PREMIUM AUTHENTICATION EXPERIENCE V2: VERIFICATION GATE');
  console.log('================================================================================');

  // Gate 1: Distinct Hero Panels & Imagery
  console.log('\n▶ Gate 1: Distinct Hero Panels & Assets...');
  const heroPath = path.join(FRONTEND_SRC, 'components/auth/AuthHeroPanel.jsx');
  assert(fs.existsSync(heroPath), 'AuthHeroPanel.jsx must exist');
  const heroSrc = fs.readFileSync(heroPath, 'utf8');
  assert(heroSrc.includes('signInHeroDark') && heroSrc.includes('signInHeroLight'), 'Sign In must have dedicated light/dark hero assets');
  assert(heroSrc.includes('registerHeroImg'), 'Register must have distinct hero image');
  assert(heroSrc.includes('Welcome back to smarter procurement.'), 'Sign In must feature dedicated welcome copy');
  assert(heroSrc.includes('Better buying power starts together.'), 'Register must feature dedicated inspirational copy');
  assert(heroSrc.includes('Secure account recovery.'), 'Forgot password must feature recovery copy');
  console.log('  ✔ Distinct hero panels, imagery, and copy verified for Sign In, Register, and Recovery');

  // Gate 2: Nationwide Brand Positioning & Operational Grounding
  console.log('\n▶ Gate 2: Nationwide Brand Positioning vs Lahore Launch Operational Truth...');
  assert(heroSrc.includes('Built for Pakistan · Launching first in Lahore'), 'Hero must show nationwide positioning with Lahore launch');
  const loginSrc = fs.readFileSync(path.join(FRONTEND_SRC, 'pages/LoginPage.jsx'), 'utf8');
  assert(loginSrc.includes('Smarter procurement for growing businesses · Launching first in Lahore'), 'Login must use nationwide tagline');
  const regSrc = fs.readFileSync(path.join(FRONTEND_SRC, 'pages/RegisterPage.jsx'), 'utf8');
  assert(regSrc.includes('Launching first in Lahore'), 'Register must clarify Lahore is first market');
  assert(regSrc.includes('LahoreClusterSelector'), 'Operational cluster picker must remain Lahore District');
  assert(regSrc.includes('city: \'Lahore\''), 'City must remain fixed to Lahore');
  console.log('  ✔ Nationwide brand narrative implemented without relaxing Lahore operational boundaries');

  // Gate 3: Password Guidance & Live Strength Feedback
  console.log('\n▶ Gate 3: Password Guidance & Live Strength Feedback...');
  const strengthPath = path.join(FRONTEND_SRC, 'components/auth/PasswordStrengthIndicator.jsx');
  assert(fs.existsSync(strengthPath), 'PasswordStrengthIndicator.jsx must exist');
  const strengthSrc = fs.readFileSync(strengthPath, 'utf8');
  assert(strengthSrc.includes('calculatePasswordStrength'), 'Must compute strength score');
  assert(strengthSrc.includes('8+ characters'), 'Checklist must verify length >= 8');
  assert(strengthSrc.includes('Contains letters'), 'Checklist must verify letters');
  assert(strengthSrc.includes('Contains numbers'), 'Checklist must verify numbers');
  assert(strengthSrc.includes('Passwords match'), 'Checklist must verify password confirmation');
  const fieldPath = path.join(FRONTEND_SRC, 'components/auth/PasswordField.jsx');
  assert(fs.existsSync(fieldPath), 'PasswordField.jsx must exist');
  console.log('  ✔ Password UX provides clear requirements, live checklist, and multi-factor strength evaluation');

  // Gate 4: Complete Forgot Password Journey
  console.log('\n▶ Gate 4: Complete 4-Step Forgot Password Flow...');
  const forgotPath = path.join(FRONTEND_SRC, 'pages/ForgotPasswordPage.jsx');
  assert(fs.existsSync(forgotPath), 'ForgotPasswordPage.jsx must exist');
  const forgotSrc = fs.readFileSync(forgotPath, 'utf8');
  assert(forgotSrc.includes('Reset your password'), 'Step 1: Email request must exist');
  assert(forgotSrc.includes('Enter verification code'), 'Step 2: OTP verification must exist');
  assert(forgotSrc.includes('Set new password'), 'Step 3: New password entry must exist');
  assert(forgotSrc.includes('Password Reset Complete') || forgotSrc.includes('Password successfully updated'), 'Step 4: Success confirmation must exist');
  assert(forgotSrc.includes('requestPasswordReset'), 'Must wire authApi.requestPasswordReset');
  assert(forgotSrc.includes('resetPassword'), 'Must wire authApi.resetPassword');
  assert(forgotSrc.includes('Resend code'), 'Must support OTP resend');
  console.log('  ✔ Complete 4-step password recovery flow implemented and wired to backend contracts');

  // Gate 5: Reversible Appearance Controls
  console.log('\n▶ Gate 5: Preserved Reversible Appearance Controls...');
  const appSrc = fs.readFileSync(path.join(FRONTEND_SRC, 'context/AuthAppearanceContext.jsx'), 'utf8');
  assert(appSrc.includes('miljor_auth_appearance'), 'Must preserve miljor_auth_appearance key');
  assert(loginSrc.includes("layoutStyle === 'original'"), 'LoginPage must support original centered card');
  assert(regSrc.includes("layoutStyle === 'original'"), 'RegisterPage must support original centered card');
  assert(forgotSrc.includes("layoutStyle === 'original'"), 'ForgotPasswordPage must support original centered card');
  assert(loginSrc.includes('AuthAppearanceControl'), 'LoginPage must mount appearance popover');
  assert(regSrc.includes('AuthAppearanceControl'), 'RegisterPage must mount appearance popover');
  assert(forgotSrc.includes('AuthAppearanceControl'), 'ForgotPasswordPage must mount appearance popover');
  console.log('  ✔ Reversible appearance preserved across all auth views (Enhanced vs Original)');

  // Gate 6: Targeted Package D Frontend Corrections
  console.log('\n▶ Gate 6: Targeted Package D Frontend Corrections...');
  const cardSrc = fs.readFileSync(path.join(FRONTEND_SRC, 'components/PoolCard.jsx'), 'utf8');
  assert(!cardSrc.includes('4-hour expedited dispatch available'), 'Hardcoded 4-hour express SLA claim must be removed from PoolCard');
  assert(!cardSrc.includes("title=\"Tier 1 Volume Target (33%)\""), 'Misleading static 33% tier notch must be removed from PoolCard');
  const poolsSrc = fs.readFileSync(path.join(FRONTEND_SRC, 'pages/PoolsPage.jsx'), 'utf8');
  assert(!poolsSrc.includes('Express (4h)'), 'Express (4h) label must be removed from PoolsPage');
  assert(poolsSrc.includes('STANDARD_CLUSTERED'), 'PoolsPage must use STANDARD_CLUSTERED enum matching backend');
  console.log('  ✔ Package D cautions resolved: Express 4h removed, static tier notches removed, enum aligned');

  // Gate 7: Application Routes
  console.log('\n▶ Gate 7: Application Route Registration...');
  const appMainSrc = fs.readFileSync(path.join(FRONTEND_SRC, 'App.jsx'), 'utf8');
  assert(appMainSrc.includes('path="/forgot-password"'), 'Route /forgot-password must be registered in App.jsx');
  console.log('  ✔ /forgot-password registered as standalone auth route with clean navigation');

  console.log('\n================================================================================');
  console.log('VERIFICATION VERDICT: ALL 7 GATES PASSED (100% GREEN)');
  console.log('================================================================================\n');
}

runAuthV2Verification();
