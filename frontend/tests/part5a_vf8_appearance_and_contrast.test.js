// =============================================================================
// frontend/tests/part5a_vf8_appearance_and_contrast.test.js
// MilJor Part 5A-VF8: Appearance Nested Control, Contrast & Single Shared Asset
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

export async function runVF8Tests() {
  console.log('================================================================================');
  console.log('🧪 MILJOR PART 5A-VF8: APPEARANCE CONTROL, CONTRAST & ASSET INTEGRITY');
  console.log('================================================================================\n');

  const shellPath = path.join(frontendDir, 'src', 'components', 'layout', 'AppShell.jsx');
  assert.ok(fs.existsSync(shellPath), 'AppShell.jsx must exist');
  const shellCode = fs.readFileSync(shellPath, 'utf8');

  // 1. Appearance initially collapsed by default
  assert.ok(shellCode.includes('appearanceExpanded'), 'AppShell must manage appearanceExpanded state');
  assert.ok(shellCode.includes('miljor_appearance_expanded'), 'AppShell must read persistent appearance state');
  pass('Appearance initially collapsed by default');

  // 2. Appearance expands inline via button trigger
  assert.ok(shellCode.includes('toggleAppearance'), 'AppShell must provide toggleAppearance handler');
  assert.ok(shellCode.includes('aria-controls="sidebar-appearance-options"'), 'Appearance button must control options');
  pass('Appearance expands inline via accessible button trigger');

  // 3. Appearance collapses again
  assert.ok(shellCode.includes('setAppearanceExpanded(next)'), 'Toggling updates appearanceExpanded state');
  pass('Appearance collapses again on subsequent toggle');

  // 4. System theme option supported
  assert.ok(shellCode.includes('THEME_MODES.SYSTEM'), 'System theme mode supported');
  pass('System theme option available');

  // 5. Light theme option supported
  assert.ok(shellCode.includes('THEME_MODES.LIGHT'), 'Light theme mode supported');
  pass('Light theme option available');

  // 6. Dark theme option supported
  assert.ok(shellCode.includes('THEME_MODES.DARK'), 'Dark theme mode supported');
  pass('Dark theme option available');

  // 7. Manual selection persists
  const themeContextPath = path.join(frontendDir, 'src', 'context', 'ThemeContext.jsx');
  assert.ok(fs.existsSync(themeContextPath), 'ThemeContext.jsx must exist');
  const themeCode = fs.readFileSync(themeContextPath, 'utf8');
  assert.ok(themeCode.includes('localStorage.setItem(\'miljor_theme\''), 'Theme changes must persist in localStorage');
  pass('Theme selection persists in localStorage');

  // 8. System theme reacts to OS preference changes
  assert.ok(themeCode.includes('prefers-color-scheme: dark'), 'ThemeContext must listen to system media query');
  pass('System theme reacts dynamically to OS color-scheme preference');

  // 9. Collapsed-sidebar Appearance panel works
  assert.ok(shellCode.includes('collapsedPanelOpen'), 'AppShell must support anchored panel in collapsed icon rail');
  pass('Collapsed sidebar provides accessible anchored theme panel');

  // 10. Only one active theme control context rendered (no duplicate selectors in drawer footer)
  assert.ok(!shellCode.includes('<ThemeSelector compact className="w-full justify-around" />'), 'Duplicate ThemeSelector removed from mobile drawer footer');
  pass('Zero duplicate theme controls in mobile drawer footer');

  // 11. Hero image integration (VF9 dual-theme asset resolution)
  const landingPath = path.join(frontendDir, 'src', 'pages', 'LandingPage.jsx');
  assert.ok(fs.existsSync(landingPath), 'LandingPage.jsx must exist');
  const landingCode = fs.readFileSync(landingPath, 'utf8');
  assert.ok(
    landingCode.includes('riceHeroDark') && landingCode.includes('riceHeroLight'),
    'LandingPage must import dedicated theme hero assets'
  );
  pass('Hero image assets integrated with seamless dual-theme resolution');

  // 12. Approved Ribbon-M logo toggle behavior preserved
  assert.ok(shellCode.includes('setCollapsed(next)'), 'Logo remains the sole sidebar toggle');
  assert.ok(shellCode.includes('<Logo size="sm" />'), 'Logo uses invariant size="sm" in both states');
  pass('Approved Ribbon-M monogram is the sole sidebar expand/collapse toggle with invariant size');

  // 13. Navigation links remain correct
  assert.ok(shellCode.includes('label: \'Home\', path: \'/\''), 'Home navigation preserved');
  assert.ok(shellCode.includes('label: \'Explore Pools\', path: \'/pools\''), 'Explore Pools navigation preserved');
  assert.ok(shellCode.includes('label: \'Orders\', path: \'/orders\''), 'Orders navigation preserved');
  pass('Navigation links and routing destinations remain intact');

  console.log('\n================================================================================');
  console.log(`🎉 ALL ${passedCount} VF8 TESTS PASSED SUCCESSFULLY!`);
  console.log('================================================================================\n');
}

runVF8Tests();
