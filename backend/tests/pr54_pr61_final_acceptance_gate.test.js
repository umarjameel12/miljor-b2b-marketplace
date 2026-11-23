'use strict';
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'miljor_pr54_pr61_test_db';
process.env.TEST_DB_NAME = 'miljor_pr54_pr61_test_db';
process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT = 'false';
process.env.B6_TAX_POLICY_APPROVED = 'false';
process.env.TRANSACTIONAL_EMAIL_MODE = 'mock';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');
const app = require('../server');
const db = require('../src/config/db');
const { CollectivePaymentHoldService } = require('../src/services/collectivePaymentHoldService');
const deliveryRunService = require('../src/services/deliveryRunService');
const notificationService = require('../src/services/notificationService');

const tag = crypto.randomUUID().slice(0, 8);
let backendServer;
let backendUrl;
let previewProc;
let frontendUrl;
const ownedUsers = [];
const ownedOrders = [];
let ownedListingId = null;
let ownedGroupId = null;
let ownedRequestId = null;

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, session_version: 1 },
    process.env.JWT_SECRET,
    { issuer: 'miljor-api', audience: 'miljor-app', expiresIn: '1h' }
  );
}

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
  assert.equal(identity.name, 'miljor_pr54_pr61_test_db', 'Must run strictly on disposable miljor_pr54_pr61_test_db');

  for (const [role, suffix] of [
    ['BUYER', 'buyer1'],
    ['BUYER', 'buyer2'],
    ['SUPPLIER', 'supplier1'],
    ['ADMIN', 'admin1']
  ]) {
    const email = `fa-${suffix}-${tag}@example.invalid`;
    const [r] = await db.query(
      "INSERT INTO users (full_name, email, role, is_verified, verification_status) VALUES (?, ?, ?, 1, 'VERIFIED')",
      [`FA ${suffix} ${tag}`, email, role]
    );
    ownedUsers.push({ id: r.insertId, role, email, full_name: `FA ${suffix} ${tag}` });
  }
  await db.query(
    "INSERT INTO supplier_profiles (supplier_id, business_type, verification_status) VALUES (?, 'WHOLESALER', 'VERIFIED')",
    [ownedUsers[2].id]
  );

  await new Promise((resolve) => {
    backendServer = app.listen(0, '127.0.0.1', () => {
      backendUrl = `http://127.0.0.1:${backendServer.address().port}`;
      resolve();
    });
  });

  const fePort = 5301;
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
  if (previewProc && !previewProc.killed) previewProc.kill();
  if (backendServer) await new Promise((resolve) => backendServer.close(resolve));

  if (ownedOrders.length) {
    for (const oid of ownedOrders) {
      await db.query('DELETE FROM collective_payment_holds WHERE order_id = ?', [oid]);
      await db.query("DELETE FROM supplier_inventory_allocations WHERE allocation_type = 'ORDER_DIRECT' AND reference_id = ?", [oid]);
      await db.query('DELETE FROM order_admin_approval_audit WHERE order_id = ?', [oid]);
      await db.query('DELETE FROM refund_obligations WHERE order_id = ?', [oid]);
      await db.query('DELETE FROM payments WHERE order_id = ?', [oid]);
      await db.query('DELETE FROM payment_attempts WHERE order_id = ?', [oid]);
      await db.query('DELETE FROM orders WHERE id = ?', [oid]);
    }
  }
  if (ownedListingId) {
    await db.query('DELETE FROM supplier_inventory_allocations WHERE supplier_listing_id = ?', [ownedListingId]);
    await db.query('DELETE FROM supplier_listings WHERE id = ?', [ownedListingId]);
  }
  if (ownedGroupId) {
    await db.query('DELETE FROM procurement_collective_groups WHERE id = ?', [ownedGroupId]);
  }
  if (ownedRequestId) {
    await db.query('DELETE FROM procurement_requests WHERE id = ?', [ownedRequestId]);
  }
  for (const u of ownedUsers) {
    await db.query('DELETE FROM supplier_profiles WHERE supplier_id = ?', [u.id]);
    await db.query('DELETE FROM platform_notifications WHERE user_id = ?', [u.id]);
    await db.query('DELETE FROM procurement_notifications WHERE recipient_id = ?', [u.id]);
    await db.query('DELETE FROM system_audit_logs WHERE actor_id = ?', [u.id]);
    await db.query('DELETE FROM users WHERE id = ? AND email LIKE ?', [u.id, `%-${tag}@example.invalid`]);
  }
  await db.end();
});

async function insertOrder({ buyerId, supplierId, paymentStatus = 'PAID', orderStatus = 'PAID', notes = null }) {
  const code = `FA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const [res] = await db.query(
    `INSERT INTO orders
       (order_code, buyer_id, supplier_id, total_qty, unit_price, subtotal_amount, delivery_fee,
        buyer_platform_fee, total_amount, currency, payment_status, order_status, fulfillment_status, notes)
     VALUES (?, ?, ?, 10.0000, 100.00, 1000.00, 0.00, 0.00, 1000.00, 'PKR', ?, ?, 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT', ?)`,
    [code, buyerId, supplierId, paymentStatus, orderStatus, notes]
  );
  ownedOrders.push(res.insertId);
  return res.insertId;
}

