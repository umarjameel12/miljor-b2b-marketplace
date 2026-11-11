'use strict';
// Seed fixture for B6 procurement matching & quoting in miljor_test_db only.
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';
const db = require('../src/config/db');

async function seed() {
  const [[dbName]] = await db.query('SELECT DATABASE() as d');
  if (dbName.d !== 'miljor_test_db') {
    throw new Error('PROTECTED DB ABORT: Cannot run against ' + dbName.d);
  }

  // Check if b6 fixture already exists
  const [existing] = await db.query("SELECT id FROM supplier_products WHERE product_code = 'SP-B6-0001'");
  if (existing.length) {
    console.log('Fixture already exists with id:', existing[0].id);
    process.exit(0);
  }

  // 1. Insert supplier product
  const [pRes] = await db.query(`
    INSERT INTO supplier_products (
      product_code, supplier_id, category_id, family_id, legacy_product_id,
      title, brand, is_unbranded, variety, processing_method, quality_grade,
      origin, crop_year, commodity_attributes, description, product_identity_hash,
      status, published_at, created_at, updated_at
    ) VALUES (
      'SP-B6-0001', 2, 1, 1, 1,
      'Super Kernel Basmati Rice', 'Super Kernel Mills', 0, 'Super Kernel Basmati', 'Sella (Parboiled)', 'Export Grade A',
      'Punjab, Pakistan', '2026', '{}', 'B6 test product', 'b6_test_product_hash_001',
      'PUBLISHED', NOW(), NOW(), NOW()
    )
  `);
  const spId = pRes.insertId;

  // 2. Insert supplier sku
  const [sRes] = await db.query(`
    INSERT INTO supplier_skus (
      sku_code, supplier_id, supplier_product_id, category_id, family_id,
      packaging_type, pack_size, pack_unit, purchasing_unit, pack_specification,
      storage_requirements, shelf_life_days, sku_attributes, sku_hash,
      status, published_at, created_at, updated_at
    ) VALUES (
      'SKU-B6-0001', 2, ?, 1, 1,
      'PP Bag', 25.00, 'kg', 'bag', 'Standard 25kg packaging',
      'Dry warehouse', 730, '{}', 'b6_test_sku_hash_001',
      'PUBLISHED', NOW(), NOW(), NOW()
    )
  `, [spId]);
  const skuId = sRes.insertId;

  // 3. Insert product specification
  const [specRes] = await db.query(`
    INSERT INTO product_specifications (
      product_id, category_id, family_id, supplier_id, supplier_product_id, supplier_sku_id,
      variant_title, spec_code, title, brand, is_unbranded, variety, crop_year,
      processing_method, quality_grade, origin, packaging_type, pack_size, pack_unit,
      purchasing_unit, storage_requirements, shelf_life_days, spec_attributes,
      spec_hash, is_active, approval_status, lifecycle_status, approved_by, approved_at,
      created_at, updated_at
    ) VALUES (
      1, 1, 1, 2, ?, ?,
      'Super Kernel Mills — Super Kernel Basmati (Export Grade A) — 25kg PP Bag', 'SPEC-B6-0001', 'Super Kernel Basmati Rice 25kg', 'Super Kernel Mills', 0, 'Super Kernel Basmati', '2026',
      'Sella (Parboiled)', 'Export Grade A', 'Punjab, Pakistan', 'PP Bag', 25.00, 'kg',
      'bag', 'Dry warehouse', 730, '{"purity_percent": 98}',
      'b6_test_spec_hash_001', 1, 'APPROVED', 'PUBLISHED', 1, NOW(),
      NOW(), NOW()
    )
  `, [spId, skuId]);
  const specId = specRes.insertId;

  await db.query('UPDATE supplier_skus SET linked_spec_id = ? WHERE id = ?', [specId, skuId]);

  // 4. Insert supplier listing
  const [lRes] = await db.query(`
    INSERT INTO supplier_listings (
      listing_code, supplier_id, product_spec_id, supplier_product_id, supplier_sku_id,
      available_stock, base_unit_price, pricing_unit, price_per_base_unit,
      currency, supplier_min_qty, buyer_min_qty, delivery_zones,
      delivery_fee_policy, fulfilment_lead_time_days, status, notes,
      created_at, updated_at
    ) VALUES (
      'LST-B6-TEST-001', 2, ?, ?, ?,
      500.00, 4800.00, 'bag', 192.0000,
      'PKR', 1.00, 1.00, '["Gulberg", "Model Town", "DHA Lahore", "Johar Town, Lahore", "All Lahore"]',
      'INCLUDED_IN_PRICE', 1, 'ACTIVE', 'B6 test fixture listing',
      NOW(), NOW()
    )
  `, [specId, spId, skuId]);

  console.log('Seeded B6 fixture successfully:', { spId, skuId, specId, listingId: lRes.insertId });
  process.exit(0);
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
