// =============================================================================
// backend/tests/phase_b0_1_financial_integrity_gate.js
// MilJor Phase B0.1 Financial Integrity & Payment Consistency Automated Gate
//
// SUITES:
//   Suite 1: Legacy Payment Verification State Safety (P0-A)
//   Suite 2: Provider vs Method Provenance & Refund Safety (P0-B)
//   Suite 3: Safepay Webhook Consistency & E2E Confirmation (P0-C)
//   Suite 4: Invoice Authorization Boundary & Concurrency (P0-D, P1-A, P1-B)
//   Suite 5: Subscription Governance & Read Model (P1-C, P1-D)
//
// MANDATORY INVARIANTS:
//   - Executes strictly against miljor_test_db.
//   - Zero test fixtures leaked to miljor_db.
//   - All test fixtures cleaned up reliably in finally blocks.
// =============================================================================

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const paymentProviderService = require('../src/services/paymentProviderService');
const safepayAdapter = require('../src/services/safepayAdapter');
const safepayCheckoutService = require('../src/services/safepayCheckoutService');
const invoiceService = require('../src/services/invoiceService');
const subscriptionEntitlementService = require('../src/services/subscriptionEntitlementService');
const paymentRepo = require('../src/repositories/paymentRepo');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

let server;
let serverPort;

async function api(reqPath, options = {}) {
  const url = `http://127.0.0.1:${serverPort}${reqPath}`;
  const headers = {
    'Content-Type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
    ...(options.headers || {})
  };

  const fetchOptions = {
    method: options.method || 'GET',
    headers
  };

  if (options.body) {
    fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  const res = await fetch(url, fetchOptions);
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = { raw: text };
  }
  return { status: res.status, headers: res.headers, data: json };
}

let passedCount = 0;
let failedCount = 0;

function pass(name) {
  passedCount++;
  console.log(`  ✓ PASS: ${name}`);
}

function fail(name, err) {
  failedCount++;
  console.error(`  ✗ FAIL: ${name}`, err);
}

// Track fixture IDs for exhaustive teardown
const cleanup = {
  users: [],
  orders: [],
  payments: [],
  payment_attempts: [],
  invoices: [],
  supplier_profiles: [],
  audit_logs: []
};

async function createTestUser(role, namePrefix = 'B01') {
  const rand = Math.floor(Math.random() * 900000) + 100000;
  const phone = `+923${Math.floor(Math.random() * 900000000 + 100000000)}`;
  const email = `b01_${rand}@miljor.test`;
  const [res] = await db.query(
    `INSERT INTO users (full_name, email, phone, business_name, password_hash, role, verification_status, buyer_trust_status)
     VALUES (?, ?, ?, ?, 'hashed_pass', ?, 'VERIFIED', 'CONTACT_VERIFIED')`,
    [`${namePrefix}_${rand}`, email, phone, `${namePrefix} Business ${rand}`, role]
  );
  cleanup.users.push(res.insertId);
  return res.insertId;
}

async function createTestSupplier(namePrefix = 'B01_SUP') {
  const userId = await createTestUser('SUPPLIER', namePrefix);
  const [res] = await db.query(
    `INSERT INTO supplier_profiles (
      supplier_id, business_type, verification_status, subscription_plan,
      subscription_status, max_active_listings, transaction_fee_percent, tax_ntn, warehouse_address
    ) VALUES (?, 'DISTRIBUTOR', 'VERIFIED', 'STARTER', 'STARTER_ACTIVE', 4, 5.0, 'NTN-TEST-123', 'Lahore Hub')`,
    [userId]
  );
  cleanup.supplier_profiles.push(res.insertId);
  return userId;
}

