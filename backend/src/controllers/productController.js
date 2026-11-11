const productRepo = require('../repositories/productRepo');
const catalogRepo = require('../repositories/catalogRepository');
const specService = require('../services/specificationService');

const ADMIN_CATALOG_ROLES = ['SUPER_ADMIN', 'OPERATIONS_ADMIN', 'ADMIN'];

class ProductController {
  // 1. Create Product Spec (Package E2: Restricted to Catalog Admins; Suppliers must use /api/v1/catalog/requests)
  async createProduct(req, res) {
    // Historic products are FK anchors, NOT new public products that admins can author.
    // Categories and families remain admin-owned; physical products/SKUs are supplier-owned.
    return res.status(409).json({
      success: false,
      error: { code: 'SUPPLIER_OWNED_PRODUCTS',
        message: 'Direct physical product creation is retired. Manage canonical families under /catalog, or create a supplier-owned product/SKU.' }
    });
  }

  // 2. Get All Products (Catalog View with Search & Filters)
  async getAllProducts(req, res) {
    try {
      const { category, category_id, family_id, brand, search } = req.query;
      const products = await productRepo.findAll({ category, category_id, family_id, brand, search });

      res.status(200).json({
        success: true,
        count: products.length,
        data: { products }
      });
    } catch (error) {
      console.error('Get Products Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 3. Get Single Product Details
  async getProductById(req, res) {
    try {
      const { id } = req.params;
      const product = await productRepo.findById(id);

      if (!product) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Product not found' }
        });
      }

      res.status(200).json({
        success: true,
        data: { product }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }
}

module.exports = new ProductController();
