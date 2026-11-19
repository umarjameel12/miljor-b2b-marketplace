// =============================================================================
// src/routes/v1/adminRoutes.js
// MilJor Administrative, Verification & Catalog Governance Routes
// Enforces:
//   - Authentication required across all endpoints
//   - Least privilege role authorization
// =============================================================================
const express = require('express');
const router = express.Router();
const adminController = require('../../controllers/adminController');
const catalogController = require('../../controllers/catalogController');
const subscriptionController = require('../../controllers/subscriptionController');
const {
  protect,
  authorizeVerification,
  authorizeOperations,
  authorize
} = require('../../middlewares/authGuard');

// All admin routes require authentication
router.use(protect);

// Authorized roles for Catalog Moderation & Governance (Package E2)
const authorizeCatalogAdmin = authorize('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'ADMIN');

// ---------------------------------------------------------------------------
// Verification Admin Routes
// ---------------------------------------------------------------------------
// List pending supplier applications
router.get(
  '/suppliers/pending',
  authorizeVerification,
  (req, res) => adminController.getPendingSuppliers(req, res)
);

// Immutable submission snapshots and prior review decisions; verification admins only.
router.get('/suppliers/:id/revisions',authorizeVerification,(req,res)=>adminController.getSupplierReviewHistory(req,res));

// Restricted evidence review (binary remains private; no buyer-facing URL).
const supplierEvidence=require('../../services/supplierVerificationDocumentService');
router.get('/suppliers/:id/documents',authorizeVerification,async(req,res)=>{
  try{return res.json({success:true,data:{documents:await supplierEvidence.versions(req.params.id)}});}
  catch(e){return res.status(e.statusCode||500).json({success:false,error:{
    code:e.statusCode?e.code:'EVIDENCE_UNAVAILABLE',message:e.statusCode?e.message:'Cannot inspect evidence'}});}
});
router.get('/suppliers/:id/documents/:docId/file',authorizeVerification,async(req,res)=>{
  try{
    const doc=await supplierEvidence.download(req.params.id,req.params.docId);
    res.set('Cache-Control','no-store');
    res.set('Content-Type',doc.mime);
    res.set('Content-Disposition','attachment; filename="review-evidence"');
    res.set('X-Content-Type-Options','nosniff');
    return res.send(doc.bytes);
  }catch(e){return res.status(e.statusCode||500).json({success:false,error:{
    code:e.statusCode?e.code:'EVIDENCE_UNAVAILABLE',message:e.statusCode?e.message:'Cannot retrieve evidence'}});}
});

// Approve or reject supplier verification
router.put(
  '/suppliers/:id/verify',
  authorizeVerification,
  (req, res) => adminController.verifySupplier(req, res)
);

// ---------------------------------------------------------------------------
// Catalog Governance & Moderation Routes (Package E2)
// ---------------------------------------------------------------------------
router.get(
  '/catalog/categories',
  authorizeCatalogAdmin,
  (req, res) => catalogController.adminGetCategories(req, res)
);

router.post(
  '/catalog/categories',
  authorizeCatalogAdmin,
  (req, res) => catalogController.adminCreateCategory(req, res)
);

router.put(
  '/catalog/categories/:id',
  authorizeCatalogAdmin,
  (req, res) => catalogController.adminUpdateCategory(req, res)
);

router.get(
  '/catalog/families',
  authorizeCatalogAdmin,
  (req, res) => catalogController.adminGetFamilies(req, res)
);

router.post(
  '/catalog/families',
  authorizeCatalogAdmin,
  (req, res) => catalogController.adminCreateFamily(req, res)
);

router.put(
  '/catalog/families/:id',
  authorizeCatalogAdmin,
  (req, res) => catalogController.adminUpdateFamily(req, res)
);

router.post(
  '/catalog/variants',
  authorizeCatalogAdmin,
  (req, res) => catalogController.adminCreateVariant(req, res)
);

router.get(
  '/catalog/requests',
  authorizeCatalogAdmin,
  (req, res) => catalogController.adminGetCatalogRequests(req, res)
);

router.get(
  '/catalog/requests/:id',
  authorizeCatalogAdmin,
  (req, res) => catalogController.adminGetCatalogRequestById(req, res)
);

router.post(
  '/catalog/requests/:id/review',
  authorizeCatalogAdmin,
  (req, res) => catalogController.adminReviewCatalogRequest(req, res)
);

router.post(
  '/catalog/requests/:id/approve',
  authorizeCatalogAdmin,
  (req, res) => catalogController.adminApproveCatalogRequest(req, res)
);

router.post(
  '/catalog/requests/:id/reject',
  authorizeCatalogAdmin,
  (req, res) => catalogController.adminRejectCatalogRequest(req, res)
);

// ---------------------------------------------------------------------------
// Operations Admin Routes
// ---------------------------------------------------------------------------
// Suspend a user account (fraud or policy violation)
router.put(
  '/users/:id/suspend',
  authorizeOperations,
  (req, res) => adminController.suspendUser(req, res)
);

// ---------------------------------------------------------------------------
// Super Admin Only Routes
// ---------------------------------------------------------------------------
// Reactivate a suspended account
router.put(
  '/users/:id/reactivate',
  authorize('SUPER_ADMIN'),
  (req, res) => adminController.reactivateUser(req, res)
);

// ---------------------------------------------------------------------------
// Subscription Plans Administration (Package E3)
// ---------------------------------------------------------------------------
router.get(
  '/subscriptions/plans',
  authorizeOperations,
  (req, res) => subscriptionController.getPlans(req, res)
);

router.put(
  '/subscriptions/plans/:planCode',
  authorize('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'ADMIN'),
  (req, res) => subscriptionController.adminUpdatePlan(req, res)
);

module.exports = router;
