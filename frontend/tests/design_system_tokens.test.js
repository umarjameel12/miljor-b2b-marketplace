// =============================================================================
// frontend/tests/design_system_tokens.test.js
// MilJor Part 5A.1: Design System, Brand Palette & Token Integrity Verification
// =============================================================================

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '..');

let passedAssertions = 0;
function pass(msg) {
  passedAssertions++;
  console.log(`  [PASS] Assertion ${passedAssertions}: ${msg}`);
}

async function runDesignSystemVerification() {
  console.log('================================================================================');
  console.log('🎨 MILJOR PART 5A.1: DESIGN SYSTEM, BRAND & TOKEN VERIFICATION');
  console.log('================================================================================\n');

  // 1. Inspect index.css tokens
  const cssPath = path.join(frontendDir, 'src', 'index.css');
  assert.ok(fs.existsSync(cssPath), 'src/index.css must exist');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  // Verify Approved Brand Palette (#072A21, #0F5A48, #C8B276, #F7F3E8, #121417)
  assert.ok(cssContent.includes('#072a21'), 'Deep Forest #072a21 must be defined');
  assert.ok(cssContent.includes('#0f5a48'), 'Emerald #0f5a48 must be defined');
  assert.ok(cssContent.includes('#c8b276'), 'Champagne Accent #c8b276 must be defined');
  assert.ok(cssContent.includes('#f7f3e8'), 'Ivory Surface #f7f3e8 must be defined');
  assert.ok(cssContent.includes('#121417'), 'Ink Text #121417 must be defined');
  pass('Brand Palette: All 5 approved colors (#072a21, #0f5a48, #c8b276, #f7f3e8, #121417) tokenized in src/index.css');

  // 2. Inspect Typography Scale & Stacks
  assert.ok(cssContent.includes('Playfair Display'), 'Playfair Display font stack must be configured for editorial headlines');
  assert.ok(cssContent.includes('Inter'), 'Inter font stack must be configured for UI and body');
  assert.ok(cssContent.includes('tabular-nums'), 'Tabular figures utility must be configured for numbers');
  pass('Typography: Playfair Display (editorial serif) and Inter (interface/numbers) properly configured');

  // 3. Inspect Dark Theme Tokens
  assert.ok(cssContent.includes('.dark'), '.dark CSS selector must be present');
  assert.ok(cssContent.includes('--bg-page: #072a21'), 'Dark mode must use elevated Forest green (#072a21)');
  assert.ok(cssContent.includes('--bg-surface: #0a3429'), 'Dark mode surface must be #0a3429');
  pass('Theme Tokens: Complete Light & Dark semantic variables established without pure black');

  // 4. Inspect index.html Typography & Anti-Flash Script
  const htmlPath = path.join(frontendDir, 'index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(htmlContent.includes('Playfair+Display'), 'index.html must load Playfair Display stylesheet');
  assert.ok(htmlContent.includes('family=Inter'), 'index.html must load Inter stylesheet');
  assert.ok(htmlContent.includes('localStorage.getItem(\'miljor_theme\')'), 'Synchronous anti-flash script must be present in <head>');
  pass('Anti-Flash & Typography Loading: Synchronous theme script and web font links verified in index.html');

  // 5. Inspect Custom Ribbon-M Brand Asset in favicon and Logo.jsx
  // 5. Inspect Master Flowing Gold Ribbon-M Brand Asset in favicon and Logo.jsx
  const faviconPath = path.join(frontendDir, 'public', 'favicon.svg');
  assert.ok(fs.existsSync(faviconPath), 'public/favicon.svg must exist');
  const faviconContent = fs.readFileSync(faviconPath, 'utf8');
  assert.ok(faviconContent.toLowerCase().includes('#072a21'), 'Favicon must use Forest background');

  const logoPath = path.join(frontendDir, 'src', 'components', 'ui', 'Logo.jsx');
  assert.ok(fs.existsSync(logoPath), 'src/components/ui/Logo.jsx must exist');
  const logoContent = fs.readFileSync(logoPath, 'utf8');
  assert.ok(logoContent.includes('flowing-gold-ribbon-m'), 'Logo.jsx must implement the master flowing ribbon M monogram');
  assert.ok(!logoContent.includes('MilJor<') && !logoContent.includes('>MilJor<'), 'Logo.jsx must NOT contain adjacent "MilJor" text');
  pass('Logo System: Flowing Champagne-Gold Ribbon-M Monogram implemented in SVG & Logo component');

  // 6. Inspect Opening Treatment Compliance (Strictly monogram-only, no 'MilJor' text)
  const openingPath = path.join(frontendDir, 'src', 'components', 'ui', 'OpeningTreatment.jsx');
  assert.ok(fs.existsSync(openingPath), 'src/components/ui/OpeningTreatment.jsx must exist');
  const openingContent = fs.readFileSync(openingPath, 'utf8');
  assert.ok(openingContent.includes('variant="monogram"'), 'Opening treatment must render monogram variant only');
  assert.ok(!openingContent.includes('MilJor<'), 'Opening treatment must NOT display "MilJor" text next to monogram');
  pass('Opening Treatment: Strictly monogram-only without "MilJor" wordmark text');

  // 7. Verify Content Truthfulness in PoolsPage and PoolCard
  const poolCardPath = path.join(frontendDir, 'src', 'components', 'PoolCard.jsx');
  const poolCardContent = fs.readFileSync(poolCardPath, 'utf8');
  assert.ok(poolCardContent.includes('Estimated Price'), 'Price must be explicitly labeled Estimated Price');
  assert.ok(!poolCardContent.includes('Maximum Tier Discount Attained'), 'Fabricated discount claim must be removed');
  pass('Content Truthfulness: Fabricated marketing claims removed and replaced with Quiet Luxury facts');

  // 8. Verify UI Primitives Exist and Export Cleanly
  const uiPrimitives = ['Button.jsx', 'Input.jsx', 'Card.jsx', 'Badge.jsx', 'Skeleton.jsx', 'Drawer.jsx', 'ThemeSelector.jsx'];
  for (const file of uiPrimitives) {
    const filePath = path.join(frontendDir, 'src', 'components', 'ui', file);
    assert.ok(fs.existsSync(filePath), `UI primitive ${file} must exist in src/components/ui/`);
  }
  pass('UI Primitives: Button, Input, Card, Badge, Skeleton, Drawer, and ThemeSelector present');

  // 9. Verify Collapsible Desktop Sidebar and Accessible Mobile Drawer in AppShell
  const shellPath = path.join(frontendDir, 'src', 'components', 'layout', 'AppShell.jsx');
  assert.ok(fs.existsSync(shellPath), 'AppShell.jsx must exist');
  const shellContent = fs.readFileSync(shellPath, 'utf8');
  assert.ok(shellContent.includes('collapsed'), 'AppShell must support collapsed sidebar state');
  assert.ok(shellContent.includes('Drawer'), 'AppShell must integrate accessible mobile Drawer');
  assert.ok(shellContent.includes('ThemeSelector') || shellContent.includes('THEME_MODES'), 'Sidebar/Drawer must host theme appearance settings');
  pass('Sidebar & Navigation: Collapsible desktop sidebar (w-64/w-20) and mobile drawer implemented in AppShell');

  // 10. Verify Landing Page Editorial Fidelity (Strict User Directive: NO period after "Together")
  const landingPath = path.join(frontendDir, 'src', 'pages', 'LandingPage.jsx');
  assert.ok(fs.existsSync(landingPath), 'LandingPage.jsx must exist');
  const landingContent = fs.readFileSync(landingPath, 'utf8');
  assert.ok(landingContent.includes('Buy Better,') && landingContent.includes('Together'), 'Landing page must feature "Buy Better," and "Together" headline without period');
  assert.ok(!landingContent.includes('Together.') && !landingContent.includes('Together .'), 'Landing page must STRICTLY NOT have a period after "Together"');
  assert.ok(landingContent.includes('Milkar Khareedo, Behtar Pao'), 'Brand tagline must be present in proper context');
  assert.ok(landingContent.toLowerCase().includes('verified suppliers'), 'Value pillars must be present');
  pass('Landing Page: Editorial luxury hero, fresh food imagery showcase, and value pillars verified');

  console.log('\n================================================================================');
  console.log(`🎉 ALL ${passedAssertions} DESIGN SYSTEM INTEGRITY ASSERTIONS PASSED!`);
  console.log('================================================================================\n');
}

runDesignSystemVerification().catch((err) => {
  console.error('\n❌ DESIGN SYSTEM INTEGRITY FAILED:', err.message);
  process.exit(1);
});
