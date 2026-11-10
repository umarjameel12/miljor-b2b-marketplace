// =============================================================================
// backend/tests/phase_b0_2_safety_closure_gate.js
// MilJor Phase B0.2: Backend Safety Closure Automated Gate
//
// SUITES:
//   Suite 1: Admin Subscription Bypass Hardening (Fix 1)
//   Suite 2: Invoice Internal Authority Hardening (Fix 2)
//   Suite 3: Exact Payment Provider Provenance (Fix 3)
//   Suite 4: Safepay Amount Handling Contract (Fix 4)
//   Suite 5: Legacy Refund False Completion Prevention (Fix 5)
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
const invoiceService = require('../src/services/invoiceService');
const subscriptionEntitlementService = require('../src/services/subscriptionEntitlementService');
const safepayAdapter = require('../src/services/safepayAdapter');
const safepayCheckoutService = require('../src/services/safepayCheckoutService');
const paymentProviderService = require('../src/services/paymentProviderService');

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

const cleanup = {
  users: [],
  orders: [],
  payments: [],
  payment_attempts: [],
  invoices: [],
  supplier_profiles: [],
  audit_logs: []
};

async function createTestUser(role, namePrefix = 'B02') {
  const rand = Math.floor(Math.random() * 900000) + 100000;
  const phone = `+923${Math.floor(Math.random() * 900000000 + 100000000)}`;
  const email = `b02_${rand}@miljor.test`;
  const [res] = await db.query(
    `INSERT INTO users (full_name, email, phone, business_name, password_hash, role, verification_status, buyer_trust_status)
     VALUES (?, ?, ?, ?, 'hashed_pass', ?, 'VERIFIED', 'CONTACT_VERIFIED')`,
    [`${namePrefix}_${rand}`, email, phone, `${namePrefix} Business ${rand}`, role]
  );
  cleanup.users.push(res.insertId);
  return res.insertId;
}

async function createTestSupplier(namePrefix = 'B02_SUP') {
  const userId = await createTestUser('SUPPLIER', namePrefix);
  const [res] = await db.query(
    `INSERT INTO supplier_profiles (
      supplier_id, business_type, verification_status, subscription_plan,
      subscription_status, max_active_listings, transaction_fee_percent, tax_ntn, warehouse_address
    ) VALUES (?, 'DISTRIBUTOR', 'VERIFIED', 'STARTER', 'STARTER_ACTIVE', 4, 5.0, 'NTN-TEST-B02', 'Lahore Hub')`,
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
    [`ORD-B02-${rand}`, buyerId, supplierId, subtotal, subtotal, totalAmount, paymentStatus, orderStatus]
  );
  cleanup.orders.push(res.insertId);
  return res.insertId;
}

async function createTestAttempt(orderId, buyerId, trackerToken, amount = '1500.00', currency = 'PKR', provider = 'SAFEPAY') {
  const rand = Math.floor(Math.random() * 900000) + 100000;
  const [res] = await db.query(
    `INSERT INTO payment_attempts (attempt_code, order_id, buyer_id, provider, environment, provider_tracker_token, checkout_url, amount, currency, status, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, 'sandbox', ?, 'https://sandbox.api.getsafepay.com/checkout/pay?beacon=test', ?, ?, 'INITIATED', ?, NOW())`,
    [`ATT-B02-${rand}`, orderId, buyerId, provider, trackerToken, amount, currency, `IDEM-${rand}`]
  );
  cleanup.payment_attempts.push(res.insertId);
  return res.insertId;
}

async function createTestPayment(orderId, buyerId, amount = '1500.00', status = 'PENDING', paymentMethod = 'CARD', providerResponse = null, transactionRef = null) {
  const rand = Math.floor(Math.random() * 900000) + 100000;
  const respJson = providerResponse ? JSON.stringify(providerResponse) : null;
  const [res] = await db.query(
    `INSERT INTO payments (payment_code, order_id, buyer_id, amount, buyer_fee, payment_method, status, escrow_status, transaction_ref, provider_response, created_at)
     VALUES (?, ?, ?, ?, '50.00', ?, ?, 'HELD_IN_ESCROW', ?, ?, NOW())`,
    [`PMT-B02-${rand}`, orderId, buyerId, amount, paymentMethod, status, transactionRef, respJson]
  );
  cleanup.payments.push(res.insertId);
  return res.insertId;
}

