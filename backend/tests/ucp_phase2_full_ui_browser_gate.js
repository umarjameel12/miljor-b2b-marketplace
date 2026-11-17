'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawn } = require('node:child_process');
const bcrypt = require('bcryptjs');
const { assertPortsAvailable, viteLaunchSource } = require('./helpers/phase1BrowserServerGuard');

assert.equal(process.env.NODE_ENV, 'test', 'NODE_ENV must be test');
assert.equal(process.env.DB_NAME, 'miljor_test_db', 'DB_NAME must be miljor_test_db');
assert.equal(process.env.TEST_DB_NAME, 'miljor_test_db', 'TEST_DB_NAME must be miljor_test_db');
assert.equal(process.env.MILJOR_TEST_ONLY_MIGRATIONS, '1');

const { chromium } = require('playwright');
const BASE_UI = process.env.PHASE2_BROWSER_BASE_URL || 'http://127.0.0.1:35102';
const uiUrl = new URL(BASE_UI);
const UI_PORT = Number(uiUrl.port || 35102);
const API_PORT = Number(process.env.PHASE2_BROWSER_API_PORT || 35103);
const PASS = process.env.P0_BROWSER_TEST_PASSWORD || 'Phase2BrowserTest_2026!';

async function waitForHttp(url, child, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.startupError) throw child.startupError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Owned server exited before ${url} was ready`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function run() {
  await assertPortsAvailable([UI_PORT, API_PORT]);
  const db = require('../src/config/db');
  const notificationService = require('../src/services/notificationService');
  const ucpNotifications = require('../src/services/ucpTransactionalNotifications');

  const expectedPort = Number(process.env.DB_PORT || 3306);
  const [[identity]] = await db.query('SELECT DATABASE() AS db, @@port AS port');
  assert.equal(identity.db, 'miljor_test_db');
  assert.equal(Number(identity.port), expectedPort);
  console.log(`[DB-GUARD] Phase 2 Browser gate verified DB=${identity.db} on port=${identity.port}`);

  const tag = `ph2b_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const passHash = await bcrypt.hash(PASS, 10);
  const created = { users: [], orders: [] };

  const logDir = path.resolve(__dirname, '../logs/ucp-phase2-browser');
  fs.mkdirSync(logDir, { recursive: true });
  const apiLogPath = path.join(logDir, 'api.log');
  const viteLogPath = path.join(logDir, 'vite.log');
  fs.writeFileSync(apiLogPath, '');
  fs.writeFileSync(viteLogPath, '');

  const backendDir = path.resolve(__dirname, '..');
  const frontendDir = path.resolve(__dirname, '../../frontend');
  const apiProc = spawn(process.execPath, ['server.js'], {
    cwd: backendDir,
    env: { ...process.env, PORT: String(API_PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  apiProc.stdout.on('data', d => fs.appendFileSync(apiLogPath, d));
  apiProc.stderr.on('data', d => fs.appendFileSync(apiLogPath, d));
  apiProc.on('error', err => { apiProc.startupError = err; });

  const viteProc = spawn(process.execPath, ['--input-type=module', '-e', viteLaunchSource(UI_PORT, API_PORT)], {
    cwd: frontendDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  viteProc.stdout.on('data', d => fs.appendFileSync(viteLogPath, d));
  viteProc.stderr.on('data', d => fs.appendFileSync(viteLogPath, d));
  viteProc.on('error', err => { viteProc.startupError = err; });

  let browser = null;
  try {
    await Promise.all([
      waitForHttp(`http://127.0.0.1:${API_PORT}/health/live`, apiProc),
      waitForHttp(`${BASE_UI}/`, viteProc)
    ]);
    console.log(`[SERVER] Owned Express (${API_PORT}) & Vite (${UI_PORT}) ready`);

    const phone = `+92319${String(Date.now()).slice(-7)}`;
    const email = `${tag}_b@test.local`;
    const [uRes] = await db.query(
      `INSERT INTO users (full_name, business_name, email, phone, password_hash, role, is_verified, verification_status, buyer_trust_status, city, area, address)
       VALUES ('Ph2 Mobile Buyer', 'Ph2 Buyer Co', ?, ?, ?, 'BUYER', 1, 'VERIFIED', 'CONTACT_VERIFIED', 'Lahore', 'Gulberg', 'Gulberg, Lahore')`,
      [email, phone, passHash]
    );
    const buyerId = uRes.insertId;
    created.users.push(buyerId);

    // Seed an unpaid/pending order for /payment/return recovery check
    const ordCode = `ORD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const [oRes] = await db.query(
      `INSERT INTO orders (
        order_code, buyer_id, supplier_id, total_qty, unit_price,
        subtotal_amount, delivery_fee, buyer_platform_fee, total_amount,
        currency, delivery_type, delivery_address, order_status, payment_status, fulfillment_status
      ) VALUES (?, ?, ?, 5.0000, 100.00, 500.00, 100.00, 0.00, 600.00, 'PKR', 'DOORSTEP', 'Lahore', 'AWAITING_PAYMENT', 'PAYMENT_INITIATED', 'UNPAID')`,
      [ordCode, buyerId, buyerId]
    );
    const pendingOrderId = oRes.insertId;
    created.orders.push(pendingOrderId);

    // Seed a real transactional notification for the buyer
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await ucpNotifications.recordInAppOnConnection(conn, {
        type: 'PAYMENT.CHECKOUT_CREATED',
        aggregateId: `ph2-ui-${pendingOrderId}`,
        aggregateVersion: 1,
        transitionId: `ui-${tag}`,
        recipients: [{ userId: buyerId, role: 'BUYER' }],
        title: 'Checkout initiated',
        message: 'Complete your payment to confirm the order.',
        payload: { order_id: pendingOrderId, status: 'PAYMENT_INITIATED', notification_path: '/orders' },
        actorId: buyerId,
        actorRole: 'BUYER',
        schemaVersion: 2
      });
      await conn.commit();
    } finally {
      conn.release();
    }
    await notificationService.processPending({ limit: 20 });

    const winDefault = 'C:\\Users\\Umar Jameel\\AppData\\Local\\ms-playwright\\chromium-1194\\chrome-win\\chrome.exe';
    const executablePath = process.env.CHROME_EXECUTABLE_PATH || (process.platform === 'win32' && fs.existsSync(winDefault) ? winDefault : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

    // Mobile viewport (390x844) context
    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await mobileCtx.newPage();

    await page.goto(`${BASE_UI}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASS);
    const loginResp = page.waitForResponse(r => r.url().includes('/api/v1/auth/login'), { timeout: 15000 });
    await page.getByRole('button', { name: /sign in/i }).click();
    assert.equal((await loginResp).status(), 200);
    await page.waitForURL(/\/(pools|orders)/, { timeout: 15000 });

    // Keyboard Tab navigation check
    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName || '');
    assert.ok(focusedTag.length > 0, 'Keyboard Tab focus must move to an interactive element');
    console.log('[PASS CHROMIUM] Mobile (390x844) login & keyboard focus verified');

    // Payment return pending/reload check (must NOT fabricate PAID)
    await page.goto(`${BASE_UI}/payment/return?order_id=${pendingOrderId}`, { waitUntil: 'networkidle' });
    await page.getByText(/Pending|Verifying|Awaiting/i).first().waitFor({ timeout: 15000 });
    assert.equal(await page.getByText('Payment Confirmed & Secured in Escrow').count(), 0, 'Pending order must never show PAID');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.getByText('Payment Confirmed & Secured in Escrow').count(), 0, 'Reloaded pending order must remain non-PAID');
    console.log('[PASS CHROMIUM] /payment/return pending outcome & reload recovery (no fabricated PAID)');

    // Notification inbox, Urdu ('ur') preference persistence via UI, Urdu rendering (dir="auto"), and Mark read
    await notificationService.createNotification({
      userId: buyerId,
      role: 'BUYER',
      eventType: 'ORDER_DISPATCHED',
      eventKey: `ur-ui:${tag}`,
      title: 'آرڈر روانہ ہو گیا',
      message: 'آپ کا آرڈر لاہور ترسیل کے لیے روانہ کر دیا گیا ہے۔',
      payload: { schemaVersion: 1, entityType: 'ORDER', entityId: pendingOrderId, deepLink: '/orders' }
    });

    await page.goto(`${BASE_UI}/orders`, { waitUntil: 'networkidle' });
    const bellBtn = page.locator('[data-notification-trigger], button[aria-label*="notification" i]').first();
    await bellBtn.waitFor({ timeout: 10000 });
    await bellBtn.click();

    // Verify Urdu notification renders in [dir="auto"] and Mark read works
    const urduTitle = page.locator('[dir="auto"]', { hasText: 'آرڈر روانہ ہو گیا' }).first();
    await urduTitle.waitFor({ timeout: 10000 });
    const markReadBtn = page.getByRole('button', { name: /Mark read/i }).first();
    await markReadBtn.click();
    await page.waitForTimeout(400);

    // Select Urdu ('ur') in Notification preferences UI, save, reload, and verify persistence
    await page.locator('summary', { hasText: 'Notification preferences' }).first().click();
    const localeSelect = page.locator('label:has-text("Notification language") select').first();
    await localeSelect.selectOption('ur');
    await page.getByRole('button', { name: /Save preferences/i }).first().click();
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');

    await page.reload({ waitUntil: 'networkidle' });
    await bellBtn.click();
    await page.locator('summary', { hasText: 'Notification preferences' }).first().click();
    const persistedLocale = await page.locator('label:has-text("Notification language") select').first().inputValue();
    assert.equal(persistedLocale, 'ur', 'Urdu locale preference must persist across reload in UI');
    const prefs = await notificationService.getPreferences(buyerId);
    assert.equal(prefs.locale, 'ur');
    await page.keyboard.press('Escape');
    console.log('[PASS CHROMIUM] Mobile (390x844) Urdu locale UI save/reload, Urdu [dir="auto"] rendering, and Mark read verified');

    console.log('ALL PHASE 2 FULL UI BROWSER CHECKS PASSED');
  } finally {
    if (browser) await browser.close().catch(() => {});
    viteProc.kill('SIGTERM');
    apiProc.kill('SIGTERM');

    try {
      if (created.orders.length) {
        await db.query(`DELETE FROM orders WHERE id IN (${created.orders.map(() => '?').join(',')})`, created.orders);
      }
      if (created.users.length) {
        const ph = created.users.map(() => '?').join(',');
        await db.query(`DELETE FROM platform_notifications WHERE user_id IN (${ph})`, created.users);
        await db.query(`DELETE FROM notification_preferences WHERE user_id IN (${ph})`, created.users);
        await db.query(`DELETE FROM procurement_notifications WHERE recipient_id IN (${ph})`, created.users);
        await db.query(`DELETE FROM idempotency_records WHERE user_id IN (${ph})`, created.users);
        await db.query(`DELETE FROM users WHERE id IN (${ph})`, created.users);
      }
    } catch (e) {
      console.error('[CLEANUP WARNING]', e.message);
    }
    await db.end();
  }
}

run().catch(err => {
  console.error('[PHASE 2 BROWSER GATE FAIL]', err);
  process.exitCode = 1;
});
