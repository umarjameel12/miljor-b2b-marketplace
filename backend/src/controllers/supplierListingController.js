// =============================================================================
// src/controllers/supplierListingController.js
// MilJor Supplier Listing Controller
// Handles decoupled supplier offers, pricing, ownership checks, and status
// =============================================================================
const listingRepo = require('../repositories/supplierListingRepo');
const specRepo = require('../repositories/productSpecificationRepo');
const catalogRepo = require('../repositories/catalogRepository');
const unitService = require('../services/unitConversionService');
const db = require('../config/db');

class SupplierListingController {
  // 1. Create Supplier Listing (Verified Suppliers Only — supports supplier_sku_id or product_spec_id)
  async createListing(req, res) {
    try {
      if (req.user.role !== 'SUPPLIER') {
        return res.status(403).json({ success: false, error: { code: 'SUPPLIER_ONLY', message: 'Only suppliers can create commercial listings.' } });
      }
      const supplierId = req.user.id;
      const {
        supplier_sku_id,
        product_spec_id,
        available_stock,
        base_unit_price,
        currency,
        supplier_min_qty,
        buyer_min_qty,
        delivery_zones,
        delivery_fee_policy,
        fulfilment_lead_time_days,
        notes
      } = req.body;

      let resolvedSpecId = product_spec_id ? Number(product_spec_id) : null;
      let resolvedSupplierProductId = null;
      let resolvedSupplierSkuId = supplier_sku_id ? Number(supplier_sku_id) : null;

      // 1A. If supplier_sku_id is provided, verify ownership and PUBLISHED state
      if (resolvedSupplierSkuId) {
        const sku = await catalogRepo.findSupplierSkuById(resolvedSupplierSkuId);
        if (!sku) {
          return res.status(404).json({
            success: false,
            error: { code: 'SKU_NOT_FOUND', message: 'Supplier physical SKU not found.' }
          });
        }
        if (Number(sku.supplier_id) !== Number(supplierId)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You can only create commercial offers against your own physical SKUs.' }
          });
        }
        if (sku.status !== 'PUBLISHED') {
          return res.status(403).json({
            success: false,
            error: {
              code: 'SKU_NOT_PUBLISHED',
              message: `Physical SKU is in '${sku.status}' status. Publish the SKU before creating a commercial offer.`
            }
          });
        }
        resolvedSpecId = sku.linked_spec_id;
        resolvedSupplierProductId = sku.supplier_product_id;
      }

