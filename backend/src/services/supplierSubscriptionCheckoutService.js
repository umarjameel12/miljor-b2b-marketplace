'use strict';
/**
 * Supplier-only, Safepay Sandbox subscription checkout.
 * Never routes subscription payments through buyer orders/escrow.
 * No automatic renewals or background charges.
 */
const crypto = require('node:crypto');
const db = require('../config/db');
const adapter = require('./safepayAdapter');
const exact = require('./exactDecimal');
const notificationService = require('./notificationService');

function error(code, status, message) {
  const e = new Error(message); e.code = code; e.statusCode = status; return e;
}
function validKey(key) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_.:-]{12,120}$/.test(key)) {
    throw error('INVALID_IDEMPOTENCY_KEY', 400, 'A 12–120 character idempotency key is required');
  }
  return key;
}
function parseAmount(value) {
  const canonical = exact.toCanonicalString(value, 2);
  if (!/^[0-9]+\.[0-9]{2}$/.test(canonical) || Number(canonical) <= 0) {
    throw error('INVALID_PLAN_PRICE', 409, 'Paid plan price is not configured');
  }
  return canonical;
}
function checkOwner(actor) {
  if (!actor || actor.role !== 'SUPPLIER' || !Number.isSafeInteger(Number(actor.id)) || Number(actor.id) <= 0) {
    throw error('FORBIDDEN', 403, 'Supplier authentication required');
  }
  return Number(actor.id);
}
function safeAttempt(row) {
  return { id: row.id, plan_code: row.plan_code, amount_pkr: row.amount_pkr,
    currency: row.currency, status: row.status, can_reconcile: Boolean(row.tracker_token && ['INITIATED','UNKNOWN'].includes(row.status)), checkout_url: row.checkout_url || null };
}
function baseUrl() {
  const url = process.env.APP_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol === 'http:' && !['localhost','127.0.0.1'].includes(parsed.hostname))) {
    throw error('INVALID_FRONTEND_ORIGIN', 500, 'Subscription checkout origin is not configured securely');
  }
  return parsed.origin;
}
class SupplierSubscriptionCheckoutService {
  constructor(database = db, safepay = adapter) {
    this.db = database;
    this.safepay = safepay;
  }
  async start({ actor, planCode, idempotencyKey }) {
    const supplierId = checkOwner(actor);
    const key = validKey(idempotencyKey);
    if (!['GROWTH','BUSINESS'].includes(planCode)) {
      throw error('INVALID_PLAN', 400, 'Select a paid plan');
    }
    if (process.env.SAFEPAY_ENV !== 'sandbox' || process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT === 'true') {
      throw error('SANDBOX_ONLY', 503, 'Subscription checkout requires Safepay Sandbox with external money movement disabled');
    }
    // A deterministic API-contract mismatch cannot create UNKNOWN billing
    // attempts that would block future supplier checkouts. Run before MySQL.
    if(typeof this.safepay.assertTrackerContract==='function')
      this.safepay.assertTrackerContract();
    const frontend = baseUrl();
    let attemptId;
    let price;
    const connection = await this.db.getConnection();
    try {
      await connection.beginTransaction();
      const [profiles] = await connection.query(
        'SELECT supplier_id, verification_status, subscription_plan FROM supplier_profiles WHERE supplier_id = ? FOR UPDATE', [supplierId]);
      if (!profiles.length || profiles[0].verification_status !== 'VERIFIED') {
        throw error('SUPPLIER_NOT_VERIFIED', 403, 'Supplier verification is required');
      }
      // Do not re-charge an existing paid period until a proration/renewal policy is deployed.
      if (profiles[0].subscription_plan !== 'STARTER') {
        throw error('ACTIVE_PAID_PLAN', 409, 'Changes to an active paid plan need a separate billing policy');
      }
      const [existing] = await connection.query(
        'SELECT * FROM supplier_subscription_checkout_attempts WHERE supplier_id = ? AND idempotency_key = ? FOR UPDATE',
        [supplierId, key]
      );
      if (existing.length) {
        await connection.commit();
        return { replay: true, attempt: safeAttempt(existing[0]) };
      }
      // Unresolved provider sessions must never be displaced by a second charge.
      const [pending] = await connection.query(
        "SELECT id, status FROM supplier_subscription_checkout_attempts WHERE supplier_id = ? AND status IN ('INITIATING','INITIATED','UNKNOWN') ORDER BY id DESC LIMIT 1 FOR UPDATE",
        [supplierId]
      );
      if (pending.length) {
        throw error('CHECKOUT_ALREADY_PENDING', 409, 'Finish or reconcile the existing checkout first');
      }
      const [plans] = await connection.query(
        'SELECT plan_code, monthly_price_pkr, is_active FROM subscription_plans WHERE plan_code = ? FOR UPDATE', [planCode]);
      if (!plans.length || Number(plans[0].is_active) !== 1) {
        throw error('PLAN_NOT_AVAILABLE', 409, 'This plan is not currently available');
      }
      price = parseAmount(plans[0].monthly_price_pkr);
      const [insert] = await connection.query(
        "INSERT INTO supplier_subscription_checkout_attempts (supplier_id,plan_code,amount_pkr,idempotency_key,status) VALUES (?,?,?,?,'INITIATING')",
        [supplierId, planCode, price, key]);
      attemptId = insert.insertId;
      await connection.commit();
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally { connection.release(); }

    // Provider network call OUTSIDE MySQL locks. Uncertain failures remain UNKNOWN;
    // never silently allow another charge if the provider might have created a tracker.
    let tracker;
    try {
      tracker = await this.safepay.createTracker({
        amount: Number(price), currency: 'PKR', orderCode: `MILJOR-SUB-${attemptId}`
      });
      if (!tracker?.trackerToken) throw error('INVALID_PROVIDER_RESPONSE', 502, 'Safepay tracker missing');
      const checkoutUrl = this.safepay.constructCheckoutUrl({
        trackerToken: tracker.trackerToken, orderCode: `MILJOR-SUB-${attemptId}`,
        redirectUrl: `${frontend}/supplier/subscription?checkout_id=${attemptId}`,
        cancelUrl: `${frontend}/supplier/subscription?checkout_cancelled=1`
      });
      const [result] = await this.db.query(
        "UPDATE supplier_subscription_checkout_attempts SET status='INITIATED',tracker_token=?,checkout_url=? WHERE id=? AND supplier_id=? AND status='INITIATING'",
        [tracker.trackerToken, checkoutUrl, attemptId, supplierId]);
      if (!result.affectedRows) throw error('CHECKOUT_STATE_CONFLICT', 409, 'Checkout state changed unexpectedly');
      return { replay: false, attempt: { id: attemptId, plan_code: planCode,
        amount_pkr: price, currency: 'PKR', status: 'INITIATED', checkout_url: checkoutUrl }};
    } catch (e) {
      await this.db.query(
        "UPDATE supplier_subscription_checkout_attempts SET status='UNKNOWN',tracker_token=COALESCE(tracker_token,?) WHERE id=? AND supplier_id=? AND status='INITIATING'",
        [tracker?.trackerToken || null,attemptId,supplierId]
      );
      throw e;
    }
  }
  async list({ actor }) {
    const supplierId = checkOwner(actor);
    const [rows] = await this.db.query(
      'SELECT id, plan_code, amount_pkr, currency, status, checkout_url FROM supplier_subscription_checkout_attempts WHERE supplier_id=? ORDER BY id DESC LIMIT 10',
      [supplierId]);
    return rows.map(safeAttempt);
  }
  async reconcile({ actor, attemptId }) {
    const supplierId = checkOwner(actor);
    const id = Number(attemptId);
    if (!Number.isSafeInteger(id) || id <= 0) throw error('INVALID_ATTEMPT', 400, 'Valid checkout attempt required');
    const [rows] = await this.db.query(
      'SELECT * FROM supplier_subscription_checkout_attempts WHERE id=? AND supplier_id=?', [id, supplierId]);
    if (!rows.length) throw error('ATTEMPT_NOT_FOUND', 404, 'Subscription checkout not found');
    const attempt = rows[0];
    if (attempt.status === 'PAID') return { reconciled: true, replay: true, plan_code: attempt.plan_code };
    if (!['INITIATED','UNKNOWN'].includes(attempt.status) || !attempt.tracker_token) {
      throw error('TRACKER_RECONCILIATION_REQUIRED', 409, 'Checkout tracker is not ready for reconciliation');
    }
    if (process.env.SAFEPAY_ENV !== 'sandbox' || process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT === 'true') {
      throw error('SANDBOX_ONLY', 503, 'Only Safepay Sandbox reconciliation is enabled');
    }
    // Authoritative provider lookup, NEVER trust a browser redirect or client-supplied amount.
    const response = await this.safepay.fetchTracker(attempt.tracker_token);
    const tracker = response?.data;
    if (!tracker || tracker.token !== attempt.tracker_token) {
      throw error('TRACKER_MISMATCH', 502, 'Provider tracker identity mismatch');
    }
    const captured = ['TRACKER_ENDED','COMPLETED','PAID'].includes(tracker.state) &&
      tracker.transaction && typeof tracker.transaction === 'object';
    if (!captured) return { reconciled: false, provider_state: tracker.state || 'UNKNOWN' };
    const transactionState = String(tracker.transaction.status || tracker.transaction.state || '').toUpperCase();
    // Sandbox tracker completion is not proof of a captured subscription charge
    // unless the nested transaction itself positively confirms success.
    if (!['SUCCESS','SUCCEEDED','PAID','CAPTURED','COMPLETED'].includes(transactionState)) {
      return {reconciled: false, provider_state: transactionState || 'UNVERIFIED_TRANSACTION'};
    }
    // Safepay responses can identify transactions as token, id or reference.
    // All are provider-owned; never accept an identity from the client.
    const providerTransactionId=tracker.transaction.token||
      tracker.transaction.id||tracker.transaction.reference;
    if(typeof providerTransactionId!=='string'||
       !/^[A-Za-z0-9:_-]{4,150}$/.test(providerTransactionId)){
      throw error('PROVIDER_TRANSACTION_ID_MISSING',502,
        'Provider transaction identity is required before subscription activation');
    }

    const currency = tracker.currency || tracker.transaction.currency;
    if (currency !== 'PKR') throw error('CURRENCY_MISMATCH', 422, 'Provider currency mismatch');
    const amountValue = tracker.amount ?? tracker.transaction.amount;
    const paidAmount = parseAmount(amountValue);
    if (!exact.exactDecimalEquals(String(attempt.amount_pkr), paidAmount, 2)) {
      throw error('AMOUNT_MISMATCH', 422, 'Provider amount differs from original subscription invoice');
    }

    const connection = await this.db.getConnection();
    try {
      await connection.beginTransaction();
      // Lock profile first; same order as subscription and cancellation operations.
      const [profiles] = await connection.query(
        'SELECT supplier_id, subscription_plan FROM supplier_profiles WHERE supplier_id = ? FOR UPDATE', [supplierId]);
      const [locked] = await connection.query(
        'SELECT * FROM supplier_subscription_checkout_attempts WHERE id=? AND supplier_id=? FOR UPDATE', [id,supplierId]);
      if (!locked.length) throw error('ATTEMPT_NOT_FOUND', 404, 'Subscription checkout not found');
      if (locked[0].status === 'PAID') {
        await connection.commit();
        return { reconciled:true, replay:true, plan_code:locked[0].plan_code };
      }
      if (!['INITIATED','UNKNOWN'].includes(locked[0].status) || locked[0].tracker_token !== attempt.tracker_token) {
        throw error('ATTEMPT_CHANGED', 409, 'Attempt changed while reconciling');
      }
      if (!profiles.length || profiles[0].subscription_plan !== 'STARTER') {
        throw error('SUBSCRIPTION_STATE_CONFLICT',409,'Subscription changed before provider verification; manual finance review required');
      }
      const [[plan]] = await connection.query(
        'SELECT monthly_price_pkr, max_active_listings FROM subscription_plans WHERE plan_code=? FOR UPDATE',
        [attempt.plan_code]);
      if (!plan || !exact.exactDecimalEquals(parseAmount(plan.monthly_price_pkr), paidAmount, 2)) {
        throw error('PLAN_PRICE_CHANGED',409,'Plan price changed; finance review required');
      }
      const [sub] = await connection.query(
        "INSERT INTO supplier_subscriptions (supplier_id,plan_code,status,current_period_start,current_period_end,billing_cycle,auto_renew,price_pkr) VALUES (?,?,'ACTIVE',NOW(),DATE_ADD(NOW(),INTERVAL 1 MONTH),'MONTHLY',0,?)",
        [supplierId, attempt.plan_code, paidAmount]);
      await connection.query(
        "UPDATE supplier_profiles SET subscription_plan=?,subscription_status='ACTIVE',max_active_listings=?,updated_at=NOW() WHERE supplier_id=?",
        [attempt.plan_code,plan.max_active_listings,supplierId]);
      await connection.query(
        "UPDATE supplier_subscription_checkout_attempts SET status='PAID',paid_subscription_id=? WHERE id=?",
        [sub.insertId,id]);
      await connection.query(
        "INSERT INTO system_audit_logs (actor_id,actor_role,action,entity_name,entity_id,previous_value,new_value) VALUES (?,'SUPPLIER','SUBSCRIPTION_VERIFIED_PAYMENT','supplier_subscriptions',?,?,?)",
        [supplierId,sub.insertId,JSON.stringify({plan:profiles[0].subscription_plan}),
          JSON.stringify({plan:attempt.plan_code,attempt:id,verified_provider:'SAFEPAY_SANDBOX'})]);
      await notificationService.enqueueEvent(connection,{
        userId:supplierId,role:'SUPPLIER',eventType:'SUBSCRIPTION_ACTIVATED',
        eventKey:'supplier:subscription:'+sub.insertId+':activated',
        entityId:sub.insertId
      });
      await connection.commit();
      return { reconciled:true, replay:false, plan_code:attempt.plan_code };
    } catch(e) { await connection.rollback(); throw e; }
    finally { connection.release(); }
  }
}
module.exports = new SupplierSubscriptionCheckoutService();
module.exports.SupplierSubscriptionCheckoutService = SupplierSubscriptionCheckoutService;
