// =============================================================================
// src/routes/v1/procurementRoutes.js
// MilJor Package E4: Procurement Modes Routes (Flash, RFQ, Recurring, Demand)
// =============================================================================

const express = require('express');
const router = express.Router();
const controller = require('../../controllers/procurementController');
const { protect, authorize, authorizeStrict } = require('../../middlewares/authGuard');

// Flash Pools
router.get('/flash-pools', (req, res) => controller.getFlashPools(req, res));
router.post('/flash-pools', protect, authorize('SUPPLIER', 'ADMIN'), (req, res) => controller.createFlashPool(req, res));

// Demand Pool Requests ("Request a Pool")
router.get('/demand-requests', (req, res) => controller.getDemandRequests(req, res));
router.post('/demand-requests', protect, authorize('BUYER', 'SUPPLIER', 'ADMIN'), (req, res) => controller.createDemandRequest(req, res));

// RFQs & Quotes
router.post('/rfqs', protect, authorize('BUYER', 'ADMIN'), (req, res) => controller.createRfq(req, res));
router.post('/rfqs/:id/quotes', protect, authorize('SUPPLIER', 'ADMIN'), (req, res) => controller.submitRfqQuote(req, res));
router.post('/rfqs/:id/quotes/:quoteId/accept', protect, authorize('BUYER', 'ADMIN'), (req, res) => controller.acceptRfqQuote(req, res));

// Recurring Contracts
router.post('/recurring', protect, authorize('BUYER', 'ADMIN'), (req, res) => controller.createRecurringContract(req, res));

// Supplier Matching
router.get('/match-suppliers', (req, res) => controller.matchSuppliers(req, res));

module.exports = router;
