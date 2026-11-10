'use strict';
// =============================================================================
// tests/b5_flash_pool_lifecycle_gate.js
// MilJor Package B5 Flash Pools End-to-End Runtime Acceptance & Verification Suite
//
// Sections Covered:
//   Section A: Physical SKU, Supplier Ownership, Draft Creation & Validation
//   Section B: Duration, Selling Modes & Increment Enforcement
//   Section C: Inventory Ledger Serialization & Concurrency Safety
//   Section D: Checkout Flow, Payment Reconciliation & Recovery
//   Section E: Discovery, Expiry, Ledger Release & Countdown Semantics
// =============================================================================
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const flashPoolService = require('../src/services/flashPoolService');
const feeService = require('../src/services/feeService');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

// Countdown timer parseDeadline logic test (mirrors CountdownTimer.jsx)
function parseDeadline(raw) {
  if (!raw) return NaN;
  if (typeof raw === 'number') return raw;
  const str = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(str)) {
    return Date.parse(str.replace(' ', 'T') + 'Z');
  }
  const parsed = Date.parse(str);
  if (!Number.isNaN(parsed)) return parsed;
  return Date.parse(str.replace(' ', 'T'));
}

async function runB5LifecycleGate() {
  console.log('⚡ =================================================================');
  console.log('⚡ MILJOR B5: FLASH POOLS LIFECYCLE & REGULAR COUNTDOWN GATE');
  console.log('⚡ =================================================================\n');

  let passed = 0;
  let failed = 0;

  function pass(label) {
    passed++;
    console.log(`  ✓ PASS ${String(passed).padStart(2, '0')}: ${label}`);
  }

  function fail(label, err) {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
    console.error(err);
    throw err;
  }

  // 1. Database Safety & Identity Check
  const [dbRow] = await db.query('SELECT DATABASE() AS current_db');
  assert.equal(dbRow[0]?.current_db, 'miljor_test_db', 'FAIL CLOSED: must run strictly in miljor_test_db');
  pass('01 Database identity verified = miljor_test_db');

  // Start ephemeral server
  const server = app.listen(0);
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  async function api(endpoint, options = {}) {
    const url = `${baseUrl}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const fetchOpts = { method: options.method || 'GET', headers };
    if (options.body) fetchOpts.body = JSON.stringify(options.body);
    const res = await fetch(url, fetchOpts);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: res.status, headers: res.headers, body };
  }

  const ts = Date.now();
  const cleanupFixtures = {
    userIds: [],
    categoryIds: [],
    familyIds: [],
    productIds: [],
    skuIds: [],
    specIds: [],
    listingIds: [],
    flashPoolIds: [],
    orderIds: []
  };

  try {
    // -------------------------------------------------------------------------
    // Setup Test Actors & Catalog Structure
    // -------------------------------------------------------------------------
    // Verified Supplier
    const [suppRes] = await db.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role, verification_status, is_verified, buyer_trust_status)
       VALUES (?, ?, ?, 'testhash', 'SUPPLIER', 'VERIFIED', 1, 'CONTACT_VERIFIED')`,
      [`B5 Verified Supplier ${ts}`, `b5_supp_${ts}@miljor.test`, `+92300${String(ts).slice(-7)}`]
    );
    const supplierId = suppRes.insertId;
    cleanupFixtures.userIds.push(supplierId);
    const supplierToken = generateToken(supplierId, 'SUPPLIER', 'VERIFIED');

    await db.query(
      `INSERT INTO supplier_profiles (supplier_id, business_type, verification_status, subscription_plan, subscription_status, max_active_listings)
       VALUES (?, 'WHOLESALER', 'VERIFIED', 'STARTER', 'STARTER_ACTIVE', 10)`,
      [supplierId]
    );

    // Unverified Supplier
    const [unvSuppRes] = await db.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role, verification_status, is_verified, buyer_trust_status)
       VALUES (?, ?, ?, 'testhash', 'SUPPLIER', 'PENDING_SUPPLIER_VERIFICATION', 0, 'CONTACT_VERIFIED')`,
      [`B5 Unverified Supplier ${ts}`, `b5_unvsupp_${ts}@miljor.test`, `+92301${String(ts).slice(-7)}`]
    );
    const unvSupplierId = unvSuppRes.insertId;
    cleanupFixtures.userIds.push(unvSupplierId);
    const unvSupplierToken = generateToken(unvSupplierId, 'SUPPLIER', 'PENDING_SUPPLIER_VERIFICATION');

    await db.query(
      `INSERT INTO supplier_profiles (supplier_id, business_type, verification_status, subscription_plan, subscription_status)
       VALUES (?, 'WHOLESALER', 'PENDING_REVIEW', 'STARTER', 'STARTER_ACTIVE')`,
      [unvSupplierId]
    );

    // Verified Buyer 1
    const [b1Res] = await db.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role, verification_status, is_verified, buyer_trust_status)
       VALUES (?, ?, ?, 'testhash', 'BUYER', 'VERIFIED', 1, 'CONTACT_VERIFIED')`,
      [`B5 Verified Buyer 1 ${ts}`, `b5_buyer1_${ts}@miljor.test`, `+92302${String(ts).slice(-7)}`]
    );
    const buyer1Id = b1Res.insertId;
    cleanupFixtures.userIds.push(buyer1Id);
    const buyer1Token = generateToken(buyer1Id, 'BUYER', 'VERIFIED');

    // Verified Buyer 2
    const [b2Res] = await db.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role, verification_status, is_verified, buyer_trust_status)
       VALUES (?, ?, ?, 'testhash', 'BUYER', 'VERIFIED', 1, 'CONTACT_VERIFIED')`,
      [`B5 Verified Buyer 2 ${ts}`, `b5_buyer2_${ts}@miljor.test`, `+92303${String(ts).slice(-7)}`]
    );
    const buyer2Id = b2Res.insertId;
    cleanupFixtures.userIds.push(buyer2Id);
    const buyer2Token = generateToken(buyer2Id, 'BUYER', 'VERIFIED');

    // Unverified Buyer
    const [unvBuyerRes] = await db.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role, verification_status, is_verified, buyer_trust_status)
       VALUES (?, ?, ?, 'testhash', 'BUYER', 'UNVERIFIED', 0, 'CONTACT_VERIFIED')`,
      [`B5 Unverified Buyer ${ts}`, `b5_unvbuyer_${ts}@miljor.test`, `+92304${String(ts).slice(-7)}`]
    );
    const unvBuyerId = unvBuyerRes.insertId;
    cleanupFixtures.userIds.push(unvBuyerId);
    const unvBuyerToken = generateToken(unvBuyerId, 'BUYER', 'UNVERIFIED');

    // Existing Canonical Category & Family (Rice - ID 1)
    const categoryId = 1;
    const familyId = 1;

    // Use official Catalog APIs to create and publish product, SKU, and listing
    const prodRes = await api('/api/v1/catalog/supplier-products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` },
      body: {
        family_id: familyId,
        is_unbranded: false,
        brand: 'MilJor Royal',
        variety: `Super Basmati ${ts}`
      }
    });
    assert.equal(prodRes.status, 201, `Failed to create product: ${JSON.stringify(prodRes.body)}`);
    const supplierProductId = prodRes.body.data.product.id;
    cleanupFixtures.productIds.push(supplierProductId);

    const skuRes = await api('/api/v1/catalog/supplier-skus', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` },
      body: {
        supplier_product_id: supplierProductId,
        packaging_type: 'PP Woven Bag',
        pack_size: 25,
        pack_unit: 'kg',
        purchasing_unit: 'bag'
      }
    });
    assert.equal(skuRes.status, 201, `Failed to create SKU: ${JSON.stringify(skuRes.body)}`);
    const supplierSkuId = skuRes.body.data.sku.id;
    cleanupFixtures.skuIds.push(supplierSkuId);

    const pubSkuRes = await api(`/api/v1/catalog/supplier-skus/${supplierSkuId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` }
    });
    assert.equal(pubSkuRes.status, 200, `Failed to publish SKU: ${JSON.stringify(pubSkuRes.body)}`);

    // Create Commercial Listing
    const listRes = await api('/api/v1/listings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` },
      body: {
        supplier_sku_id: supplierSkuId,
        available_stock: 200,
        base_unit_price: 5000,
        supplier_min_qty: 1,
        buyer_min_qty: 1
      }
    });
    assert.equal(listRes.status, 201, `Failed to create listing: ${JSON.stringify(listRes.body)}`);
    const listingId = listRes.body.data.listing.id;
    cleanupFixtures.listingIds.push(listingId);

    // =========================================================================
    // SECTION A: Physical SKU, Supplier Ownership, Draft Creation & Validation
    // =========================================================================
    console.log('\n--- SECTION A: Physical SKU, Supplier Ownership, Draft & Price Validation ---');

    // A01: Unverified supplier rejected
    {
      const res = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${unvSupplierToken}` },
        body: {
          supplier_listing_id: listingId,
          total_stock: '50.00',
          discounted_unit_price: '4200.00',
          original_unit_price: '5000.00',
          selling_mode: 'MULTI_BUYER',
          expiry_time: new Date(Date.now() + 86400000).toISOString(),
          clearance_reason: 'Surplus harvest clearance'
        }
      });
      assert.equal(res.status, 403, 'Unverified supplier must be rejected with 403');
      assert.equal(res.body?.error?.code, 'SUPPLIER_NOT_VERIFIED');
      pass('A01 Unverified supplier fails draft creation with 403 SUPPLIER_NOT_VERIFIED');
    }

    // A02: Non-owning supplier rejected
    {
      // Create a second verified supplier
      const [otherSuppRes] = await db.query(
        `INSERT INTO users (full_name, email, phone, password_hash, role, verification_status, is_verified, buyer_trust_status)
         VALUES (?, ?, ?, 'testhash', 'SUPPLIER', 'VERIFIED', 1, 'CONTACT_VERIFIED')`,
        [`B5 Other Supplier ${ts}`, `b5_other_${ts}@miljor.test`, `+92305${String(ts).slice(-7)}`]
      );
      const otherSuppId = otherSuppRes.insertId;
      cleanupFixtures.userIds.push(otherSuppId);
      const otherSuppToken = generateToken(otherSuppId, 'SUPPLIER', 'VERIFIED');
      await db.query(
        `INSERT INTO supplier_profiles (supplier_id, business_type, verification_status, subscription_plan, subscription_status)
         VALUES (?, 'WHOLESALER', 'VERIFIED', 'STARTER', 'STARTER_ACTIVE')`,
        [otherSuppId]
      );

      const res = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherSuppToken}` },
        body: {
          supplier_listing_id: listingId, // owned by supplierId, not otherSuppId
          total_stock: '50.00',
          discounted_unit_price: '4200.00',
          original_unit_price: '5000.00',
          selling_mode: 'MULTI_BUYER',
          expiry_time: new Date(Date.now() + 86400000).toISOString(),
          clearance_reason: 'Surplus harvest clearance'
        }
      });
      assert.equal(res.status, 403, 'Non-owning supplier must be rejected with 403');
      assert.equal(res.body?.error?.code, 'FLASH_LISTING_FORBIDDEN');
      pass('A02 Non-owning supplier fails draft creation with 403 FLASH_LISTING_FORBIDDEN');
    }

    // A03: Fabricated comparison price rejected (must match listing base_unit_price)
    {
      const res = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: {
          supplier_listing_id: listingId,
          total_stock: '50.00',
          discounted_unit_price: '4200.00',
          original_unit_price: '6500.00', // Fabricated! listing is 5000.00
          selling_mode: 'MULTI_BUYER',
          expiry_time: new Date(Date.now() + 86400000).toISOString(),
          clearance_reason: 'Surplus harvest clearance'
        }
      });
      assert.equal(res.status, 409, 'Fabricated comparison price must return 409');
      assert.equal(res.body?.error?.code, 'FLASH_COMPARISON_PRICE_UNVERIFIED');
      pass('A03 Fabricated comparison price fails with 409 FLASH_COMPARISON_PRICE_UNVERIFIED');
    }

    // A04: Flash price higher than normal listing price rejected
    {
      const res = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: {
          supplier_listing_id: listingId,
          total_stock: '50.00',
          discounted_unit_price: '5500.00', // Higher than normal listing price 5000.00
          original_unit_price: '5000.00',
          selling_mode: 'MULTI_BUYER',
          expiry_time: new Date(Date.now() + 86400000).toISOString(),
          clearance_reason: 'Surplus harvest clearance'
        }
      });
      assert.equal(res.status, 400, 'Flash price higher than normal price must fail validation');
      pass('A04 Flash price higher than comparison price fails validation');
    }

    // A05: Pack indivisibility: non-loose purchasing unit (bag) rejects fractional packs
    {
      const res = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: {
          supplier_listing_id: listingId,
          total_stock: '50.50', // Fractional bag
          discounted_unit_price: '4200.00',
          original_unit_price: '5000.00',
          selling_mode: 'MULTI_BUYER',
          expiry_time: new Date(Date.now() + 86400000).toISOString(),
          clearance_reason: 'Surplus harvest clearance'
        }
      });
      assert.equal(res.status, 400, 'Fractional pack must be rejected with 400');
      assert.equal(res.body?.error?.code, 'FRACTIONAL_PHYSICAL_PACK');
      pass('A05 Non-loose purchasing pack rejects fractional quantity with 400 FRACTIONAL_PHYSICAL_PACK');
    }

    // A06: Valid DRAFT creation
    let draftPoolId;
    {
      const expiryDate = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
      const res = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: {
          supplier_listing_id: listingId,
          total_stock: '60.00',
          discounted_unit_price: '4200.00',
          original_unit_price: '5000.00',
          min_quantity: '2.00',
          max_quantity_per_buyer: '20.00',
          purchase_increment: '2.00',
          selling_mode: 'MULTI_BUYER',
          expiry_time: expiryDate,
          clearance_reason: 'Warehouse shelf reset',
          condition_notes: 'Original vacuum-sealed packs in pristine condition',
          delivery_fee: '250.00'
        }
      });
      assert.equal(res.status, 201, 'Valid draft creation must return 201');
      assert.ok(res.body?.data?.flash_pool?.id, 'Returned flash_pool must have an ID');
      assert.equal(res.body.data.flash_pool.status, 'DRAFT', 'Status must be DRAFT');
      assert.equal(res.body.data.flash_pool.purchase_increment, '2.00', 'purchase_increment must match');
      draftPoolId = res.body.data.flash_pool.id;
      cleanupFixtures.flashPoolIds.push(draftPoolId);
      pass('A06 Valid draft created with status DRAFT and purchase_increment preserved');
    }

    // =========================================================================
    // SECTION B: Duration, Selling Modes & Increment Enforcement
    // =========================================================================
    console.log('\n--- SECTION B: Duration, Selling Modes & Increment Enforcement ---');

    // B01: Configured duration in draft does not start countdown clock until publication
    {
      const [poolRows] = await db.query('SELECT * FROM flash_pools WHERE id = ?', [draftPoolId]);
      assert.equal(poolRows[0].published_at, null, 'Draft published_at must remain NULL');
      assert.ok(Number(poolRows[0].configured_duration_minutes) > 0, 'configured_duration_minutes must be set');
      pass('B01 Draft holds configured_duration_minutes with published_at NULL (countdown unstarted)');
    }

    // B02: Publication computes authoritative expiry_time from UTC_TIMESTAMP() + duration
    {
      const res = await api(`/api/v1/flash-pools/${draftPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` }
      });
      assert.equal(res.status, 200, 'Publishing draft must return 200');
      assert.equal(res.body?.data?.flash_pool?.status, 'ACTIVE', 'Published flash pool status must be ACTIVE');
      assert.ok(res.body?.data?.flash_pool?.published_at, 'published_at must be populated');

      const [published] = await db.query(
        'SELECT status, published_at, expiry_time, TIMESTAMPDIFF(MINUTE, published_at, expiry_time) AS duration_diff FROM flash_pools WHERE id = ?',
        [draftPoolId]
      );
      assert.equal(published[0].status, 'ACTIVE');
      assert.ok(published[0].duration_diff >= 119 && published[0].duration_diff <= 121, 'Duration must match configured duration');
      pass('B02 Publication transitions pool to ACTIVE and computes expiry_time from publication timestamp');
    }

    // B03: MULTI_BUYER increment enforcement: hold request not aligned with purchase_increment rejected
    {
      const res = await api(`/api/v1/flash-pools/${draftPoolId}/hold`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `idem_b03_${ts}`
        },
        body: {
          quantity: '3.00', // min is 2.00, increment is 2.00; 3.00 is invalid!
          delivery_address: 'Plaza 12, Main Boulevard, Gulberg III, Lahore'
        }
      });
      assert.equal(res.status, 409, 'Unaligned increment must return 409');
      assert.equal(res.body?.error?.code, 'INVALID_PURCHASE_INCREMENT');
      pass('B03 MULTI_BUYER hold request with unaligned increment fails with 409 INVALID_PURCHASE_INCREMENT');
    }

    // B04: MULTI_BUYER increment enforcement: valid aligned increment succeeds
    let buyer1HoldId;
    let buyer1OrderId;
    {
      const res = await api(`/api/v1/flash-pools/${draftPoolId}/hold`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `idem_b04_${ts}`
        },
        body: {
          quantity: '4.00', // min=2.00, increment=2.00: (4-2)%2 === 0
          delivery_address: 'Plaza 12, Main Boulevard, Gulberg III, Lahore'
        }
      });
      assert.equal(res.status, 201, 'Aligned increment hold must return 201');
      assert.ok(res.body?.data?.hold?.id, 'Hold ID must be returned');
      buyer1HoldId = res.body.data.hold.id;
      buyer1OrderId = res.body.data.hold.order_id;
      cleanupFixtures.orderIds.push(buyer1OrderId);
      pass('B04 MULTI_BUYER hold request with valid increment succeeds (quantity: 4.00)');
    }

    // B05 & B06: WHOLE_LOT selling mode
    let wholeLotPoolId;
    {
      // Create a WHOLE_LOT draft
      const resDraft = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: {
          supplier_listing_id: listingId,
          total_stock: '30.00',
          discounted_unit_price: '4000.00',
          original_unit_price: '5000.00',
          selling_mode: 'WHOLE_LOT',
          expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(),
          clearance_reason: 'Complete restaurant pallet clearance'
        }
      });
      assert.equal(resDraft.status, 201);
      wholeLotPoolId = resDraft.body.data.flash_pool.id;
      cleanupFixtures.flashPoolIds.push(wholeLotPoolId);

      // Publish WHOLE_LOT pool
      const resPub = await api(`/api/v1/flash-pools/${wholeLotPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` }
      });
      assert.equal(resPub.status, 200);

      // B05: Partial hold on WHOLE_LOT rejected
      const resPartial = await api(`/api/v1/flash-pools/${wholeLotPoolId}/hold`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer2Token}`,
          'X-Idempotency-Key': `idem_b05_${ts}`
        },
        body: {
          quantity: '10.00', // Partial! total_stock is 30.00
          delivery_address: 'Restaurant Row, MM Alam Road, Gulberg, Lahore'
        }
      });
      assert.equal(resPartial.status, 409, 'Partial quantity on WHOLE_LOT must return 409');
      assert.equal(resPartial.body?.error?.code, 'WHOLE_LOT_REQUIRED');
      pass('B05 WHOLE_LOT partial quantity hold fails with 409 WHOLE_LOT_REQUIRED');

      // B06: Full lot hold on WHOLE_LOT succeeds
      const resFull = await api(`/api/v1/flash-pools/${wholeLotPoolId}/hold`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer2Token}`,
          'X-Idempotency-Key': `idem_b06_${ts}`
        },
        body: {
          quantity: '30.00', // Exactly total_stock
          delivery_address: 'Restaurant Row, MM Alam Road, Gulberg, Lahore'
        }
      });
      assert.equal(resFull.status, 201, 'Full lot hold must succeed with 201');
      cleanupFixtures.orderIds.push(resFull.body.data.hold.order_id);
      pass('B06 WHOLE_LOT full lot hold succeeds (quantity: 30.00)');
    }

    // =========================================================================
    // SECTION C: Inventory Ledger Serialization & Concurrency Safety
    // =========================================================================
    console.log('\n--- SECTION C: Inventory Ledger Serialization & Concurrency Safety ---');

    // C01: Inventory allocation ledger updates on publish
    {
      const [allocations] = await db.query(
        `SELECT * FROM supplier_inventory_allocations 
         WHERE allocation_type = 'FLASH_POOL' AND reference_id = ? AND status = 'COMMITTED'`,
        [draftPoolId]
      );
      assert.equal(allocations.length, 1, 'Exactly one COMMITTED allocation record must exist');
      assert.equal(Number(allocations[0].allocated_qty), 60.00, 'Allocated qty must equal offer total_stock');
      assert.equal(allocations[0].unit, 'bag', 'Allocation unit must match purchasing_unit');
      pass('C01 Inventory allocation ledger record created with FLASH_POOL, COMMITTED, and exact stock');
    }

    // C02: Stock feasibility check: cannot publish if listing available stock is insufficient
    {
      // Current listing stock is 200. Already allocated: 60 (draftPoolId) + 30 (wholeLotPoolId) = 90.
      // Remaining unallocated is 110. Try to publish a pool with 120 stock.
      const resDraft = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: {
          supplier_listing_id: listingId,
          total_stock: '120.00', // Exceeds available 110
          discounted_unit_price: '4000.00',
          original_unit_price: '5000.00',
          selling_mode: 'MULTI_BUYER',
          expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(),
          clearance_reason: 'Excess stock test'
        }
      });
      assert.equal(resDraft.status, 201);
      const excessPoolId = resDraft.body.data.flash_pool.id;
      cleanupFixtures.flashPoolIds.push(excessPoolId);

      const resPub = await api(`/api/v1/flash-pools/${excessPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` }
      });
      assert.equal(resPub.status, 409, 'Excess allocation must return 409');
      assert.equal(resPub.body?.error?.code, 'INSUFFICIENT_STOCK');
      pass('C02 Publishing excess flash pool fails with 409 INSUFFICIENT_STOCK');
    }

    // C03: Concurrent buyer hold race safety
    {
      // Create a pool with 10 units stock, min 2, max 10, increment 2
      const resDraft = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: {
          supplier_listing_id: listingId,
          total_stock: '10.00',
          discounted_unit_price: '4100.00',
          original_unit_price: '5000.00',
          min_quantity: '2.00',
          max_quantity_per_buyer: '10.00',
          purchase_increment: '2.00',
          selling_mode: 'MULTI_BUYER',
          expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(),
          clearance_reason: 'Race test pool'
        }
      });
      const racePoolId = resDraft.body.data.flash_pool.id;
      cleanupFixtures.flashPoolIds.push(racePoolId);
      await api(`/api/v1/flash-pools/${racePoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` }
      });

      // 5 concurrent requests of 4 units each (total demand = 20, but stock is only 10)
      // Exactly 2 requests must succeed (2 * 4 = 8 units held, remaining = 2). 3 must fail.
      const buyers = [buyer1Token, buyer2Token, buyer1Token, buyer2Token, buyer1Token];
      const promises = buyers.map((token, idx) =>
        api(`/api/v1/flash-pools/${racePoolId}/hold`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Idempotency-Key': `idem_race_${ts}_${idx}`
          },
          body: {
            quantity: '4.00',
            delivery_address: `Race delivery address ${idx}, Lahore`
          }
        })
      );

      const results = await Promise.all(promises);
      const successes = results.filter(r => r.status === 201);
      const failures = results.filter(r => r.status === 409);

      for (const s of successes) {
        cleanupFixtures.orderIds.push(s.body.data.hold.order_id);
      }

      assert.equal(successes.length, 2, 'Exactly 2 holds of 4.00 units must succeed from 10.00 total stock');
      assert.equal(failures.length, 3, 'Remaining 3 holds must fail closed with 409');

      const [racePool] = await db.query('SELECT total_stock, remaining_stock, held_stock FROM flash_pools WHERE id = ?', [racePoolId]);
      assert.equal(Number(racePool[0].held_stock), 8.00);
      assert.equal(Number(racePool[0].remaining_stock), 2.00);
      assert.equal(
        Number(racePool[0].remaining_stock) + Number(racePool[0].held_stock),
        Number(racePool[0].total_stock),
        'Stock invariant holds under concurrency'
      );
      pass('C03 Concurrent buyer hold race test: exactly 8 units allocated, 0 oversell, invariant holds');
    }

    // C04: Expired hold stock reclamation
    {
      // Artificially expire buyer1HoldId in draftPoolId by updating expires_at to past
      await db.query(
        "UPDATE flash_purchase_holds SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE) WHERE id = ?",
        [buyer1HoldId]
      );

      const [beforePool] = await db.query('SELECT remaining_stock, held_stock FROM flash_pools WHERE id = ?', [draftPoolId]);
      const prevRemaining = Number(beforePool[0].remaining_stock);
      const prevHeld = Number(beforePool[0].held_stock);

      const reclaimRes = await flashPoolService.reclaimExpiredUninitiatedHolds(draftPoolId);
      assert.equal(reclaimRes.released, 1, 'Exactly 1 expired hold should be reclaimed');

      const [afterHold] = await db.query('SELECT status FROM flash_purchase_holds WHERE id = ?', [buyer1HoldId]);
      assert.equal(afterHold[0].status, 'EXPIRED', 'Hold status must be updated to EXPIRED');

      const [afterOrder] = await db.query('SELECT order_status, payment_status FROM orders WHERE id = ?', [buyer1OrderId]);
      assert.equal(afterOrder[0].order_status, 'CANCELLED');
      assert.equal(afterOrder[0].payment_status, 'PAYMENT_FAILED');

      const [afterPool] = await db.query('SELECT remaining_stock, held_stock FROM flash_pools WHERE id = ?', [draftPoolId]);
      assert.equal(Number(afterPool[0].remaining_stock), prevRemaining + 4.00, 'Reclaimed stock returned to remaining_stock');
      assert.equal(Number(afterPool[0].held_stock), prevHeld - 4.00, 'Held stock decreased by reclaimed amount');
      pass('C04 Expired hold stock reclamation releases held stock and cancels uninitiated order');
    }

    // =========================================================================
    // SECTION D: Checkout Flow, Payment Reconciliation & Recovery
    // =========================================================================
    console.log('\n--- SECTION D: Checkout Flow, Payment Reconciliation & Recovery ---');

    // D01: Fresh hold creation with AWAITING_PAYMENT order and DOORSTEP delivery
    let freshHoldId;
    let freshOrderId;
    {
      const res = await api(`/api/v1/flash-pools/${draftPoolId}/hold`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer2Token}`,
          'X-Idempotency-Key': `idem_d01_${ts}`
        },
        body: {
          quantity: '6.00',
          delivery_address: 'Commercial Kitchen 4, DHA Phase 5, Lahore'
        }
      });
      assert.equal(res.status, 201);
      freshHoldId = res.body.data.hold.id;
      freshOrderId = res.body.data.hold.order_id;
      cleanupFixtures.orderIds.push(freshOrderId);

      const [orderRows] = await db.query('SELECT * FROM orders WHERE id = ?', [freshOrderId]);
      assert.equal(orderRows[0].order_status, 'AWAITING_PAYMENT');
      assert.equal(orderRows[0].payment_status, 'AWAITING_PAYMENT');
      assert.equal(orderRows[0].delivery_type, 'DOORSTEP');
      assert.equal(Number(orderRows[0].total_qty), 6.00);
      pass('D01 Hold creation persists order in AWAITING_PAYMENT with DOORSTEP delivery');
    }

    // D02: Claim checkout lease transitions hold to PAYMENT_PENDING
    {
      const claimResult = await flashPoolService.claimCheckout(freshOrderId, buyer2Id);
      assert.equal(claimResult.flash_order, true);

      const [holdRows] = await db.query('SELECT status FROM flash_purchase_holds WHERE id = ?', [freshHoldId]);
      assert.equal(holdRows[0].status, 'PAYMENT_PENDING', 'Hold status must be PAYMENT_PENDING during checkout lease');
      pass('D02 Claim checkout lease transitions hold to PAYMENT_PENDING');
    }

    // D03: Failed checkout release cleanly reverts PAYMENT_PENDING back to HELD
    {
      await flashPoolService.releaseCheckoutClaim(freshOrderId, buyer2Id);
      const [holdRows] = await db.query('SELECT status FROM flash_purchase_holds WHERE id = ?', [freshHoldId]);
      assert.equal(holdRows[0].status, 'HELD', 'Hold status must revert cleanly to HELD on checkout failure');
      pass('D03 releaseCheckoutClaim reverts PAYMENT_PENDING back to HELD');
    }

    // D04: Reconcile paid order without authentic Safepay payment fails with 409 PAYMENT_NOT_VERIFIED
    {
      // Re-claim checkout lease
      await flashPoolService.claimCheckout(freshOrderId, buyer2Id);

      let threw = false;
      try {
        await flashPoolService.reconcilePaidOrder(freshOrderId);
      } catch (e) {
        threw = true;
        assert.equal(e.code, 'PAYMENT_NOT_VERIFIED');
      }
      assert.ok(threw, 'reconcilePaidOrder must fail without verified payment');
      pass('D04 reconcilePaidOrder rejects unpaid order with 409 PAYMENT_NOT_VERIFIED');
    }

    // D05: Reconcile paid order with verified Safepay payment transitions hold to PAID
    {
      // Simulate authentic Safepay payment record insertion
      const [orderRows] = await db.query('SELECT total_amount FROM orders WHERE id = ?', [freshOrderId]);
      const totalAmount = orderRows[0].total_amount;

      await db.query(
        `INSERT INTO payments (payment_code, order_id, buyer_id, amount, payment_method, status, transaction_ref, paid_at)
         VALUES (?, ?, ?, ?, 'CARD', 'PAID', ?, NOW())`,
        [`PAY_B5_${ts}_1`, freshOrderId, buyer2Id, totalAmount, `tx_b5_${ts}_1`]
      );
      await db.query(
        `UPDATE orders SET order_status = 'PAID', payment_status = 'PAID' WHERE id = ?`,
        [freshOrderId]
      );

      const [poolBefore] = await db.query('SELECT held_stock, committed_stock FROM flash_pools WHERE id = ?', [draftPoolId]);
      const heldBefore = Number(poolBefore[0].held_stock);
      const committedBefore = Number(poolBefore[0].committed_stock);

      const recResult = await flashPoolService.reconcilePaidOrder(freshOrderId);
      assert.equal(recResult.flash_order, true);
      assert.equal(recResult.hold_status, 'PAID');

      const [holdRows] = await db.query('SELECT status FROM flash_purchase_holds WHERE id = ?', [freshHoldId]);
      assert.equal(holdRows[0].status, 'PAID', 'Hold status must be PAID');

      const [poolAfter] = await db.query('SELECT held_stock, committed_stock FROM flash_pools WHERE id = ?', [draftPoolId]);
      assert.equal(Number(poolAfter[0].held_stock), heldBefore - 6.00, 'held_stock decremented by paid quantity');
      assert.equal(Number(poolAfter[0].committed_stock), committedBefore + 6.00, 'committed_stock incremented by paid quantity');
      pass('D05 reconcilePaidOrder with authentic payment transitions hold to PAID and shifts stock');
    }

    // D06: Status transitions to SOLD_OUT when remaining_stock reaches 0
    {
      // Create a pool with 2 units total stock
      const resDraft = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: {
          supplier_listing_id: listingId,
          total_stock: '2.00',
          discounted_unit_price: '4000.00',
          original_unit_price: '5000.00',
          min_quantity: '2.00',
          max_quantity_per_buyer: '2.00',
          selling_mode: 'MULTI_BUYER',
          expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(),
          clearance_reason: 'Sold out test'
        }
      });
      const soPoolId = resDraft.body.data.flash_pool.id;
      cleanupFixtures.flashPoolIds.push(soPoolId);
      await api(`/api/v1/flash-pools/${soPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` }
      });

      // Buy all 2 units
      const resHold = await api(`/api/v1/flash-pools/${soPoolId}/hold`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${buyer1Token}`,
          'X-Idempotency-Key': `idem_so_${ts}`
        },
        body: {
          quantity: '2.00',
          delivery_address: 'Sold out test address, Lahore'
        }
      });
      const soOrderId = resHold.body.data.hold.order_id;
      cleanupFixtures.orderIds.push(soOrderId);

      // Claim and pay
      await flashPoolService.claimCheckout(soOrderId, buyer1Id);
      const [orderRows] = await db.query('SELECT total_amount FROM orders WHERE id = ?', [soOrderId]);
      await db.query(
        `INSERT INTO payments (payment_code, order_id, buyer_id, amount, payment_method, status, transaction_ref, paid_at)
         VALUES (?, ?, ?, ?, 'CARD', 'PAID', ?, NOW())`,
        [`PAY_B5_${ts}_2`, soOrderId, buyer1Id, orderRows[0].total_amount, `tx_b5_${ts}_2`]
      );
      await db.query(
        `UPDATE orders SET order_status = 'PAID', payment_status = 'PAID' WHERE id = ?`,
        [soOrderId]
      );

      await flashPoolService.reconcilePaidOrder(soOrderId);
      const [soPool] = await db.query('SELECT status, remaining_stock, committed_stock FROM flash_pools WHERE id = ?', [soPoolId]);
      assert.equal(Number(soPool[0].remaining_stock), 0.00);
      assert.equal(soPool[0].status, 'SOLD_OUT', 'Pool status must transition to SOLD_OUT when remaining_stock reaches 0');
      pass('D06 Pool status automatically transitions to SOLD_OUT when remaining_stock reaches 0');
    }

    // =========================================================================
    // SECTION E: Discovery, Expiry, Ledger Release & Countdown Semantics
    // =========================================================================
    console.log('\n--- SECTION E: Discovery, Expiry, Ledger Release & Countdown Semantics ---');

    // E01: Public discovery returns ACTIVE, unexpired offers with server_time
    {
      const res = await api('/api/v1/flash-pools');
      assert.equal(res.status, 200);
      assert.ok(res.body?.data?.flash_pools, 'Must return flash_pools list');
      assert.ok(res.body?.data?.server_time, 'Must return server_time');

      const pools = res.body.data.flash_pools;
      // All returned pools must be ACTIVE, remaining_stock > 0, and not expired
      for (const p of pools) {
        assert.equal(p.status, 'ACTIVE');
        assert.ok(Number(p.remaining_stock) > 0);
        assert.ok(Date.parse(p.expiry_at_utc) > Date.now());
      }
      pass('E01 Public discovery returns only ACTIVE, unexpired pools with server_time');
    }

    // E02: Supplier cancellation releases inventory allocation
    {
      // Create a pool to cancel
      const resDraft = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: {
          supplier_listing_id: listingId,
          total_stock: '15.00',
          discounted_unit_price: '4300.00',
          original_unit_price: '5000.00',
          selling_mode: 'MULTI_BUYER',
          expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(),
          clearance_reason: 'Cancellation test pool'
        }
      });
      const cancelPoolId = resDraft.body.data.flash_pool.id;
      cleanupFixtures.flashPoolIds.push(cancelPoolId);
      await api(`/api/v1/flash-pools/${cancelPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` }
      });

      const resCancel = await api(`/api/v1/flash-pools/${cancelPoolId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` }
      });
      assert.equal(resCancel.status, 200);
      assert.equal(resCancel.body?.data?.flash_pool?.status, 'CANCELLED');

      const [allocRows] = await db.query(
        `SELECT status, allocated_qty FROM supplier_inventory_allocations 
         WHERE allocation_type = 'FLASH_POOL' AND reference_id = ?`,
        [cancelPoolId]
      );
      assert.equal(allocRows[0].status, 'RELEASED', 'Inventory allocation must transition to RELEASED');
      assert.equal(Number(allocRows[0].allocated_qty), 0.00, 'allocated_qty must be reset to 0');
      pass('E02 Supplier cancellation transitions pool to CANCELLED and releases inventory allocation');
    }

    // E03: Close expired offer releases unsold inventory and preserves committed stock
    {
      // draftPoolId has committed_stock = 6.00, remaining_stock = 54.00
      // Artificially expire the pool
      await db.query(
        "UPDATE flash_pools SET expiry_time = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE) WHERE id = ?",
        [draftPoolId]
      );

      const closeRes = await flashPoolService.closeExpiredOffer(supplierId, draftPoolId);
      assert.equal(closeRes.status, 'EXPIRED');
      assert.equal(Number(closeRes.preserved_unsettled_quantity), 6.00, 'Preserved unsettled stock must equal committed stock');

      const [allocRows] = await db.query(
        `SELECT status, allocated_qty FROM supplier_inventory_allocations 
         WHERE allocation_type = 'FLASH_POOL' AND reference_id = ?`,
        [draftPoolId]
      );
      assert.equal(allocRows[0].status, 'COMMITTED', 'Allocation status remains COMMITTED for preserved stock');
      assert.equal(Number(allocRows[0].allocated_qty), 6.00, 'allocated_qty adjusted to preserved committed stock');
      pass('E03 closeExpiredOffer preserves committed stock allocations and releases unsold stock');
    }

    // E04: Countdown timer parseDeadline verification
    {
      // 1. MySQL format without timezone treated as UTC
      const mysqlStr = '2026-11-15 14:30:00';
      const parsedUtc = parseDeadline(mysqlStr);
      assert.equal(parsedUtc, Date.parse('2026-11-15T14:30:00Z'), 'MySQL DATETIME string must parse strictly as UTC');

      // 2. ISO string with Z
      const isoStr = '2026-11-15T14:30:00Z';
      assert.equal(parseDeadline(isoStr), parsedUtc);

      // 3. Milliseconds number
      const ms = 1794750000000;
      assert.equal(parseDeadline(ms), ms);

      // 4. Invalid input returns NaN
      assert.ok(Number.isNaN(parseDeadline('invalid-date')));
      assert.ok(Number.isNaN(parseDeadline(null)));
      assert.ok(Number.isNaN(parseDeadline(undefined)));

      // 5. Offset calculation simulation
      const serverTimeStr = '2026-11-10T20:00:00Z';
      const deadlineStr = '2026-11-10T21:00:00Z';
      const remainingSec = Math.floor((parseDeadline(deadlineStr) - parseDeadline(serverTimeStr)) / 1000);
      assert.equal(remainingSec, 3600, '3600 seconds remaining between serverTime and deadline');
      pass('E04 Countdown parseDeadline handles MySQL strings as UTC, ISO, offsets, and invalid inputs');
    }

    console.log('\n=================================================================');
    console.log(`🎉 ALL B5 FLASH POOL LIFECYCLE GATE TESTS PASSED (${passed}/${passed})`);
    console.log('=================================================================\n');

  } catch (err) {
    fail('B5 Lifecycle Gate Execution Error', err);
  } finally {
    // Teardown test fixtures
    try {
      if (cleanupFixtures.orderIds.length) {
        await db.query(`DELETE FROM payments WHERE order_id IN (?)`, [cleanupFixtures.orderIds]);
        await db.query(`DELETE FROM payment_attempts WHERE order_id IN (?)`, [cleanupFixtures.orderIds]);
        await db.query(`DELETE FROM flash_purchase_holds WHERE order_id IN (?)`, [cleanupFixtures.orderIds]);
        await db.query(`DELETE FROM orders WHERE id IN (?)`, [cleanupFixtures.orderIds]);
      }
      if (cleanupFixtures.flashPoolIds.length) {
        await db.query(`DELETE FROM supplier_inventory_allocations WHERE allocation_type = 'FLASH_POOL' AND reference_id IN (?)`, [cleanupFixtures.flashPoolIds]);
        await db.query(`DELETE FROM flash_purchase_holds WHERE flash_pool_id IN (?)`, [cleanupFixtures.flashPoolIds]);
        await db.query(`DELETE FROM flash_pools WHERE id IN (?)`, [cleanupFixtures.flashPoolIds]);
      }
      if (cleanupFixtures.listingIds.length) {
        await db.query(`DELETE FROM supplier_listings WHERE id IN (?)`, [cleanupFixtures.listingIds]);
      }
      if (cleanupFixtures.specIds.length) {
        await db.query(`DELETE FROM product_specifications WHERE id IN (?)`, [cleanupFixtures.specIds]);
      }
      if (cleanupFixtures.skuIds.length) {
        await db.query(`DELETE FROM supplier_skus WHERE id IN (?)`, [cleanupFixtures.skuIds]);
      }
      if (cleanupFixtures.productIds.length) {
        await db.query(`DELETE FROM supplier_products WHERE id IN (?)`, [cleanupFixtures.productIds]);
      }
      if (cleanupFixtures.familyIds.length) {
        await db.query(`DELETE FROM catalog_product_families WHERE id IN (?)`, [cleanupFixtures.familyIds]);
      }
      if (cleanupFixtures.categoryIds.length) {
        await db.query(`DELETE FROM catalog_categories WHERE id IN (?)`, [cleanupFixtures.categoryIds]);
      }
      if (cleanupFixtures.userIds.length) {
        await db.query(`DELETE FROM supplier_profiles WHERE supplier_id IN (?)`, [cleanupFixtures.userIds]);
        await db.query(`DELETE FROM users WHERE id IN (?)`, [cleanupFixtures.userIds]);
      }
    } catch (cleanupErr) {
      console.warn('⚠️ Non-fatal cleanup warning:', cleanupErr.message);
    }

    if (server && typeof server.close === 'function') {
      await new Promise(res => server.close(res));
    }
  }
}

runB5LifecycleGate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('CRITICAL GATE FAILURE:', err);
    process.exit(1);
  });
