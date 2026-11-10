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

// B6 Smart Procurement: safe buyer-only multi-item draft and publish API.
// Registered before legacy RFQ routes, preserving B0-B4 compatibility.
router.post('/procurement/requests', protect, authorizeStrict('BUYER'), (req,res)=>controller.createSmartRequest(req,res));
router.get('/procurement/requests', protect, authorizeStrict('BUYER'), (req,res)=>controller.listSmartRequests(req,res));
router.get('/procurement/requests/:id', protect, authorizeStrict('BUYER'), (req,res)=>controller.getSmartRequest(req,res));
router.patch('/procurement/requests/:id', protect, authorizeStrict('BUYER'), (req,res)=>controller.updateSmartRequest(req,res));
router.post('/procurement/requests/:id/publish', protect, authorizeStrict('BUYER'), (req,res)=>controller.publishSmartRequest(req,res));

// B6-D supplier matching; buyer-only discovery and invitations.
// Never expose procurement request addresses or identities to suppliers.
router.get('/procurement/requests/:id/matches',protect,authorizeStrict('BUYER'),(req,res)=>controller.getSmartRequestMatches(req,res));
router.get('/procurement/requests/:id/invitations',protect,authorizeStrict('BUYER'),(req,res)=>controller.listSmartInvitations(req,res));
router.post('/procurement/requests/:id/invitations',protect,authorizeStrict('BUYER'),(req,res)=>controller.inviteSmartSupplier(req,res));
router.get('/procurement/supplier/invitations',protect,authorizeStrict('SUPPLIER'),(req,res)=>controller.smartSupplierInbox(req,res));
router.post('/procurement/supplier/invitations/:invitationId/respond',protect,authorizeStrict('SUPPLIER'),(req,res)=>controller.respondSmartInvitation(req,res));

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
