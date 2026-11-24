'use strict';

process.env.NODE_ENV = 'test';
if (!process.env.DB_NAME) process.env.DB_NAME = 'miljor_pr54_pr61_test_db';
if (!process.env.TEST_DB_NAME) process.env.TEST_DB_NAME = process.env.DB_NAME;
process.env.SAFEPAY_ENV = 'sandbox';
process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT = 'false';
process.env.TRANSACTIONAL_EMAIL_MODE = 'mock';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const googleAuthService = require('../src/services/googleAuthService');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  chromium = null;
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

test('Custom Google Auth: Backend Security, Onboarding, Linking, Regression & Browser UI', async () => {
  assert.ok(/miljor_pr54_pr61_test_db|miljor_test_db/.test(process.env.DB_NAME), `Refusing non-test DB ${process.env.DB_NAME}`);

  const backendServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => backendServer.once('listening', resolve));
  const backendPort = backendServer.address().port;
  const apiBase = `http://127.0.0.1:${backendPort}/api/v1`;

  const suffix = Date.now();
  const createdUserIds = [];
  const origVerify = googleAuthService.verifyIdToken.bind(googleAuthService);

  googleAuthService.verifyIdToken = async (idToken) => {
    if (idToken === 'invalid_sig') {
      const err = new Error('Invalid Google token signature');
      err.code = 'INVALID_SIGNATURE'; err.statusCode = 401; throw err;
    }
    if (idToken === 'expired_tok') {
      const err = new Error('Google token has expired');
      err.code = 'TOKEN_EXPIRED'; err.statusCode = 401; throw err;
    }
    if (idToken === 'wrong_aud') {
      const err = new Error('Token audience mismatch');
      err.code = 'AUDIENCE_MISMATCH'; err.statusCode = 401; throw err;
    }
    if (idToken === 'wrong_iss') {
      const err = new Error('Token issuer mismatch');
      err.code = 'ISSUER_MISMATCH'; err.statusCode = 401; throw err;
    }
    if (idToken === 'unverified_email') {
      return { sub: `sub_unv_${suffix}`, email: `unv_${suffix}@gmail.com`, email_verified: false, name: 'Unverified' };
    }
    if (idToken.startsWith('valid:')) {
      const [, sub, email, name] = idToken.split(':');
      return { sub, email, email_verified: true, name: name || 'Google Test User' };
    }
    return origVerify(idToken);
  };

  try {
    const [clusters] = await db.query('SELECT id FROM geographic_clusters WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
    const clusterId = clusters[0].id;

    // 1. Public Google config endpoint
    const cfgRes = await fetch(`${apiBase}/auth/google/config`);
    assert.equal(cfgRes.status, 200);
    const cfgJson = await cfgRes.json();
    assert.equal(cfgJson.success, true);

    // 2. Invalid, expired, wrong-audience, wrong-issuer, and unverified-email tokens fail closed
    for (const [tok, expectedStatus] of [['invalid_sig', 401], ['expired_tok', 401], ['wrong_aud', 401], ['wrong_iss', 401], ['unverified_email', 403]]) {
      const r = await fetch(`${apiBase}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: tok, mode: 'login' })
      });
      assert.equal(r.status, expectedStatus, `Expected ${expectedStatus} for ${tok}`);
    }

    // 3. Unregistered Google user in mode=login returns 404 ACCOUNT_NOT_REGISTERED (no incomplete account created)
    const unregSub = `sub_unreg_${suffix}`;
    const unregEmail = `unreg_${suffix}@gmail.com`;
    const unregRes = await fetch(`${apiBase}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: `valid:${unregSub}:${unregEmail}:NewUser`, mode: 'login' })
    });
    assert.equal(unregRes.status, 404);
    const unregJson = await unregRes.json();
    assert.equal(unregJson.error.code, 'ACCOUNT_NOT_REGISTERED');
    const [shouldNotExist] = await db.query('SELECT id FROM users WHERE email = ?', [unregEmail]);
    assert.equal(shouldNotExist.length, 0);

    // 4. Role privilege escalation blocked
    const adminEscRes = await fetch(`${apiBase}/auth/google/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: `valid:sub_esc_${suffix}:esc_${suffix}@gmail.com:Esc`,
        role: 'ADMIN',
        business_name: 'Bad Co',
        full_name: 'Esc',
        phone: `0300${String(suffix).slice(-7)}`,
        base_cluster_id: clusterId
      })
    });
    assert.equal(adminEscRes.status, 422);

    // 5. New Buyer registration (address optional)
    const buyerSub = `sub_buyer_${suffix}`;
    const buyerEmail = `gbuyer_${suffix}@gmail.com`;
    const buyerPhone = `0311${String(suffix).slice(-7)}`;
    const buyerRegRes = await fetch(`${apiBase}/auth/google/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: `valid:${buyerSub}:${buyerEmail}:Google Buyer`,
        role: 'BUYER',
        business_name: 'Lahore Fresh Kitchen',
        full_name: 'Google Buyer',
        phone: buyerPhone,
        city: 'Lahore',
        base_cluster_id: clusterId
      })
    });
    assert.equal(buyerRegRes.status, 201);
    const buyerRegJson = await buyerRegRes.json();
    assert.equal(buyerRegJson.data.user.role, 'BUYER');
    assert.ok(buyerRegJson.data.token);
    createdUserIds.push(buyerRegJson.data.user.id);

    // 6. Returning Buyer Google Sign-In + Session Refresh + Logout + Zero Duplicates
    const buyerLoginRes = await fetch(`${apiBase}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: `valid:${buyerSub}:${buyerEmail}:Google Buyer`, mode: 'login' })
    });
    assert.equal(buyerLoginRes.status, 200);
    const buyerLoginJson = await buyerLoginRes.json();
    assert.equal(buyerLoginJson.data.user.id, buyerRegJson.data.user.id);
    const [[buyerCountRow]] = await db.query('SELECT COUNT(*) AS cnt FROM users WHERE google_id = ?', [buyerSub]);
    assert.equal(Number(buyerCountRow.cnt), 1);

    const setCookieHeader = buyerLoginRes.headers.get('set-cookie') || '';
    const refreshMatch = setCookieHeader.match(/miljor_refresh=([^;]+)/);
    assert.ok(refreshMatch, 'Expected miljor_refresh HttpOnly cookie on Google login');
    const refreshRes = await fetch(`${apiBase}/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `miljor_refresh=${refreshMatch[1]}` }
    });
    assert.equal(refreshRes.status, 200);
    const refreshJson = await refreshRes.json();
    assert.ok(refreshJson.data?.token);

    const logoutRes = await fetch(`${apiBase}/auth/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${refreshJson.data.token}`,
        Cookie: `miljor_refresh=${refreshMatch[1]}`
      }
    });
    assert.equal(logoutRes.status, 200);

    // 7. New Supplier registration requires cluster + area + address & stays pending admin approval
    const suppSub = `sub_supp_${suffix}`;
    const suppEmail = `gsupp_${suffix}@gmail.com`;
    const suppPhone = `0322${String(suffix).slice(-7)}`;
    const badSuppRes = await fetch(`${apiBase}/auth/google/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: `valid:${suppSub}:${suppEmail}:Google Supplier`,
        role: 'SUPPLIER',
        business_name: 'Ravi Flour Mills',
        full_name: 'Google Supplier',
        phone: suppPhone,
        base_cluster_id: clusterId
      })
    });
    assert.equal(badSuppRes.status, 422);

    const suppRegRes = await fetch(`${apiBase}/auth/google/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: `valid:${suppSub}:${suppEmail}:Google Supplier`,
        role: 'SUPPLIER',
        business_name: 'Ravi Flour Mills',
        full_name: 'Google Supplier',
        phone: suppPhone,
        base_cluster_id: clusterId,
        society_area: 'Badami Bagh',
        address: 'Plot 9, Grain Market, Lahore'
      })
    });
    assert.equal(suppRegRes.status, 201);
    const suppRegJson = await suppRegRes.json();
    assert.equal(suppRegJson.data.user.role, 'SUPPLIER');
    assert.equal(suppRegJson.data.user.is_verified, false);
    createdUserIds.push(suppRegJson.data.user.id);
    const [[suppProfile]] = await db.query('SELECT verification_status FROM supplier_profiles WHERE supplier_id = ?', [suppRegJson.data.user.id]);
    assert.equal(suppProfile.verification_status, 'NOT_SUBMITTED');

    // 7b. Returning Supplier Sign-In preserves SUPPLIER role & pending approval restriction
    const suppLoginRes = await fetch(`${apiBase}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: `valid:${suppSub}:${suppEmail}:Google Supplier`, mode: 'login' })
    });
    assert.equal(suppLoginRes.status, 200);
    const suppLoginJson = await suppLoginRes.json();
    assert.equal(suppLoginJson.data.user.role, 'SUPPLIER');
    assert.equal(suppLoginJson.data.user.is_verified, false);

    const blockedListingRes = await fetch(`${apiBase}/listings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${suppLoginJson.data.token}`
      },
      body: JSON.stringify({ product_spec_id: 1, price_per_unit: 1000, available_qty: 10 })
    });
    assert.equal(blockedListingRes.status, 403);

    // 8. Duplicate email protection, unauthorized linking rejection & explicit linking
    const unauthLinkRes = await fetch(`${apiBase}/auth/google/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: `valid:sub_unauth_${suffix}:unauth_${suffix}@gmail.com:NoAuth` })
    });
    assert.equal(unauthLinkRes.status, 401);

    const pwEmail = `pwuser_${suffix}@miljor.test`;
    const pwHash = await bcrypt.hash('Password123!', 4);
    const [pwIns] = await db.query(
      `INSERT INTO users (full_name, business_name, email, password_hash, role, city, base_cluster_id, is_verified, verification_status)
       VALUES ('Local User', 'Local Biz', ?, ?, 'BUYER', 'Lahore', ?, 1, 'VERIFIED')`,
      [pwEmail, pwHash, clusterId]
    );
    const pwUserId = pwIns.insertId;
    createdUserIds.push(pwUserId);

    const pwLoginRes = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: pwEmail, password: 'Password123!' })
    });
    assert.equal(pwLoginRes.status, 200);
    const pwLoginJson = await pwLoginRes.json();
    const pwToken = pwLoginJson.data.token;

    const collisionRes = await fetch(`${apiBase}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: `valid:sub_link_${suffix}:${pwEmail}:Local User`, mode: 'login' })
    });
    assert.equal(collisionRes.status, 409);
    const collisionJson = await collisionRes.json();
    assert.equal(collisionJson.error.code, 'ACCOUNT_LINKING_REQUIRED');

    const dupRegRes = await fetch(`${apiBase}/auth/google/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: `valid:sub_link_${suffix}:${pwEmail}:Local User`,
        role: 'BUYER',
        business_name: 'Dup Biz',
        full_name: 'Local User',
        phone: `0333${String(suffix).slice(-7)}`,
        base_cluster_id: clusterId
      })
    });
    assert.equal(dupRegRes.status, 409);

    const linkRes = await fetch(`${apiBase}/auth/google/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pwToken}` },
      body: JSON.stringify({ credential: `valid:sub_link_${suffix}:${pwEmail}:Local User` })
    });
    assert.equal(linkRes.status, 200);

    // 8b. Normal password registration + OTP requirement regression check
    const normalEmail = `normal_${suffix}@miljor.test`;
    const normalRegRes = await fetch(`${apiBase}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Normal Buyer',
        business_name: 'Normal Kitchen',
        email: normalEmail,
        phone: `0344${String(suffix).slice(-7)}`,
        password: 'Password123!',
        role: 'BUYER',
        city: 'Lahore',
        base_cluster_id: clusterId
      })
    });
    assert.equal(normalRegRes.status, 201);
    const normalRegJson = await normalRegRes.json();
    assert.equal(normalRegJson.requires_verification, true);
    createdUserIds.push(normalRegJson.data.user.id);

    // 9. Playwright Chromium UI verification on /login and /register (desktop + mobile)
    if (chromium) {
      const frontendDir = path.resolve(__dirname, '../../frontend');
      const frontendPort = 4189 + Math.floor(Math.random() * 500);
      const viteProc = spawn(`npm run dev -- --host 127.0.0.1 --port ${frontendPort} --strictPort`, {
        cwd: frontendDir,
        env: { ...process.env, VITE_API_PROXY_TARGET: `http://127.0.0.1:${backendPort}` },
        shell: true,
        stdio: 'ignore'
      });
      const baseUrl = `http://127.0.0.1:${frontendPort}`;
      let browser;
      try {
        await waitForHttp(`${baseUrl}/login`);
        browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true, channel: 'msedge' }));

        for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
          const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
          const page = await ctx.newPage();
          const errs = [];
          page.on('pageerror', (e) => errs.push(e.message));

          await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
          await page.waitForSelector('button:has-text("Continue with Google")');
          await page.waitForSelector('text=OR');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `Overflow on /login ${vp.name}`);

          await page.goto(`${baseUrl}/register`, { waitUntil: 'networkidle' });
          await page.waitForSelector('button:has-text("Sign up with Google")');
          await page.waitForSelector('text=OR');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `Overflow on /register ${vp.name}`);

          await page.click('[data-testid="google-auth-wrapper"]');
          await page.waitForSelector('text=Business name is required.');
          assert.equal(errs.length, 0, `Page errors on ${vp.name}: ${errs.join('; ')}`);
          await ctx.close();
        }
      } finally {
        if (browser) await browser.close();
        try { process.kill(viteProc.pid); } catch {}
      }
    }
  } finally {
    googleAuthService.verifyIdToken = origVerify;
    for (const uid of createdUserIds) {
      await db.query('DELETE FROM supplier_delivery_configurations WHERE supplier_id = ?', [uid]).catch(() => {});
      await db.query('DELETE FROM supplier_profiles WHERE supplier_id = ?', [uid]).catch(() => {});
      await db.query('DELETE FROM buyer_delivery_addresses WHERE user_id = ?', [uid]).catch(() => {});
      await db.query('DELETE FROM user_refresh_tokens WHERE user_id = ?', [uid]).catch(() => {});
      await db.query('DELETE FROM system_audit_logs WHERE actor_id = ? OR entity_id = ?', [uid, uid]).catch(() => {});
      await db.query('DELETE FROM users WHERE id = ?', [uid]).catch(() => {});
    }
    await new Promise((resolve) => backendServer.close(resolve));
  }
});
