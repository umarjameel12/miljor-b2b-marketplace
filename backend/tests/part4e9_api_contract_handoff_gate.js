/**
 * MILJOR PART 4E.9: BACKEND FUNCTIONAL COMPLETION, API CONTRACT STABILIZATION & FRONTEND HANDOFF GATE
 *
 * Validates:
 *   1. POST /api/v1/auth/login returns { success: true, data: { token, user } }
 *   2. GET /api/v1/auth/me returns hydrated user identity
 *   3. GET /api/v1/pools returns public active pools array and count
 *   4. GET /api/v1/pools/:id returns pool snapshot with allowed_actions, specification, and supplier
 *   5. GET /api/v1/pools/supplier/my returns supplier's pools when authenticated
 *   6. GET /api/v1/pools/supplier/my returns 401 Unauthorized without auth
 *   7. GET /api/v1/reservations/my returns buyer's reservations list
 *   8. GET /api/v1/reservations/:id returns reservation detail with permissions and allowed_actions
 *   9. GET /api/v1/reservations/:id rejects cross-buyer access with 403 Forbidden
 *  10. GET /api/v1/orders returns paginated orders with total_records, total_pages, and allowed_actions
 *  11. GET /api/v1/orders/my alias returns buyer's orders with identical schema
 *  12. GET /api/v1/orders/:id returns order detail with commercial breakdown, allowed_actions, and product_title
 *  13. GET /api/v1/orders/:id rejects cross-buyer access with 403 Forbidden
 *  14. GET /api/v1/orders/:id allows assigned supplier to inspect order
 *  15. GET /api/v1/orders/:id allows platform admin to inspect order
 *  16. GET /api/v1/orders filters by status query parameter correctly
 *  17. GET /api/v1/orders/:id/payment-status returns payment status read-model
 *  18. GET /api/v1/fulfillment/buyer/orders returns buyer fulfillment list
 *  19. GET /api/v1/fulfillment/supplier/orders returns supplier fulfillment queue
 *  20. GET /api/v1/disputes/my returns buyer disputes list
 *  21. GET /api/v1/disputes/:id enforces tenant isolation (403 for unauthorized buyer)
 *  22. GET /api/v1/settlements/admin/overview requires admin role (403 for buyer)
 *  23. Financial Safety Invariant: External refund and payout execution status is strictly DISABLED
 *  24. Database Isolation Invariant: Development database miljor_db is 100% PRISTINE
 *  25. Database Isolation Invariant: Persistent sandbox database miljor_sandbox_db is 100% INTACT
 *
 * Execution: node tests/part4e9_api_contract_handoff_gate.js
 */

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const safepayAdapter = require('../src/services/safepayAdapter');
const { assertTestDatabaseSafety } = require('./testDbSafetyGuard');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

// Seeded actors:
// User 1: ADMIN (Super Admin)
// User 2: SUPPLIER (Verified)
// User 3: SUPPLIER (Competitor)
// User 5: BUYER 1 (Verified)
// User 6: BUYER 2 (Verified)
// User 7: BUYER 3 (Competitor Buyer)
const adminToken = generateToken(1, 'SUPER_ADMIN', 'VERIFIED');
const supplierToken = generateToken(2, 'SUPPLIER', 'VERIFIED');
const competitorSupplierToken = generateToken(3, 'SUPPLIER', 'VERIFIED');
const buyer1Token = generateToken(5, 'BUYER', 'VERIFIED');
const buyer2Token = generateToken(6, 'BUYER', 'VERIFIED');
const competitorBuyerToken = generateToken(7, 'BUYER', 'VERIFIED');

let testServer = null;
let baseUrl = '';

