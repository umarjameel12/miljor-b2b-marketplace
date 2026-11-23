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
const crypto = require('node:crypto');
const path = require('node:path');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const subscriptionEntitlementService = require('../src/services/subscriptionEntitlementService');
const { SupplierSubscriptionLifecycleService } = require('../src/services/supplierSubscriptionLifecycleService');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function signJwt(id, role, status = 'VERIFIED') {
  return jwt.sign({ id, role, verification_status: status }, JWT_SECRET, {
    expiresIn: '1h',
    issuer: 'miljor-api',
    audience: 'miljor-app'
  });
}

function signSafepayPayload(bodyObj) {
  const secret = process.env.SAFEPAY_WEBHOOK_SECRET || 'test_webhook_secret';
  const raw = JSON.stringify(bodyObj);
  const sig = crypto.createHmac('sha512', secret).update(raw).digest('hex');
  return { raw, sig };
}

test('Supplier Subscription System — Complete Safe Lifecycle, Safepay v3, Admin Approval, Entitlements & Scheduler', async () => {
  const allowedTestDb = /^(?:miljor_pr54_pr61_test_db|miljor_subscription_test_db)$/.test(process.env.DB_NAME);
  assert.ok(allowedTestDb, `Refusing to run against non-disposable DB: ${process.env.DB_NAME}`);

  // Ensure webhook secret is set in test env for HMAC verification
  if (!process.env.SAFEPAY_WEBHOOK_SECRET) {
    process.env.SAFEPAY_WEBHOOK_SECRET = 'test_safepay_webhook_secret_key_123456';
  }

  const server = app.listen(0);
  const port = server.address().port;
  const api = async (urlPath, opts = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, body: json };
  };

  const suffix = Date.now();
  let supplierId;
  let otherSupplierId;
  let adminId;
  const createdFamilyIds = [];
  const createdProductIds = [];
  const createdSpecIds = [];

  try {
    // 1. Seed isolated test users, supplier profiles, and 6 distinct product families
    const [u1] = await db.query(
      `INSERT INTO users (full_name, business_name, email, password_hash, role, city, is_verified, verification_status)
       VALUES (?, ?, ?, 'hash', 'SUPPLIER', 'Lahore', 1, 'VERIFIED')`,
      [`Sub Supplier ${suffix}`, `Sub Mill ${suffix}`, `sub_supp_${suffix}@miljor.test`]
    );
    supplierId = u1.insertId;
    await db.query(
      `INSERT INTO supplier_profiles (supplier_id, verification_status, subscription_plan, subscription_status, max_active_listings)
       VALUES (?, 'VERIFIED', 'STARTER', 'STARTER_ACTIVE', 4)`,
      [supplierId]
    );

    const [u2] = await db.query(
      `INSERT INTO users (full_name, business_name, email, password_hash, role, city, is_verified, verification_status)
       VALUES (?, ?, ?, 'hash', 'SUPPLIER', 'Lahore', 1, 'VERIFIED')`,
      [`Other Supplier ${suffix}`, `Other Mill ${suffix}`, `other_supp_${suffix}@miljor.test`]
    );
    otherSupplierId = u2.insertId;
    await db.query(
      `INSERT INTO supplier_profiles (supplier_id, verification_status, subscription_plan, subscription_status, max_active_listings)
       VALUES (?, 'VERIFIED', 'STARTER', 'STARTER_ACTIVE', 4)`,
      [otherSupplierId]
    );

    const [uAdmin] = await db.query(
      `INSERT INTO users (full_name, business_name, email, password_hash, role, city, is_verified, verification_status)
       VALUES (?, 'MilJor Admin', ?, 'hash', 'ADMIN', 'Lahore', 1, 'VERIFIED')`,
      [`Sub Admin ${suffix}`, `sub_admin_${suffix}@miljor.test`]
    );
    adminId = uAdmin.insertId;

    const [fams] = await db.query(
      `SELECT f.id AS family_id, f.category_id,
              (SELECT p.id FROM products p WHERE p.family_id = f.id LIMIT 1) AS product_id
       FROM catalog_product_families f
       WHERE f.is_active = 1
       ORDER BY f.id ASC LIMIT 6`
    );
    assert.equal(fams.length, 6, 'Expected at least 6 active catalog_product_families');

    for (let i = 0; i < 6; i++) {
      const fam = fams[i];
      createdFamilyIds.push(fam.family_id);
      let prodId = fam.product_id;
      if (!prodId) {
        const [prod] = await db.query(
          `INSERT INTO products (title, category, category_id, family_id, brand, variety, processing_type, grade, pack_size, unit, is_active, approval_status)
           VALUES (?, 'GRAINS', ?, ?, 'MilJor Test', 'Standard', 'RAW', 'Grade A', 50, 'KG', 1, 'APPROVED')`,
          [`SubTest Product ${suffix}-${i + 1}`, fam.category_id, fam.family_id]
        );
        prodId = prod.insertId;
        createdProductIds.push(prodId);
      }
      const [spec] = await db.query(
        `INSERT INTO product_specifications
         (product_id, category_id, family_id, supplier_id, spec_code, title, variety, packaging_type, quality_grade, pack_size, pack_unit, purchasing_unit, spec_hash, is_active, approval_status, lifecycle_status)
         VALUES (?, ?, ?, ?, ?, ?, 'Standard', 'PP_BAG', 'Grade A', 50, 'KG', 'BAG', ?, 1, 'APPROVED', 'PUBLISHED')`,
        [prodId, fam.category_id, fam.family_id, supplierId, `SUBSPEC-${suffix}-${i + 1}`, `SubSpec ${suffix}-${i + 1}`, crypto.createHash('sha256').update(`sub-${suffix}-${i}`).digest('hex')]
      );
      createdSpecIds.push(spec.insertId);
    }

    const supplierToken = signJwt(supplierId, 'SUPPLIER');
    const otherSupplierToken = signJwt(otherSupplierId, 'SUPPLIER');
    const adminToken = signJwt(adminId, 'ADMIN');

    // 2. Plan Catalogue, Pricing (0 / 2999 / 5499), Limits (4 / 13 / 25), Fees & Authorization Checks
    const plansRes = await api('/api/v1/supplier/subscription/plans', {
      headers: { Authorization: `Bearer ${supplierToken}` }
    });
    assert.equal(plansRes.status, 200);
    const planByCode = Object.fromEntries(plansRes.body.data.plans.map((p) => [p.plan_code, p]));
    assert.equal(planByCode.STARTER.max_active_families, 4);
    assert.equal(Number(planByCode.STARTER.monthly_price_pkr), 0);
    assert.equal(Number(planByCode.STARTER.transaction_fee_pct), 3);
    assert.equal(planByCode.GROWTH.max_active_families, 13);
    assert.equal(Number(planByCode.GROWTH.monthly_price_pkr), 2999);
    assert.equal(Number(planByCode.GROWTH.transaction_fee_pct), 2);
    assert.equal(planByCode.BUSINESS.max_active_families, 25);
    assert.equal(Number(planByCode.BUSINESS.monthly_price_pkr), 5499);
    assert.equal(Number(planByCode.BUSINESS.transaction_fee_pct), 1.5);

    // Annual billing remains disabled
    const annualAttempt = await api('/api/v1/supplier/subscription/upgrade', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` },
      body: { plan_code: 'GROWTH', billing_cycle: 'ANNUAL' }
    });
    assert.equal(annualAttempt.status, 400);
    assert.equal(annualAttempt.body.error.code, 'INVALID_BILLING_CYCLE');

    const crossRead = await api(`/api/v1/supplier/subscription?supplier_id=${supplierId}`, {
      headers: { Authorization: `Bearer ${otherSupplierToken}` }
    });
    assert.equal(crossRead.status, 403);

    // 3. Entitlement Enforcement on STARTER (4 allowed, 5th blocked)
    for (let i = 0; i < 4; i++) {
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await subscriptionEntitlementService.assertCanPublishInFamily(supplierId, createdFamilyIds[i], conn);
        await conn.query(
          `INSERT INTO supplier_listings (listing_code, supplier_id, product_spec_id, base_unit_price, pricing_unit, price_per_base_unit, supplier_min_qty, buyer_min_qty, available_stock, delivery_zones, status)
           VALUES (?, ?, ?, 1000, 'BAG', 20, 10, 1, 100, '["Lahore"]', 'ACTIVE')`,
          [`SUBLST-${suffix}-${i}`, supplierId, createdSpecIds[i]]
        );
        await conn.commit();
      } finally {
        conn.release();
      }
    }

    const conn5 = await db.getConnection();
    try {
      await conn5.beginTransaction();
      await assert.rejects(
        () => subscriptionEntitlementService.assertCanPublishInFamily(supplierId, createdFamilyIds[4], conn5),
        (err) => err.code === 'ENTITLEMENT_LIMIT_EXCEEDED' && err.statusCode === 403
      );
      await conn5.rollback();
    } finally {
      conn5.release();
    }

    // 4. Checkout Initiation (server-side 2999.00 PKR -> 299900 minor units) + Idempotency + Overlapping Guard
    const svc = new SupplierSubscriptionLifecycleService(db);
    const tracker1 = `track_sub_${suffix}_1`;
    let capturedMinorAmount = null;
    const fakeV3Client = {
      async createHostedCheckout({ amountPkr }) {
        capturedMinorAmount = Math.round(Number(amountPkr) * 100);
        return {
          tracker: tracker1,
          checkoutUrl: `https://sandbox.api.getsafepay.com/checkout/pay?tracker=${tracker1}`
        };
      },
      async inspectPaymentTracker() {
        return { captured: false, reportedState: 'TRACKER_STARTED' };
      }
    };

    const idemKey = `sub-growth-${suffix}`;
    const init1 = await svc.initiateCheckout({
      actor: { id: supplierId, role: 'SUPPLIER' },
      planCode: 'GROWTH',
      idempotencyKey: idemKey,
      v3Client: fakeV3Client
    });
    assert.equal(init1.replay, false);
    assert.equal(init1.attempt.status, 'INITIATED');
    assert.equal(init1.attempt.amount_pkr, '2999.00');
    assert.equal(capturedMinorAmount, 299900);
    assert.equal(init1.attempt.tracker_token, tracker1);

    // Idempotent replay returns same attempt
    const initReplay = await svc.initiateCheckout({
      actor: { id: supplierId, role: 'SUPPLIER' },
      planCode: 'GROWTH',
      idempotencyKey: idemKey,
      v3Client: fakeV3Client
    });
    assert.equal(initReplay.replay, true);
    assert.equal(initReplay.attempt.id, init1.attempt.id);

    // Overlapping checkout with different key is blocked
    await assert.rejects(
      () =>
        svc.initiateCheckout({
          actor: { id: supplierId, role: 'SUPPLIER' },
          planCode: 'BUSINESS',
          idempotencyKey: `sub-biz-overlap-${suffix}`,
          v3Client: fakeV3Client
        }),
      (err) => err.code === 'CHECKOUT_ALREADY_PENDING' && err.statusCode === 409
    );

    // Reconcile while TRACKER_STARTED stays pending and NEVER activates
    const recPending = await svc.reconcileCheckoutAttempt({
      actor: { id: supplierId, role: 'SUPPLIER' },
      attemptId: init1.attempt.id,
      v3Client: fakeV3Client
    });
    assert.equal(recPending.reconciled, false);
    assert.equal(recPending.status, 'PENDING');

    // Cross-supplier reconcile blocked
    await assert.rejects(
      () => svc.reconcileCheckoutAttempt({ actor: { id: otherSupplierId, role: 'SUPPLIER' }, attemptId: init1.attempt.id, v3Client: fakeV3Client }),
      (err) => err.code === 'FORBIDDEN' && err.statusCode === 403
    );

    // 5. Safepay Webhook Security: Invalid Signature & Amount Mismatch Rejected
    const badWebhookRes = await api('/api/v1/payments/webhook/safepay/subscription', {
      method: 'POST',
      headers: { 'x-sfpy-signature': 'deadbeef' },
      body: { tracker: tracker1, state: 'PAID', amount: '2999.00', currency: 'PKR' }
    });
    assert.equal(badWebhookRes.status, 401);

    const wrongAmountPayload = {
      event_id: `evt_bad_${suffix}`,
      tracker: tracker1,
      state: 'PAID',
      amount: '3500.00',
      currency: 'PKR'
    };
    const { sig: badAmtSig } = signSafepayPayload(wrongAmountPayload);
    const badAmtRes = await api('/api/v1/payments/webhook/safepay/subscription', {
      method: 'POST',
      headers: { 'x-sfpy-signature': badAmtSig, 'x-sfpy-event-id': wrongAmountPayload.event_id },
      body: wrongAmountPayload
    });
    assert.equal(badAmtRes.status, 409);
    assert.equal(badAmtRes.body.error.code, 'AMOUNT_MISMATCH');

    // 6. Valid Signed Safepay Webhook -> Payment Verified, Enters PENDING_ADMIN_APPROVAL (NOT active yet!)
    const goodPayload = {
      event_id: `evt_ok_${suffix}`,
      tracker: tracker1,
      state: 'PAID',
      amount: '2999.00',
      currency: 'PKR'
    };
    const { sig: goodSig } = signSafepayPayload(goodPayload);
    const webhookOk = await api('/api/v1/payments/webhook/safepay/subscription', {
      method: 'POST',
      headers: { 'x-sfpy-signature': goodSig, 'x-sfpy-event-id': goodPayload.event_id },
      body: goodPayload
    });
    assert.equal(webhookOk.status, 200);
    assert.equal(webhookOk.body.data.verified, true);
    assert.equal(webhookOk.body.data.status, 'PAID_PENDING');
    assert.equal(webhookOk.body.data.admin_approval_status, 'PENDING_ADMIN_APPROVAL');
    const subscriptionId = webhookOk.body.data.subscription_id;

    // Duplicate webhook replay is idempotent
    const webhookReplay = await api('/api/v1/payments/webhook/safepay/subscription', {
      method: 'POST',
      headers: { 'x-sfpy-signature': goodSig, 'x-sfpy-event-id': goodPayload.event_id },
      body: goodPayload
    });
    assert.equal(webhookReplay.status, 200);
    assert.equal(webhookReplay.body.data.replay, true);

    // Supplier still cannot publish 5th family before Admin Approval!
    const connPreApprove = await db.getConnection();
    try {
      await connPreApprove.beginTransaction();
      await assert.rejects(
        () => subscriptionEntitlementService.assertCanPublishInFamily(supplierId, createdFamilyIds[4], connPreApprove),
        (err) => err.code === 'ENTITLEMENT_LIMIT_EXCEEDED'
      );
      await connPreApprove.rollback();
    } finally {
      connPreApprove.release();
    }

    // 7. Admin Approval Gate (Supplier forbidden, Admin approves -> GROWTH ACTIVE -> 5th family unlocked!)
    const selfApprove = await api(`/api/v1/admin/subscriptions/${subscriptionId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` },
      body: { notes: 'Self-approve attempt' }
    });
    assert.equal(selfApprove.status, 403);

    const adminApprove = await api(`/api/v1/admin/subscriptions/${subscriptionId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { notes: 'Verified sandbox payment approved' }
    });
    assert.equal(adminApprove.status, 200);
    assert.equal(adminApprove.body.data.subscription.status, 'ACTIVE');
    assert.equal(adminApprove.body.data.subscription.admin_approval_status, 'APPROVED');

    // Now 5th family succeeds!
    const conn5Ok = await db.getConnection();
    try {
      await conn5Ok.beginTransaction();
      const res5 = await subscriptionEntitlementService.assertCanPublishInFamily(supplierId, createdFamilyIds[4], conn5Ok);
      assert.equal(res5.allowed, true);
      await conn5Ok.query(
        `INSERT INTO supplier_listings (listing_code, supplier_id, product_spec_id, base_unit_price, pricing_unit, price_per_base_unit, supplier_min_qty, buyer_min_qty, available_stock, delivery_zones, status)
         VALUES (?, ?, ?, 1200, 'BAG', 24, 10, 1, 100, '["Lahore"]', 'ACTIVE')`,
        [`SUBLST-${suffix}-4`, supplierId, createdSpecIds[4]]
      );
      await conn5Ok.commit();
    } finally {
      conn5Ok.release();
    }

    // 8. Existing Subscriber Repricing Protection: historical 3500.00 subscriber fails closed on 2999.00 renewal without auditable consent
    await db.query(`UPDATE supplier_subscriptions SET price_pkr = 3500.00 WHERE id = ?`, [subscriptionId]);
    // Bare request without server-issued consent token is rejected
    await assert.rejects(
      () =>
        svc.initiateCheckout({
          actor: { id: supplierId, role: 'SUPPLIER' },
          planCode: 'GROWTH',
          idempotencyKey: `sub-renew-protect-${suffix}`,
          v3Client: fakeV3Client
        }),
      (err) => err.code === 'RENEWAL_PRICE_CONSENT_REQUIRED' && err.statusCode === 409
    );

    // Mismatched expected price cannot create a renewal consent record
    const badConsentRes = await api('/api/v1/supplier/subscription/renewal-consent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` },
      body: { subscription_id: subscriptionId, expected_new_price_pkr: '3500.00' }
    });
    assert.equal(badConsentRes.status, 409);
    assert.equal(badConsentRes.body.error.code, 'RENEWAL_PRICE_MISMATCH');

    // Explicit supplier consent with exact current catalogue price creates auditable consent token
    const goodConsentRes = await api('/api/v1/supplier/subscription/renewal-consent', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` },
      body: { subscription_id: subscriptionId, expected_new_price_pkr: '2999.00' }
    });
    assert.equal(goodConsentRes.status, 201);
    assert.ok(goodConsentRes.body.data.consent_token.startsWith('rc_'));
    assert.equal(goodConsentRes.body.data.previous_agreed_price_pkr, '3500.00');
    assert.equal(goodConsentRes.body.data.accepted_price_pkr, '2999.00');

    // Historical price remains unchanged
    const [histCheck] = await db.query('SELECT price_pkr FROM supplier_subscriptions WHERE id = ?', [subscriptionId]);
    assert.equal(histCheck[0].price_pkr, '3500.00');
    await db.query(`UPDATE supplier_subscriptions SET price_pkr = 2999.00 WHERE id = ?`, [subscriptionId]);

    // 9. Downgrade & Cancellation at Period End Preserve Paid Entitlements & Existing Products
    const downgradeRes = await api('/api/v1/supplier/subscription/downgrade', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` },
      body: { target_plan_code: 'STARTER' }
    });
    assert.equal(downgradeRes.status, 200);
    assert.equal(downgradeRes.body.data.pending_plan_code, 'STARTER');

    const cancelRes = await api('/api/v1/supplier/subscription/cancel', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` },
      body: { reason: 'Testing period-end cancellation' }
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.body.data.cancel_at_period_end, true);

    // 9. Scheduler Transitions: Period End -> STARTER (5 families preserved, is_over_limit=true, 6th blocked!)
    await db.query(
      `UPDATE supplier_subscriptions SET current_period_end = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?`,
      [subscriptionId]
    );
    const tick1 = await svc.processDueSubscriptionTransitions();
    assert.ok(tick1.downgraded >= 1);

    const postDowngrade = await subscriptionEntitlementService.getSupplierEntitlements(supplierId);
    assert.equal(postDowngrade.plan_code, 'STARTER');
    assert.equal(postDowngrade.active_families_count, 5);
    assert.equal(postDowngrade.is_over_limit, true);

    const conn6 = await db.getConnection();
    try {
      await conn6.beginTransaction();
      await assert.rejects(
        () => subscriptionEntitlementService.assertCanPublishInFamily(supplierId, createdFamilyIds[5], conn6),
        (err) => err.code === 'ENTITLEMENT_LIMIT_EXCEEDED'
      );
      await conn6.rollback();
    } finally {
      conn6.release();
    }

    // 10. Grace -> Expiry Lifecycle & Admin Rejection Refund Obligation
    const tracker2 = `track_sub_${suffix}_2`;
    const init2 = await svc.initiateCheckout({
      actor: { id: supplierId, role: 'SUPPLIER' },
      planCode: 'BUSINESS',
      idempotencyKey: `sub-biz-reject-${suffix}`,
      v3Client: {
        async createHostedCheckout() {
          return { tracker: tracker2, checkoutUrl: `https://sandbox.api.getsafepay.com/checkout/pay?tracker=${tracker2}` };
        }
      }
    });
    const verified2 = await svc.verifyCheckoutPayment({
      checkoutAttemptId: init2.attempt.id,
      trackerToken: tracker2,
      eventId: `evt_rej_${suffix}`,
      amountPkr: '5499.00',
      currency: 'PKR'
    });
    const rejectRes = await api(`/api/v1/admin/subscriptions/${verified2.subscription_id}/reject`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { reason: 'Compliance hold on test subscription' }
    });
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.body.data.subscription.admin_approval_status, 'REJECTED');
    assert.equal(rejectRes.body.data.refund_obligation_status, 'REQUESTED');
  } finally {
    server.close();
    if (supplierId) {
      await db.query('DELETE FROM platform_notifications WHERE user_id IN (?, ?, ?)', [supplierId, otherSupplierId || 0, adminId || 0]).catch(() => {});
      await db.query('DELETE FROM supplier_subscription_renewal_consents WHERE supplier_id IN (?, ?)', [supplierId, otherSupplierId || 0]).catch(() => {});
      await db.query('DELETE FROM supplier_subscription_audit_events WHERE supplier_id IN (?, ?)', [supplierId, otherSupplierId || 0]).catch(() => {});
      await db.query('DELETE FROM supplier_subscription_capture_events WHERE supplier_id IN (?, ?)', [supplierId, otherSupplierId || 0]).catch(() => {});
      await db.query('DELETE FROM supplier_subscription_checkout_attempts WHERE supplier_id IN (?, ?)', [supplierId, otherSupplierId || 0]).catch(() => {});
      await db.query('DELETE FROM supplier_subscriptions WHERE supplier_id IN (?, ?)', [supplierId, otherSupplierId || 0]).catch(() => {});
      await db.query('DELETE FROM supplier_listings WHERE supplier_id = ?', [supplierId]).catch(() => {});
      if (createdSpecIds.length) await db.query(`DELETE FROM product_specifications WHERE id IN (${createdSpecIds.map(() => '?').join(',')})`, createdSpecIds).catch(() => {});
      if (createdProductIds.length) await db.query(`DELETE FROM products WHERE id IN (${createdProductIds.map(() => '?').join(',')})`, createdProductIds).catch(() => {});
      await db.query('DELETE FROM supplier_profiles WHERE supplier_id IN (?, ?)', [supplierId, otherSupplierId || 0]).catch(() => {});
      await db.query('DELETE FROM users WHERE id IN (?, ?, ?)', [supplierId, otherSupplierId || 0, adminId || 0]).catch(() => {});
    }
    await db.end();
  }
});
