'use strict';

const crypto = require('node:crypto');
const db = require('../config/db');
const adapter = require('./safepayAdapter');
const exact = require('./exactDecimal');
const notificationService = require('./notificationService');
const subscriptionEntitlementService = require('./subscriptionEntitlementService');
const { SafepayV3SandboxClient } = require('./safepayV3SandboxClient');
const { normalizeSucceededWebhook } = require('./safepayV3ContractService');

const PLAN_RANK = Object.freeze({ STARTER: 1, GROWTH: 2, BUSINESS: 3 });
const ADMIN_ROLES = Object.freeze(['ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN', 'OPERATIONS_ADMIN']);
const GRACE_DAYS = 7;

function makeError(code, status, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = status;
  if (details !== undefined) err.details = details;
  return err;
}

function assertSupplierActor(actor) {
  if (!actor || actor.role !== 'SUPPLIER' || !Number.isSafeInteger(Number(actor.id)) || Number(actor.id) <= 0) {
    throw makeError('FORBIDDEN', 403, 'Supplier authentication required');
  }
  return Number(actor.id);
}

function assertAdminActor(actor) {
  if (!actor || !ADMIN_ROLES.includes(actor.role) || !Number.isSafeInteger(Number(actor.id)) || Number(actor.id) <= 0) {
    throw makeError('FORBIDDEN', 403, 'Administrator authorization required');
  }
  return Number(actor.id);
}

function validateIdempotencyKey(key) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_.:-]{12,120}$/.test(key)) {
    throw makeError('INVALID_IDEMPOTENCY_KEY', 400, 'A 12-120 character alphanumeric/symbol idempotency key is required');
  }
  return key;
}

function parsePlanPrice(value) {
  const canonical = exact.toCanonicalString(value, 2);
  if (!/^[0-9]+\.[0-9]{2}$/.test(canonical) || Number(canonical) <= 0) {
    throw makeError('INVALID_PLAN_PRICE', 409, 'Paid subscription plan price is not configured');
  }
  return canonical;
}

function frontendBaseUrl() {
  const raw = process.env.APP_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  const parsed = new URL(raw);
  const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (!['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol === 'http:' && !isLocal)) {
    throw makeError('INVALID_FRONTEND_ORIGIN', 500, 'Subscription checkout frontend origin is not configured securely');
  }
  return parsed.origin;
}

function sanitizeAttempt(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    supplier_id: Number(row.supplier_id),
    target_plan_code: row.target_plan_code,
    change_type: row.change_type,
    billing_cycle: row.billing_cycle,
    amount_pkr: row.amount_pkr,
    currency: row.currency,
    provider_contract: row.provider_contract,
    tracker_token: row.tracker_token || null,
    checkout_url: row.checkout_url || null,
    status: row.status,
    failure_reason: row.failure_reason || null,
    provider_verified_at: row.provider_verified_at || null,
    paid_subscription_id: row.paid_subscription_id || null,
    can_reconcile: Boolean(row.tracker_token && ['INITIATED', 'UNKNOWN'].includes(row.status)),
    created_at: row.created_at
  };
}

class SupplierSubscriptionLifecycleService {
  constructor(database = db, safepay = adapter) {
    this.db = database;
    this.safepay = safepay;
  }

