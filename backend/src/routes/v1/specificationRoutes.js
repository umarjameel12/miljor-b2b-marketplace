// =============================================================================
// src/routes/v1/specificationRoutes.js
// MilJor Product Specification & Exact-Spec Comparison API Routes
// =============================================================================
const express = require('express');
const router = express.Router();
const specController = require('../../controllers/productSpecificationController');
const { protect } = require('../../middlewares/authGuard');

// Public Routes (Buyers & Visitors)
router.get('/', specController.getAllSpecifications);
router.get('/:id', specController.getSpecificationById);
router.get('/:id/compare', specController.compareSupplierListings);

// Protected Routes (Package E2: Direct specification creation is restricted to Catalog Admins;
// Suppliers must submit moderated requests via POST /api/v1/catalog/requests)
router.post(
  '/',
  protect,
  specController.createSpecification
);

module.exports = router;
