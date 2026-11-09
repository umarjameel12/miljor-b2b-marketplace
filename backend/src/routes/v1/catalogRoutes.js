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

// ---------------------------------------------------------------------------
// 3. Supplier-Owned Products & Physical SKUs (Levels 3 & 4 — Authenticated Suppliers)
// ---------------------------------------------------------------------------
router.post(
  '/supplier-products',
  protect,
  authorize('SUPPLIER'),
  (req, res) => catalogController.createSupplierProduct(req, res)
);

router.get(
  '/supplier-products/me',
  protect,
  authorize('SUPPLIER'),
  (req, res) => catalogController.getMySupplierProducts(req, res)
);

router.get(
  '/supplier-products/:id',
  protect,
  authorize('SUPPLIER', 'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'ADMIN'),
  (req, res) => catalogController.getSupplierProductById(req, res)
);

router.put(
  '/supplier-products/:id',
  protect,
  authorize('SUPPLIER'),
  (req, res) => catalogController.updateSupplierProduct(req, res)
);

router.post(
  '/supplier-products/:id/publish',
  protect,
  authorize('SUPPLIER'),
  (req, res) => catalogController.publishSupplierProduct(req, res)
);

router.post(
  '/supplier-products/:id/archive',
  protect,
  authorize('SUPPLIER'),
  (req, res) => catalogController.archiveSupplierProduct(req, res)
);

router.post(
  '/supplier-skus',
  protect,
  authorize('SUPPLIER'),
  (req, res) => catalogController.createSupplierSku(req, res)
);

router.get(
  '/supplier-skus/me',
  protect,
  authorize('SUPPLIER'),
  (req, res) => catalogController.getMySupplierSkus(req, res)
);

router.get(
  '/supplier-skus/:id',
  protect,
  authorize('SUPPLIER', 'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'ADMIN'),
  (req, res) => catalogController.getSupplierSkuById(req, res)
);

router.put(
  '/supplier-skus/:id',
  protect,
  authorize('SUPPLIER'),
  (req, res) => catalogController.updateSupplierSku(req, res)
);

router.post(
  '/supplier-skus/:id/publish',
  protect,
  authorize('SUPPLIER'),
  (req, res) => catalogController.publishSupplierSku(req, res)
);

router.post(
  '/supplier-skus/:id/archive',
  protect,
  authorize('SUPPLIER'),
  (req, res) => catalogController.archiveSupplierSku(req, res)
);

module.exports = router;
