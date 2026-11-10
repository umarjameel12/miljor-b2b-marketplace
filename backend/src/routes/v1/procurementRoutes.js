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

// B6-E supplier-owned versioned quotations; buyer reads are strictly scoped.
router.post('/procurement/supplier/requests/:id/quotes',protect,authorizeStrict('SUPPLIER'),(req,res)=>controller.submitSmartQuote(req,res));
router.get('/procurement/supplier/quotes',protect,authorizeStrict('SUPPLIER'),(req,res)=>controller.listMySmartQuotes(req,res));
router.get('/procurement/requests/:id/quotes',protect,authorizeStrict('BUYER'),(req,res)=>controller.listSmartQuotes(req,res));
router.get('/procurement/requests/:id/quotes/:quoteId/versions',protect,authorizeStrict('BUYER'),(req,res)=>controller.smartQuoteHistory(req,res));
router.post('/procurement/supplier/quotes/:quoteId/withdraw',protect,authorizeStrict('SUPPLIER'),(req,res)=>controller.withdrawSmartQuote(req,res));

// B6-F — Buyer comparison and non-binding improvement requests.
router.get('/procurement/requests/:id/compare',protect,authorizeStrict('BUYER'),(req,res)=>controller.compareSmartQuotes(req,res));
router.post('/procurement/requests/:id/quotes/:quoteId/improve',protect,authorizeStrict('BUYER'),(req,res)=>controller.requestSmartBetterOffer(req,res));
router.get('/procurement/requests/:id/negotiations',protect,authorizeStrict('BUYER'),(req,res)=>controller.listBuyerSmartNegotiations(req,res));
router.get('/procurement/supplier/negotiations',protect,authorizeStrict('SUPPLIER'),(req,res)=>controller.listSupplierSmartNegotiations(req,res));

// B6-G/H award preview: buyer explicitly selects quote version and physical SKU.
// No order, hold, ledger or checkout route is exposed before inventory/Safepay gate.
router.post('/procurement/requests/:id/award-preview',protect,authorizeStrict('BUYER'),(req,res)=>controller.previewSmartAward(req,res));

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
