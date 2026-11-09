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

module.exports = router;
