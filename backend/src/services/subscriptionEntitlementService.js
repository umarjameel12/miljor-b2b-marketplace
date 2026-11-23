// =============================================================================
// src/services/subscriptionEntitlementService.js
// MilJor Package E3: Supplier Subscriptions & Entitlements Engine
// Authoritative Family Slot Accounting (STARTER=4, GROWTH=13, BUSINESS=25)
// Transaction-safe enforcement at publish/reactivation boundaries
// =============================================================================

const db = require('../config/db');

const PLAN_LIMITS = {
  STARTER: { maxFamilies: 4, maxListings: 4, name: 'Starter Supplier' },
  GROWTH: { maxFamilies: 13, maxListings: 13, name: 'Growth Wholesale Partner' },
  BUSINESS: { maxFamilies: 25, maxListings: 25, name: 'Enterprise Mill & Distributor' }
};

class SubscriptionEntitlementService {

  /**
   * Retrieves full plan details, active family counts, and remaining allowances.
   * One canonical family consumes exactly 1 slot regardless of how many products, SKUs or listings it has.
   *
   * @param {number} supplierId
   * @param {Object} [connection] Optional transactional MySQL connection
   * @returns {Promise<Object>} Entitlements read model
   */
  async getSupplierEntitlements(supplierId, connection = null) {
    const conn = connection || db;

    // 1. Fetch supplier profile plan & status
    const [profiles] = await conn.query(
      `SELECT sp.supplier_id, sp.subscription_plan, sp.subscription_status, sp.verification_status,
              sp.max_active_listings, u.email, u.full_name
       FROM supplier_profiles sp
       JOIN users u ON u.id = sp.supplier_id
       WHERE sp.supplier_id = ?`,
      [supplierId]
    );

    if (profiles.length === 0) {
      const err = new Error('Supplier profile not found');
      err.code = 'SUPPLIER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const profile = profiles[0];
    const planCode = (profile.subscription_plan || 'STARTER').toUpperCase();
    const planConfig = PLAN_LIMITS[planCode] || PLAN_LIMITS.STARTER;
    const maxAllowedFamilies = planConfig.maxFamilies;

    // 2. Fetch distinct active family IDs currently in use by this supplier across:
    //    a) Published physical SKUs (via parent supplier_products)
    //    b) Active commercial listings
    //    c) Active/published regular pools
    const [familyRows] = await conn.query(
      `SELECT DISTINCT family_id FROM (
         -- Family usage from published SKUs
         SELECT sp.family_id
         FROM supplier_products sp
         JOIN supplier_skus sku ON sku.supplier_product_id = sp.id
         WHERE sp.supplier_id = ? AND sku.status = 'PUBLISHED' AND sp.family_id IS NOT NULL

         UNION

         -- Family usage from active commercial listings
         SELECT ps.family_id
         FROM supplier_listings sl
         JOIN product_specifications ps ON sl.product_spec_id = ps.id
         WHERE sl.supplier_id = ? AND sl.status = 'ACTIVE' AND ps.family_id IS NOT NULL

         UNION

         -- Family usage from active/published regular pools
         SELECT ps.family_id
         FROM pools p
         JOIN product_specifications ps ON p.product_spec_id = ps.id
         WHERE p.supplier_id = ? AND p.status IN ('ACTIVE','THRESHOLD_MET','CONFIRMED','LOCKED','FULFILLING') AND ps.family_id IS NOT NULL
       ) AS active_families`,
      [supplierId, supplierId, supplierId]
    );

    const activeFamilyIds = familyRows.map(r => r.family_id);
    const activeFamiliesCount = activeFamilyIds.length;
    const remainingFamilySlots = Math.max(0, maxAllowedFamilies - activeFamiliesCount);
    const isOverLimit = activeFamiliesCount > maxAllowedFamilies;

    // 3. Fetch active listings count
    const [listingCountRows] = await conn.query(
      `SELECT COUNT(*) as activeCount FROM supplier_listings WHERE supplier_id = ? AND status = 'ACTIVE'`,
      [supplierId]
    );
    const activeListingsCount = listingCountRows[0].activeCount || 0;

    // 4. Fetch subscription plan table configuration & latest lifecycle state
    const [planDbRows] = await conn.query(
      `SELECT * FROM subscription_plans WHERE plan_code = ?`,
      [planCode]
    );
    const planMeta = planDbRows[0] || null;

    let latestSub = null;
    let pendingCheckout = null;
    try {
      const [subRows] = await conn.query(
        `SELECT id, plan_code, status, current_period_start, current_period_end, billing_cycle,
                auto_renew, pending_plan_code, cancel_at_period_end, cancellation_requested_at,
                grace_period_end, admin_approval_status, admin_reviewed_at, admin_review_notes,
                last_payment_attempt_id, price_pkr
         FROM supplier_subscriptions
         WHERE supplier_id = ?
         ORDER BY id DESC LIMIT 1`,
        [supplierId]
      );
      latestSub = subRows[0] || null;

      const [pendingRows] = await conn.query(
        `SELECT id, target_plan_code, change_type, amount_pkr, currency, status, tracker_token, checkout_url, failure_reason, created_at
         FROM supplier_subscription_checkout_attempts
         WHERE supplier_id = ? AND status IN ('INITIATING','INITIATED','UNKNOWN')
         ORDER BY id DESC LIMIT 1`,
        [supplierId]
      );
      pendingCheckout = pendingRows[0] || null;
    } catch (lifecycleErr) {
      if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(lifecycleErr.code)) throw lifecycleErr;
    }

    const effectiveStatus = profile.subscription_status || latestSub?.status || 'STARTER_ACTIVE';
    const effectiveMaxFamilies = ['EXPIRED', 'SUSPENDED'].includes(effectiveStatus)
      ? PLAN_LIMITS.STARTER.maxFamilies
      : maxAllowedFamilies;
    const effectiveRemaining = Math.max(0, effectiveMaxFamilies - activeFamiliesCount);
    const effectiveOverLimit = activeFamiliesCount > effectiveMaxFamilies;

    return {
      supplier_id: supplierId,
      plan_code: planCode,
      current_plan: planCode,
      plan_name: planConfig.name,
      subscription_status: effectiveStatus,
      verification_status: profile.verification_status,
      max_allowed_families: effectiveMaxFamilies,
      max_families: effectiveMaxFamilies,
      active_families_count: activeFamiliesCount,
      used_distinct_families: activeFamiliesCount,
      remaining_family_slots: effectiveRemaining,
      remaining_slots: effectiveRemaining,
      active_family_ids: activeFamilyIds,
      is_over_limit: effectiveOverLimit,
      can_publish_new_family: !effectiveOverLimit && !['EXPIRED', 'SUSPENDED'].includes(effectiveStatus) && activeFamiliesCount < effectiveMaxFamilies,
      max_active_listings: ['EXPIRED', 'SUSPENDED'].includes(effectiveStatus)
        ? PLAN_LIMITS.STARTER.maxListings
        : (profile.max_active_listings || planConfig.maxListings),
      active_listings_count: activeListingsCount,
      plan_details: planMeta,
      active_subscription_id: latestSub?.id || null,
      current_period_start: latestSub?.current_period_start || null,
      current_period_end: latestSub?.current_period_end || null,
      grace_period_end: latestSub?.grace_period_end || null,
      auto_renew: latestSub ? Boolean(latestSub.auto_renew) : true,
      cancel_at_period_end: latestSub ? Boolean(latestSub.cancel_at_period_end) : false,
      cancellation_requested_at: latestSub?.cancellation_requested_at || null,
      pending_plan_code: latestSub?.pending_plan_code || null,
      admin_approval_status: latestSub?.admin_approval_status || 'NOT_REQUIRED',
      admin_review_notes: latestSub?.admin_review_notes || null,
      pending_checkout: pendingCheckout
    };
  }

