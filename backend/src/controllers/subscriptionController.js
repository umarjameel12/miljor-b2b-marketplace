// =============================================================================
// src/controllers/subscriptionController.js
// MilJor Package E3: Supplier Subscription & Entitlements Controller
// =============================================================================

const subscriptionEntitlementService = require('../services/subscriptionEntitlementService');
const supplierSubscriptionLifecycleService = require('../services/supplierSubscriptionLifecycleService');
const db = require('../config/db');

class SubscriptionController {

  // GET /api/v1/supplier/subscription
  async getMySubscription(req, res) {
    try {
      const requestedSupplierId = req.query.supplier_id ? Number(req.query.supplier_id) : null;
      const overview = await supplierSubscriptionLifecycleService.getSupplierSubscriptionOverview(req.user, requestedSupplierId);

      return res.status(200).json({
        success: true,
        data: overview
      });
    } catch (error) {
      console.error('Get Subscription Error:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // POST /api/v1/supplier/subscription/upgrade
  async changePlan(req, res) {
    try {
      const planCode = req.body.plan_code || req.body.targetPlan;
      const billingCycle = req.body.billing_cycle || req.body.billingCycle || 'MONTHLY';

      if (!planCode) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_PLAN_CODE', message: 'plan_code is required (STARTER, GROWTH, BUSINESS)' }
        });
      }

      // Authorization guard: non-admin callers cannot modify another supplier's subscription
      let targetSupplierId = req.user.id;
      if (req.body.supplier_id) {
        if (Number(req.body.supplier_id) !== Number(req.user.id) && !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: "You cannot modify another supplier's subscription" }
          });
        }
        targetSupplierId = Number(req.body.supplier_id);
      }

      const updated = await subscriptionEntitlementService.changeSupplierPlan({
        supplierId: targetSupplierId,
        newPlanCode: planCode,
        billingCycle: billingCycle,
        actor: req.user
      });

      return res.status(200).json({
        success: true,
        message: `Subscription successfully updated to ${updated.plan_code}.`,
        data: { entitlements: updated }
      });
    } catch (error) {
      console.error('Change Plan Error:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message, details: error.details }
      });
    }
  }

  // GET /api/v1/subscriptions/plans (Public / Authenticated)
  async getPlans(req, res) {
    try {
      const plans = await subscriptionEntitlementService.getAllPlans();
      return res.status(200).json({
        success: true,
        data: { plans }
      });
    } catch (error) {
      console.error('Get Plans Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // PUT /api/v1/admin/subscriptions/plans/:planCode (Admin only)
  async adminUpdatePlan(req, res) {
    try {
      const planCode = req.params.planCode.toUpperCase();
      const { monthly_price_pkr, annual_price_pkr, transaction_fee_pct, max_active_families, max_active_listings } = req.body;

      await db.query(
        `UPDATE subscription_plans
         SET monthly_price_pkr = COALESCE(?, monthly_price_pkr),
             annual_price_pkr = COALESCE(?, annual_price_pkr),
             transaction_fee_pct = COALESCE(?, transaction_fee_pct),
             max_active_families = COALESCE(?, max_active_families),
             max_active_listings = COALESCE(?, max_active_listings),
             updated_at = NOW()
         WHERE plan_code = ?`,
        [monthly_price_pkr, annual_price_pkr, transaction_fee_pct, max_active_families, max_active_listings, planCode]
      );

      const [updated] = await db.query('SELECT * FROM subscription_plans WHERE plan_code = ?', [planCode]);
      return res.status(200).json({
        success: true,
        message: `Plan ${planCode} updated successfully.`,
        data: { plan: updated[0] }
      });
    } catch (error) {
      console.error('Admin Update Plan Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }
  // POST /api/v1/supplier/subscription/renewal-consent
  async recordRenewalConsent(req, res) {
    try {
      const result = await supplierSubscriptionLifecycleService.recordRenewalConsent({
        actor: req.user,
        subscriptionId: req.body?.subscription_id,
        expectedNewPricePkr: req.body?.expected_new_price_pkr
      });
      return res.status(201).json({
        success: true,
        data: result
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message, details: error.details }
      });
    }
  }

  // POST /api/v1/supplier/subscription/checkout
  async initiateCheckout(req, res) {
    try {
      const planCode = req.body.plan_code || req.body.targetPlan;
      const idempotencyKey = req.body.idempotency_key || req.headers['idempotency-key'];
      const renewalConsentToken = req.body?.renewal_consent_token || null;
      const result = await supplierSubscriptionLifecycleService.initiateCheckout({
        actor: req.user,
        planCode,
        idempotencyKey,
        renewalConsentToken
      });
      return res.status(result.replay ? 200 : 201).json({
        success: true,
        data: result
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message, details: error.details }
      });
    }
  }

  // POST /api/v1/supplier/subscription/checkout/:attemptId/reconcile
  async reconcileCheckout(req, res) {
    try {
      const attemptId = Number(req.params.attemptId);
      const result = await supplierSubscriptionLifecycleService.reconcileCheckoutAttempt({
        actor: req.user,
        attemptId
      });
      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message, details: error.details }
      });
    }
  }

  // POST /api/v1/supplier/subscription/downgrade
  async scheduleDowngrade(req, res) {
    try {
      const targetPlanCode = req.body.target_plan_code || req.body.plan_code || req.body.targetPlan;
      const result = await supplierSubscriptionLifecycleService.scheduleDowngrade({
        actor: req.user,
        targetPlanCode
      });
      return res.status(200).json({
        success: true,
        message: `Downgrade to ${result.pending_plan_code} scheduled for period end.`,
        data: result
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // POST /api/v1/supplier/subscription/cancel
  async requestCancellation(req, res) {
    try {
      const result = await supplierSubscriptionLifecycleService.requestCancellation({
        actor: req.user,
        reason: req.body?.reason
      });
      return res.status(200).json({
        success: true,
        message: 'Subscription cancellation scheduled for end of current paid period.',
        data: result
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // POST /api/v1/payments/webhook/safepay/subscription
  async handleSafepayWebhook(req, res) {
    try {
      const signature = req.headers['x-sfpy-signature'] || req.headers['x-safepay-signature'];
      const result = await supplierSubscriptionLifecycleService.processSafepayWebhook({
        rawBody: req.rawBody,
        signature,
        headers: req.headers,
        body: req.body
      });
      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: { code: error.code || 'WEBHOOK_FAILED', message: error.message }
      });
    }
  }

  // GET /api/v1/admin/subscriptions
  async adminListSubscriptions(req, res) {
    try {
      const status = req.query.status ? String(req.query.status).toUpperCase() : null;
      const subscriptions = await supplierSubscriptionLifecycleService.adminListSubscriptions({ status });
      return res.status(200).json({
        success: true,
        data: { subscriptions }
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // POST /api/v1/admin/subscriptions/:subscriptionId/approve
  async adminApproveSubscription(req, res) {
    try {
      const subscriptionId = Number(req.params.subscriptionId);
      const result = await supplierSubscriptionLifecycleService.adminApproveSubscription({
        subscriptionId,
        adminActor: req.user,
        notes: req.body?.notes
      });
      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // POST /api/v1/admin/subscriptions/:subscriptionId/reject
  async adminRejectSubscription(req, res) {
    try {
      const subscriptionId = Number(req.params.subscriptionId);
      const result = await supplierSubscriptionLifecycleService.adminRejectSubscription({
        subscriptionId,
        adminActor: req.user,
        reason: req.body?.reason
      });
      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message }
      });
    }
  }
}

module.exports = new SubscriptionController();
