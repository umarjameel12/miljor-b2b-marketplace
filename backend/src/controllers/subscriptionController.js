// =============================================================================
// src/controllers/subscriptionController.js
// MilJor Package E3: Supplier Subscription & Entitlements Controller
// =============================================================================

const subscriptionEntitlementService = require('../services/subscriptionEntitlementService');
const db = require('../config/db');

class SubscriptionController {

  // GET /api/v1/supplier/subscription
  async getMySubscription(req, res) {
    try {
      const supplierId = req.user.id;
      const entitlements = await subscriptionEntitlementService.getSupplierEntitlements(supplierId);

      const [history] = await db.query(
        `SELECT id, plan_code, status, current_period_start, current_period_end, billing_cycle, price_pkr, created_at
         FROM supplier_subscriptions
         WHERE supplier_id = ?
         ORDER BY id DESC LIMIT 20`,
        [supplierId]
      );

      return res.status(200).json({
        success: true,
        data: {
          entitlements,
          billing_history: history
        }
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
}

module.exports = new SubscriptionController();
