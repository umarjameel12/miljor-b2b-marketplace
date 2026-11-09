const productRepo = require('../repositories/productRepo');
const catalogRepo = require('../repositories/catalogRepository');
const specService = require('../services/specificationService');

const ADMIN_CATALOG_ROLES = ['SUPER_ADMIN', 'OPERATIONS_ADMIN', 'ADMIN'];

class ProductController {
  // 1. Create Product Spec (Package E2: Restricted to Catalog Admins; Suppliers must use /api/v1/catalog/requests)
  async createProduct(req, res) {
    try {
      const userRole = req.user?.role;
      if (!ADMIN_CATALOG_ROLES.includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'DIRECT_CATALOG_CREATION_PROHIBITED',
            message: 'Suppliers cannot create public catalog products directly. Please submit a catalog family or variant request via POST /api/v1/catalog/requests.'
          }
        });
      }

      const {
        title,
        category,
        category_id,
        family_id,
        brand,
        variety,
        processing_type,
        grade,
        pack_size,
        unit
      } = req.body;

      if (!title || !category || !brand || !variety || !processing_type || !grade || !pack_size) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'All product specification fields (title, category, brand, variety, processing_type, grade, pack_size) are required'
          }
        });
      }

      const packCheck = specService.validatePackSize(pack_size);
      if (!packCheck.valid) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: packCheck.message }
        });
      }

      let resolvedCategoryId = category_id || null;
      let resolvedFamilyId = family_id || null;

      if (resolvedFamilyId) {
        const fam = await catalogRepo.findFamilyById(Number(resolvedFamilyId));
        if (fam) {
          resolvedCategoryId = fam.category_id;
        }
      }

      const productId = await productRepo.create({
        title: specService.normalizeText(title),
        category: specService.normalizeText(category),
        category_id: resolvedCategoryId,
        family_id: resolvedFamilyId,
        canonical_slug: specService.slugify(title),
        brand: specService.normalizeText(brand),
        variety: specService.normalizeText(variety),
        processing_type: specService.normalizeText(processing_type),
        grade: specService.normalizeText(grade),
        pack_size: packCheck.value,
        unit: specService.normalizeUnit(unit || 'kg') || 'kg',
        approval_status: 'APPROVED',
        mapping_status: 'MAPPED_CANONICAL'
      });

      const product = await productRepo.findById(productId);

      res.status(201).json({
        success: true,
        message: 'Product specification created successfully',
        data: { product }
      });
    } catch (error) {
      console.error('Create Product Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
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
