// =============================================================================
// frontend/tests/part5a_vf9_hero_integration.test.js
// MilJor Part 5A-VF9: Cinematic Hero Image Integration & Dual-Theme Atmosphere
// =============================================================================

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '..');

let passedCount = 0;
function pass(msg) {
  passedCount++;
  console.log(`  [PASS] Assertion ${passedCount}: ${msg}`);
}

export async function runVF9Tests() {
  console.log('================================================================================');
  console.log('🌾 MILJOR PART 5A-VF9: CINEMATIC HERO IMAGE & DUAL-THEME ATMOSPHERE TEST');
  console.log('================================================================================\n');

  // 1. Dark Hero Asset Exists and has high fidelity
  const darkAssetPath = path.join(frontendDir, 'src', 'assets', 'hero', 'miljor-rice-hero-dark.png');
  assert.ok(fs.existsSync(darkAssetPath), 'miljor-rice-hero-dark.png must exist in src/assets/hero/');
  const darkStat = fs.statSync(darkAssetPath);
  assert.ok(darkStat.size > 500000, `Dark hero asset must be high-res (>500KB), got ${darkStat.size} bytes`);
  pass(`Dark hero image asset exists and is high fidelity (${(darkStat.size / 1024).toFixed(1)} KB)`);

  // 2. Light Hero Asset Exists and has high fidelity
  const lightAssetPath = path.join(frontendDir, 'src', 'assets', 'hero', 'miljor-rice-hero-light.png');
  assert.ok(fs.existsSync(lightAssetPath), 'miljor-rice-hero-light.png must exist in src/assets/hero/');
  const lightStat = fs.statSync(lightAssetPath);
  assert.ok(lightStat.size > 500000, `Light hero asset must be high-res (>500KB), got ${lightStat.size} bytes`);
  pass(`Light hero image asset exists and is high fidelity (${(lightStat.size / 1024).toFixed(1)} KB)`);

  // 3. LandingPage imports both theme-specific hero assets
  const landingPath = path.join(frontendDir, 'src', 'pages', 'LandingPage.jsx');
  assert.ok(fs.existsSync(landingPath), 'LandingPage.jsx must exist');
  const landingCode = fs.readFileSync(landingPath, 'utf8');
  assert.ok(landingCode.includes('import riceHeroDark from \'../assets/hero/miljor-rice-hero-dark.png\''), 'LandingPage imports dark hero asset');
  assert.ok(landingCode.includes('import riceHeroLight from \'../assets/hero/miljor-rice-hero-light.png\''), 'LandingPage imports light hero asset');
  pass('LandingPage imports both dedicated theme-specific hero assets');

  // 4. LandingPage dynamically binds hero image based on active theme
  assert.ok(landingCode.includes('useTheme()'), 'LandingPage consumes useTheme');
  assert.ok(landingCode.includes('currentHeroImg = isDark ? riceHeroDark : riceHeroLight'), 'LandingPage selects hero image dynamically via isDark');
  assert.ok(landingCode.includes('src={currentHeroImg}'), 'Image element binds to dynamic currentHeroImg');
  pass('LandingPage dynamically binds hero image to active theme (Dark / Light / System)');

  // 5. Preloading prevents flicker during theme switches
  assert.ok(landingCode.includes('new Image()') && landingCode.includes('imgDark.src = riceHeroDark') && landingCode.includes('imgLight.src = riceHeroLight'), 'Images preloaded on mount');
  pass('Image preloading logic verified for instant, flicker-free theme transitions');

  // 6. Accessible and luxury-branded alt text
  assert.ok(landingCode.includes('alt="MilJor Premium Basmati Rice in Woven Burlap Sack"'), 'Accessible luxury alt text provided');
  pass('Accessible and luxury-branded alt text configured');

  // 7. Strictly ZERO period after "Together"
  assert.ok(landingCode.includes('Buy Better,') && landingCode.includes('Together'), 'Editorial headline structure present');
  assert.ok(!landingCode.includes('Together.') && !landingCode.includes('Together .'), 'Strictly ZERO period after "Together"');
  pass('Editorial headline preserved: "Buy Better," line 1, "Together" line 2 with NO period');

  // 8. Brand tagline preserved
  assert.ok(landingCode.includes('Milkar Khareedo, Behtar Pao'), 'Brand tagline present in eyebrow pill');
  pass('Brand tagline "Milkar Khareedo, Behtar Pao" intact');

  // 9. Gradient and atmospheric glow tokens in index.css
  const cssPath = path.join(frontendDir, 'src', 'index.css');
  assert.ok(fs.existsSync(cssPath), 'index.css must exist');
  const cssCode = fs.readFileSync(cssPath, 'utf8');
  assert.ok(cssCode.includes('--glow-hero: radial-gradient'), 'Light theme --glow-hero established');
  assert.ok(cssCode.includes('--bg-sidebar: #e3d7c4'), 'Light theme sidebar #e3d7c4');
  assert.ok(cssCode.includes('--bg-page: #eee6d8'), 'Light theme canvas #eee6d8');
  assert.ok(cssCode.includes('--bg-sidebar: #05251d'), 'Dark theme sidebar #05251d');
  assert.ok(cssCode.includes('--bg-page: #072a21'), 'Dark theme canvas #072a21');
  pass('Dual-theme atmospheric gradients and surface separation verified in index.css');

  // 10. Approved Ribbon-M Logo Invariants Preserved
  const logoPath = path.join(frontendDir, 'src', 'components', 'ui', 'Logo.jsx');
  assert.ok(fs.existsSync(logoPath), 'Logo.jsx must exist');
  const logoCode = fs.readFileSync(logoPath, 'utf8');
  assert.ok(logoCode.includes('flowing-gold-ribbon-m'), 'Flowing ribbon-m id verified');
  assert.ok(!logoCode.includes('MilJor<') && !logoCode.includes('>MilJor<'), 'Monogram only (no adjacent wordmark)');
  pass('Approved VF-1 Champagne-Gold Ribbon-M monogram preserved with strict invariance');

  // 11. Sole sidebar toggle & appearance menu in AppShell
  const shellPath = path.join(frontendDir, 'src', 'components', 'layout', 'AppShell.jsx');
  assert.ok(fs.existsSync(shellPath), 'AppShell.jsx must exist');
  const shellCode = fs.readFileSync(shellPath, 'utf8');
  assert.ok(shellCode.includes('setCollapsed(!collapsed)') || shellCode.includes('setCollapsed(next)'), 'Logo is the sole sidebar expand/collapse toggle');
  assert.ok(!shellCode.includes('lucide-menu') && !shellCode.includes('MenuIcon'), 'Zero hamburger icons on desktop');
  assert.ok(shellCode.includes('sidebar-appearance-options'), 'Nested Appearance controls under Support');
  pass('Sidebar architecture preserved: Sole Ribbon-M toggle and nested Appearance options');

  console.log('\n================================================================================');
  console.log(`🎉 ALL ${passedCount} PART 5A-VF9 TESTS PASSED SUCCESSFULLY!`);
  console.log('================================================================================\n');
}

runVF9Tests();
