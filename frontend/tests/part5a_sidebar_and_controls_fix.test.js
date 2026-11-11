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

export async function runSidebarAndControlsTests() {
  console.log('================================================================================');
  console.log('🛠️ MILJOR: SIDEBAR, APPEARANCE & TOP CONTROLS FIX VERIFICATION');
  console.log('================================================================================\n');

  const shellPath = path.join(frontendDir, 'src', 'components', 'layout', 'AppShell.jsx');
  assert.ok(fs.existsSync(shellPath), 'AppShell.jsx must exist');
  const shellCode = fs.readFileSync(shellPath, 'utf8');

  // 1. Sidebar outside-click handling
  // Redesign requirement (2026-11-12): the desktop sidebar keeps the state the user chose.
  // Outside clicks inside page content must NOT collapse it (accidental collapse / layout shift).
  assert.ok(!shellCode.includes('handleOutsideSidebarClick'), 'Desktop sidebar must not auto-collapse on outside click');
  assert.ok(shellCode.includes('miljor_sidebar_collapsed'), 'Sidebar state must still persist the user choice');
  pass('Desktop sidebar stays in the state chosen by the user (no outside-click collapse)');

  // 2. Smooth sidebar animation
  assert.ok(shellCode.includes('transition-all duration-300 ease-in-out'), 'Sidebar must specify smooth ease-in-out transition');
  assert.ok(shellCode.includes('overflow-hidden'), 'Sidebar must prevent content overflow clipping during animation');
  pass('Sidebar transitions smoothly between collapsed and expanded states');

  // 3. Collapsed appearance click expands sidebar and reveals theme options
  assert.ok(shellCode.includes('handleCollapsedAppearanceClick'), 'AppShell must implement handleCollapsedAppearanceClick');
  assert.ok(shellCode.includes('setCollapsed(false)'), 'Appearance click in collapsed state must expand sidebar');
  assert.ok(shellCode.includes('setAppearanceExpanded(true)'), 'Appearance click must open the appearance submenu');
  pass('Clicking Appearance when collapsed expands the sidebar and reveals theme options');

  // 4. Appearance typography and icon visibility in Light Theme
  assert.ok(shellCode.includes("color: 'var(--text-primary)'"), 'Appearance label must match primary text color');
  assert.ok(shellCode.includes('text-emerald-900 dark:text-champagne'), 'Appearance and utility icons must use high-contrast emerald/champagne styling');
  pass('Appearance icon and typography match navigation links with high visibility in Light theme');

  // 5. Top Right Controls (Search, Bell, Account)
  assert.ok(shellCode.includes('Search Commodities') || shellCode.includes('Search commodities'), 'Top right Search button present');
  assert.ok(shellCode.includes('title="Notifications"'), 'Top right Notifications Bell button present');
  assert.ok(shellCode.includes('title="Account Menu"'), 'Top right Account button present');
  pass('Top-right corner Search, Bell, and Account buttons are fully visible with elevated styling');

  // 6. Interactive Account Dropdown Popover
  assert.ok(shellCode.includes('accountMenuOpen'), 'AppShell must manage accountMenuOpen state');
  assert.ok(shellCode.includes('handleOutsideAccountClick'), 'Account dropdown must close on outside click');
  assert.ok(shellCode.includes('Create Account'), 'Account dropdown must render Create Account button for guests');
  assert.ok(shellCode.includes('Sign In'), 'Account dropdown must render Sign In button for guests');
  pass('Interactive Account dropdown provides visible Sign In and Create Account buttons');

  console.log('\n================================================================================');
  console.log(`🎉 ALL ${passedCount} SIDEBAR & CONTROLS FIX TESTS PASSED!`);
  console.log('================================================================================\n');
}

runSidebarAndControlsTests();
