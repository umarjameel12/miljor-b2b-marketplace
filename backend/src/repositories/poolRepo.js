// =============================================================================
// src/repositories/poolRepo.js
// MilJor Regular Pool Repository
// Supports DRAFT creation, atomic updates, publishing, and tier management
// =============================================================================
const db = require('../config/db');

class PoolRepository {

  async createPool(poolData, connection = null) {
    const executor = connection || db;
    const {
      pool_code, supplier_id, product_id, product_spec_id, supplier_listing_id,
      target_qty, supplier_min_qty, buyer_min_qty, max_capacity, pool_unit,
      purchase_increment, early_close_allowed, delivery_type, delivery_zones,
      delivery_fee_policy, fulfilment_lead_time_days, cancellation_cutoff_hours,
      current_price_per_unit, next_tier_price, quality_spec_grade, status,
      expires_at, supplier_confirmation_deadline, buyer_commitment_deadline,
      coverage_policy
    } = poolData;

    const effectiveCoveragePolicy = coverage_policy ||
      (delivery_type === 'SUPPLIER_PICKUP' ? 'PICKUP_ONLY' : 'EXPLICIT_CLUSTERS');

    const [result] = await executor.query(
      `INSERT INTO pools
        (pool_code, supplier_id, product_id, product_spec_id, supplier_listing_id,
         current_qty, target_qty, supplier_min_qty, buyer_min_qty, max_capacity,
         pool_unit, purchase_increment, early_close_allowed, delivery_type,
         delivery_zones, delivery_fee_policy, fulfilment_lead_time_days,
         cancellation_cutoff_hours, current_price_per_unit, next_tier_price,
         quality_spec_grade, status, expires_at, supplier_confirmation_deadline,
         buyer_commitment_deadline, coverage_policy)
       VALUES (?, ?, ?, ?, ?, 0.0000, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pool_code,
        supplier_id,
        product_id,
        product_spec_id || null,
        supplier_listing_id || null,
        target_qty,
        supplier_min_qty,
        buyer_min_qty,
        max_capacity || null,
        pool_unit || 'pack',
        purchase_increment || 1.0000,
        early_close_allowed !== undefined ? (early_close_allowed ? 1 : 0) : 1,
        delivery_type || 'DOORSTEP',
        delivery_zones ? JSON.stringify(delivery_zones) : null,
        delivery_fee_policy || 'INCLUDED_IN_PRICE',
        fulfilment_lead_time_days !== undefined && fulfilment_lead_time_days !== null ? fulfilment_lead_time_days : 2,
        cancellation_cutoff_hours !== undefined && cancellation_cutoff_hours !== null ? cancellation_cutoff_hours : 0,
        current_price_per_unit,
        next_tier_price || null,
        quality_spec_grade || null,
        status || 'DRAFT',
        expires_at,
        supplier_confirmation_deadline || null,
        buyer_commitment_deadline || null,
        effectiveCoveragePolicy
      ]
    );
    return result.insertId;
  }

  async updatePool(poolId, updateData, connection = null) {
    const executor = connection || db;
    const allowedFields = [
      'target_qty', 'supplier_min_qty', 'buyer_min_qty', 'max_capacity',
      'pool_unit', 'purchase_increment', 'early_close_allowed', 'delivery_type',
      'delivery_zones', 'delivery_fee_policy', 'fulfilment_lead_time_days',
      'cancellation_cutoff_hours', 'current_price_per_unit', 'next_tier_price',
      'quality_spec_grade', 'status', 'expires_at',
      'supplier_confirmation_deadline', 'buyer_commitment_deadline',
      'coverage_policy'
    ];

    const sets = [];
    const values = [];

    for (const [key, val] of Object.entries(updateData)) {
      if (allowedFields.includes(key)) {
        sets.push(`${key} = ?`);
        if (key === 'delivery_zones' && val !== null && typeof val === 'object') {
          values.push(JSON.stringify(val));
        } else {
          values.push(val);
        }
      }
    }

    if (sets.length === 0) return;

    sets.push('updated_at = NOW()');
    values.push(poolId);

    await executor.query(
      `UPDATE pools SET ${sets.join(', ')} WHERE id = ?`,
      values
    );
  }

  async createPriceTier(tierData, connection = null) {
    const executor = connection || db;
    const { pool_id, min_qty, max_qty, price_per_unit, pricing_unit } = tierData;
    await executor.query(
      'INSERT INTO pool_price_tiers (pool_id, min_qty, max_qty, price_per_unit, pricing_unit) VALUES (?, ?, ?, ?, ?)',
      [pool_id, min_qty, max_qty, price_per_unit, pricing_unit || 'pack']
    );
  }

  async replacePriceTiers(poolId, tiers, connection = null) {
    const executor = connection || db;
    await executor.query('DELETE FROM pool_price_tiers WHERE pool_id = ?', [poolId]);
    for (const tier of tiers) {
      await executor.query(
        'INSERT INTO pool_price_tiers (pool_id, min_qty, max_qty, price_per_unit, pricing_unit) VALUES (?, ?, ?, ?, ?)',
        [poolId, tier.min_qty, tier.max_qty, tier.price_per_unit, tier.pricing_unit || 'pack']
      );
    }
  }

  // Set or replace pool authorized delivery clusters (Phase 6D.3)
  async setPoolDeliveryClusters(poolId, clusterIds, connection = null) {
    const executor = connection || db;
    await executor.query('DELETE FROM pool_delivery_clusters WHERE pool_id = ?', [poolId]);
    if (Array.isArray(clusterIds)) {
      for (const cId of clusterIds) {
        const numId = Number(cId);
        if (!isNaN(numId) && numId > 0) {
          await executor.query(
            'INSERT IGNORE INTO pool_delivery_clusters (pool_id, cluster_id) VALUES (?, ?)',
            [poolId, numId]
          );
        }
      }
    }
  }

  // Retrieve authorized delivery clusters for a pool
  async getPoolDeliveryClusters(poolId, connection = null) {
    const executor = connection || db;
    const [rows] = await executor.query(
      `SELECT pdc.cluster_id, c.cluster_code, c.name AS cluster_name, c.region_code
       FROM pool_delivery_clusters pdc
       JOIN geographic_clusters c ON pdc.cluster_id = c.id
       WHERE pdc.pool_id = ?
       ORDER BY pdc.cluster_id ASC`,
      [poolId]
    );
    return rows;
  }

  // All active pools — public listing with optional filters and location discovery (Phase 6D.3 & 6D.3.3)
  async findAllActive({ category, min_price, max_price, cluster_id, fulfillment_mode, include_all_pickup } = {}) {
    let where = "WHERE p.status = 'ACTIVE' AND p.expires_at > NOW()";
    const params = [];

    if (category) {
      where += ' AND pr.category = ?';
      params.push(category);
    }
    if (min_price) {
      where += ' AND p.current_price_per_unit >= ?';
      params.push(parseFloat(min_price));
    }
    if (max_price) {
      where += ' AND p.current_price_per_unit <= ?';
      params.push(parseFloat(max_price));
    }

    if (fulfillment_mode === 'PICKUP' && (!cluster_id || include_all_pickup)) {
      where += ` AND (
        (p.delivery_type IN ('SUPPLIER_PICKUP', 'DOORSTEP', 'GROUPED_CLUSTER') OR p.delivery_type IS NULL)
        AND p.coverage_policy != 'LEGACY_REVIEW_REQUIRED'
        AND EXISTS (
          SELECT 1 FROM supplier_pickup_points spp
          JOIN supplier_delivery_configurations sdc ON spp.supplier_id = sdc.supplier_id
          WHERE spp.supplier_id = p.supplier_id
            AND spp.is_active = 1
            AND sdc.pickup_enabled = 1
        )
      )`;
    } else if (cluster_id !== undefined && cluster_id !== null && cluster_id !== '') {
      const cId = Number(cluster_id);
      if (!isNaN(cId) && cId > 0) {
        if (fulfillment_mode === 'PICKUP') {
          where += ` AND (
            (p.delivery_type IN ('SUPPLIER_PICKUP', 'DOORSTEP', 'GROUPED_CLUSTER') OR p.delivery_type IS NULL)
            AND p.coverage_policy != 'LEGACY_REVIEW_REQUIRED'
            AND EXISTS (
              SELECT 1 FROM supplier_pickup_points spp
              JOIN supplier_delivery_configurations sdc ON spp.supplier_id = sdc.supplier_id
              WHERE spp.supplier_id = p.supplier_id
                AND spp.cluster_id = ?
                AND spp.is_active = 1
                AND sdc.pickup_enabled = 1
            )
          )`;
          params.push(cId);
        } else {
          where += ` AND (
            (
              p.coverage_policy IN ('EXPLICIT_CLUSTERS', 'LEGACY_KNOWN')
              AND EXISTS (
                SELECT 1 FROM pool_delivery_clusters pdc
                WHERE pdc.pool_id = p.id AND pdc.cluster_id = ?
              )
              AND EXISTS (
                SELECT 1 FROM supplier_delivery_cluster_rates scr
                JOIN supplier_delivery_configurations sdc ON scr.supplier_id = sdc.supplier_id
                WHERE scr.supplier_id = p.supplier_id
                  AND scr.cluster_id = ?
                  AND scr.is_eligible = 1
                  AND (
                    (scr.mode = 'STANDARD_CLUSTERED' AND sdc.standard_delivery_enabled = 1 AND (p.delivery_type != 'SUPPLIER_PICKUP' OR p.delivery_type IS NULL))
                    OR (scr.mode = 'EXPRESS' AND sdc.express_enabled = 1 AND (p.delivery_type != 'SUPPLIER_PICKUP' OR p.delivery_type IS NULL))
                  )
              )
            )
            OR (
              (p.delivery_type IN ('SUPPLIER_PICKUP', 'DOORSTEP', 'GROUPED_CLUSTER') OR p.delivery_type IS NULL)
              AND p.coverage_policy != 'LEGACY_REVIEW_REQUIRED'
              AND EXISTS (
                SELECT 1 FROM supplier_pickup_points spp
                JOIN supplier_delivery_configurations sdc ON spp.supplier_id = sdc.supplier_id
                WHERE spp.supplier_id = p.supplier_id
                  AND spp.cluster_id = ?
                  AND spp.is_active = 1
                  AND sdc.pickup_enabled = 1
              )
            )
          )`;
          params.push(cId, cId, cId);
        }
      }
    }

    const [rows] = await db.query(`
      SELECT
        p.*,
        pr.title AS product_title, pr.category, pr.brand, pr.variety, pr.pack_size, pr.unit,
        u.business_name AS supplier_name, u.area AS supplier_area,
        (p.target_qty - p.current_qty) AS remaining_qty,
        ROUND((p.current_qty / p.target_qty) * 100, 1) AS fill_percentage,
        CASE WHEN p.product_spec_id IS NULL OR p.supplier_listing_id IS NULL THEN 1 ELSE 0 END AS is_legacy,
        CASE WHEN p.product_spec_id IS NULL OR p.supplier_listing_id IS NULL THEN 'LEGACY_NOT_AVAILABLE_FOR_NEW_RESERVATIONS' ELSE 'ACTIVE_PURCHASABLE' END AS participation_status
      FROM pools p
      JOIN products pr ON p.product_id = pr.id
      JOIN users u ON p.supplier_id = u.id
      ${where}
      ORDER BY p.id DESC
    `, params);
    return rows;
  }

  // Single pool by ID with price tiers and delivery clusters
  async findById(id, connection = null) {
    const executor = connection || db;
    const [pools] = await executor.query(`
      SELECT
        p.*,
        pr.title AS product_title, pr.category, pr.brand, pr.variety, pr.pack_size, pr.unit,
        u.business_name AS supplier_name, u.area AS supplier_area,
        (p.target_qty - p.current_qty) AS remaining_qty
      FROM pools p
      JOIN products pr ON p.product_id = pr.id
      JOIN users u ON p.supplier_id = u.id
      WHERE p.id = ?
    `, [id]);

    if (!pools[0]) return null;

    const [tiers] = await executor.query(
      'SELECT id, min_qty, max_qty, price_per_unit, pricing_unit FROM pool_price_tiers WHERE pool_id = ? ORDER BY min_qty ASC',
      [id]
    );

    const deliveryClusters = await this.getPoolDeliveryClusters(id, executor);

    return { ...pools[0], price_tiers: tiers, delivery_clusters: deliveryClusters };
  }

  // Supplier's own pools (includes DRAFT, ACTIVE, etc.)
  async findBySupplier(supplierId) {
    const [rows] = await db.query(`
      SELECT
        p.*,
        pr.title AS product_title, pr.category, pr.unit,
        (p.target_qty - p.current_qty) AS remaining_qty,
        ROUND((p.current_qty / p.target_qty) * 100, 1) AS fill_percentage,
        (SELECT COUNT(*) FROM reservations r WHERE r.pool_id = p.id AND r.status NOT IN ('CANCELLED','EXPIRED')) AS reservation_count
      FROM pools p
      JOIN products pr ON p.product_id = pr.id
      WHERE p.supplier_id = ?
      ORDER BY p.id DESC
    `, [supplierId]);
    return rows;
  }

  // Find pools expired but still ACTIVE (for scheduler)
  async findExpiredActive() {
    const [rows] = await db.query(
      "SELECT * FROM pools WHERE status = 'ACTIVE' AND expires_at <= NOW()"
    );
    return rows;
  }

  // Update pool status
  async updateStatus(poolId, status, extra = {}, connection = null) {
    const executor = connection || db;
    const fields = ['status = ?', 'updated_at = NOW()'];
    const values = [status];

    if (extra.closed_at) { fields.push('closed_at = NOW()'); }
    if (extra.confirmed_at) { fields.push('confirmed_at = NOW()'); }
    if (extra.notes !== undefined) { fields.push('supplier_confirmation_notes = ?'); values.push(extra.notes); }

    values.push(poolId);
    await executor.query(`UPDATE pools SET ${fields.join(', ')} WHERE id = ?`, values);
  }
}

module.exports = new PoolRepository();