async function createTestOrder(buyerId, supplierId, totalAmount = '1500.00', paymentStatus = 'AWAITING_PAYMENT', orderStatus = 'AWAITING_PAYMENT') {
  const rand = Math.floor(Math.random() * 900000) + 100000;
  const subtotal = (parseFloat(totalAmount) - 150.0).toFixed(2);
  const [res] = await db.query(
    `INSERT INTO orders (order_code, buyer_id, supplier_id, total_qty, unit_price, subtotal_amount, delivery_fee, buyer_platform_fee, total_amount, currency, payment_status, order_status)
     VALUES (?, ?, ?, 10, ?, ?, '100.00', '50.00', ?, 'PKR', ?, ?)`,
    [`ORD-B01-${rand}`, buyerId, supplierId, subtotal, subtotal, totalAmount, paymentStatus, orderStatus]
  );
  cleanup.orders.push(res.insertId);
  return res.insertId;
}

async function createTestAttempt(orderId, buyerId, trackerToken, amount = '1500.00', currency = 'PKR') {
  const rand = Math.floor(Math.random() * 900000) + 100000;
  const [res] = await db.query(
    `INSERT INTO payment_attempts (attempt_code, order_id, buyer_id, provider, environment, provider_tracker_token, checkout_url, amount, currency, status, idempotency_key, created_at)
     VALUES (?, ?, ?, 'SAFEPAY', 'sandbox', ?, 'https://sandbox.api.getsafepay.com/checkout/pay?beacon=test', ?, ?, 'INITIATED', ?, NOW())`,
    [`ATT-B01-${rand}`, orderId, buyerId, trackerToken, amount, currency, `IDEM-${rand}`]
  );
  cleanup.payment_attempts.push(res.insertId);
  return res.insertId;
}

async function createTestPayment(orderId, buyerId, amount = '1500.00', status = 'PENDING', paymentMethod = 'CARD', providerResponse = null) {
  const rand = Math.floor(Math.random() * 900000) + 100000;
  const respJson = providerResponse ? JSON.stringify(providerResponse) : JSON.stringify({ provider: 'SAFEPAY' });
  const [res] = await db.query(
    `INSERT INTO payments (payment_code, order_id, buyer_id, amount, buyer_fee, payment_method, status, escrow_status, provider_response, created_at)
     VALUES (?, ?, ?, ?, '50.00', ?, ?, 'HELD_IN_ESCROW', ?, NOW())`,
    [`PMT-B01-${rand}`, orderId, buyerId, amount, paymentMethod, status, respJson]
  );
  cleanup.payments.push(res.insertId);
  return res.insertId;
}

