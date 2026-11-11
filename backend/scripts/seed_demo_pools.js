require('dotenv').config();
const mysql = require('mysql2/promise');
const crypto = require('crypto');

(async () => {
  const db = await mysql.createConnection({
    host: '127.0.0.1',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'miljor_db'
  });

  try {
    await db.beginTransaction();

    // 1. Supplier Delivery Setup (Supplier ID 2)
    await db.query(`INSERT INTO supplier_delivery_configurations
      (supplier_id, standard_delivery_enabled, pickup_enabled, express_enabled, express_cutoff_time, express_fulfillment_hours, version)
      VALUES (2, 1, 1, 0, '14:00:00', 4, 1)
      ON DUPLICATE KEY UPDATE standard_delivery_enabled = 1, pickup_enabled = 1`);

    for (const cId of [1, 2, 3, 4, 5]) {
      await db.query(`INSERT INTO supplier_delivery_cluster_rates
        (supplier_id, cluster_id, mode, is_eligible, fee_pkr, version)
        VALUES (2, ?, 'STANDARD_CLUSTERED', 1, 500.00, 1)
        ON DUPLICATE KEY UPDATE is_eligible = 1, fee_pkr = 500.00`, [cId]);
    }

    await db.query(`INSERT INTO supplier_pickup_points
      (supplier_id, point_name, cluster_id, address_line, operating_hours, pickup_handling_fee_pkr, collection_instructions, is_active, version)
      VALUES (2, 'Akbari Mandi Depot', 2, 'Shop 14, Main Rice Market, Akbari Mandi, Lahore', '09:00 - 18:00', 0.00, 'Present order confirmation', 1, 1)
      ON DUPLICATE KEY UPDATE is_active = 1`);

    // Clean up previous demo rows if they exist to allow idempotency
    await db.query(`DELETE FROM flash_pools WHERE flash_code = 'FL-DEMO-CLEARANCE'`);
    const [existingPools] = await db.query(`SELECT id FROM pools WHERE pool_code = 'MJ-POOL-DEMO-01'`);
    if (existingPools.length > 0) {
      const pId = existingPools[0].id;
      await db.query(`DELETE FROM pool_delivery_clusters WHERE pool_id = ?`, [pId]);
      await db.query(`DELETE FROM pool_price_tiers WHERE pool_id = ?`, [pId]);
      await db.query(`DELETE FROM supplier_inventory_allocations WHERE reference_id = ? AND allocation_type = 'REGULAR_POOL'`, [pId]);
      await db.query(`DELETE FROM pools WHERE id = ?`, [pId]);
    }
    await db.query(`DELETE FROM supplier_listings WHERE listing_code = 'LST-DEMO-RICE-01'`);
    await db.query(`DELETE FROM product_specifications WHERE spec_code = 'SPEC-BASMATI-01'`);
    await db.query(`DELETE FROM supplier_skus WHERE sku_code = 'SKU-BASMATI-25KG'`);
    await db.query(`DELETE FROM supplier_products WHERE product_code = 'PROD-BASMATI-01'`);

    const prodIdentityHash = crypto.createHash('sha256').update('SUP-2-PROD-BASMATI-01').digest('hex');
    const skuHash = crypto.createHash('sha256').update('SKU-BASMATI-25KG').digest('hex');
    const specHash = crypto.createHash('sha256').update('SPEC-BASMATI-01').digest('hex');

    // 2. Supplier Product
    const [pRes] = await db.query(`INSERT INTO supplier_products
      (product_code, supplier_id, category_id, family_id, legacy_product_id, title, brand, is_unbranded, variety, quality_grade, origin, crop_year, description, product_identity_hash, status, published_at)
      VALUES ('PROD-BASMATI-01', 2, 1, 1, 1, 'Super Kernel Basmati Rice', 'Mughal Royal', 0, '1121 Kainat', 'Grade A', 'Punjab', 2026, 'Direct from Akbari Mandi', ?, 'PUBLISHED', UTC_TIMESTAMP())`, [prodIdentityHash]);
    const prodId = pRes.insertId;

    // 3. Supplier SKU
    const [skuRes] = await db.query(`INSERT INTO supplier_skus
      (sku_code, supplier_id, supplier_product_id, category_id, family_id, packaging_type, pack_size, pack_unit, purchasing_unit, shelf_life_days, sku_hash, status, published_at)
      VALUES ('SKU-BASMATI-25KG', 2, ?, 1, 1, 'BAG', 25.00, 'kg', 'bag', 730, ?, 'PUBLISHED', UTC_TIMESTAMP())`, [prodId, skuHash]);
    const skuId = skuRes.insertId;

    // 4. Linked Specification Bridge
    const [specRes] = await db.query(`INSERT INTO product_specifications
      (product_id, category_id, family_id, supplier_id, supplier_product_id, supplier_sku_id, spec_code, title,
       brand, is_unbranded, variety, crop_year, quality_grade, origin, packaging_type, pack_size, pack_unit, purchasing_unit,
       spec_hash, is_active, approval_status, lifecycle_status)
      VALUES (1, 1, 1, 2, ?, ?, 'SPEC-BASMATI-01', 'Mughal Royal Super Kernel Basmati 25kg Bag',
       'Mughal Royal', 0, '1121 Kainat', 2026, 'Grade A', 'Punjab', 'BAG', 25.00, 'kg', 'bag',
       ?, 1, 'APPROVED', 'PUBLISHED')`, [prodId, skuId, specHash]);
    const specId = specRes.insertId;

    await db.query('UPDATE supplier_skus SET linked_spec_id = ? WHERE id = ?', [specId, skuId]);

    // 5. Commercial Listing
    const [lRes] = await db.query(`INSERT INTO supplier_listings
      (listing_code, supplier_id, product_spec_id, supplier_product_id, supplier_sku_id,
       available_stock, base_unit_price, pricing_unit, price_per_base_unit, currency, supplier_min_qty, buyer_min_qty, delivery_zones, status)
      VALUES ('LST-DEMO-RICE-01', 2, ?, ?, ?, 1000.00, 4800.00, 'bag', 192.00, 'PKR', 10.00, 1.00, '["all_lahore"]', 'ACTIVE')`,
      [specId, prodId, skuId]);
    const listingId = lRes.insertId;

    // 6. Regular Pool
    const [poolRes] = await db.query(`INSERT INTO pools
      (pool_code, supplier_id, product_id, product_spec_id, supplier_product_id, supplier_sku_id,
       supplier_listing_id, current_qty, target_qty, max_capacity, supplier_min_qty, buyer_min_qty,
       pool_unit, purchase_increment, current_price_per_unit, next_tier_price, platform_fee_percent,
       quality_spec_grade, status, delivery_type, coverage_policy, delivery_fee_policy,
       fulfilment_lead_time_days, promised_delivery_at, is_terms_locked, expires_at, created_at, updated_at)
      VALUES ('MJ-POOL-DEMO-01', 2, 1, ?, ?, ?, ?, 120.00, 500.00, 1000.00, 50.00, 2.00,
       'bag', 1.00, 4800.00, 4600.00, 2.50,
       'Grade A Export Quality', 'ACTIVE', 'DOORSTEP', 'EXPLICIT_CLUSTERS', 'INCLUDED_IN_PRICE',
       2, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 DAY), 1, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY),
       UTC_TIMESTAMP(), UTC_TIMESTAMP())`, [specId, prodId, skuId, listingId]);
    const poolId = poolRes.insertId;

    for (const cId of [1, 2, 3, 4, 5]) {
      await db.query(`INSERT INTO pool_delivery_clusters (pool_id, cluster_id) VALUES (?, ?)`, [poolId, cId]);
    }

    await db.query(`INSERT INTO pool_price_tiers
      (pool_id, min_qty, max_qty, price_per_unit, pricing_unit)
      VALUES (?, 50.00, 200.00, 4800.00, 'bag'),
             (?, 201.00, 500.00, 4600.00, 'bag'),
             (?, 501.00, 1000.00, 4400.00, 'bag')`, [poolId, poolId, poolId]);

    await db.query(`INSERT INTO supplier_inventory_allocations
      (supplier_listing_id, allocation_type, reference_id, allocated_qty, unit, status)
      VALUES (?, 'REGULAR_POOL', ?, 1000.00, 'bag', 'COMMITTED')`, [listingId, poolId]);

    // 7. Flash Clearance Pool
    await db.query(`INSERT INTO flash_pools
      (supplier_id, supplier_listing_id, product_spec_id, supplier_sku_id, product_id,
       flash_code, discounted_unit_price, original_unit_price, total_stock,
       remaining_stock, min_quantity, max_quantity_per_buyer, clearance_reason, selling_mode, purchase_increment,
       configured_duration_minutes, status, published_at, expiry_time, delivery_fee)
      VALUES (2, ?, ?, ?, 1,
       'FL-DEMO-CLEARANCE', 3950.00, 4800.00, 50.00,
       42.00, 1.00, 10.00, 'Akbari Mandi Fresh Lot Arrival', 'MULTI_BUYER', 1.00,
       240, 'ACTIVE', UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR), 250.00)`,
      [listingId, specId, skuId]);

    await db.commit();
    console.log('SUCCESS_DEMO_POOLS_SEEDED');
    process.exit(0);
  } catch (e) {
    await db.rollback();
    console.error('SEED_ERROR:', e.message);
    process.exit(1);
  } finally {
    await db.end();
  }
})();