  /**
   * Enforces server-side family limits under strict row-level lock.
   * Allows publishing immediately if the family is ALREADY in the supplier's active family set.
   * Blocks with 403 ENTITLEMENT_LIMIT_EXCEEDED if supplier attempts to use a new family when cap is reached.
   *
   * @param {number} supplierId
   * @param {number} targetFamilyId
   * @param {Object} connection Required transactional MySQL connection
   */
  async assertCanPublishInFamily(supplierId, targetFamilyId, connection) {
    if (!connection) {
      throw new Error('assertCanPublishInFamily requires an active transactional database connection');
    }

    // Existing family uses no new entitlement slot. A SHARED supplier-profile
    // lock protects verification/plan changes while permitting concurrent
    // published-SKU pools to proceed. New family additions MUST still take
    // the EXCLUSIVE supplier-profile lock and re-evaluate the slot count.
    const observed = await this.getSupplierEntitlements(supplierId, connection);
    if (observed.active_family_ids.includes(Number(targetFamilyId))) {
      await connection.query(
        'SELECT supplier_id FROM supplier_profiles WHERE supplier_id = ? FOR SHARE',
        [supplierId]
      );
      const current = await this.getSupplierEntitlements(supplierId, connection);
      if (!current.active_family_ids.includes(Number(targetFamilyId))) {
        const err = new Error('Supplier family publication changed concurrently; retry');
        err.code = 'ENTITLEMENT_REVALIDATION_REQUIRED';
        err.statusCode = 409;
        throw err;
      }
      return { allowed:true,reason:'EXISTING_ACTIVE_FAMILY',entitlements:current };
    }
    await connection.query(
      'SELECT supplier_id FROM supplier_profiles WHERE supplier_id = ? FOR UPDATE',
      [supplierId]
    );
    const entitlements = await this.getSupplierEntitlements(supplierId, connection);

    // If target family is already among the supplier's active families, it consumes NO extra slot
    if (entitlements.active_family_ids.includes(Number(targetFamilyId))) {
      return { allowed: true, reason: 'EXISTING_ACTIVE_FAMILY', entitlements };
    }

    // New family requested: block expired/suspended subscriptions first, then check family slots
    if (['EXPIRED', 'SUSPENDED'].includes(entitlements.subscription_status)) {
      const err = new Error(
        `Supplier subscription is ${entitlements.subscription_status}. Renew or reactivate your subscription before publishing new product families.`
      );
      err.code = 'ENTITLEMENT_SUBSCRIPTION_INACTIVE';
      err.subcode = `SUBSCRIPTION_${entitlements.subscription_status}`;
      err.statusCode = 403;
      err.details = {
        plan_code: entitlements.plan_code,
        subscription_status: entitlements.subscription_status,
        target_family_id: Number(targetFamilyId)
      };
      throw err;
    }

    if (entitlements.active_families_count >= entitlements.max_allowed_families) {
      const err = new Error(
        `Supplier plan ${entitlements.plan_code} allows up to ${entitlements.max_allowed_families} distinct active product families. ` +
        `Current usage is ${entitlements.active_families_count} families. Please upgrade your subscription plan to publish products in new families.`
      );
      err.code = 'ENTITLEMENT_LIMIT_EXCEEDED';
      err.subcode = 'FAMILY_CAP_REACHED';
      err.statusCode = 403;
      err.details = {
        plan_code: entitlements.plan_code,
        max_allowed_families: entitlements.max_allowed_families,
        active_families_count: entitlements.active_families_count,
        target_family_id: Number(targetFamilyId),
        active_family_ids: entitlements.active_family_ids
      };
      throw err;
    }

    return { allowed: true, reason: 'NEW_FAMILY_WITHIN_CAP', entitlements };
  }

