// =============================================================================
// src/routes/v1/deliveryQuotationRoutes.js
// MilJor Special Phase G2: Delivery Options & Quotation Routes
// =============================================================================
const express = require('express');
const router = express.Router();
const deliveryQuotationController = require('../../controllers/deliveryQuotationController');
const { protect, authorize } = require('../../middlewares/authGuard');

// GET delivery options for a pool (can be queried with or without authentication)
router.get('/pools/:id/delivery-options', (req, res) => deliveryQuotationController.getPoolDeliveryOptions(req, res));

// POST delivery quote (requires authenticated buyer or admin)
router.post('/delivery/quote', protect, authorize('BUYER', 'ADMIN'), (req, res) => deliveryQuotationController.createQuote(req, res));

// POST accept delivery quote (requires authenticated buyer or admin)
router.post('/delivery/quote/accept', protect, authorize('BUYER', 'ADMIN'), (req, res) => deliveryQuotationController.acceptQuote(req, res));

module.exports = router;
