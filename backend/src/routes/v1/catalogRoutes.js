// =============================================================================
// src/routes/v1/catalogRoutes.js
// MilJor Canonical Catalog & Supplier Request Routes (Package E2)
// Mounted at: /api/v1/catalog
// =============================================================================
const express = require('express');
const router = express.Router();
const catalogController = require('../../controllers/catalogController');
const { protect, authorize } = require('../../middlewares/authGuard');

// ---------------------------------------------------------------------------
// 1. Public / Shared Canonical Catalog Discovery
// ---------------------------------------------------------------------------
router.get('/categories', (req, res) => catalogController.getCategories(req, res));
router.get('/categories/:id/families', (req, res) => catalogController.getCategoryFamilies(req, res));
router.get('/families', (req, res) => catalogController.getFamilies(req, res));
router.get('/families/:id', (req, res) => catalogController.getFamilyById(req, res));
router.get('/families/:id/variants', (req, res) => catalogController.getFamilyVariants(req, res));
router.get('/variants/:id', (req, res) => catalogController.getVariantById(req, res));

// ---------------------------------------------------------------------------
// 2. Supplier Catalog Request Workflow (Authenticated Suppliers)
// ---------------------------------------------------------------------------
router.post(
  '/requests',
  protect,
  authorize('SUPPLIER'),
  (req, res) => catalogController.createCatalogRequest(req, res)
);

router.get(
  '/requests/me',
  protect,
  authorize('SUPPLIER'),
  (req, res) => catalogController.getMyCatalogRequests(req, res)
);

router.get(
  '/requests/:id',
  protect,
  authorize('SUPPLIER', 'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'ADMIN'),
  (req, res) => catalogController.getCatalogRequestById(req, res)
);

router.put(
  '/requests/:id',
  protect,
  authorize('SUPPLIER'),
  (req, res) => catalogController.updateCatalogRequest(req, res)
);

module.exports = router;
