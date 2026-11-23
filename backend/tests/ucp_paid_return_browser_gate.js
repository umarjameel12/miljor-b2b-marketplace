'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken');
const { JWT_ISSUER, JWT_AUDIENCE } = require('../src/middlewares/authGuard');
const { chromium } = require('playwright');
const { assertPortsAvailable, viteLaunchSource } = require('./helpers/phase1BrowserServerGuard');

assert.equal(process.env.NODE_ENV, 'test', 'NODE_ENV must be test');
assert.equal(process.env.DB_NAME, 'miljor_test_db', 'DB_NAME must be miljor_test_db');
assert.equal(process.env.TEST_DB_NAME, 'miljor_test_db', 'TEST_DB_NAME must be miljor_test_db');
assert.equal(process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT, 'false', 'ALLOW_EXTERNAL_MONEY_MOVEMENT must be false');

const BASE_UI = process.env.PAID_RETURN_UI_URL || 'http://127.0.0.1:35122';
const UI_PORT = Number(new URL(BASE_UI).port || 35122);
const API_PORT = Number(process.env.PAID_RETURN_API_PORT || 35123);
const ORDER_ID = Number(process.env.PAID_RETURN_ORDER_ID || 253);
const ARTIFACT_DIR = path.resolve(__dirname, '../logs/ucp-paid-return-browser');

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
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  await assertPortsAvailable([API_PORT, UI_PORT]);

  const db = require('../src/config/db');
  const sessionService = require('../src/services/sessionService');
  const [[identity]] = await db.query('SELECT DATABASE() AS db_name, @@port AS db_port');
  assert.equal(identity.db_name, 'miljor_test_db');
  assert.equal(String(identity.db_port), String(process.env.DB_PORT));
  console.log(`[DB-GUARD] Verified DB=${identity.db_name} port=${identity.db_port}`);

  const [[order]] = await db.query(
    'SELECT id, order_code, buyer_id, total_amount, currency, order_status, payment_status FROM orders WHERE id = ?',
    [ORDER_ID]
  );
  assert.ok(order, `Order ${ORDER_ID} must exist in isolated miljor_test_db`);
  assert.equal(order.payment_status, 'PAID');
  assert.equal(Number(order.total_amount).toFixed(2), '100.00');
  assert.equal(order.currency, 'PKR');

  const [[beforePay]] = await db.query('SELECT COUNT(*) AS cnt FROM payments WHERE order_id = ?', [ORDER_ID]);
  assert.equal(Number(beforePay.cnt), 1, 'Expected exactly 1 payment row before browser journey');

  const [[otherBuyer]] = await db.query(
    "SELECT id FROM users WHERE role = 'BUYER' AND id != ? AND is_verified = 1 ORDER BY id ASC LIMIT 1",
    [order.buyer_id]
  );
  assert.ok(otherBuyer, 'Need another buyer user to test ownership isolation');

  const backendDir = path.resolve(__dirname, '..');
  const frontendDir = path.resolve(__dirname, '../../frontend');
  const serverEnv = {
    ...process.env,
    PORT: String(API_PORT),
    FRONTEND_URL: BASE_UI,
    CORS_ORIGINS: BASE_UI,
    DISABLE_SCHEDULER: 'true',
    NODE_ENV: 'test'
  };

  const apiProc = spawn(process.execPath, ['server.js'], { cwd: backendDir, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  apiProc.on('error', e => { apiProc.startupError = e; });
  const viteProc = spawn(process.execPath, ['--input-type=module', '-e', viteLaunchSource(UI_PORT, API_PORT)], {
    cwd: frontendDir,
    env: { ...process.env, NODE_ENV: 'test', VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  viteProc.on('error', e => { viteProc.startupError = e; });

  const createdSessionIds = [];
  let browser;
  try {
    await Promise.all([
      waitForHttp(`http://127.0.0.1:${API_PORT}/health/live`, apiProc),
      waitForHttp(`${BASE_UI}/`, viteProc)
    ]);
    console.log(`[SERVER] Owned Express (${API_PORT}) & Vite (${UI_PORT}) ready`);

    const ownerSession = await sessionService.createSession({
      userId: order.buyer_id,
      rememberMe: false,
      userAgent: 'PaidReturnBrowserGate',
      ipAddress: '127.0.0.1'
    });
    createdSessionIds.push(ownerSession.sessionId);

    const peerSession = await sessionService.createSession({
      userId: otherBuyer.id,
      rememberMe: false,
      userAgent: 'PaidReturnBrowserGate-Peer',
      ipAddress: '127.0.0.1'
    });
    createdSessionIds.push(peerSession.sessionId);

    const execPath = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : undefined;
    browser = await chromium.launch({ headless: true, executablePath: execPath });

    // 1. Owning synthetic buyer opens /payment/return?order_id=253
    const ownerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ownerCtx.addCookies([{
      name: 'miljor_refresh',
      value: ownerSession.rawRefreshToken,
      domain: '127.0.0.1',
      path: '/api/v1/auth',
      httpOnly: true,
      sameSite: 'Lax'
    }]);
    const page = await ownerCtx.newPage();
    await page.goto(`${BASE_UI}/payment/return?order_id=${ORDER_ID}`, { waitUntil: 'networkidle' });

    await page.getByText('Payment Confirmed').first().waitFor({ timeout: 15000 });
    await page.getByText('Order Payment Recorded').first().waitFor({ timeout: 10000 });
    await page.getByText(order.order_code).first().waitFor({ timeout: 10000 });
    await page.getByText('PKR 100.00').first().waitFor({ timeout: 10000 });
    await page.getByText('Payment Verified (Safepay)').first().waitFor({ timeout: 10000 });
    assert.equal(await page.getByText(/escrow custody|Secured in Escrow/i).count(), 0, 'Unsupported escrow wording must not appear');
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'paid-return-verified.png'), fullPage: true });
    console.log('[PASS CHROMIUM] Owning buyer /payment/return displays PAID, PKR 100.00, and accurate wording');

    // 2. Reload and retry/reconcile verification -> payment count must remain 1
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('Payment Confirmed').first().waitFor({ timeout: 15000 });
    await page.getByText('PKR 100.00').first().waitFor({ timeout: 10000 });

    const ownerAccessToken = jwt.sign({ id: order.buyer_id, role: 'BUYER', sid: ownerSession.sessionId }, process.env.JWT_SECRET, { expiresIn: '15m', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: 'HS256' });
    const reconRes = await fetch(`http://127.0.0.1:${API_PORT}/api/v1/orders/${ORDER_ID}/reconcile`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerAccessToken}` }
    });
    const reconBody = await reconRes.json();
    assert.equal(reconRes.status, 200);
    assert.equal(reconBody?.success, true);

    const [[afterPay]] = await db.query('SELECT COUNT(*) AS cnt FROM payments WHERE order_id = ?', [ORDER_ID]);
    assert.equal(Number(afterPay.cnt), 1, 'Payment count must remain 1 after reload and reconcile retry');
    console.log('[PASS CHROMIUM] Reload + reconcile retry preserved payment_count = 1');
    await ownerCtx.close();

    // 3. Another buyer cannot view or reconcile the order
    const peerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await peerCtx.addCookies([{
      name: 'miljor_refresh',
      value: peerSession.rawRefreshToken,
      domain: '127.0.0.1',
      path: '/api/v1/auth',
      httpOnly: true,
      sameSite: 'Lax'
    }]);
    const peerPage = await peerCtx.newPage();
    await peerPage.goto(`${BASE_UI}/payment/return?order_id=${ORDER_ID}`, { waitUntil: 'networkidle' });
    await peerPage.getByText('Verification Error').first().waitFor({ timeout: 15000 });
    assert.equal(await peerPage.getByText('Payment Confirmed').count(), 0);
    assert.equal(await peerPage.getByText(order.order_code).count(), 0);

    const peerAccessToken = jwt.sign({ id: otherBuyer.id, role: 'BUYER', sid: peerSession.sessionId }, process.env.JWT_SECRET, { expiresIn: '15m', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: 'HS256' });
    const peerReconRes = await fetch(`http://127.0.0.1:${API_PORT}/api/v1/orders/${ORDER_ID}/reconcile`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${peerAccessToken}` }
    });
    const peerRecon = peerReconRes.status;
    assert.ok([403, 404].includes(peerRecon), `Expected 403/404 for non-owner reconcile, got ${peerRecon}`);
    console.log('[PASS CHROMIUM] Non-owner buyer blocked from viewing and reconciling PAID order');
    await peerCtx.close();

    console.log('ALL PAID RETURN BROWSER CHECKS PASSED');
  } finally {
    if (browser) await browser.close().catch(() => {});
    viteProc.kill('SIGTERM');
    apiProc.kill('SIGTERM');
    if (createdSessionIds.length) {
      const ph = createdSessionIds.map(() => '?').join(',');
      await db.query(`DELETE FROM user_refresh_tokens WHERE session_id IN (${ph})`, createdSessionIds).catch(() => {});
      await db.query(`DELETE FROM user_sessions WHERE id IN (${ph})`, createdSessionIds).catch(() => {});
    }
    await db.end();
  }
}

run().catch(err => {
  console.error('[PAID RETURN BROWSER GATE FAIL]', err);
  process.exitCode = 1;
});
