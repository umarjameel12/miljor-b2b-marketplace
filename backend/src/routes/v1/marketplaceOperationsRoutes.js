// =============================================================================
// src/routes/v1/marketplaceOperationsRoutes.js
// MilJor Package E5 & E6: Invoices, Reviews, Messaging, Promotions Routes
// =============================================================================

const express = require('express');
const router = express.Router();
const controller = require('../../controllers/marketplaceOperationsController');
const { protect, authorize } = require('../../middlewares/authGuard');

// Invoices (E5)
router.get('/invoices/:orderId', protect, (req, res) => controller.getInvoiceByOrderId(req, res));

// Reviews (E6)
router.post('/reviews', protect, (req, res) => controller.submitReview(req, res));
router.get('/reviews/supplier/:supplierId', (req, res) => controller.getSupplierReviews(req, res));

// Contextual Messaging & Anti-Bypass (E6)
router.post('/messages/conversations', protect, (req, res) => controller.getOrCreateConversation(req, res));
router.post('/messages/conversations/:conversationId', protect, (req, res) => controller.sendMessage(req, res));
router.get('/messages/conversations/:conversationId', protect, (req, res) => controller.getMessages(req, res));

// Promotions & Sponsored Listings (E6)
router.post('/promotions', protect, authorize('SUPPLIER', 'ADMIN'), (req, res) => controller.createPromotion(req, res));
router.get('/promotions', (req, res) => controller.getActivePromotions(req, res));

module.exports = router;