  /**
   * Safely changes a supplier's subscription plan.
   * ENFORCES:
   * 1. Paid plan upgrades (GROWTH/BUSINESS) require payment verification; ordinary suppliers cannot self-activate.
   * 2. Administrative overrides are strictly restricted to ADMIN / SUPER_ADMIN and audited.
   * 3. Cross-supplier tampering is blocked (403).
   * 4. Unsupported ANNUAL billing cycle is rejected (400 INVALID_BILLING_CYCLE).
   * 5. Downgrading to STARTER preserves all historical data and marks over-limit status without deleting products.
   */
  async changeSupplierPlan({ supplierId, newPlanCode, billingCycle = 'MONTHLY', actor = null }) {
    const normalizedPlan = (newPlanCode || '').toUpperCase();
    if (!PLAN_LIMITS[normalizedPlan]) {
      const err = new Error(`Invalid plan code: ${newPlanCode}. Allowed: STARTER, GROWTH, BUSINESS`);
      err.code = 'INVALID_PLAN_CODE';
      err.statusCode = 400;
      throw err;
    }

    const normalizedCycle = (billingCycle || 'MONTHLY').toUpperCase();
    if (normalizedCycle === 'ANNUAL') {
      const err = new Error('Annual billing cycle is unsupported in the current release. Only MONTHLY billing is supported.');
      err.code = 'INVALID_BILLING_CYCLE';
      err.statusCode = 400;
      throw err;
    }

    if (normalizedCycle !== 'MONTHLY' && normalizedCycle !== 'FREE') {
      const err = new Error(`Invalid billing cycle: ${billingCycle}. Supported cycles: MONTHLY.`);
      err.code = 'INVALID_BILLING_CYCLE';
      err.statusCode = 400;
      throw err;
    }

    // Check caller authority: A supplier can only modify their own subscription
    const isAdmin = actor && ['ADMIN', 'SUPER_ADMIN'].includes(actor.role);
    if (!isAdmin && actor && actor.id && Number(actor.id) !== Number(supplierId)) {
      const err = new Error("You cannot modify another supplier's subscription");
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    // Enforce payment gating for paid plans (GROWTH and BUSINESS)
    // FIX B0.2: Block ordinary supplier self-activation and block unpaid administrative grants
    // until an explicit approved commercial grant policy is enacted.
    if (normalizedPlan === 'GROWTH' || normalizedPlan === 'BUSINESS') {
      if (!isAdmin) {
        // Ordinary suppliers cannot activate paid plans without verified Safepay payment
        const err = new Error('Paid plan activation requires verified Safepay payment. Online automated subscription billing will be enabled in Phase B11.');
        err.code = 'SUBSCRIPTION_PAYMENT_REQUIRED';
        err.statusCode = 402;
        err.details = {
          requested_plan: normalizedPlan,
          payment_provider: 'SAFEPAY',
          billing_phase: 'B11'
        };
        throw err;
      }

      // Administrative grant check: New unpaid paid-plan grants are blocked until an explicit commercial grant policy is approved
      const err = new Error(`Administrative grant of paid subscription plan '${normalizedPlan}' is disabled. Unpaid administrative grants require an approved commercial grant policy.`);
      err.code = 'COMMERCIAL_GRANT_POLICY_REQUIRED';
      err.statusCode = 403;
      err.details = {
        requested_plan: normalizedPlan,
        actor_role: actor?.role || 'ADMIN'
      };
      throw err;
    }

    const planConfig = PLAN_LIMITS[normalizedPlan];
    let connection = null;

    try {
      connection = await db.getConnection();
      await connection.beginTransaction();

      // Lock profile
      const [profiles] = await connection.query(
        `SELECT supplier_id, subscription_plan, subscription_status FROM supplier_profiles WHERE supplier_id = ? FOR UPDATE`,
        [supplierId]
      );
      if (profiles.length === 0) {
        const err = new Error('Supplier profile not found');
        err.code = 'SUPPLIER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const previousPlan = profiles[0].subscription_plan;
      const newStatus = normalizedPlan === 'STARTER' ? 'STARTER_ACTIVE' : 'ACTIVE';

      // Update supplier_profiles
      await connection.query(
        `UPDATE supplier_profiles
         SET subscription_plan = ?,
             subscription_status = ?,
             max_active_listings = ?,
             updated_at = NOW()
         WHERE supplier_id = ?`,
        [normalizedPlan, newStatus, planConfig.maxListings, supplierId]
      );

      // Record in supplier_subscriptions
      const [planRows] = await connection.query(
        `SELECT * FROM subscription_plans WHERE plan_code = ?`,
        [normalizedPlan]
      );
      const pricePkr = planRows.length > 0 ? (normalizedCycle === 'ANNUAL' ? planRows[0].annual_price_pkr : planRows[0].monthly_price_pkr) : 0;
      const periodEnd = normalizedPlan === 'STARTER' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await connection.query(
        `INSERT INTO supplier_subscriptions (supplier_id, plan_code, status, current_period_start, current_period_end, billing_cycle, price_pkr)
         VALUES (?, ?, ?, NOW(), ?, ?, ?)`,
        [supplierId, normalizedPlan, newStatus, periodEnd, normalizedCycle, pricePkr]
      );

      // System audit log
      const auditAction = isAdmin ? 'SUBSCRIPTION_PLAN_CHANGED_BY_ADMIN' : 'SUBSCRIPTION_PLAN_CHANGED';
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, ?, ?, 'supplier_profiles', ?, ?, ?)`,
        [
          actor ? actor.id : supplierId,
          actor ? actor.role : 'SUPPLIER',
          auditAction,
          supplierId,
          JSON.stringify({ plan: previousPlan }),
          JSON.stringify({ plan: normalizedPlan, billing_cycle: normalizedCycle, administrative_grant: isAdmin })
        ]
      );

      await connection.commit();

      // Return updated entitlements
      return await this.getSupplierEntitlements(supplierId);
    } catch (error) {
      if (connection) await connection.rollback();
      throw error;
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * Retrieves all active subscription plan tiers for display.
   */
  async getAllPlans() {
    const [rows] = await db.query(
      `SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY monthly_price_pkr ASC`
    );
    return rows;
  }
}

module.exports = new SubscriptionEntitlementService();