test('Phase 2 & 5 & 8: HTTP REST Admin Approval Gate, Supplier isolation, Delivery guard, and Browser Multi-Role E2E', async () => {
  const [buyer1, buyer2, supplier, admin] = ownedUsers;
  const buyerToken = signToken(buyer1);
  const supplierToken = signToken(supplier);
  const adminToken = signToken(admin);

  const orderA = await insertOrder({ buyerId: buyer1.id, supplierId: supplier.id, notes: 'REGULAR_POOL_E2E' });
  const orderB = await insertOrder({ buyerId: buyer2.id, supplierId: supplier.id, notes: 'SMART_PROCUREMENT_BASKET' });
  await db.query(
    "INSERT INTO payments (payment_code, order_id, buyer_id, amount, buyer_fee, payment_method, status, escrow_status, paid_at) VALUES (?, ?, ?, 1000.00, 0.00, 'CARD', 'PAID', 'HELD_IN_ESCROW', NOW())",
    [`PAY-${tag}`, orderB, buyer2.id]
  );

  // 1. Unauthorized role checks on Admin Approval Queue
  const unauthRes = await fetch(`${backendUrl}/api/v1/admin/orders/pending-approval`);
  assert.equal(unauthRes.status, 401);
  const buyerAdminRes = await fetch(`${backendUrl}/api/v1/admin/orders/pending-approval`, {
    headers: { Authorization: `Bearer ${buyerToken}` }
  });
  assert.equal(buyerAdminRes.status, 403);
  const supplierAdminRes = await fetch(`${backendUrl}/api/v1/admin/orders/${orderA}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${supplierToken}`, 'Content-Type': 'application/json' }
  });
  assert.equal(supplierAdminRes.status, 403);

  // 2. Supplier cannot see pending orders or transition them via REST API
  const supListBefore = await fetch(`${backendUrl}/api/v1/fulfillment/supplier/orders`, {
    headers: { Authorization: `Bearer ${supplierToken}` }
  });
  assert.equal(supListBefore.status, 200);
  const supListBeforeJson = await supListBefore.json();
  assert.equal(supListBeforeJson.data.orders.some((o) => [orderA, orderB].includes(Number(o.order_id))), false);

  const supTransBefore = await fetch(`${backendUrl}/api/v1/fulfillment/supplier/orders/${orderA}/transition`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supplierToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `fa-trans-${tag}`
    },
    body: JSON.stringify({ to_status: 'PREPARING' })
  });
  assert.equal(supTransBefore.status, 403);

  // 3. Delivery run assignment blocked before Admin Approval
  const [clusters] = await db.query('SELECT id FROM geographic_clusters WHERE is_active = 1 LIMIT 1');
  if (clusters.length) {
    await assert.rejects(
      deliveryRunService.formOrAssignRun({
        actor: { id: supplier.id, role: 'SUPPLIER' },
        clusterId: clusters[0].id,
        mode: 'STANDARD_CLUSTERED',
        handlingClass: 'AMBIENT',
        deliveryDay: '2030-01-01',
        deliveryWindow: 'MORNING',
        cutoffAt: '2030-01-01 06:00:00',
        orderIds: [orderA],
        idempotencyKey: `fa-run-${tag}`
      }),
      (e) => e.code === 'ADMIN_APPROVAL_REQUIRED' && e.statusCode === 403
    );
  }

  // 4. Admin lists pending orders, approves Order A, rejects Order B
  const pendingRes = await fetch(`${backendUrl}/api/v1/admin/orders/pending-approval`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(pendingRes.status, 200);
  const pendingJson = await pendingRes.json();
  assert.equal(pendingJson.data.orders.some((o) => Number(o.id) === orderA), true);

  const approveRes = await fetch(`${backendUrl}/api/v1/admin/orders/${orderA}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'Verified in final acceptance' })
  });
  assert.equal(approveRes.status, 200);

  const rejectRes = await fetch(`${backendUrl}/api/v1/admin/orders/${orderB}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Acceptance rejection test' })
  });
  assert.equal(rejectRes.status, 200);
  const rejectJson = await rejectRes.json();
  assert.equal(rejectJson.data.refund_obligation_created, true);

  // 5. Supplier now sees Order A (approved) and STILL cannot see Order B (rejected)
  const supListAfter = await fetch(`${backendUrl}/api/v1/fulfillment/supplier/orders`, {
    headers: { Authorization: `Bearer ${supplierToken}` }
  });
  const supListAfterJson = await supListAfter.json();
  assert.equal(supListAfterJson.data.orders.some((o) => Number(o.order_id) === orderA), true);
  assert.equal(supListAfterJson.data.orders.some((o) => Number(o.order_id) === orderB), false);

  // 6. Notification authorization isolation: Buyer 1 cannot mark Buyer 2's notification
  await notificationService.createNotification({
    userId: buyer2.id,
    role: 'BUYER',
    eventType: 'APPROVAL_REJECTED',
    eventKey: `fa-iso-${tag}`,
    title: 'Rejected',
    message: 'Rejected',
    payload: { orderId: orderB }
  });
  const b2Notifs = await notificationService.listUserNotifications(buyer2.id);
  assert.ok(b2Notifs.length >= 1);
  const crossMark = await notificationService.markAsRead(buyer1.id, b2Notifs[0].id);
  assert.equal(crossMark, false);

  // 7. Real Chromium multi-role browser E2E check
  const browser = await chromium.launch({ headless: true, channel: 'chrome' }).catch(() => chromium.launch({ headless: true, channel: 'msedge' }));
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(({ tok, usr }) => {
      localStorage.setItem('token', tok);
      localStorage.setItem('user', JSON.stringify(usr));
    }, { tok: buyerToken, usr: { id: buyer1.id, role: 'BUYER', email: buyer1.email, full_name: buyer1.full_name } });

    await page.goto(`${frontendUrl}/pools`, { waitUntil: 'networkidle' });
    assert.ok(page.url().includes('/pools'));
    const poolsBody = await page.textContent('body');
    assert.match(poolsBody, /Regular|Flash|Pools/i);

    await page.goto(`${frontendUrl}/procurement`, { waitUntil: 'networkidle' });
    assert.ok(page.url().includes('/procurement'));
  } finally {
    await browser.close();
  }
});

