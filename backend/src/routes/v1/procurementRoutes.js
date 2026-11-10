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
router.post('/flash-pools', protect, authorizeStrict('SUPPLIER'), (req, res) => controller.createFlashPool(req, res));
router.get('/flash-pools/mine', protect, authorizeStrict('SUPPLIER'), (req, res) => controller.getMyFlashPools(req, res));
router.post('/flash-pools/:id/publish', protect, authorizeStrict('SUPPLIER'), (req, res) => controller.publishFlashPool(req, res));
router.put('/flash-pools/:id', protect, authorizeStrict('SUPPLIER'), (req, res) => controller.updateFlashDraft(req, res));
router.post('/flash-pools/:id/cancel', protect, authorizeStrict('SUPPLIER'), (req, res) => controller.cancelFlashPool(req, res));
router.post('/flash-pools/:id/hold', protect, authorizeStrict('BUYER'), (req, res) => controller.reserveFlashPool(req, res));
router.get('/flash-pools/holds/:holdId', protect, authorizeStrict('BUYER'), (req, res) => controller.getFlashHold(req, res));
router.post('/flash-pools/:id/expire', protect, authorizeStrict('SUPPLIER'), (req, res) => controller.expireFlashPool(req, res));

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
