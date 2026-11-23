'use strict';
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'miljor_pr54_pr61_test_db';
process.env.TEST_DB_NAME = 'miljor_pr54_pr61_test_db';
process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT = 'false';
process.env.B6_TAX_POLICY_APPROVED = 'false';
process.env.TRANSACTIONAL_EMAIL_MODE = 'mock';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const app = require('../server');
const db = require('../src/config/db');

let backendServer;
let previewProc;
let backendUrl;
let frontendUrl;
const tag = crypto.randomUUID().slice(0, 8);
const ownedUsers = [];

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test.before(async () => {
  const [[identity]] = await db.query('SELECT DATABASE() AS name');
  assert.equal(identity.name, 'miljor_pr54_pr61_test_db');

  await new Promise((resolve) => {
    backendServer = app.listen(0, '127.0.0.1', () => {
      backendUrl = `http://127.0.0.1:${backendServer.address().port}`;
      resolve();
    });
  });

  const fePort = 5299;
  frontendUrl = `http://127.0.0.1:${fePort}`;
  previewProc = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', 'preview', '--host', '127.0.0.1', '--port', String(fePort), '--strictPort'],
    {
      cwd: path.resolve(__dirname, '../../frontend'),
      stdio: 'ignore',
      shell: process.platform === 'win32'
    }
  );
  await waitForHttp(frontendUrl, 15000);
});

test.after(async () => {
  if (previewProc && !previewProc.killed) {
    previewProc.kill();
  }
  if (backendServer) {
    await new Promise((resolve) => backendServer.close(resolve));
  }
  for (const uid of ownedUsers) {
    await db.query('DELETE FROM users WHERE id = ? AND email LIKE ?', [uid, `%-${tag}@example.invalid`]);
  }
  await db.end();
});

test('Section 10: Real Chromium browser E2E verifies separate UCP (/pools) and Smart Procurement Hub (/procurement) modules and backend API health', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true, channel: 'msedge' }));
  try {
    const page = await browser.newPage();
    await page.goto(frontendUrl, { waitUntil: 'networkidle' });
    const landingText = await page.textContent('body');
    assert.match(landingText, /MilJor|Mil Kar Khareedo/i);

    // Navigate to UCP Pools page (/pools)
    await page.goto(`${frontendUrl}/pools`, { waitUntil: 'networkidle' });
    assert.ok(page.url().includes('/pools'));
    const poolsText = await page.textContent('body');
    assert.match(poolsText, /Regular|Flash|Pools/i);

    // Navigate to Smart Procurement Hub (/procurement) — remains separate module
    await page.goto(`${frontendUrl}/procurement`, { waitUntil: 'networkidle' });
    assert.ok(page.url().includes('/procurement'));

    // Verify backend health and fail-closed admin order approval route
    const h = await fetch(`${backendUrl}/health`);
    assert.equal(h.status, 200);
    const r = await fetch(`${backendUrl}/api/v1/admin/orders/pending-approval`);
    assert.equal(r.status, 401);
  } finally {
    await browser.close();
  }
});