      // 1B. Validate spec existence
      if (!resolvedSpecId) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Either supplier_sku_id or product_spec_id is required' }
        });
      }

      const spec = await specRepo.findById(resolvedSpecId);
      if (!spec || !spec.is_active) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Active product specification not found' }
        });
      }

      // B1: LEGACY_GLOBAL specs remain immutable history, never a source for new offers.
      if (spec.lifecycle_status !== 'PUBLISHED' || !spec.supplier_sku_id ||
          !spec.supplier_product_id || Number(spec.supplier_id) !== Number(supplierId)) {
        return res.status(409).json({success:false,error:{
          code:'SUPPLIER_OWNED_SKU_REQUIRED',
          message:'New offers require your own published physical SKU; legacy global specifications cannot be reused.'
        }});
      }
      const actualSku = await catalogRepo.findSupplierSkuById(Number(spec.supplier_sku_id));
      if (!actualSku || Number(actualSku.supplier_id) !== Number(supplierId) ||
          actualSku.status !== 'PUBLISHED' || actualSku.product_status !== 'PUBLISHED' ||
          !actualSku.family_is_active || !actualSku.category_is_active ||
          actualSku.family_approval_status !== 'APPROVED' ||
          actualSku.category_approval_status !== 'APPROVED' ||
          Number(actualSku.supplier_product_id) !== Number(spec.supplier_product_id)) {
        return res.status(409).json({success:false,error:{
          code:'INVALID_SUPPLIER_SKU_BRIDGE',message:'Specification must reference a published supplier-owned SKU.'
        }});
      }

      // If the specification belongs to a specific supplier's SKU, enforce ownership and PUBLISHED lifecycle
      if (spec.supplier_id && Number(spec.supplier_id) !== Number(supplierId)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You cannot create a commercial offer on another supplier\'s owned SKU.'
          }
        });
      }
      if (spec.lifecycle_status && !['PUBLISHED', 'LEGACY_GLOBAL'].includes(spec.lifecycle_status)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'SKU_NOT_PUBLISHED',
            message: `Physical SKU is in '${spec.lifecycle_status}' status and cannot accept commercial offers.`
          }
        });
      }

      if (!resolvedSupplierProductId && spec.supplier_product_id) {
        resolvedSupplierProductId = spec.supplier_product_id;
      }
      if (!resolvedSupplierSkuId && spec.supplier_sku_id) {
        resolvedSupplierSkuId = spec.supplier_sku_id;
      }

      // Package E2: Enforce that variant, parent family, and parent category are APPROVED and active
      if (spec.approval_status && spec.approval_status !== 'APPROVED') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'VARIANT_NOT_APPROVED',
            message: 'Commercial offers can only be published against APPROVED physical variants.'
          }
        });
      }

      if (spec.family_is_active === 0 || spec.family_approval_status === 'ARCHIVED') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FAMILY_INACTIVE',
            message: 'Cannot publish offer because the parent product family is archived or inactive.'
          }
        });
      }

      if (spec.category_is_active === 0 || spec.category_approval_status === 'INACTIVE') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'CATEGORY_INACTIVE',
            message: 'Cannot publish offer because the parent catalog category is inactive.'
          }
        });
      }

      // B1: Every ACTIVE listing must resolve a canonical family. Without
      // this identity, a legacy specification could bypass family quotas.
      const canonicalFamilyId = Number(spec.family_id || spec.canonical_family_id);
      if (!Number.isSafeInteger(canonicalFamilyId) || canonicalFamilyId <= 0 ||
          !spec.family_name || !spec.category_name) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'CANONICAL_FAMILY_REQUIRED',
            message: 'This physical SKU is not mapped to an approved canonical family and category.'
          }
        });
      }

      // B3: Strict MySQL-compatible decimal inputs, no IEEE rounding or NaN.
      const exact = require('../services/exactDecimal');
      let stock, suppMin, buyerMin, price;
      try {
        const parseQty = (val, defaultValue, positive, maxIntegerDigits) => {
          const out = exact.toCanonical(val === undefined ? defaultValue : val, 2);
          const digits = out.replace('-', '').split('.')[0].length;
          if (digits > maxIntegerDigits || !exact.exactDecimalGte(out, positive ? '0.01' : '0.00', 2)) throw new Error('Out of range');
          return out;
        };
        price = parseQty(base_unit_price, undefined, true, 10);
        stock = parseQty(available_stock, '0', false, 10);
        suppMin = parseQty(supplier_min_qty, '1', true, 8);
        buyerMin = parseQty(buyer_min_qty, '1', true, 8);
      } catch (_) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_COMMERCIAL_AMOUNT', message: 'Price, stock and MOQ must be finite decimals with no more than 2 fractional digits and within supported ranges.' }
        });
      }
      if (exact.exactDecimalGte(stock, '0.01', 2) && !exact.exactDecimalGte(stock, buyerMin, 2)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_BUYER_MIN_QTY', message: 'Buyer minimum cannot exceed positive available stock.' }
        });
      }

      // 3. Check for duplicate active listing for this supplier & spec
      const existing = await listingRepo.findBySupplierAndSpec(supplierId, resolvedSpecId);
      if (existing) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'LISTING_ALREADY_EXISTS',
            message: 'You already have a listing for this exact specification. Please update the existing listing instead.',
            listing_id: existing.id
          }
        });
      }

      // 4. Generate listing code & compute base unit pricing
      const listingCode = `LST-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const packSize = String(spec.pack_size);
      if (!Number.isFinite(Number(packSize)) || Number(packSize) <= 0) {
        return res.status(422).json({ success: false, error: { code: 'INVALID_PACK_SIZE', message: 'Product pack size must be positive.' } });
      }
      // Computed inside the transactional connection below using MySQL decimal arithmetic.
      const pricingUnit = spec.purchasing_unit || 'pack';

      // B1: Keep the family-cap row lock until the ACTIVE listing exists.
      // This closes the gap between entitlement validation and listing insertion.
      // There is no separate SKUs/listings count cap inside an already-active family.
      const subscriptionEntitlementService = require('../services/subscriptionEntitlementService');
      const conn = await db.getConnection();
      let listingId;
      try {
        await conn.beginTransaction();
        await subscriptionEntitlementService.assertCanPublishInFamily(
          supplierId, canonicalFamilyId, conn
        );
        // Recheck duplicate after obtaining the supplier-profile lock.
        // The earlier lookup is only a fast-path optimization.
        const duplicateUnderLock = await listingRepo.findBySupplierAndSpec(
          supplierId, resolvedSpecId, conn
        );
        if (duplicateUnderLock) {
          const err = new Error('A commercial listing already exists for this supplier and physical SKU.');
          err.statusCode = 409;
          err.code = 'LISTING_ALREADY_EXISTS';
          throw err;
        }
        const [unitRows] = await conn.query(
          'SELECT CAST(ROUND(CAST(? AS DECIMAL(12,2)) / CAST(? AS DECIMAL(12,4)), 4) AS CHAR) AS unit_price',
          [price, packSize]
        );
        listingId = await listingRepo.create({
        listing_code: listingCode,
        supplier_id: supplierId,
        product_spec_id: resolvedSpecId,
        supplier_product_id: resolvedSupplierProductId,
        supplier_sku_id: resolvedSupplierSkuId,
        available_stock: stock,
        base_unit_price: price,
        pricing_unit: pricingUnit,
        price_per_base_unit: unitRows[0].unit_price,
        currency: currency || 'PKR',
        supplier_min_qty: suppMin,
        buyer_min_qty: buyerMin,
        delivery_zones: delivery_zones || ['All Lahore'],
        delivery_fee_policy: delivery_fee_policy || 'INCLUDED_IN_PRICE',
        fulfilment_lead_time_days: Number(fulfilment_lead_time_days || 2),
        status: 'ACTIVE',
        notes: notes || null
        }, conn);
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        return res.status(err.statusCode || 500).json({
          success: false,
          error: { code: err.code || 'LISTING_CREATION_FAILED', message: err.message }
        });
      } finally {
        conn.release();
      }

      const newListing = await listingRepo.findById(listingId);

      res.status(201).json({
        success: true,
        message: 'Supplier listing created successfully',
        data: { listing: newListing }
      });
    } catch (error) {
      console.error('Create Listing Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 2. Get All Public Active Listings (Catalog / Buyer View)
  async getAllListings(req, res) {
    try {
      const { category, category_id, family_id, product_spec_id, supplier_id, search } = req.query;
      const listings = await listingRepo.findAll({
        category,
        category_id,
        family_id,
        product_spec_id,
        supplier_id,
        search,
        status: 'ACTIVE'
      });

      res.status(200).json({
        success: true,
        count: listings.length,
        data: { listings }
      });
    } catch (error) {
      console.error('Get All Listings Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 3. Get Authenticated Supplier's Own Listings (with E3 preparation family usage summary)
  async getMyListings(req, res) {
    try {
      const supplierId = req.user.id;
      const [listings, usageSummary] = await Promise.all([
        listingRepo.findAll({
          supplier_id: supplierId,
          activeOnly: false
        }),
        listingRepo.getSupplierCatalogUsageSummary(supplierId)
      ]);

      res.status(200).json({
        success: true,
        count: listings.length,
        data: {
          listings,
          catalog_usage: usageSummary
        }
      });
    } catch (error) {
      console.error('Get My Listings Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // 4. Get Single Listing Details
  async getListingById(req, res) {
    try {
      const { id } = req.params;
      const listing = await listingRepo.findById(id);

      if (!listing) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Supplier listing not found' }
        });
      }

      res.status(200).json({
        success: true,
        data: { listing }
      });
    } catch (error) {
      console.error('Get Listing Detail Error:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // B3: both update endpoints share one transactional domain mutation service.
  async updateListing(req, res) {
    try {
      const updated = await require('../services/supplierListingMutationService')
        .mutate(Number(req.params.id), req.user, req.body || {});
      return res.status(200).json({ success: true, message: 'Listing updated successfully', data: { listing: updated } });
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        success: false,
        error: { code: err.code || 'LISTING_UPDATE_FAILED', message: err.statusCode ? err.message : 'Failed to update listing' }
      });
    }
  }

  async updateListingStatus(req, res) {
    try {
      const updated = await require('../services/supplierListingMutationService')
        .mutate(Number(req.params.id), req.user, req.body || {}, { statusOnly: true });
      return res.status(200).json({
        success: true, message: `Listing status updated to ${updated.status}`,
        data: { id: updated.id, status: updated.status }
      });
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        success: false,
        error: { code: err.code || 'LISTING_STATUS_UPDATE_FAILED', message: err.statusCode ? err.message : 'Failed to update listing status' }
      });
    }
  }

  // Price history is supplier-private by default. No cross-supplier leakage.
  async getListingPriceHistory(req, res) {
    try {
      const listing = await listingRepo.findById(Number(req.params.id));
      if (!listing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Supplier listing not found' } });
      if (Number(listing.supplier_id) !== Number(req.user.id) && req.user.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Price history belongs to the supplier' } });
      }
      const history = await listingRepo.getPriceHistory(listing.id);
      return res.status(200).json({ success: true, data: { listing_id: listing.id, history } });
    } catch (err) {
      return res.status(500).json({ success: false, error: { code: 'PRICE_HISTORY_FAILED', message: 'Could not retrieve listing price history' } });
    }
  }
}

module.exports = new SupplierListingController();
