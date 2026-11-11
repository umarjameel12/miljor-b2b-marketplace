// =============================================================================
// src/routes/v1/financialSettlementRoutes.js
// MilJor Part 4E.6: Financial Settlement, Refund, Supplier Payout & Reconciliation Routes
// =============================================================================

const express = require('express');
const router = express.Router();
const financialSettlementController = require('../../controllers/financialSettlementController');
const {
  protect,
  authorizeStrict,
  authorizeAdmin
} = require('../../middlewares/authGuard');
const idempotencyGuard = require('../../middlewares/idempotencyGuard');

// =============================================================================
// 1. SUPPLIER PAYABLE ENDPOINTS
// =============================================================================

// Accrue payable for a paid order (Admin or Internal)
router.post(
  '/payables/accrue',
  protect,
  authorizeAdmin,
  (req, res) => financialSettlementController.accruePayable(req, res)
);

// Supplier views own payables
router.get(
  '/payables/supplier',
  protect,
  authorizeStrict('SUPPLIER'),
  (req, res) => financialSettlementController.getSupplierPayables(req, res)
);

// =============================================================================
// 2. FINANCIAL HOLDS ENDPOINTS (ADMIN ONLY)
// =============================================================================

// Place a financial hold
router.post(
  '/holds',
  protect,
  authorizeAdmin,
  (req, res) => financialSettlementController.placeHold(req, res)
);

// Release a financial hold
router.post(
  '/holds/:id/release',
  protect,
  authorizeAdmin,
  (req, res) => financialSettlementController.releaseHold(req, res)
);

// =============================================================================
// 3. REFUND OBLIGATION ENDPOINTS
// =============================================================================

// Assess refund obligation (Buyer for own order, or Admin)
router.post(
  '/refunds/assess',
  protect,
  idempotencyGuard.required,
  (req, res) => financialSettlementController.assessRefund(req, res)
);

// Admin approves refund obligation (External execution disabled)
router.post(
  '/refunds/:id/approve',
  protect,
  authorizeAdmin,
  (req, res) => financialSettlementController.approveRefund(req, res)
);

// Admin confirms manual external refund
router.post(
  '/refunds/:id/confirm-manual',
  protect,
  authorizeAdmin,
  (req, res) => financialSettlementController.confirmManualRefund(req, res)
);

// Buyer views own refund obligations
router.get(
  '/refunds/my',
  protect,
  authorizeStrict('BUYER'),
  (req, res) => financialSettlementController.getBuyerRefunds(req, res)
);

// =============================================================================
// 4. SUPPLIER DISBURSEMENT ENDPOINTS (ADMIN ONLY)
// =============================================================================

// Prepare disbursement instruction (External execution disabled)
router.post(
  '/disbursements/prepare',
  protect,
  authorizeAdmin,
  idempotencyGuard.required,
  (req, res) => financialSettlementController.prepareDisbursement(req, res)
);

// Approve disbursement instruction (External execution disabled)
router.post(
  '/disbursements/:id/approve',
  protect,
  authorizeAdmin,
  (req, res) => financialSettlementController.approveDisbursement(req, res)
);

// =============================================================================
// 5. PROVIDER SETTLEMENT RECONCILIATION ENDPOINTS (ADMIN ONLY)
// =============================================================================

// Reconcile Safepay batch settlement
router.post(
  '/batches/reconcile',
  protect,
  authorizeAdmin,
  (req, res) => financialSettlementController.reconcileBatch(req, res)
);

// =============================================================================
// 6. ADMINISTRATIVE OVERVIEW & AUDIT ENDPOINTS (ADMIN ONLY)
// =============================================================================

// Financial overview
router.get(
  '/admin/overview',
  protect,
  authorizeAdmin,
  (req, res) => financialSettlementController.getAdminOverview(req, res)
);

// Read-only internal money reconciliation for one order.
router.get(
  '/admin/orders/:id/integrity',
  protect,
  authorizeAdmin,
  (req,res)=>financialSettlementController.getOrderIntegrity(req,res)
);

// Financial audit trail
router.get(
  '/audit-trail',
  protect,
  authorizeAdmin,
  (req, res) => financialSettlementController.getAuditTrail(req, res)
);

module.exports = router;
