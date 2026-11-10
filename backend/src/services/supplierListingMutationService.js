// B3: Single authoritative transaction boundary for commercial offer mutations.
// No payment, order, reservation, or published-pool price snapshots are rewritten.
const db = require('../config/db');
const listingRepo = require('../repositories/supplierListingRepo');
const subscriptionEntitlementService = require('./subscriptionEntitlementService');
const exact = require('./exactDecimal');

function invalid(code, message, statusCode = 400) {
  const e = new Error(message);
  e.code = code;
  e.statusCode = statusCode;
  return e;
}
function positiveDecimal(value, field, scale = 4) {
  try {
    const canonical = exact.toCanonical(value, scale);
    if (!exact.exactDecimalGte(canonical, scale === 2 ? '0.01' : '0.0001', scale)) throw new Error('not positive');
    if (canonical.split('.')[0].length > (scale === 2 ? (field === 'price' ? 10 : 8) : 8)) throw new Error('out of range');
    return canonical;
  } catch (_) { throw invalid('INVALID_' + field.toUpperCase(), field + ' must be a valid positive decimal'); }
}
function nonNegativeDecimal(value, field, scale = 4) {
  try {
    const canonical = exact.toCanonical(value, scale);
    if (!exact.exactDecimalGte(canonical, '0', scale) || canonical.split('.')[0].length > (scale === 2 ? 10 : 8)) throw new Error('out of range');
    return canonical;
  } catch (_) { throw invalid('INVALID_' + field.toUpperCase(), field + ' must be a valid non-negative decimal'); }
}

class SupplierListingMutationService {
  async mutate(listingId, actor, payload = {}, { statusOnly = false } = {}) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      // Match creation/publishing lock order: supplier profile first, listing second.
      const [listingOwner] = await conn.query('SELECT supplier_id FROM supplier_listings WHERE id = ?', [listingId]);
      if (!listingOwner.length) throw invalid('NOT_FOUND', 'Supplier listing not found', 404);
      await conn.query('SELECT supplier_id FROM supplier_profiles WHERE supplier_id = ? FOR UPDATE', [listingOwner[0].supplier_id]);
      // The supplier listing lock protects concurrent updates and price-history order.
      const listing = await listingRepo.findById(listingId, conn, true);
      if (!listing) throw invalid('NOT_FOUND', 'Supplier listing not found', 404);
      if (Number(listing.supplier_id) !== Number(actor.id) && actor.role !== 'SUPER_ADMIN') {
        throw invalid('FORBIDDEN', 'You do not own this commercial listing', 403);
      }
      if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw invalid('INVALID_PAYLOAD', 'An update object is required');
      if (statusOnly && Object.keys(payload).some(k => k !== 'status')) throw invalid('INVALID_UPDATE_FIELD', 'Status endpoint accepts status only');

      const allowed = new Set(['available_stock', 'base_unit_price', 'supplier_min_qty', 'buyer_min_qty',
        'delivery_zones', 'delivery_fee_policy', 'fulfilment_lead_time_days', 'notes', 'status', 'price_change_reason']);
      for (const key of Object.keys(payload)) {
        if (!allowed.has(key)) throw invalid('INVALID_UPDATE_FIELD', 'Cannot modify ' + key + ' through commercial offer updates');
      }

      const changes = {};
      if (payload.base_unit_price !== undefined) {
        changes.base_unit_price = positiveDecimal(payload.base_unit_price, 'price', 2);
        // Let MySQL DECIMAL perform division with consistent 4dp HALF_UP rounding.
        if (!Number.isFinite(Number(listing.pack_size)) || Number(listing.pack_size) <= 0) throw invalid('INVALID_PACK_SIZE', 'Underlying pack size is invalid', 409);
        const [rows] = await conn.query('SELECT CAST(ROUND(CAST(? AS DECIMAL(12,2)) / CAST(? AS DECIMAL(12,4)), 4) AS CHAR) AS unit_price', [changes.base_unit_price, String(listing.pack_size)]);
        changes.price_per_base_unit = rows[0].unit_price;
      }
      if (payload.available_stock !== undefined) changes.available_stock = nonNegativeDecimal(payload.available_stock, 'stock', 2);
      if (payload.buyer_min_qty !== undefined) changes.buyer_min_qty = positiveDecimal(payload.buyer_min_qty, 'buyer_min_qty', 2);
      if (payload.supplier_min_qty !== undefined) changes.supplier_min_qty = positiveDecimal(payload.supplier_min_qty, 'supplier_min_qty', 2);
      if (payload.delivery_zones !== undefined) {
        if (!Array.isArray(payload.delivery_zones) || payload.delivery_zones.length === 0 ||
            payload.delivery_zones.length > 40 ||
            payload.delivery_zones.some(z => typeof z !== 'string' || !z.trim() || z.length > 120)) {
          throw invalid('INVALID_DELIVERY_ZONES', 'Provide a non-empty list of valid delivery zones');
        }
        changes.delivery_zones = payload.delivery_zones.map(z => z.trim());
      }
      if (payload.delivery_fee_policy !== undefined) {
        if (typeof payload.delivery_fee_policy !== 'string' || !payload.delivery_fee_policy.trim() || payload.delivery_fee_policy.length > 255) {
          throw invalid('INVALID_DELIVERY_POLICY', 'Unsupported delivery fee policy');
        }
        changes.delivery_fee_policy = payload.delivery_fee_policy;
      }
      if (payload.fulfilment_lead_time_days !== undefined) {
        const days = Number(payload.fulfilment_lead_time_days);
        if (!Number.isSafeInteger(days) || days < 1 || days > 30) throw invalid('INVALID_LEAD_TIME', 'Fulfilment lead time must be 1–30 whole days');
        changes.fulfilment_lead_time_days = days;
      }
      if (payload.notes !== undefined) {
        if (payload.notes !== null && (typeof payload.notes !== 'string' || payload.notes.length > 2000)) throw invalid('INVALID_NOTES', 'Notes must be text under 2000 characters');
        changes.notes = payload.notes;
      }
      if (payload.status !== undefined) {
        if (!['ACTIVE', 'PAUSED', 'OUT_OF_STOCK', 'ARCHIVED'].includes(payload.status)) throw invalid('INVALID_STATUS', 'Unsupported listing status');
        if (listing.status === 'ARCHIVED' && payload.status !== 'ARCHIVED') throw invalid('LISTING_ARCHIVED', 'Archived offer cannot be reactivated', 409);
        changes.status = payload.status;
      }

