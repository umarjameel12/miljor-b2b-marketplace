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
const { SafepayV3SandboxClient } = require('./safepayV3SandboxClient');
const { normalizeSucceededWebhook } = require('./safepayV3ContractService');

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
    const useV3=process.env.SAFEPAY_TRACKER_CONTRACT==='payments-v3-minor';
    if(useV3){
      if(process.env.SAFEPAY_V3_SANDBOX_ENABLED!=='true')
        throw error('SAFEPAY_V3_SANDBOX_DISABLED',503,'Safepay v3 subscription checkout is not enabled');
      // Explicitly opt into the independent signed-capture journal. Existing
      // Sandbox merchant contracts still require external provider certification.
      if(process.env.SAFEPAY_V3_SUBSCRIPTION_SIGNED_CAPTURE_ENABLED!=='true')
        throw error('V3_SUBSCRIPTION_CAPTURE_PROOF_REQUIRED',409,
          'Safepay v3 subscription checkout needs explicitly enabled signed-capture processing');
      if(!['miljor_test_db','miljor_sandbox_db'].includes(process.env.DB_NAME))
        throw error('V3_SUBSCRIPTION_ISOLATION_REQUIRED',503,
          'V3 supplier subscription checkout requires an isolated Sandbox database');
    }else if(typeof this.safepay.assertTrackerContract==='function'){
      this.safepay.assertTrackerContract();
    }
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
    let checkoutUrl;
    const providerContract=useV3?'payments-v3-minor':'legacy-v1-major';
    try {
      const orderCode=`MILJOR-SUB-${attemptId}`;
      if(useV3){
        const v3=new SafepayV3SandboxClient({env:{...process.env,FRONTEND_URL:frontend}});
        const checkout=await v3.createHostedCheckout({
          amountPkr:price,orderCode,
          redirectUrl:`${frontend}/supplier/subscription?checkout_id=${attemptId}`,
          cancelUrl:`${frontend}/supplier/subscription?checkout_cancelled=1`
        });
        tracker={trackerToken:checkout.trackerToken};
        checkoutUrl=checkout.checkoutUrl;
      }else{
        tracker = await this.safepay.createTracker({
          amount: Number(price), currency: 'PKR', orderCode
        });
        if (!tracker?.trackerToken) throw error('INVALID_PROVIDER_RESPONSE', 502, 'Safepay tracker missing');
        checkoutUrl = this.safepay.constructCheckoutUrl({
          trackerToken: tracker.trackerToken, orderCode,
          redirectUrl: `${frontend}/supplier/subscription?checkout_id=${attemptId}`,
          cancelUrl: `${frontend}/supplier/subscription?checkout_cancelled=1`
        });
      }
      const [result] = await this.db.query(
        "UPDATE supplier_subscription_checkout_attempts SET status='INITIATED',tracker_token=?,checkout_url=?,provider_contract=? WHERE id=? AND supplier_id=? AND status='INITIATING'",
        [tracker.trackerToken, checkoutUrl, providerContract, attemptId, supplierId]);
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

  // INTERNAL ONLY: invoked from the shared Safepay raw-body HMAC-authenticated
  // webhook handler, not from a buyer/supplier request or browser redirect.
  // Journal and entitlement activation are one MySQL transaction. It handles
  // one-time supplier PLAN invoices, NOT Safepay recurring subscriptions.
  async acceptSignedV3Capture({payload,eventType,eventId}) {
    if(process.env.SAFEPAY_ENV!=='sandbox'||
       process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT!=='false'||
       !['miljor_test_db','miljor_sandbox_db'].includes(process.env.DB_NAME))
      throw error('V3_SUBSCRIPTION_ISOLATION_REQUIRED',503,
        'Signed subscription capture requires the isolated Safepay Sandbox');
    if(typeof eventId!=='string'||!/^evt_sha256_[a-f0-9]{64}$/.test(eventId))
      throw error('INVALID_SIGNED_EVENT_ID',422,'Authenticated event identity missing');
    const orderCode=payload?.data?.metadata?.order_id;
    const match=typeof orderCode==='string'
      ? /^MILJOR-SUB-([1-9][0-9]*)$/.exec(orderCode):null;
    if(!match||!Number.isSafeInteger(Number(match[1])))
      throw error('INVALID_SUBSCRIPTION_ORDER',422,'Signed subscription order identity missing');
    const id=Number(match[1]);
    const [owners]=await this.db.query(
      'SELECT id,supplier_id FROM supplier_subscription_checkout_attempts WHERE id=?',[id]);
    if(owners.length!==1)
      throw error('SUBSCRIPTION_CAPTURE_RECONCILIATION_REQUIRED',409,
        'Unmatched signed supplier payment requires independent reconciliation');
    const supplierId=Number(owners[0].supplier_id);
    const connection=await this.db.getConnection();
    try{
      await connection.beginTransaction();
      // Keep locking order consistent with subscription start/cancellation.
      const [profiles]=await connection.query(
        'SELECT supplier_id,subscription_plan,verification_status FROM supplier_profiles WHERE supplier_id=? FOR UPDATE',
        [supplierId]);
      const [rows]=await connection.query(
        'SELECT * FROM supplier_subscription_checkout_attempts WHERE id=? AND supplier_id=? FOR UPDATE',
        [id,supplierId]);
      if(rows.length!==1||profiles.length!==1)
        throw error('SUBSCRIPTION_CAPTURE_OWNERSHIP_MISMATCH',409,'Subscription owner missing');
      const attempt=rows[0],profile=profiles[0];
      if(attempt.provider_contract!=='payments-v3-minor')
        throw error('SUBSCRIPTION_CAPTURE_CONTRACT_MISMATCH',422,'Supplier attempt is not a v3 invoice');
      if(attempt.status==='PAID'){
        await connection.commit();
        return {success:true,is_duplicate:true,plan_code:attempt.plan_code,
          message:'Signed supplier payment already recorded'};
      }
      if(!['INITIATED','UNKNOWN'].includes(attempt.status))
        throw error('SUBSCRIPTION_CAPTURE_STATE_MISMATCH',409,'Supplier checkout is not awaiting payment');
      if(profile.verification_status!=='VERIFIED'||profile.subscription_plan!=='STARTER')
        throw error('SUBSCRIPTION_CAPTURE_PROFILE_CONFLICT',409,
          'Supplier verification or subscription changed; finance review required');
      const normalized=normalizeSucceededWebhook({
        eventType,data:payload.data,
        merchantApiKey:payload.merchant_api_key,
        expectedMerchantApiKey:process.env.SAFEPAY_PUBLIC_KEY,
        expectedTrackerToken:attempt.tracker_token,
        expectedOrderCode:orderCode,
        expectedAmountPkr:attempt.amount_pkr
      });
      if(!exact.exactDecimalEquals(normalized.amountPkr,attempt.amount_pkr,2)||
         attempt.currency!=='PKR')
        throw error('SUBSCRIPTION_CAPTURE_AMOUNT_MISMATCH',422,'Captured amount/currency mismatch');
      const [plans]=await connection.query(
        'SELECT monthly_price_pkr,max_active_listings FROM subscription_plans WHERE plan_code=? FOR UPDATE',
        [attempt.plan_code]);
      if(plans.length!==1||
         !exact.exactDecimalEquals(plans[0].monthly_price_pkr,attempt.amount_pkr,2))
        throw error('SUBSCRIPTION_CAPTURE_PLAN_PRICE_CHANGED',409,
          'Plan price changed; manual finance review required');
      // Unique event ID and unique attempt ID prevent second capture
      // evidence even if the provider varies its signed event token.
      await connection.query(
        'INSERT INTO supplier_subscription_capture_events (event_id,checkout_attempt_id,supplier_id,tracker_token,amount_pkr,currency,event_type) VALUES (?,?,?,?,?,?,?)',
        [eventId,id,supplierId,attempt.tracker_token,attempt.amount_pkr,'PKR',eventType]);
      const [subscription]=await connection.query(
        "INSERT INTO supplier_subscriptions (supplier_id,plan_code,status,current_period_start,current_period_end,billing_cycle,auto_renew,price_pkr) VALUES (?,?,'ACTIVE',NOW(),DATE_ADD(NOW(),INTERVAL 1 MONTH),'MONTHLY',0,?)",
        [supplierId,attempt.plan_code,attempt.amount_pkr]);
      await connection.query(
        "UPDATE supplier_profiles SET subscription_plan=?,subscription_status='ACTIVE',max_active_listings=?,updated_at=NOW() WHERE supplier_id=?",
        [attempt.plan_code,plans[0].max_active_listings,supplierId]);
      await connection.query(
        "UPDATE supplier_subscription_checkout_attempts SET status='PAID',paid_subscription_id=? WHERE id=? AND supplier_id=?",
        [subscription.insertId,id,supplierId]);
      await connection.query(
        "INSERT INTO system_audit_logs (actor_id,actor_role,action,entity_name,entity_id,new_value) VALUES (?,'SUPPLIER','SUBSCRIPTION_VERIFIED_PAYMENT','supplier_subscriptions',?,?)",
        [supplierId,subscription.insertId,JSON.stringify({
          plan:attempt.plan_code,attempt:id,
          provider:'SAFEPAY_SANDBOX',evidence:'SIGNED_V3_CAPTURE',event_id:eventId
        })]);
      await notificationService.enqueueEvent(connection,{
        userId:supplierId,role:'SUPPLIER',eventType:'SUBSCRIPTION_ACTIVATED',
        eventKey:'supplier:subscription:'+subscription.insertId+':activated',
        entityId:subscription.insertId
      });
      await connection.commit();
      return {success:true,reconciled:true,payment_status:'PAID',
        plan_code:attempt.plan_code,subscription_id:subscription.insertId,
        message:'Signed Safepay supplier payment verified and plan activated'};
    }catch(e){await connection.rollback();throw e;}
    finally{connection.release();}
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
    let paidAmount;
    let providerTransactionId;
    if((attempt.provider_contract||'legacy-v1-major')==='payments-v3-minor'){
      const v3=new SafepayV3SandboxClient({env:{...process.env,FRONTEND_URL:baseUrl()}});
      const report=await v3.inspectPaymentTracker({
        trackerToken:attempt.tracker_token,
        amountPkr:attempt.amount_pkr,
        orderCode:`MILJOR-SUB-${attempt.id}`
      });
      if(report.state!=='TRACKER_ENDED')
        return {reconciled:false,provider_state:report.state||'UNKNOWN'};
      // A TRACKER_ENDED reporter status and quote are NOT proof of a
      // successful captured subscription charge. No verified v3 subscription
      // callback/transaction capture journal is available on this path.
      // Fail closed rather than granting paid plan entitlements.
      throw error('V3_SUBSCRIPTION_CAPTURE_PROOF_REQUIRED',409,
        'Signed captured payment evidence is required before activating a v3 subscription');
    }else if((attempt.provider_contract||'legacy-v1-major')==='legacy-v1-major'){
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
      if (!['SUCCESS','SUCCEEDED','PAID','CAPTURED','COMPLETED'].includes(transactionState)) {
        return {reconciled: false, provider_state: transactionState || 'UNVERIFIED_TRANSACTION'};
      }
      providerTransactionId=tracker.transaction.token||
        tracker.transaction.id||tracker.transaction.reference;
      if(typeof providerTransactionId!=='string'||
         !/^[A-Za-z0-9:_-]{4,150}$/.test(providerTransactionId)){
        throw error('PROVIDER_TRANSACTION_ID_MISSING',502,
          'Provider transaction identity is required before subscription activation');
      }
      const currency = tracker.currency || tracker.transaction.currency;
      if (currency !== 'PKR') throw error('CURRENCY_MISMATCH', 422, 'Provider currency mismatch');
      paidAmount = parseAmount(tracker.amount ?? tracker.transaction.amount);
    }else{
      throw error('UNKNOWN_PAYMENT_PROVIDER_CONTRACT',503,'Unknown supplier subscription payment contract');
    }
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