  async _recordAudit(conn, entry) {
    await conn.query(
      `INSERT INTO supplier_subscription_audit_events
       (supplier_id, subscription_id, checkout_attempt_id, event_type, from_plan, to_plan, from_status, to_status, actor_id, actor_role, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.supplierId,
        entry.subscriptionId || null,
        entry.checkoutAttemptId || null,
        entry.eventType,
        entry.fromPlan || null,
        entry.toPlan || null,
        entry.fromStatus || null,
        entry.toStatus || null,
        entry.actorId || null,
        entry.actorRole || 'SYSTEM',
        entry.metadata ? JSON.stringify(entry.metadata) : null
      ]
    );
  }

  async _enqueueNotification(conn, { userId, role = 'SUPPLIER', eventType, eventKey, entityId, actorId = 'SYSTEM', actorRole = 'SYSTEM', aggregateId }) {
    try {
      await notificationService.enqueueEvent(conn, {
        userId,
        role,
        eventType,
        eventKey: String(eventKey).slice(0, 120),
        entityId: Number(entityId),
        eventId: String(eventKey).slice(0, 120),
        aggregateId: String(aggregateId || `subscription:${entityId}`),
        aggregateVersion: 1,
        actorId,
        actorRole,
        causationId: String(eventKey).slice(0, 120),
        correlationId: String(eventKey).slice(0, 120),
        schemaVersion: 2
      });
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') return;
      throw err;
    }
  }

  async getSupplierSubscriptionOverview(actor, requestedSupplierId = null) {
    const isAdmin = actor && ADMIN_ROLES.includes(actor.role);
    const supplierId = requestedSupplierId && isAdmin ? Number(requestedSupplierId) : assertSupplierActor(actor);
    if (requestedSupplierId && !isAdmin && Number(requestedSupplierId) !== supplierId) {
      throw makeError('FORBIDDEN', 403, "You cannot view another supplier's subscription");
    }

    const entitlements = await subscriptionEntitlementService.getSupplierEntitlements(supplierId);
    const [billingHistory] = await this.db.query(
      `SELECT id, plan_code, status, current_period_start, current_period_end, billing_cycle, auto_renew,
              pending_plan_code, cancel_at_period_end, cancellation_requested_at, grace_period_end,
              admin_approval_status, admin_reviewed_at, admin_review_notes, last_payment_attempt_id, price_pkr, created_at
       FROM supplier_subscriptions
       WHERE supplier_id = ?
       ORDER BY id DESC LIMIT 20`,
      [supplierId]
    );

    const [paymentAttempts] = await this.db.query(
      `SELECT id, supplier_id, target_plan_code, change_type, billing_cycle, amount_pkr, currency,
              provider_contract, tracker_token, checkout_url, status, failure_reason,
              provider_verified_at, paid_subscription_id, created_at
       FROM supplier_subscription_checkout_attempts
       WHERE supplier_id = ?
       ORDER BY id DESC LIMIT 20`,
      [supplierId]
    );

    const [auditEvents] = await this.db.query(
      `SELECT id, subscription_id, checkout_attempt_id, event_type, from_plan, to_plan,
              from_status, to_status, actor_id, actor_role, metadata_json, created_at
       FROM supplier_subscription_audit_events
       WHERE supplier_id = ?
       ORDER BY id DESC LIMIT 30`,
      [supplierId]
    );

    let renewalPriceNotice = null;
    const currentSub = billingHistory.find((r) => ['ACTIVE', 'GRACE'].includes(r.status));
    if (currentSub && ['GROWTH', 'BUSINESS'].includes(currentSub.plan_code)) {
      const [planRows] = await this.db.query(
        'SELECT monthly_price_pkr FROM subscription_plans WHERE plan_code = ?',
        [currentSub.plan_code]
      );
      const cataloguePrice = planRows[0] ? exact.toCanonicalString(planRows[0].monthly_price_pkr, 2) : null;
      const storedPrice = currentSub.price_pkr != null ? exact.toCanonicalString(currentSub.price_pkr, 2) : null;
      if (cataloguePrice && (!storedPrice || storedPrice !== cataloguePrice)) {
        renewalPriceNotice = {
          requires_consent: true,
          subscription_id: currentSub.id,
          plan_code: currentSub.plan_code,
          billing_cycle: 'MONTHLY',
          previous_agreed_price_pkr: storedPrice,
          current_catalogue_price_pkr: cataloguePrice
        };
      }
    }

    return {
      entitlements,
      billing_history: billingHistory,
      payment_attempts: paymentAttempts.map(sanitizeAttempt),
      audit_events: auditEvents,
      renewal_price_notice: renewalPriceNotice
    };
  }

  async recordRenewalConsent({ actor, subscriptionId, expectedNewPricePkr }) {
    const supplierId = assertSupplierActor(actor);
    const subId = Number(subscriptionId);
    if (!Number.isSafeInteger(subId) || subId <= 0) {
      throw makeError('INVALID_SUBSCRIPTION_ID', 400, 'Valid subscription_id is required');
    }
    if (expectedNewPricePkr === undefined || expectedNewPricePkr === null || Number(expectedNewPricePkr) <= 0) {
      throw makeError('INVALID_EXPECTED_PRICE', 400, 'expected_new_price_pkr must be explicitly provided');
    }
    const expectedPrice = exact.toCanonicalString(expectedNewPricePkr, 2);

    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();
      const [subs] = await conn.query(
        `SELECT * FROM supplier_subscriptions WHERE id = ? FOR UPDATE`,
        [subId]
      );
      if (!subs.length) {
        throw makeError('SUBSCRIPTION_NOT_FOUND', 404, 'Subscription record not found');
      }
      const sub = subs[0];
      if (Number(sub.supplier_id) !== supplierId) {
        throw makeError('FORBIDDEN', 403, "You cannot accept renewal terms for another supplier's subscription");
      }
      if (!['ACTIVE', 'GRACE'].includes(sub.status) || !['GROWTH', 'BUSINESS'].includes(sub.plan_code)) {
        throw makeError('INVALID_SUBSCRIPTION_STATE', 409, 'Only active or grace paid subscriptions can record renewal price consent');
      }
      if (sub.price_pkr === null || Number(sub.price_pkr) <= 0) {
        throw makeError('RENEWAL_AGREED_PRICE_MISSING', 409, 'Subscription lacks a stored historical price');
      }
      const previousPrice = exact.toCanonicalString(sub.price_pkr, 2);

      const [plans] = await conn.query(
        'SELECT monthly_price_pkr, is_active FROM subscription_plans WHERE plan_code = ?',
        [sub.plan_code]
      );
      if (!plans.length || Number(plans[0].is_active) !== 1) {
        throw makeError('PLAN_NOT_AVAILABLE', 409, 'Plan is not active');
      }
      const cataloguePrice = parsePlanPrice(plans[0].monthly_price_pkr);
      if (expectedPrice !== cataloguePrice) {
        throw makeError(
          'RENEWAL_PRICE_MISMATCH',
          409,
          `Accepted price (PKR ${expectedPrice}) does not match current catalogue price (PKR ${cataloguePrice})`
        );
      }

      const consentToken = `rc_${crypto.randomBytes(24).toString('hex')}`;
      const [ins] = await conn.query(
        `INSERT INTO supplier_subscription_renewal_consents
         (supplier_id, subscription_id, plan_code, billing_cycle, previous_agreed_price_pkr, accepted_price_pkr, consent_token, accepted_at, expires_at)
         VALUES (?, ?, ?, 'MONTHLY', ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
        [supplierId, sub.id, sub.plan_code, previousPrice, cataloguePrice, consentToken]
      );
      const [[createdConsent]] = await conn.query(
        'SELECT accepted_at, expires_at FROM supplier_subscription_renewal_consents WHERE id = ?',
        [ins.insertId]
      );

      await this._recordAudit(conn, {
        supplierId,
        subscriptionId: sub.id,
        eventType: 'RENEWAL_PRICE_CONSENT_ACCEPTED',
        fromPlan: sub.plan_code,
        toPlan: sub.plan_code,
        fromStatus: sub.status,
        toStatus: sub.status,
        actorId: supplierId,
        actorRole: 'SUPPLIER',
        metadata: {
          consent_id: ins.insertId,
          billing_cycle: 'MONTHLY',
          previous_agreed_price_pkr: previousPrice,
          accepted_price_pkr: cataloguePrice,
          expires_at: createdConsent?.expires_at || null
        }
      });

      await conn.commit();
      return {
        consent_id: ins.insertId,
        consent_token: consentToken,
        subscription_id: sub.id,
        plan_code: sub.plan_code,
        billing_cycle: 'MONTHLY',
        previous_agreed_price_pkr: previousPrice,
        accepted_price_pkr: cataloguePrice,
        accepted_at: createdConsent?.accepted_at || null,
        expires_at: createdConsent?.expires_at || null
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async initiateCheckout({ actor, planCode, idempotencyKey, renewalConsentToken = null, v3Client = null }) {
    const supplierId = assertSupplierActor(actor);
    const normalizedPlan = String(planCode || '').toUpperCase();
    if (!['GROWTH', 'BUSINESS'].includes(normalizedPlan)) {
      throw makeError('INVALID_PLAN', 400, 'Paid checkout requires GROWTH or BUSINESS plan');
    }
    const key = validateIdempotencyKey(idempotencyKey);

    if (process.env.SAFEPAY_ENV !== 'sandbox' || process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT === 'true') {
      throw makeError('SANDBOX_ONLY', 503, 'Subscription checkout requires Safepay Sandbox with ALLOW_EXTERNAL_MONEY_MOVEMENT=false');
    }

    const origin = frontendBaseUrl();
    const conn = await this.db.getConnection();
    let attemptId;
    let price;
    let changeType = 'NEW';
    let currentPlan = 'STARTER';
    let currentStatus = 'STARTER_ACTIVE';

    try {
      await conn.beginTransaction();

      const [profiles] = await conn.query(
        'SELECT supplier_id, verification_status, subscription_plan, subscription_status FROM supplier_profiles WHERE supplier_id = ? FOR UPDATE',
        [supplierId]
      );
      if (!profiles.length) {
        throw makeError('SUPPLIER_NOT_FOUND', 404, 'Supplier profile not found');
      }
      if (profiles[0].verification_status !== 'VERIFIED') {
        throw makeError('SUPPLIER_NOT_VERIFIED', 403, 'Supplier verification is required before subscribing to a paid plan');
      }

      currentPlan = String(profiles[0].subscription_plan || 'STARTER').toUpperCase();
      currentStatus = String(profiles[0].subscription_status || 'STARTER_ACTIVE');

      const [existingKey] = await conn.query(
        'SELECT * FROM supplier_subscription_checkout_attempts WHERE supplier_id = ? AND idempotency_key = ? FOR UPDATE',
        [supplierId, key]
      );
      if (existingKey.length) {
        await conn.commit();
        return { replay: true, attempt: sanitizeAttempt(existingKey[0]) };
      }

      if (PLAN_RANK[normalizedPlan] < PLAN_RANK[currentPlan]) {
        throw makeError('USE_DOWNGRADE_FLOW', 400, 'Downgrades are scheduled for period end without a new charge');
      }
      if (normalizedPlan === currentPlan && ['ACTIVE', 'GRACE'].includes(currentStatus)) {
        changeType = 'RENEWAL';
      } else if (PLAN_RANK[normalizedPlan] > PLAN_RANK[currentPlan] && currentPlan !== 'STARTER') {
        changeType = 'UPGRADE';
      }

      const [pending] = await conn.query(
        `SELECT id, status FROM supplier_subscription_checkout_attempts
         WHERE supplier_id = ? AND status IN ('INITIATING','INITIATED','UNKNOWN')
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [supplierId]
      );
      if (pending.length) {
        throw makeError('CHECKOUT_ALREADY_PENDING', 409, 'Finish or reconcile your existing pending subscription checkout first');
      }

      const [pendingApproval] = await conn.query(
        `SELECT id FROM supplier_subscriptions
         WHERE supplier_id = ? AND admin_approval_status = 'PENDING_ADMIN_APPROVAL'
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [supplierId]
      );
      if (pendingApproval.length) {
        throw makeError('SUBSCRIPTION_ADMIN_REVIEW_PENDING', 409, 'A verified subscription payment is awaiting admin approval');
      }

      const [plans] = await conn.query(
        'SELECT plan_code, monthly_price_pkr, is_active FROM subscription_plans WHERE plan_code = ? FOR UPDATE',
        [normalizedPlan]
      );
      if (!plans.length || Number(plans[0].is_active) !== 1) {
        throw makeError('PLAN_NOT_AVAILABLE', 409, 'Selected subscription plan is not active');
      }
      price = parsePlanPrice(plans[0].monthly_price_pkr);

      // Existing subscriber repricing protection: require an explicit, server-issued,
      // auditable renewal consent record before charging a changed catalogue price.
      let consumedConsentId = null;
      if (changeType === 'RENEWAL') {
        const [activeSubRows] = await conn.query(
          `SELECT id, price_pkr FROM supplier_subscriptions
           WHERE supplier_id = ? AND plan_code = ? AND status IN ('ACTIVE','GRACE')
           ORDER BY id DESC LIMIT 1 FOR UPDATE`,
          [supplierId, normalizedPlan]
        );
        const storedPriceRaw = activeSubRows[0]?.price_pkr;
        if (!activeSubRows.length || storedPriceRaw === null || Number(storedPriceRaw) <= 0) {
          throw makeError(
            'RENEWAL_AGREED_PRICE_MISSING',
            409,
            'Existing subscription lacks a stored agreed renewal price; renewal cannot proceed without explicit pricing confirmation'
          );
        }
        const agreedPrice = exact.toCanonicalString(storedPriceRaw, 2);
        if (agreedPrice !== price) {
          if (!renewalConsentToken || typeof renewalConsentToken !== 'string') {
            throw makeError(
              'RENEWAL_PRICE_CONSENT_REQUIRED',
              409,
              `Plan catalogue price (PKR ${price}) differs from your existing agreed price (PKR ${agreedPrice}). Explicit recorded renewal consent is required before checkout.`,
              {
                subscription_id: activeSubRows[0].id,
                plan_code: normalizedPlan,
                billing_cycle: 'MONTHLY',
                agreed_price_pkr: agreedPrice,
                current_catalogue_price_pkr: price
              }
            );
          }
          const [consents] = await conn.query(
            `SELECT *, (expires_at IS NOT NULL AND expires_at > NOW()) AS is_unexpired
             FROM supplier_subscription_renewal_consents
             WHERE consent_token = ? AND supplier_id = ? AND subscription_id = ? AND consumed_by_attempt_id IS NULL
             FOR UPDATE`,
            [renewalConsentToken, supplierId, activeSubRows[0].id]
          );
          if (
            !consents.length ||
            consents[0].plan_code !== normalizedPlan ||
            consents[0].billing_cycle !== 'MONTHLY' ||
            exact.toCanonicalString(consents[0].accepted_price_pkr, 2) !== price ||
            exact.toCanonicalString(consents[0].previous_agreed_price_pkr, 2) !== agreedPrice
          ) {
            throw makeError(
              'RENEWAL_PRICE_CONSENT_INVALID',
              409,
              'Renewal consent token is invalid, already used, or does not match the current catalogue price'
            );
          }
          if (Number(consents[0].is_unexpired) !== 1) {
            throw makeError(
              'RENEWAL_PRICE_CONSENT_EXPIRED',
              409,
              'Renewal consent token has expired; please review and accept the renewal price again'
            );
          }
          consumedConsentId = consents[0].id;
        }
      }

      const [ins] = await conn.query(
        `INSERT INTO supplier_subscription_checkout_attempts
         (supplier_id, target_plan_code, change_type, billing_cycle, amount_pkr, currency, provider_contract, idempotency_key, status)
         VALUES (?, ?, ?, 'MONTHLY', ?, 'PKR', 'payments-v3-minor', ?, 'INITIATING')`,
        [supplierId, normalizedPlan, changeType, price, key]
      );
      attemptId = ins.insertId;

      if (consumedConsentId) {
        const [consumeRes] = await conn.query(
          `UPDATE supplier_subscription_renewal_consents
           SET consumed_by_attempt_id = ?, consumed_at = NOW()
           WHERE id = ? AND consumed_by_attempt_id IS NULL`,
          [attemptId, consumedConsentId]
        );
        if (consumeRes.affectedRows !== 1) {
          throw makeError(
            'RENEWAL_PRICE_CONSENT_INVALID',
            409,
            'Renewal consent token was already consumed by another checkout attempt'
          );
        }
      }

      await this._recordAudit(conn, {
        supplierId,
        checkoutAttemptId: attemptId,
        eventType: 'CHECKOUT_INITIATED',
        fromPlan: currentPlan,
        toPlan: normalizedPlan,
        fromStatus: currentStatus,
        toStatus: 'INITIATING',
        actorId: supplierId,
        actorRole: 'SUPPLIER',
        metadata: { change_type: changeType, amount_pkr: price }
      });

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Create Safepay v3 hosted checkout outside DB transaction
    const client = v3Client || new SafepayV3SandboxClient();
    const orderRef = `SUB-${attemptId}`;
    const redirectUrl = `${origin}/supplier/subscription?checkout_attempt=${attemptId}`;
    const cancelUrl = `${origin}/supplier/subscription?checkout_cancelled=${attemptId}`;

    let session;
    try {
      session = await client.createHostedCheckout({
        orderId: orderRef,
        amountPkr: price,
        redirectUrl,
        cancelUrl
      });
    } catch (providerErr) {
      const failConn = await this.db.getConnection();
      try {
        await failConn.beginTransaction();
        await failConn.query(
          `UPDATE supplier_subscription_checkout_attempts
           SET status = 'FAILED', failure_reason = ?
           WHERE id = ? AND status = 'INITIATING'`,
          [String(providerErr.message || 'Safepay session initiation failed').slice(0, 490), attemptId]
        );
        await this._recordAudit(failConn, {
          supplierId,
          checkoutAttemptId: attemptId,
          eventType: 'CHECKOUT_PROVIDER_FAILED',
          fromPlan: currentPlan,
          toPlan: normalizedPlan,
          fromStatus: 'INITIATING',
          toStatus: 'FAILED',
          actorId: supplierId,
          actorRole: 'SUPPLIER',
          metadata: { error: providerErr.message }
        });
        await failConn.commit();
      } catch (_) {
        await failConn.rollback();
      } finally {
        failConn.release();
      }
      throw providerErr;
    }

    const updConn = await this.db.getConnection();
    try {
      await updConn.beginTransaction();
      await updConn.query(
        `UPDATE supplier_subscription_checkout_attempts
         SET tracker_token = ?, checkout_url = ?, status = 'INITIATED'
         WHERE id = ?`,
        [session.tracker, session.checkoutUrl, attemptId]
      );
      await this._enqueueNotification(updConn, {
        userId: supplierId,
        role: 'SUPPLIER',
        eventType: 'SUBSCRIPTION_CHECKOUT_INITIATED',
        eventKey: `sub:checkout:${attemptId}:initiated`,
        entityId: attemptId,
        actorId: supplierId,
        actorRole: 'SUPPLIER',
        aggregateId: `subscription_attempt:${attemptId}`
      });
      const [rows] = await updConn.query('SELECT * FROM supplier_subscription_checkout_attempts WHERE id = ?', [attemptId]);
      await updConn.commit();
      return { replay: false, attempt: sanitizeAttempt(rows[0]) };
    } catch (err) {
      await updConn.rollback();
      throw err;
    } finally {
      updConn.release();
    }
  }

  async verifyCheckoutPayment({
    checkoutAttemptId = null,
    trackerToken = null,
    eventId,
    eventType = 'payment:created',
    amountPkr,
    currency = 'PKR',
    verificationSource = 'SAFEPAY_WEBHOOK'
  }) {
    if (!eventId || typeof eventId !== 'string') {
      throw makeError('MISSING_EVENT_ID', 400, 'Verified provider event identity is required');
    }
    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();

      const [existingEvent] = await conn.query(
        'SELECT id, checkout_attempt_id FROM supplier_subscription_capture_events WHERE event_id = ? FOR UPDATE',
        [eventId]
      );
      if (existingEvent.length) {
        await conn.commit();
        return { replay: true, verified: true, checkout_attempt_id: existingEvent[0].checkout_attempt_id };
      }

      let attempts;
      if (checkoutAttemptId) {
        [attempts] = await conn.query(
          'SELECT * FROM supplier_subscription_checkout_attempts WHERE id = ? FOR UPDATE',
          [checkoutAttemptId]
        );
      } else if (trackerToken) {
        [attempts] = await conn.query(
          'SELECT * FROM supplier_subscription_checkout_attempts WHERE tracker_token = ? FOR UPDATE',
          [trackerToken]
        );
      } else {
        throw makeError('MISSING_ATTEMPT_REFERENCE', 400, 'checkoutAttemptId or trackerToken required');
      }

      if (!attempts.length) {
        throw makeError('CHECKOUT_ATTEMPT_NOT_FOUND', 404, 'Subscription checkout attempt not found');
      }
      const attempt = attempts[0];

      if (trackerToken && attempt.tracker_token && trackerToken !== attempt.tracker_token) {
        throw makeError('TRACKER_MISMATCH', 409, 'Provider tracker token does not match checkout attempt');
      }

      if (String(currency || '').toUpperCase() !== String(attempt.currency || 'PKR').toUpperCase()) {
        throw makeError('CURRENCY_MISMATCH', 409, 'Verified payment currency does not match subscription attempt');
      }

      const expectedAmount = exact.toCanonicalString(attempt.amount_pkr, 2);
      const observedAmount = exact.toCanonicalString(amountPkr, 2);
      if (expectedAmount !== observedAmount) {
        throw makeError('AMOUNT_MISMATCH', 409, `Verified amount ${observedAmount} does not match expected ${expectedAmount}`);
      }

      if (attempt.status === 'PAID' && attempt.paid_subscription_id) {
        await conn.commit();
        return {
          replay: true,
          verified: true,
          checkout_attempt_id: attempt.id,
          subscription_id: attempt.paid_subscription_id
        };
      }

      await conn.query(
        `INSERT INTO supplier_subscription_capture_events
         (event_id, checkout_attempt_id, supplier_id, tracker_token, amount_pkr, currency, event_type, verification_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [eventId, attempt.id, attempt.supplier_id, attempt.tracker_token || trackerToken, expectedAmount, 'PKR', eventType, verificationSource]
      );

      const [subInsert] = await conn.query(
        `INSERT INTO supplier_subscriptions
         (supplier_id, plan_code, status, current_period_start, current_period_end, billing_cycle, auto_renew, admin_approval_status, last_payment_attempt_id, price_pkr)
         VALUES (?, ?, 'PAID_PENDING', NOW(), NULL, 'MONTHLY', 1, 'PENDING_ADMIN_APPROVAL', ?, ?)`,
        [attempt.supplier_id, attempt.target_plan_code, attempt.id, expectedAmount]
      );
      const subscriptionId = subInsert.insertId;

      await conn.query(
        `UPDATE supplier_subscription_checkout_attempts
         SET status = 'PAID', provider_verified_at = NOW(), paid_subscription_id = ?
         WHERE id = ?`,
        [subscriptionId, attempt.id]
      );

      // Keep existing active paid plan intact while upgrading; only mark PAID_PENDING on profile if currently STARTER
      await conn.query(
        `UPDATE supplier_profiles
         SET subscription_status = CASE WHEN subscription_plan = 'STARTER' THEN 'PAID_PENDING' ELSE subscription_status END,
             updated_at = NOW()
         WHERE supplier_id = ?`,
        [attempt.supplier_id]
      );

      await this._recordAudit(conn, {
        supplierId: attempt.supplier_id,
        subscriptionId,
        checkoutAttemptId: attempt.id,
        eventType: 'PAYMENT_VERIFIED_PENDING_ADMIN',
        toPlan: attempt.target_plan_code,
        fromStatus: attempt.status,
        toStatus: 'PAID_PENDING',
        actorRole: 'SYSTEM',
        metadata: { event_id: eventId, verification_source: verificationSource, amount_pkr: expectedAmount }
      });

      await this._enqueueNotification(conn, {
        userId: attempt.supplier_id,
        role: 'SUPPLIER',
        eventType: 'SUBSCRIPTION_PAYMENT_VERIFIED',
        eventKey: `sub:pay:${attempt.id}:verified`,
        entityId: subscriptionId,
        actorRole: 'SYSTEM',
        aggregateId: `subscription:${subscriptionId}`
      });

      await this._enqueueNotification(conn, {
        userId: attempt.supplier_id,
        role: 'SUPPLIER',
        eventType: 'SUBSCRIPTION_ADMIN_REVIEW_REQUIRED',
        eventKey: `sub:admin_review:${subscriptionId}:pending`,
        entityId: subscriptionId,
        actorRole: 'SYSTEM',
        aggregateId: `subscription:${subscriptionId}`
      });

      await conn.commit();
      return {
        replay: false,
        verified: true,
        checkout_attempt_id: attempt.id,
        subscription_id: subscriptionId,
        status: 'PAID_PENDING',
        admin_approval_status: 'PENDING_ADMIN_APPROVAL'
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async processSafepayWebhook({ rawBody, signature, headers = {}, body = {} }) {
    const scope = this.safepay.verifyWebhookSignatureScope({ rawBody, signature });
    if (!scope) {
      throw makeError('INVALID_WEBHOOK_SIGNATURE', 401, 'Invalid Safepay webhook signature');
    }

    const payload = scope === 'data' ? (body?.data || {}) : (body?.data || body || {});
    const notification = scope === 'data' ? (payload?.notification || payload) : (payload?.notification || body?.notification || payload);
    const tracker = notification?.tracker || payload?.tracker || payload?.token || notification?.token || null;
    const state = String(notification?.state || payload?.state || '').toUpperCase();
    const eventType = scope === 'data'
      ? String(payload?.type || 'payment:created')
      : String(headers['x-sfpy-event-type'] || headers['x-safepay-event-type'] || payload?.type || body?.type || 'payment:created');
    const eventId = scope === 'data'
      ? String(payload?.event_id || notification?.reference || `sfpy:${tracker}:${state}`)
      : String(
          headers['x-sfpy-event-id'] ||
          headers['x-safepay-event-id'] ||
          payload?.event_id ||
          notification?.reference ||
          `sfpy:${tracker}:${state}`
        );

    if (!tracker) {
      throw makeError('MISSING_TRACKER', 400, 'Webhook payload missing tracker token');
    }

    if (['FAILED', 'CANCELLED', 'VOIDED'].includes(state)) {
      const conn = await this.db.getConnection();
      try {
        await conn.beginTransaction();
        const [rows] = await conn.query(
          'SELECT * FROM supplier_subscription_checkout_attempts WHERE tracker_token = ? FOR UPDATE',
          [tracker]
        );
        if (!rows.length) {
          throw makeError('CHECKOUT_ATTEMPT_NOT_FOUND', 404, 'Subscription checkout attempt not found for tracker');
        }
        const attempt = rows[0];
        if (attempt.status === 'PAID') {
          await conn.commit();
          return { replay: true, ignored: true, reason: 'ALREADY_PAID' };
        }
        const targetStatus = state === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
        await conn.query(
          `UPDATE supplier_subscription_checkout_attempts
           SET status = ?, failure_reason = ?
           WHERE id = ?`,
          [targetStatus, `Provider reported ${state}`, attempt.id]
        );
        await this._recordAudit(conn, {
          supplierId: attempt.supplier_id,
          checkoutAttemptId: attempt.id,
          eventType: 'PAYMENT_FAILED',
          toPlan: attempt.target_plan_code,
          fromStatus: attempt.status,
          toStatus: targetStatus,
          actorRole: 'SYSTEM',
          metadata: { state, event_id: eventId }
        });
        await this._enqueueNotification(conn, {
          userId: attempt.supplier_id,
          role: 'SUPPLIER',
          eventType: 'SUBSCRIPTION_PAYMENT_FAILED',
          eventKey: `sub:pay:${attempt.id}:failed:${state}`,
          entityId: attempt.id,
          actorRole: 'SYSTEM',
          aggregateId: `subscription_attempt:${attempt.id}`
        });
        await conn.commit();
        return { verified: false, status: targetStatus, checkout_attempt_id: attempt.id };
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }

    if (state !== 'PAID' && state !== 'CAPTURED') {
      return { ignored: true, state, message: 'Non-terminal webhook state recorded without activation' };
    }

    // Extract major PKR amount cleanly for either v3 minor or v1 major webhook payloads
    let amountMajor = notification?.amount;
    if (body?.data?.notification?.metadata?.order_id || Number(notification?.amount) >= 10000 && notification?.contract === 'payments-v3-minor') {
      // If v3 envelope matches normalizeSucceededWebhook, prefer exact minor->major
      const normalized = normalizeSucceededWebhook(body, process.env.SAFEPAY_PUBLIC_KEY);
      if (normalized && normalized.amountPkr) amountMajor = normalized.amountPkr;
    }

    return this.verifyCheckoutPayment({
      trackerToken: tracker,
      eventId,
      eventType,
      amountPkr: amountMajor,
      currency: notification?.currency || 'PKR',
      verificationSource: 'SAFEPAY_WEBHOOK'
    });
  }

  async reconcileCheckoutAttempt({ actor, attemptId, v3Client = null }) {
    const supplierId = assertSupplierActor(actor);
    const [rows] = await this.db.query(
      'SELECT * FROM supplier_subscription_checkout_attempts WHERE id = ?',
      [attemptId]
    );
    if (!rows.length) {
      throw makeError('CHECKOUT_ATTEMPT_NOT_FOUND', 404, 'Checkout attempt not found');
    }
    const attempt = rows[0];
    if (Number(attempt.supplier_id) !== supplierId) {
      throw makeError('FORBIDDEN', 403, 'You cannot reconcile another supplier checkout attempt');
    }
    if (attempt.status === 'PAID') {
      return { reconciled: true, replay: true, status: 'PAID', subscription_id: attempt.paid_subscription_id };
    }
    if (!attempt.tracker_token) {
      throw makeError('MISSING_TRACKER', 409, 'Checkout attempt has no Safepay tracker token to reconcile');
    }

    const client = v3Client || new SafepayV3SandboxClient();
    const inspected = await client.inspectPaymentTracker({
      tracker: attempt.tracker_token,
      orderId: `SUB-${attempt.id}`,
      expectedAmountPkr: attempt.amount_pkr
    });

    if (!inspected.captured) {
      return {
        reconciled: false,
        status: 'PENDING',
        reported_state: inspected.reportedState,
        message: 'Payment is still pending confirmation from Safepay'
      };
    }

    return this.verifyCheckoutPayment({
      checkoutAttemptId: attempt.id,
      trackerToken: attempt.tracker_token,
      eventId: `reporter:${attempt.tracker_token}:PAID`,
      eventType: 'reporter:reconciled',
      amountPkr: attempt.amount_pkr,
      currency: attempt.currency || 'PKR',
      verificationSource: 'SAFEPAY_REPORTER'
    });
  }

  async adminListSubscriptions({ status = null } = {}) {
    let sql = `
      SELECT s.*, u.full_name AS supplier_name, u.email AS supplier_email,
             sp.subscription_plan AS active_profile_plan, sp.subscription_status AS active_profile_status,
             ca.tracker_token, ca.status AS checkout_status, ca.provider_verified_at
      FROM supplier_subscriptions s
      JOIN users u ON u.id = s.supplier_id
      JOIN supplier_profiles sp ON sp.supplier_id = s.supplier_id
      LEFT JOIN supplier_subscription_checkout_attempts ca ON ca.id = s.last_payment_attempt_id`;
    const params = [];
    if (status) {
      sql += ' WHERE s.admin_approval_status = ?';
      params.push(status);
    }
    sql += ' ORDER BY s.id DESC LIMIT 50';
    const [rows] = await this.db.query(sql, params);
    return rows;
  }

  async adminApproveSubscription({ subscriptionId, adminActor, notes = null }) {
    const adminId = assertAdminActor(adminActor);
    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();

      const [subs] = await conn.query(
        'SELECT * FROM supplier_subscriptions WHERE id = ? FOR UPDATE',
        [subscriptionId]
      );
      if (!subs.length) {
        throw makeError('SUBSCRIPTION_NOT_FOUND', 404, 'Subscription record not found');
      }
      const sub = subs[0];

      if (sub.admin_approval_status === 'APPROVED' && sub.status === 'ACTIVE') {
        await conn.commit();
        return { replay: true, subscription: sub };
      }
      if (sub.admin_approval_status !== 'PENDING_ADMIN_APPROVAL') {
        throw makeError('INVALID_SUBSCRIPTION_STATE', 409, `Subscription is not pending admin approval (current: ${sub.admin_approval_status})`);
      }

      if (!sub.last_payment_attempt_id) {
        throw makeError('PAYMENT_VERIFICATION_REQUIRED', 402, 'Cannot approve paid subscription without verified payment attempt');
      }
      const [attempts] = await conn.query(
        'SELECT id, status, provider_verified_at FROM supplier_subscription_checkout_attempts WHERE id = ? FOR UPDATE',
        [sub.last_payment_attempt_id]
      );
      if (!attempts.length || attempts[0].status !== 'PAID') {
        throw makeError('PAYMENT_VERIFICATION_REQUIRED', 402, 'Associated Safepay checkout attempt is not PAID');
      }

      const [profiles] = await conn.query(
        'SELECT supplier_id, subscription_plan, subscription_status FROM supplier_profiles WHERE supplier_id = ? FOR UPDATE',
        [sub.supplier_id]
      );
      const previousPlan = profiles[0]?.subscription_plan || 'STARTER';
      const [planRows] = await conn.query('SELECT * FROM subscription_plans WHERE plan_code = ?', [sub.plan_code]);
      const maxListings = planRows[0]?.max_active_listings || (sub.plan_code === 'BUSINESS' ? 25 : 13);

      // Mark any prior ACTIVE paid subscription superseded
      await conn.query(
        `UPDATE supplier_subscriptions
         SET status = 'CANCELLED', auto_renew = 0, updated_at = NOW()
         WHERE supplier_id = ? AND id <> ? AND status IN ('ACTIVE','GRACE')`,
        [sub.supplier_id, sub.id]
      );

      await conn.query(
        `UPDATE supplier_subscriptions
         SET status = 'ACTIVE',
             admin_approval_status = 'APPROVED',
             admin_reviewed_by = ?,
             admin_reviewed_at = NOW(),
             admin_review_notes = ?,
             current_period_start = NOW(),
             current_period_end = DATE_ADD(NOW(), INTERVAL 30 DAY),
             updated_at = NOW()
         WHERE id = ?`,
        [adminId, notes || null, sub.id]
      );

      await conn.query(
        `UPDATE supplier_profiles
         SET subscription_plan = ?, subscription_status = 'ACTIVE', max_active_listings = ?, updated_at = NOW()
         WHERE supplier_id = ?`,
        [sub.plan_code, maxListings, sub.supplier_id]
      );

      await conn.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, ?, 'SUBSCRIPTION_ADMIN_APPROVED', 'supplier_subscriptions', ?, ?, ?)`,
        [
          adminId,
          adminActor.role,
          sub.id,
          JSON.stringify({ plan: previousPlan, admin_approval_status: sub.admin_approval_status }),
          JSON.stringify({ plan: sub.plan_code, status: 'ACTIVE', notes: notes || null })
        ]
      );

      await this._recordAudit(conn, {
        supplierId: sub.supplier_id,
        subscriptionId: sub.id,
        checkoutAttemptId: sub.last_payment_attempt_id,
        eventType: previousPlan !== 'STARTER' && previousPlan !== sub.plan_code ? 'UPGRADE_ACTIVATED' : 'SUBSCRIPTION_ACTIVATED',
        fromPlan: previousPlan,
        toPlan: sub.plan_code,
        fromStatus: sub.status,
        toStatus: 'ACTIVE',
        actorId: adminId,
        actorRole: adminActor.role,
        metadata: { notes: notes || null }
      });

      const eventType = previousPlan !== 'STARTER' && previousPlan !== sub.plan_code
        ? 'SUBSCRIPTION_UPGRADE_COMPLETED'
        : 'SUBSCRIPTION_ACTIVATED';
      await this._enqueueNotification(conn, {
        userId: sub.supplier_id,
        role: 'SUPPLIER',
        eventType,
        eventKey: `sub:approved:${sub.id}`,
        entityId: sub.id,
        actorId: adminId,
        actorRole: adminActor.role,
        aggregateId: `subscription:${sub.id}`
      });

      const [updated] = await conn.query('SELECT * FROM supplier_subscriptions WHERE id = ?', [sub.id]);
      await conn.commit();
      return { replay: false, subscription: updated[0] };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async adminRejectSubscription({ subscriptionId, adminActor, reason }) {
    const adminId = assertAdminActor(adminActor);
    if (!reason || String(reason).trim().length < 5) {
      throw makeError('REJECTION_REASON_REQUIRED', 400, 'A rejection reason (min 5 characters) is required');
    }

    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();

      const [subs] = await conn.query(
        'SELECT * FROM supplier_subscriptions WHERE id = ? FOR UPDATE',
        [subscriptionId]
      );
      if (!subs.length) {
        throw makeError('SUBSCRIPTION_NOT_FOUND', 404, 'Subscription record not found');
      }
      const sub = subs[0];

      if (sub.admin_approval_status === 'REJECTED') {
        await conn.commit();
        return { replay: true, subscription: sub, refund_obligation_status: 'REQUESTED' };
      }
      if (sub.admin_approval_status !== 'PENDING_ADMIN_APPROVAL') {
        throw makeError('INVALID_SUBSCRIPTION_STATE', 409, `Subscription cannot be rejected from state ${sub.admin_approval_status}`);
      }

      await conn.query(
        `UPDATE supplier_subscriptions
         SET status = 'CANCELLED',
             auto_renew = 0,
             admin_approval_status = 'REJECTED',
             admin_reviewed_by = ?,
             admin_reviewed_at = NOW(),
             admin_review_notes = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [adminId, String(reason).trim().slice(0, 490), sub.id]
      );

      // Restore STARTER_ACTIVE on supplier_profiles if no active paid plan exists
      const [otherActive] = await conn.query(
        `SELECT id, plan_code FROM supplier_subscriptions
         WHERE supplier_id = ? AND id <> ? AND status = 'ACTIVE'
         ORDER BY id DESC LIMIT 1`,
        [sub.supplier_id, sub.id]
      );
      if (!otherActive.length) {
        await conn.query(
          `UPDATE supplier_profiles
           SET subscription_status = CASE WHEN subscription_plan = 'STARTER' THEN 'STARTER_ACTIVE' ELSE subscription_status END,
               updated_at = NOW()
           WHERE supplier_id = ?`,
          [sub.supplier_id]
        );
      }

      await conn.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, ?, 'SUBSCRIPTION_ADMIN_REJECTED', 'supplier_subscriptions', ?, ?, ?)`,
        [
          adminId,
          adminActor.role,
          sub.id,
          JSON.stringify({ plan: sub.plan_code, admin_approval_status: sub.admin_approval_status }),
          JSON.stringify({ status: 'CANCELLED', reason: String(reason).trim(), refund_obligation: 'REQUESTED' })
        ]
      );

      await this._recordAudit(conn, {
        supplierId: sub.supplier_id,
        subscriptionId: sub.id,
        checkoutAttemptId: sub.last_payment_attempt_id,
        eventType: 'ADMIN_REJECTED_REFUND_OBLIGATION_CREATED',
        toPlan: sub.plan_code,
        fromStatus: sub.status,
        toStatus: 'CANCELLED',
        actorId: adminId,
        actorRole: adminActor.role,
        metadata: { reason: String(reason).trim(), refund_obligation: 'REQUESTED', external_refund_executed: false }
      });

      await this._enqueueNotification(conn, {
        userId: sub.supplier_id,
        role: 'SUPPLIER',
        eventType: 'SUBSCRIPTION_CANCELLED',
        eventKey: `sub:rejected:${sub.id}`,
        entityId: sub.id,
        actorId: adminId,
        actorRole: adminActor.role,
        aggregateId: `subscription:${sub.id}`
      });

      const [updated] = await conn.query('SELECT * FROM supplier_subscriptions WHERE id = ?', [sub.id]);
      await conn.commit();
      return { replay: false, subscription: updated[0], refund_obligation_status: 'REQUESTED' };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async scheduleDowngrade({ actor, targetPlanCode }) {
    const supplierId = assertSupplierActor(actor);
    const target = String(targetPlanCode || '').toUpperCase();
    if (!PLAN_RANK[target]) {
      throw makeError('INVALID_PLAN_CODE', 400, 'target_plan_code must be STARTER, GROWTH, or BUSINESS');
    }

    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();

      const [profiles] = await conn.query(
        'SELECT supplier_id, subscription_plan, subscription_status FROM supplier_profiles WHERE supplier_id = ? FOR UPDATE',
        [supplierId]
      );
      if (!profiles.length) throw makeError('SUPPLIER_NOT_FOUND', 404, 'Supplier profile not found');

      const currentPlan = String(profiles[0].subscription_plan || 'STARTER').toUpperCase();
      if (PLAN_RANK[target] >= PLAN_RANK[currentPlan]) {
        throw makeError('NOT_A_DOWNGRADE', 400, `Cannot downgrade from ${currentPlan} to ${target}`);
      }

      const [activeSubs] = await conn.query(
        `SELECT * FROM supplier_subscriptions
         WHERE supplier_id = ? AND status IN ('ACTIVE','GRACE')
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [supplierId]
      );
      if (!activeSubs.length) {
        throw makeError('NO_ACTIVE_PAID_SUBSCRIPTION', 409, 'No active paid subscription to schedule downgrade on');
      }
      const sub = activeSubs[0];

      await conn.query(
        `UPDATE supplier_subscriptions
         SET pending_plan_code = ?, auto_renew = CASE WHEN ? = 'STARTER' THEN 0 ELSE auto_renew END, updated_at = NOW()
         WHERE id = ?`,
        [target, target, sub.id]
      );

      await this._recordAudit(conn, {
        supplierId,
        subscriptionId: sub.id,
        eventType: 'DOWNGRADE_SCHEDULED',
        fromPlan: currentPlan,
        toPlan: target,
        fromStatus: sub.status,
        toStatus: sub.status,
        actorId: supplierId,
        actorRole: 'SUPPLIER',
        metadata: { effective_at: sub.current_period_end }
      });

      await this._enqueueNotification(conn, {
        userId: supplierId,
        role: 'SUPPLIER',
        eventType: 'SUBSCRIPTION_DOWNGRADE_SCHEDULED',
        eventKey: `sub:downgrade_sched:${sub.id}:${target}`,
        entityId: sub.id,
        actorId: supplierId,
        actorRole: 'SUPPLIER',
        aggregateId: `subscription:${sub.id}`
      });

      await conn.commit();
      return {
        scheduled: true,
        current_plan: currentPlan,
        pending_plan_code: target,
        effective_at: sub.current_period_end,
        existing_data_preserved: true
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async requestCancellation({ actor, reason = null }) {
    const supplierId = assertSupplierActor(actor);
    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();

      const [activeSubs] = await conn.query(
        `SELECT * FROM supplier_subscriptions
         WHERE supplier_id = ? AND status IN ('ACTIVE','GRACE')
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [supplierId]
      );
      if (!activeSubs.length) {
        throw makeError('NO_ACTIVE_PAID_SUBSCRIPTION', 409, 'No active paid subscription to cancel');
      }
      const sub = activeSubs[0];
      if (Number(sub.cancel_at_period_end) === 1) {
        await conn.commit();
        return { replay: true, cancel_at_period_end: true, effective_at: sub.current_period_end };
      }

      await conn.query(
        `UPDATE supplier_subscriptions
         SET cancel_at_period_end = 1,
             auto_renew = 0,
             pending_plan_code = COALESCE(pending_plan_code, 'STARTER'),
             cancellation_requested_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [sub.id]
      );

      await this._recordAudit(conn, {
        supplierId,
        subscriptionId: sub.id,
        eventType: 'CANCELLATION_REQUESTED',
        fromPlan: sub.plan_code,
        toPlan: 'STARTER',
        fromStatus: sub.status,
        toStatus: sub.status,
        actorId: supplierId,
        actorRole: 'SUPPLIER',
        metadata: { reason: reason || null, effective_at: sub.current_period_end }
      });

      await this._enqueueNotification(conn, {
        userId: supplierId,
        role: 'SUPPLIER',
        eventType: 'SUBSCRIPTION_CANCELLATION_REQUESTED',
        eventKey: `sub:cancel_req:${sub.id}`,
        entityId: sub.id,
        actorId: supplierId,
        actorRole: 'SUPPLIER',
        aggregateId: `subscription:${sub.id}`
      });

      await conn.commit();
      return {
        replay: false,
        cancel_at_period_end: true,
        effective_at: sub.current_period_end
      };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async processDueSubscriptionTransitions({ now = new Date() } = {}) {
    const nowDate = now instanceof Date ? now : new Date(now);
    const results = { renewal_reminders: 0, downgraded: 0, entered_grace: 0, expired: 0 };

    // 1. Renewal approaching within 3 days
    const reminderCutoff = new Date(nowDate.getTime() + 3 * 24 * 60 * 60 * 1000);
    const conn1 = await this.db.getConnection();
    try {
      await conn1.beginTransaction();
      const [dueReminders] = await conn1.query(
        `SELECT id, supplier_id, plan_code, current_period_end
         FROM supplier_subscriptions
         WHERE status = 'ACTIVE' AND auto_renew = 1 AND cancel_at_period_end = 0
           AND current_period_end IS NOT NULL AND current_period_end > ? AND current_period_end <= ?
         FOR UPDATE SKIP LOCKED`,
        [nowDate, reminderCutoff]
      );
      for (const sub of dueReminders) {
        const periodTag = new Date(sub.current_period_end).toISOString().slice(0, 10);
        await this._enqueueNotification(conn1, {
          userId: sub.supplier_id,
          role: 'SUPPLIER',
          eventType: 'SUBSCRIPTION_RENEWAL_APPROACHING',
          eventKey: `sub:renew_warn:${sub.id}:${periodTag}`,
          entityId: sub.id,
          actorRole: 'SYSTEM',
          aggregateId: `subscription:${sub.id}`
        });
        results.renewal_reminders += 1;
      }
      await conn1.commit();
    } catch (err) {
      await conn1.rollback();
      throw err;
    } finally {
      conn1.release();
    }

    // 2. Period-end transitions for ACTIVE subscriptions past current_period_end
    const conn2 = await this.db.getConnection();
    try {
      await conn2.beginTransaction();
      const [endedActive] = await conn2.query(
        `SELECT * FROM supplier_subscriptions
         WHERE status = 'ACTIVE' AND current_period_end IS NOT NULL AND current_period_end <= ?
         FOR UPDATE SKIP LOCKED`,
        [nowDate]
      );
      for (const sub of endedActive) {
        if (Number(sub.cancel_at_period_end) === 1 || sub.pending_plan_code === 'STARTER') {
          await conn2.query(
            `UPDATE supplier_subscriptions SET status = 'CANCELLED', auto_renew = 0, updated_at = NOW() WHERE id = ?`,
            [sub.id]
          );
          await conn2.query(
            `UPDATE supplier_profiles
             SET subscription_plan = 'STARTER', subscription_status = 'STARTER_ACTIVE', max_active_listings = 4, updated_at = NOW()
             WHERE supplier_id = ?`,
            [sub.supplier_id]
          );
          await this._recordAudit(conn2, {
            supplierId: sub.supplier_id,
            subscriptionId: sub.id,
            eventType: 'PERIOD_END_DOWNGRADED_TO_STARTER',
            fromPlan: sub.plan_code,
            toPlan: 'STARTER',
            fromStatus: 'ACTIVE',
            toStatus: 'CANCELLED',
            actorRole: 'SYSTEM'
          });
          await this._enqueueNotification(conn2, {
            userId: sub.supplier_id,
            role: 'SUPPLIER',
            eventType: 'SUBSCRIPTION_DOWNGRADED',
            eventKey: `sub:period_end_downgrade:${sub.id}`,
            entityId: sub.id,
            actorRole: 'SYSTEM',
            aggregateId: `subscription:${sub.id}`
          });
          results.downgraded += 1;
        } else {
          const graceEnd = new Date(new Date(sub.current_period_end).getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
          await conn2.query(
            `UPDATE supplier_subscriptions SET status = 'GRACE', grace_period_end = ?, updated_at = NOW() WHERE id = ?`,
            [graceEnd, sub.id]
          );
          await conn2.query(
            `UPDATE supplier_profiles SET subscription_status = 'GRACE', updated_at = NOW() WHERE supplier_id = ?`,
            [sub.supplier_id]
          );
          await this._recordAudit(conn2, {
            supplierId: sub.supplier_id,
            subscriptionId: sub.id,
            eventType: 'ENTERED_GRACE_PERIOD',
            fromPlan: sub.plan_code,
            toPlan: sub.plan_code,
            fromStatus: 'ACTIVE',
            toStatus: 'GRACE',
            actorRole: 'SYSTEM',
            metadata: { grace_period_end: graceEnd.toISOString() }
          });
          await this._enqueueNotification(conn2, {
            userId: sub.supplier_id,
            role: 'SUPPLIER',
            eventType: 'SUBSCRIPTION_RENEWAL_FAILED',
            eventKey: `sub:grace:${sub.id}`,
            entityId: sub.id,
            actorRole: 'SYSTEM',
            aggregateId: `subscription:${sub.id}`
          });
          results.entered_grace += 1;
        }
      }
      await conn2.commit();
    } catch (err) {
      await conn2.rollback();
      throw err;
    } finally {
      conn2.release();
    }

    // 3. Grace-period expiry -> EXPIRED (reverts effective cap to STARTER without deleting supplier data)
    const conn3 = await this.db.getConnection();
    try {
      await conn3.beginTransaction();
      const [endedGrace] = await conn3.query(
        `SELECT * FROM supplier_subscriptions
         WHERE status = 'GRACE' AND grace_period_end IS NOT NULL AND grace_period_end <= ?
         FOR UPDATE SKIP LOCKED`,
        [nowDate]
      );
      for (const sub of endedGrace) {
        await conn3.query(
          `UPDATE supplier_subscriptions SET status = 'EXPIRED', auto_renew = 0, updated_at = NOW() WHERE id = ?`,
          [sub.id]
        );
        await conn3.query(
          `UPDATE supplier_profiles
           SET subscription_plan = 'STARTER', subscription_status = 'EXPIRED', max_active_listings = 4, updated_at = NOW()
           WHERE supplier_id = ?`,
          [sub.supplier_id]
        );
        await this._recordAudit(conn3, {
          supplierId: sub.supplier_id,
          subscriptionId: sub.id,
          eventType: 'SUBSCRIPTION_EXPIRED',
          fromPlan: sub.plan_code,
          toPlan: 'STARTER',
          fromStatus: 'GRACE',
          toStatus: 'EXPIRED',
          actorRole: 'SYSTEM'
        });
        await this._enqueueNotification(conn3, {
          userId: sub.supplier_id,
          role: 'SUPPLIER',
          eventType: 'SUBSCRIPTION_EXPIRED',
          eventKey: `sub:expired:${sub.id}`,
          entityId: sub.id,
          actorRole: 'SYSTEM',
          aggregateId: `subscription:${sub.id}`
        });
        results.expired += 1;
      }
      await conn3.commit();
    } catch (err) {
      await conn3.rollback();
      throw err;
    } finally {
      conn3.release();
    }

    return results;
  }
}

module.exports = new SupplierSubscriptionLifecycleService();
module.exports.SupplierSubscriptionLifecycleService = SupplierSubscriptionLifecycleService;
