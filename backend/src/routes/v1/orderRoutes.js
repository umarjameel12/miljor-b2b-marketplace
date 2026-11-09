// =============================================================================
// src/routes/v1/orderRoutes.js
// MilJor Part 4E.3: Authoritative Order Routes
// =============================================================================

const express = require('express');
const router = express.Router();
const orderController = require('../../controllers/orderController');
const { protect, authorizeStrict } = require('../../middlewares/authGuard');
const idempotencyGuard = require('../../middlewares/idempotencyGuard');

// List orders for authenticated user (buyer, supplier, or admin)
router.get(
  '/',
  protect,
  (req, res) => orderController.getMyOrders(req, res)
);

// Alias: /my
router.get(
  '/my',
  protect,
  (req, res) => orderController.getMyOrders(req, res)
);

// Buyer initiates checkout session for an order (Mandatory X-Idempotency-Key)
// Strictly restricted to BUYER role (Administrators and Suppliers cannot initiate buyer payments)
router.post(
  '/:id/checkout',
  protect,
  authorizeStrict('BUYER'),
  idempotencyGuard.required,
  (req, res) => orderController.initiateCheckout(req, res)
);

// Get authoritative order payment status
// Authorized for the order's buyer or administrative roles
router.get(
  '/:id/payment-status',
  protect,
  (req, res) => orderController.getPaymentStatus(req, res)
);

// Reconcile order payment status directly with Safepay provider
// Authorized for the order's buyer or administrative roles
router.post(
  '/:id/reconcile',
  protect,
  (req, res) => orderController.reconcilePayment(req, res)
);

// Get single order detail with allowed actions
// Authorized for order's buyer, assigned supplier, or administrative roles
router.get(
  '/:id',
  protect,
  (req, res) => orderController.getOrderById(req, res)
);

module.exports = router;
