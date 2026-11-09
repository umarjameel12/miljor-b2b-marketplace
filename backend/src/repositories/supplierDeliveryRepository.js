// =============================================================================
// src/repositories/supplierDeliveryRepository.js
// MilJor Special Phase G2: Supplier Delivery Configuration & Pricing Repository
// =============================================================================
const defaultDb = require('../config/db');

class SupplierDeliveryRepository {
  /**
   * Fetch supplier's delivery mode configuration
   */
  async getSupplierConfiguration(supplierId, connection) {
    const db = connection || defaultDb;
    const [rows] = await db.query(
      `SELECT 
        id,
        supplier_id,
        standard_delivery_enabled,
        pickup_enabled,
        express_enabled,
        express_cutoff_time,
        express_fulfillment_hours,
        version,
        created_at,
        updated_at
       FROM supplier_delivery_configurations
       WHERE supplier_id = ?`,
      [supplierId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Upsert supplier delivery configuration
   */
  async upsertSupplierConfiguration(supplierId, config, connection) {
    const db = connection || defaultDb;
    const {
      standard_delivery_enabled = true,
      pickup_enabled = false,
      express_enabled = false,
      express_cutoff_time = '14:00:00',
      express_fulfillment_hours = 4
    } = config;

    await db.query(
      `INSERT INTO supplier_delivery_configurations (
        supplier_id, standard_delivery_enabled, pickup_enabled, express_enabled,
        express_cutoff_time, express_fulfillment_hours, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        standard_delivery_enabled = VALUES(standard_delivery_enabled),
        pickup_enabled = VALUES(pickup_enabled),
        express_enabled = VALUES(express_enabled),
        express_cutoff_time = VALUES(express_cutoff_time),
        express_fulfillment_hours = VALUES(express_fulfillment_hours),
        version = version + 1,
        updated_at = NOW()`,
      [
        supplierId,
        standard_delivery_enabled,
        pickup_enabled,
        express_enabled,
        express_cutoff_time,
        express_fulfillment_hours
      ]
    );

    return this.getSupplierConfiguration(supplierId, db);
  }

  /**
   * Fetch all cluster rates configured by a supplier
   */
  async getSupplierClusterRates(supplierId, connection) {
    const db = connection || defaultDb;
    const [rows] = await db.query(
      `SELECT 
        r.id,
        r.supplier_id,
        r.cluster_id,
        r.mode,
        r.is_eligible,
        CAST(r.fee_pkr AS DOUBLE) AS fee_pkr,
        r.version,
        c.cluster_code,
        c.name AS cluster_name,
        c.region_code
       FROM supplier_delivery_cluster_rates r
       JOIN geographic_clusters c ON r.cluster_id = c.id
       WHERE r.supplier_id = ?
       ORDER BY r.cluster_id ASC, r.mode ASC`,
      [supplierId]
    );
    return rows;
  }

  /**
   * Upsert rate for a specific cluster and mode
   */
  async upsertSupplierClusterRate(rateData, connection) {
    const db = connection || defaultDb;
    const { supplier_id, cluster_id, mode, is_eligible = true, fee_pkr = 0.00 } = rateData;

    await db.query(
      `INSERT INTO supplier_delivery_cluster_rates (
        supplier_id, cluster_id, mode, is_eligible, fee_pkr, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        is_eligible = VALUES(is_eligible),
        fee_pkr = VALUES(fee_pkr),
        version = version + 1,
        updated_at = NOW()`,
      [supplier_id, cluster_id, mode, is_eligible, fee_pkr]
    );
  }

  /**
   * Fetch supplier's pickup points
   */
  async getSupplierPickupPoints(supplierId, connection) {
    const db = connection || defaultDb;
    const [rows] = await db.query(
      `SELECT 
        p.id,
        p.supplier_id,
        p.point_name,
        p.cluster_id,
        p.address_line,
        p.operating_hours,
        CAST(p.pickup_handling_fee_pkr AS DOUBLE) AS pickup_handling_fee_pkr,
        p.collection_instructions,
        p.is_active,
        p.version,
        c.cluster_code,
        c.name AS cluster_name
       FROM supplier_pickup_points p
       JOIN geographic_clusters c ON p.cluster_id = c.id
       WHERE p.supplier_id = ?
       ORDER BY p.is_active DESC, p.id ASC`,
      [supplierId]
    );
    return rows;
  }

  /**
   * Insert new pickup point
   */
  async createPickupPoint(pointData, connection) {
    const db = connection || defaultDb;
    const {
      supplier_id,
      point_name,
      cluster_id,
      address_line,
      operating_hours = 'Mon-Sat 09:00 - 18:00',
      pickup_handling_fee_pkr = 0.00,
      collection_instructions = null
    } = pointData;

    const [result] = await db.query(
      `INSERT INTO supplier_pickup_points (
        supplier_id, point_name, cluster_id, address_line, operating_hours,
        pickup_handling_fee_pkr, collection_instructions, is_active, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, 1, NOW(), NOW())`,
      [
        supplier_id,
        point_name,
        cluster_id,
        address_line,
        operating_hours,
        pickup_handling_fee_pkr,
        collection_instructions
      ]
    );
    return result.insertId;
  }

  /**
   * Update pickup point
   */
  async updatePickupPoint(pointId, supplierId, updateData, connection) {
    const db = connection || defaultDb;
    const {
      point_name,
      cluster_id,
      address_line,
      operating_hours,
      pickup_handling_fee_pkr,
      collection_instructions,
      is_active
    } = updateData;

    const fields = [];
    const values = [];

    if (point_name !== undefined) { fields.push('point_name = ?'); values.push(point_name); }
    if (cluster_id !== undefined) { fields.push('cluster_id = ?'); values.push(cluster_id); }
    if (address_line !== undefined) { fields.push('address_line = ?'); values.push(address_line); }
    if (operating_hours !== undefined) { fields.push('operating_hours = ?'); values.push(operating_hours); }
    if (pickup_handling_fee_pkr !== undefined) { fields.push('pickup_handling_fee_pkr = ?'); values.push(pickup_handling_fee_pkr); }
    if (collection_instructions !== undefined) { fields.push('collection_instructions = ?'); values.push(collection_instructions); }
    if (is_active !== undefined) { fields.push('is_active = ?'); values.push(is_active); }

    if (fields.length === 0) return false;

    fields.push('version = version + 1', 'updated_at = NOW()');
    values.push(pointId, supplierId);

    const [result] = await db.query(
      `UPDATE supplier_pickup_points SET ${fields.join(', ')} WHERE id = ? AND supplier_id = ?`,
      values
    );

    return result.affectedRows > 0;
  }

  /**
   * Create an authoritative delivery quote
   */
  async createDeliveryQuote(quoteData, connection) {
    const db = connection || defaultDb;
    const {
      quote_code,
      buyer_id,
      supplier_id,
      pool_id,
      cluster_id,
      address_id,
      destination_address_snapshot = null,
      destination_fingerprint = null,
      mode,
      quoted_delivery_fee_pkr,
      pickup_point_id = null,
      supplier_config_version = 1,
      expires_at
    } = quoteData;

    await db.query(
      `INSERT INTO delivery_quotes (
        quote_code, buyer_id, supplier_id, pool_id, cluster_id, address_id,
        destination_address_snapshot, destination_fingerprint, mode, quoted_delivery_fee_pkr, pickup_point_id, supplier_config_version,
        status, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, NOW())`,
      [
        quote_code,
        buyer_id,
        supplier_id,
        pool_id,
        cluster_id,
        address_id,
        destination_address_snapshot ? JSON.stringify(destination_address_snapshot) : null,
        destination_fingerprint,
        mode,
        quoted_delivery_fee_pkr,
        pickup_point_id,
        supplier_config_version,
        expires_at
      ]
    );

    const [rows] = await db.query(
      `SELECT * FROM delivery_quotes WHERE quote_code = ?`,
      [quote_code]
    );
    return rows[0];
  }

  /**
   * Fetch quote by code
   */
  async getDeliveryQuoteByCode(quoteCode, connection) {
    const db = connection || defaultDb;
    const [rows] = await db.query(
      `SELECT * FROM delivery_quotes WHERE quote_code = ?`,
      [quoteCode]
    );
    return rows.length > 0 ? rows[0] : null;
  }
}

module.exports = new SupplierDeliveryRepository();
