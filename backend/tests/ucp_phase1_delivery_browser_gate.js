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
let db;
let deliveryRunService;
let supplierReplacementService;

const BASE_UI = process.env.P0_BROWSER_BASE_URL || 'http://127.0.0.1:3000';
const uiUrl = new URL(BASE_UI);
assert.equal(uiUrl.hostname, '127.0.0.1', 'Browser gate must use its loopback frontend');
const UI_PORT = Number(uiUrl.port || 80);
const API_PORT = Number(process.env.PHASE1_BROWSER_API_PORT || 5000);
const PASS = process.env.P0_BROWSER_TEST_PASSWORD || 'Phase1BrowserTest_2026!';

async function waitForHttp(url, child, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.startupError) throw child.startupError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Owned server exited before ${url} was ready; inspect api.log/vite.log`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) return;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function loginInBrowser(context, email, expectedRole) {
  const page = await context.newPage();
  await page.goto(`${BASE_UI}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASS);
  const respPromise = page.waitForResponse(r => r.url().includes('/api/v1/auth/login'), { timeout: 15000 });
  await page.getByRole('button', { name: /sign in/i }).click();
  const resp = await respPromise;
  if (resp.status() !== 200) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`Login failed for ${expectedRole} (${email}): ${resp.status()} ${errBody}`);
  }
  const body = await resp.json();
  assert.equal(body.data.user.role, expectedRole);
  return page;
}

