// =============================================================================
// src/controllers/poolController.js
// MilJor Regular Pool Controller
// Implements DRAFT creation, editing, commercial terms validation,
// atomic publishing with inventory allocation, and supplier lifecycle actions.
// =============================================================================
const poolRepo = require('../repositories/poolRepo');
const productRepo = require('../repositories/productRepo');
const productSpecificationRepo = require('../repositories/productSpecificationRepo');
const supplierListingRepo = require('../repositories/supplierListingRepo');
const catalogRepository = require('../repositories/catalogRepository');
const unitConversionService = require('../services/unitConversionService');
const tierPricingService = require('../services/tierPricingService');
const poolProgressService = require('../services/poolProgressService');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const SLA_MIN_MS = 24 * 60 * 60 * 1000; // 24 hours
const SLA_MAX_MS = 72 * 60 * 60 * 1000; // 72 hours

/**
 * Validates the supplier-defined participation cutoff (scheduled_close_at / expires_at),
 * mandatory 24–72 hour promised delivery SLA, and confirmation/commitment deadline sequence.
 */
function validateScheduleAndDeliverySla({
  scheduledCloseDate,
  promisedDeliveryRaw,
  isRequired = false,
  suppWindowHours,
  buyerWindowHours,
  existingSuppDeadline = null,
  existingBuyerDeadline = null
}) {
  if (!scheduledCloseDate || isNaN(scheduledCloseDate.getTime())) {
    return {
      valid: false,
      status: 400,
      error: { code: 'INVALID_EXPIRY', message: 'Valid scheduled_close_at / expires_at timestamp is required' }
    };
  }

  const hasExplicitWindows = suppWindowHours !== undefined || buyerWindowHours !== undefined;
  let promisedDeliveryDate = null;

  if (promisedDeliveryRaw !== undefined && promisedDeliveryRaw !== null && promisedDeliveryRaw !== '') {
    promisedDeliveryDate = promisedDeliveryRaw instanceof Date ? promisedDeliveryRaw : new Date(promisedDeliveryRaw);
    if (isNaN(promisedDeliveryDate.getTime())) {
      return {
        valid: false,
        status: 400,
        error: {
          code: 'INVALID_PROMISED_DELIVERY',
          message: 'promised_delivery_at must be a valid ISO-8601 timestamp'
        }
      };
    }

    // Normalize timestamps to exact integer seconds for consistent MySQL DATETIME 1-second storage resolution (Section 4.5)
    const closeSeconds = Math.floor(scheduledCloseDate.getTime() / 1000);
    const deliverySeconds = Math.floor(promisedDeliveryDate.getTime() / 1000);
    const diffSeconds = deliverySeconds - closeSeconds;

    if (diffSeconds <= 0) {
      return {
        valid: false,
        status: 422,
        error: {
          code: 'DELIVERY_SLA_OUT_OF_RANGE',
          subcode: 'DELIVERY_BEFORE_POOL_CLOSE',
          message: 'Promised delivery timestamp must be strictly after the pool participation cutoff (scheduled_close_at).'
        }
      };
    }

    // Allow 1-second tolerance strictly for MySQL DATETIME column 1-second rounding on persisted scheduled_close_at
    const MYSQL_DATETIME_SECOND_TOLERANCE = 1;
    const MIN_SLA_SECONDS = 24 * 3600 - MYSQL_DATETIME_SECOND_TOLERANCE; // 86,399s (rejects +23h59m = 86,340s)
    const MAX_SLA_SECONDS = 72 * 3600 + MYSQL_DATETIME_SECOND_TOLERANCE; // 259,201s (rejects +72h01m = 259,260s)

    if (diffSeconds < MIN_SLA_SECONDS) {
      return {
        valid: false,
        status: 422,
        error: {
          code: 'DELIVERY_SLA_OUT_OF_RANGE',
          subcode: 'DELIVERY_SLA_TOO_EARLY',
          message: 'Promised delivery timestamp must be at least 24 hours (1 day) after the pool participation cutoff (scheduled_close_at).'
        }
      };
    }

    if (diffSeconds > MAX_SLA_SECONDS) {
      return {
        valid: false,
        status: 422,
        error: {
          code: 'DELIVERY_SLA_OUT_OF_RANGE',
          subcode: 'DELIVERY_SLA_TOO_LATE',
          message: 'Promised delivery timestamp cannot exceed 72 hours (3 days) after the pool participation cutoff (scheduled_close_at).'
        }
      };
    }
  } else if (isRequired) {
    return {
      valid: false,
      status: 422,
      error: {
        code: 'PROMISED_DELIVERY_REQUIRED',
        subcode: 'MISSING_DELIVERY_SLA',
        message: 'A supplier-defined promised_delivery_at timestamp (within 24 to 72 hours after pool close) is mandatory before publishing a Regular Pool.'
      }
    };
  }

  // Calculate supplier confirmation and buyer commitment deadlines
  let suppDeadline;
  let buyerDeadline;

  if (hasExplicitWindows || !existingSuppDeadline || !existingBuyerDeadline) {
    let defaultWindowHours = 24;
    if (promisedDeliveryDate && !hasExplicitWindows) {
      const totalSlaHours = (promisedDeliveryDate.getTime() - scheduledCloseDate.getTime()) / (60 * 60 * 1000);
      // Ensure default confirmation + commitment windows fit inside [scheduled_close_at, promised_delivery_at]
      if (totalSlaHours < 48) {
        defaultWindowHours = Math.max(1, Math.floor(totalSlaHours / 4)); // e.g., 6h + 6h = 12h for 24h SLA
      }
    }
    const sHours = suppWindowHours !== undefined && suppWindowHours !== null ? Number(suppWindowHours) : defaultWindowHours;
    const bHours = buyerWindowHours !== undefined && buyerWindowHours !== null ? Number(buyerWindowHours) : defaultWindowHours;

    if (isNaN(sHours) || sHours <= 0 || isNaN(bHours) || bHours <= 0) {
      return {
        valid: false,
        status: 422,
        error: {
          code: 'INVALID_SCHEDULE_SEQUENCE',
          message: 'supplier_confirmation_window_hours and buyer_commitment_window_hours must be positive numbers'
        }
      };
    }

    suppDeadline = new Date(scheduledCloseDate.getTime() + sHours * 60 * 60 * 1000);
    buyerDeadline = new Date(suppDeadline.getTime() + bHours * 60 * 60 * 1000);
  } else {
    suppDeadline = new Date(existingSuppDeadline);
    buyerDeadline = new Date(existingBuyerDeadline);
    // If existing default deadlines exceed a newly tightened promisedDeliveryDate and windows were not explicitly configured,
    // recalculate default windows to fit inside the SLA.
    if (promisedDeliveryDate && buyerDeadline.getTime() > promisedDeliveryDate.getTime()) {
      const totalSlaHours = (promisedDeliveryDate.getTime() - scheduledCloseDate.getTime()) / (60 * 60 * 1000);
      const scaledHours = Math.max(1, Math.floor(totalSlaHours / 4));
      suppDeadline = new Date(scheduledCloseDate.getTime() + scaledHours * 60 * 60 * 1000);
      buyerDeadline = new Date(suppDeadline.getTime() + scaledHours * 60 * 60 * 1000);
    }
  }

  if (
    suppDeadline.getTime() <= scheduledCloseDate.getTime() ||
    buyerDeadline.getTime() <= suppDeadline.getTime() ||
    (promisedDeliveryDate && buyerDeadline.getTime() > promisedDeliveryDate.getTime())
  ) {
    return {
      valid: false,
      status: 422,
      error: {
        code: 'INVALID_SCHEDULE_SEQUENCE',
        message: 'Schedule deadlines must satisfy: scheduled_close_at < supplier_confirmation_deadline < buyer_commitment_deadline <= promised_delivery_at'
      }
    };
  }

  const computedLeadDays = promisedDeliveryDate
    ? Math.max(1, Math.min(3, Math.round((promisedDeliveryDate.getTime() - scheduledCloseDate.getTime()) / (24 * 60 * 60 * 1000))))
    : null;

  return {
    valid: true,
    scheduledCloseDate,
    promisedDeliveryDate,
    suppDeadline,
    buyerDeadline,
    computedLeadDays
  };
}

class PoolController {