async function runAllTests() {
  console.log('\n================================================================================');
  console.log('MILJOR PHASE B0.1: FINANCIAL INTEGRITY & SAFEPAY CONSISTENCY GATE');
  console.log('================================================================================\n');

  const [dbRows] = await db.query('SELECT DATABASE() as active_db');
  const activeDb = dbRows[0].active_db;
  assert.strictEqual(activeDb, 'miljor_test_db', 'FATAL: Test gate must run strictly against miljor_test_db');
  console.log(`✅ Active Test Database Verified: ${activeDb}\n`);

  // Start temporary test server
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------------------
    // SUITE 1: Legacy Payment Verification State Safety (P0-A)
    // -------------------------------------------------------------------------
    console.log('--- SUITE 1: Legacy Payment Verification State Safety (P0-A) ---');

    const buyer1 = await createTestUser('BUYER');
    const supplier1 = await createTestUser('SUPPLIER');
    const order1 = await createTestOrder(buyer1, supplier1, '2500.00', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT');
    const payment1 = await createTestPayment(order1, buyer1, '2500.00', 'PENDING', 'CARD', { provider: 'SAFEPAY' });
    const buyer1Token = generateToken(buyer1, 'BUYER');

    // Test 1: POST /payments/verify with unverified/mock reference fails closed (402)
    {
      const res = await api('/api/v1/payments/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}` },
        body: {
          payment_id: payment1,
          transaction_ref: 'MOCK-UNVERIFIED-TOKEN-999'
        }
      });
      assert.strictEqual(res.status, 402, 'Should fail closed with 402 for unverified reference');
      assert.strictEqual(res.data?.error?.code, 'PAYMENT_VERIFICATION_FAILED');
      pass('1.1: POST /payments/verify with unverified reference fails closed with 402');
    }

    // Test 2: CRITICAL - Payment status remains PENDING; NOT corrupted to FAILED
    {
      const [rows] = await db.query('SELECT status FROM payments WHERE id = ?', [payment1]);
      assert.strictEqual(rows[0].status, 'PENDING', 'Payment status must remain PENDING; must NOT update to FAILED');
      pass('1.2: Payment status remains PENDING in database after unverified verification attempt');
    }

    // Test 3: Unauthorized 3rd party cannot verify payment
    {
      const buyer2 = await createTestUser('BUYER');
      const buyer2Token = generateToken(buyer2, 'BUYER');
      const res = await api('/api/v1/payments/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}` },
        body: {
          payment_id: payment1,
          transaction_ref: 'ANY-REF'
        }
      });
      assert.strictEqual(res.status, 403, 'Cross-buyer verification must be forbidden with 403');
      pass('1.3: Cross-buyer verification attempt rejected with 403 FORBIDDEN');
    }

    // Test 4: Already-PAID payment returns success immediately without reprocessing
    {
      const paidOrder = await createTestOrder(buyer1, supplier1, '1000.00', 'PAID', 'PAID');
      const paidPayment = await createTestPayment(paidOrder, buyer1, '1000.00', 'PAID', 'CARD', { provider: 'SAFEPAY' });
      const res = await api('/api/v1/payments/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}` },
        body: {
          payment_id: paidPayment,
          transaction_ref: 'ALREADY-PAID-REF'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data?.data?.status, 'PAID');
      pass('1.4: Already verified payment returns 200 without duplicate execution');
    }

    // -------------------------------------------------------------------------
    // SUITE 2: Provider vs Method Provenance & Refund Safety (P0-B)
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 2: Provider vs Method Provenance & Refund Safety (P0-B) ---');

    const financeAdminId = await createTestUser('FINANCE_ADMIN');
    const financeAdminToken = generateToken(financeAdminId, 'FINANCE_ADMIN');

    // Test 5: Safepay payment with method 'CARD' and provider_response provider 'SAFEPAY'
    {
      const refundOrder = await createTestOrder(buyer1, supplier1, '3000.00', 'PAID', 'PAID');
      const refundPayment = await createTestPayment(refundOrder, buyer1, '3000.00', 'PAID', 'CARD', {
        provider: 'SAFEPAY',
        tracker: 'track_test_12345'
      });

      // Finance admin requests refund
      const res = await api(`/api/v1/payments/${refundPayment}/refund`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${financeAdminToken}` },
        body: { reason: 'Order cancellation' }
      });

      // Safepay is recognized, but external money movement is disabled -> 503 REFUND_PENDING_GATEWAY
      assert.strictEqual(res.status, 503, 'Refund for Safepay should return 503 (external execution disabled)');
      assert.strictEqual(res.data?.error?.code, 'REFUND_PENDING_GATEWAY');

      // CRITICAL: Payment status must remain PAID, NOT falsely marked REFUNDED
      const [rows] = await db.query('SELECT status FROM payments WHERE id = ?', [refundPayment]);
      assert.strictEqual(rows[0].status, 'PAID', 'Payment status must remain PAID in DB when external refund is disabled');
      pass('2.1: Safepay refund safely returns 503 REFUND_PENDING_GATEWAY without corrupting payment state to REFUNDED');
    }

    // Test 6: Refund request for unsupported provider rejected with 400
    {
      const unsuppOrder = await createTestOrder(buyer1, supplier1, '1200.00', 'PAID', 'PAID');
      const unsuppPayment = await createTestPayment(unsuppOrder, buyer1, '1200.00', 'PAID', 'MOCK_GATEWAY', {
        provider: 'UNKNOWN_GATEWAY'
      });

      const res = await api(`/api/v1/payments/${unsuppPayment}/refund`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${financeAdminToken}` },
        body: { reason: 'Test' }
      });
      assert.strictEqual(res.status, 400, 'Unsupported provider refund must return 400');
      assert.strictEqual(res.data?.error?.code, 'UNSUPPORTED_PAYMENT_PROVIDER');
      pass('2.2: Refund for unsupported payment provider returns 400 UNSUPPORTED_PAYMENT_PROVIDER');
    }

    // -------------------------------------------------------------------------
    // SUITE 3: Safepay Webhook Consistency & E2E Confirmation (P0-C)
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 3: Safepay Webhook Consistency & E2E Confirmation (P0-C) ---');

    const webhookSecret = safepayAdapter.webhookSecret || process.env.SAFEPAY_WEBHOOK_SECRET || 'safepay_dev_webhook_secret_key_2026';

    function signWebhook(payloadStr) {
      return crypto.createHmac('sha512', webhookSecret).update(Buffer.from(payloadStr, 'utf8')).digest('hex');
    }

    // Test 7: Missing or invalid amount fails closed with 422
    {
      const trackerToken = `track_bad_amt_${Date.now()}`;
      const badOrder = await createTestOrder(buyer1, supplier1, '3500.00', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT');
      await createTestAttempt(badOrder, buyer1, trackerToken, '3500.00');

      const badPayload = JSON.stringify({
        event: 'payment.completed',
        data: {
          token: trackerToken,
          tracker: trackerToken,
          net: null,
          currency: 'PKR',
          metadata: { order_id: badOrder }
        }
      });
      const sig = signWebhook(badPayload);

      const res = await api('/api/v1/payments/webhook/safepay', {
        method: 'POST',
        headers: {
          'x-sfpy-signature': sig,
          'Content-Type': 'application/json'
        },
        body: badPayload
      });
      assert.strictEqual(res.status, 422, 'Missing amount must fail with 422');
      assert.strictEqual(res.data?.error?.code, 'INVALID_PAYLOAD');
      pass('3.1: Safepay webhook with null/missing amount fails closed with 422 INVALID_PAYLOAD');
    }

    // Test 8: Amount mismatch against order total fails closed with 422
    {
      const trackerToken = `track_mismatch_${Date.now()}`;
      const webhookOrder = await createTestOrder(buyer1, supplier1, '5000.00', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT');
      await createTestAttempt(webhookOrder, buyer1, trackerToken, '5000.00');

      const mismatchPayload = JSON.stringify({
        event: 'payment.completed',
        data: {
          token: trackerToken,
          tracker: trackerToken,
          net: 4500.00, // 5000.00 expected!
          currency: 'PKR',
          metadata: { order_id: webhookOrder }
        }
      });
      const sig = signWebhook(mismatchPayload);

      const res = await api('/api/v1/payments/webhook/safepay', {
        method: 'POST',
        headers: {
          'x-sfpy-signature': sig,
          'Content-Type': 'application/json'
        },
        body: mismatchPayload
      });
      assert.strictEqual(res.status, 422, 'Amount mismatch must fail with 422');
      assert.strictEqual(res.data?.error?.code, 'AMOUNT_MISMATCH');
      pass('3.2: Safepay webhook with mismatched amount fails closed with 422 AMOUNT_MISMATCH');
    }

    // Test 9: Currency mismatch against order fails closed with 422
    {
      const trackerToken = `track_curr_${Date.now()}`;
      const webhookOrder2 = await createTestOrder(buyer1, supplier1, '5000.00', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT');
      await createTestAttempt(webhookOrder2, buyer1, trackerToken, '5000.00');

      const currMismatchPayload = JSON.stringify({
        event: 'payment.completed',
        data: {
          token: trackerToken,
          tracker: trackerToken,
          net: 5000.00,
          currency: 'USD', // PKR expected!
          metadata: { order_id: webhookOrder2 }
        }
      });
      const sig = signWebhook(currMismatchPayload);

      const res = await api('/api/v1/payments/webhook/safepay', {
        method: 'POST',
        headers: {
          'x-sfpy-signature': sig,
          'Content-Type': 'application/json'
        },
        body: currMismatchPayload
      });
      assert.strictEqual(res.status, 422, 'Currency mismatch must fail with 422');
      assert.strictEqual(res.data?.error?.code, 'CURRENCY_MISMATCH');
      pass('3.3: Safepay webhook with mismatched currency fails closed with 422 CURRENCY_MISMATCH');
    }

    // Test 10: Valid webhook successfully transitions order to PAID and creates payment
    {
      const trackerToken = `track_valid_${Date.now()}`;
      const validOrder = await createTestOrder(buyer1, supplier1, '4200.00', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT');
      await createTestAttempt(validOrder, buyer1, trackerToken, '4200.00');

      const validPayload = JSON.stringify({
        event: 'payment.completed',
        data: {
          token: trackerToken,
          tracker: trackerToken,
          net: 4200.00,
          currency: 'PKR',
          metadata: { order_id: validOrder }
        }
      });
      const sig = signWebhook(validPayload);

      const res = await api('/api/v1/payments/webhook/safepay', {
        method: 'POST',
        headers: {
          'x-sfpy-signature': sig,
          'Content-Type': 'application/json'
        },
        body: validPayload
      });
      assert.strictEqual(res.status, 200, 'Valid webhook should return 200');
      assert.strictEqual(res.data?.success, true);

      // Verify DB order state
      const [orderRows] = await db.query('SELECT payment_status, order_status FROM orders WHERE id = ?', [validOrder]);
      assert.strictEqual(orderRows[0].payment_status, 'PAID', 'Order payment_status must be updated to PAID');
      assert.strictEqual(orderRows[0].order_status, 'PAID', 'Order order_status must be updated to PAID');

      // Verify DB payment created
      const [pmtRows] = await db.query('SELECT * FROM payments WHERE order_id = ?', [validOrder]);
      assert.strictEqual(pmtRows.length, 1, 'Exactly one payment record created for order');
      assert.strictEqual(pmtRows[0].status, 'PAID');
      cleanup.payments.push(pmtRows[0].id);

      pass('3.4: Authoritative Safepay webhook transitions order to PAID and records payment');

      // Test 11: Duplicate webhook call is idempotent (returns 200 without creating extra rows)
      const resDup = await api('/api/v1/payments/webhook/safepay', {
        method: 'POST',
        headers: {
          'x-sfpy-signature': sig,
          'Content-Type': 'application/json'
        },
        body: validPayload
      });
      assert.strictEqual(resDup.status, 200);
      assert.strictEqual(resDup.data?.data?.is_duplicate, true);

      const [pmtRows2] = await db.query('SELECT * FROM payments WHERE order_id = ?', [validOrder]);
      assert.strictEqual(pmtRows2.length, 1, 'Payment records must remain exactly 1 (idempotent)');
      pass('3.5: Duplicate Safepay webhook is strictly idempotent (0 duplicate payment rows)');
    }

    // -------------------------------------------------------------------------
    // SUITE 4: Invoice Authorization Boundary & Concurrency (P0-D, P1-A, P1-B)
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 4: Invoice Authorization Boundary & Concurrency (P0-D, P1-A, P1-B) ---');

    const invOrderBuyer = await createTestUser('BUYER');
    const invOrderSupplier = await createTestSupplier('B01_INV_SUP');
    const invOrder = await createTestOrder(invOrderBuyer, invOrderSupplier, '7500.50', 'PAID', 'PAID');

    // Test 12: Direct call to invoiceService.generateInvoiceForOrder without caller context throws 403
    {
      let caught = false;
      try {
        await invoiceService.generateInvoiceForOrder(invOrder);
      } catch (err) {
        caught = true;
        assert.strictEqual(err.statusCode, 403, 'Must throw 403 when caller context is missing');
        assert.strictEqual(err.code, 'INVOICE_ACCESS_FORBIDDEN');
      }
      assert.strictEqual(caught, true, 'Service method must reject unauthorized direct call');

      // Check DB: 0 rows inserted
      const [invRows] = await db.query('SELECT * FROM invoices WHERE order_id = ?', [invOrder]);
      assert.strictEqual(invRows.length, 0, 'No invoice row should be created');
      pass('4.1: Direct generateInvoiceForOrder without caller context fails closed with 403 (0 DB rows)');
    }

    // Test 13: Direct call with non-party caller throws 403
    {
      let caught = false;
      try {
        await invoiceService.generateInvoiceForOrder(invOrder, { id: 999998, role: 'BUYER' });
      } catch (err) {
        caught = true;
        assert.strictEqual(err.statusCode, 403);
      }
      assert.strictEqual(caught, true);
      const [invRows] = await db.query('SELECT * FROM invoices WHERE order_id = ?', [invOrder]);
      assert.strictEqual(invRows.length, 0);
      pass('4.2: Direct generateInvoiceForOrder with 3rd party caller context fails closed with 403 (0 DB rows)');
    }

    // Test 14: Deterministic invoice numbering format INV-YYYY-XXXXXX
    {
      const currentYear = new Date().getFullYear();
      const expectedNumber = `INV-${currentYear}-${String(invOrder).padStart(6, '0')}`;

      const invoice = await invoiceService.generateInvoiceForOrder(invOrder, {
        id: invOrderBuyer,
        role: 'BUYER'
      });
      cleanup.invoices.push(invoice.id);

      assert.strictEqual(invoice.invoice_number, expectedNumber, `Invoice number must match ${expectedNumber}`);
      pass(`4.3: Deterministic invoice numbering validated: ${expectedNumber}`);
    }

    // Test 15: Exact decimal monetary integrity on generated invoice
    {
      const [rows] = await db.query('SELECT * FROM invoices WHERE order_id = ?', [invOrder]);
      assert.strictEqual(rows.length, 1);
      const inv = rows[0];
      assert.strictEqual(parseFloat(inv.total_amount).toFixed(2), '7500.50');
      assert.strictEqual(parseFloat(inv.delivery_fee).toFixed(2), '100.00');
      assert.strictEqual(parseFloat(inv.buyer_platform_fee).toFixed(2), '50.00');
      assert.strictEqual(parseFloat(inv.subtotal_amount).toFixed(2), '7350.50');
      pass('4.4: Exact decimal monetary integrity preserved across invoice snapshot');
    }

    // Test 16: Concurrency serialization: 5 concurrent generations yield exactly 1 invoice record
    {
      // Test 15.1: Forged internal boolean is denied with 403 (B0.2 Fix 2)
      let forgedCaught = false;
      try {
        await invoiceService.generateInvoiceForOrder(invOrder, { isSystemInternal: true });
      } catch (err) {
        forgedCaught = true;
        assert.strictEqual(err.statusCode, 403);
      }
      assert.strictEqual(forgedCaught, true, 'Forged isSystemInternal boolean must be rejected');

      const concOrder = await createTestOrder(invOrderBuyer, invOrderSupplier, '3333.33', 'PAID', 'PAID');
      const results = await Promise.all([
        invoiceService.generateInvoiceForOrder(concOrder, { id: invOrderBuyer, role: 'BUYER' }),
        invoiceService.generateInvoiceForOrder(concOrder, { id: invOrderBuyer, role: 'BUYER' }),
        invoiceService.generateInvoiceForOrder(concOrder, { id: invOrderSupplier, role: 'SUPPLIER' }),
        invoiceService.generateInvoiceForOrder(concOrder, { id: invOrderBuyer, role: 'BUYER' }),
        invoiceService.generateInvoiceForOrder(concOrder, { id: 1, role: 'ADMIN' })
      ]);

      const [invRows] = await db.query('SELECT * FROM invoices WHERE order_id = ?', [concOrder]);
      assert.strictEqual(invRows.length, 1, 'Exactly 1 invoice row must exist for order');
      cleanup.invoices.push(invRows[0].id);

      // All returned results should have the same invoice ID
      const firstId = results[0].id;
      for (const r of results) {
        assert.strictEqual(r.id, firstId);
      }
      pass('4.5: 5-way concurrent invoice generation safely serializes into exactly 1 row');
    }

    // -------------------------------------------------------------------------
    // SUITE 5: Subscription Governance & Read Model (P1-C, P1-D)
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 5: Subscription Governance & Read Model (P1-C, P1-D) ---');

    const subSupplier = await createTestUser('SUPPLIER');
    const [spRes] = await db.query(
      `INSERT INTO supplier_profiles (supplier_id, business_description, subscription_plan, subscription_status, max_active_listings, transaction_fee_percent, created_at)
       VALUES (?, 'B01 Test Mills', 'STARTER', 'STARTER_ACTIVE', 4, 5.0, NOW())`,
      [subSupplier]
    );
    cleanup.supplier_profiles.push(spRes.insertId);

    // Test 17: Read model returns authoritative and aliased keys correctly
    {
      const entitlements = await subscriptionEntitlementService.getSupplierEntitlements(subSupplier);
      
      // Authoritative keys
      assert.strictEqual(entitlements.plan_code, 'STARTER');
      assert.strictEqual(entitlements.max_allowed_families, 4);
      assert.strictEqual(entitlements.active_families_count, 0);
      assert.strictEqual(entitlements.remaining_family_slots, 4);

      // Backwards-compatible aliases
      assert.strictEqual(entitlements.current_plan, 'STARTER');
      assert.strictEqual(entitlements.max_families, 4);
      assert.strictEqual(entitlements.used_distinct_families, 0);
      assert.strictEqual(entitlements.remaining_slots, 4);
      assert.strictEqual(entitlements.is_over_limit, false);

      pass('5.1: getSupplierEntitlements returns both authoritative and aliased keys');
    }

    // Test 18: Unpaid supplier upgrade to GROWTH blocked with 402
    {
      let caught = false;
      try {
        await subscriptionEntitlementService.changeSupplierPlan({
          supplierId: subSupplier,
          newPlanCode: 'GROWTH',
          actor: { id: subSupplier, role: 'SUPPLIER' }
        });
      } catch (err) {
        caught = true;
        assert.strictEqual(err.statusCode, 402);
        assert.strictEqual(err.code, 'SUBSCRIPTION_PAYMENT_REQUIRED');
      }
      assert.strictEqual(caught, true, 'Supplier upgrade must throw 402 SUBSCRIPTION_PAYMENT_REQUIRED');
      pass('5.2: Direct changeSupplierPlan to GROWTH without payment throws 402');
    }

    // Test 19: Annual cycle requested by admin blocked with 400
    {
      let caught = false;
      try {
        await subscriptionEntitlementService.changeSupplierPlan({
          supplierId: subSupplier,
          newPlanCode: 'GROWTH',
          billingCycle: 'ANNUAL',
          actor: { id: 1, role: 'ADMIN' }
        });
      } catch (err) {
        caught = true;
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, 'INVALID_BILLING_CYCLE');
      }
      assert.strictEqual(caught, true, 'Annual billing cycle must throw 400');
      pass('5.3: Annual billing cycle request throws 400 INVALID_BILLING_CYCLE');
    }

    // Test 20: Buyer attempting supplier plan change throws 403
    {
      let caught = false;
      try {
        await subscriptionEntitlementService.changeSupplierPlan({
          supplierId: subSupplier,
          newPlanCode: 'GROWTH',
          actor: { id: buyer1, role: 'BUYER' }
        });
      } catch (err) {
        caught = true;
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
      }
      assert.strictEqual(caught, true);
      pass('5.4: Buyer role changeSupplierPlan attempt throws 403 FORBIDDEN');
    }

    // Test 21: Admin unpaid grant is denied without approved commercial grant policy (B0.2 Fix 1)
    {
      const adminId = await createTestUser('ADMIN');
      let adminCaught = false;
      try {
        await subscriptionEntitlementService.changeSupplierPlan({
          supplierId: subSupplier,
          newPlanCode: 'BUSINESS',
          actor: { id: adminId, role: 'ADMIN', full_name: 'Test Admin' }
        });
      } catch (err) {
        adminCaught = true;
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'COMMERCIAL_GRANT_POLICY_REQUIRED');
      }
      assert.strictEqual(adminCaught, true, 'Admin unpaid grant must be blocked with 403 COMMERCIAL_GRANT_POLICY_REQUIRED');

      // Verify supplier profile remains STARTER
      const [spRows] = await db.query('SELECT subscription_plan FROM supplier_profiles WHERE supplier_id = ?', [subSupplier]);
      assert.strictEqual(spRows[0].subscription_plan, 'STARTER');
      pass('5.5: Admin unpaid paid-plan grant denied with 403 and plan remains STARTER');
    }

  } catch (err) {
    console.error('\n❌ UNHANDLED EXCEPTION IN TEST SUITE:', err);
    failedCount++;
  } finally {
    // Teardown test server
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Clean up test database
    console.log('\n--- CLEANING UP TEST FIXTURES ---');
    try {
      if (cleanup.audit_logs.length > 0) {
        await db.query(`DELETE FROM system_audit_logs WHERE id IN (?)`, [cleanup.audit_logs]);
      }
      if (cleanup.invoices.length > 0) {
        await db.query(`DELETE FROM invoices WHERE id IN (?)`, [cleanup.invoices]);
      }
      if (cleanup.payments.length > 0) {
        await db.query(`DELETE FROM payments WHERE id IN (?)`, [cleanup.payments]);
      }
      if (cleanup.payment_attempts.length > 0) {
        await db.query(`DELETE FROM payment_attempts WHERE id IN (?)`, [cleanup.payment_attempts]);
      }
      if (cleanup.orders.length > 0) {
        await db.query(`DELETE FROM orders WHERE id IN (?)`, [cleanup.orders]);
      }
      if (cleanup.supplier_profiles.length > 0) {
        await db.query(`DELETE FROM supplier_profiles WHERE id IN (?)`, [cleanup.supplier_profiles]);
      }
      // Refund endpoints now audit blocked attempts; remove only this suite's own actors' audit rows.
      if (cleanup.users.length > 0) {
        await db.query(`DELETE FROM system_audit_logs WHERE actor_id IN (?)`, [cleanup.users]);
        await db.query(`DELETE FROM users WHERE id IN (?)`, [cleanup.users]);
      }
      console.log('✅ All test fixtures safely removed from miljor_test_db');
    } catch (cleanErr) {
      console.error('⚠️ Cleanup error:', cleanErr);
    }
  }

  console.log('\n================================================================================');
  console.log(`PHASE B0.1 GATE VERDICT: ${passedCount} PASSED, ${failedCount} FAILED`);
  if (failedCount === 0) {
    console.log('STATUS: 100% GREEN — ALL FINANCIAL INTEGRITY INVARIANTS SECURED');
  } else {
    console.log('STATUS: FAILED — REMEDIATION REQUIRED');
  }
  console.log('================================================================================\n');

  process.exit(failedCount === 0 ? 0 : 1);
}

runAllTests();
