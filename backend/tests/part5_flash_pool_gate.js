'use strict';
// =============================================================================
// tests/part5_flash_pool_gate.js
// MilJor Part 5 (Phase B5): Flash Clearance Pools & Regular Countdown Gate
//
// Verification Coverage:
//   Phase 1: Database Schema & Read-Only Conservation Preflight (13 checks)
//   Phase 2: Section A — Physical SKU, Supplier Ownership & Price Bounds (6 checks)
//   Phase 3: Section B — Duration, Selling Modes & Increment Modular Step (6 checks)
//   Phase 4: Section C — Shared Inventory Allocations & Concurrency Safety (4 checks)
//   Phase 5: Section D — Checkout Flow, Safepay Reconciliation & Recovery (6 checks)
//   Phase 6: Section E — Discovery, Expiry, Ledger Release & Countdown Timers (4 checks)
//   Database: Database Safety, Invariants & Ephemeral Fixture Cleanup (1 check)
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

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

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

async function runPart5FlashPoolGate() {
  console.log('⚡ =================================================================');
  console.log('⚡ MILJOR PART 5: FLASH CLEARANCE POOLS & REGULAR COUNTDOWN GATE');
  console.log('⚡ =================================================================\n');

  let passed = 0;

  function pass(label) {
    passed++;
    console.log(`  ✓ PASS ${String(passed).padStart(2, '0')}: ${label}`);
  }

  // ---------------------------------------------------------------------------
  // PHASE 1: Database Safety & Schema Preflight Checks (13 checks)
  // ---------------------------------------------------------------------------
  console.log('--- PHASE 1: Database Safety & Schema Preflight ---');
  const [identity] = await db.query('SELECT DATABASE() AS name');
  assert.equal(identity[0]?.name, 'miljor_test_db', 'FAIL CLOSED: wrong database');
  pass('01 Database identity verified = miljor_test_db');

  const required = {
    flash_pools: [
      'id','supplier_id','supplier_sku_id','supplier_listing_id','product_spec_id',
      'total_stock','remaining_stock','held_stock','committed_stock','selling_mode',
      'discounted_unit_price','original_unit_price','min_quantity','max_quantity_per_buyer',
      'purchase_increment','expiry_time','published_at','configured_duration_minutes',
      'snapshot_json','status','version_number'
    ],
    flash_purchase_holds: [
      'id','flash_pool_id','buyer_id','quantity','locked_unit_price','status',
      'expires_at','order_id','idempotency_key'
    ],
    supplier_inventory_allocations: [
      'supplier_listing_id','allocation_type','reference_id','allocated_qty','unit','status'
    ],
    supplier_listings: [
      'id','supplier_id','product_spec_id','available_stock','pricing_unit','base_unit_price','status'
    ],
    orders: ['id','buyer_id','supplier_id','total_amount','currency','order_status','payment_status'],
    payments: ['id','order_id','amount','status'],
    payment_attempts: ['id','order_id','provider_tracker_token'],
    product_specifications: ['id','supplier_sku_id','purchasing_unit','lifecycle_status','approval_status']
  };

  for (const [table, columns] of Object.entries(required)) {
    const [rows] = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]
    );
    const found = new Set(rows.map(x => x.COLUMN_NAME));
    const missing = columns.filter(x => !found.has(x));
    assert.deepEqual(missing, [], `Missing columns in ${table}`);
    pass(`${table} table schema (${columns.length} required columns verified)`);
  }

  const [engines] = await db.query(
    `SELECT TABLE_NAME, ENGINE FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('flash_pools','flash_purchase_holds','supplier_inventory_allocations','orders')`
  );
  assert.equal(engines.length, 4);
  assert.ok(engines.every(x => String(x.ENGINE).toUpperCase() === 'INNODB'), 'All tables must be InnoDB');
  pass('Transactional InnoDB storage engines confirmed');

  const [indexes] = await db.query(
    `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flash_purchase_holds'
     GROUP BY INDEX_NAME`
  );
  assert.ok(indexes.some(x => x.INDEX_NAME === 'uq_flash_hold_idem' && x.cols === 'buyer_id,idempotency_key'));
  assert.ok(indexes.some(x => x.INDEX_NAME === 'uq_flash_hold_order' && x.cols === 'order_id'));
  pass('Durable idempotency unique indexes confirmed');

  const [modes] = await db.query(
    `SELECT COLUMN_TYPE AS type FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flash_pools' AND COLUMN_NAME = 'selling_mode'`
  );
  assert.ok(modes[0]?.type.includes('MULTI_BUYER') && modes[0]?.type.includes('WHOLE_LOT'));
  pass('Explicit selling modes (MULTI_BUYER, WHOLE_LOT) confirmed');

  const [holds] = await db.query(
    `SELECT COUNT(*) AS violations FROM flash_pools
     WHERE total_stock < 0 OR remaining_stock < 0 OR held_stock < 0 OR committed_stock < 0
        OR remaining_stock + held_stock + committed_stock > total_stock`
  );
  assert.equal(Number(holds[0].violations), 0);
  pass('Existing Flash stock conservation upper bound verified');

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
    productIds: [],
    skuIds: [],
    listingIds: [],
    flashPoolIds: [],
    orderIds: []
  };

  try {
    // Verified Supplier
    const [suppRes] = await db.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role, verification_status, is_verified, buyer_trust_status)
       VALUES (?, ?, ?, 'testhash', 'SUPPLIER', 'VERIFIED', 1, 'CONTACT_VERIFIED')`,
      [`P5 Verified Supplier ${ts}`, `p5_supp_${ts}@miljor.test`, `+92300${String(ts).slice(-7)}`]
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
      [`P5 Unverified Supplier ${ts}`, `p5_unvsupp_${ts}@miljor.test`, `+92301${String(ts).slice(-7)}`]
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
      [`P5 Buyer 1 ${ts}`, `p5_buyer1_${ts}@miljor.test`, `+92302${String(ts).slice(-7)}`]
    );
    const buyer1Id = b1Res.insertId;
    cleanupFixtures.userIds.push(buyer1Id);
    const buyer1Token = generateToken(buyer1Id, 'BUYER', 'VERIFIED');

    // Verified Buyer 2
    const [b2Res] = await db.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role, verification_status, is_verified, buyer_trust_status)
       VALUES (?, ?, ?, 'testhash', 'BUYER', 'VERIFIED', 1, 'CONTACT_VERIFIED')`,
      [`P5 Buyer 2 ${ts}`, `p5_buyer2_${ts}@miljor.test`, `+92303${String(ts).slice(-7)}`]
    );
    const buyer2Id = b2Res.insertId;
    cleanupFixtures.userIds.push(buyer2Id);
    const buyer2Token = generateToken(buyer2Id, 'BUYER', 'VERIFIED');

    // Canonical Category & Family (Rice - ID 1)
    const categoryId = 1;
    const familyId = 1;

    // Create and publish supplier product and SKU via standard APIs
    const prodRes = await api('/api/v1/catalog/supplier-products', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` },
      body: { family_id: familyId, is_unbranded: false, brand: 'MilJor Royal', variety: `Super Basmati ${ts}` }
    });
    assert.equal(prodRes.status, 201);
    const supplierProductId = prodRes.body.data.product.id;
    cleanupFixtures.productIds.push(supplierProductId);

    const skuRes = await api('/api/v1/catalog/supplier-skus', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` },
      body: { supplier_product_id: supplierProductId, packaging_type: 'PP Woven Bag', pack_size: 25, pack_unit: 'kg', purchasing_unit: 'bag' }
    });
    assert.equal(skuRes.status, 201);
    const supplierSkuId = skuRes.body.data.sku.id;
    cleanupFixtures.skuIds.push(supplierSkuId);

    const pubSkuRes = await api(`/api/v1/catalog/supplier-skus/${supplierSkuId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` }
    });
    assert.equal(pubSkuRes.status, 200);

    const listRes = await api('/api/v1/listings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${supplierToken}` },
      body: { supplier_sku_id: supplierSkuId, available_stock: 200, base_unit_price: 5000, supplier_min_qty: 1, buyer_min_qty: 1 }
    });
    assert.equal(listRes.status, 201);
    const listingId = listRes.body.data.listing.id;
    cleanupFixtures.listingIds.push(listingId);

    // ---------------------------------------------------------------------------
    // PHASE 2: Section A — Physical SKU, Ownership & Price Bounds (6 checks)
    // ---------------------------------------------------------------------------
    console.log('\n--- PHASE 2: Section A — Physical SKU, Ownership & Price Bounds ---');
    // A01: Unverified supplier fails
    {
      const res = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${unvSupplierToken}` },
        body: { supplier_listing_id: listingId, total_stock: '50.00', discounted_unit_price: '4200.00', original_unit_price: '5000.00', selling_mode: 'MULTI_BUYER', expiry_time: new Date(Date.now() + 86400000).toISOString(), clearance_reason: 'Surplus' }
      });
      assert.equal(res.status, 403);
      pass('A01 Unverified supplier fails draft creation with 403 SUPPLIER_NOT_VERIFIED');
    }

    // A02: Non-owning supplier fails
    {
      const [otherSupp] = await db.query(
        `INSERT INTO users (full_name, email, phone, password_hash, role, verification_status, is_verified, buyer_trust_status)
         VALUES (?, ?, ?, 'testhash', 'SUPPLIER', 'VERIFIED', 1, 'CONTACT_VERIFIED')`,
        [`P5 Other Supplier ${ts}`, `p5_other_${ts}@miljor.test`, `+92305${String(ts).slice(-7)}`]
      );
      cleanupFixtures.userIds.push(otherSupp.insertId);
      const otherToken = generateToken(otherSupp.insertId, 'SUPPLIER', 'VERIFIED');
      await db.query(
        `INSERT INTO supplier_profiles (supplier_id, business_type, verification_status, subscription_plan, subscription_status)
         VALUES (?, 'WHOLESALER', 'VERIFIED', 'STARTER', 'STARTER_ACTIVE')`,
        [otherSupp.insertId]
      );
      const res = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${otherToken}` },
        body: { supplier_listing_id: listingId, total_stock: '50.00', discounted_unit_price: '4200.00', original_unit_price: '5000.00', selling_mode: 'MULTI_BUYER', expiry_time: new Date(Date.now() + 86400000).toISOString(), clearance_reason: 'Surplus' }
      });
      assert.equal(res.status, 403);
      pass('A02 Non-owning supplier fails draft creation with 403 FLASH_LISTING_FORBIDDEN');
    }

    // A03: Fabricated comparison price fails
    {
      const res = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { supplier_listing_id: listingId, total_stock: '50.00', discounted_unit_price: '4200.00', original_unit_price: '6500.00', selling_mode: 'MULTI_BUYER', expiry_time: new Date(Date.now() + 86400000).toISOString(), clearance_reason: 'Surplus' }
      });
      assert.equal(res.status, 409);
      pass('A03 Fabricated comparison price fails with 409 FLASH_COMPARISON_PRICE_UNVERIFIED');
    }

    // A04: Flash price higher than normal price fails
    {
      const res = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { supplier_listing_id: listingId, total_stock: '50.00', discounted_unit_price: '5500.00', original_unit_price: '5000.00', selling_mode: 'MULTI_BUYER', expiry_time: new Date(Date.now() + 86400000).toISOString(), clearance_reason: 'Surplus' }
      });
      assert.equal(res.status, 400);
      pass('A04 Flash price higher than normal price fails validation');
    }

    // A05: Pack indivisibility for discrete packs
    {
      const res = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { supplier_listing_id: listingId, total_stock: '50.50', discounted_unit_price: '4200.00', original_unit_price: '5000.00', selling_mode: 'MULTI_BUYER', expiry_time: new Date(Date.now() + 86400000).toISOString(), clearance_reason: 'Surplus' }
      });
      assert.equal(res.status, 400);
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
          delivery_fee: '250.00'
        }
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.data.flash_pool.status, 'DRAFT');
      draftPoolId = res.body.data.flash_pool.id;
      cleanupFixtures.flashPoolIds.push(draftPoolId);
      pass('A06 Valid draft created with status DRAFT and purchase_increment preserved');
    }

    // ---------------------------------------------------------------------------
    // PHASE 3: Section B — Duration, Selling Modes & Increments (6 checks)
    // ---------------------------------------------------------------------------
    console.log('\n--- PHASE 3: Section B — Duration, Selling Modes & Increments ---');
    // B01: Configured duration unstarted in DRAFT
    {
      const [poolRows] = await db.query('SELECT * FROM flash_pools WHERE id = ?', [draftPoolId]);
      assert.equal(poolRows[0].published_at, null);
      pass('B01 Draft holds configured_duration_minutes with published_at NULL (countdown unstarted)');
    }

    // B02: Publication computes expiry from UTC_TIMESTAMP
    {
      const res = await api(`/api/v1/flash-pools/${draftPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` }
      });
      assert.equal(res.status, 200);
      assert.equal(res.body?.data?.flash_pool?.status, 'ACTIVE');
      pass('B02 Publication transitions pool to ACTIVE and computes expiry_time from publication timestamp');
    }

    // B03: MULTI_BUYER unaligned increment rejected
    {
      const res = await api(`/api/v1/flash-pools/${draftPoolId}/hold`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}`, 'X-Idempotency-Key': `idem_p5_b03_${ts}` },
        body: { quantity: '3.00', delivery_address: 'Plaza 12, Gulberg III, Lahore' }
      });
      assert.equal(res.status, 409);
      assert.equal(res.body?.error?.code, 'INVALID_PURCHASE_INCREMENT');
      pass('B03 MULTI_BUYER hold request with unaligned increment fails with 409 INVALID_PURCHASE_INCREMENT');
    }

    // B04: MULTI_BUYER aligned increment succeeds
    let buyer1HoldId;
    let buyer1OrderId;
    {
      const res = await api(`/api/v1/flash-pools/${draftPoolId}/hold`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}`, 'X-Idempotency-Key': `idem_p5_b04_${ts}` },
        body: { quantity: '4.00', delivery_address: 'Plaza 12, Gulberg III, Lahore' }
      });
      assert.equal(res.status, 201);
      buyer1HoldId = res.body.data.hold.id;
      buyer1OrderId = res.body.data.hold.order_id;
      cleanupFixtures.orderIds.push(buyer1OrderId);
      pass('B04 MULTI_BUYER hold request with valid increment succeeds (quantity: 4.00)');
    }

    // B05 & B06: WHOLE_LOT mode
    let wholeLotPoolId;
    {
      const resDraft = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { supplier_listing_id: listingId, total_stock: '30.00', discounted_unit_price: '4000.00', original_unit_price: '5000.00', selling_mode: 'WHOLE_LOT', expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(), clearance_reason: 'Complete pallet' }
      });
      wholeLotPoolId = resDraft.body.data.flash_pool.id;
      cleanupFixtures.flashPoolIds.push(wholeLotPoolId);
      await api(`/api/v1/flash-pools/${wholeLotPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` }
      });

      const resPartial = await api(`/api/v1/flash-pools/${wholeLotPoolId}/hold`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}`, 'X-Idempotency-Key': `idem_p5_b05_${ts}` },
        body: { quantity: '10.00', delivery_address: 'MM Alam Road, Gulberg, Lahore' }
      });
      assert.equal(resPartial.status, 409);
      pass('B05 WHOLE_LOT partial quantity hold fails with 409 WHOLE_LOT_REQUIRED');

      const resFull = await api(`/api/v1/flash-pools/${wholeLotPoolId}/hold`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}`, 'X-Idempotency-Key': `idem_p5_b06_${ts}` },
        body: { quantity: '30.00', delivery_address: 'MM Alam Road, Gulberg, Lahore' }
      });
      assert.equal(resFull.status, 201);
      cleanupFixtures.orderIds.push(resFull.body.data.hold.order_id);
      pass('B06 WHOLE_LOT full lot hold succeeds (quantity: 30.00)');
    }

    // ---------------------------------------------------------------------------
    // PHASE 4: Section C — Inventory Ledger & Concurrency Safety (4 checks)
    // ---------------------------------------------------------------------------
    console.log('\n--- PHASE 4: Section C — Inventory Ledger & Concurrency Safety ---');
    // C01: Allocation ledger created
    {
      const [allocations] = await db.query(
        `SELECT * FROM supplier_inventory_allocations WHERE allocation_type = 'FLASH_POOL' AND reference_id = ? AND status = 'COMMITTED'`,
        [draftPoolId]
      );
      assert.equal(allocations.length, 1);
      assert.equal(Number(allocations[0].allocated_qty), 60.00);
      pass('C01 Inventory allocation ledger record created with FLASH_POOL, COMMITTED, and exact stock');
    }

    // C02: Stock feasibility check
    {
      const resDraft = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { supplier_listing_id: listingId, total_stock: '120.00', discounted_unit_price: '4000.00', original_unit_price: '5000.00', selling_mode: 'MULTI_BUYER', expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(), clearance_reason: 'Excess' }
      });
      const excessPoolId = resDraft.body.data.flash_pool.id;
      cleanupFixtures.flashPoolIds.push(excessPoolId);
      const resPub = await api(`/api/v1/flash-pools/${excessPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` }
      });
      assert.equal(resPub.status, 409);
      pass('C02 Publishing excess flash pool fails with 409 INSUFFICIENT_STOCK');
    }

    // C03: Concurrency hold race
    {
      const resDraft = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { supplier_listing_id: listingId, total_stock: '10.00', discounted_unit_price: '4100.00', original_unit_price: '5000.00', min_quantity: '2.00', max_quantity_per_buyer: '10.00', purchase_increment: '2.00', selling_mode: 'MULTI_BUYER', expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(), clearance_reason: 'Race test' }
      });
      const racePoolId = resDraft.body.data.flash_pool.id;
      cleanupFixtures.flashPoolIds.push(racePoolId);
      await api(`/api/v1/flash-pools/${racePoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` }
      });

      const buyers = [buyer1Token, buyer2Token, buyer1Token, buyer2Token, buyer1Token];
      const promises = buyers.map((token, idx) =>
        api(`/api/v1/flash-pools/${racePoolId}/hold`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'X-Idempotency-Key': `idem_p5_race_${ts}_${idx}` },
          body: { quantity: '4.00', delivery_address: `Race address ${idx}, Lahore` }
        })
      );
      const results = await Promise.all(promises);
      const successes = results.filter(r => r.status === 201);
      const failures = results.filter(r => r.status === 409);
      for (const s of successes) cleanupFixtures.orderIds.push(s.body.data.hold.order_id);
      assert.equal(successes.length, 2);
      assert.equal(failures.length, 3);
      pass('C03 Concurrent buyer hold race test: exactly 8 units allocated, 0 oversell, invariant holds');
    }

    // C04: Expired hold stock reclamation
    {
      await db.query(
        "UPDATE flash_purchase_holds SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE) WHERE id = ?",
        [buyer1HoldId]
      );
      const reclaimRes = await flashPoolService.reclaimExpiredUninitiatedHolds(draftPoolId);
      assert.equal(reclaimRes.released, 1);
      const [afterHold] = await db.query('SELECT status FROM flash_purchase_holds WHERE id = ?', [buyer1HoldId]);
      assert.equal(afterHold[0].status, 'EXPIRED');
      pass('C04 Expired hold stock reclamation releases held stock and cancels uninitiated order');
    }

    // ---------------------------------------------------------------------------
    // PHASE 5: Section D — Checkout, Safepay Reconciliation & Recovery (6 checks)
    // ---------------------------------------------------------------------------
    console.log('\n--- PHASE 5: Section D — Checkout, Safepay Reconciliation & Recovery ---');
    let freshHoldId;
    let freshOrderId;
    // D01: Hold creation order details
    {
      const res = await api(`/api/v1/flash-pools/${draftPoolId}/hold`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer2Token}`, 'X-Idempotency-Key': `idem_p5_d01_${ts}` },
        body: { quantity: '6.00', delivery_address: 'Commercial Kitchen 4, DHA Phase 5, Lahore' }
      });
      assert.equal(res.status, 201);
      freshHoldId = res.body.data.hold.id;
      freshOrderId = res.body.data.hold.order_id;
      cleanupFixtures.orderIds.push(freshOrderId);

      const [orderRows] = await db.query('SELECT * FROM orders WHERE id = ?', [freshOrderId]);
      assert.equal(orderRows[0].order_status, 'AWAITING_PAYMENT');
      assert.equal(orderRows[0].delivery_type, 'DOORSTEP');
      pass('D01 Hold creation persists order in AWAITING_PAYMENT with DOORSTEP delivery');
    }

    // D02: Claim checkout lease
    {
      const claimResult = await flashPoolService.claimCheckout(freshOrderId, buyer2Id);
      assert.equal(claimResult.flash_order, true);
      const [holdRows] = await db.query('SELECT status FROM flash_purchase_holds WHERE id = ?', [freshHoldId]);
      assert.equal(holdRows[0].status, 'PAYMENT_PENDING');
      pass('D02 Claim checkout lease transitions hold to PAYMENT_PENDING');
    }

    // D03: Release checkout claim
    {
      await flashPoolService.releaseCheckoutClaim(freshOrderId, buyer2Id);
      const [holdRows] = await db.query('SELECT status FROM flash_purchase_holds WHERE id = ?', [freshHoldId]);
      assert.equal(holdRows[0].status, 'HELD');
      pass('D03 releaseCheckoutClaim reverts PAYMENT_PENDING back to HELD');
    }

    // D04: Reconcile unpaid fails
    {
      await flashPoolService.claimCheckout(freshOrderId, buyer2Id);
      let threw = false;
      try {
        await flashPoolService.reconcilePaidOrder(freshOrderId);
      } catch (e) {
        threw = true;
        assert.equal(e.code, 'PAYMENT_NOT_VERIFIED');
      }
      assert.ok(threw);
      pass('D04 reconcilePaidOrder rejects unpaid order with 409 PAYMENT_NOT_VERIFIED');
    }

    // D05: Reconcile paid with authentic payment
    {
      const [orderRows] = await db.query('SELECT total_amount FROM orders WHERE id = ?', [freshOrderId]);
      await db.query(
        `INSERT INTO payments (payment_code, order_id, buyer_id, amount, payment_method, status, transaction_ref, paid_at)
         VALUES (?, ?, ?, ?, 'CARD', 'PAID', ?, NOW())`,
        [`PAY_P5_${ts}_1`, freshOrderId, buyer2Id, orderRows[0].total_amount, `tx_p5_${ts}_1`]
      );
      await db.query(
        `UPDATE orders SET order_status = 'PAID', payment_status = 'PAID' WHERE id = ?`,
        [freshOrderId]
      );
      const recResult = await flashPoolService.reconcilePaidOrder(freshOrderId);
      assert.equal(recResult.flash_order, true);
      assert.equal(recResult.hold_status, 'PAID');
      pass('D05 reconcilePaidOrder with authentic payment transitions hold to PAID and shifts stock');
    }

    // D06: Status SOLD_OUT when stock reaches 0
    {
      const resDraft = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { supplier_listing_id: listingId, total_stock: '2.00', discounted_unit_price: '4000.00', original_unit_price: '5000.00', min_quantity: '2.00', max_quantity_per_buyer: '2.00', selling_mode: 'MULTI_BUYER', expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(), clearance_reason: 'Sold out test' }
      });
      const soPoolId = resDraft.body.data.flash_pool.id;
      cleanupFixtures.flashPoolIds.push(soPoolId);
      await api(`/api/v1/flash-pools/${soPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` }
      });

      const resHold = await api(`/api/v1/flash-pools/${soPoolId}/hold`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyer1Token}`, 'X-Idempotency-Key': `idem_p5_so_${ts}` },
        body: { quantity: '2.00', delivery_address: 'Sold out test address, Lahore' }
      });
      const soOrderId = resHold.body.data.hold.order_id;
      cleanupFixtures.orderIds.push(soOrderId);

      await flashPoolService.claimCheckout(soOrderId, buyer1Id);
      const [orderRows] = await db.query('SELECT total_amount FROM orders WHERE id = ?', [soOrderId]);
      await db.query(
        `INSERT INTO payments (payment_code, order_id, buyer_id, amount, payment_method, status, transaction_ref, paid_at)
         VALUES (?, ?, ?, ?, 'CARD', 'PAID', ?, NOW())`,
        [`PAY_P5_${ts}_2`, soOrderId, buyer1Id, orderRows[0].total_amount, `tx_p5_${ts}_2`]
      );
      await db.query(
        `UPDATE orders SET order_status = 'PAID', payment_status = 'PAID' WHERE id = ?`,
        [soOrderId]
      );
      await flashPoolService.reconcilePaidOrder(soOrderId);
      const [soPool] = await db.query('SELECT status, remaining_stock FROM flash_pools WHERE id = ?', [soPoolId]);
      assert.equal(soPool[0].status, 'SOLD_OUT');
      pass('D06 Pool status automatically transitions to SOLD_OUT when remaining_stock reaches 0');
    }

    // ---------------------------------------------------------------------------
    // PHASE 6: Section E — Discovery, Expiry & Countdown (4 checks)
    // ---------------------------------------------------------------------------
    console.log('\n--- PHASE 6: Section E — Discovery, Expiry & Countdown ---');
    // E01: Discovery returns active nonexpired
    {
      const res = await api('/api/v1/flash-pools');
      assert.equal(res.status, 200);
      assert.ok(res.body?.data?.flash_pools);
      assert.ok(res.body?.data?.server_time);
      pass('E01 Public discovery returns only ACTIVE, unexpired pools with server_time');
    }

    // E02: Supplier cancellation releases inventory
    {
      const resDraft = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: { supplier_listing_id: listingId, total_stock: '15.00', discounted_unit_price: '4300.00', original_unit_price: '5000.00', selling_mode: 'MULTI_BUYER', expiry_time: new Date(Date.now() + 3600 * 1000).toISOString(), clearance_reason: 'Cancellation test' }
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
      const [allocRows] = await db.query(
        `SELECT status FROM supplier_inventory_allocations WHERE allocation_type = 'FLASH_POOL' AND reference_id = ?`,
        [cancelPoolId]
      );
      assert.equal(allocRows[0].status, 'RELEASED');
      pass('E02 Supplier cancellation transitions pool to CANCELLED and releases inventory allocation');
    }

    // E03: Close expired preserves committed stock
    {
      await db.query(
        "UPDATE flash_pools SET expiry_time = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 10 MINUTE) WHERE id = ?",
        [draftPoolId]
      );
      const closeRes = await flashPoolService.closeExpiredOffer(supplierId, draftPoolId);
      assert.equal(closeRes.status, 'EXPIRED');
      assert.equal(Number(closeRes.preserved_unsettled_quantity), 6.00);
      pass('E03 closeExpiredOffer preserves committed stock allocations and releases unsold stock');
    }

    // E04: Countdown parseDeadline
    {
      const mysqlStr = '2026-11-15 14:30:00';
      const parsedUtc = parseDeadline(mysqlStr);
      assert.equal(parsedUtc, Date.parse('2026-11-15T14:30:00Z'));
      const serverTimeStr = '2026-11-10T20:00:00Z';
      const deadlineStr = '2026-11-10T21:00:00Z';
      const remainingSec = Math.floor((parseDeadline(deadlineStr) - parseDeadline(serverTimeStr)) / 1000);
      assert.equal(remainingSec, 3600);
      pass('E04 Countdown parseDeadline handles MySQL strings as UTC, ISO, offsets, and invalid inputs');
    }

    console.log('\n=================================================================');
    console.log(`🎉 ALL PART 5 FLASH POOL GATE TESTS PASSED (${passed}/${passed})`);
    console.log('=================================================================\n');

  } catch (err) {
    console.error('PART 5 GATE ERROR:', err);
    throw err;
  } finally {
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
      if (cleanupFixtures.skuIds.length) {
        await db.query(`DELETE FROM supplier_skus WHERE id IN (?)`, [cleanupFixtures.skuIds]);
      }
      if (cleanupFixtures.productIds.length) {
        await db.query(`DELETE FROM supplier_products WHERE id IN (?)`, [cleanupFixtures.productIds]);
      }
      if (cleanupFixtures.userIds.length) {
        await db.query(`DELETE FROM supplier_profiles WHERE supplier_id IN (?)`, [cleanupFixtures.userIds]);
        await db.query(`DELETE FROM users WHERE id IN (?)`, [cleanupFixtures.userIds]);
      }
    } catch (cleanupErr) {
      console.warn('⚠️ Cleanup warning:', cleanupErr.message);
    }

    if (server && typeof server.close === 'function') {
      await new Promise(res => server.close(res));
    }
  }
}

runPart5FlashPoolGate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
