// =============================================================================
// backend/tests/part_6d3_3_backend_hardening_gate.js
// MilJor Phase 6D.3.3: Advanced Safety, Coverage Reconciliation & Destination Binding Gate
// =============================================================================
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const TEST_PORT = 5098;
process.env.PORT = TEST_PORT;
process.env.DB_NAME = 'miljor_test_db';

const deliveryEligibilityService = require('../src/services/deliveryEligibilityService');
const buyerAddressService = require('../src/services/buyerAddressService');
const buyerAddressRepo = require('../src/repositories/buyerAddressRepository');
const poolRepo = require('../src/repositories/poolRepo');
const geoService = require('../src/services/geographicService');

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runGate() {
  console.log('================================================================================');
  console.log('MILJOR PHASE 6D.3.3: ADVANCED SAFETY & DESTINATION BINDING VERIFICATION GATE');
  console.log('Market: Lahore District, Punjab, Pakistan ONLY');
  console.log('Target: miljor_test_db (Strict Isolation)');
  console.log('================================================================================\n');

  let testDb = null;
  let devDb = null;
  let serverInstance = null;

  const createdUserIds = [];
  const createdPoolIds = [];
  const createdQuoteCodes = [];

  try {
    testDb = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: 'miljor_test_db',
      multipleStatements: true
    });

    devDb = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: 'miljor_db'
    });

    const app = require('../server');
    await new Promise((resolve) => {
      serverInstance = app.listen(TEST_PORT, () => {
        resolve();
      });
    });

    // -------------------------------------------------------------------------
    // GATE 1 & GATE 2: Migration 030 Applied & Coverage Policy Reconciliation
    // -------------------------------------------------------------------------
    console.log('▶ Gate 1 & 2: Migration 030 & Pool Coverage Policy Reconciliation...');
    const [migRows] = await testDb.query(
      "SELECT version, name FROM schema_migrations WHERE version = '030'"
    );
    assert.strictEqual(migRows.length, 1, 'Migration 030 must be recorded in schema_migrations');
    console.log('  ✔ Migration 030 recorded in schema_migrations');

    const rollbackPath = path.join(__dirname, '../database/migrations/rollback/030_pool_coverage_reconciliation_and_destination_identity_rollback.sql');
    assert.ok(fs.existsSync(rollbackPath), 'Rollback SQL for Migration 030 must exist');
    console.log('  ✔ Migration 030 rollback file verified');

    // Verify columns added in Migration 030
    const [revCol] = await testDb.query("SHOW COLUMNS FROM buyer_delivery_addresses LIKE 'revision'");
    assert.strictEqual(revCol.length, 1, 'buyer_delivery_addresses.revision column must exist');
    assert.strictEqual(revCol[0].Default, '1', 'revision default must be 1');

    const [fpCol] = await testDb.query("SHOW COLUMNS FROM delivery_quotes LIKE 'destination_fingerprint'");
    assert.strictEqual(fpCol.length, 1, 'delivery_quotes.destination_fingerprint column must exist');
    console.log('  ✔ Schema additions (revision, destination_fingerprint) verified on miljor_test_db\n');

    // -------------------------------------------------------------------------
    // GATE 3: Destination Address Fingerprint Binding & Address-Edit Invalidation
    // -------------------------------------------------------------------------
    console.log('▶ Gate 3: Destination Address Fingerprint Binding & Address-Edit Invalidation...');
    const buyerEmail = `test.buyer.6d33.${Date.now()}@miljor.test`;
    const [bRes] = await testDb.query(
      `INSERT INTO users (full_name, business_name, email, phone, role, password_hash, verification_status, is_verified, city, base_cluster_id, created_at, updated_at)
       VALUES ('Test Buyer 6D33', 'Test Buyer Store', ?, '+923000000888', 'BUYER', 'hash', 'VERIFIED', 1, 'Lahore', 1, NOW(), NOW())`,
      [buyerEmail]
    );
    const buyerId = bRes.insertId;
    createdUserIds.push(buyerId);

    // Create supplier
    const supEmail = `test.sup.6d33.${Date.now()}@miljor.test`;
    const [sRes] = await testDb.query(
      `INSERT INTO users (full_name, business_name, email, phone, role, password_hash, verification_status, is_verified, city, base_cluster_id, created_at, updated_at)
       VALUES ('Test Supplier 6D33', 'Test Mills Ltd', ?, '+923000000889', 'SUPPLIER', 'hash', 'VERIFIED', 1, 'Lahore', 1, NOW(), NOW())`,
      [supEmail]
    );
    const supId = sRes.insertId;
    createdUserIds.push(supId);

    await testDb.query(
      `INSERT INTO supplier_profiles (supplier_id, verification_status)
       VALUES (?, 'VERIFIED')`,
      [supId]
    );

    // Create supplier settings
    await testDb.query(
      `INSERT INTO supplier_delivery_configurations (supplier_id, standard_delivery_enabled, express_enabled, pickup_enabled, express_cutoff_time)
       VALUES (?, 1, 1, 1, '23:59:59')`,
      [supId]
    );
    await testDb.query(
      `INSERT INTO supplier_delivery_cluster_rates (supplier_id, cluster_id, mode, fee_pkr, is_eligible)
       VALUES (?, 1, 'STANDARD_CLUSTERED', 250.00, 1), (?, 1, 'EXPRESS', 500.00, 1), (?, 2, 'STANDARD_CLUSTERED', 350.00, 1)`,
      [supId, supId, supId]
    );
    await testDb.query(
      `INSERT INTO supplier_pickup_points (supplier_id, cluster_id, point_name, address_line, operating_hours, pickup_handling_fee_pkr, is_active)
       VALUES (?, 1, 'Main Warehouse Gulberg', 'Plot 45 Industrial Area, Gulberg III, Lahore', '09:00 - 18:00', 50.00, 1)`,
      [supId]
    );

    // Create initial buyer address in Cluster 1 (Gulberg)
    const { address: initialAddr } = await buyerAddressService.createBuyerAddress(buyerId, {
      city: 'Lahore',
      cluster_id: 1,
      society_area: 'Gulberg III Block A',
      full_address: 'House 12, Street 4, Gulberg III, Lahore',
      is_default: true
    }, testDb);

    assert.strictEqual(initialAddr.revision, 1, 'Initial address revision must be 1');
    console.log(`  ✔ Initial address created with ID ${initialAddr.id}, revision = ${initialAddr.revision}`);

    // Create an active pool for the supplier in cluster 1
    const [pRows] = await testDb.query('SELECT id FROM products WHERE is_active = 1 LIMIT 1');
    const [specRows] = await testDb.query('SELECT id, purchasing_unit FROM product_specifications WHERE product_id = ? AND is_active = 1 LIMIT 1', [pRows[0].id]);
    const [listingRes] = await testDb.query(
      `INSERT INTO supplier_listings (listing_code, supplier_id, product_spec_id, available_stock, supplier_min_qty, buyer_min_qty, base_unit_price, pricing_unit, delivery_zones, status)
       VALUES (?, ?, ?, 1000, 1, 1, 5500.00, ?, '["LHR-NORTH-RVI"]', 'ACTIVE')`,
      [`LST-${Date.now()}`, supId, specRows[0].id, specRows[0].purchasing_unit || '50kg Bag']
    );

    const poolCode = `POOL-${Date.now().toString().slice(-8)}`;
    const [poolRes] = await testDb.query(
      `INSERT INTO pools (pool_code, supplier_id, product_id, product_spec_id, supplier_listing_id, target_qty, supplier_min_qty, buyer_min_qty, pool_unit, purchase_increment, delivery_type, delivery_fee_policy, current_price_per_unit, status, expires_at, coverage_policy)
       VALUES (?, ?, ?, ?, ?, 100, 10, 1, 'Bag', 1, 'DOORSTEP', 'INCLUDED_IN_PRICE', 5500.00, 'ACTIVE', DATE_ADD(NOW(), INTERVAL 7 DAY), 'EXPLICIT_CLUSTERS')`,
      [poolCode, supId, pRows[0].id, specRows[0].id, listingRes.insertId]
    );
    const poolId = poolRes.insertId;
    createdPoolIds.push(poolId);
    await testDb.query('INSERT INTO pool_delivery_clusters (pool_id, cluster_id) VALUES (?, 1)', [poolId]);

    // Generate authoritative delivery quote
    const quote1 = await deliveryEligibilityService.createAuthoritativeQuote(buyerId, {
      supplier_id: supId,
      pool_id: poolId,
      cluster_id: 1,
      address_id: initialAddr.id,
      mode: 'STANDARD_CLUSTERED'
    }, testDb);
    createdQuoteCodes.push(quote1.quote_code);

    assert.ok(quote1.destination_address_snapshot, 'destination_address_snapshot must be captured');
    assert.ok(quote1.destination_fingerprint, 'destination_fingerprint must be computed');
    const snap1 = typeof quote1.destination_address_snapshot === 'string'
      ? JSON.parse(quote1.destination_address_snapshot)
      : quote1.destination_address_snapshot;
    assert.strictEqual(snap1.revision, 1, 'Snapshot must capture address revision 1');
    assert.strictEqual(snap1.fingerprint, quote1.destination_fingerprint, 'Snapshot fingerprint must match column fingerprint');
    console.log(`  ✔ Delivery quote ${quote1.quote_code} generated with fingerprint: ${quote1.destination_fingerprint.slice(0, 12)}...`);

    // Now edit address within the SAME cluster (change street from House 12 to House 99)
    await buyerAddressService.updateBuyerAddress(buyerId, initialAddr.id, {
      full_address: 'House 99, Street 10, Gulberg III, Lahore'
    }, testDb);

    const [updatedAddrRows] = await testDb.query(
      'SELECT id, revision, full_address FROM buyer_delivery_addresses WHERE id = ?',
      [initialAddr.id]
    );
    assert.strictEqual(updatedAddrRows[0].revision, 2, 'Address revision must increment to 2 after street update');
    console.log(`  ✔ Address updated: revision incremented to ${updatedAddrRows[0].revision}`);

    // Attempt to accept quote1 — MUST FAIL with ADDRESS_DESTINATION_MISMATCH!
    let editMismatchThrown = false;
    try {
      await deliveryEligibilityService.verifyAndAcceptQuote(buyerId, quote1.quote_code, {}, testDb);
    } catch (err) {
      editMismatchThrown = true;
      assert.strictEqual(err.code, 'ADDRESS_DESTINATION_MISMATCH', `Expected ADDRESS_DESTINATION_MISMATCH, got ${err.code}`);
      console.log(`  ✔ Acceptance blocked after address modification: [${err.code}] ${err.message}`);
    }
    assert.ok(editMismatchThrown, 'Same-cluster address edit must invalidate stale delivery quote');

    // -------------------------------------------------------------------------
    // GATE 4: Atomic Quote Acceptance & Single-Use Enforcement
    // -------------------------------------------------------------------------
    console.log('\n▶ Gate 4: Atomic Quote Acceptance & Replay Prevention...');
    // Generate fresh quote for updated address
    const quote2 = await deliveryEligibilityService.createAuthoritativeQuote(buyerId, {
      supplier_id: supId,
      pool_id: poolId,
      cluster_id: 1,
      address_id: initialAddr.id,
      mode: 'STANDARD_CLUSTERED'
    }, testDb);
    createdQuoteCodes.push(quote2.quote_code);

    // Accept fresh quote
    const acceptedQuote2 = await deliveryEligibilityService.verifyAndAcceptQuote(buyerId, quote2.quote_code, {}, testDb);
    assert.strictEqual(acceptedQuote2.status, 'ACCEPTED', 'Quote status must transition to ACCEPTED');
    console.log(`  ✔ Fresh quote ${quote2.quote_code} accepted successfully`);

    // Replay attempt — MUST FAIL with QUOTE_ALREADY_ACCEPTED
    let replayThrown = false;
    try {
      await deliveryEligibilityService.verifyAndAcceptQuote(buyerId, quote2.quote_code, {}, testDb);
    } catch (err) {
      replayThrown = true;
      assert.strictEqual(err.code, 'QUOTE_ALREADY_ACCEPTED', `Expected QUOTE_ALREADY_ACCEPTED, got ${err.code}`);
      console.log(`  ✔ Replay attempt rejected: [${err.code}] ${err.message}`);
    }
    assert.ok(replayThrown, 'Second acceptance must be rejected with QUOTE_ALREADY_ACCEPTED');

    // Concurrent acceptance test: two parallel calls on PENDING quote
    const quote3 = await deliveryEligibilityService.createAuthoritativeQuote(buyerId, {
      supplier_id: supId,
      pool_id: poolId,
      cluster_id: 1,
      address_id: initialAddr.id,
      mode: 'STANDARD_CLUSTERED'
    }, testDb);
    createdQuoteCodes.push(quote3.quote_code);

    const [raceRes1, raceRes2] = await Promise.allSettled([
      deliveryEligibilityService.verifyAndAcceptQuote(buyerId, quote3.quote_code),
      deliveryEligibilityService.verifyAndAcceptQuote(buyerId, quote3.quote_code)
    ]);

    const successes = [raceRes1, raceRes2].filter(r => r.status === 'fulfilled');
    const failures = [raceRes1, raceRes2].filter(r => r.status === 'rejected');
    assert.strictEqual(successes.length, 1, 'Exactly one concurrent acceptance must succeed');
    assert.strictEqual(failures.length, 1, 'Concurrent competing acceptance must fail');
    console.log(`  ✔ Concurrent acceptance race resolved: 1 accepted, 1 rejected with ${failures[0].reason.code}`);

    // -------------------------------------------------------------------------
    // GATE 5: Decoupled Pickup Discovery Across Lahore
    // -------------------------------------------------------------------------
    console.log('\n▶ Gate 5: Decoupled Pickup Discovery...');
    // Create supplier 2 with pickup in cluster 2
    const sup2Email = `test.sup2.6d33.${Date.now()}@miljor.test`;
    const [s2Res] = await testDb.query(
      `INSERT INTO users (full_name, business_name, email, phone, role, password_hash, verification_status, is_verified, city, base_cluster_id, created_at, updated_at)
       VALUES ('Test Supplier 2', 'Test Mills 2', ?, '+923000000881', 'SUPPLIER', 'hash', 'VERIFIED', 1, 'Lahore', 2, NOW(), NOW())`,
      [sup2Email]
    );
    const sup2Id = s2Res.insertId;
    createdUserIds.push(sup2Id);

    await testDb.query(
      `INSERT INTO supplier_delivery_configurations (supplier_id, standard_delivery_enabled, express_enabled, pickup_enabled)
       VALUES (?, 1, 0, 1)`,
      [sup2Id]
    );
    await testDb.query(
      `INSERT INTO supplier_delivery_cluster_rates (supplier_id, cluster_id, mode, fee_pkr, is_eligible)
       VALUES (?, 2, 'STANDARD_CLUSTERED', 300.00, 1)`,
      [sup2Id]
    );
    await testDb.query(
      `INSERT INTO supplier_pickup_points (supplier_id, cluster_id, point_name, address_line, operating_hours, pickup_handling_fee_pkr, is_active)
       VALUES (?, 2, 'Remote Warehouse Model Town', 'Block C Model Town, Lahore', '10:00 - 17:00', 40.00, 1)`,
      [sup2Id]
    );

    const [listing2Res] = await testDb.query(
      `INSERT INTO supplier_listings (listing_code, supplier_id, product_spec_id, available_stock, supplier_min_qty, buyer_min_qty, base_unit_price, pricing_unit, delivery_zones, status)
       VALUES (?, ?, ?, 1000, 1, 1, 5500.00, ?, '["LHR-NORTH-RVI"]', 'ACTIVE')`,
      [`LST2-${Date.now()}`, sup2Id, specRows[0].id, specRows[0].purchasing_unit || '50kg Bag']
    );

    // Create a pool in cluster 2 for supplier 2
    const [pool2Res] = await testDb.query(
      `INSERT INTO pools (pool_code, supplier_id, product_id, product_spec_id, supplier_listing_id, target_qty, supplier_min_qty, buyer_min_qty, pool_unit, purchase_increment, delivery_type, delivery_fee_policy, current_price_per_unit, status, expires_at, coverage_policy)
       VALUES (?, ?, ?, ?, ?, 100, 10, 1, 'Bag', 1, 'DOORSTEP', 'INCLUDED_IN_PRICE', 5500.00, 'ACTIVE', DATE_ADD(NOW(), INTERVAL 7 DAY), 'EXPLICIT_CLUSTERS')`,
      [`PKP-${Date.now().toString().slice(-8)}`, sup2Id, pRows[0].id, specRows[0].id, listing2Res.insertId]
    );
    const pool2Id = pool2Res.insertId;
    createdPoolIds.push(pool2Id);
    await testDb.query('INSERT INTO pool_delivery_clusters (pool_id, cluster_id) VALUES (?, 2)', [pool2Id]);

    // Discover with cluster_id = 1 (local delivery): pool2Id should NOT appear in local delivery to cluster 1
    const localDelivRes = await poolRepo.findAllActive({ cluster_id: 1 });
    const pool2InLocal = localDelivRes.filter(p => p.id === pool2Id);
    assert.strictEqual(pool2InLocal.length, 0, 'Pool authorizing cluster 2 with pickup in cluster 2 must not appear in cluster 1 delivery feed');

    // Discover with fulfillment_mode=PICKUP across Lahore: pool2Id SHOULD appear as pickup opportunity!
    const pickupAllRes = await poolRepo.findAllActive({ fulfillment_mode: 'PICKUP', include_all_pickup: true });
    const pool2InPickup = pickupAllRes.filter(p => p.id === pool2Id);
    assert.strictEqual(pool2InPickup.length, 1, 'Pool with active supplier pickup must appear in Lahore pickup discovery');
    console.log('  ✔ Pickup discovery decoupled: remote pickup opportunities discovered without polluting local delivery feed');

    // -------------------------------------------------------------------------
    // GATE 6: Delivery Availability Accurate Representation
    // -------------------------------------------------------------------------
    console.log('\n▶ Gate 6: Mode-Specific Delivery Availability Representation...');
    const poolProgressService = require('../src/services/poolProgressService');
    const snapshot1 = await poolProgressService.getPoolSnapshot(poolId);
    assert.strictEqual(snapshot1.standard_delivery_available, true, 'standard_delivery_available must be true');
    assert.strictEqual(snapshot1.express_delivery_available, true, 'express_delivery_available must be true');
    assert.strictEqual(snapshot1.pickup_available, true, 'pickup_available must be true');
    assert.ok(snapshot1.fulfillment_modes_available.includes('STANDARD_CLUSTERED'), 'modes must include STANDARD_CLUSTERED');
    assert.ok(snapshot1.fulfillment_modes_available.includes('EXPRESS'), 'modes must include EXPRESS');
    assert.ok(snapshot1.fulfillment_modes_available.includes('SUPPLIER_PICKUP'), 'modes must include SUPPLIER_PICKUP');
    console.log('  ✔ Pool snapshot reports accurate, authoritative fulfillment modes');

    // -------------------------------------------------------------------------
    // GATE 7: Published Pool Commercial Coverage Locking
    // -------------------------------------------------------------------------
    console.log('\n▶ Gate 7: Published Pool Commercial Coverage Locking Under Active Quotes...');
    // Generate an unexpired PENDING quote for poolId in cluster 1
    const activeQuote = await deliveryEligibilityService.createAuthoritativeQuote(buyerId, {
      supplier_id: supId,
      pool_id: poolId,
      cluster_id: 1,
      address_id: initialAddr.id,
      mode: 'STANDARD_CLUSTERED'
    }, testDb);
    createdQuoteCodes.push(activeQuote.quote_code);

    const supToken = jwt.sign(
      { id: supId, email: supEmail, role: 'SUPPLIER' },
      process.env.JWT_SECRET,
      { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
    );

    // Supplier attempts to remove cluster 1 from active pool coverage while active quote exists
    const removeClusterRes = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/v1/pools/${poolId}/clusters`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supToken}`
      }
    }, {
      delivery_clusters: [] // Trying to remove cluster 1
    });

    assert.strictEqual(removeClusterRes.status, 422, 'Cluster removal must fail with 422 when active quotes exist');
    assert.strictEqual(removeClusterRes.body.error.code, 'POOL_COVERAGE_LOCKED');
    console.log(`  ✔ Commercial coverage mutation locked under active quotes: [${removeClusterRes.body.error.code}] ${removeClusterRes.body.error.message}`);

    // -------------------------------------------------------------------------
    // GATE 8: Buyer Default Address Invariant Under Concurrency
    // -------------------------------------------------------------------------
    console.log('\n▶ Gate 8: Buyer Default Address Invariant Under Concurrency...');
    // Create 3 additional addresses in parallel for the buyer with is_default: true
    const createPromises = [];
    for (let i = 1; i <= 3; i++) {
      createPromises.push(
        buyerAddressRepo.createAddress({
          user_id: buyerId,
          city: 'Lahore',
          cluster_id: 1,
          society_area: `Gulberg Area ${i}`,
          full_address: `Building ${i}, Lahore`,
          is_default: true
        })
      );
    }
    await Promise.all(createPromises);

    const [defaults] = await testDb.query(
      'SELECT id, is_default FROM buyer_delivery_addresses WHERE user_id = ? AND is_default = 1',
      [buyerId]
    );
    assert.strictEqual(defaults.length, 1, `Exactly 1 default address must exist, found ${defaults.length}`);
    console.log('  ✔ Buyer parent-row serialization guarantees at most 1 default address under concurrency');

    // -------------------------------------------------------------------------
    // GATE 9: Exact Decimal Financial Handling
    // -------------------------------------------------------------------------
    console.log('\n▶ Gate 9: Exact Decimal Monetary Calculation...');
    const [rateCheck] = await testDb.query(
      "SELECT fee_pkr FROM supplier_delivery_cluster_rates WHERE supplier_id = ? AND cluster_id = 1 AND mode = 'STANDARD_CLUSTERED'",
      [supId]
    );
    assert.strictEqual(Number(rateCheck[0].fee_pkr), 250.00);
    assert.strictEqual(Number(quote2.quoted_delivery_fee_pkr), 250.00);
    console.log('  ✔ Exact decimal fee matching: supplier configured PKR 250.00 === quoted PKR 250.00');

    // -------------------------------------------------------------------------
    // GATE 10: Geographic Boundary Integrity (Synthetic Lahore Polygon)
    // -------------------------------------------------------------------------
    console.log('\n▶ Gate 10: Geographic Verification & Boundary Integrity...');
    // Pin at Lahore core (Gulberg)
    assert.strictEqual(geoService.isWithinLahoreDistrict(31.5204, 74.3587), true, 'Lahore center must be inside district');
    // Pin in Kasur (outside Lahore)
    assert.strictEqual(geoService.isWithinLahoreDistrict(31.1167, 74.4500), false, 'Kasur must be outside district');
    console.log('  ✔ Geospatial district boundary enforcement verified');

    // -------------------------------------------------------------------------
    // GATE 11: Google/Email & Legacy Account Compatibility
    // -------------------------------------------------------------------------
    console.log('\n▶ Gate 11: Buyer Onboarding & Base Cluster Flow...');
    const buyerWithoutAddrEmail = `buyer.noaddr.${Date.now()}@miljor.test`;
    const [noAddrRes] = await testDb.query(
      `INSERT INTO users (full_name, business_name, email, phone, role, password_hash, verification_status, is_verified, city, base_cluster_id, created_at, updated_at)
       VALUES ('No Address Buyer', 'No Address Store', ?, '+923000000887', 'BUYER', 'hash', 'VERIFIED', 1, 'Lahore', 1, NOW(), NOW())`,
      [buyerWithoutAddrEmail]
    );
    const noAddrBuyerId = noAddrRes.insertId;
    createdUserIds.push(noAddrBuyerId);

    // Can generate pickup quote without delivery address
    const pickupQuoteNoAddr = await deliveryEligibilityService.createAuthoritativeQuote(noAddrBuyerId, {
      supplier_id: supId,
      pool_id: poolId,
      cluster_id: 1,
      mode: 'PICKUP'
    }, testDb);
    createdQuoteCodes.push(pickupQuoteNoAddr.quote_code);
    assert.strictEqual(pickupQuoteNoAddr.mode, 'PICKUP');
    assert.strictEqual(pickupQuoteNoAddr.address_id, null);
    console.log('  ✔ Pickup quote generated successfully without delivery address');

    // -------------------------------------------------------------------------
    // GATE 12: Privacy of Quote Destination Snapshots
    // -------------------------------------------------------------------------
    console.log('\n▶ Gate 12: Privacy of Quote Snapshots...');
    // Query public pool endpoints
    const publicPoolsRes = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/pools',
      method: 'GET'
    });
    assert.strictEqual(publicPoolsRes.status, 200);
    const poolsStr = JSON.stringify(publicPoolsRes.body);
    assert.strictEqual(poolsStr.includes('destination_address_snapshot'), false, 'Public pools must NOT leak destination_address_snapshot');
    assert.strictEqual(poolsStr.includes('destination_fingerprint'), false, 'Public pools must NOT leak destination_fingerprint');

    const singlePoolRes = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/v1/pools/${poolId}`,
      method: 'GET'
    });
    assert.strictEqual(singlePoolRes.status, 200);
    const singleStr = JSON.stringify(singlePoolRes.body);
    assert.strictEqual(singleStr.includes('destination_address_snapshot'), false, 'Single pool endpoint must NOT leak destination_address_snapshot');
    assert.strictEqual(singleStr.includes('destination_fingerprint'), false, 'Single pool endpoint must NOT leak destination_fingerprint');
    console.log('  ✔ Private customer destination data protected from public pool serialization');

    // -------------------------------------------------------------------------
    // GATE 13, 14 & 15: miljor_db Database Isolation & Full Pristine Baseline
    // -------------------------------------------------------------------------
    console.log('\n▶ Gate 13, 14 & 15: Database Isolation (miljor_db PRISTINE Verification)...');
    const [devPdcCheck] = await devDb.query("SHOW TABLES LIKE 'pool_delivery_clusters'");
    assert.strictEqual(devPdcCheck.length, 0, 'Table pool_delivery_clusters must NOT exist on miljor_db');

    const [devBaseColCheck] = await devDb.query("SHOW COLUMNS FROM users LIKE 'base_cluster_id'");
    assert.strictEqual(devBaseColCheck.length, 0, 'Column users.base_cluster_id must NOT exist on miljor_db');

    const [devQuotesCheck] = await devDb.query("SHOW COLUMNS FROM delivery_quotes LIKE 'destination_address_snapshot'");
    assert.strictEqual(devQuotesCheck.length, 0, 'Column delivery_quotes.destination_address_snapshot must NOT exist on miljor_db');

    const [devFpCheck] = await devDb.query("SHOW COLUMNS FROM delivery_quotes LIKE 'destination_fingerprint'");
    assert.strictEqual(devFpCheck.length, 0, 'Column delivery_quotes.destination_fingerprint must NOT exist on miljor_db');

    const [devRevCheck] = await devDb.query("SHOW COLUMNS FROM buyer_delivery_addresses LIKE 'revision'");
    assert.strictEqual(devRevCheck.length, 0, 'Column buyer_delivery_addresses.revision must NOT exist on miljor_db');

    const [devMigRows] = await devDb.query('SELECT version FROM schema_migrations ORDER BY id DESC LIMIT 1');
    assert.strictEqual(devMigRows[0].version, '026', `miljor_db must remain on version 026, found ${devMigRows[0].version}`);
    console.log('  ✔ miljor_db verified 100% PRISTINE (0 schema mutations, version = 026)');

    console.log('\n================================================================================');
    console.log('🎉 ALL 15 PHASE 6D.3.3 QUALITY GATES PASSED (100% VERIFIED)!');
    console.log('================================================================================\n');

  } finally {
    try {
      if (testDb) {
        if (createdQuoteCodes.length > 0) {
          await testDb.query('DELETE FROM delivery_quotes WHERE quote_code IN (?)', [createdQuoteCodes]);
        }
        if (createdPoolIds.length > 0) {
          await testDb.query('DELETE FROM pool_delivery_clusters WHERE pool_id IN (?)', [createdPoolIds]);
          await testDb.query('DELETE FROM pools WHERE id IN (?)', [createdPoolIds]);
        }
        if (createdUserIds.length > 0) {
          await testDb.query('DELETE FROM buyer_delivery_addresses WHERE user_id IN (?)', [createdUserIds]);
          await testDb.query('DELETE FROM supplier_delivery_configurations WHERE supplier_id IN (?)', [createdUserIds]);
          await testDb.query('DELETE FROM supplier_delivery_cluster_rates WHERE supplier_id IN (?)', [createdUserIds]);
          await testDb.query('DELETE FROM supplier_pickup_points WHERE supplier_id IN (?)', [createdUserIds]);
          await testDb.query('DELETE FROM supplier_listings WHERE supplier_id IN (?)', [createdUserIds]);
          await testDb.query('DELETE FROM supplier_profiles WHERE supplier_id IN (?)', [createdUserIds]);
          await testDb.query('DELETE FROM users WHERE id IN (?)', [createdUserIds]);
        }
        await testDb.end();
      }
      if (devDb) await devDb.end();
      if (serverInstance) serverInstance.close();
    } catch (cleanupErr) {
      console.error('Cleanup warning:', cleanupErr.message);
    }
  }
}

if (require.main === module) {
  runGate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Phase 6D.3.3 Gate Failed:', err);
      process.exit(1);
    });
}

module.exports = { runGate };