async function run() {
  await assertPortsAvailable([UI_PORT, API_PORT]);
  db = require('../src/config/db');
  deliveryRunService = require('../src/services/deliveryRunService');
  supplierReplacementService = require('../src/services/supplierReplacementService');
  const expectedPort = Number(process.env.DB_PORT || 3306);
  const [[identity]] = await db.query('SELECT DATABASE() AS db, @@port AS port');
  assert.equal(identity.db, 'miljor_test_db');
  assert.equal(Number(identity.port), expectedPort);
  console.log(`[DB-GUARD] Browser gate verified DB=${identity.db} on port=${identity.port}`);

  const tag = `ph1b_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const passHash = await bcrypt.hash(PASS, 10);
  const createdIds = { users: [], addresses: [], listings: [], orders: [], runs: [], stops: [], disputes: [], quotes: [] };

  const logDir = path.resolve(__dirname, '../logs/ucp-phase1-browser');
  fs.mkdirSync(logDir, { recursive: true });
  const apiLogPath = path.join(logDir, 'api.log');
  const viteLogPath = path.join(logDir, 'vite.log');
  const gateLogPath = path.join(logDir, 'gate.log');
  fs.writeFileSync(apiLogPath, '');
  fs.writeFileSync(viteLogPath, '');
  fs.writeFileSync(gateLogPath, '');
  const logStep = (msg) => {
    console.log(msg);
    fs.appendFileSync(gateLogPath, msg + '\n');
  };
  // Persist successful steps too, so a silent terminal is never the only record.
  const originalConsoleLog = console.log;
  console.log = (...args) => {
    originalConsoleLog(...args);
    fs.appendFileSync(gateLogPath, args.map(String).join(' ') + '\n');
  };

  // Start real Express API + real Vite dev server
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
  let activePage = null;
  let activeCtx = null;
  try {
    await Promise.all([
      waitForHttp(`http://127.0.0.1:${API_PORT}/health/live`, apiProc),
      waitForHttp(`${BASE_UI}/`, viteProc)
    ]);
    if (apiProc.exitCode !== null || viteProc.exitCode !== null) throw new Error('Owned browser server exited during startup; inspect api.log/vite.log');
    logStep(`[SERVER] Owned Express (${API_PORT}) & Vite (${UI_PORT}) ready`);

    // Seed verified users, addresses, and paid orders
    let phoneSeq = 1;
    const insertUser = async (name, email, role) => {
      const phone = `+92319${String(Date.now()).slice(-6)}${phoneSeq++}`;
      const [r] = await db.query(
        `INSERT INTO users (full_name, business_name, email, phone, password_hash, role, is_verified, verification_status, buyer_trust_status, city, area, address)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'VERIFIED', 'CONTACT_VERIFIED', 'Lahore', 'Gulberg', 'Gulberg, Lahore')`,
        [name, `${name} Co`, email, phone, passHash, role]
      );
      createdIds.users.push(r.insertId);
      return { id: r.insertId, name, email, role };
    };

    const admin = await insertUser('Browser Admin', `${tag}_adm@test.local`, 'ADMIN');
    const supplier = await insertUser('Browser Supplier', `${tag}_sup@test.local`, 'SUPPLIER');
    const replSupplier = await insertUser('Browser Repl Supplier', `${tag}_sup2@test.local`, 'SUPPLIER');
    const buyer1 = await insertUser('Browser Buyer1', `${tag}_b1@test.local`, 'BUYER');
    const buyer2 = await insertUser('Browser Buyer2', `${tag}_b2@test.local`, 'BUYER');

    for (const sup of [supplier, replSupplier]) {
      await db.query(
        `INSERT INTO supplier_profiles (supplier_id, business_type, verification_status, subscription_plan, subscription_status, max_active_listings, transaction_fee_percent)
         VALUES (?, 'WHOLESALER', 'VERIFIED', 'STARTER', 'STARTER_ACTIVE', 10, 2.50)`,
        [sup.id]
      );
    }

    const [clusters] = await db.query('SELECT id FROM geographic_clusters WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
    const clusterId = clusters[0].id;

    for (const b of [buyer1, buyer2]) {
      const [ar] = await db.query(
        `INSERT INTO buyer_delivery_addresses (user_id, city, cluster_id, society_area, full_address, geographic_match_status, is_default)
         VALUES (?, 'Lahore', ?, 'Gulberg', ?, 'VERIFIED', 1)`,
        [b.id, clusterId, `${b.name} Street 1, Lahore`]
      );
      createdIds.addresses.push(ar.insertId);
    }

    const insertOrder = async (buyerId, qty) => {
      const code = `ORD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const sub = (Number(qty) * 100).toFixed(2);
      const tot = (Number(sub) + 150).toFixed(2);
      const [r] = await db.query(
        `INSERT INTO orders (
          order_code, buyer_id, supplier_id, total_qty, unit_price,
          subtotal_amount, delivery_fee, buyer_platform_fee, total_amount,
          currency, delivery_type, delivery_address, order_status, payment_status, fulfillment_status, admin_approval_status
        ) VALUES (?, ?, ?, ?, 100.00, ?, 150.00, 0.00, ?, 'PKR', 'DOORSTEP', 'Lahore Test Address', 'PAID', 'PAID', 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT', 'ADMIN_APPROVED')`,
        [code, buyerId, supplier.id, qty, sub, tot]
      );
      createdIds.orders.push(r.insertId);
      return { id: r.insertId, code };
    };

    const ord1 = await insertOrder(buyer1.id, '100.0000');
    const ord2 = await insertOrder(buyer2.id, '50.0000');

    // Group both buyers into a compatible STANDARD_CLUSTERED run
    const runRes = await deliveryRunService.formOrAssignRun({
      actor: supplier,
      orderIds: [ord1.id, ord2.id],
      clusterId,
      mode: 'STANDARD_CLUSTERED',
      deliveryDay: '2026-11-18',
      deliveryWindow: '10:00-14:00',
      cutoffAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      idempotencyKey: `${tag}-form-run`
    });
    createdIds.runs.push(runRes.run.id);
    for (const s of runRes.stops) createdIds.stops.push(s.id);

    // Launch real Chromium (works on Linux CI & Windows local cache)
    const winDefault = 'C:\\Users\\Umar Jameel\\AppData\\Local\\ms-playwright\\chromium-1194\\chrome-win\\chrome.exe';
    const executablePath = process.env.CHROME_EXECUTABLE_PATH || (process.platform === 'win32' && fs.existsSync(winDefault) ? winDefault : undefined);
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

    const supCtx = await browser.newContext();
    await supCtx.tracing.start({ screenshots: true, snapshots: true });
    activeCtx = supCtx;
    const b1Ctx = await browser.newContext();
    const b2Ctx = await browser.newContext();

    // 1. Supplier logs in, navigates to /orders, dispatches run & updates ETA in real UI
    const supPage = await loginInBrowser(supCtx, supplier.email, 'SUPPLIER');
    activePage = supPage;
    await supPage.goto(`${BASE_UI}/orders`, { waitUntil: 'networkidle' });
    await supPage.getByText(runRes.run.run_code).waitFor({ timeout: 15000 });
    await supPage.getByRole('button', { name: 'Dispatch Run' }).click();
    await supPage.getByText(`Run ${runRes.run.run_code} dispatched.`).waitFor({ timeout: 15000 });

    const newEtaIso = new Date(Date.now() + 7200 * 1000).toISOString();
    await supPage.getByPlaceholder('ETA ISO (e.g. 2026-11-18T14:00:00Z)').fill(newEtaIso);
    await supPage.getByRole('button', { name: 'Update ETA' }).click();
    await supPage.getByText(`ETA updated for ${runRes.run.run_code}.`).waitFor({ timeout: 15000 });
    console.log('[PASS CHROMIUM] Supplier manifest, dispatch & ETA update');

    // 2. Buyer 1 logs in, verifies own stop & ETA, reloads page, verifies state recovery
    const b1Page = await loginInBrowser(b1Ctx, buyer1.email, 'BUYER');
    await b1Page.goto(`${BASE_UI}/orders`, { waitUntil: 'networkidle' });
    await b1Page.getByText(ord1.code).waitFor({ timeout: 15000 });
    await b1Page.getByText('ETA:').waitFor({ timeout: 15000 });
    assert.equal(await b1Page.getByText(ord2.code).count(), 0, 'Buyer 1 must not see Buyer 2 order');
    await b1Page.reload({ waitUntil: 'networkidle' });
    await b1Page.getByText('ETA:').waitFor({ timeout: 15000 });
    console.log('[PASS CHROMIUM] Buyer 1 sees only own stop & recovers ETA after reload');

    // 3. Buyer 2 logs in, confirms full receipt (50/50)
    const b2Page = await loginInBrowser(b2Ctx, buyer2.email, 'BUYER');
    await b2Page.goto(`${BASE_UI}/orders`, { waitUntil: 'networkidle' });
    await b2Page.getByText(ord2.code).waitFor({ timeout: 15000 });
    await b2Page.getByRole('button', { name: /Confirm Full Receipt/i }).click();
    await b2Page.getByText('Full delivery receipt confirmed.').waitFor({ timeout: 15000 });
    console.log('[PASS CHROMIUM] Buyer 2 full receipt confirmed');

    // 4. Buyer 1 submits 100/80/20 partial delivery & shortage dispute in real UI
    await b1Page.getByText('Report partial delivery / shortage').click();
    await b1Page.getByLabel('Accepted', { exact: true }).fill('80');
    await b1Page.getByLabel('Missing').fill('20');
    await b1Page.getByLabel('Rejected').fill('0');
    await b1Page.getByPlaceholder('Describe shortage or damage...').fill('80 delivered, 20 missing in browser E2E');
    await b1Page.getByRole('button', { name: /Submit Partial Receipt/i }).click();
    await b1Page.getByText('Partial receipt and shortage dispute recorded.').waitFor({ timeout: 15000 });
    await b1Page.getByText(/Partial Receipt: 80\.0000 accepted/i).waitFor({ timeout: 15000 });
    console.log('[PASS CHROMIUM] Buyer 1 100/80/20 partial receipt & dispute rendered');

    // 5. Propose replacement quote for the 20 disputed units with mandatory listing & supplier acceptance, then Buyer 1 accepts in UI
    const [specs] = await db.query('SELECT id FROM product_specifications WHERE is_active = 1 AND approval_status = ? LIMIT 1', ['APPROVED']);
    assert.ok(specs.length > 0, 'Active approved product_specification required for browser replacement fixture');
    const lstCode = `LST-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const [lstRes] = await db.query(
      `INSERT INTO supplier_listings (listing_code, supplier_id, product_spec_id, base_unit_price, available_stock, delivery_zones, status)
       VALUES (?, ?, ?, 100.00, 50.00, JSON_ARRAY('Lahore'), 'ACTIVE')`,
      [lstCode, replSupplier.id, specs[0].id]
    );
    createdIds.listings.push(lstRes.insertId);

    const propRes = await supplierReplacementService.proposeReplacementQuote({
      actor: admin,
      originalOrderId: ord1.id,
      replacementSupplierId: replSupplier.id,
      replacementListingId: lstRes.insertId,
      quantity: '20.0000',
      skuMatchType: 'EXACT_SKU',
      newUnitPricePkr: '100.00',
      newDeliveryFeePkr: '0.00',
      costResponsibility: 'SUPPLIER_CARRIER_FAILURE',
      proposedEtaAt: new Date(Date.now() + 10800 * 1000).toISOString(),
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      reason: 'Browser E2E replacement quote test for 20 disputed units',
      idempotencyKey: `${tag}-browser-repl`
    });
    createdIds.quotes.push(propRes.quote.id);

    await supplierReplacementService.supplierAcceptQuote({
      actor: replSupplier,
      quoteId: propRes.quote.id,
      quoteVersion: propRes.quote.quote_version,
      quoteHash: propRes.quote.quote_hash,
      decision: 'ACCEPTED',
      idempotencyKey: `${tag}-browser-sup-acc`
    });

    await b1Page.reload({ waitUntil: 'networkidle' });
    await b1Page.getByText(propRes.quote.quote_code).waitFor({ timeout: 15000 });
    await b1Page.getByRole('button', { name: 'Accept Replacement' }).click();
    await b1Page.getByText(`Replacement quote ${propRes.quote.quote_code} accepted.`).waitFor({ timeout: 15000 });
    await b1Page.getByText('BUYER_ACCEPTED').waitFor({ timeout: 15000 });
    console.log('[PASS CHROMIUM] Replacement quote review & acceptance in real UI');

    // 6. Unauthorized Buyer 1 accessing /admin is blocked
    await b1Page.goto(`${BASE_UI}/admin`, { waitUntil: 'networkidle' });
    await b1Page.getByRole('heading', { name: 'Administrator access required' }).waitFor({ timeout: 10000 });
    console.log('[PASS CHROMIUM] Unauthorized buyer blocked from /admin');

    // Track created dispute for cleanup
    const [dspRows] = await db.query('SELECT id FROM order_disputes WHERE order_id = ?', [ord1.id]);
    for (const d of dspRows) createdIds.disputes.push(d.id);

    console.log('ALL PHASE 1 REAL CHROMIUM BROWSER JOURNEYS PASSED');
  } catch (err) {
    if (activePage) {
      await activePage.screenshot({ path: path.join(logDir, 'failure.png'), fullPage: true }).catch(() => {});
    }
    if (activeCtx) {
      await activeCtx.tracing.stop({ path: path.join(logDir, 'trace.zip') }).catch(() => {});
    }
    logStep(`[FAIL] ${err.stack || err.message}`);
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
    const stopChild = child => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) return resolve();
      child.once('close', resolve);
      child.kill('SIGTERM');
    });
    await Promise.all([stopChild(apiProc), stopChild(viteProc)]);

    try {
      if (createdIds.quotes.length) {
        await db.query(`DELETE FROM supplier_replacement_quotes WHERE id IN (${createdIds.quotes.map(() => '?').join(',')})`, createdIds.quotes);
      }
      if (createdIds.orders.length) {
        const ordPh = createdIds.orders.map(() => '?').join(',');
        await db.query(`DELETE FROM delivery_attempts WHERE order_id IN (${ordPh})`, createdIds.orders);
        await db.query(`DELETE FROM delivery_run_stops WHERE order_id IN (${ordPh})`, createdIds.orders);
        await db.query(`DELETE FROM order_fulfillment_events WHERE order_id IN (${ordPh})`, createdIds.orders);
      }
      if (createdIds.disputes.length) {
        await db.query(`DELETE FROM order_disputes WHERE id IN (${createdIds.disputes.map(() => '?').join(',')})`, createdIds.disputes);
      }
      if (createdIds.runs.length) {
        await db.query(`DELETE FROM delivery_runs WHERE id IN (${createdIds.runs.map(() => '?').join(',')})`, createdIds.runs);
      }
      if (createdIds.orders.length) {
        await db.query(`DELETE FROM orders WHERE id IN (${createdIds.orders.map(() => '?').join(',')})`, createdIds.orders);
      }
      if (createdIds.listings.length) {
        await db.query(`DELETE FROM supplier_listings WHERE id IN (${createdIds.listings.map(() => '?').join(',')})`, createdIds.listings);
      }
      if (createdIds.addresses.length) {
        await db.query(`DELETE FROM buyer_delivery_addresses WHERE id IN (${createdIds.addresses.map(() => '?').join(',')})`, createdIds.addresses);
      }
      if (createdIds.users.length) {
        const usrPh = createdIds.users.map(() => '?').join(',');
        await db.query(`DELETE FROM procurement_notifications WHERE recipient_id IN (${usrPh})`, createdIds.users);
        await db.query(`DELETE FROM idempotency_records WHERE user_id IN (${usrPh})`, createdIds.users);
        await db.query(`DELETE FROM supplier_profiles WHERE supplier_id IN (${usrPh})`, createdIds.users);
        await db.query(`DELETE FROM users WHERE id IN (${usrPh})`, createdIds.users);
      }
    } catch (cleanupErr) {
      console.error('[CLEANUP WARNING]', cleanupErr.message);
    }

    await db.end();
    db = null;
    console.log = originalConsoleLog;
  }
}

run().catch(async err => {
  console.error('[PHASE 1 BROWSER GATE FAIL]', err);
  process.exitCode = 1;
  if (db) await db.end();
});
