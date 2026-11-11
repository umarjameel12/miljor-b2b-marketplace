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

// B6-I — Private collective business invitations and explicit join consent.
router.post('/procurement/requests/:id/collective',protect,authorizeStrict('BUYER'),(req,res)=>controller.createCollectiveGroup(req,res));
router.post('/procurement/collectives/:groupId/invitations',protect,authorizeStrict('BUYER'),(req,res)=>controller.inviteCollectiveBuyer(req,res));
router.post('/procurement/collectives/:groupId/join',protect,authorizeStrict('BUYER'),(req,res)=>controller.joinCollectiveGroup(req,res));
router.get('/procurement/collectives/my-invitations',protect,authorizeStrict('BUYER'),(req,res)=>controller.myCollectiveInvites(req,res));

// B6-J: verified supplier quotation on qualified collective demand.
router.post('/procurement/collectives/:groupId/open-bidding',protect,authorizeStrict('BUYER'),(req,res)=>controller.openCollectiveBidding(req,res));
router.post('/procurement/collectives/:groupId/supplier-invitations',protect,authorizeStrict('BUYER'),(req,res)=>controller.inviteCollectiveSupplier(req,res));
router.get('/procurement/supplier/collectives/invitations',protect,authorizeStrict('SUPPLIER'),(req,res)=>controller.collectiveSupplierInbox(req,res));
router.post('/procurement/supplier/collectives/:groupId/bids',protect,authorizeStrict('SUPPLIER'),(req,res)=>controller.submitCollectiveBid(req,res));
router.get('/procurement/collectives/:groupId/bids',protect,authorizeStrict('BUYER'),(req,res)=>controller.listCollectiveBids(req,res));
router.post('/procurement/collectives/:groupId/qualify',protect,authorizeStrict('BUYER'),(req,res)=>controller.qualifyCollectiveGroup(req,res));
// B6-K: individual buyer consent only, not an order or checkout.
router.get('/procurement/collectives/:groupId/bids/:bidId/approval-preview',protect,authorizeStrict('BUYER'),(req,res)=>controller.previewCollectiveApproval(req,res));
router.post('/procurement/collectives/:groupId/bids/:bidId/consent',protect,authorizeStrict('BUYER'),(req,res)=>controller.consentCollectiveApproval(req,res));

// B6-L/M — buyer-owned recurring template and cycle controls.
// No automatic checkout/payment or buyer impersonation.
router.post('/procurement/requests/:id/recurring',protect,authorizeStrict('BUYER'),(req,res)=>controller.createSmartRecurring(req,res));
router.get('/procurement/recurring',protect,authorizeStrict('BUYER'),(req,res)=>controller.listSmartRecurring(req,res));
router.get('/procurement/recurring/:contractId/upcoming',protect,authorizeStrict('BUYER'),(req,res)=>controller.smartRecurringUpcoming(req,res));
router.post('/procurement/recurring/:contractId/:action',protect,authorizeStrict('BUYER'),(req,res,next)=>{
  if(!['activate','pause','resume','cancel'].includes(req.params.action)) return next();
  return controller.smartRecurringAction(req,res);
});
router.post('/procurement/recurring/:contractId/cycles/:cycleId/skip',protect,authorizeStrict('BUYER'),(req,res)=>controller.smartRecurringSkip(req,res));

// B6-M: inspect and prepare recurring cycle drafts without payment authority.
router.post('/procurement/recurring/:contractId/cycles/schedule',protect,authorizeStrict('BUYER'),(req,res)=>controller.scheduleRecurringCycles(req,res));
router.get('/procurement/recurring/:contractId/cycles',protect,authorizeStrict('BUYER'),(req,res)=>controller.listRecurringCycles(req,res));
router.post('/procurement/recurring/:contractId/cycles/:cycleId/prepare',protect,authorizeStrict('BUYER'),(req,res)=>controller.prepareRecurringCycle(req,res));

// B6-G/H — Fee-inclusive preview and server-gated real order acceptance.
router.post('/procurement/requests/:id/checkout-preview',protect,authorizeStrict('BUYER'),(req,res)=>controller.previewSmartPayable(req,res));
router.post('/procurement/requests/:id/award',protect,authorizeStrict('BUYER'),(req,res)=>controller.acceptSmartAward(req,res));
router.get('/procurement/awards/:awardId',protect,authorizeStrict('BUYER'),(req,res)=>controller.getSmartAward(req,res));

// B6-N — buyer-owned recurring cohorts; existing I/J/K controls remain authoritative.
router.post('/procurement/recurring/:contractId/cohorts',protect,authorizeStrict('BUYER'),(req,res)=>controller.createRecurringCohort(req,res));
router.get('/procurement/recurring-cohorts',protect,authorizeStrict('BUYER'),(req,res)=>controller.listRecurringCohorts(req,res));
router.post('/procurement/recurring-cohorts/:cohortId/invitations',protect,authorizeStrict('BUYER'),(req,res)=>controller.inviteRecurringCohortBuyer(req,res));
router.post('/procurement/recurring-cohorts/:cohortId/consent',protect,authorizeStrict('BUYER'),(req,res)=>controller.consentRecurringCohort(req,res));
router.post('/procurement/recurring-cohorts/:cohortId/activate',protect,authorizeStrict('BUYER'),(req,res)=>controller.activateRecurringCohort(req,res));
router.post('/procurement/recurring-cohorts/:cohortId/cycles/prepare',protect,authorizeStrict('BUYER'),(req,res)=>controller.prepareRecurringCohortCycle(req,res));
router.get('/procurement/recurring-cohorts/:cohortId/cycles/:cycleId',protect,authorizeStrict('BUYER'),(req,res)=>controller.recurringCohortCycle(req,res));

// B6-O — buyer's paid order delivery authorization; supplier route planning only.
router.post('/procurement/orders/:orderId/delivery-choice',protect,authorizeStrict('BUYER'),(req,res)=>controller.acceptDeliveryChoice(req,res));
router.get('/procurement/orders/:orderId/delivery',protect,authorizeStrict('BUYER'),(req,res)=>controller.buyerProcurementDelivery(req,res));
router.post('/procurement/supplier/delivery-runs',protect,authorizeStrict('SUPPLIER'),(req,res)=>controller.createSupplierDeliveryRun(req,res));
router.get('/procurement/supplier/delivery-runs',protect,authorizeStrict('SUPPLIER'),(req,res)=>controller.listSupplierDeliveryRuns(req,res));

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