async function runB02Gate() {
  console.log('\n================================================================================');
  console.log('MILJOR PHASE B0.2: BACKEND SAFETY CLOSURE AUTOMATED GATE');
  console.log('================================================================================\n');

  const [dbRows] = await db.query('SELECT DATABASE() as active_db');
  const activeDb = dbRows[0].active_db;
  assert.strictEqual(activeDb, 'miljor_test_db', 'FATAL: Test gate must run strictly against miljor_test_db');
  console.log(`✅ Active Test Database Verified: ${activeDb}\n`);

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve();
    });
  });

  try {
    // -------------------------------------------------------------------------
    // SUITE 1: Admin Subscription Bypass Hardening (Fix 1)
    // -------------------------------------------------------------------------
    console.log('--- SUITE 1: Admin Subscription Bypass Hardening (Fix 1) ---');
    const supplier1 = await createTestSupplier('B02_SUP_SUB');
    const supplier1Token = generateToken(supplier1, 'SUPPLIER');
    const admin1 = await createTestUser('ADMIN', 'B02_ADMIN_SUB');
    const admin1Token = generateToken(admin1, 'ADMIN');
    const superAdmin1 = await createTestUser('SUPER_ADMIN', 'B02_SADMIN_SUB');
    const superAdmin1Token = generateToken(superAdmin1, 'SUPER_ADMIN');
    const buyer1 = await createTestUser('BUYER', 'B02_BUYER_SUB');
    const buyer1Token = generateToken(buyer1, 'BUYER');

    // 1.1: Supplier self-upgrade to GROWTH denied with 402
    {
      const res = await api('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplier1Token}` },
        body: { plan_code: 'GROWTH' }
      });
      assert.strictEqual(res.status, 402);
      assert.strictEqual(res.data?.error?.code, 'SUBSCRIPTION_PAYMENT_REQUIRED');
      pass('1.1: Supplier self-upgrade to GROWTH denied with 402');
    }

    // 1.2: ADMIN unpaid grant to GROWTH denied with 403 COMMERCIAL_GRANT_POLICY_REQUIRED
    {
      const res = await api('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin1Token}` },
        body: { plan_code: 'GROWTH', supplier_id: supplier1 }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data?.error?.code, 'COMMERCIAL_GRANT_POLICY_REQUIRED');
      pass('1.2: ADMIN unpaid grant to GROWTH denied with 403 COMMERCIAL_GRANT_POLICY_REQUIRED');
    }

    // 1.3: SUPER_ADMIN grant denied without approved commercial policy
    {
      const res = await api('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${superAdmin1Token}` },
        body: { plan_code: 'BUSINESS', supplier_id: supplier1 }
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data?.error?.code, 'COMMERCIAL_GRANT_POLICY_REQUIRED');
      pass('1.3: SUPER_ADMIN grant denied with 403 without approved policy');
    }

    // 1.4: Buyer role upgrade attempt denied with 403 FORBIDDEN
    {
      const res = await api('/api/v1/supplier/subscription/upgrade', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}` },
        body: { plan_code: 'GROWTH', supplier_id: supplier1 }
      });
      assert.strictEqual(res.status, 403);
      pass('1.4: Buyer role upgrade attempt denied with 403');
    }

    // 1.5: Supplier profile plan remains STARTER after all rejected attempts
    {
      const [profiles] = await db.query(
        'SELECT subscription_plan, max_active_listings FROM supplier_profiles WHERE supplier_id = ?',
        [supplier1]
      );
      assert.strictEqual(profiles[0].subscription_plan, 'STARTER');
      assert.strictEqual(profiles[0].max_active_listings, 4);
      pass('1.5: Supplier profile plan remains STARTER in DB after rejections');
    }

    // 1.6: Entitlements read model remains accurate
    {
      const ent = await subscriptionEntitlementService.getSupplierEntitlements(supplier1);
      assert.strictEqual(ent.plan_code, 'STARTER');
      assert.strictEqual(ent.max_allowed_families, 4);
      pass('1.6: Historical entitlements read model preserved');
    }

    // -------------------------------------------------------------------------
    // SUITE 2: Invoice Internal Authority Hardening (Fix 2)
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 2: Invoice Internal Authority Hardening (Fix 2) ---');
    const invBuyer = await createTestUser('BUYER', 'B02_INV_BUY');
    const invSupplier = await createTestSupplier('B02_INV_SUP');
    const invOrder = await createTestOrder(invBuyer, invSupplier, '4000.00', 'PAID', 'PAID');

    // 2.1: Missing caller context throws 403
    {
      let caught = false;
      try {
        await invoiceService.generateInvoiceForOrder(invOrder, null);
      } catch (err) {
        caught = true;
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'INVOICE_ACCESS_FORBIDDEN');
      }
      assert.strictEqual(caught, true);
      pass('2.1: Missing caller context throws 403 INVOICE_ACCESS_FORBIDDEN');
    }

    // 2.2: Plain boolean bypass { isSystemInternal: true } throws 403
    {
      let caught = false;
      try {
        await invoiceService.generateInvoiceForOrder(invOrder, { isSystemInternal: true });
      } catch (err) {
        caught = true;
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'INVOICE_ACCESS_FORBIDDEN');
      }
      assert.strictEqual(caught, true);
      pass('2.2: Plain boolean bypass { isSystemInternal: true } throws 403');
    }

    // 2.3: Third-party caller throws 403
    {
      let caught = false;
      try {
        await invoiceService.generateInvoiceForOrder(invOrder, { id: 999997, role: 'BUYER' });
      } catch (err) {
        caught = true;
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, 'INVOICE_ACCESS_FORBIDDEN');
      }
      assert.strictEqual(caught, true);
      pass('2.3: Third-party caller throws 403');
    }

    // 2.4: Exactly 0 invoice rows inserted in DB after all 3 unauthorized attempts
    {
      const [invRows] = await db.query('SELECT COUNT(*) as c FROM invoices WHERE order_id = ?', [invOrder]);
      assert.strictEqual(invRows[0].c, 0);
      pass('2.4: Exactly 0 invoice rows created in DB after rejected calls');
    }

    // 2.5: Authorized buyer successfully generates invoice
    {
      const invoice = await invoiceService.generateInvoiceForOrder(invOrder, { id: invBuyer, role: 'BUYER' });
      assert.ok(invoice.invoice_number.startsWith('INV-'));
      cleanup.invoices.push(invoice.id);
      pass('2.5: Authorized buyer successfully generates invoice');
    }

    // -------------------------------------------------------------------------
    // SUITE 3: Exact Payment Provider Provenance (Fix 3)
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 3: Exact Payment Provider Provenance (Fix 3) ---');
    const provBuyer = await createTestUser('BUYER', 'B02_PROV_BUY');
    const provSupplier = await createTestSupplier('B02_PROV_SUP');
    const provBuyerToken = generateToken(provBuyer, 'BUYER');
    const provOrder = await createTestOrder(provBuyer, provSupplier, '2000.00', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT');

    // Create 2 attempts on same order: Attempt 1 has provider 'OLD_PROVIDER', Attempt 2 has 'SAFEPAY'
    const tracker1 = `track_attempt1_${Date.now()}`;
    const tracker2 = `track_attempt2_${Date.now()}`;
    await createTestAttempt(provOrder, provBuyer, tracker1, '2000.00', 'PKR', 'UNAPPROVED_GATEWAY');
    await createTestAttempt(provOrder, provBuyer, tracker2, '2000.00', 'PKR', 'SAFEPAY');

    // 3.1: Payment linked uniquely to tracker2 resolves SAFEPAY, NOT first attempt by order_id
    {
      const pmt = await createTestPayment(provOrder, provBuyer, '2000.00', 'PENDING', 'CARD', null, tracker2);

      // Capture the provider actually passed to the verifier; HTTP 402 alone cannot prove provenance.
      const originalVerify = paymentProviderService.verifyPayment;
      let observedProvider = null;
      let res;
      try {
        paymentProviderService.verifyPayment = async (args) => {
          observedProvider = args.provider;
          return originalVerify.call(paymentProviderService, args);
        };
        res = await api('/api/v1/payments/verify', {
          method: 'POST',
          headers: { Authorization: `Bearer ${provBuyerToken}` },
          body: { payment_id: pmt, transaction_ref: tracker2 }
        });
      } finally {
        paymentProviderService.verifyPayment = originalVerify;
      }
      assert.strictEqual(res.status, 402);
      assert.strictEqual(res.data?.error?.code, 'PAYMENT_VERIFICATION_FAILED');
      assert.strictEqual(observedProvider, 'SAFEPAY', 'Must use exact linked attempt, not first attempt on order');
      pass('3.1: Correct SAFEPAY provider actually selected from exact tracker');
    }

    // 3.2: Payment with missing provenance and non-SAFEPAY method fails closed with 402
    {
      const pmtUnknown = await createTestPayment(provOrder, provBuyer, '2000.00', 'PENDING', 'CARD', null, null);
      const res = await api('/api/v1/payments/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${provBuyerToken}` },
        body: { payment_id: pmtUnknown, transaction_ref: 'SOME-REF' }
      });
      assert.strictEqual(res.status, 402);
      assert.strictEqual(res.data?.error?.code, 'PAYMENT_VERIFICATION_FAILED');
      pass('3.2: Ambiguous or missing provenance fails closed');
    }
    
    // 3.3: A tracker owned by another order must not be accepted as this payment's provenance.
    {
      const otherOrder = await createTestOrder(provBuyer, provSupplier, '2000.00', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT');
      const mismatchedPayment = await createTestPayment(otherOrder, provBuyer, '2000.00', 'PENDING', 'CARD', null, tracker2);
      const originalVerify = paymentProviderService.verifyPayment;
      let invoked = false;
      let res;
      try {
        paymentProviderService.verifyPayment = async (...args) => {
          invoked = true;
          return originalVerify.apply(paymentProviderService, args);
        };
        res = await api('/api/v1/payments/verify', {
          method: 'POST',
          headers: { Authorization: `Bearer ${provBuyerToken}` },
          body: { payment_id: mismatchedPayment, transaction_ref: tracker2 }
        });
      } finally {
        paymentProviderService.verifyPayment = originalVerify;
      }
      assert.strictEqual(res.status, 402);
      assert.strictEqual(invoked, false, 'Do not invoke provider verifier for tracker/order mismatch');
      const [paymentRows] = await db.query('SELECT status FROM payments WHERE id = ?', [mismatchedPayment]);
      assert.strictEqual(paymentRows[0].status, 'PENDING');
      pass('3.3: Foreign-order tracker fails closed without provider call or financial mutation');
    }

    // 3.4: Even a future adapter returning verified=true must not reactivate legacy financial writes.
    {
      const payment = await createTestPayment(provOrder, provBuyer, '2000.00', 'PENDING', 'CARD', { provider: 'SAFEPAY' }, tracker2);
      const originalVerify = paymentProviderService.verifyPayment;
      let res;
      try {
        paymentProviderService.verifyPayment = async () => ({ verified: true, raw: { test: true } });
        res = await api('/api/v1/payments/verify', {
          method: 'POST',
          headers: { Authorization: `Bearer ${provBuyerToken}` },
          body: { payment_id: payment, transaction_ref: tracker2 }
        });
      } finally {
        paymentProviderService.verifyPayment = originalVerify;
      }
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.data?.error?.code, 'LEGACY_VERIFICATION_DISABLED');
      const [paymentRows] = await db.query('SELECT status FROM payments WHERE id = ?', [payment]);
      assert.strictEqual(paymentRows[0].status, 'PENDING');
      const [ledgerRows] = await db.query('SELECT COUNT(*) AS c FROM platform_ledger WHERE payment_id = ?', [payment]);
      assert.strictEqual(Number(ledgerRows[0].c), 0);
      pass('3.4: Even verified-like legacy response cannot create PAID or ledger mutations');
    }

    // -------------------------------------------------------------------------
    // SUITE 4: Safepay Amount Handling Contract (Fix 4)
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 4: Safepay Amount Handling Contract (Fix 4) ---');
    const sfBuyer = await createTestUser('BUYER', 'B02_SF_BUY');
    const sfSupplier = await createTestSupplier('B02_SF_SUP');
    const sfOrder = await createTestOrder(sfBuyer, sfSupplier, '1000.00', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT');
    const sfTracker = `track_amount_${Date.now()}`;
    await createTestAttempt(sfOrder, sfBuyer, sfTracker, '1000.00', 'PKR', 'SAFEPAY');

    const webhookSecret = safepayAdapter.webhookSecret || process.env.SAFEPAY_WEBHOOK_SECRET || 'safepay_dev_webhook_secret_key_2026';
    function signWebhook(payloadStr) {
      return crypto.createHmac('sha512', webhookSecret).update(Buffer.from(payloadStr, 'utf8')).digest('hex');
    }

    // 4.1: Webhook sending 100x subunit amount (100000 instead of 1000.00) is REJECTED with 422 AMOUNT_MISMATCH
    {
      const subunitPayload = JSON.stringify({
        event: 'payment.completed',
        data: {
          token: sfTracker,
          tracker: sfTracker,
          net: 100000, // 100x order total
          currency: 'PKR',
          metadata: { order_id: sfOrder }
        }
      });
      const sig = signWebhook(subunitPayload);

      const res = await api('/api/v1/payments/webhook/safepay', {
        method: 'POST',
        headers: {
          'x-sfpy-signature': sig,
          'Content-Type': 'application/json'
        },
        body: subunitPayload
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.data?.error?.code, 'AMOUNT_MISMATCH');
      pass('4.1: Webhook sending 100x subunit amount is rejected with 422 AMOUNT_MISMATCH');
    }

    // 4.2: Webhook sending exact major unit amount (1000.00) succeeds with 200
    {
      const exactPayload = JSON.stringify({
        event: 'payment.completed',
        data: {
          token: sfTracker,
          tracker: sfTracker,
          net: 1000.00,
          currency: 'PKR',
          metadata: { order_id: sfOrder }
        }
      });
      const sig = signWebhook(exactPayload);

      const res = await api('/api/v1/payments/webhook/safepay', {
        method: 'POST',
        headers: {
          'x-sfpy-signature': sig,
          'Content-Type': 'application/json'
        },
        body: exactPayload
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data?.success, true);

      // Verify DB order state is PAID
      const [orderRows] = await db.query('SELECT order_status FROM orders WHERE id = ?', [sfOrder]);
      assert.strictEqual(orderRows[0].order_status, 'PAID');
      pass('4.2: Webhook sending exact major unit amount confirms order as PAID');
    }

    // -------------------------------------------------------------------------
    // SUITE 5: Legacy Refund False Completion Prevention (Fix 5)
    // -------------------------------------------------------------------------
    console.log('\n--- SUITE 5: Legacy Refund False Completion Prevention (Fix 5) ---');
    const refBuyer = await createTestUser('BUYER', 'B02_REF_BUY');
    const refSupplier = await createTestSupplier('B02_REF_SUP');
    const refOrder = await createTestOrder(refBuyer, refSupplier, '5000.00', 'PAID', 'PAID');
    const refPayment = await createTestPayment(refOrder, refBuyer, '5000.00', 'PAID', 'CARD', { provider: 'SAFEPAY' }, 'track_ref_123');

    const financeAdmin = await createTestUser('FINANCE_ADMIN', 'B02_FIN_ADM');
    const financeAdminToken = generateToken(financeAdmin, 'FINANCE_ADMIN');

    // 5.1: Legacy refund endpoint does NOT mark payment REFUNDED in DB
    {
      const res = await api(`/api/v1/payments/${refPayment}/refund`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${financeAdminToken}` },
        body: { reason: 'Test cancellation' }
      });
      // Returns 503 REFUND_PENDING_GATEWAY because external execution is disabled
      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.data?.error?.code, 'REFUND_PENDING_GATEWAY');

      // Verify DB payment status is STILL 'PAID', not 'REFUNDED'
      const [rows] = await db.query('SELECT status, escrow_status FROM payments WHERE id = ?', [refPayment]);
      assert.strictEqual(rows[0].status, 'PAID');
      assert.strictEqual(rows[0].escrow_status, 'HELD_IN_ESCROW');
      pass('5.1: Payment remains PAID and escrow remains HELD_IN_ESCROW in DB');
      const [blockedLogs] = await db.query(
        `SELECT id, new_value FROM system_audit_logs
         WHERE actor_id = ? AND entity_name = 'payments' AND entity_id = ?
           AND action = 'PAYMENT_REFUND_ATTEMPT_BLOCKED' ORDER BY id DESC LIMIT 1`,
        [financeAdmin, refPayment]
      );
      assert.strictEqual(blockedLogs.length, 1, 'Blocked refund attempt must have a truthful audit trail');
      assert.strictEqual(JSON.parse(blockedLogs[0].new_value).outcome, 'REFUND_PENDING_GATEWAY');
      cleanup.audit_logs.push(blockedLogs[0].id);
      pass('5.1a: Pending Safepay refund attempt audited as blocked, not completed');
    }

    // 5.2: Platform ledger payout_status is NOT mutated to REFUNDED_TO_BUYER
    {
      const [ledgerRows] = await db.query('SELECT payout_status FROM platform_ledger WHERE payment_id = ?', [refPayment]);
      if (ledgerRows.length > 0) {
        assert.notStrictEqual(ledgerRows[0].payout_status, 'REFUNDED_TO_BUYER');
      }
      pass('5.2: Platform ledger is not prematurely updated to REFUNDED_TO_BUYER');
    }

    // 5.3: Unsupported payment provider refund is rejected with 400
    {
      const unsuppOrder = await createTestOrder(refBuyer, refSupplier, '1500.00', 'PAID', 'PAID');
      const unsuppPayment = await createTestPayment(unsuppOrder, refBuyer, '1500.00', 'PAID', 'MOCK_GATEWAY', { provider: 'UNKNOWN_GATEWAY' });
      const res = await api(`/api/v1/payments/${unsuppPayment}/refund`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${financeAdminToken}` },
        body: { reason: 'Test' }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data?.error?.code, 'UNSUPPORTED_PAYMENT_PROVIDER');
      pass('5.3: Unsupported provider refund rejected with 400');
      const [blockedLogs] = await db.query(
        `SELECT id, new_value FROM system_audit_logs
         WHERE actor_id = ? AND entity_name = 'payments' AND entity_id = ?
           AND action = 'PAYMENT_REFUND_ATTEMPT_BLOCKED' ORDER BY id DESC LIMIT 1`,
        [financeAdmin, unsuppPayment]
      );
      assert.strictEqual(blockedLogs.length, 1);
      assert.strictEqual(JSON.parse(blockedLogs[0].new_value).outcome, 'UNSUPPORTED_PAYMENT_PROVIDER');
      cleanup.audit_logs.push(blockedLogs[0].id);
      pass('5.3a: Unsupported refund attempt audited as blocked');
    }

  } catch (err) {
    console.error('\n❌ UNHANDLED EXCEPTION IN B0.2 GATE:', err);
    failedCount++;
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

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
      if (cleanup.users.length > 0) {
        await db.query(`DELETE FROM users WHERE id IN (?)`, [cleanup.users]);
      }
      console.log('✅ All test fixtures safely removed from miljor_test_db');
    } catch (cleanErr) {
      console.error('⚠️ Cleanup error:', cleanErr);
    }
  }

  console.log('\n================================================================================');
  console.log(`PHASE B0.2 GATE VERDICT: ${passedCount} PASSED, ${failedCount} FAILED`);
  if (failedCount === 0) {
    console.log('STATUS: 100% GREEN — ALL B0.2 SAFETY CLOSURES VERIFIED');
  } else {
    console.log('STATUS: FAILED — REMEDIATION REQUIRED');
  }
  console.log('================================================================================\n');

  process.exit(failedCount === 0 ? 0 : 1);
}

runB02Gate();