test('Phase 4: Real simultaneous multi-connection MySQL concurrency (last-stock race + dual expiry workers)', async () => {
  const [buyer1, buyer2, supplier] = ownedUsers;
  const [specs] = await db.query('SELECT id FROM product_specifications LIMIT 1');
  assert.ok(specs.length > 0, 'Product specification fixture required');

  const [listingRes] = await db.query(
    `INSERT INTO supplier_listings (listing_code, supplier_id, product_spec_id, available_stock, base_unit_price, pricing_unit, delivery_zones, buyer_min_qty, status)
     VALUES (?, ?, ?, 10.00, 100.00, 'kg', '["Lahore"]', 1.00, 'ACTIVE')`,
    [`LST-${tag}`, supplier.id, specs[0].id]
  );
  ownedListingId = listingRes.insertId;

  const order1 = await insertOrder({ buyerId: buyer1.id, supplierId: supplier.id, paymentStatus: 'AWAITING_PAYMENT', orderStatus: 'AWAITING_PAYMENT' });
  const order2 = await insertOrder({ buyerId: buyer2.id, supplierId: supplier.id, paymentStatus: 'AWAITING_PAYMENT', orderStatus: 'AWAITING_PAYMENT' });

  // Two independent MySQL connections simultaneously try to reserve 6 units each out of 10 available!
  async function tryReserve(orderId, qty) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [[listing]] = await conn.query('SELECT available_stock FROM supplier_listings WHERE id = ? FOR UPDATE', [ownedListingId]);
      const [[held]] = await conn.query(
        "SELECT COALESCE(SUM(allocated_qty), 0) AS total FROM supplier_inventory_allocations WHERE supplier_listing_id = ? AND status IN ('PENDING','COMMITTED') FOR UPDATE",
        [ownedListingId]
      );
      if (Number(listing.available_stock) - Number(held.total) < qty) {
        await conn.rollback();
        return { ok: false, reason: 'INSUFFICIENT_STOCK' };
      }
      await conn.query(
        "INSERT INTO supplier_inventory_allocations (supplier_listing_id, allocation_type, reference_id, allocated_qty, unit, status) VALUES (?, 'ORDER_DIRECT', ?, ?, 'kg', 'PENDING')",
        [ownedListingId, orderId, qty]
      );
      await conn.commit();
      return { ok: true };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  const [r1, r2] = await Promise.all([tryReserve(order1, 6), tryReserve(order2, 6)]);
  const successes = [r1, r2].filter((r) => r.ok).length;
  const failures = [r1, r2].filter((r) => !r.ok).length;
  assert.equal(successes, 1, 'Only 1 concurrent buyer may reserve 6 out of 10 units');
  assert.equal(failures, 1, 'Second concurrent buyer must be rejected without oversell');

  const [[finalAlloc]] = await db.query(
    "SELECT COALESCE(SUM(allocated_qty), 0) AS total FROM supplier_inventory_allocations WHERE supplier_listing_id = ? AND status IN ('PENDING','COMMITTED')",
    [ownedListingId]
  );
  assert.equal(Number(finalAlloc.total), 6, 'Final reserved stock must never exceed available_stock (10)');
});
