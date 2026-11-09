// =============================================================================
// src/controllers/productSpecificationController.js
// MilJor Product Specification Controller
// Specification catalog management and multi-supplier comparison (Package E2)
// =============================================================================
const specRepo = require('../repositories/productSpecificationRepo');
const productRepo = require('../repositories/productRepo');
const catalogRepo = require('../repositories/catalogRepository');
const listingRepo = require('../repositories/supplierListingRepo');
const specService = require('../services/specificationService');
const unitService = require('../services/unitConversionService');

const ADMIN_CATALOG_ROLES = ['SUPER_ADMIN', 'OPERATIONS_ADMIN', 'ADMIN'];

class ProductSpecificationController {
  // 1. Get All Specifications with Filtering and Search
  async getAllSpecifications(req, res) {
    try {
      const {
        category,
        category_id,
        family_id,
        brand,
        variety,
        quality_grade,
        pack_size,
        pack_unit,
        search,
        product_id
      } = req.query;

      const specifications = await specRepo.findAll({
        category,
        category_id,
        family_id,
        brand,
        variety,
        quality_grade,
        pack_size,
        pack_unit,
        search,
        product_id
      });

      res.status(200).json({
        success: true,
        count: specifications.length,
        data: { specifications }
      });
    } catch (error) {
      console.error('Get Specifications Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 2. Get Single Specification by ID
  async getSpecificationById(req, res) {
    try {
      const { id } = req.params;
      const specification = await specRepo.findById(id);

      if (!specification) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Product specification not found' }
        });
      }

      res.status(200).json({
        success: true,
        data: { specification }
      });
    } catch (error) {
      console.error('Get Specification Detail Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 3. Create New Exact Specification (Package E2: Restricted to Catalog Admins;
  // Suppliers must submit moderated requests via POST /api/v1/catalog/requests)
  async createSpecification(req, res) {
    try {
      const userRole = req.user?.role;
      if (!ADMIN_CATALOG_ROLES.includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'DIRECT_CATALOG_CREATION_PROHIBITED',
            message: 'Suppliers cannot create public product specifications directly. Please submit a moderated variant request via POST /api/v1/catalog/requests.'
          }
        });
      }

      const {
        product_id,
        family_id,
        category_id,
        brand,
        variety,
        crop_year,
        processing_method,
        quality_grade,
        packaging_type,
        pack_size,
        pack_unit,
        purchasing_unit,
        storage_requirements,
        shelf_life_days,
        spec_attributes
      } = req.body;

      // 1. Verify base product exists
      const baseProduct = await productRepo.findById(product_id);
      if (!baseProduct) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: `Base product with ID ${product_id} not found` }
        });
      }

      const resolvedFamilyId = family_id || baseProduct.family_id || null;
      const resolvedCategoryId = category_id || baseProduct.category_id || null;
      let familyContext = null;
      if (resolvedFamilyId) {
        familyContext = await catalogRepo.findFamilyById(resolvedFamilyId);
      }

      // 2. Category & Family-specific validation
      const validation = specService.validateSpecificationInput(req.body, baseProduct.category, familyContext);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: { code: validation.code || 'VALIDATION_ERROR', message: validation.message }
        });
      }

      // 3. Compute deterministic hash for exact physical specification
      const specHash = specService.computeSpecHash({
        productId: product_id,
        brand,
        variety,
        cropYear: crop_year,
        processingMethod: processing_method,
        qualityGrade: quality_grade,
        packagingType: packaging_type,
        packSize: pack_size,
        packUnit: pack_unit,
        purchasingUnit: purchasing_unit || 'bag',
        specAttributes: spec_attributes
      });

      // 4. Check for existing identical specification
      const existing = await specRepo.findByHash(specHash);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'SPECIFICATION_ALREADY_EXISTS',
            message: 'An exact specification with these identical physical attributes already exists in the catalog',
            existing_spec_id: existing.id,
            spec_code: existing.spec_code
          }
        });
      }

      // 5. Build code and canonical title
      const specCode = specService.generateSpecCode(baseProduct.category, variety);
      const title = `${brand} ${variety} ${crop_year ? crop_year + ' ' : ''}${processing_method}, ${quality_grade}, ${pack_size}${pack_unit}`;

      // 6. Save specification with canonical category_id, family_id, and APPROVED status
      const specId = await specRepo.create({
        product_id,
        category_id: resolvedCategoryId,
        family_id: resolvedFamilyId,
        spec_code: specCode,
        title,
        brand: brand.trim(),
        variety: variety.trim(),
        crop_year: crop_year ? crop_year.trim() : null,
        processing_method: processing_method.trim(),
        quality_grade: quality_grade.trim(),
        packaging_type: packaging_type.trim(),
        pack_size: Number(pack_size),
        pack_unit: unitService.normalizeUnit(pack_unit),
        purchasing_unit: purchasing_unit || 'bag',
        storage_requirements: storage_requirements ? storage_requirements.trim() : null,
        shelf_life_days: shelf_life_days ? Number(shelf_life_days) : null,
        spec_attributes: spec_attributes || null,
        spec_hash: specHash,
        approval_status: 'APPROVED',
        created_by: req.user?.id || null,
        approved_by: req.user?.id || null,
        approved_at: new Date()
      });

      const newSpec = await specRepo.findById(specId);

      res.status(201).json({
        success: true,
        message: 'Exact product specification created successfully',
        data: { specification: newSpec }
      });
    } catch (error) {
      console.error('Create Specification Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 4. Buyer-Facing Multi-Supplier Comparison for an Exact Specification
  async compareSupplierListings(req, res) {
    try {
      const { id } = req.params;
      const { sort_by } = req.query;

      const specification = await specRepo.findById(id);
      if (!specification) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Product specification not found' }
        });
      }

      const listings = await listingRepo.compareListingsForSpec(id, sort_by);

      res.status(200).json({
        success: true,
        data: {
          specification,
          total_available_offers: listings.length,
          best_price: listings.length > 0 ? listings[0].pricing.base_price_per_pack : null,
          best_price_per_base_unit: listings.length > 0 ? listings[0].pricing.price_per_base_unit : null,
          offers: listings
        }
      });
    } catch (error) {
      console.error('Compare Supplier Listings Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }
}

module.exports = new ProductSpecificationController();
