// =============================================================================
// src/routes/v1/disputeRoutes.js
// MilJor Part 4E.5: Buyer Protection, Dispute & Fulfillment Exception Resolution Routes
//
// Least Privilege Role Enforcement:
//   - Buyer endpoints: authorizeStrict('BUYER')
//   - Supplier endpoints: authorizeStrict('SUPPLIER')
//   - Admin endpoints: authorizeAdmin
//   - Object-level details: protect (verified in controller/service)
// =============================================================================

const express = require('express');
const router = express.Router();
const disputeController = require('../../controllers/disputeController');
const {
  protect,
  authorizeStrict,
  authorizeAdmin
} = require('../../middlewares/authGuard');
const idempotencyGuard = require('../../middlewares/idempotencyGuard');

// =============================================================================
// 1. BUYER DISPUTE ENDPOINTS
// =============================================================================

// File a dispute for an eligible order (Mandatory X-Idempotency-Key)
router.post(
  '/',
  protect,
  authorizeStrict('BUYER'),
  idempotencyGuard.required,
  (req, res) => disputeController.createDispute(req, res)
);

// View buyer's own disputes
router.get(
  '/my',
  protect,
  authorizeStrict('BUYER'),
  (req, res) => disputeController.getMyDisputes(req, res)
);

// Buyer confirms receipt of physical remediation goods (Mandatory X-Idempotency-Key)
router.post(
  '/:id/remediation/confirm-receipt',
  protect,
  authorizeStrict('BUYER'),
  idempotencyGuard.required,
  (req, res) => disputeController.confirmBuyerRemediationReceipt(req, res)
);

// =============================================================================
// 2. SUPPLIER DISPUTE ENDPOINTS
// =============================================================================

// Declare pre-dispatch inventory shortage exception (Mandatory X-Idempotency-Key)
router.post(
  '/supplier/shortage',
  protect,
  authorizeStrict('SUPPLIER'),
  idempotencyGuard.required,
  (req, res) => disputeController.declareSupplierShortage(req, res)
);

// Supplier lists disputes assigned to them
router.get(
  '/supplier/list',
  protect,
  authorizeStrict('SUPPLIER'),
  (req, res) => disputeController.getSupplierDisputes(req, res)
);

// Supplier responds to dispute and proposes remediation (Mandatory X-Idempotency-Key)
router.post(
  '/:id/supplier-response',
  protect,
  authorizeStrict('SUPPLIER'),
  idempotencyGuard.required,
  (req, res) => disputeController.submitSupplierResponse(req, res)
);

// Supplier declares remediation dispatched/delivered (Mandatory X-Idempotency-Key)
router.post(
  '/:id/remediation/declare-delivered',
  protect,
  authorizeStrict('SUPPLIER'),
  idempotencyGuard.required,
  (req, res) => disputeController.declareRemediationDelivered(req, res)
);

// =============================================================================
// 3. OBJECT-AUTHORIZED ENDPOINTS
// =============================================================================

// Get specific dispute by ID (Access verified: owning buyer, assigned supplier, or admin)
router.get(
  '/:id',
  protect,
  (req, res) => disputeController.getDisputeById(req, res)
);

// =============================================================================
// 4. ADMIN ARBITRATION & DECISION ENDPOINTS
// =============================================================================

// List all disputes (Admin with pagination and status filter)
router.get(
  '/',
  protect,
  authorizeAdmin,
  (req, res) => disputeController.getAllDisputes(req, res)
);

// Admin records operational decision (Mandatory X-Idempotency-Key)
router.post(
  '/:id/decision',
  protect,
  authorizeAdmin,
  idempotencyGuard.required,
  (req, res) => disputeController.recordAdminDecision(req, res)
);

// Admin resolves dispute (Legacy wrapper, maps safely to recordAdminDecision without money movement)
router.put(
  '/:id/resolve',
  protect,
  authorizeAdmin,
  (req, res) => disputeController.resolveDispute(req, res)
);

// Admin requests evidence from buyer/supplier
router.put(
  '/:id/request-evidence',
  protect,
  authorizeAdmin,
  (req, res) => disputeController.requestEvidence(req, res)
);

// Admin closes dispute with documented reason (Mandatory X-Idempotency-Key)
router.post(
  '/:id/close',
  protect,
  authorizeAdmin,
  idempotencyGuard.required,
  (req, res) => disputeController.closeDispute(req, res)
);

module.exports = router;
