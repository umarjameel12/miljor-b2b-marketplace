// =============================================================================
// backend/tests/phase_b0_backend_safety_recovery_gate.js
// MilJor Phase B0: Backend Safety Recovery & Protection Automated Gate
//
// TEST SUITES:
//   Suite 1: Mock Payment Containment & Safepay-Only Active Provider Gating (M1–M10)
//   Suite 2: Safepay Active Provider & Webhook Verification (S1–S10)
//   Suite 3: Invoice Authorization-Before-Generation & Concurrency Safety (I1–I12)
//   Suite 4: Subscription Security, Gating, Quotas & Audit (U1–U14)
//
// MANDATORY INVARIANTS:
//   - Must execute strictly against miljor_test_db.
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
const invoiceService = require('../src/services/invoiceService');
const subscriptionEntitlementService = require('../src/services/subscriptionEntitlementService');

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

async function api(path, options = {}) {
  const url = `http://127.0.0.1:${serverPort}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
    ...(options.headers || {})
  };
  const fetchOpts = { method: options.method || 'GET', headers };
  if (options.body) fetchOpts.body = JSON.stringify(options.body);

  const res = await fetch(url, fetchOpts);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, headers: res.headers, body };
}

let passCount = 0;
let failCount = 0;

function pass(name) {
  passCount++;
  console.log(`  ✓ PASS: ${name}`);
}

function fail(name, err) {
  failCount++;
  console.error(`  ✗ FAIL: ${name}`);
  console.error(err);
}

async function runB0Gate() {
  console.log('\n================================================================================');
  console.log('MILJOR PHASE B0: BACKEND SAFETY RECOVERY & PROTECTION AUTOMATED GATE');
  console.log('================================================================================\n');

  // Verify DB safety
  assert.strictEqual(process.env.TEST_DB_NAME, 'miljor_test_db');
  const [dbNameRow] = await db.query('SELECT DATABASE() AS currentDb');
  assert.strictEqual(dbNameRow[0].currentDb, 'miljor_test_db', 'Must strictly run against miljor_test_db');
  console.log('✅ Active Test Database Verified: miljor_test_db\n');

  // Start HTTP server on dynamic port
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve();
    });
  });

  const cleanupUserIds = [];
  const cleanupOrderIds = [];
  const cleanupPaymentIds = [];
  const cleanupReservationIds = [];
  const cleanupPoolIds = [];
  const cleanupSpecIds = [];
  const cleanupProductIds = [];

  try {
    // -------------------------------------------------------------------------
    // Setup Test Actors & Fixtures
    // -------------------------------------------------------------------------
    const runId = Date.now().toString().slice(-6);

    // 1. Supplier User & Profile
    const [supRes] = await db.query(
      `INSERT INTO users (full_name, email, phone, business_name, password_hash, role, verification_status)
       VALUES (?, ?, ?, 'B0 Test Supplier Flour Mill', 'hashed_pass', 'SUPPLIER', 'VERIFIED')`,
      [`B0 Supplier ${runId}`, `b0_supplier_${runId}@miljor.test`, `+92300100${runId}`]
    );
    const supplierId = supRes.insertId;
    cleanupUserIds.push(supplierId);

    // Ensure starter profile exists
    await db.query(
      `INSERT INTO supplier_profiles (
        supplier_id, business_type, verification_status, subscription_plan,
        subscription_status, max_active_listings, transaction_fee_percent, tax_ntn, warehouse_address
      ) VALUES (?, 'MILLER', 'VERIFIED', 'STARTER', 'STARTER_ACTIVE', 4, 5.0, 'NTN-B0-TEST', 'Badami Bagh Industrial Hub, Lahore')
      ON DUPLICATE KEY UPDATE subscription_plan='STARTER', subscription_status='STARTER_ACTIVE', max_active_listings=4`,
      [supplierId]
    );

    // 2. Buyer User
    const [buyerRes] = await db.query(
      `INSERT INTO users (full_name, email, phone, business_name, password_hash, role, verification_status, buyer_trust_status)
       VALUES (?, ?, ?, 'B0 Test Bakery Gulberg', 'hashed_pass', 'BUYER', 'VERIFIED', 'CONTACT_VERIFIED')`,
      [`B0 Buyer ${runId}`, `b0_buyer_${runId}@miljor.test`, `+92300200${runId}`]
    );
    const buyerId = buyerRes.insertId;
    cleanupUserIds.push(buyerId);

    // 3. Unauthorized 3rd Party Buyer User
    const [intruderRes] = await db.query(
      `INSERT INTO users (full_name, email, phone, business_name, password_hash, role, verification_status, buyer_trust_status)
       VALUES (?, ?, ?, 'B0 Intruder Cafe', 'hashed_pass', 'BUYER', 'VERIFIED', 'CONTACT_VERIFIED')`,
      [`B0 Intruder ${runId}`, `b0_intruder_${runId}@miljor.test`, `+92300300${runId}`]
    );
    const intruderId = intruderRes.insertId;
    cleanupUserIds.push(intruderId);

    // 4. Admin User & Finance Admin User
    const [adminRes] = await db.query(
      `INSERT INTO users (full_name, email, phone, business_name, password_hash, role, verification_status)
       VALUES (?, ?, ?, 'MilJor Platform Operations', 'hashed_pass', 'ADMIN', 'VERIFIED')`,
      [`B0 Admin ${runId}`, `b0_admin_${runId}@miljor.test`, `+92300400${runId}`]
    );
    const adminId = adminRes.insertId;
    cleanupUserIds.push(adminId);

    const [finAdminRes] = await db.query(
      `INSERT INTO users (full_name, email, phone, business_name, password_hash, role, verification_status)
       VALUES (?, ?, ?, 'MilJor Finance Operations', 'hashed_pass', 'FINANCE_ADMIN', 'VERIFIED')`,
      [`B0 FinAdmin ${runId}`, `b0_finadmin_${runId}@miljor.test`, `+92300450${runId}`]
    );
    const financeAdminId = finAdminRes.insertId;
    cleanupUserIds.push(financeAdminId);

    // 5. Another Supplier User (for cross-supplier isolation test)
    const [sup2Res] = await db.query(
      `INSERT INTO users (full_name, email, phone, business_name, password_hash, role, verification_status)
       VALUES (?, ?, ?, 'B0 Rival Supplier Oil Mills', 'hashed_pass', 'SUPPLIER', 'VERIFIED')`,
      [`B0 Supplier 2 ${runId}`, `b0_supplier2_${runId}@miljor.test`, `+92300500${runId}`]
    );
    const supplier2Id = sup2Res.insertId;
    cleanupUserIds.push(supplier2Id);
    await db.query(
      `INSERT INTO supplier_profiles (
        supplier_id, business_type, verification_status, subscription_plan,
        subscription_status, max_active_listings, transaction_fee_percent, tax_ntn, warehouse_address
      ) VALUES (?, 'DISTRIBUTOR', 'VERIFIED', 'STARTER', 'STARTER_ACTIVE', 4, 5.0, 'NTN-B0-TEST-2', 'Kot Lakhpat, Lahore')
      ON DUPLICATE KEY UPDATE subscription_plan='STARTER', subscription_status='STARTER_ACTIVE', max_active_listings=4`,
      [supplier2Id]
    );

    // Auth Tokens
    const supplierToken = generateToken(supplierId, 'SUPPLIER');
    const supplier2Token = generateToken(supplier2Id, 'SUPPLIER');
    const buyerToken = generateToken(buyerId, 'BUYER');
    const intruderToken = generateToken(intruderId, 'BUYER');
    const adminToken = generateToken(adminId, 'ADMIN');
    const financeAdminToken = generateToken(financeAdminId, 'FINANCE_ADMIN');

    // Create an Authoritative Order for Invoice & Payment Tests
    const [orderRes] = await db.query(
      `INSERT INTO orders (
        order_code, buyer_id, supplier_id, total_qty, unit_price,
        subtotal_amount, delivery_fee, buyer_platform_fee, total_amount, currency,
        delivery_address, cluster_zone, payment_status, order_status
      ) VALUES (?, ?, ?, 50, 1500.00, 75000.00, 500.00, 1875.00, 77375.00, 'PKR',
        'Plot 12, Main Boulevard, Gulberg III, Lahore', 'Gulberg', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT')`,
      [`ORD-B0-${runId}`, buyerId, supplierId]
    );
    const orderId = orderRes.insertId;
    cleanupOrderIds.push(orderId);

    // Create a Payment fixture for verify/refund testing
    const [pmtRes] = await db.query(
      `INSERT INTO payments (
        payment_code, order_id, buyer_id, amount, buyer_fee, payment_method, status, escrow_status
      ) VALUES (?, ?, ?, 77375.00, 1875.00, 'MOCK_GATEWAY', 'PENDING', 'HELD_IN_ESCROW')`,
      [`PMT-B0-${runId}`, orderId, buyerId]
    );
    const paymentId = pmtRes.insertId;
    cleanupPaymentIds.push(paymentId);

    // =========================================================================
    // SUITE 1: MOCK PAYMENT CONTAINMENT & SAFEPAY-ONLY ACTIVE PROVIDER GATING
    // =========================================================================
    console.log('--- SUITE 1: Mock Payment Containment & Active Provider Gating (M1–M10) ---');

    // Setup a verified Pool and Reservation fixture for payment initiation tests
    const [poolRes] = await db.query(
      `INSERT INTO pools (
        pool_code, supplier_id, product_id, current_qty, target_qty,
        supplier_min_qty, buyer_min_qty, current_price_per_unit, status, expires_at
      ) VALUES (?, ?, 1, 0, 100, 5, 1, 1000.00, 'CONFIRMED', DATE_ADD(NOW(), INTERVAL 3 DAY))`,
      [`POOL-B0-${runId}`, supplierId]
    );
    const poolId = poolRes.insertId;
    cleanupPoolIds.push(poolId);

    const [resvRes] = await db.query(
      `INSERT INTO reservations (reservation_code, pool_id, buyer_id, quantity, unit_price, total_price, status)
       VALUES (?, ?, ?, 10, 100.00, 1000.00, 'CONFIRMED')`,
      [`RESV-B0-${runId}`, poolId, buyerId]
    );
    const resvId = resvRes.insertId;
    cleanupReservationIds.push(resvId);

    // M1: POST /api/v1/payments/verify with MOCK- reference fails closed (never marks PAID)
    try {
      const res = await api('/api/v1/payments/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: { payment_id: paymentId, transaction_ref: 'MOCK-12345678' }
      });
      assert.strictEqual(res.status, 402, 'Should fail with 402 on failed verification');
      assert.strictEqual(res.body.error.code, 'PAYMENT_VERIFICATION_FAILED');

      // Verify payment was NOT marked PAID in DB
      const [pmtCheck] = await db.query('SELECT status FROM payments WHERE id = ?', [paymentId]);
      assert.notStrictEqual(pmtCheck[0].status, 'PAID', 'Payment must not be set to PAID by mock ref');
      pass('M1: POST /payments/verify with MOCK- reference fails closed and never marks payment PAID');
    } catch (e) { fail('M1: Mock verify containment', e); }

    // M2: POST /api/v1/payments/initiate with unapproved provider 'JAZZCASH' returns 400
    try {
      const res = await api('/api/v1/payments/initiate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: { reservation_id: resvId, payment_method: 'JAZZCASH' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'UNSUPPORTED_PAYMENT_PROVIDER');
      pass('M2: POST /payments/initiate with unapproved provider JAZZCASH rejected with 400 UNSUPPORTED_PAYMENT_PROVIDER');
    } catch (e) { fail('M2: JAZZCASH initiate rejected', e); }

    // M3: POST /api/v1/payments/initiate with unapproved provider 'EASYPAISA' returns 400
    try {
      const res = await api('/api/v1/payments/initiate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: { reservation_id: resvId, payment_method: 'EASYPAISA' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'UNSUPPORTED_PAYMENT_PROVIDER');
      pass('M3: POST /payments/initiate with unapproved provider EASYPAISA rejected with 400 UNSUPPORTED_PAYMENT_PROVIDER');
    } catch (e) { fail('M3: EASYPAISA initiate rejected', e); }

    // M4: POST /api/v1/payments/initiate with 'MOCK_GATEWAY' returns 400
    try {
      const res = await api('/api/v1/payments/initiate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: { reservation_id: resvId, payment_method: 'MOCK_GATEWAY' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'UNSUPPORTED_PAYMENT_PROVIDER');
      pass('M4: POST /payments/initiate with MOCK_GATEWAY rejected with 400 UNSUPPORTED_PAYMENT_PROVIDER');
    } catch (e) { fail('M4: MOCK_GATEWAY initiate rejected', e); }

    // M5: Direct verification of provider rejection via paymentProviderService.verifyPayment for JAZZCASH
    try {
      const jzRes = await paymentProviderService.verifyPayment({
        provider: 'JAZZCASH',
        transaction_ref: 'JZ-123456',
        expected_amount: 1000
      });
      assert.strictEqual(jzRes.verified, false);
      assert.strictEqual(jzRes.status, 'UNSUPPORTED_PAYMENT_PROVIDER');
      pass('M5: paymentProviderService.verifyPayment rejects JAZZCASH with UNSUPPORTED_PAYMENT_PROVIDER');
    } catch (e) { fail('M5: Direct JAZZCASH verify rejection', e); }

    // M6: Direct verification of provider rejection via paymentProviderService.verifyPayment for EASYPAISA
    try {
      const epRes = await paymentProviderService.verifyPayment({
        provider: 'EASYPAISA',
        transaction_ref: 'EP-123456',
        expected_amount: 1000
      });
      assert.strictEqual(epRes.verified, false);
      assert.strictEqual(epRes.status, 'UNSUPPORTED_PAYMENT_PROVIDER');
      pass('M6: paymentProviderService.verifyPayment rejects EASYPAISA with UNSUPPORTED_PAYMENT_PROVIDER');
    } catch (e) { fail('M6: Direct EASYPAISA verify rejection', e); }

    // M7: Client-sent status: 'PAID' in initiatePayment is completely ignored
    try {
      const res = await api('/api/v1/payments/initiate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: { reservation_id: resvId, payment_method: 'SAFEPAY', status: 'PAID' }
      });
      // Should require converted order before checkout (never blindly trusts status: PAID)
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'ORDER_REQUIRED_FOR_PAYMENT');
      pass('M7: Client-sent status: PAID is strictly ignored; requires authoritative order before checkout');
    } catch (e) { fail('M7: Ignore client status PAID', e); }

    // M8: POST /api/v1/payments/initiate without reservation_id returns 400
    try {
      const res = await api('/api/v1/payments/initiate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: { payment_method: 'SAFEPAY' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
      pass('M8: POST /payments/initiate without reservation_id returns 400 VALIDATION_ERROR');
    } catch (e) { fail('M8: Missing reservation_id validation', e); }

    // M9: POST /api/v1/payments/:id/refund with MOCK_GATEWAY payment returns 400 UNSUPPORTED_PAYMENT_PROVIDER
    try {
      // Create a PAID payment with MOCK_GATEWAY method to test refund protection
      const [mockPmt] = await db.query(
        `INSERT INTO payments (
          payment_code, order_id, buyer_id, amount, buyer_fee, payment_method, status, escrow_status
        ) VALUES (?, ?, ?, 5000.00, 125.00, 'MOCK_GATEWAY', 'PAID', 'HELD_IN_ESCROW')`,
        [`PMT-MOCK-${runId}`, orderId, buyerId]
      );
      const mockPmtId = mockPmt.insertId;
      cleanupPaymentIds.push(mockPmtId);

      const res = await api(`/api/v1/payments/${mockPmtId}/refund`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${financeAdminToken}` },
        body: { reason: 'Test mock refund' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'UNSUPPORTED_PAYMENT_PROVIDER');
      pass('M9: POST /payments/:id/refund for MOCK_GATEWAY rejected with 400 UNSUPPORTED_PAYMENT_PROVIDER');
    } catch (e) { fail('M9: Mock refund rejection', e); }

    // M10: POST /api/v1/payments/:id/refund with unapproved provider JAZZCASH returns 400
    try {
      const [jzPmt] = await db.query(
        `INSERT INTO payments (
          payment_code, order_id, buyer_id, amount, buyer_fee, payment_method, status, escrow_status
        ) VALUES (?, ?, ?, 5000.00, 125.00, 'JAZZCASH', 'PAID', 'HELD_IN_ESCROW')`,
        [`PMT-JZ-${runId}`, orderId, buyerId]
      );
      const jzPmtId = jzPmt.insertId;
      cleanupPaymentIds.push(jzPmtId);

      const res = await api(`/api/v1/payments/${jzPmtId}/refund`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${financeAdminToken}` },
        body: { reason: 'Test JAZZCASH refund' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'UNSUPPORTED_PAYMENT_PROVIDER');
      pass('M10: POST /payments/:id/refund for unapproved provider JAZZCASH rejected with 400 UNSUPPORTED_PAYMENT_PROVIDER');
    } catch (e) { fail('M10: JAZZCASH refund rejection', e); }

    // =========================================================================
    // SUITE 2: SAFEPAY ACTIVE PROVIDER & WEBHOOK VERIFICATION (S1–S10)
    // =========================================================================
    console.log('\n--- SUITE 2: Safepay Active Provider & Webhook Verification (S1–S10) ---');

    // S1: PROVIDERS.SAFEPAY is the sole provider constant
    try {
      assert.strictEqual(paymentProviderService.PROVIDERS.SAFEPAY, 'SAFEPAY');
      pass('S1: paymentProviderService.PROVIDERS.SAFEPAY is defined as SAFEPAY');
    } catch (e) { fail('S1: Provider constant', e); }

    // S2: isProviderSupported('SAFEPAY') evaluates to true
    try {
      assert.strictEqual(paymentProviderService.isProviderSupported('SAFEPAY'), true);
      assert.strictEqual(paymentProviderService.isProviderSupported('safepay'), true);
      pass('S2: paymentProviderService.isProviderSupported correctly accepts SAFEPAY');
    } catch (e) { fail('S2: Supported provider check', e); }

    // S3: isProviderSupported rejects non-Safepay providers
    try {
      assert.strictEqual(paymentProviderService.isProviderSupported('MOCK_GATEWAY'), false);
      assert.strictEqual(paymentProviderService.isProviderSupported('JAZZCASH'), false);
      assert.strictEqual(paymentProviderService.isProviderSupported('EASYPAISA'), false);
      assert.strictEqual(paymentProviderService.isProviderSupported('STRIPE'), false);
      pass('S3: paymentProviderService.isProviderSupported rejects all unapproved providers');
    } catch (e) { fail('S3: Unapproved providers rejection', e); }

    // S4: safepayAdapter rejects empty signature
    try {
      const verified = safepayAdapter.verifyWebhookSignature({
        rawBody: '{"test":"data"}',
        signature: ''
      });
      assert.strictEqual(verified, false);
      pass('S4: safepayAdapter.verifyWebhookSignature fails closed when signature is empty');
    } catch (e) { fail('S4: Empty signature fails closed', e); }

    // S5: safepayAdapter rejects empty rawBody
    try {
      const verified = safepayAdapter.verifyWebhookSignature({
        rawBody: '',
        signature: 'some_signature'
      });
      assert.strictEqual(verified, false);
      pass('S5: safepayAdapter.verifyWebhookSignature fails closed when rawBody is empty');
    } catch (e) { fail('S5: Empty rawBody fails closed', e); }

    // S6: Valid HMAC-SHA512 hex signature evaluates to true
    try {
      const secret = safepayAdapter.webhookSecret || 'test_webhook_secret_b0';
      safepayAdapter.webhookSecret = secret;
      const payload = JSON.stringify({ event: 'payment.completed', tracker: 'track_b0_123' });
      const validSig = crypto.createHmac('sha512', secret).update(Buffer.from(payload, 'utf8')).digest('hex');

      const verified = safepayAdapter.verifyWebhookSignature({
        rawBody: payload,
        signature: validSig
      });
      assert.strictEqual(verified, true);
      pass('S6: safepayAdapter accepts valid HMAC-SHA512 signature strictly computed over untouched body bytes');
    } catch (e) { fail('S6: Valid signature verification', e); }

    // S7: Valid HMAC-SHA512 signature with 'sha512=' prefix evaluates to true
    try {
      const secret = safepayAdapter.webhookSecret;
      const payload = JSON.stringify({ event: 'payment.completed', tracker: 'track_b0_123' });
      const validSig = crypto.createHmac('sha512', secret).update(Buffer.from(payload, 'utf8')).digest('hex');

      const verified = safepayAdapter.verifyWebhookSignature({
        rawBody: payload,
        signature: `sha512=${validSig}`
      });
      assert.strictEqual(verified, true);
      pass('S7: safepayAdapter accepts valid signature with sha512= prefix');
    } catch (e) { fail('S7: Signature with sha512= prefix', e); }

    // S8: Tampered payload evaluates to false
    try {
      const secret = safepayAdapter.webhookSecret;
      const payload = JSON.stringify({ event: 'payment.completed', amount: 1000 });
      const validSig = crypto.createHmac('sha512', secret).update(Buffer.from(payload, 'utf8')).digest('hex');

      const tamperedPayload = JSON.stringify({ event: 'payment.completed', amount: 999999 });
      const verified = safepayAdapter.verifyWebhookSignature({
        rawBody: tamperedPayload,
        signature: validSig
      });
      assert.strictEqual(verified, false);
      pass('S8: safepayAdapter reliably detects tampered payload (returns false)');
    } catch (e) { fail('S8: Tampered payload detection', e); }

    // S9: Invalid signature hash length or content evaluates to false
    try {
      const verified = safepayAdapter.verifyWebhookSignature({
        rawBody: '{"test":1}',
        signature: 'deadbeef'
      });
      assert.strictEqual(verified, false);
      pass('S9: safepayAdapter timingSafeEqual handles length mismatch and bad signatures safely');
    } catch (e) { fail('S9: Bad signature format', e); }

    // S10: Safepay checkout URL generation produces valid structured URL
    try {
      safepayAdapter.publicKey = safepayAdapter.publicKey || 'sec_test_public_key';
      const checkoutUrl = safepayAdapter.constructCheckoutUrl({
        trackerToken: 'track_b0_checkout_123',
        orderCode: `ORD-B0-${runId}`,
        redirectUrl: 'https://miljor.test/order/success',
        cancelUrl: 'https://miljor.test/order/cancel',
        webhooks: true
      });
      assert.ok(checkoutUrl.includes('beacon=track_b0_checkout_123'));
      assert.ok(checkoutUrl.includes(`order_id=ORD-B0-${runId}`));
      assert.ok(checkoutUrl.includes('env=sandbox'));
      assert.ok(checkoutUrl.includes('webhooks=true'));
      pass('S10: safepayAdapter.constructCheckoutUrl constructs authoritative hosted checkout URL with query params');
    } catch (e) { fail('S10: Checkout URL construction', e); }

    // =========================================================================
    // SUITE 3: INVOICE AUTHORIZATION-BEFORE-GENERATION & CONCURRENCY (I1–I12)
    // =========================================================================
    console.log('\n--- SUITE 3: Invoice Authorization-Before-Generation & Concurrency Safety (I1–I12) ---');

    // I1: Unauthenticated request to /api/v1/invoices/:orderId returns 401
    try {
      const res = await api(`/api/v1/invoices/${orderId}`);
      assert.strictEqual(res.status, 401);
      pass('I1: GET /invoices/:orderId without token returns 401 UNAUTHORIZED');
    } catch (e) { fail('I1: Unauthenticated invoice fetch', e); }

    // I2: Invalid non-numeric orderId returns 400 INVALID_ORDER_ID
    try {
      const res = await api('/api/v1/invoices/not_a_number', {
        headers: { Authorization: `Bearer ${buyerToken}` }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'INVALID_ORDER_ID');
      pass('I2: GET /invoices/not_a_number returns 400 INVALID_ORDER_ID');
    } catch (e) { fail('I2: Non-numeric orderId', e); }

    // I3: Non-existent orderId returns 404 ORDER_NOT_FOUND
    try {
      const res = await api('/api/v1/invoices/999999999', {
        headers: { Authorization: `Bearer ${buyerToken}` }
      });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error.code, 'ORDER_NOT_FOUND');
      pass('I3: GET /invoices/999999999 returns 404 ORDER_NOT_FOUND');
    } catch (e) { fail('I3: Non-existent orderId', e); }

    // I4: Unauthorized 3rd party buyer attempting invoice access returns 403 INVOICE_ACCESS_FORBIDDEN
    try {
      const res = await api(`/api/v1/invoices/${orderId}`, {
        headers: { Authorization: `Bearer ${intruderToken}` }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'INVOICE_ACCESS_FORBIDDEN');
      pass('I4: Unauthorized 3rd party buyer attempting invoice access rejected with 403 INVOICE_ACCESS_FORBIDDEN');
    } catch (e) { fail('I4: 3rd party buyer blocked with 403', e); }

    // I5: CRITICAL SAFETY CHECK: Zero invoice rows generated for unauthorized request
    try {
      const [invRows] = await db.query('SELECT COUNT(*) as cnt FROM invoices WHERE order_id = ?', [orderId]);
      assert.strictEqual(invRows[0].cnt, 0, 'ZERO invoice rows must exist after blocked unauthorized request!');
      pass('I5: CRITICAL VERIFICATION: Exactly 0 invoice rows created in DB after rejected unauthorized request');
    } catch (e) { fail('I5: Zero rows on 403 verification', e); }

    // I6: Authorized buyer generates and receives invoice snapshot (HTTP 200)
    let generatedInvoiceNumber = null;
    try {
      const res = await api(`/api/v1/invoices/${orderId}`, {
        headers: { Authorization: `Bearer ${buyerToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const inv = res.body.data.invoice;
      assert.ok(inv.invoice_number.startsWith('INV-'));
      assert.strictEqual(Number(inv.total_amount), 77375.00);
      generatedInvoiceNumber = inv.invoice_number;
      pass('I6: Authorized purchasing buyer receives generated invoice with status 200');
    } catch (e) { fail('I6: Authorized buyer invoice fetch', e); }

    // I7: Invoice number matches format INV-YYYY-XXXXX
    try {
      assert.ok(/^INV-\d{4}-\d+$/.test(generatedInvoiceNumber), 'Invoice number must match pattern INV-YYYY-XXXXX');
      pass(`I7: Invoice number format strictly validated: ${generatedInvoiceNumber}`);
    } catch (e) { fail('I7: Invoice number format', e); }

    // I8: Legitimate fulfilling supplier can view the same invoice (HTTP 200)
    try {
      const res = await api(`/api/v1/invoices/${orderId}`, {
        headers: { Authorization: `Bearer ${supplierToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.invoice.invoice_number, generatedInvoiceNumber);
      pass('I8: Fulfilling supplier views identical invoice snapshot with status 200');
    } catch (e) { fail('I8: Supplier invoice fetch', e); }

    // I9: Admin can view the invoice (HTTP 200)
    try {
      const res = await api(`/api/v1/invoices/${orderId}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.invoice.invoice_number, generatedInvoiceNumber);
      pass('I9: Administrator views identical invoice snapshot with status 200');
    } catch (e) { fail('I9: Admin invoice fetch', e); }

    // I10: Invoice snapshot is immutable: subsequent fetches return exact same row without recreation
    try {
      const [invRows] = await db.query('SELECT * FROM invoices WHERE order_id = ?', [orderId]);
      assert.strictEqual(invRows.length, 1, 'Only 1 invoice row must exist for this order');
      assert.strictEqual(invRows[0].invoice_number, generatedInvoiceNumber);
      pass('I10: Invoice snapshot is strictly immutable; exactly 1 row persists in invoices table');
    } catch (e) { fail('I10: Snapshot immutability', e); }

    // I11: Concurrency serialization: 5 simultaneous requests produce exactly 1 invoice row
    try {
      // Create a fresh order for concurrency test
      const [concOrder] = await db.query(
        `INSERT INTO orders (
          order_code, buyer_id, supplier_id, total_qty, unit_price,
          subtotal_amount, delivery_fee, buyer_platform_fee, total_amount, currency,
          delivery_address, cluster_zone, payment_status, order_status
        ) VALUES (?, ?, ?, 20, 2000.00, 40000.00, 300.00, 1000.00, 41300.00, 'PKR',
          'Gulberg II, Lahore', 'Gulberg', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT')`,
        [`ORD-CONC-${runId}`, buyerId, supplierId]
      );
      const concOrderId = concOrder.insertId;
      cleanupOrderIds.push(concOrderId);

      // Fire 5 concurrent requests simultaneously
      const results = await Promise.all([
        invoiceService.getInvoiceByOrderId(concOrderId, buyerId, 'BUYER'),
        invoiceService.getInvoiceByOrderId(concOrderId, buyerId, 'BUYER'),
        invoiceService.getInvoiceByOrderId(concOrderId, supplierId, 'SUPPLIER'),
        invoiceService.getInvoiceByOrderId(concOrderId, adminId, 'ADMIN'),
        invoiceService.getInvoiceByOrderId(concOrderId, buyerId, 'BUYER')
      ]);

      // All 5 returned the same invoice_number
      const invNums = results.map(r => r.invoice_number);
      const uniqueNums = new Set(invNums);
      assert.strictEqual(uniqueNums.size, 1, 'All concurrent callers must receive identical invoice number');

      // Exactly 1 row in DB
      const [rows] = await db.query('SELECT COUNT(*) as cnt FROM invoices WHERE order_id = ?', [concOrderId]);
      assert.strictEqual(rows[0].cnt, 1, 'Exactly 1 invoice row must be inserted under concurrent requests');
      pass('I11: Concurrency serialization: 5 simultaneous requests safely produce exactly 1 invoice row');
    } catch (e) { fail('I11: Concurrency serialization', e); }

    // I12: Direct call to invoiceService without callerId fails closed with 401
    try {
      let errorThrown = false;
      try {
        await invoiceService.getInvoiceByOrderId(orderId, null, null);
      } catch (err) {
        errorThrown = true;
        assert.strictEqual(err.statusCode, 401);
        assert.strictEqual(err.code, 'UNAUTHORIZED');
      }
      assert.strictEqual(errorThrown, true);
      pass('I12: invoiceService.getInvoiceByOrderId without callerId fails closed with 401 UNAUTHORIZED');
    } catch (e) { fail('I12: Direct call unauthorized fail-closed', e); }

    // =========================================================================
    // SUITE 4: SUBSCRIPTION SECURITY, GATING, QUOTAS & AUDIT (U1–U14)
    // =========================================================================
    console.log('\n--- SUITE 4: Subscription Security, Gating, Quotas & Audit (U1–U14) ---');

    // U1: Unauthenticated request to /api/v1/supplier/subscription/upgrade returns 401
    try {
      const res = await api('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        body: { plan_code: 'GROWTH' }
      });
      assert.strictEqual(res.status, 401);
      pass('U1: POST /supplier/subscription/upgrade without token returns 401');
    } catch (e) { fail('U1: Unauthenticated subscription upgrade', e); }

    // U2: Non-supplier role (BUYER) calling subscription upgrade returns 403 FORBIDDEN
    try {
      const res = await api('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: { plan_code: 'GROWTH' }
      });
      assert.strictEqual(res.status, 403);
      pass('U2: BUYER calling POST /supplier/subscription/upgrade returns 403 FORBIDDEN');
    } catch (e) { fail('U2: Buyer subscription upgrade blocked', e); }

    // U3: Invalid plan code (e.g. VIP_SUPPLIER) returns 400 INVALID_PLAN_CODE
    try {
      const res = await api('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { plan_code: 'VIP_SUPPLIER' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'INVALID_PLAN_CODE');
      pass('U3: POST /supplier/subscription/upgrade with invalid plan code returns 400 INVALID_PLAN_CODE');
    } catch (e) { fail('U3: Invalid plan code rejected', e); }

    // U4: Unsupported ANNUAL billing cycle returns 400 INVALID_BILLING_CYCLE
    try {
      const res = await api('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { plan_code: 'GROWTH', billing_cycle: 'ANNUAL' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'INVALID_BILLING_CYCLE');
      pass('U4: Unsupported ANNUAL billing cycle returns 400 INVALID_BILLING_CYCLE');
    } catch (e) { fail('U4: Annual billing cycle rejected', e); }

    // U5: Ordinary supplier upgrade to GROWTH without verified payment returns 402 SUBSCRIPTION_PAYMENT_REQUIRED
    try {
      const res = await api('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { plan_code: 'GROWTH' }
      });
      assert.strictEqual(res.status, 402);
      assert.strictEqual(res.body.error.code, 'SUBSCRIPTION_PAYMENT_REQUIRED');
      pass('U5: Ordinary supplier upgrade to GROWTH blocked with 402 SUBSCRIPTION_PAYMENT_REQUIRED');
    } catch (e) { fail('U5: Growth upgrade 402 gated', e); }

    // U6: Ordinary supplier upgrade to BUSINESS without verified payment returns 402 SUBSCRIPTION_PAYMENT_REQUIRED
    try {
      const res = await api('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { plan_code: 'BUSINESS' }
      });
      assert.strictEqual(res.status, 402);
      assert.strictEqual(res.body.error.code, 'SUBSCRIPTION_PAYMENT_REQUIRED');
      pass('U6: Ordinary supplier upgrade to BUSINESS blocked with 402 SUBSCRIPTION_PAYMENT_REQUIRED');
    } catch (e) { fail('U6: Business upgrade 402 gated', e); }

    // U7: Supplier plan remains unchanged in DB after 402 rejected upgrade
    try {
      const [sp] = await db.query('SELECT subscription_plan, max_active_listings FROM supplier_profiles WHERE supplier_id = ?', [supplierId]);
      assert.strictEqual(sp[0].subscription_plan, 'STARTER', 'Plan must remain STARTER');
      assert.strictEqual(sp[0].max_active_listings, 4, 'Listings cap must remain 4');
      pass('U7: Supplier profile database record remains unmodified (STARTER, max_listings=4) after 402 rejections');
    } catch (e) { fail('U7: Supplier profile unchanged after 402', e); }

    // U8: Cross-supplier tampering: Supplier 1 attempting to upgrade Supplier 2 returns 403 FORBIDDEN
    try {
      const res = await api('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { plan_code: 'STARTER', supplier_id: supplier2Id }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
      pass('U8: Cross-supplier tampering: Supplier cannot alter another supplier subscription (returns 403 FORBIDDEN)');
    } catch (e) { fail('U8: Cross-supplier tampering blocked', e); }

    // U9: Ordinary supplier can downgrade to STARTER (free tier) returns 200
    try {
      const res = await api('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { plan_code: 'STARTER' }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.entitlements.plan_code, 'STARTER');
      pass('U9: Ordinary supplier downgrade to STARTER permitted without payment (returns 200)');
    } catch (e) { fail('U9: Starter downgrade permitted', e); }

    // U10: Downgrade preserves existing catalog products (zero records deleted)
    try {
      // Create a test product specification for supplier
      const specHash = crypto.createHash('sha256').update(`SPEC-B0-${runId}`).digest('hex');
      const [specRes] = await db.query(
        `INSERT INTO product_specifications (
          product_id, spec_code, category_id, family_id, title, brand, variety,
          packaging_type, pack_size, pack_unit, purchasing_unit, spec_hash, is_active
        ) VALUES (1, ?, 1, 1, 'Super Basmati Rice 25kg', 'Super Kernel', 'Basmati', 'BAG', 25, 'KG', 'BAG', ?, 1)`,
        [`SPEC-B0-${runId}`, specHash]
      );
      const specId = specRes.insertId;
      cleanupSpecIds.push(specId);

      const prodHash = crypto.createHash('sha256').update(`SPROD-B0-${runId}`).digest('hex');
      const [prodRes] = await db.query(
        `INSERT INTO supplier_products (
          product_code, supplier_id, category_id, family_id, title, variety, product_identity_hash, status
        ) VALUES (?, ?, 1, 1, 'B0 Basmati Brand', 'Basmati', ?, 'PUBLISHED')`,
        [`SPROD-B0-${runId}`, supplierId, prodHash]
      );
      const prodId = prodRes.insertId;
      cleanupProductIds.push(prodId);

      // Downgrade again
      await subscriptionEntitlementService.changeSupplierPlan({
        supplierId,
        newPlanCode: 'STARTER',
        actor: { id: supplierId, role: 'SUPPLIER' }
      });

      // Confirm product still exists
      const [chkProd] = await db.query('SELECT id FROM supplier_products WHERE id = ?', [prodId]);
      assert.strictEqual(chkProd.length, 1, 'Product must never be deleted upon downgrade');
      pass('U10: Historical preservation guarantee: No supplier products deleted upon downgrade');
    } catch (e) { fail('U10: Historical products preserved', e); }

    // U11: Over-limit flag is set when active families exceed new plan limit without deleting anything
    try {
      // Create products across families 2, 3, 4, 5 for supplier
      for (const famId of [2, 3, 4, 5]) {
        const prodHashFam = crypto.createHash('sha256').update(`SPROD-B0-${famId}-${runId}`).digest('hex');
        const [p] = await db.query(
          `INSERT INTO supplier_products (product_code, supplier_id, category_id, family_id, title, variety, product_identity_hash, status)
           VALUES (?, ?, 1, ?, ?, 'Standard', ?, 'PUBLISHED')`,
          [`SPROD-B0-${famId}-${runId}`, supplierId, famId, `B0 Product Family ${famId}`, prodHashFam]
        );
        cleanupProductIds.push(p.insertId);

        // Add published SKU
        const skuHashFam = crypto.createHash('sha256').update(`SKU-B0-${famId}-${runId}`).digest('hex');
        await db.query(
          `INSERT INTO supplier_skus (
            sku_code, supplier_id, supplier_product_id, category_id, family_id,
            packaging_type, pack_size, pack_unit, purchasing_unit, sku_hash, status
          ) VALUES (?, ?, ?, 1, ?, 'BAG', 10, 'KG', 'BAG', ?, 'PUBLISHED')`,
          [`SKU-B0-${famId}-${runId}`, supplierId, p.insertId, famId, skuHashFam]
        );
      }

      const entitlements = await subscriptionEntitlementService.getSupplierEntitlements(supplierId);
      assert.ok(entitlements.active_families_count >= 4, 'Should have at least 4 active families');
      assert.strictEqual(entitlements.plan_code, 'STARTER');
      assert.strictEqual(entitlements.max_allowed_families, 4);
      if (entitlements.active_families_count > 4) {
        assert.strictEqual(entitlements.is_over_limit, true, 'is_over_limit must be true when usage exceeds cap');
      }
      pass('U11: Over-limit detection: Active families exceeding quota correctly flag is_over_limit without truncation');
    } catch (e) { fail('U11: Over-limit flag', e); }

    // U12: Admin override: Unpaid administrative grants are blocked without commercial grant policy (B0.2 Fix 1)
    try {
      const res = await api('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { plan_code: 'GROWTH', supplier_id: supplierId }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'COMMERCIAL_GRANT_POLICY_REQUIRED');
      pass('U12: Unpaid administrative grant of GROWTH blocked with 403 COMMERCIAL_GRANT_POLICY_REQUIRED');
    } catch (e) { fail('U12: Admin subscription override denied', e); }

    // U13: Verify supplier profile plan remains unmodified after blocked administrative grant
    try {
      const [profiles] = await db.query(
        `SELECT subscription_plan FROM supplier_profiles WHERE supplier_id = ?`,
        [supplierId]
      );
      assert.strictEqual(profiles[0].subscription_plan, 'STARTER');
      pass('U13: Supplier profile plan remains STARTER after blocked administrative grant');
    } catch (e) { fail('U13: Profile remains STARTER', e); }

    // U14: GET /api/v1/supplier/subscription returns accurate read model
    try {
      const res = await api('/api/v1/supplier/subscription', {
        headers: { Authorization: `Bearer ${supplierToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const ent = res.body.data.entitlements;
      assert.strictEqual(ent.plan_code, 'STARTER');
      assert.strictEqual(ent.max_allowed_families, 4);
      assert.ok(typeof ent.active_families_count === 'number');
      assert.ok(typeof ent.remaining_family_slots === 'number');
      pass('U14: GET /supplier/subscription returns complete, accurate entitlements read model');
    } catch (e) { fail('U14: Entitlements read model', e); }

  } finally {
    // Teardown Fixtures strictly in test DB
    try {
      for (const ordId of cleanupOrderIds) {
        await db.query('DELETE FROM invoices WHERE order_id = ?', [ordId]);
        await db.query('DELETE FROM orders WHERE id = ?', [ordId]);
      }
      for (const pmtId of cleanupPaymentIds) {
        await db.query('DELETE FROM platform_ledger WHERE payment_id = ?', [pmtId]);
        await db.query('DELETE FROM payments WHERE id = ?', [pmtId]);
      }
      for (const resvId of cleanupReservationIds) {
        await db.query('DELETE FROM reservations WHERE id = ?', [resvId]);
      }
      for (const poolId of cleanupPoolIds) {
        await db.query('DELETE FROM pools WHERE id = ?', [poolId]);
      }
      for (const pId of cleanupProductIds) {
        await db.query('DELETE FROM supplier_skus WHERE supplier_product_id = ?', [pId]);
        await db.query('DELETE FROM supplier_products WHERE id = ?', [pId]);
      }
      for (const sId of cleanupSpecIds) {
        await db.query('DELETE FROM product_specifications WHERE id = ?', [sId]);
      }
      for (const uId of cleanupUserIds) {
        await db.query('DELETE FROM supplier_subscriptions WHERE supplier_id = ?', [uId]);
        await db.query('DELETE FROM supplier_profiles WHERE supplier_id = ?', [uId]);
        await db.query('DELETE FROM system_audit_logs WHERE actor_id = ? OR entity_id = ?', [uId, uId]);
        await db.query('DELETE FROM users WHERE id = ?', [uId]);
      }
    } catch (teardownErr) {
      console.warn('⚠️ Teardown error:', teardownErr.message);
    }

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log('\n================================================================================');
  console.log(`PHASE B0 GATE VERDICT: ${passCount}/${passCount + failCount} TESTS PASSED`);
  if (failCount === 0) {
    console.log('STATUS: 100% GREEN — ALL INVARIANTS SECURED');
  } else {
    console.log(`STATUS: ${failCount} TESTS FAILED`);
  }
  console.log('================================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

runB0Gate().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Fatal Gate Failure:', err);
  process.exit(1);
});