      const nextStock = changes.available_stock ?? String(listing.available_stock);
      const nextBuyerMin = changes.buyer_min_qty ?? String(listing.buyer_min_qty);
      const nextStatus = changes.status || listing.status;
      if (!exact.exactDecimalGte(nextStock, nextBuyerMin, 2) && nextStatus === 'ACTIVE') {
        throw invalid('INSUFFICIENT_STOCK', 'ACTIVE listing requires stock at least buyer minimum', 409);
      }
      if (changes.status === 'ACTIVE') {
        // Lock profile and validate entitlements before activating. No bypass via status endpoint.
        const [eligible] = await conn.query(
          `SELECT u.role, u.is_verified, u.verification_status AS user_status,
                  sp.verification_status AS profile_status
           FROM users u JOIN supplier_profiles sp ON sp.supplier_id = u.id
           WHERE u.id = ?`, [listing.supplier_id]);
        if (!eligible[0] || eligible[0].role !== 'SUPPLIER' || Number(eligible[0].is_verified) !== 1 ||
            eligible[0].user_status !== 'VERIFIED' || eligible[0].profile_status !== 'VERIFIED') {
          throw invalid('SUPPLIER_NOT_VERIFIED', 'Supplier must be verified before listing activation', 403);
        }
        const [spec] = await conn.query(
          `SELECT ps.approval_status, ps.lifecycle_status, ps.is_active,
                  f.is_active AS family_active, f.approval_status AS family_approval,
                  c.is_active AS category_active, c.approval_status AS category_approval,
                  sku.status AS sku_status, prod.status AS product_status
           FROM product_specifications ps
           LEFT JOIN catalog_product_families f ON f.id = ps.family_id
           LEFT JOIN catalog_categories c ON c.id = ps.category_id
           LEFT JOIN supplier_skus sku ON sku.id = ps.supplier_sku_id
           LEFT JOIN supplier_products prod ON prod.id = ps.supplier_product_id
           WHERE ps.id = ?`, [listing.product_spec_id]);
        const item = spec[0];
        if (!item || Number(item.is_active) !== 1 || item.approval_status !== 'APPROVED' ||
            !['PUBLISHED', 'LEGACY_GLOBAL'].includes(item.lifecycle_status) ||
            !item.family_active || item.family_approval !== 'APPROVED' ||
            !item.category_active || item.category_approval !== 'APPROVED' ||
            (item.sku_status && item.sku_status !== 'PUBLISHED') ||
            (item.product_status && item.product_status !== 'PUBLISHED')) {
          throw invalid('SPECIFICATION_INELIGIBLE', 'Product/SKU and its canonical taxonomy must be published and active', 409);
        }
        await subscriptionEntitlementService.assertCanPublishInFamily(listing.supplier_id, Number(listing.family_id), conn);
      }

      // Existing COMMITTED/PENDING inventory allocations cannot be invalidated by stock reduction.
      if (changes.available_stock !== undefined) {
        const [held] = await conn.query(
          `SELECT COALESCE(SUM(allocated_qty), 0) AS qty FROM supplier_inventory_allocations
           WHERE supplier_listing_id = ? AND status IN ('PENDING', 'COMMITTED')`, [listingId]);
        if (!exact.exactDecimalGte(changes.available_stock, String(held[0].qty), 4)) {
          throw invalid('STOCK_BELOW_ALLOCATIONS', 'Stock cannot fall below outstanding allocated quantity', 409);
        }
      }

      // Prevent commercial conditions being silently edited out from underneath ongoing pools.
      const contractualFields = ['supplier_min_qty', 'buyer_min_qty', 'delivery_zones', 'delivery_fee_policy', 'fulfilment_lead_time_days'];
      if (contractualFields.some(k => changes[k] !== undefined) || changes.status === 'ARCHIVED') {
        const [pools] = await conn.query(
          `SELECT id FROM pools WHERE supplier_listing_id = ?
           AND status NOT IN ('CANCELLED','EXPIRED','COMPLETED','DELIVERED','REJECTED')
           LIMIT 1`, [listingId]);
        if (pools.length) throw invalid('ACTIVE_POOL_LISTING_LOCKED', 'Resolve related open pools before changing contractual terms or archiving listing', 409);
      }
      if (listing.status === 'ARCHIVED' && Object.keys(changes).length) {
        throw invalid('LISTING_ARCHIVED', 'Archived offer is immutable', 409);
      }

      if (changes.base_unit_price !== undefined &&
          !exact.exactDecimalEquals(changes.base_unit_price, listing.base_unit_price, 2)) {
        await listingRepo.recordPriceChange(listingId, String(listing.base_unit_price),
          changes.base_unit_price, actor.id, payload.price_change_reason || 'Supplier price adjustment', conn);
      }
      if (Object.keys(changes).length) await listingRepo.update(listingId, changes, conn);
      await conn.commit();
      return await listingRepo.findById(listingId);
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally { conn.release(); }
  }
}
module.exports = new SupplierListingMutationService();
