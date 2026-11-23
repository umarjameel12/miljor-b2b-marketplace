'use strict';

const crypto = require('node:crypto');
const db = require('../config/db');
const exactDecimal = require('./exactDecimal');
const supplierEligibilityPolicy = require('./supplierEligibilityPolicy');
const ucpNotifications = require('./ucpTransactionalNotifications');

const VALID_SKU_MATCH_TYPES = new Set(['EXACT_SKU', 'EQUIVALENT_SKU_REQUIRES_CONSENT']);
const VALID_COST_RESPONSIBILITIES = new Set([
  'SUPPLIER_CARRIER_FAILURE',
  'BUYER_REQUESTED',
  'PLATFORM_PROVIDER_FAULT',
  'DISPUTED_RESPONSIBILITY'
]);

function fail(code, message, statusCode = 409) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

function posId(val, code = 'INVALID_ID') {
  if (!/^[1-9]\d*$/.test(String(val)) || !Number.isSafeInteger(Number(val))) {
    throw fail(code, 'Valid positive integer identifier required.', 400);
  }
  return Number(val);
}

function requireKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9:_-]{8,120}$/.test(key.trim())) {
    throw fail('IDEMPOTENCY_KEY_REQUIRED', 'A valid X-Idempotency-Key header (8-120 chars) is required.', 400);
  }
  return key.trim();
}

function normalizeSqlDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw fail('INVALID_DATETIME', 'Invalid date/time value.', 400);
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  const str = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str) ? str.replace(' ', 'T') + 'Z' : str;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) throw fail('INVALID_DATETIME', 'Invalid date/time value.', 400);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function sha256Hex(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

class SupplierReplacementService {
  constructor({ database = db, notifications = ucpNotifications } = {}) {
    this.db = database;
    this.notifications = notifications;
  }

  async _tx(work) {
    const conn = await this.db.getConnection();
    let committed = false;
    try {
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await conn.beginTransaction();
      const res = await work(conn, async () => {
        await conn.commit();
        committed = true;
      });
      if (!committed) {
        await conn.commit();
        committed = true;
      }
      return res;
    } catch (err) {
      if (!committed) await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  _assertAdmin(actor) {
    if (!actor || !actor.id || !['ADMIN', 'SUPER_ADMIN'].includes(actor.role)) {
      throw fail('FORBIDDEN', 'Only authorized administrators can propose replacement quotes.', 403);
    }
    return posId(actor.id, 'INVALID_ACTOR_ID');
  }

  async _assertVerifiedSupplier(conn, supplierId) {
    const [rows] = await conn.query(
      `SELECT u.id, u.role, u.is_verified, u.verification_status,
              sp.verification_status AS profile_verification_status
       FROM users u
       LEFT JOIN supplier_profiles sp ON sp.supplier_id = u.id
       WHERE u.id = ? FOR UPDATE`,
      [posId(supplierId, 'INVALID_SUPPLIER_ID')]
    );
    if (!rows.length) throw fail('REPLACEMENT_SUPPLIER_NOT_FOUND', 'Replacement supplier not found.', 404);
    const elig = supplierEligibilityPolicy.evaluateSupplierEligibility(rows[0]);
    if (!elig.eligible) {
      throw fail('REPLACEMENT_SUPPLIER_NOT_VERIFIED', elig.reason || 'Replacement supplier is not verified.', 422);
    }
    return rows[0];
  }

  async _lockAndValidateListing(conn, { listingId, supplierId, requiredQtyStr }) {
    const [listings] = await conn.query(
      `SELECT sl.*, ps.is_active AS spec_active, ps.approval_status AS spec_approval,
              sk.status AS sku_status, pr.status AS product_status,
              fam.is_active AS family_active, fam.approval_status AS family_approval,
              cat.is_active AS category_active, cat.approval_status AS category_approval
       FROM supplier_listings sl
       JOIN product_specifications ps ON ps.id = sl.product_spec_id
       LEFT JOIN supplier_skus sk ON sk.id = sl.supplier_sku_id
       LEFT JOIN supplier_products pr ON pr.id = sl.supplier_product_id
       JOIN catalog_product_families fam ON fam.id = ps.family_id
       JOIN catalog_categories cat ON cat.id = ps.category_id
       WHERE sl.id = ?
       FOR UPDATE`,
      [listingId]
    );
    if (!listings.length) throw fail('LISTING_NOT_FOUND', 'Replacement supplier listing not found.', 404);
    const listing = listings[0];
    if (Number(listing.supplier_id) !== Number(supplierId) || listing.status !== 'ACTIVE') {
      throw fail('REPLACEMENT_LISTING_INELIGIBLE', 'Replacement listing is not active for the replacement supplier.', 422);
    }
    if (!listing.spec_active || listing.spec_approval !== 'APPROVED' || !listing.family_active || !listing.category_active) {
      throw fail('REPLACEMENT_SKU_INELIGIBLE', 'Replacement listing specification or catalog family is inactive/unapproved.', 422);
    }
    if ((listing.sku_status && listing.sku_status !== 'PUBLISHED') || (listing.product_status && listing.product_status !== 'PUBLISHED')) {
      throw fail('REPLACEMENT_SKU_INELIGIBLE', 'Replacement supplier SKU/product is not published.', 422);
    }
    const availStr = exactDecimal.toCanonical(listing.available_stock || 0, 4);
    if (!exactDecimal.exactDecimalGte(availStr, requiredQtyStr, 4)) {
      throw fail('INSUFFICIENT_REPLACEMENT_STOCK', 'Replacement supplier listing lacks sufficient available stock.', 422);
    }
    return listing;
  }

  async _computeOutstandingObligation(conn, origOrder) {
    const [stops] = await conn.query(
      'SELECT id, status, disputed_qty FROM delivery_run_stops WHERE order_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
      [origOrder.id]
    );
    let baseEligibleStr = exactDecimal.toCanonical(origOrder.total_qty, 4);
    let isPartialObligation = false;
    if (stops.length > 0) {
      const stop = stops[0];
      if (stop.status === 'BUYER_CONFIRMED') {
        baseEligibleStr = '0.0000';
      } else if (stop.status === 'PARTIAL_CONFIRMED') {
        baseEligibleStr = exactDecimal.toCanonical(stop.disputed_qty || 0, 4);
        isPartialObligation = true;
      }
    }

    const [activeRepls] = await conn.query(
      `SELECT COALESCE(SUM(quantity), 0) AS replaced_qty
       FROM supplier_replacement_quotes
       WHERE original_order_id = ? AND status IN ('BUYER_ACCEPTED', 'EXECUTED')
       FOR UPDATE`,
      [origOrder.id]
    );
    const replacedStr = exactDecimal.toCanonical(activeRepls[0]?.replaced_qty || 0, 4);
    const remainingNum = Number(baseEligibleStr) - Number(replacedStr);
    const outstandingStr = remainingNum > 0 ? exactDecimal.toCanonical(remainingNum.toFixed(4), 4) : '0.0000';
    return { baseEligibleStr, replacedStr, outstandingStr, isPartialObligation };
  }

  async proposeReplacementQuote({
    actor,
    originalOrderId,
    replacementSupplierId,
    replacementListingId,
    quantity = null,
    skuMatchType = 'EXACT_SKU',
    replacementSkuSnapshot = {},
    newUnitPricePkr,
    newDeliveryFeePkr,
    costResponsibility = 'SUPPLIER_CARRIER_FAILURE',
    deliveryTerms = {},
    proposedEtaAt,
    expiresAt,
    reason,
    idempotencyKey
  }) {
    const adminId = this._assertAdmin(actor);
    const key = requireKey(idempotencyKey);
    const orderId = posId(originalOrderId, 'INVALID_ORDER_ID');
    const newSupId = posId(replacementSupplierId, 'INVALID_SUPPLIER_ID');
    if (!replacementListingId) {
      throw fail('REPLACEMENT_LISTING_REQUIRED', 'replacement_listing_id is mandatory for replacement quotes.', 422);
    }
    const listingId = posId(replacementListingId, 'INVALID_LISTING_ID');
    if (!VALID_SKU_MATCH_TYPES.has(skuMatchType)) {
      throw fail('INVALID_SKU_MATCH_TYPE', `Unsupported sku_match_type '${skuMatchType}'.`, 400);
    }
    if (!VALID_COST_RESPONSIBILITIES.has(costResponsibility)) {
      throw fail('INVALID_COST_RESPONSIBILITY', `Unsupported cost_responsibility '${costResponsibility}'.`, 400);
    }
    const cleanReason = String(reason || '').trim();
    if (cleanReason.length < 5) throw fail('REASON_REQUIRED', 'Meaningful replacement reason is required.', 400);
    const etaSql = normalizeSqlDateTime(proposedEtaAt);
    const expSql = normalizeSqlDateTime(expiresAt);
    if (!etaSql || !expSql) throw fail('ETA_AND_EXPIRY_REQUIRED', 'proposed_eta_at and expires_at are required.', 400);

    return this._tx(async (conn) => {
      const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
      if (!orders.length) throw fail('ORDER_NOT_FOUND', 'Original order not found.', 404);
      const orig = orders[0];

      if (Number(orig.supplier_id) === newSupId) {
        throw fail('SAME_SUPPLIER_NOT_ALLOWED', 'Replacement supplier must differ from original supplier.', 422);
      }

      const [prior] = await conn.query(
        'SELECT * FROM supplier_replacement_quotes WHERE original_order_id = ? AND idempotency_key = ? FOR UPDATE',
        [orderId, key]
      );
      if (prior.length > 0) {
        return { is_replay: true, quote: prior[0] };
      }

      const [failedStops] = await conn.query(
        "SELECT id FROM delivery_run_stops WHERE order_id = ? AND status IN ('FAILED', 'REATTEMPT_SCHEDULED', 'PARTIAL_CONFIRMED') LIMIT 1",
        [orderId]
      );
      let poolFailed = false;
      if (orig.pool_id) {
        const [pools] = await conn.query('SELECT status FROM pools WHERE id = ?', [orig.pool_id]);
        poolFailed = pools[0]?.status === 'SUPPLIER_FAILED';
      }
      if (orig.fulfillment_status !== 'EXCEPTION' && orig.order_status !== 'DISPUTED' && !failedStops.length && !poolFailed) {
        throw fail('REPLACEMENT_NOT_ELIGIBLE', 'Original order must be in a supplier-failed, disputed, or delivery-exception state.', 422);
      }

      const [[clock]] = await conn.query('SELECT (? > UTC_TIMESTAMP()) AS valid_exp', [expSql]);
      if (Number(clock.valid_exp) !== 1) {
        throw fail('INVALID_QUOTE_EXPIRY', 'Replacement quote expires_at must be in the future.', 422);
      }

      // Compute outstanding eligible obligation (e.g. 20 units out of 100 ordered / 80 accepted)
      const { outstandingStr, isPartialObligation } = await this._computeOutstandingObligation(conn, orig);
      if (!exactDecimal.exactDecimalGte(outstandingStr, '0.0001', 4)) {
        throw fail('NO_OUTSTANDING_REPLACEMENT_OBLIGATION', 'No outstanding eligible quantity remains for replacement.', 422);
      }

      const qtyStr = quantity != null ? exactDecimal.toCanonical(quantity, 4) : outstandingStr;
      if (qtyStr.startsWith('-') || exactDecimal.exactDecimalEquals(qtyStr, '0', 4)) {
        throw fail('INVALID_REPLACEMENT_QUANTITY', 'Replacement quantity must be positive.', 422);
      }
      if (!exactDecimal.exactDecimalGte(outstandingStr, qtyStr, 4)) {
        throw fail(
          'REPLACEMENT_QUANTITY_EXCEEDS_OBLIGATION',
          `Requested replacement quantity (${qtyStr}) exceeds outstanding eligible obligation (${outstandingStr}).`,
          422
        );
      }

      await this._assertVerifiedSupplier(conn, newSupId);
      const listing = await this._lockAndValidateListing(conn, { listingId, supplierId: newSupId, requiredQtyStr: qtyStr });

      const oldUnitStr = exactDecimal.toCanonical(orig.unit_price, 2);
      const newUnitStr = exactDecimal.toCanonical(newUnitPricePkr ?? oldUnitStr, 2);
      const oldFeeStr = isPartialObligation ? '0.00' : exactDecimal.toCanonical(orig.delivery_fee || 0, 2);
      const newFeeStr = exactDecimal.toCanonical(newDeliveryFeePkr ?? oldFeeStr, 2);
      if (newUnitStr.startsWith('-') || newFeeStr.startsWith('-')) {
        throw fail('INVALID_PRICE', 'Unit price and delivery fee cannot be negative.', 422);
      }

      const oldSubStr = exactDecimal.exactMultiplyRound(qtyStr, oldUnitStr, 2);
      const oldTotalStr = exactDecimal.exactDecimalSum([oldSubStr, oldFeeStr], 2);
      const newSubStr = exactDecimal.exactMultiplyRound(qtyStr, newUnitStr, 2);
      const newTotalStr = exactDecimal.exactDecimalSum([newSubStr, newFeeStr], 2);
      const diffNum = Number(newTotalStr) - Number(oldTotalStr);
      const diffStr = exactDecimal.toCanonical(diffNum.toFixed(2), 2);

      if (costResponsibility === 'SUPPLIER_CARRIER_FAILURE' && diffNum > 0) {
        throw fail('BUYER_EXTRA_CHARGE_PROHIBITED', 'Supplier/carrier failure replacement cannot impose an extra buyer charge.', 422);
      }
      if (['PLATFORM_PROVIDER_FAULT', 'DISPUTED_RESPONSIBILITY'].includes(costResponsibility) && diffNum !== 0) {
        throw fail('SUPPORT_RESOLUTION_REQUIRED', 'Platform/provider fault or disputed responsibility cannot auto-charge buyer or invent subsidy.', 422);
      }

      const [verRows] = await conn.query(
        'SELECT COALESCE(MAX(quote_version), 0) AS max_ver FROM supplier_replacement_quotes WHERE original_order_id = ? FOR UPDATE',
        [orderId]
      );
      const nextVer = Number(verRows[0].max_ver) + 1;

      await conn.query(
        "UPDATE supplier_replacement_quotes SET status = 'SUPERSEDED' WHERE original_order_id = ? AND status = 'PENDING_BUYER_CONSENT'",
        [orderId]
      );

      const origSkuSnap = {
        order_code: orig.order_code,
        pool_id: orig.pool_id || null,
        total_qty: exactDecimal.toCanonical(orig.total_qty, 4),
        eligible_qty: qtyStr,
        unit_price: oldUnitStr
      };
      const newSkuSnap = {
        ...(replacementSkuSnapshot || {}),
        sku_match_type: skuMatchType,
        replacement_listing_id: listingId,
        product_spec_id: listing.product_spec_id,
        supplier_sku_id: listing.supplier_sku_id || null,
        quantity: qtyStr,
        unit_price: newUnitStr
      };

      const quoteHash = sha256Hex({
        original_order_id: orderId,
        quote_version: nextVer,
        replacement_supplier_id: newSupId,
        replacement_listing_id: listingId,
        sku_match_type: skuMatchType,
        replacement_sku_snapshot: newSkuSnap,
        quantity: qtyStr,
        old_total_pkr: oldTotalStr,
        new_total_pkr: newTotalStr,
        delivery_terms: deliveryTerms || {},
        proposed_eta_at: etaSql,
        expires_at: expSql
      });

      const quoteCode = `RPL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const [ins] = await conn.query(
        `INSERT INTO supplier_replacement_quotes (
          quote_code, original_order_id, original_supplier_id, replacement_supplier_id,
          buyer_id, pool_id, replacement_listing_id, quote_version, sku_match_type,
          original_sku_snapshot_json, replacement_sku_snapshot_json, quantity,
          old_unit_price_pkr, new_unit_price_pkr, old_delivery_fee_pkr, new_delivery_fee_pkr,
          old_total_pkr, new_total_pkr, charge_diff_pkr, cost_responsibility,
          delivery_terms_json, proposed_eta_at, expires_at, quote_hash, status,
          supplier_offer_status, initiated_by, initiated_role, reason, idempotency_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_BUYER_CONSENT', 'PENDING_SUPPLIER_ACCEPTANCE', ?, ?, ?, ?)`,
        [
          quoteCode, orderId, orig.supplier_id, newSupId, orig.buyer_id, orig.pool_id || null,
          listingId, nextVer, skuMatchType, JSON.stringify(origSkuSnap), JSON.stringify(newSkuSnap),
          qtyStr, oldUnitStr, newUnitStr, oldFeeStr, newFeeStr, oldTotalStr, newTotalStr,
          diffStr, costResponsibility, JSON.stringify(deliveryTerms || {}), etaSql, expSql,
          quoteHash, adminId, actor.role, cleanReason, key
        ]
      );

      const [created] = await conn.query('SELECT * FROM supplier_replacement_quotes WHERE id = ?', [ins.insertId]);

      await this.notifications.recordInAppOnConnection(conn, {
        type: 'UCP.CONFIRMATION_REQUIRED',
        aggregateId: `replacement-quote-${ins.insertId}`,
        aggregateVersion: nextVer,
        transitionId: `repl-sup-req-${ins.insertId}`,
        recipients: [{ userId: newSupId, role: 'SUPPLIER' }],
        title: 'Replacement supply request requires your acceptance',
        message: `Replacement quote ${quoteCode} (v${nextVer}) for ${qtyStr} units requires your supplier confirmation.`,
        payload: { order_id: orderId, status: 'PENDING_SUPPLIER_ACCEPTANCE', notification_path: '/orders' },
        actorId: adminId,
        actorRole: actor.role,
        schemaVersion: 2
      });

      return { is_replay: false, quote: created[0] };
    });
  }

  /**
   * Authorized replacement supplier explicitly accepts or declines the replacement quote terms/listing.
   */
  async supplierAcceptQuote({ actor, quoteId, quoteVersion, quoteHash, decision = 'ACCEPTED', idempotencyKey }) {
    if (!actor || !actor.id || actor.role !== 'SUPPLIER') {
      throw fail('UNAUTHORIZED_ROLE', 'Only the assigned replacement supplier can accept or decline this offer.', 403);
    }
    const key = requireKey(idempotencyKey);
    const id = posId(quoteId, 'INVALID_QUOTE_ID');
    if (!['ACCEPTED', 'DECLINED'].includes(decision)) {
      throw fail('INVALID_DECISION', "decision must be 'ACCEPTED' or 'DECLINED'.", 400);
    }

    return this._tx(async (conn, commitNow) => {
      const [rows] = await conn.query('SELECT * FROM supplier_replacement_quotes WHERE id = ? FOR UPDATE', [id]);
      if (!rows.length) throw fail('REPLACEMENT_QUOTE_NOT_FOUND', 'Replacement quote not found.', 404);
      const q = rows[0];

      if (Number(q.replacement_supplier_id) !== Number(actor.id)) {
        throw fail('FORBIDDEN', 'You are not the assigned replacement supplier for this quote.', 403);
      }
      if (q.supplier_offer_idempotency_key === key) {
        return { is_replay: true, quote: q };
      }
      if (q.supplier_offer_status !== 'PENDING_SUPPLIER_ACCEPTANCE' || q.status !== 'PENDING_BUYER_CONSENT') {
        throw fail('SUPPLIER_OFFER_ALREADY_DECIDED', `Supplier offer is already '${q.supplier_offer_status}'.`, 409);
      }
      if (Number(quoteVersion) !== Number(q.quote_version) || String(quoteHash || '') !== String(q.quote_hash)) {
        throw fail('QUOTE_VERSION_MISMATCH', 'Stale or mismatched replacement quote version/hash.', 409);
      }

      const [[clock]] = await conn.query('SELECT (expires_at <= UTC_TIMESTAMP()) AS expired FROM supplier_replacement_quotes WHERE id = ?', [id]);
      if (Number(clock.expired) === 1) {
        await conn.query("UPDATE supplier_replacement_quotes SET status = 'EXPIRED', decided_at = UTC_TIMESTAMP() WHERE id = ?", [id]);
        await commitNow();
        throw fail('REPLACEMENT_QUOTE_EXPIRED', 'Replacement quote has expired.', 409);
      }

      await this._assertVerifiedSupplier(conn, actor.id);
      if (decision === 'ACCEPTED') {
        const reqQtyStr = exactDecimal.toCanonical(q.quantity, 4);
        await this._lockAndValidateListing(conn, {
          listingId: posId(q.replacement_listing_id, 'REPLACEMENT_LISTING_REQUIRED'),
          supplierId: actor.id,
          requiredQtyStr: reqQtyStr
        });
      }

      const nextOfferStatus = decision === 'ACCEPTED' ? 'SUPPLIER_ACCEPTED' : 'SUPPLIER_DECLINED';
      const offerHash = sha256Hex({
        quote_id: q.id,
        quote_version: q.quote_version,
        quote_hash: q.quote_hash,
        replacement_supplier_id: q.replacement_supplier_id,
        replacement_listing_id: q.replacement_listing_id,
        quantity: String(q.quantity),
        new_total_pkr: String(q.new_total_pkr),
        decision: nextOfferStatus
      });

      await conn.query(
        `UPDATE supplier_replacement_quotes
         SET supplier_offer_status = ?, supplier_accepted_by = ?, supplier_accepted_at = UTC_TIMESTAMP(),
             supplier_offer_hash = ?, supplier_offer_idempotency_key = ?
         WHERE id = ?`,
        [nextOfferStatus, actor.id, offerHash, key, id]
      );

      const [updated] = await conn.query('SELECT * FROM supplier_replacement_quotes WHERE id = ?', [id]);

      if (decision === 'ACCEPTED') {
        await this.notifications.recordInAppOnConnection(conn, {
          type: 'UCP.CONFIRMATION_REQUIRED',
          aggregateId: `replacement-quote-${id}`,
          aggregateVersion: Number(q.quote_version),
          transitionId: `repl-buyer-req-${id}`,
          recipients: [{ userId: Number(q.buyer_id), role: 'BUYER' }],
          title: 'Replacement supplier quote ready for your consent',
          message: `Replacement quote ${q.quote_code} (v${q.quote_version}) has been confirmed by the replacement supplier and awaits your decision.`,
          payload: { order_id: Number(q.original_order_id), status: 'PENDING_BUYER_CONSENT', notification_path: '/orders' },
          actorId: Number(actor.id),
          actorRole: 'SUPPLIER',
          schemaVersion: 2
        });
      }

      return { is_replay: false, quote: updated[0] };
    });
  }

  async decideReplacementQuote({ actor, quoteId, quoteVersion, quoteHash, decision, idempotencyKey }) {
    if (!actor || !actor.id || actor.role !== 'BUYER') {
      throw fail('UNAUTHORIZED_ROLE', 'Only the owning buyer can accept or decline a replacement quote.', 403);
    }
    const key = requireKey(idempotencyKey);
    const id = posId(quoteId, 'INVALID_QUOTE_ID');
    if (!['ACCEPTED', 'DECLINED'].includes(decision)) {
      throw fail('INVALID_DECISION', "decision must be 'ACCEPTED' or 'DECLINED'.", 400);
    }

    return this._tx(async (conn, commitNow) => {
      const [rows] = await conn.query('SELECT * FROM supplier_replacement_quotes WHERE id = ? FOR UPDATE', [id]);
      if (!rows.length) throw fail('REPLACEMENT_QUOTE_NOT_FOUND', 'Replacement quote not found.', 404);
      const q = rows[0];

      if (Number(q.buyer_id) !== Number(actor.id)) {
        throw fail('FORBIDDEN', 'You do not own this replacement quote.', 403);
      }
      if (q.decision_idempotency_key === key) {
        return { is_replay: true, quote: q };
      }
      if (q.status !== 'PENDING_BUYER_CONSENT') {
        throw fail('REPLACEMENT_QUOTE_ALREADY_DECIDED', `Quote is already in '${q.status}' status.`, 409);
      }
      if (decision === 'ACCEPTED' && q.supplier_offer_status !== 'SUPPLIER_ACCEPTED') {
        throw fail('SUPPLIER_OFFER_ACCEPTANCE_REQUIRED', 'Replacement supplier must accept this quote before buyer consent.', 409);
      }
      if (Number(quoteVersion) !== Number(q.quote_version)) {
        throw fail('QUOTE_VERSION_MISMATCH', 'Stale or mismatched replacement quote version.', 409);
      }
      if (String(quoteHash || '') !== String(q.quote_hash)) {
        throw fail('QUOTE_HASH_MISMATCH', 'Replacement quote hash does not match.', 409);
      }

      const [[clock]] = await conn.query('SELECT (expires_at <= UTC_TIMESTAMP()) AS expired FROM supplier_replacement_quotes WHERE id = ?', [id]);
      if (Number(clock.expired) === 1) {
        await conn.query("UPDATE supplier_replacement_quotes SET status = 'EXPIRED', decided_at = UTC_TIMESTAMP() WHERE id = ?", [id]);
        await commitNow();
        throw fail('REPLACEMENT_QUOTE_EXPIRED', 'Replacement quote has expired.', 409);
      }

      const nextStatus = decision === 'ACCEPTED' ? 'BUYER_ACCEPTED' : 'BUYER_DECLINED';
      await conn.query(
        `UPDATE supplier_replacement_quotes
         SET status = ?, decided_by = ?, decided_at = UTC_TIMESTAMP(), decision_idempotency_key = ?
         WHERE id = ?`,
        [nextStatus, actor.id, key, id]
      );

      const [updated] = await conn.query('SELECT * FROM supplier_replacement_quotes WHERE id = ?', [id]);
      return { is_replay: false, quote: updated[0] };
    });
  }

  async executeReplacementQuote({ actor, quoteId, idempotencyKey }) {
    const key = requireKey(idempotencyKey);
    const id = posId(quoteId, 'INVALID_QUOTE_ID');
    if (!actor || !actor.id || !['ADMIN', 'SUPER_ADMIN', 'BUYER'].includes(actor.role)) {
      throw fail('FORBIDDEN', 'Unauthorized role for replacement execution.', 403);
    }

    return this._tx(async (conn) => {
      const [rows] = await conn.query('SELECT * FROM supplier_replacement_quotes WHERE id = ? FOR UPDATE', [id]);
      if (!rows.length) throw fail('REPLACEMENT_QUOTE_NOT_FOUND', 'Replacement quote not found.', 404);
      const q = rows[0];

      if (actor.role === 'BUYER' && Number(q.buyer_id) !== Number(actor.id)) {
        throw fail('FORBIDDEN', 'You do not own this replacement quote.', 403);
      }
      if (q.execution_idempotency_key === key && q.status === 'EXECUTED') {
        const [links] = await conn.query('SELECT * FROM order_replacement_links WHERE replacement_quote_id = ?', [id]);
        return { is_replay: true, quote: q, link: links[0] || null };
      }
      if (q.supplier_offer_status !== 'SUPPLIER_ACCEPTED' || !q.supplier_offer_hash) {
        throw fail('SUPPLIER_OFFER_ACCEPTANCE_REQUIRED', 'Replacement supplier acceptance is required before execution.', 409);
      }
      if (q.status !== 'BUYER_ACCEPTED') {
        throw fail('BUYER_CONSENT_REQUIRED', `Replacement execution requires BUYER_ACCEPTED status (current: '${q.status}').`, 409);
      }
      if (!q.replacement_listing_id) {
        throw fail('REPLACEMENT_LISTING_REQUIRED', 'Replacement listing binding is mandatory for execution.', 422);
      }

      const [[clock]] = await conn.query('SELECT (expires_at <= UTC_TIMESTAMP()) AS expired FROM supplier_replacement_quotes WHERE id = ?', [id]);
      if (Number(clock.expired) === 1) {
        throw fail('REPLACEMENT_QUOTE_EXPIRED', 'Replacement quote expired before execution.', 409);
      }

      const [origRows] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [q.original_order_id]);
      const orig = origRows[0];

      // Recompute outstanding obligation excluding THIS quote's own BUYER_ACCEPTED status
      const [stops] = await conn.query(
        'SELECT status, disputed_qty FROM delivery_run_stops WHERE order_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [orig.id]
      );
      let baseEligibleStr = exactDecimal.toCanonical(orig.total_qty, 4);
      if (stops.length > 0 && stops[0].status === 'PARTIAL_CONFIRMED') {
        baseEligibleStr = exactDecimal.toCanonical(stops[0].disputed_qty || 0, 4);
      } else if (stops.length > 0 && stops[0].status === 'BUYER_CONFIRMED') {
        baseEligibleStr = '0.0000';
      }
      const [execRows] = await conn.query(
        "SELECT COALESCE(SUM(quantity), 0) AS exec_qty FROM supplier_replacement_quotes WHERE original_order_id = ? AND status = 'EXECUTED' FOR UPDATE",
        [orig.id]
      );
      const remainingNum = Number(baseEligibleStr) - Number(execRows[0]?.exec_qty || 0);
      const reqQtyStr = exactDecimal.toCanonical(q.quantity, 4);
      if (remainingNum <= 0 || Number(reqQtyStr) > remainingNum) {
        throw fail('REPLACEMENT_QUANTITY_EXCEEDS_OBLIGATION', 'Replacement quantity exceeds remaining eligible obligation.', 409);
      }

      await this._assertVerifiedSupplier(conn, q.replacement_supplier_id);
      const listing = await this._lockAndValidateListing(conn, {
        listingId: posId(q.replacement_listing_id, 'REPLACEMENT_LISTING_REQUIRED'),
        supplierId: q.replacement_supplier_id,
        requiredQtyStr: reqQtyStr
      });

      await conn.query(
        'UPDATE supplier_listings SET available_stock = available_stock - ? WHERE id = ?',
        [reqQtyStr, listing.id]
      );

      const replOrderCode = `ORD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const newSub = exactDecimal.exactMultiplyRound(reqQtyStr, exactDecimal.toCanonical(q.new_unit_price_pkr, 2), 2);
      const [insOrder] = await conn.query(
        `INSERT INTO orders (
          order_code, buyer_id, supplier_id, total_qty, unit_price,
          subtotal_amount, delivery_fee, buyer_platform_fee, total_amount,
          currency, delivery_type, delivery_address, order_status, payment_status, fulfillment_status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?, ?, ?, 'AWAITING_PAYMENT', 'AWAITING_PAYMENT', 'UNPAID', ?)`,
        [
          replOrderCode,
          orig.buyer_id,
          q.replacement_supplier_id,
          reqQtyStr,
          q.new_unit_price_pkr,
          newSub,
          q.new_delivery_fee_pkr,
          q.new_total_pkr,
          orig.currency || 'PKR',
          orig.delivery_type,
          orig.delivery_address,
          `Replacement for order ${orig.order_code} via quote ${q.quote_code}`
        ]
      );
      const replOrderId = insOrder.insertId;

      await conn.query(
        `INSERT INTO order_replacement_links (original_order_id, replacement_order_id, replacement_quote_id, link_status, evidence_json)
         VALUES (?, ?, ?, 'CREATED_AWAITING_PAYMENT', ?)`,
        [
          orig.id,
          replOrderId,
          q.id,
          JSON.stringify({
            quote_code: q.quote_code,
            quote_version: q.quote_version,
            quote_hash: q.quote_hash,
            supplier_offer_hash: q.supplier_offer_hash,
            replacement_listing_id: listing.id,
            original_order_code: orig.order_code,
            replacement_order_code: replOrderCode,
            quantity: reqQtyStr,
            external_money_movement: false
          })
        ]
      );

      await conn.query(
        `UPDATE supplier_replacement_quotes
         SET status = 'EXECUTED', replacement_order_id = ?, executed_at = UTC_TIMESTAMP(), execution_idempotency_key = ?
         WHERE id = ?`,
        [replOrderId, key, id]
      );

      const [updated] = await conn.query('SELECT * FROM supplier_replacement_quotes WHERE id = ?', [id]);
      const [links] = await conn.query('SELECT * FROM order_replacement_links WHERE replacement_quote_id = ?', [id]);

      await this.notifications.recordInAppOnConnection(conn, {
        type: 'UCP.ORDER_CONFIRMED',
        aggregateId: `replacement-order-${replOrderId}`,
        aggregateVersion: Number(q.quote_version),
        transitionId: `repl-exec-${id}-${key}`,
        recipients: [
          { userId: Number(q.buyer_id), role: 'BUYER' },
          { userId: Number(q.replacement_supplier_id), role: 'SUPPLIER' }
        ],
        title: 'Replacement order created (awaiting payment)',
        message: `Replacement order ${replOrderCode} for ${orig.order_code} (${reqQtyStr} units) is created in AWAITING_PAYMENT.`,
        payload: { order_id: replOrderId, status: 'AWAITING_PAYMENT', notification_path: '/orders' },
        actorId: Number(actor.id),
        actorRole: actor.role,
        schemaVersion: 2
      });

      return { is_replay: false, quote: updated[0], link: links[0], replacement_order_id: replOrderId, replacement_order_code: replOrderCode };
    });
  }

  async getOrderReplacements({ actor, orderId }) {
    const id = posId(orderId, 'INVALID_ORDER_ID');
    const conn = await this.db.getConnection();
    try {
      const [orders] = await conn.query('SELECT id, buyer_id, supplier_id FROM orders WHERE id = ?', [id]);
      if (!orders.length) throw fail('ORDER_NOT_FOUND', 'Order not found.', 404);
      const ord = orders[0];
      if (actor.role === 'BUYER' && Number(ord.buyer_id) !== Number(actor.id)) throw fail('FORBIDDEN', 'Access denied.', 403);
      if (actor.role === 'SUPPLIER' && Number(ord.supplier_id) !== Number(actor.id)) throw fail('FORBIDDEN', 'Access denied.', 403);

      const [quotes] = await conn.query(
        'SELECT * FROM supplier_replacement_quotes WHERE original_order_id = ? ORDER BY quote_version DESC',
        [id]
      );
      const [links] = await conn.query(
        'SELECT * FROM order_replacement_links WHERE original_order_id = ? ORDER BY id DESC',
        [id]
      );
      return { quotes, links };
    } finally {
      conn.release();
    }
  }
}

module.exports = new SupplierReplacementService();
module.exports.SupplierReplacementService = SupplierReplacementService;
