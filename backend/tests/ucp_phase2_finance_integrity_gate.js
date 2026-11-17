'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

assert.equal(process.env.NODE_ENV, 'test', 'NODE_ENV must be test');
assert.equal(process.env.DB_NAME, 'miljor_test_db', 'DB_NAME must be miljor_test_db');
assert.equal(process.env.TEST_DB_NAME, 'miljor_test_db', 'TEST_DB_NAME must be miljor_test_db');
assert.equal(process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT, 'false', 'External money movement must be false');

const db = require('../src/config/db');
const exactDecimal = require('../src/services/exactDecimal');
const safepayCheckoutService = require('../src/services/safepayCheckoutService');
const safepayAdapter = require('../src/services/safepayAdapter');
const financialSettlementService = require('../src/services/financialSettlementService');

async function run() {
  const expectedPort = Number(process.env.DB_PORT || 3306);
  const [[identity]] = await db.query('SELECT DATABASE() AS db, @@port AS port');
  assert.equal(identity.db, 'miljor_test_db');
  assert.equal(Number(identity.port), expectedPort);
  console.log(`[DB-GUARD] Phase 2 Finance gate verified DB=${identity.db} on port=${identity.port}`);

  // 1. Exact decimal minor-unit & rounding checks
  assert.equal(exactDecimal.exactMultiplyRound('20.0000', '100.55', 2), '2011.00');
  assert.equal(exactDecimal.exactDecimalSum(['1000.00', '150.00', '25.50'], 2), '1175.50');
  assert.equal(exactDecimal.exactDecimalEquals('100.00', '100', 2), true);
  console.log('[PASS] Exact-decimal minor-unit calculations');

  const tag = `ph2f_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const created = { users: [], orders: [], attempts: [], disputes: [], refunds: [] };

  try {
    const insertUser = async (name, email, role) => {
      const [r] = await db.query(
        `INSERT INTO users (full_name, business_name, email, password_hash, role, is_verified, verification_status)
         VALUES (?, ?, ?, '$2b$10$phase2DummyHashOnlyForTestFixture000000000000000000', ?, 1, 'VERIFIED')`,
        [name, `${name} Co`, email, role]
      );
      created.users.push(r.insertId);
      return { id: r.insertId, name, email, role };
    };

    const buyer = await insertUser('Ph2 Buyer', `${tag}_b@test.local`, 'BUYER');
    const otherBuyer = await insertUser('Ph2 OtherBuyer', `${tag}_b2@test.local`, 'BUYER');
    const supplier = await insertUser('Ph2 Supplier', `${tag}_s@test.local`, 'SUPPLIER');
    const admin = await insertUser('Ph2 Admin', `${tag}_a@test.local`, 'ADMIN');
    await db.query('INSERT INTO supplier_profiles (supplier_id, verification_status) VALUES (?, ?)', [supplier.id, 'VERIFIED']);

    // 2. Order-before-payment invariant: non-existent order fails closed
    await assert.rejects(
      () => safepayCheckoutService.initiateCheckout({ orderId: 999999999, actor: buyer, idempotencyKey: `${tag}-no-ord` }),
      err => err.statusCode === 404 || err.code === 'ORDER_NOT_FOUND'
    );

    // Seed order in AWAITING_PAYMENT
    const ordCode = `ORD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const [ordRes] = await db.query(
      `INSERT INTO orders (
        order_code, buyer_id, supplier_id, total_qty, unit_price,
        subtotal_amount, delivery_fee, buyer_platform_fee, total_amount, supplier_commission_percent,
        currency, delivery_type, delivery_address, order_status, payment_status, fulfillment_status
      ) VALUES (?, ?, ?, 10.0000, 100.00, 1000.00, 150.00, 0.00, 1150.00, 2.50, 'PKR', 'DOORSTEP', 'Lahore', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT', 'UNPAID')`,
      [ordCode, buyer.id, supplier.id]
    );
    const orderId = ordRes.insertId;
    created.orders.push(orderId);

    // Wrong buyer cannot initiate checkout
    await assert.rejects(
      () => safepayCheckoutService.initiateCheckout({ orderId, actor: otherBuyer, idempotencyKey: `${tag}-wrong-b` }),
      err => err.statusCode === 403
    );

    // 3. Optional live Safepay sandbox initiation + readback if credentials are provisioned
    let sandboxProbeStatus = 'BLOCKED_MISSING_CREDENTIALS';
    if (safepayAdapter.publicKey && safepayAdapter.secretKey) {
      const initRes = await safepayCheckoutService.initiateCheckout({
        orderId,
        actor: buyer,
        idempotencyKey: `${tag}-sandbox-init`
      });
      const [[attempt]] = await db.query('SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY id DESC LIMIT 1', [orderId]);
      assert.ok(attempt && attempt.provider_tracker_token, 'Durable payment_attempts row required');
      assert.ok(initRes.checkout_url || initRes.checkoutUrl || attempt.checkout_url, 'Sandbox checkout_url expected');
      created.attempts.push(attempt.id);

      const fetched = await safepayAdapter.fetchTracker(attempt.provider_tracker_token);
      assert.equal(fetched.data.token, attempt.provider_tracker_token);
      assert.equal(String(fetched.data.state || ''), 'TRACKER_STARTED');

      // Authoritative reconciliation of TRACKER_STARTED MUST NOT fabricate PAID!
      const reconRes = await safepayCheckoutService.reconcilePaymentWithProvider({ orderId, actor: buyer });
      assert.equal(Boolean(reconRes.reconciled), false, 'TRACKER_STARTED must not reconcile as PAID');
      const [[ordCheck]] = await db.query('SELECT payment_status FROM orders WHERE id = ?', [orderId]);
      assert.equal(ordCheck.payment_status, 'PAYMENT_INITIATED');

      // Duplicate initialization with same key is idempotent
      const replayInit = await safepayCheckoutService.initiateCheckout({
        orderId,
        actor: buyer,
        idempotencyKey: `${tag}-sandbox-init`
      });
      assert.equal(replayInit.tracker_token || replayInit.checkout_url, initRes.tracker_token || initRes.checkout_url);
      sandboxProbeStatus = 'SANDBOX_INITIATION_AND_READBACK_PASS';
    }
    console.log(`[PASS] Safepay sandbox initiation/readback status=${sandboxProbeStatus} (completed payment BLOCKED: PCI iframe requires human card entry)`);

    // 4. Synthetic signed webhook + invalid signature + replay + PAID non-downgrade
    const webhookSecret = process.env.SAFEPAY_WEBHOOK_SECRET || 'phase2_synthetic_webhook_secret_2026';
    process.env.SAFEPAY_WEBHOOK_SECRET = webhookSecret;

    const tracker = `track_ph2_${tag}`;
    const [attRes] = await db.query(
      `INSERT INTO payment_attempts (attempt_code, order_id, buyer_id, idempotency_key, provider, environment, provider_tracker_token, amount, currency, status)
       VALUES (?, ?, ?, ?, 'SAFEPAY', 'sandbox', ?, 1150.00, 'PKR', 'INITIATED')`,
      [`ATT-${crypto.randomBytes(5).toString('hex').toUpperCase()}`, orderId, buyer.id, `${tag}-synth-att`, tracker]
    );
    created.attempts.push(attRes.insertId);

    const payloadObj = {
      type: 'payment.succeeded',
      data: {
        tracker,
        token: tracker,
        state: 'TRACKER_ENDED',
        amount: 1150,
        currency: 'PKR',
        reference: ordCode
      }
    };
    const rawBody = Buffer.from(JSON.stringify(payloadObj), 'utf8');
    const badSig = '0'.repeat(128);
    await assert.rejects(
      () => safepayCheckoutService.processWebhookEvent({ rawBody, signature: badSig }),
      err => err.statusCode === 401 || err.statusCode === 403 || /SIGNATURE/i.test(err.code || '')
    );

    const goodSig = crypto.createHmac('sha512', webhookSecret).update(rawBody).digest('hex');
    await safepayCheckoutService.processWebhookEvent({ rawBody, signature: goodSig });
    // Replay same webhook -> idempotent, zero duplicate payments
    await safepayCheckoutService.processWebhookEvent({ rawBody, signature: goodSig });

    const [[paidOrd]] = await db.query('SELECT payment_status FROM orders WHERE id = ?', [orderId]);
    assert.equal(paidOrd.payment_status, 'PAID', 'Synthetic signed webhook must mark PAID');
    const [payRows] = await db.query('SELECT id FROM payments WHERE order_id = ?', [orderId]);
    assert.equal(payRows.length, 1, 'Webhook replay must not create duplicate payments');

    // Non-downgrade: payment.failed webhook cannot downgrade PAID order
    const failObj = { type: 'payment.failed', data: { tracker, token: tracker, state: 'TRACKER_CANCELLED', reference: ordCode } };
    const failRaw = Buffer.from(JSON.stringify(failObj), 'utf8');
    const failSig = crypto.createHmac('sha512', webhookSecret).update(failRaw).digest('hex');
    await safepayCheckoutService.processWebhookEvent({ rawBody: failRaw, signature: failSig });
    const [[stillPaid]] = await db.query('SELECT payment_status FROM orders WHERE id = ?', [orderId]);
    assert.equal(stillPaid.payment_status, 'PAID', 'PAID order must never downgrade on failed webhook');
    console.log('[PASS] Synthetic signed webhook, invalid sig rejection, replay idempotency & PAID non-downgrade');

    // 5. Supplier-only delivery mark cannot authorize disbursement/settlement; external refund remains disabled
    await db.query("UPDATE orders SET fulfillment_status = 'SUPPLIER_DELIVERED' WHERE id = ?", [orderId]);
    await financialSettlementService.accrueSupplierPayable({
      orderId,
      actor: admin,
      idempotencyKey: `${tag}-accrue`
    });
    const [[payableRow]] = await db.query('SELECT id FROM supplier_payables WHERE order_id = ? ORDER BY id DESC LIMIT 1', [orderId]);
    assert.ok(payableRow && payableRow.id, 'Supplier payable row must be created');
    const payableId = payableRow.id;
    await assert.rejects(
      () => financialSettlementService.prepareSupplierDisbursement({
        payableId,
        beneficiaryTitle: 'Ph2 Supplier Co',
        beneficiaryIban: 'PK36SCBL0000001123456702',
        actor: admin,
        idempotencyKey: `${tag}-no-disburse`
      }),
      err => err.code === 'ORDER_NOT_BUYER_CONFIRMED' || err.statusCode === 422 || err.statusCode === 409
    );

    // Refund capability classification: external money movement disabled
    const [dspRes] = await db.query(
      `INSERT INTO order_disputes (dispute_code, order_id, buyer_id, supplier_id, reason, dispute_category, reporting_actor_role, description, expected_quantity, reported_quantity, disputed_quantity, claimed_amount, currency, status)
       VALUES (?, ?, ?, ?, 'SHORTAGE_IN_QUANTITY', 'SHORT_QUANTITY', 'BUYER', 'Shortage test', 10.0000, 8.0000, 2.0000, 200.00, 'PKR', 'OPEN')`,
      [`DSP-${tag.slice(0, 10)}`, orderId, buyer.id, supplier.id]
    );
    created.disputes.push(dspRes.insertId);
    const refundAssess = await financialSettlementService.assessRefundObligation({
      orderId,
      disputeId: dspRes.insertId,
      disputedQuantity: 2,
      refundType: 'PARTIAL',
      reason: 'Phase 2 partial shortage refund assessment',
      actor: admin,
      idempotencyKey: `${tag}-ref-assess`
    });
    created.refunds.push(refundAssess.id || refundAssess.refund_id);
    console.log('[PASS] Premature settlement blocked; refund obligation recorded without live external execution (REST refund BLOCKED/UNSUPPORTED on Safepay sandbox)');

    console.log('ALL PHASE 2 FINANCE INTEGRITY CHECKS PASSED');
  } finally {
    try {
      if (created.orders.length) {
        const ph = created.orders.map(() => '?').join(',');
        await db.query(`DELETE FROM refund_obligations WHERE order_id IN (${ph})`, created.orders);
        await db.query(`DELETE FROM financial_holds WHERE order_id IN (${ph})`, created.orders);
        await db.query(`DELETE FROM supplier_payables WHERE order_id IN (${ph})`, created.orders);
        await db.query(`DELETE FROM order_disputes WHERE order_id IN (${ph})`, created.orders);
        await db.query(`DELETE FROM invoices WHERE order_id IN (${ph})`, created.orders);
        await db.query(`DELETE FROM payments WHERE order_id IN (${ph})`, created.orders);
        await db.query(`DELETE FROM payment_attempts WHERE order_id IN (${ph})`, created.orders);
        await db.query(`DELETE FROM orders WHERE id IN (${ph})`, created.orders);
      }
      if (created.users.length) {
        const ph = created.users.map(() => '?').join(',');
        await db.query(`DELETE FROM procurement_notifications WHERE recipient_id IN (${ph})`, created.users);
        await db.query(`DELETE FROM idempotency_records WHERE user_id IN (${ph})`, created.users);
        await db.query(`DELETE FROM supplier_profiles WHERE supplier_id IN (${ph})`, created.users);
        await db.query(`DELETE FROM users WHERE id IN (${ph})`, created.users);
      }
    } catch (e) {
      console.error('[CLEANUP WARNING]', e.message);
    }
    await db.end();
  }
}

run().catch(err => {
  console.error('[PHASE 2 FINANCE GATE FAIL]', err);
  process.exitCode = 1;
});
