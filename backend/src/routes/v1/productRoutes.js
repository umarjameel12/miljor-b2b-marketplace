const express = require('express');
const router = express.Router();
const productController = require('../../controllers/productController');
const { protect } = require('../../middlewares/authGuard');

// Public Routes (Buyers & Visitors can view catalog)
router.get('/', productController.getAllProducts);
router.get('/:id', productController.getProductById);

// Protected Routes (Package E2: Direct public catalog creation is restricted to Catalog Admins;
// Suppliers must submit moderated catalog requests via POST /api/v1/catalog/requests)
router.post(
  '/',
  protect,
  productController.createProduct
);

module.exports = router;