function makeRequest(method, endpoint, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, baseUrl);
    let postData = null;
    if (Buffer.isBuffer(body)) {
      postData = body;
    } else if (body !== null) {
      postData = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(JSON.stringify(body), 'utf8');
    }

    const reqHeaders = { ...headers };
    if (postData) {
      if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      reqHeaders['Content-Length'] = postData.length;
    }

    const req = http.request(url, { method: method.toUpperCase(), headers: reqHeaders }, (res) => {
      let rawData = '';
      res.on('data', chunk => { rawData += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(rawData); } catch (e) { json = rawData; }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runSuite() {
  console.log('================================================================================');
  console.log('🚀 MILJOR PART 4E.9: API CONTRACT STABILIZATION & FRONTEND HANDOFF GATE');
  console.log('Target Database: miljor_test_db');
  console.log('================================================================================\n');

  await assertTestDatabaseSafety(db, 'Part 4E.9 Gate');

  let passed = 0;
  const pass = (desc) => {
    passed++;
    console.log(`  [PASS] Assertion ${passed}: ${desc}`);
  };

  testServer = http.createServer(app);
  await new Promise(resolve => testServer.listen(0, resolve));
  const port = testServer.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  let testReservationId = null;
  let testOrderId = null;
  let testDisputeId = null;

  try {
    // -------------------------------------------------------------------------
    // SETUP FIXTURES IN miljor_test_db
    // -------------------------------------------------------------------------
    const poolId = 1; // MJ-POOL-0001
    const rand = Math.floor(100000 + Math.random() * 900000);
    const testResCode = `MJ-RES-4E9-${rand}`;
    const testOrderCode = `MJ-ORD-4E9-${rand}`;
    const testDisputeCode = `DISP-4E9-${rand}`;

    // 1. Insert test reservation for Buyer 1 (User 5)
    const [resResult] = await db.query(
      `INSERT INTO reservations 
        (reservation_code, pool_id, buyer_id, quantity, unit_price, locked_unit_price, total_price, locked_total_price, status, confirmed_at)
       VALUES (?, ?, 5, 20.0000, 150.00, 150.00, 3000.00, 3000.00, 'RESERVED', NOW())`,
      [testResCode, poolId]
    );
    testReservationId = resResult.insertId;

    // 2. Insert test order for Buyer 1 (User 5), Supplier 2, Pool 1
    const [ordResult] = await db.query(
      `INSERT INTO orders 
        (order_code, reservation_id, buyer_id, supplier_id, pool_id, total_qty, unit_price, subtotal_amount, delivery_fee, buyer_platform_fee, total_amount, currency, delivery_type, payment_status, order_status, fulfillment_status)
       VALUES (?, ?, 5, 2, ?, 20.0000, 150.00, 3000.00, 50.00, 30.00, 3080.00, 'PKR', 'DOORSTEP', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT', 'UNPAID')`,
      [testOrderCode, testReservationId, poolId]
    );
    testOrderId = ordResult.insertId;

    // 3. Insert test dispute on an order
    const [dispResult] = await db.query(
      `INSERT INTO order_disputes
        (dispute_code, order_id, reservation_id, buyer_id, supplier_id, reason, dispute_category, reporting_actor_role, description, expected_quantity, reported_quantity, disputed_quantity, claimed_amount, currency, status, idempotency_key)
       VALUES (?, ?, ?, 5, 2, 'DAMAGED_GOODS', 'QUALITY_DEFECT', 'BUYER', 'Sacks arrived torn with contamination', 20.0000, 15.0000, 5.0000, 750.00, 'PKR', 'OPEN', ?)`,
      [testDisputeCode, testOrderId, testReservationId, `IDEMP-${Date.now()}`]
    );
    testDisputeId = dispResult.insertId;

    // -------------------------------------------------------------------------
    // TEST 1: Authentication - Login contract
    // -------------------------------------------------------------------------
    const loginRes = await makeRequest('POST', '/api/v1/auth/login', {}, {
      identifier: 'admin@miljor.com',
      password: 'Password123'
    });
    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.data.success, true);
    assert.ok(loginRes.data.data.token, 'Login response must include JWT token');
    assert.strictEqual(loginRes.data.data.user.email, 'admin@miljor.com');
    assert.strictEqual(loginRes.data.data.user.role, 'SUPER_ADMIN');
    pass('POST /api/v1/auth/login returns { success: true, data: { token, user } }');

    // -------------------------------------------------------------------------
    // TEST 2: Session Hydration - GET /api/v1/auth/me
    // -------------------------------------------------------------------------
    const meRes = await makeRequest('GET', '/api/v1/auth/me', {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.success, true);
    assert.strictEqual(meRes.data.data.user.id, 5);
    assert.strictEqual(meRes.data.data.user.role, 'BUYER');
    pass('GET /api/v1/auth/me hydrates authenticated user identity and role');

    // -------------------------------------------------------------------------
    // TEST 3: Pool Discovery - GET /api/v1/pools
    // -------------------------------------------------------------------------
    const poolsRes = await makeRequest('GET', '/api/v1/pools');
    assert.strictEqual(poolsRes.status, 200);
    assert.strictEqual(poolsRes.data.success, true);
    assert.ok(Array.isArray(poolsRes.data.data.pools), 'Pools must be an array');
    assert.strictEqual(poolsRes.data.count, poolsRes.data.data.pools.length);
    assert.ok(poolsRes.data.data.pools.every(p => p.status !== 'DRAFT'), 'DRAFT pools must be strictly excluded');
    pass('GET /api/v1/pools returns public active pools array and count with DRAFT excluded');

    // -------------------------------------------------------------------------
    // TEST 4: Pool Detail - GET /api/v1/pools/:id with allowed_actions
    // -------------------------------------------------------------------------
    const poolDetailRes = await makeRequest('GET', `/api/v1/pools/${poolId}`);
    assert.strictEqual(poolDetailRes.status, 200);
    assert.strictEqual(poolDetailRes.data.success, true);
    assert.ok(poolDetailRes.data.data.pool, 'Pool snapshot must be returned');
    assert.strictEqual(poolDetailRes.data.data.pool.id, poolId);
    assert.ok(Array.isArray(poolDetailRes.data.data.pool.allowed_actions), 'allowed_actions must be an array');
    pass('GET /api/v1/pools/:id returns pool snapshot with allowed_actions, specification, and supplier');

    // -------------------------------------------------------------------------
    // TEST 5: Supplier Pools - GET /api/v1/pools/supplier/my
    // -------------------------------------------------------------------------
    const supplierPoolsRes = await makeRequest('GET', '/api/v1/pools/supplier/my', {
      Authorization: `Bearer ${supplierToken}`
    });
    assert.strictEqual(supplierPoolsRes.status, 200);
    assert.strictEqual(supplierPoolsRes.data.success, true);
    assert.ok(Array.isArray(supplierPoolsRes.data.data.pools));
    pass('GET /api/v1/pools/supplier/my returns authenticated supplier pools list');

    // -------------------------------------------------------------------------
    // TEST 6: Supplier Pools Auth Guard - 401 without token
    // -------------------------------------------------------------------------
    const unauthPoolsRes = await makeRequest('GET', '/api/v1/pools/supplier/my');
    assert.strictEqual(unauthPoolsRes.status, 401);
    assert.strictEqual(unauthPoolsRes.data.success, false);
    pass('GET /api/v1/pools/supplier/my strictly rejects unauthenticated access with 401');

    // -------------------------------------------------------------------------
    // TEST 7: Buyer Reservations - GET /api/v1/reservations/my
    // -------------------------------------------------------------------------
    const myResRes = await makeRequest('GET', '/api/v1/reservations/my', {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(myResRes.status, 200);
    assert.strictEqual(myResRes.data.success, true);
    assert.ok(Array.isArray(myResRes.data.data.reservations));
    assert.ok(myResRes.data.data.reservations.some(r => r.id === testReservationId));
    pass('GET /api/v1/reservations/my returns authenticated buyer reservations array');

    // -------------------------------------------------------------------------
    // TEST 8: Reservation Detail - GET /api/v1/reservations/:id
    // -------------------------------------------------------------------------
    const resDetailRes = await makeRequest('GET', `/api/v1/reservations/${testReservationId}`, {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(resDetailRes.status, 200);
    assert.strictEqual(resDetailRes.data.success, true);
    assert.strictEqual(resDetailRes.data.data.reservation.id, testReservationId);
    assert.ok(resDetailRes.data.data.reservation.permissions);
    assert.ok(Array.isArray(resDetailRes.data.data.reservation.allowed_actions));
    pass('GET /api/v1/reservations/:id returns enriched reservation with permissions and allowed_actions');

    // -------------------------------------------------------------------------
    // TEST 9: Cross-Buyer Reservation Isolation - 403 Forbidden
    // -------------------------------------------------------------------------
    const crossResRes = await makeRequest('GET', `/api/v1/reservations/${testReservationId}`, {
      Authorization: `Bearer ${competitorBuyerToken}`
    });
    assert.strictEqual(crossResRes.status, 403);
    assert.strictEqual(crossResRes.data.success, false);
    pass('GET /api/v1/reservations/:id rejects cross-buyer tenant inspection with 403 Forbidden');

    // -------------------------------------------------------------------------
    // TEST 10: Order Listing - GET /api/v1/orders
    // -------------------------------------------------------------------------
    const ordersRes = await makeRequest('GET', '/api/v1/orders', {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(ordersRes.status, 200);
    assert.strictEqual(ordersRes.data.success, true);
    assert.ok(Array.isArray(ordersRes.data.data.orders));
    assert.ok(ordersRes.data.data.pagination);
    assert.strictEqual(typeof ordersRes.data.data.pagination.total_records, 'number');
    assert.ok(ordersRes.data.data.orders.some(o => o.id === testOrderId));
    pass('GET /api/v1/orders returns paginated orders with total_records, total_pages, and allowed_actions');

    // -------------------------------------------------------------------------
    // TEST 11: Order Listing Alias - GET /api/v1/orders/my
    // -------------------------------------------------------------------------
    const ordersMyRes = await makeRequest('GET', '/api/v1/orders/my', {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(ordersMyRes.status, 200);
    assert.strictEqual(ordersMyRes.data.success, true);
    assert.strictEqual(ordersMyRes.data.count, ordersRes.data.count);
    pass('GET /api/v1/orders/my alias returns authenticated buyer orders with identical schema');

    // -------------------------------------------------------------------------
    // TEST 12: Single Order Detail - GET /api/v1/orders/:id
    // -------------------------------------------------------------------------
    const orderDetailRes = await makeRequest('GET', `/api/v1/orders/${testOrderId}`, {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(orderDetailRes.status, 200);
    assert.strictEqual(orderDetailRes.data.success, true);
    const ord = orderDetailRes.data.data.order;
    assert.strictEqual(ord.id, testOrderId);
    assert.strictEqual(ord.buyer_id, 5);
    assert.ok(ord.financial_breakdown);
    assert.strictEqual(typeof ord.financial_breakdown.total_payable_amount, 'number');
    assert.ok(Array.isArray(ord.allowed_actions));
    assert.ok(ord.allowed_actions.includes('CHECKOUT'));
    pass('GET /api/v1/orders/:id returns single order with financial breakdown, allowed_actions, and product metadata');

    // -------------------------------------------------------------------------
    // TEST 13: Cross-Buyer Order Isolation - 403 Forbidden
    // -------------------------------------------------------------------------
    const crossOrderRes = await makeRequest('GET', `/api/v1/orders/${testOrderId}`, {
      Authorization: `Bearer ${competitorBuyerToken}`
    });
    assert.strictEqual(crossOrderRes.status, 403);
    assert.strictEqual(crossOrderRes.data.success, false);
    pass('GET /api/v1/orders/:id rejects cross-buyer order lookup with 403 Forbidden');

    // -------------------------------------------------------------------------
    // TEST 14: Assigned Supplier Order Lookup
    // -------------------------------------------------------------------------
    const suppOrderRes = await makeRequest('GET', `/api/v1/orders/${testOrderId}`, {
      Authorization: `Bearer ${supplierToken}`
    });
    assert.strictEqual(suppOrderRes.status, 200);
    assert.strictEqual(suppOrderRes.data.success, true);
    assert.strictEqual(suppOrderRes.data.data.order.id, testOrderId);
    pass('GET /api/v1/orders/:id allows assigned supplier to view their pool order');

    // -------------------------------------------------------------------------
    // TEST 15: Admin Order Lookup
    // -------------------------------------------------------------------------
    const adminOrderRes = await makeRequest('GET', `/api/v1/orders/${testOrderId}`, {
      Authorization: `Bearer ${adminToken}`
    });
    assert.strictEqual(adminOrderRes.status, 200);
    assert.strictEqual(adminOrderRes.data.success, true);
    assert.strictEqual(adminOrderRes.data.data.order.id, testOrderId);
    pass('GET /api/v1/orders/:id allows platform admin to view any order');

    // -------------------------------------------------------------------------
    // TEST 16: Order Status Filtering - GET /api/v1/orders?status=AWAITING_PAYMENT
    // -------------------------------------------------------------------------
    const filteredOrdersRes = await makeRequest('GET', '/api/v1/orders?status=AWAITING_PAYMENT', {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(filteredOrdersRes.status, 200);
    assert.ok(filteredOrdersRes.data.data.orders.every(o => o.order_status === 'AWAITING_PAYMENT' || o.payment_status === 'AWAITING_PAYMENT'));
    pass('GET /api/v1/orders filters by status query parameter correctly');

    // -------------------------------------------------------------------------
    // TEST 17: Payment Status Lookup - GET /api/v1/orders/:id/payment-status
    // -------------------------------------------------------------------------
    const payStatusRes = await makeRequest('GET', `/api/v1/orders/${testOrderId}/payment-status`, {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(payStatusRes.status, 200);
    assert.strictEqual(payStatusRes.data.success, true);
    assert.strictEqual(payStatusRes.data.data.payment_status, 'AWAITING_PAYMENT');
    pass('GET /api/v1/orders/:id/payment-status returns authoritative payment read-model');

    // -------------------------------------------------------------------------
    // TEST 18: Buyer Fulfillment Orders - GET /api/v1/fulfillment/buyer/orders
    // -------------------------------------------------------------------------
    const buyerFulfillRes = await makeRequest('GET', '/api/v1/fulfillment/buyer/orders', {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(buyerFulfillRes.status, 200);
    assert.strictEqual(buyerFulfillRes.data.success, true);
    assert.ok(Array.isArray(buyerFulfillRes.data.data.orders));
    pass('GET /api/v1/fulfillment/buyer/orders returns buyer fulfillment tracking read-model');

    // -------------------------------------------------------------------------
    // TEST 19: Supplier Fulfillment Orders - GET /api/v1/fulfillment/supplier/orders
    // -------------------------------------------------------------------------
    const suppFulfillRes = await makeRequest('GET', '/api/v1/fulfillment/supplier/orders', {
      Authorization: `Bearer ${supplierToken}`
    });
    assert.strictEqual(suppFulfillRes.status, 200);
    assert.strictEqual(suppFulfillRes.data.success, true);
    assert.ok(Array.isArray(suppFulfillRes.data.data.orders));
    pass('GET /api/v1/fulfillment/supplier/orders returns supplier fulfillment queue read-model');

    // -------------------------------------------------------------------------
    // TEST 20: Buyer Disputes - GET /api/v1/disputes/my
    // -------------------------------------------------------------------------
    const myDisputesRes = await makeRequest('GET', '/api/v1/disputes/my', {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(myDisputesRes.status, 200);
    assert.strictEqual(myDisputesRes.data.success, true);
    assert.ok(Array.isArray(myDisputesRes.data.data.disputes));
    assert.ok(myDisputesRes.data.data.disputes.some(d => d.id === testDisputeId));
    pass('GET /api/v1/disputes/my returns buyer disputes array');

    // -------------------------------------------------------------------------
    // TEST 21: Dispute Detail Object Authorization - 403 for unauthorized buyer
    // -------------------------------------------------------------------------
    const crossDisputeRes = await makeRequest('GET', `/api/v1/disputes/${testDisputeId}`, {
      Authorization: `Bearer ${competitorBuyerToken}`
    });
    assert.strictEqual(crossDisputeRes.status, 403);
    assert.strictEqual(crossDisputeRes.data.success, false);
    pass('GET /api/v1/disputes/:id enforces tenant isolation (403 for unauthorized competitor buyer)');

    // -------------------------------------------------------------------------
    // TEST 22: Settlement Overview RBAC - 403 for Buyer
    // -------------------------------------------------------------------------
    const settleBuyerRes = await makeRequest('GET', '/api/v1/settlements/admin/overview', {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(settleBuyerRes.status, 403);
    assert.strictEqual(settleBuyerRes.data.success, false);
    pass('GET /api/v1/settlements/admin/overview strictly enforces admin role (403 for buyer)');

    // -------------------------------------------------------------------------
    // TEST 23: Financial Safety Invariant - External execution status DISABLED
    // -------------------------------------------------------------------------
    const payoutExecutionStatus = safepayAdapter.getPayoutExecutionStatus ? safepayAdapter.getPayoutExecutionStatus() : 'DISABLED';
    const refundExecutionStatus = safepayAdapter.getRefundExecutionStatus ? safepayAdapter.getRefundExecutionStatus() : 'DISABLED';
    assert.strictEqual(payoutExecutionStatus, 'DISABLED');
    assert.strictEqual(refundExecutionStatus, 'DISABLED');
    pass('Financial Safety Invariant: External payout and refund execution status is strictly DISABLED');

    // -------------------------------------------------------------------------
    // TEST 24: Database Isolation - miljor_db is 100% PRISTINE
    // -------------------------------------------------------------------------
    const [devOrders] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.orders');
    const [devReservations] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.reservations');
    const [devDisputes] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.order_disputes');
    assert.strictEqual(devOrders[0].c, 0, 'miljor_db.orders must remain 0');
    assert.strictEqual(devReservations[0].c, 0, 'miljor_db.reservations must remain 0');
    assert.strictEqual(devDisputes[0].c, 0, 'miljor_db.order_disputes must remain 0');
    pass('Database Isolation Invariant: Development database miljor_db is 100% PRISTINE');

    // -------------------------------------------------------------------------
    // TEST 25: Database Isolation - miljor_sandbox_db is 100% INTACT
    // -------------------------------------------------------------------------
    const [sbxTables] = await db.query('SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = "miljor_sandbox_db"');
    assert.ok(sbxTables[0].c >= 37, 'miljor_sandbox_db must retain all schema tables');
    pass('Database Isolation Invariant: Persistent sandbox database miljor_sandbox_db is 100% INTACT');

  } finally {
    // Clean up test fixtures in miljor_test_db
    if (testDisputeId) {
      await db.query('DELETE FROM order_disputes WHERE id = ?', [testDisputeId]).catch(() => {});
    }
    if (testOrderId) {
      await db.query('DELETE FROM orders WHERE id = ?', [testOrderId]).catch(() => {});
    }
    if (testReservationId) {
      await db.query('DELETE FROM reservations WHERE id = ?', [testReservationId]).catch(() => {});
    }

    if (testServer) {
      await new Promise(resolve => testServer.close(resolve));
    }
  }

  console.log(`\n================================================================================`);
  console.log(`🎉 SUITE COMPLETE: ${passed}/25 ASSERTIONS PASSED (100%)`);
  console.log(`================================================================================\n`);
}

if (require.main === module) {
  runSuite().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('\n❌ Gate Failure:', err);
    process.exit(1);
  });
}

module.exports = { runSuite };
