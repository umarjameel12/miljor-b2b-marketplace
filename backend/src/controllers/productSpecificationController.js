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
    // Historical physical specifications remain referenced by orders/pools.
    // No new centrally authored physical variants may bypass supplier-owned SKU rules.
    return res.status(409).json({
      success: false,
      error: { code: 'SUPPLIER_OWNED_VARIANTS',
        message: 'Direct physical specification creation is retired; create a supplier-owned SKU under an approved family.' }
    });
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