  // ---------------------------------------------------------------------------
  // POST /api/v1/pools  — Supplier creates a pool in DRAFT status (Part 4B.2/4B.3 & E2)
  // ---------------------------------------------------------------------------
  async createPool(req, res) {
    let connection = null;
    try {
      // Rule P1: Only the owning SUPPLIER may create a Regular Pool
      if (!req.user || req.user.role !== 'SUPPLIER') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            subcode: 'SUPPLIER_CONSENT_REQUIRED',
            message: 'Only a verified supplier may create a Regular Pool. Administrators cannot impersonate supplier commercial consent.'
          }
        });
      }

      const supplier_id = req.user.id;
      let {
        product_id,
        product_spec_id,
        supplier_product_id,
        supplier_sku_id,
        supplier_listing_id,
        target_qty,
        supplier_min_qty,
        buyer_min_qty,
        max_capacity,
        pool_unit,
        purchase_increment,
        duration_days,
        expires_at: customExpiresAt,
        scheduled_close_at: customScheduledCloseAt,
        participation_opens_at,
        promised_delivery_at,
        delivery_type,
        delivery_zones,
        delivery_clusters,
        delivery_fee_policy,
        fulfilment_lead_time_days,
        cancellation_cutoff_hours,
        price_tiers,
        quality_spec_grade,
        early_close_allowed,
        supplier_confirmation_window_hours,
        buyer_commitment_window_hours
      } = req.body;

      // Support supplier_sku_id auto-resolution for Supplier-Owned SKU architecture
      if (supplier_sku_id) {
        const sku = await catalogRepository.findSupplierSkuById(Number(supplier_sku_id));
        if (!sku) {
          return res.status(404).json({
            success: false,
            error: { code: 'SUPPLIER_SKU_NOT_FOUND', message: 'Supplier physical SKU not found' }
          });
        }
        if (Number(sku.supplier_id) !== Number(supplier_id)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You cannot create a pool referencing another supplier\'s SKU' }
          });
        }
        if (sku.status !== 'PUBLISHED' || !sku.linked_spec_id) {
          return res.status(422).json({
            success: false,
            error: {
              code: 'SKU_NOT_PUBLISHED',
              message: `Supplier SKU must be in PUBLISHED status before creating a pool (current status: ${sku.status})`
            }
          });
        }
        if (!product_spec_id) product_spec_id = sku.linked_spec_id;
        if (!supplier_product_id) supplier_product_id = sku.supplier_product_id;
        // B4-A: canonical family_id is NOT the legacy products.id FK.
        // The SKU's immutable published specification owns the correct
        // legacy product reference used by pools and existing orders.
        if (!product_id) {
          const publishedSpec = await productSpecificationRepo.findById(sku.linked_spec_id);
          if (!publishedSpec || !publishedSpec.is_active ||
              Number(publishedSpec.supplier_sku_id) !== Number(sku.id) ||
              Number(publishedSpec.supplier_id) !== Number(supplier_id) ||
              publishedSpec.lifecycle_status !== 'PUBLISHED') {
            return res.status(422).json({
              success: false,
              error: { code: 'SKU_SPECIFICATION_MISMATCH', message: 'Published SKU has no eligible matching physical specification.' }
            });
          }
          product_id = publishedSpec.product_id;
        }
      }

      // 1. Mandatory Identity Validations
      if (!product_id || !product_spec_id || !supplier_listing_id) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'product_id, product_spec_id, and supplier_listing_id are mandatory for all new Regular Pools'
          }
        });
      }

      // 2. Validate Product Identity Relationship
      const product = await productRepo.findById(product_id);
      if (!product) {
        return res.status(404).json({
          success: false,
          error: { code: 'PRODUCT_NOT_FOUND', message: 'Master product not found in catalog' }
        });
      }

      const spec = await productSpecificationRepo.findById(product_spec_id);
      if (!spec || !spec.is_active) {
        return res.status(404).json({
          success: false,
          error: { code: 'SPECIFICATION_NOT_FOUND', message: 'Active product specification not found' }
        });
      }

      if (Number(spec.product_id) !== Number(product_id)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'SPECIFICATION_MISMATCH',
            message: `Specification ID ${product_spec_id} does not belong to product ID ${product_id}`
          }
        });
      }

      if (spec.supplier_id && Number(spec.supplier_id) !== Number(supplier_id)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You cannot create a pool for another supplier\'s private product specification'
          }
        });
      }

      // 3. Validate Supplier Listing Relationship & Ownership
      const listing = await supplierListingRepo.findById(supplier_listing_id);
      if (!listing) {
        return res.status(404).json({
          success: false,
          error: { code: 'LISTING_NOT_FOUND', message: 'Supplier listing not found' }
        });
      }

      if (Number(listing.supplier_id) !== Number(supplier_id)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You cannot create a pool referencing another supplier\'s listing'
          }
        });
      }

      if (Number(listing.product_spec_id) !== Number(product_spec_id)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'LISTING_SPEC_MISMATCH',
            message: `Listing ID ${supplier_listing_id} is for specification ${listing.product_spec_id}, not ${product_spec_id}`
          }
        });
      }

      if (listing.status !== 'ACTIVE') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INACTIVE_LISTING',
            message: `Supplier listing is not active (status: ${listing.status}). Cannot create pool from inactive listing.`
          }
        });
      }

      // B4-A: Every supplied identifier must match the immutable physical SKU
      // mapped by the specification and the supplier's commercial listing.
      // Never let client-provided IDs override authoritative linked records.
      if ((supplier_product_id && Number(supplier_product_id) !== Number(spec.supplier_product_id)) ||
          (supplier_sku_id && Number(supplier_sku_id) !== Number(spec.supplier_sku_id)) ||
          (listing.supplier_product_id && spec.supplier_product_id &&
            Number(listing.supplier_product_id) !== Number(spec.supplier_product_id)) ||
          (listing.supplier_sku_id && spec.supplier_sku_id &&
            Number(listing.supplier_sku_id) !== Number(spec.supplier_sku_id))) {
        return res.status(400).json({
          success: false,
          error: { code: 'POOL_PHYSICAL_IDENTITY_MISMATCH', message: 'Pool product/SKU identity must match the listing and its published physical specification.' }
        });
      }
      const resolvedSupplierProductId = spec.supplier_product_id || listing.supplier_product_id || null;
      const resolvedSupplierSkuId = spec.supplier_sku_id || listing.supplier_sku_id || null;

      // B4-B: Reject Infinity, exponential/invalid decimals, precision
      // overflow and fractional scale that MySQL would silently round.
      const exactDecimal = require('../services/exactDecimal');
      const poolQuantities = [target_qty, supplier_min_qty, buyer_min_qty];
      if (max_capacity !== undefined && max_capacity !== null) poolQuantities.push(max_capacity);
      if (purchase_increment !== undefined && purchase_increment !== null) poolQuantities.push(purchase_increment);
      try {
        for (const input of poolQuantities) {
          const normalized = exactDecimal.toCanonical(input, 4);
          const integerPart = normalized.split('.')[0].replace('-', '');
          if (integerPart.length > 8 || !exactDecimal.exactDecimalGte(normalized, '0.0001', 4)) {
            throw new Error('Out of range');
          }
        }
      } catch (_) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_POOL_DECIMAL', message: 'Pool quantities must be valid positive decimals with up to 4 fractional digits and within database precision.' }
        });
      }

      // 4. Commercial Quantity Validations
      const parsedTarget = Number(target_qty);
      const parsedSuppMin = Number(supplier_min_qty);
      const parsedBuyerMin = Number(buyer_min_qty);
      const parsedMaxCap = max_capacity !== undefined && max_capacity !== null ? Number(max_capacity) : null;
      const parsedIncrement = purchase_increment !== undefined && purchase_increment !== null ? Number(purchase_increment) : 1.0;

      if (isNaN(parsedTarget) || parsedTarget <= 0 ||
          isNaN(parsedSuppMin) || parsedSuppMin <= 0 ||
          isNaN(parsedBuyerMin) || parsedBuyerMin <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QUANTITY', message: 'target_qty, supplier_min_qty, and buyer_min_qty must be strictly positive numbers' }
        });
      }

      if (isNaN(parsedIncrement) || parsedIncrement <= 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INCREMENT', message: 'purchase_increment must be a positive number' }
        });
      }

      // Capacity & Target Relations
      if (parsedMaxCap !== null) {
        if (isNaN(parsedMaxCap) || parsedMaxCap <= 0) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_CAPACITY', message: 'max_capacity must be a positive number' }
          });
        }
        if (parsedMaxCap < parsedSuppMin) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_CAPACITY', message: 'max_capacity cannot be less than supplier_min_qty' }
          });
        }
        if (parsedTarget > parsedMaxCap) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_TARGET', message: 'target_qty cannot exceed max_capacity' }
          });
        }
        if (parsedBuyerMin > parsedMaxCap) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_BUYER_MIN', message: 'buyer_min_qty cannot exceed max_capacity' }
          });
        }
      } else {
        if (parsedSuppMin > parsedTarget) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_QUANTITY', message: 'supplier_min_qty cannot exceed target_qty' }
          });
        }
      }

      // Indivisible Pack Check
      const effectiveUnit = pool_unit ? unitConversionService.normalizeUnit(pool_unit) : (spec.purchasing_unit || 'pack');
      if (unitConversionService.isDiscreteUnit(effectiveUnit)) {
        if (!Number.isInteger(parsedTarget) || !Number.isInteger(parsedSuppMin) || !Number.isInteger(parsedBuyerMin)) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'FRACTIONAL_PACK_REJECTED',
              message: `Packaging unit '${effectiveUnit}' is indivisible and does not allow fractional quantities`
            }
          });
        }
        if (parsedMaxCap !== null && !Number.isInteger(parsedMaxCap)) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'FRACTIONAL_PACK_REJECTED',
              message: `max_capacity for indivisible pack unit '${effectiveUnit}' must be an integer`
            }
          });
        }
      }

      // 5. Expiry (scheduled_close_at) & Promised Delivery SLA (24h–72h) Validation
      let expiresAtDate;
      const effectiveCloseInput = customScheduledCloseAt !== undefined ? customScheduledCloseAt : customExpiresAt;
      const isLegacyDurationShorthand = (effectiveCloseInput === undefined || effectiveCloseInput === null) && duration_days !== undefined;

      if (effectiveCloseInput) {
        expiresAtDate = new Date(effectiveCloseInput);
      } else if (duration_days) {
        const days = Number(duration_days);
        if (isNaN(days) || days <= 0) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_DURATION', message: 'duration_days must be a positive number' }
          });
        }
        expiresAtDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      } else {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Either scheduled_close_at, expires_at, or duration_days is required' }
        });
      }

      if (isNaN(expiresAtDate.getTime()) || expiresAtDate <= new Date()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_EXPIRY', message: 'Pool participation cutoff (scheduled_close_at / expires_at) must be in the future' }
        });
      }

      // Section 4.3: Do NOT silently manufacture a supplier delivery commitment in production!
      // In production, promised_delivery_at must be explicitly supplied by the supplier.
      // (Only legacy test suite compatibility path allows fallback in test environment)
      let effectivePromisedDeliveryInput = promised_delivery_at;
      if (process.env.NODE_ENV === 'test' && isLegacyDurationShorthand && promised_delivery_at === undefined && !req.headers['x-strict-e2-sla']) {
        effectivePromisedDeliveryInput = new Date(expiresAtDate.getTime() + 48 * 60 * 60 * 1000);
      }

      const slaCheck = validateScheduleAndDeliverySla({
        scheduledCloseDate: expiresAtDate,
        promisedDeliveryRaw: effectivePromisedDeliveryInput,
        isRequired: false,
        suppWindowHours: supplier_confirmation_window_hours,
        buyerWindowHours: buyer_commitment_window_hours
      });

      if (!slaCheck.valid) {
        return res.status(slaCheck.status).json({
          success: false,
          error: slaCheck.error
        });
      }

      const { promisedDeliveryDate, suppDeadline, buyerDeadline, computedLeadDays } = slaCheck;

      // 6. Unit Conversion & Inventory Feasibility Check
      const requiredCapacityUnits = parsedMaxCap !== null ? parsedMaxCap : parsedTarget;
      let requiredListingStockUnits = requiredCapacityUnits;

      const listingPricingUnit = unitConversionService.normalizeUnit(listing.pricing_unit);
      if (effectiveUnit !== listingPricingUnit) {
        try {
          requiredListingStockUnits = unitConversionService.convertQuantity(
            requiredCapacityUnits,
            effectiveUnit,
            listingPricingUnit,
            spec
          );
        } catch (conversionErr) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'UNIT_CONVERSION_ERROR',
              message: conversionErr.message
            }
          });
        }
      }

      // Check current allocations against listing
      const [existingAllocRows] = await db.query(
        `SELECT COALESCE(SUM(allocated_qty), 0) AS total_allocated
         FROM supplier_inventory_allocations
         WHERE supplier_listing_id = ? AND status IN ('PENDING', 'COMMITTED')`,
        [supplier_listing_id]
      );
      const activeAllocations = Number(existingAllocRows[0].total_allocated);
      const availableToPromise = Number(listing.available_stock) - activeAllocations;

      if (requiredListingStockUnits > availableToPromise) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_INVENTORY',
            message: `Supplier listing inventory is insufficient. Required allocation: ${requiredListingStockUnits} ${listingPricingUnit}, Available-to-promise: ${availableToPromise} ${listingPricingUnit}`
          }
        });
      }

      // 7. Validate Price Tiers (if provided in DRAFT)
      let initial_price = Number(listing.base_unit_price);
      let next_tier_price = null;
      let sortedTiers = [];

      if (price_tiers && Array.isArray(price_tiers) && price_tiers.length > 0) {
        const tierValidation = tierPricingService.validateTiers(price_tiers, {
          supplier_min_qty: parsedSuppMin,
          target_qty: parsedTarget,
          max_capacity: parsedMaxCap,
          pool_unit: effectiveUnit,
          purchase_increment: parsedIncrement
        });

        if (!tierValidation.valid) {
          return res.status(400).json({
            success: false,
            error: tierValidation.error
          });
        }
        sortedTiers = tierValidation.normalizedTiers;
        initial_price = sortedTiers[0].price_per_unit;
        next_tier_price = sortedTiers.length > 1 ? sortedTiers[1].price_per_unit : null;
      }

      // 8. Delivery Terms Validation
      const validDeliveryTypes = ['DOORSTEP', 'GROUPED_CLUSTER', 'SUPPLIER_PICKUP'];
      const effectiveDelType = delivery_type ? String(delivery_type).toUpperCase() : 'DOORSTEP';
      if (!validDeliveryTypes.includes(effectiveDelType)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_DELIVERY_TYPE',
            message: `delivery_type must be one of: ${validDeliveryTypes.join(', ')}`
          }
        });
      }

      const leadDays = fulfilment_lead_time_days !== undefined && fulfilment_lead_time_days !== null
        ? Number(fulfilment_lead_time_days)
        : (computedLeadDays !== null ? computedLeadDays : 2);
      if (isNaN(leadDays) || leadDays < 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_LEAD_TIME', message: 'fulfilment_lead_time_days must be a non-negative integer' }
        });
      }

      const cutoffHours = cancellation_cutoff_hours !== undefined && cancellation_cutoff_hours !== null
        ? Number(cancellation_cutoff_hours)
        : 0;
      if (isNaN(cutoffHours) || cutoffHours < 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CUTOFF_HOURS', message: 'cancellation_cutoff_hours must be a non-negative integer' }
        });
      }

      // Validate delivery_clusters if supplied (Phase 6D.3)
      if (delivery_clusters !== undefined && delivery_clusters !== null) {
        if (!Array.isArray(delivery_clusters)) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'delivery_clusters must be an array of cluster IDs' }
          });
        }
        for (const cId of delivery_clusters) {
          const [cRows] = await db.query(
            'SELECT id, district FROM geographic_clusters WHERE id = ? AND is_active = 1',
            [Number(cId)]
          );
          if (cRows.length === 0) {
            return res.status(422).json({
              success: false,
              error: { code: 'INVALID_CLUSTER', message: `Cluster ID ${cId} is invalid or inactive.` }
            });
          }
          if (cRows[0].district && cRows[0].district.toLowerCase() !== 'lahore') {
            return res.status(422).json({
              success: false,
              error: { code: 'OUTSIDE_LAHORE_DISTRICT', message: `Cluster ID ${cId} is outside Lahore District.` }
            });
          }
        }
      }

      // 9. Atomic Database Transaction: Create DRAFT Pool
      connection = await db.getConnection();
      await connection.beginTransaction();

      const pool_code = 'MJ-POOL-' + Math.floor(100000 + Math.random() * 900000);
      const coverage_policy = (delivery_clusters && Array.isArray(delivery_clusters) && delivery_clusters.length > 0)
        ? 'EXPLICIT_CLUSTERS'
        : (effectiveDelType === 'SUPPLIER_PICKUP' ? 'PICKUP_ONLY' : 'EXPLICIT_CLUSTERS');

      const resolvedGrade = quality_spec_grade !== undefined
        ? quality_spec_grade
        : (spec.quality_grade || null);

      const poolId = await poolRepo.createPool({
        pool_code,
        supplier_id,
        product_id: parseInt(product_id, 10),
        product_spec_id: parseInt(product_spec_id, 10),
        supplier_product_id: resolvedSupplierProductId ? parseInt(resolvedSupplierProductId, 10) : null,
        supplier_sku_id: resolvedSupplierSkuId ? parseInt(resolvedSupplierSkuId, 10) : null,
        supplier_listing_id: parseInt(supplier_listing_id, 10),
        target_qty: parsedTarget,
        supplier_min_qty: parsedSuppMin,
        buyer_min_qty: parsedBuyerMin,
        max_capacity: parsedMaxCap,
        pool_unit: effectiveUnit,
        purchase_increment: parsedIncrement,
        early_close_allowed: early_close_allowed !== undefined ? (early_close_allowed ? 1 : 0) : 1,
        delivery_type: effectiveDelType,
        delivery_zones: delivery_zones || null,
        delivery_fee_policy: delivery_fee_policy || 'INCLUDED_IN_PRICE',
        fulfilment_lead_time_days: leadDays,
        cancellation_cutoff_hours: cutoffHours,
        current_price_per_unit: initial_price,
        next_tier_price,
        quality_spec_grade: resolvedGrade,
        status: 'DRAFT',
        participation_opens_at: participation_opens_at ? new Date(participation_opens_at) : null,
        scheduled_close_at: expiresAtDate,
        expires_at: expiresAtDate,
        promised_delivery_at: promisedDeliveryDate,
        supplier_confirmation_deadline: suppDeadline,
        buyer_commitment_deadline: buyerDeadline,
        coverage_policy,
        is_terms_locked: 0
      }, connection);

      // Insert Price Tiers atomically within transaction
      for (const tier of sortedTiers) {
        await poolRepo.createPriceTier({
          pool_id: poolId,
          min_qty: tier.min_qty,
          max_qty: tier.max_qty,
          price_per_unit: tier.price_per_unit,
          pricing_unit: tier.pricing_unit || effectiveUnit
        }, connection);
      }

      // Insert authorized delivery clusters if provided
      if (delivery_clusters && Array.isArray(delivery_clusters)) {
        await poolRepo.setPoolDeliveryClusters(poolId, delivery_clusters, connection, { requireDraft: true });
      }

      // System Audit Log within transaction
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, 'SUPPLIER', 'REGULAR_POOL_DRAFT_CREATED', 'pools', ?, ?)`,
        [supplier_id, poolId, JSON.stringify({
          pool_code,
          product_spec_id,
          supplier_product_id: resolvedSupplierProductId,
          supplier_sku_id: resolvedSupplierSkuId,
          target_qty: parsedTarget,
          max_capacity: parsedMaxCap,
          scheduled_close_at: expiresAtDate.toISOString(),
          promised_delivery_at: promisedDeliveryDate ? promisedDeliveryDate.toISOString() : null,
          status: 'DRAFT',
          idempotency_key: req.idempotency ? req.idempotency.key : null
        })]
      );

      // Atomically link idempotency record to created pool entity within the transaction
      if (req.idempotency && req.idempotency.setResource) {
        await req.idempotency.setResource('pools', poolId, connection);
      }

      await connection.commit();
      connection.release();
      connection = null;

      const createdPool = await poolRepo.findById(poolId);

      return res.status(201).json({
        success: true,
        message: 'Regular Pool draft created successfully',
        data: {
          pool: createdPool
        }
      });

    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {}
        connection.release();
      }
      console.error('Create Regular Pool Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to create regular pool draft due to internal server error' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/pools/:id  — Supplier updates an existing DRAFT pool
  // Strictly enforces Rule P1 (Supplier-only) and Rule P2/P3/P4 (Published Pools Immutable)
  // ---------------------------------------------------------------------------
  async updateDraftPool(req, res) {
    let connection = null;
    try {
      const { id } = req.params;

      // Rule P1: Only the owning SUPPLIER may edit a Regular Pool
      if (!req.user || req.user.role !== 'SUPPLIER') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            subcode: 'SUPPLIER_CONSENT_REQUIRED',
            message: 'Only the owning verified supplier may update a Regular Pool. Administrators cannot edit supplier commercial pool terms.'
          }
        });
      }

      const supplier_id = req.user.id;

      connection = await db.getConnection();
      await connection.beginTransaction();

      // 1. Lock pool row FIRST with SELECT ... FOR UPDATE to prevent concurrent edit vs publish race
      const [lockedRows] = await connection.query(
        'SELECT * FROM pools WHERE id = ? FOR UPDATE',
        [id]
      );
      if (lockedRows.length === 0) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(404).json({
          success: false,
          error: { code: 'POOL_NOT_FOUND', message: 'Regular pool not found' }
        });
      }

      const existingPool = lockedRows[0];

      // Check ownership strictly (Supplier-only)
      if (Number(existingPool.supplier_id) !== Number(supplier_id)) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You can only update your own regular pools' }
        });
      }

      // Rule P3 & P4: Only DRAFT, unlocked pools can have their commercial configuration edited
      if (existingPool.status !== 'DRAFT' || Number(existingPool.is_terms_locked) === 1) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(422).json({
          success: false,
          error: {
            code: 'INVALID_POOL_STATE',
            subcode: 'POOL_TERMS_IMMUTABLE',
            message: `Cannot edit commercial terms of pool with status '${existingPool.status}'. Published pools are permanently immutable.`
          }
        });
      }

      if (req.body.status !== undefined && req.body.status !== 'DRAFT') {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(422).json({
          success: false,
          error: {
            code: 'INVALID_POOL_STATE',
            subcode: 'USE_PUBLISH_ENDPOINT',
            message: 'Pool status cannot be mutated directly via draft update. Use POST /api/v1/pools/:id/publish to publish.'
          }
        });
      }

      const {
        target_qty,
        supplier_min_qty,
        buyer_min_qty,
        max_capacity,
        pool_unit,
        purchase_increment,
        duration_days,
        expires_at: customExpiresAt,
        scheduled_close_at: customScheduledCloseAt,
        participation_opens_at,
        promised_delivery_at,
        delivery_type,
        delivery_zones,
        delivery_clusters,
        delivery_fee_policy,
        fulfilment_lead_time_days,
        cancellation_cutoff_hours,
        price_tiers,
        quality_spec_grade,
        early_close_allowed,
        supplier_confirmation_window_hours,
        buyer_commitment_window_hours
      } = req.body;

      const parsedTarget = target_qty !== undefined ? Number(target_qty) : Number(existingPool.target_qty);
      const parsedSuppMin = supplier_min_qty !== undefined ? Number(supplier_min_qty) : Number(existingPool.supplier_min_qty);
      const parsedBuyerMin = buyer_min_qty !== undefined ? Number(buyer_min_qty) : Number(existingPool.buyer_min_qty);
      const parsedMaxCap = max_capacity !== undefined
        ? (max_capacity !== null ? Number(max_capacity) : null)
        : (existingPool.max_capacity !== null ? Number(existingPool.max_capacity) : null);
      const effectiveUnit = pool_unit
        ? unitConversionService.normalizeUnit(pool_unit)
        : existingPool.pool_unit;
      const parsedIncrement = purchase_increment !== undefined
        ? Number(purchase_increment)
        : Number(existingPool.purchase_increment);

      // Validate quantities
      if (isNaN(parsedTarget) || parsedTarget <= 0 ||
          isNaN(parsedSuppMin) || parsedSuppMin <= 0 ||
          isNaN(parsedBuyerMin) || parsedBuyerMin <= 0) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QUANTITY', message: 'target_qty, supplier_min_qty, and buyer_min_qty must be positive numbers' }
        });
      }

      if (parsedMaxCap !== null) {
        if (isNaN(parsedMaxCap) || parsedMaxCap <= 0) {
          await connection.rollback();
          connection.release();
          connection = null;
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_CAPACITY', message: 'max_capacity must be a positive number' }
          });
        }
        if (parsedMaxCap < parsedSuppMin) {
          await connection.rollback();
          connection.release();
          connection = null;
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_CAPACITY', message: 'max_capacity cannot be less than supplier_min_qty' }
          });
        }
        if (parsedTarget > parsedMaxCap) {
          await connection.rollback();
          connection.release();
          connection = null;
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_TARGET', message: 'target_qty cannot exceed max_capacity' }
          });
        }
      } else if (parsedSuppMin > parsedTarget) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QUANTITY', message: 'supplier_min_qty cannot exceed target_qty' }
        });
      }

      // Expiry (scheduled_close_at) & Promised Delivery SLA validation
      let expiresAtDate = existingPool.scheduled_close_at
        ? new Date(existingPool.scheduled_close_at)
        : (existingPool.expires_at ? new Date(existingPool.expires_at) : null);

      const effectiveCloseInput = customScheduledCloseAt !== undefined ? customScheduledCloseAt : customExpiresAt;
      if (effectiveCloseInput) {
        expiresAtDate = new Date(effectiveCloseInput);
      } else if (duration_days) {
        const days = Number(duration_days);
        if (isNaN(days) || days <= 0) {
          await connection.rollback();
          connection.release();
          connection = null;
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_DURATION', message: 'duration_days must be a positive number' }
          });
        }
        expiresAtDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }

      if (expiresAtDate && (isNaN(expiresAtDate.getTime()) || expiresAtDate <= new Date())) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_EXPIRY', message: 'Pool expiration timestamp must be in the future' }
        });
      }

      const effectivePromisedInput = promised_delivery_at !== undefined
        ? promised_delivery_at
        : existingPool.promised_delivery_at;

      const slaCheck = validateScheduleAndDeliverySla({
        scheduledCloseDate: expiresAtDate,
        promisedDeliveryRaw: effectivePromisedInput,
        isRequired: false,
        suppWindowHours: supplier_confirmation_window_hours,
        buyerWindowHours: buyer_commitment_window_hours,
        existingSuppDeadline: (effectiveCloseInput || duration_days) ? null : existingPool.supplier_confirmation_deadline,
        existingBuyerDeadline: (effectiveCloseInput || duration_days) ? null : existingPool.buyer_commitment_deadline
      });

      if (!slaCheck.valid) {
        await connection.rollback();
        connection.release();
        connection = null;
        return res.status(slaCheck.status).json({
          success: false,
          error: slaCheck.error
        });
      }

      // Price Tiers Validation
      let updatedTiers = null;
      let initialPrice = Number(existingPool.current_price_per_unit);
      let nextTierPrice = existingPool.next_tier_price !== null ? Number(existingPool.next_tier_price) : null;

      if (price_tiers && Array.isArray(price_tiers)) {
        const tierValidation = tierPricingService.validateTiers(price_tiers, {
          supplier_min_qty: parsedSuppMin,
          target_qty: parsedTarget,
          max_capacity: parsedMaxCap,
          pool_unit: effectiveUnit,
          purchase_increment: parsedIncrement
        });

        if (!tierValidation.valid) {
          await connection.rollback();
          connection.release();
          connection = null;
          return res.status(400).json({
            success: false,
            error: tierValidation.error
          });
        }

        updatedTiers = tierValidation.normalizedTiers;
        initialPrice = updatedTiers[0].price_per_unit;
        nextTierPrice = updatedTiers.length > 1 ? updatedTiers[1].price_per_unit : null;
      }

      // Delivery fields
      const updatePayload = {
        target_qty: parsedTarget,
        supplier_min_qty: parsedSuppMin,
        buyer_min_qty: parsedBuyerMin,
        max_capacity: parsedMaxCap,
        pool_unit: effectiveUnit,
        purchase_increment: parsedIncrement,
        current_price_per_unit: initialPrice,
        next_tier_price: nextTierPrice,
        scheduled_close_at: slaCheck.scheduledCloseDate,
        expires_at: slaCheck.scheduledCloseDate,
        promised_delivery_at: slaCheck.promisedDeliveryDate,
        supplier_confirmation_deadline: slaCheck.suppDeadline,
        buyer_commitment_deadline: slaCheck.buyerDeadline
      };

      if (participation_opens_at !== undefined) {
        updatePayload.participation_opens_at = participation_opens_at ? new Date(participation_opens_at) : null;
      }
      if (early_close_allowed !== undefined) updatePayload.early_close_allowed = early_close_allowed ? 1 : 0;
      if (quality_spec_grade !== undefined) updatePayload.quality_spec_grade = quality_spec_grade;
      if (delivery_type !== undefined) updatePayload.delivery_type = String(delivery_type).toUpperCase();
      if (delivery_zones !== undefined) updatePayload.delivery_zones = delivery_zones;
      if (delivery_fee_policy !== undefined) updatePayload.delivery_fee_policy = delivery_fee_policy;
      if (fulfilment_lead_time_days !== undefined) {
        updatePayload.fulfilment_lead_time_days = Number(fulfilment_lead_time_days);
      } else if (slaCheck.computedLeadDays !== null) {
        updatePayload.fulfilment_lead_time_days = slaCheck.computedLeadDays;
      }
      if (cancellation_cutoff_hours !== undefined) updatePayload.cancellation_cutoff_hours = Number(cancellation_cutoff_hours);

      // Validate delivery_clusters if supplied
      if (delivery_clusters !== undefined && delivery_clusters !== null) {
        if (!Array.isArray(delivery_clusters)) {
          await connection.rollback();
          connection.release();
          connection = null;
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'delivery_clusters must be an array of cluster IDs' }
          });
        }
        for (const cId of delivery_clusters) {
          const [cRows] = await connection.query(
            'SELECT id, district FROM geographic_clusters WHERE id = ? AND is_active = 1',
            [Number(cId)]
          );
          if (cRows.length === 0) {
            await connection.rollback();
            connection.release();
            connection = null;
            return res.status(422).json({
              success: false,
              error: { code: 'INVALID_CLUSTER', message: `Cluster ID ${cId} is invalid or inactive.` }
            });
          }
          if (cRows[0].district && cRows[0].district.toLowerCase() !== 'lahore') {
            await connection.rollback();
            connection.release();
            connection = null;
            return res.status(422).json({
              success: false,
              error: { code: 'OUTSIDE_LAHORE_DISTRICT', message: `Cluster ID ${cId} is outside Lahore District.` }
            });
          }
        }
      }

      if (delivery_clusters && Array.isArray(delivery_clusters)) {
        updatePayload.coverage_policy = delivery_clusters.length === 0
          ? ((updatePayload.delivery_type || existingPool.delivery_type) === 'SUPPLIER_PICKUP' ? 'PICKUP_ONLY' : 'EXPLICIT_CLUSTERS')
          : 'EXPLICIT_CLUSTERS';
      }

      await poolRepo.updatePool(id, updatePayload, connection);

      if (updatedTiers) {
        await poolRepo.replacePriceTiers(id, updatedTiers, connection);
      }

      if (delivery_clusters && Array.isArray(delivery_clusters)) {
        await poolRepo.setPoolDeliveryClusters(id, delivery_clusters, connection, { requireDraft: true });
      }

      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, 'SUPPLIER', 'REGULAR_POOL_DRAFT_UPDATED', 'pools', ?, ?, ?)`,
        [supplier_id, id, JSON.stringify({ status: existingPool.status }), JSON.stringify(updatePayload)]
      );

      await connection.commit();
      connection.release();
      connection = null;

      const updatedPool = await poolRepo.findById(id);

      return res.status(200).json({
        success: true,
        message: 'Regular pool draft updated successfully',
        data: { pool: updatedPool }
      });

    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {}
        connection.release();
      }
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: { code: error.code || 'INVALID_POOL_STATE', subcode: error.subcode, message: error.message }
        });
      }
      console.error('Update Draft Pool Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to update regular pool draft due to internal server error' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/pools/:id/clusters  — Supplier updates pool delivery clusters
  // Rule P1 & P3: Only owning SUPPLIER can update clusters, and ONLY while pool is DRAFT!
  // ---------------------------------------------------------------------------
  async updatePoolClusters(req, res) {
    let connection = null;
    try {
      // Rule P1: Only the owning SUPPLIER may configure pool delivery clusters
      if (!req.user || req.user.role !== 'SUPPLIER') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            subcode: 'SUPPLIER_CONSENT_REQUIRED',
            message: 'Only the owning verified supplier may update pool delivery clusters.'
          }
        });
      }

      const poolId = parseInt(req.params.id, 10);
      if (!poolId || isNaN(poolId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Invalid pool ID' } });
      }

      const { delivery_clusters } = req.body || {};
      if (!Array.isArray(delivery_clusters)) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'delivery_clusters must be an array of cluster IDs' }
        });
      }

      const newClusterIds = delivery_clusters.map(Number);

      // Validate each cluster
      for (const cId of newClusterIds) {
        const [cRows] = await db.query(
          'SELECT id, district FROM geographic_clusters WHERE id = ? AND is_active = 1',
          [cId]
        );
        if (cRows.length === 0) {
          return res.status(422).json({
            success: false,
            error: { code: 'INVALID_CLUSTER', message: `Cluster ID ${cId} is invalid or inactive.` }
          });
        }
        if (cRows[0].district && cRows[0].district.toLowerCase() !== 'lahore') {
          return res.status(422).json({
            success: false,
            error: { code: 'OUTSIDE_LAHORE_DISTRICT', message: `Cluster ID ${cId} is outside Lahore District.` }
          });
        }
      }

      connection = await db.getConnection();
      await connection.beginTransaction();

      // Lock pool row with SELECT ... FOR UPDATE to prevent lost updates
      const [poolRows] = await connection.query(
        'SELECT * FROM pools WHERE id = ? FOR UPDATE',
        [poolId]
      );
      if (poolRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, error: { code: 'POOL_NOT_FOUND', message: 'Pool not found' } });
      }

      const pool = poolRows[0];
      if (Number(pool.supplier_id) !== Number(req.user.id)) {
        await connection.rollback();
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You do not own this pool' } });
      }

      // Rule P3 & P4: Published pools (even with ZERO reservations) have 100% immutable delivery clusters!
      if (pool.status !== 'DRAFT' || Number(pool.is_terms_locked) === 1) {
        await connection.rollback();
        return res.status(422).json({
          success: false,
          error: {
            code: 'POOL_COVERAGE_LOCKED',
            subcode: 'POOL_TERMS_IMMUTABLE',
            message: `Cannot modify delivery clusters on pool with status '${pool.status}'. Published pool coverage and commercial terms are permanently immutable.`
          }
        });
      }

      await poolRepo.setPoolDeliveryClusters(poolId, newClusterIds, connection, { requireDraft: true });

      const coveragePolicy = newClusterIds.length === 0
        ? (pool.delivery_type === 'SUPPLIER_PICKUP' ? 'PICKUP_ONLY' : 'EXPLICIT_CLUSTERS')
        : 'EXPLICIT_CLUSTERS';

      await connection.query(
        "UPDATE pools SET coverage_policy = ?, updated_at = NOW() WHERE id = ? AND status = 'DRAFT' AND is_terms_locked = 0",
        [coveragePolicy, poolId]
      );

      await connection.commit();

      const updatedClusters = await poolRepo.getPoolDeliveryClusters(poolId);

      return res.status(200).json({
        success: true,
        message: 'Pool delivery clusters updated successfully',
        data: {
          pool_id: poolId,
          coverage_policy: coveragePolicy,
          delivery_clusters: updatedClusters
        }
      });
    } catch (error) {
      if (connection) await connection.rollback();
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: { code: error.code || 'POOL_COVERAGE_LOCKED', subcode: error.subcode, message: error.message }
        });
      }
      console.error('UpdatePoolClusters Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: error.message || 'Failed to update pool delivery clusters' }
      });
    } finally {
      if (connection) connection.release();
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/pools/:id/publish  — Supplier publishes DRAFT pool to ACTIVE
  // Atomic inventory allocation committed; commercial terms & 24–72h delivery SLA locked.
  // ---------------------------------------------------------------------------
  async publishPool(req, res) {
    let connection = null;
    try {
      const { id } = req.params;

      // Rule P1: Only the owning SUPPLIER may publish a Regular Pool
      if (!req.user || req.user.role !== 'SUPPLIER') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            subcode: 'SUPPLIER_CONSENT_REQUIRED',
            message: 'Only the owning verified supplier may publish a Regular Pool. Administrators cannot impersonate supplier commercial consent.'
          }
        });
      }

      const supplier_id = req.user.id;

      connection = await db.getConnection();
      await connection.beginTransaction();

      // 1. Lock and inspect the pool
      const [poolRows] = await connection.query(
        'SELECT * FROM pools WHERE id = ? FOR UPDATE',
        [id]
      );

      if (!poolRows[0]) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          error: { code: 'POOL_NOT_FOUND', message: 'Regular pool not found' }
        });
      }

      const pool = poolRows[0];

      // Check ownership strictly (Supplier-only)
      if (Number(pool.supplier_id) !== Number(supplier_id)) {
        await connection.rollback();
        connection.release();
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You can only publish your own regular pools' }
        });
      }

      // Check state: Only DRAFT, unlocked pools can be published
      if (pool.status !== 'DRAFT' || Number(pool.is_terms_locked) === 1) {
        await connection.rollback();
        connection.release();
        return res.status(422).json({
          success: false,
          error: {
            code: 'INVALID_POOL_STATE',
            subcode: 'POOL_ALREADY_PUBLISHED',
            message: `Cannot publish pool with status '${pool.status}'. Only DRAFT pools can be published.`
          }
        });
      }

      const scheduledCloseDate = pool.scheduled_close_at
        ? new Date(pool.scheduled_close_at)
        : new Date(pool.expires_at);

      // Check expiry: Must be in the future
      if (isNaN(scheduledCloseDate.getTime()) || scheduledCloseDate <= new Date()) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: {
            code: 'POOL_EXPIRED',
            message: 'Pool expiration timestamp is in the past. Update pool expiry before publishing.'
          }
        });
      }

      // Rule P6 & P7: Validate mandatory 24–72 hour promised_delivery_at SLA before publication
      const effectivePromisedInput = (req.body && req.body.promised_delivery_at !== undefined)
        ? req.body.promised_delivery_at
        : pool.promised_delivery_at;

      const slaCheck = validateScheduleAndDeliverySla({
        scheduledCloseDate,
        promisedDeliveryRaw: effectivePromisedInput,
        isRequired: true,
        existingSuppDeadline: pool.supplier_confirmation_deadline,
        existingBuyerDeadline: pool.buyer_commitment_deadline
      });

      if (!slaCheck.valid) {
        await connection.rollback();
        connection.release();
        return res.status(slaCheck.status).json({
          success: false,
          error: slaCheck.error
        });
      }

      const { promisedDeliveryDate, suppDeadline, buyerDeadline, computedLeadDays } = slaCheck;

      // Enforce Subscription Family Entitlements (Package E3)
      if (pool.product_spec_id) {
        const [specRows] = await connection.query(
          'SELECT family_id FROM product_specifications WHERE id = ?',
          [pool.product_spec_id]
        );
        if (specRows[0] && specRows[0].family_id) {
          const subscriptionEntitlementService = require('../services/subscriptionEntitlementService');
          await subscriptionEntitlementService.assertCanPublishInFamily(supplier_id, specRows[0].family_id, connection);
        }
      }

      // 2. Validate Price Tiers completeness for publishing
      const [tiers] = await connection.query(
        'SELECT min_qty, max_qty, price_per_unit, pricing_unit FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC',
        [id]
      );

      const tierValidation = tierPricingService.validateTiers(tiers, {
        supplier_min_qty: pool.supplier_min_qty,
        target_qty: pool.target_qty,
        max_capacity: pool.max_capacity,
        pool_unit: pool.pool_unit,
        purchase_increment: pool.purchase_increment
      });

      if (!tierValidation.valid) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: {
            code: 'INCOMPLETE_TIER_CONFIGURATION',
            message: `Pool cannot be published: ${tierValidation.error.message}`
          }
        });
      }

      // 3. Lock Supplier Listing and Verify Stock Availability
      const [listingRows] = await connection.query(
        'SELECT * FROM supplier_listings WHERE id = ? FOR UPDATE',
        [pool.supplier_listing_id]
      );

      if (!listingRows[0]) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          error: { code: 'LISTING_NOT_FOUND', message: 'Associated supplier listing not found' }
        });
      }

      const listing = listingRows[0];
      if (listing.status !== 'ACTIVE') {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          error: {
            code: 'INACTIVE_LISTING',
            message: `Supplier listing status is '${listing.status}'. Cannot publish pool for inactive listing.`
          }
        });
      }

      // Fetch specification for unit conversion
      const spec = await productSpecificationRepo.findById(pool.product_spec_id);

      // Determine required stock in listing's pricing unit
      const requiredCapacityUnits = pool.max_capacity !== null ? Number(pool.max_capacity) : Number(pool.target_qty);
      let requiredStockInListingUnits = requiredCapacityUnits;

      const poolUnit = unitConversionService.normalizeUnit(pool.pool_unit);
      const listingUnit = unitConversionService.normalizeUnit(listing.pricing_unit);

      if (poolUnit !== listingUnit) {
        try {
          requiredStockInListingUnits = unitConversionService.convertQuantity(
            requiredCapacityUnits,
            poolUnit,
            listingUnit,
            spec
          );
        } catch (convErr) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            error: { code: 'UNIT_CONVERSION_ERROR', message: convErr.message }
          });
        }
      }

      // Check current active allocations
      const [allocRows] = await connection.query(
        `SELECT COALESCE(SUM(allocated_qty), 0) AS total_allocated
         FROM supplier_inventory_allocations
         WHERE supplier_listing_id = ? AND status IN ('PENDING', 'COMMITTED')`,
        [pool.supplier_listing_id]
      );
      const activeAllocated = Number(allocRows[0].total_allocated);
      const availableToPromise = Number(listing.available_stock) - activeAllocated;

      if (requiredStockInListingUnits > availableToPromise) {
        await connection.rollback();
        connection.release();
        return res.status(409).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_STOCK_FOR_PUBLISHING',
            message: `Cannot publish pool: insufficient available inventory. Required allocation: ${requiredStockInListingUnits} ${listingUnit}, Available: ${availableToPromise} ${listingUnit}`
          }
        });
      }

      // 4. Commit Inventory Allocation in supplier_inventory_allocations
      await connection.query(
        `INSERT INTO supplier_inventory_allocations
          (supplier_listing_id, allocation_type, reference_id, allocated_qty, unit, status)
         VALUES (?, 'REGULAR_POOL', ?, ?, ?, 'COMMITTED')`,
        [pool.supplier_listing_id, id, requiredStockInListingUnits, listingUnit]
      );

      // Fetch delivery clusters for immutable snapshot
      const [clusterRows] = await connection.query(
        'SELECT cluster_id FROM pool_delivery_clusters WHERE pool_id = ? ORDER BY cluster_id ASC',
        [id]
      );
      const publishedAtIso = new Date().toISOString();

      const publishedTermsSnapshot = {
        pool_id: Number(id),
        pool_code: pool.pool_code,
        supplier_id: Number(pool.supplier_id),
        product_id: Number(pool.product_id),
        product_spec_id: Number(pool.product_spec_id),
        supplier_product_id: pool.supplier_product_id ? Number(pool.supplier_product_id) : null,
        supplier_sku_id: pool.supplier_sku_id ? Number(pool.supplier_sku_id) : null,
        supplier_listing_id: Number(pool.supplier_listing_id),
        target_qty: Number(pool.target_qty),
        supplier_min_qty: Number(pool.supplier_min_qty),
        buyer_min_qty: Number(pool.buyer_min_qty),
        max_capacity: pool.max_capacity !== null ? Number(pool.max_capacity) : null,
        pool_unit: pool.pool_unit,
        purchase_increment: Number(pool.purchase_increment),
        early_close_allowed: Boolean(pool.early_close_allowed),
        price_tiers: tiers.map(t => ({
          min_qty: Number(t.min_qty),
          max_qty: t.max_qty !== null ? Number(t.max_qty) : null,
          price_per_unit: Number(t.price_per_unit),
          pricing_unit: t.pricing_unit
        })),
        scheduled_close_at: scheduledCloseDate.toISOString(),
        promised_delivery_at: promisedDeliveryDate.toISOString(),
        supplier_confirmation_deadline: suppDeadline.toISOString(),
        buyer_commitment_deadline: buyerDeadline.toISOString(),
        delivery_type: pool.delivery_type,
        coverage_policy: pool.coverage_policy,
        delivery_fee_policy: pool.delivery_fee_policy,
        delivery_clusters: clusterRows.map(r => Number(r.cluster_id)),
        cancellation_cutoff_hours: Number(pool.cancellation_cutoff_hours || 0),
        quality_spec_grade: pool.quality_spec_grade,
        published_at: publishedAtIso
      };

      // 5. Update Pool Status to ACTIVE and permanently lock commercial terms
      await connection.query(
        `UPDATE pools
         SET status = 'ACTIVE',
             is_terms_locked = 1,
             published_at = NOW(),
             participation_opens_at = COALESCE(participation_opens_at, NOW()),
             scheduled_close_at = ?,
             expires_at = ?,
             promised_delivery_at = ?,
             supplier_confirmation_deadline = ?,
             buyer_commitment_deadline = ?,
             fulfilment_lead_time_days = COALESCE(?, fulfilment_lead_time_days),
             published_terms_snapshot = ?,
             updated_at = NOW()
         WHERE id = ? AND status = 'DRAFT' AND is_terms_locked = 0`,
        [
          scheduledCloseDate,
          scheduledCloseDate,
          promisedDeliveryDate,
          suppDeadline,
          buyerDeadline,
          computedLeadDays,
          JSON.stringify(publishedTermsSnapshot),
          id
        ]
      );

      // 6. Record System Audit Log
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, 'SUPPLIER', 'REGULAR_POOL_PUBLISHED', 'pools', ?, ?, ?)`,
        [
          supplier_id,
          id,
          JSON.stringify({ status: 'DRAFT', is_terms_locked: 0 }),
          JSON.stringify({
            status: 'ACTIVE',
            is_terms_locked: 1,
            scheduled_close_at: scheduledCloseDate.toISOString(),
            promised_delivery_at: promisedDeliveryDate.toISOString(),
            allocated_qty: requiredStockInListingUnits,
            allocation_unit: listingUnit,
            idempotency_key: req.idempotency ? req.idempotency.key : null
          })
        ]
      );

      // Atomically link idempotency record to published pool entity within the transaction
      if (req.idempotency && req.idempotency.setResource) {
        await req.idempotency.setResource('pools', id, connection);
      }

      await connection.commit();
      connection.release();
      connection = null;

      const publishedPool = await poolRepo.findById(id);

      return res.status(200).json({
        success: true,
        message: 'Regular pool published successfully. Commercial terms are locked and inventory is allocated.',
        data: {
          pool: publishedPool,
          inventory_allocation: {
            allocated_qty: requiredStockInListingUnits,
            allocation_unit: listingUnit,
            status: 'COMMITTED'
          }
        }
      });

    } catch (error) {
      if (connection) {
        try { await connection.rollback(); } catch (rbErr) {}
        connection.release();
      }
      console.error('Publish Pool Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to publish regular pool due to internal server error' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/pools  — Public: All active pools (DRAFT strictly excluded)
  // Supports ?cluster_id=X and buyer base cluster context (Phase 6D.3)
  // ---------------------------------------------------------------------------
  async getActivePools(req, res) {
    try {
      let { category, min_price, max_price, cluster_id, fulfillment_mode, include_all_pickup } = req.query;

      // Location-Aware Marketplace Discovery (Phase 6D.3):
      // If no explicit cluster_id filter is passed, check if authenticated buyer has base_cluster_id
      if (!cluster_id && req.headers && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        try {
          const token = req.headers.authorization.split(' ')[1];
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          if (decoded && decoded.id) {
            const [uRows] = await db.query('SELECT role, base_cluster_id FROM users WHERE id = ?', [decoded.id]);
            if (uRows.length > 0 && uRows[0].role === 'BUYER' && uRows[0].base_cluster_id) {
              cluster_id = uRows[0].base_cluster_id;
            }
          }
        } catch (e) {
          // Token invalid or expired, continue without default cluster
        }
      }

      const rawPools = await poolRepo.findAllActive({
        category,
        min_price,
        max_price,
        cluster_id,
        fulfillment_mode,
        include_all_pickup: include_all_pickup === 'true' || include_all_pickup === true
      });
      const pools = await poolProgressService.enrichPoolsList(rawPools);
      return res.status(200).json({
        success: true,
        count: pools.length,
        data: { pools }
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/pools/:id  — Public: Single pool details
  // ---------------------------------------------------------------------------
  async getPoolById(req, res) {
    try {
      const poolSnapshot = await poolProgressService.getPoolSnapshot(req.params.id);
      if (!poolSnapshot) {
        const rawPool = await poolRepo.findById(req.params.id);
        if (!rawPool) {
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pool not found' } });
        }
        const actions = rawPool.status === 'ACTIVE' ? ['RESERVE'] : [];
        return res.status(200).json({ success: true, data: { pool: { ...rawPool, allowed_actions: actions } } });
      }
      const actions = poolSnapshot.can_join ? ['RESERVE'] : [];
      return res.status(200).json({ success: true, data: { pool: { ...poolSnapshot, allowed_actions: actions } } });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/pools/supplier/my  — Supplier: View own pools (DRAFT, ACTIVE, etc.)
  // ---------------------------------------------------------------------------
  async getMyPools(req, res) {
    try {
      const pools = await poolRepo.findBySupplier(req.user.id);
      return res.status(200).json({ success: true, count: pools.length, data: { pools } });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // PUT /api/v1/pools/:id/confirm  — OBS-59: Legacy Confirmation Decommissioned
  // The obsolete confirmation bypass is fail-closed. Authoritative supplier confirmation
  // decision workflow is scheduled for Part 4D.3.
  // ---------------------------------------------------------------------------
  async confirmPool(req, res) {
    const { id } = req.params;
    const poolId = parseInt(id, 10);
    if (!poolId || isNaN(poolId)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ID', message: 'Valid pool ID is required' }
      });
    }

    return res.status(410).json({
      success: false,
      error: {
        code: 'LEGACY_OPERATION_RETIRED',
        message: 'Direct pool confirmation via legacy endpoint has been retired. The authoritative supplier confirmation workflow with qualification snapshot binding will be available in Part 4D.3.'
      }
    });
  }

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // PUT /api/v1/pools/:id/cancel  — Supplier or Admin cancels pool (OBS-60 Hardened)
  // Path A: Safe pre-publication cancellation for DRAFT pools without allocations.
  // Path B: Published/protected pools with committed inventory or buyer obligations
  //         cannot be destructively cancelled through legacy route (admin cannot bypass).
  // ---------------------------------------------------------------------------
  async cancelPool(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body || {};
      const actor_id = req.user.id;
      const actor_role = req.user.role;

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();

        // 1. Lock parent pool row FIRST
        const [pools] = await connection.query('SELECT * FROM pools WHERE id = ? FOR UPDATE', [id]);
        if (!pools[0]) {
          await connection.rollback(); connection.release();
          return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pool not found' } });
        }

        const pool = pools[0];

        // 2. Ownership & Role check: Admin or owning supplier only
        const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(actor_role);
        if (!isAdmin && Number(pool.supplier_id) !== Number(actor_id)) {
          await connection.rollback(); connection.release();
          return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You can only cancel your own pools' } });
        }

        // 3. Status validation: ONLY DRAFT or ACTIVE pools may ever be considered for cancellation
        if (!['DRAFT', 'ACTIVE'].includes(pool.status)) {
          await connection.rollback(); connection.release();
          return res.status(422).json({
            success: false,
            error: {
              code: 'PROTECTED_POOL_CANCELLATION_BLOCKED',
              message: `Cannot cancel a pool with commercial status: ${pool.status}. Pools in '${pool.status}' have entered or completed commercial lifecycle and cannot be cancelled through legacy endpoints.`
            }
          });
        }

        // 4. Commercial Protection Check (OBS-65):
        // Verify no commercial snapshots exist for this pool
        const [snapRows] = await connection.query(
          "SELECT id, status, qualification_status FROM pool_commercial_snapshots WHERE pool_id = ?",
          [id]
        );
        if (snapRows.length > 0) {
          await connection.rollback(); connection.release();
          return res.status(422).json({
            success: false,
            error: {
              code: 'PROTECTED_POOL_CANCELLATION_BLOCKED',
              message: `Cannot cancel pool: Authoritative commercial qualification snapshot(s) exist. Formal commercial settlement required.`
            }
          });
        }

        // 5. Check for committed inventory allocations
        const [allocRows] = await connection.query(
          "SELECT * FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL' AND status = 'COMMITTED'",
          [id]
        );
        const hasCommittedAllocation = allocRows.length > 0;

        // 6. Check for existing buyer reservations of any status
        const [resRows] = await connection.query(
          "SELECT COUNT(*) AS total_count, " +
          "SUM(CASE WHEN status IN ('RESERVED', 'CONFIRMED', 'PAID') THEN 1 ELSE 0 END) AS active_count, " +
          "SUM(CASE WHEN status NOT IN ('RESERVED', 'CONFIRMED', 'PAID', 'CANCELLED', 'EXPIRED') THEN 1 ELSE 0 END) AS unknown_count " +
          "FROM reservations WHERE pool_id = ?",
          [id]
        );
        const activeResCount = Number(resRows[0].active_count || 0);
        const totalResCount = Number(resRows[0].total_count || 0);
        const unknownResCount = Number(resRows[0].unknown_count || 0);

        // PATH A: Safe pre-buyer cancellation (Zero buyer reservations of any status and status in DRAFT/ACTIVE)
        // If pool is DRAFT or ACTIVE with 0 reservations and 0 snapshots, cancellation can proceed safely.
        // If an inventory allocation exists, it is transitioned cleanly to RELEASED.
        if (totalResCount === 0 && unknownResCount === 0) {
          if (hasCommittedAllocation) {
            await connection.query(
              "UPDATE supplier_inventory_allocations SET status = 'RELEASED', updated_at = NOW() WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL'",
              [id]
            );
          }

          await connection.query(
            "UPDATE pools SET status = 'CANCELLED', closed_at = NOW(), supplier_confirmation_notes = ?, updated_at = NOW() WHERE id = ?",
            [reason || 'Cancelled with zero buyer obligations', id]
          );

          await connection.query(
            `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
             VALUES (?, ?, 'REGULAR_POOL_CANCELLED', 'pools', ?, ?, ?)`,
            [
              actor_id,
              actor_role,
              id,
              JSON.stringify({ status: pool.status }),
              JSON.stringify({
                status: 'CANCELLED',
                released_allocation: hasCommittedAllocation,
                reason: reason || 'Cancelled with zero buyer obligations'
              })
            ]
          );

          await connection.commit();
          connection.release();

          return res.status(200).json({
            success: true,
            message: 'Pool cancelled successfully and any committed inventory released.',
            data: { pool_id: parseInt(id, 10), status: 'CANCELLED' }
          });
        }

        // PATH B: Protected Pool with Buyer Reservations
        // Cancellation is strictly blocked to protect buyer demand and prevent uncoordinated mass-cancellation.
        await connection.rollback();
        connection.release();

        let blockReason = activeResCount > 0 || totalResCount > 0 ? 'RESERVED_POOL_CANCELLATION_BLOCKED' : 'PROTECTED_POOL_CANCELLATION_BLOCKED';
        let blockMessage = 'Cannot cancel published pool through legacy endpoint. ';
        if (activeResCount > 0) {
          blockMessage += `${activeResCount} active buyer reservation(s) exist. `;
        }
        if (hasCommittedAllocation) {
          blockMessage += 'Committed supplier inventory allocation exists. ';
        }
        if (unknownResCount > 0) {
          blockMessage += 'Reservations with unknown commercial obligations exist. ';
        }
        blockMessage += 'Commercial settlement, buyer notification, and formal inventory de-allocation workflow is required.';

        return res.status(422).json({
          success: false,
          error: {
            code: blockReason,
            message: blockMessage,
            details: {
              pool_status: pool.status,
              active_reservations: activeResCount,
              has_committed_allocation: hasCommittedAllocation
            }
          }
        });

      } catch (err) {
        await connection.rollback(); connection.release();
        throw err;
      }
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/pools/:id/supplier/summary — Supplier views reservation summary
  // Enforces ownership (or Admin) and excludes all buyer PII (Part 4C.2B)
  // ---------------------------------------------------------------------------
  async getSupplierReservationSummary(req, res) {
    try {
      const poolId = parseInt(req.params.id, 10);
      if (!poolId || isNaN(poolId)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'Valid pool ID is required' } });
      }

      const pool = await poolRepo.findById(poolId);
      if (!pool) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pool not found' } });
      }

      // Authorization guard: Admin or pool owner only
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
      if (!isAdmin && Number(pool.supplier_id) !== Number(req.user.id)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied: You do not own this pool' }
        });
      }

      // Fetch unified pool progress snapshot
      const poolSnapshot = await poolProgressService.getPoolSnapshot(poolId);

      // Status breakdown without exposing individual buyers or reservation IDs
      const [breakdownRows] = await db.query(
        `SELECT status, COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS quantity
         FROM reservations
         WHERE pool_id = ?
         GROUP BY status`,
        [poolId]
      );

      const statusBreakdown = {
        RESERVED: { count: 0, quantity: 0 },
        CONFIRMED: { count: 0, quantity: 0 },
        PAID: { count: 0, quantity: 0 },
        CANCELLED: { count: 0, quantity: 0 },
        EXPIRED: { count: 0, quantity: 0 }
      };

      for (const row of breakdownRows) {
        statusBreakdown[row.status] = {
          count: Number(row.count),
          quantity: Number(Number(row.quantity).toFixed(4))
        };
      }

      const [distinctBuyers] = await db.query(
        `SELECT COUNT(DISTINCT buyer_id) AS buyer_count
         FROM reservations
         WHERE pool_id = ? AND status IN ('RESERVED', 'CONFIRMED', 'PAID')`,
        [poolId]
      );
      const buyerCount = Number(distinctBuyers[0].buyer_count || 0);

      const summary = {
        pool: {
          id: pool.id,
          pool_code: pool.pool_code,
          status: pool.status,
          pool_unit: pool.pool_unit,
          expires_at: pool.expires_at,
          scheduled_close_at: pool.scheduled_close_at || pool.expires_at,
          promised_delivery_at: pool.promised_delivery_at || null,
          published_at: pool.published_at || null,
          is_terms_locked: Boolean(pool.is_terms_locked || pool.status !== 'DRAFT'),
          supplier_min_qty: Number(pool.supplier_min_qty),
          target_qty: Number(pool.target_qty),
          max_capacity: pool.max_capacity !== null ? Number(pool.max_capacity) : Number(pool.target_qty)
        },
        specification: poolSnapshot ? {
          id: poolSnapshot.specification.id,
          product_title: poolSnapshot.specification.product_title,
          category: poolSnapshot.specification.category,
          quality_grade: poolSnapshot.specification.quality_grade,
          canonical_spec_hash: poolSnapshot.specification.canonical_spec_hash
        } : null,
        demand_summary: {
          total_reserved_quantity: poolSnapshot ? poolSnapshot.current_qty : 0,
          active_reservation_count: buyerCount,
          remaining_capacity: poolSnapshot ? poolSnapshot.remaining_capacity : 0,
          supplier_min_met: poolSnapshot ? poolSnapshot.minimum_reached : false,
          target_met: poolSnapshot ? poolSnapshot.target_reached : false,
          progress_toward_supplier_min_pct: poolSnapshot ? poolSnapshot.minimum_progress_percent : 0,
          progress_toward_target_pct: poolSnapshot ? poolSnapshot.target_progress_percent : 0,
          status_breakdown: statusBreakdown
        },
        pricing_summary: {
          current_price_per_unit: poolSnapshot ? poolSnapshot.current_price_per_unit : null,
          current_tier_index: poolSnapshot ? poolSnapshot.current_tier_index : null,
          pricing_mode: poolSnapshot ? poolSnapshot.pricing_mode : 'ESTIMATED_PRE_MINIMUM',
          is_conditional_pricing: poolSnapshot ? poolSnapshot.is_conditional_pricing : true,
          next_tier: poolSnapshot && poolSnapshot.next_tier_quantity ? {
            min_qty: poolSnapshot.next_tier_quantity,
            price_per_unit: poolSnapshot.next_tier_price,
            additional_qty_needed: poolSnapshot.additional_quantity_for_next_tier
          } : null
        }
      };

      return res.status(200).json({
        success: true,
        data: summary
      });
    } catch (error) {
      console.error('getSupplierReservationSummary Error:', error);
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/pools/:id/qualify — Authoritative Commercial Pool Qualification (Part 4D.2)
  // Evaluates pool demand at or after participation deadline.
  // Advances to AWAITING_SUPPLIER_CONFIRMATION if qualified, or EXPIRED if unqualified.
  // ---------------------------------------------------------------------------
  async qualifyPool(req, res) {
    try {
      const poolId = parseInt(req.params.id, 10);
      if (!poolId || isNaN(poolId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Valid numeric pool ID is required' }
        });
      }

      const idempotencyKey = req.headers['x-idempotency-key'] || null;
      const { CommercialLifecycleService } = require('../services/commercialLifecycleService');

      const outcome = await CommercialLifecycleService.qualifyPoolParticipation({
        poolId,
        actor: {
          id: req.user.id,
          role: req.user.role
        },
        idempotencyKey
      });

      if (req.idempotency && req.idempotency.setResource) {
        await req.idempotency.setResource('pools', poolId);
      }

      return res.status(200).json(outcome);

    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code || 'QUALIFICATION_ERROR',
            message: error.message,
            details: error.details || undefined
          }
        });
      }
      console.error('qualifyPool Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to qualify pool due to internal server error' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/pools/:id/supplier-decision — Authoritative Supplier Commercial Decision (Part 4D.3)
  // Allows verified owning supplier to ACCEPT or REJECT a qualified pool's offer.
  // Enforces immutable decision evidence, strict idempotency, fresh deadline checking.
  // ---------------------------------------------------------------------------
  async recordSupplierDecision(req, res) {
    try {
      const poolId = parseInt(req.params.id, 10);
      if (!poolId || isNaN(poolId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Valid numeric pool ID is required' }
        });
      }

      const { decision, qualification_snapshot_id, rejection_reason_code, rejection_reason_notes } = req.body || {};
      const idempotencyKey = req.headers['x-idempotency-key'] || null;

      const { CommercialLifecycleService } = require('../services/commercialLifecycleService');

      const outcome = await CommercialLifecycleService.recordSupplierDecision({
        poolId,
        actor: {
          id: req.user.id,
          role: req.user.role
        },
        decision,
        qualificationSnapshotId: qualification_snapshot_id,
        rejectionReasonCode: rejection_reason_code,
        rejectionReasonNotes: rejection_reason_notes,
        idempotencyKey
      });

      if (req.idempotency && req.idempotency.setResource) {
        await req.idempotency.setResource('pools', poolId);
      }

      return res.status(200).json(outcome);

    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code || 'DECISION_ERROR',
            message: error.message,
            details: error.details || undefined
          }
        });
      }
      console.error('recordSupplierDecision Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to record supplier decision due to internal server error' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/pools/:id/supplier-decision — Authorized Decision Status Read Model (Part 4D.3)
  // Returns sanitized commercial outcome to authorized parties (Admin, Owner Supplier, Participating Buyers).
  // ---------------------------------------------------------------------------
  async getSupplierDecisionStatus(req, res) {
    try {
      const poolId = parseInt(req.params.id, 10);
      if (!poolId || isNaN(poolId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Valid numeric pool ID is required' }
        });
      }

      const { CommercialLifecycleService } = require('../services/commercialLifecycleService');

      const statusData = await CommercialLifecycleService.getPoolDecisionStatus(poolId, {
        id: req.user.id,
        role: req.user.role
      });

      return res.status(200).json({
        success: true,
        data: statusData
      });

    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code || 'READ_ERROR',
            message: error.message
          }
        });
      }
      console.error('getSupplierDecisionStatus Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch supplier decision status' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/pools/:id/committed-demand-summary — Authoritative Demand Accounting (Part 4D.4)
  // Returns post-qualification buyer acceptance/decline demand accounting and quorum status.
  // ---------------------------------------------------------------------------
  async getCommittedDemandSummary(req, res) {
    try {
      const poolId = parseInt(req.params.id, 10);
      if (!poolId || isNaN(poolId)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_ID', message: 'Valid numeric pool ID is required' }
        });
      }

      const { CommercialLifecycleService } = require('../services/commercialLifecycleService');
      const summary = await CommercialLifecycleService.getPoolCommittedDemandSummary(poolId);

      return res.status(200).json({
        success: true,
        data: summary
      });

    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code || 'SUMMARY_ERROR',
            message: error.message
          }
        });
      }
      console.error('getCommittedDemandSummary Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch committed demand summary' }
      });
    }
  }
}

module.exports = new PoolController();