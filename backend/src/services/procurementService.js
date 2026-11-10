// =============================================================================
// src/services/procurementService.js
// MilJor Package E4: Procurement Modes Engine
// Governs Flash Pools, RFQs, Recurring Contracts, Demand Requests, and Supplier Matching
// =============================================================================

const db = require('../config/db');
const crypto = require('crypto');

class ProcurementService {

  // ---------------------------------------------------------------------------
  // 1. FLASH POOLS
  // ---------------------------------------------------------------------------

  async createFlashPool(supplierId, payload) {
    const {
      product_id,
      supplier_sku_id,
      total_stock,
      discounted_unit_price,
      original_unit_price,
      min_quantity,
      max_quantity_per_buyer,
      clearance_reason,
      condition_notes,
      expiry_hours = 24
    } = payload;

    if (!product_id || !total_stock || !discounted_unit_price) {
      const err = new Error('product_id, total_stock, and discounted_unit_price are required');
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    const flashCode = `MJ-FLASH-${Date.now().toString().slice(-6)}`;
    const expiryTime = new Date(Date.now() + Number(expiry_hours) * 60 * 60 * 1000);

    const [res] = await db.query(
      `INSERT INTO flash_pools (
        flash_code, supplier_id, product_id, total_stock, remaining_stock,
        discounted_unit_price, original_unit_price, min_quantity,
        max_quantity_per_buyer, clearance_reason, condition_notes,
        expiry_time, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        flashCode, supplierId, product_id, total_stock, total_stock,
        discounted_unit_price, original_unit_price || discounted_unit_price,
        min_quantity || 1, max_quantity_per_buyer || total_stock,
        clearance_reason || 'Ready Stock Clearance', condition_notes || null,
        expiryTime
      ]
    );

    const [created] = await db.query('SELECT * FROM flash_pools WHERE id = ?', [res.insertId]);
    return created[0];
  }

  async getActiveFlashPools(filter = {}) {
    let query = `
      SELECT fp.*, p.title as product_name, p.category, u.business_name as supplier_name,
             sp.verification_level, sp.verification_status
      FROM flash_pools fp
      JOIN products p ON fp.product_id = p.id
      JOIN users u ON fp.supplier_id = u.id
      JOIN supplier_profiles sp ON sp.supplier_id = u.id
      WHERE fp.status = 'ACTIVE' AND fp.expiry_time > NOW() AND fp.remaining_stock > 0
    `;
    const params = [];

    if (filter.category) {
      query += ' AND p.category = ?';
      params.push(filter.category);
    }

    query += ' ORDER BY fp.expiry_time ASC';
    const [rows] = await db.query(query, params);
    return rows;
  }

  // ---------------------------------------------------------------------------
  // 2. DEMAND POOL REQUESTS ("Request a Pool")
  // ---------------------------------------------------------------------------

  async createDemandRequest(buyerId, payload) {
    const {
      category_id,
      family_id,
      commodity_name,
      desired_specs,
      target_quantity,
      target_unit,
      target_price_per_unit,
      cluster_id,
      needed_by_date,
      notes
    } = payload;

    if (!category_id || !family_id || !commodity_name || !target_quantity || !target_unit) {
      const err = new Error('category_id, family_id, commodity_name, target_quantity, and target_unit are required');
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    const requestCode = `REQ-${Date.now().toString().slice(-6)}`;

    const [res] = await db.query(
      `INSERT INTO demand_pool_requests (
        request_code, buyer_id, category_id, family_id, commodity_name,
        desired_specs, target_quantity, target_unit, target_price_per_unit,
        cluster_id, needed_by_date, notes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
      [
        requestCode, buyerId, category_id, family_id, commodity_name,
        desired_specs || null, target_quantity, target_unit, target_price_per_unit || null,
        cluster_id || null, needed_by_date || null, notes || null
      ]
    );

    const [created] = await db.query('SELECT * FROM demand_pool_requests WHERE id = ?', [res.insertId]);
    return created[0];
  }

  async getDemandRequests(filter = {}) {
    let query = `
      SELECT dpr.*, c.name as category_name, f.name as family_name,
             u.business_name as buyer_business_name, lc.name as cluster_name
      FROM demand_pool_requests dpr
      JOIN catalog_categories c ON dpr.category_id = c.id
      JOIN catalog_product_families f ON dpr.family_id = f.id
      JOIN users u ON dpr.buyer_id = u.id
      LEFT JOIN geographic_clusters lc ON dpr.cluster_id = lc.id
      WHERE 1=1
    `;
    const params = [];

    if (filter.status) {
      query += ' AND dpr.status = ?';
      params.push(filter.status);
    }
    if (filter.family_id) {
      query += ' AND dpr.family_id = ?';
      params.push(filter.family_id);
    }
    if (filter.cluster_id) {
      query += ' AND dpr.cluster_id = ?';
      params.push(filter.cluster_id);
    }

    query += ' ORDER BY dpr.created_at DESC';
    const [rows] = await db.query(query, params);
    return rows;
  }

  // ---------------------------------------------------------------------------
  // 3. PERSONALIZED RFQS & SUPPLIER QUOTES
  // ---------------------------------------------------------------------------

  async createRfq(buyerId, payload) {
    const {
      product_name,
      required_specifications,
      quantity,
      unit,
      delivery_address,
      delivery_date,
      target_price,
      quote_expiry_date,
      special_requirements
    } = payload;

    if (!product_name || !quantity || !unit) {
      const err = new Error('product_name, quantity, and unit are required');
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    const rfqCode = `RFQ-${Date.now().toString().slice(-6)}`;

    const defaultDeliveryDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const defaultExpiryDate = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];

    const [res] = await db.query(
      `INSERT INTO rfqs (
        rfq_code, buyer_id, product_name, required_specifications,
        quantity, unit, delivery_address, delivery_date, target_price,
        quote_expiry_date, special_requirements, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
      [
        rfqCode, buyerId, product_name, required_specifications || 'Standard Grade Quality Specifications',
        quantity, unit, delivery_address || 'Lahore Commercial Hub', delivery_date || defaultDeliveryDate,
        target_price || null, quote_expiry_date || defaultExpiryDate, special_requirements || null
      ]
    );

    const [created] = await db.query('SELECT * FROM rfqs WHERE id = ?', [res.insertId]);
    return created[0];
  }

  async submitRfqQuote(supplierId, rfqId, payload) {
    const { unit_price, quantity, delivery_fee = 0, supplier_notes, quote_validity_date } = payload;

    if (!unit_price || !quantity) {
      const err = new Error('unit_price and quantity are required');
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    const [rfqRows] = await db.query('SELECT * FROM rfqs WHERE id = ?', [rfqId]);
    if (!rfqRows[0]) {
      const err = new Error('RFQ not found');
      err.code = 'RFQ_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    if (rfqRows[0].status !== 'OPEN' && rfqRows[0].status !== 'QUOTED') {
      const err = new Error('RFQ is no longer accepting quotes');
      err.code = 'RFQ_CLOSED';
      err.statusCode = 422;
      throw err;
    }

    const totalDeliveredCost = Number(unit_price) * Number(quantity) + Number(delivery_fee);
    const quoteCode = `QTE-${Date.now().toString().slice(-6)}`;

    const validityDate = quote_validity_date || new Date(Date.now() + 3 * 86400000);

    const [res] = await db.query(
      `INSERT INTO rfq_quotes (
        quote_code, rfq_id, supplier_id, version_number, unit_price,
        quantity, delivery_fee, total_delivered_cost, quote_validity_date,
        supplier_notes, status
      ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'SUBMITTED')`,
      [
        quoteCode, rfqId, supplierId, unit_price, quantity, delivery_fee,
        totalDeliveredCost, validityDate, supplier_notes || null
      ]
    );

    await db.query(`UPDATE rfqs SET status = 'QUOTED' WHERE id = ?`, [rfqId]);

    const [created] = await db.query('SELECT * FROM rfq_quotes WHERE id = ?', [res.insertId]);
    return created[0];
  }

  async acceptRfqQuote(buyerId, rfqId, quoteId) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [rfqRows] = await conn.query('SELECT * FROM rfqs WHERE id = ? FOR UPDATE', [rfqId]);
      if (!rfqRows[0] || rfqRows[0].buyer_id !== buyerId) {
        const err = new Error('RFQ not found or not owned by caller');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      const [quoteRows] = await conn.query('SELECT * FROM rfq_quotes WHERE id = ? AND rfq_id = ? FOR UPDATE', [quoteId, rfqId]);
      if (!quoteRows[0] || quoteRows[0].status !== 'SUBMITTED') {
        const err = new Error('Quote is not in SUBMITTED status');
        err.code = 'INVALID_QUOTE_STATUS';
        err.statusCode = 422;
        throw err;
      }

      const quote = quoteRows[0];

      // Mark quote ACCEPTED, reject other quotes
      await conn.query(`UPDATE rfq_quotes SET status = 'ACCEPTED' WHERE id = ?`, [quoteId]);
      await conn.query(`UPDATE rfq_quotes SET status = 'REJECTED' WHERE rfq_id = ? AND id != ?`, [rfqId, quoteId]);
      await conn.query(`UPDATE rfqs SET status = 'ACCEPTED' WHERE id = ?`, [rfqId]);

      // Create Order in AWAITING_PAYMENT status
      const orderCode = `ORD-RFQ-${Date.now().toString().slice(-6)}`;
      const subtotal = Number(quote.unit_price) * Number(quote.quantity);
      const deliveryFee = Number(quote.delivery_fee) || 0;
      const totalAmount = subtotal + deliveryFee;

      const [orderRes] = await conn.query(
        `INSERT INTO orders (
          order_code, buyer_id, supplier_id, total_qty, unit_price,
          subtotal_amount, delivery_fee, total_amount, currency,
          delivery_type, delivery_address, payment_status, order_status, fulfillment_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PKR', 'DOORSTEP', ?, 'AWAITING_PAYMENT', 'AWAITING_PAYMENT', 'UNPAID')`,
        [
          orderCode, buyerId, quote.supplier_id, quote.quantity, quote.unit_price,
          subtotal, deliveryFee, totalAmount, rfqRows[0].delivery_address || 'Lahore'
        ]
      );

      await conn.commit();
      return { order_id: orderRes.insertId, order_code: orderCode, total_amount: totalAmount };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  // ---------------------------------------------------------------------------
  // 4. RECURRING PROCUREMENT CONTRACTS
  // ---------------------------------------------------------------------------

  async createRecurringContract(buyerId, payload) {
    const {
      supplier_id,
      product_id,
      quantity,
      unit,
      frequency = 'WEEKLY',
      agreed_unit_price,
      delivery_address,
      start_date,
      next_delivery_date
    } = payload;

    if (!supplier_id || !product_id || !quantity || !agreed_unit_price) {
      const err = new Error('supplier_id, product_id, quantity, and agreed_unit_price are required');
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    const contractCode = `REC-${Date.now().toString().slice(-6)}`;
    const [res] = await db.query(
      `INSERT INTO recurring_contracts (
        contract_code, buyer_id, supplier_id, product_id, quantity, unit,
        frequency, agreed_unit_price, delivery_address, start_date, next_delivery_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        contractCode, buyerId, supplier_id, product_id, quantity, unit || 'kg',
        frequency, agreed_unit_price, delivery_address || 'Lahore',
        start_date || new Date().toISOString().split('T')[0],
        next_delivery_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      ]
    );

    const [created] = await db.query('SELECT * FROM recurring_contracts WHERE id = ?', [res.insertId]);
    return created[0];
  }

  // ---------------------------------------------------------------------------
  // 5. SUPPLIER MATCHING & COMPARISON
  // ---------------------------------------------------------------------------

  async matchSuppliers({ family_id, cluster_id, quantity = 1 }) {
    const [rows] = await db.query(
      `SELECT u.id as supplier_id, u.business_name, sp.verification_level, sp.verification_status,
              sl.id as listing_id, sl.base_unit_price, sl.available_stock, sl.supplier_min_qty,
              sl.buyer_min_qty, sl.fulfilment_lead_time_days, sl.delivery_fee_policy,
              p.title as product_name, ps.pack_size, ps.pack_unit
       FROM supplier_listings sl
       JOIN product_specifications ps ON sl.product_spec_id = ps.id
       JOIN products p ON ps.product_id = p.id
       JOIN users u ON sl.supplier_id = u.id
       JOIN supplier_profiles sp ON sp.supplier_id = u.id
       WHERE sl.status = 'ACTIVE'
         AND ps.family_id = ?
         AND sl.available_stock >= ?
       ORDER BY (sp.verification_status = 'VERIFIED') DESC, sl.base_unit_price ASC`,
      [family_id, quantity]
    );

    return rows.map(r => ({
      ...r,
      total_estimated_cost: Number(r.base_unit_price) * Number(quantity),
      is_verified: r.verification_status === 'VERIFIED'
    }));
  }
}

module.exports = new ProcurementService();
