'use strict';

process.env.NODE_ENV = 'test';
if (!process.env.DB_NAME) process.env.DB_NAME = 'miljor_pr54_pr61_test_db';
if (!process.env.TEST_DB_NAME) process.env.TEST_DB_NAME = process.env.DB_NAME;
process.env.SAFEPAY_ENV = 'sandbox';
process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT = 'false';
process.env.B6_TAX_POLICY_APPROVED = 'false';
process.env.TRANSACTIONAL_EMAIL_MODE = 'mock';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  chromium = null;
}

async function loginInContext(page, baseUrl, email, password) {
  const res = await page.request.post(`${baseUrl}/api/v1/auth/login`, {
    data: { identifier: email, password }
  });
  assert.equal(res.status(), 200, `Login failed for ${email}: ${await res.text()}`);
}

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test('PR #64 Demo Readiness: Responsive Viewports, Themes, Admin Order Approval UI, Supplier Mobile Nav & Subscription Pricing', async (t) => {
  if (!chromium) {
    t.skip('Playwright chromium not installed');
    return;
  }
  assert.ok(/miljor_pr54_pr61_test_db/.test(process.env.DB_NAME), `Refusing non-disposable DB ${process.env.DB_NAME}`);

  const backendServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => backendServer.once('listening', resolve));
  const backendPort = backendServer.address().port;

  // Start lightweight static + proxy server over frontend/dist so zero vite process lingers
  const fs = require('node:fs');
  const distDir = path.join(__dirname, '../../frontend/dist');
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.json': 'application/json'
  };

  const feServer = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      const proxyReq = http.request(
        { host: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: req.headers },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );
      proxyReq.on('error', () => { res.statusCode = 502; res.end('Bad Gateway'); });
      req.pipe(proxyReq);
      return;
    }
    const cleanPath = req.url.split('?')[0];
    let filePath = path.join(distDir, cleanPath === '/' ? 'index.html' : cleanPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
    }
    const ext = path.extname(filePath);
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((resolve) => feServer.listen(0, '127.0.0.1', resolve));
  const fePort = feServer.address().port;
  const baseUrl = `http://127.0.0.1:${fePort}`;
  await waitForHttp(baseUrl);

  const suffix = Date.now();
  let buyerId;
  let supplierId;
  let adminId;
  let orderId;
  let browser;

  try {
    const testPassword = 'DemoAuditPass123!';
    const passwordHash = await bcrypt.hash(testPassword, 4);
    const [bRes] = await db.query(
      `INSERT INTO users (full_name, business_name, email, password_hash, role, city, is_verified, verification_status)
       VALUES (?, ?, ?, ?, 'BUYER', 'Lahore', 1, 'VERIFIED')`,
      [`Demo Audit Buyer ${suffix}`, `Demo Buyer Kitchen ${suffix}`, `pr64_buyer_${suffix}@miljor.test`, passwordHash]
    );
    buyerId = bRes.insertId;

    const [sRes] = await db.query(
      `INSERT INTO users (full_name, business_name, email, password_hash, role, city, is_verified, verification_status)
       VALUES (?, ?, ?, ?, 'SUPPLIER', 'Lahore', 1, 'VERIFIED')`,
      [`Demo Audit Supplier ${suffix}`, `Demo Mill ${suffix}`, `pr64_supp_${suffix}@miljor.test`, passwordHash]
    );
    supplierId = sRes.insertId;
    await db.query(
      `INSERT INTO supplier_profiles (supplier_id, verification_status, subscription_plan, subscription_status, max_active_listings)
       VALUES (?, 'VERIFIED', 'STARTER', 'STARTER_ACTIVE', 4)`,
      [supplierId]
    );

    const [aRes] = await db.query(
      `INSERT INTO users (full_name, business_name, email, password_hash, role, city, is_verified, verification_status)
       VALUES (?, 'MilJor Demo Admin', ?, ?, 'SUPER_ADMIN', 'Lahore', 1, 'VERIFIED')`,
      [`Demo Audit Admin ${suffix}`, `pr64_admin_${suffix}@miljor.test`, passwordHash]
    );
    adminId = aRes.insertId;

    const orderCode = `ORD-${String(suffix).slice(-10)}`;
    const [oRes] = await db.query(
      `INSERT INTO orders (order_code, buyer_id, supplier_id, total_qty, unit_price, subtotal_amount, total_amount, currency, order_status, payment_status, admin_approval_status)
       VALUES (?, ?, ?, 10, 2999.00, 29990.00, 29990.00, 'PKR', 'PAID', 'PAID', 'PENDING_ADMIN_APPROVAL')`,
      [orderCode, buyerId, supplierId]
    );
    orderId = oRes.insertId;

    browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true, channel: 'msedge' }));

    // 1. Responsive check across Desktop (1440x900), Tablet (768x1024), Mobile (390x844), Small Mobile (360x800)
    const viewports = [
      { name: 'desktop-1440', width: 1440, height: 900 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'mobile-390', width: 390, height: 844 },
      { name: 'mobile-360', width: 360, height: 800 }
    ];
    for (const vp of viewports) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      for (const route of ['/', '/pools', '/login', '/register']) {
        await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(350);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        assert.equal(overflow, false, `Horizontal overflow detected on ${route} at ${vp.name}`);
      }
      assert.equal(pageErrors.length, 0, `Uncaught page errors at ${vp.name}: ${pageErrors.join('; ')}`);
      await ctx.close();
    }

    // 2. Buyer /orders shows "Pending Admin Approval" badge
    const buyerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const buyerPage = await buyerCtx.newPage();
    await loginInContext(buyerPage, baseUrl, `pr64_buyer_${suffix}@miljor.test`, testPassword);
    await buyerPage.goto(`${baseUrl}/orders`, { waitUntil: 'networkidle' });
    await buyerPage.waitForSelector(`text=${orderCode}`);
    await buyerPage.waitForSelector('text=Pending Admin Approval');
    await buyerCtx.close();

    // 3. Admin /admin sees Order in AdminOrderApprovalPanel and approves it in real Chromium UI
    const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const adminPage = await adminCtx.newPage();
    await loginInContext(adminPage, baseUrl, `pr64_admin_${suffix}@miljor.test`, testPassword);
    await adminPage.goto(`${baseUrl}/admin`, { waitUntil: 'networkidle' });
    await adminPage.waitForSelector('text=Mandatory order approval gate');
    await adminPage.waitForSelector(`text=${orderCode}`);
    await adminPage.click('button:has-text("Approve for Supplier Fulfillment")');
    await adminPage.waitForSelector(`text=Order #${orderId} approved for supplier fulfillment.`);
    await adminCtx.close();

    const [[approvedRow]] = await db.query('SELECT admin_approval_status FROM orders WHERE id = ?', [orderId]);
    assert.equal(approvedRow.admin_approval_status, 'ADMIN_APPROVED');

    // 4. Supplier /supplier/subscription & mobile bottom nav at 390x844
    const suppCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const suppPage = await suppCtx.newPage();
    await loginInContext(suppPage, baseUrl, `pr64_supp_${suffix}@miljor.test`, testPassword);
    await suppPage.goto(`${baseUrl}/supplier/subscription`, { waitUntil: 'networkidle' });
    await suppPage.waitForSelector('text=PKR 2,999');
    await suppPage.waitForSelector('text=PKR 5,499');
    await suppPage.waitForSelector('text=Transaction Fee (separate)');
    const suppOverflow = await suppPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(suppOverflow, false, 'Horizontal overflow on /supplier/subscription at 390x844');
    const hasSupplierMobileLink = await suppPage.evaluate(() => Boolean(document.querySelector('nav a[href="/supplier/dashboard"]')));
    assert.equal(hasSupplierMobileLink, true, 'Mobile bottom nav should link to /supplier/dashboard for suppliers');
    await suppCtx.close();
  } finally {
    if (browser) await browser.close();
    feServer.close();
    backendServer.close();
    if (orderId) {
      await db.query('DELETE FROM order_admin_approval_audit WHERE order_id = ?', [orderId]).catch(() => {});
      await db.query('DELETE FROM orders WHERE id = ?', [orderId]).catch(() => {});
    }
    if (supplierId) await db.query('DELETE FROM supplier_profiles WHERE supplier_id = ?', [supplierId]).catch(() => {});
    if (buyerId || supplierId || adminId) {
      await db.query('DELETE FROM users WHERE id IN (?, ?, ?)', [buyerId || 0, supplierId || 0, adminId || 0]).catch(() => {});
    }
    await db.end();
  }
});
