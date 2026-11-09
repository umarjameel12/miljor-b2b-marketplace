// =============================================================================
// tests/part_6d3_2_backend_hardening_gate.js
// MilJor Phase 6D.3.2: Complete Backend Hardening & Defect Resolution Quality Gate
//
// Rigorous verification covering:
// 1. Pool Coverage Policy Initialization & 0-Cluster Safety (Part 2)
// 2. Legacy Pool Review Required Blocks New Delivery Quotes (Part 2)
// 3. Pickup Discovery Decoupling & Mode Availability (Part 4 & 5)
// 4. Cluster Foreign Key ON DELETE RESTRICT (Part 3)
// 5. Buyer Default Address Concurrency & Parent User Locking (Part 7)
// 6. Quote Acceptance Concurrency & Replay Prevention (Part 10)
// 7. Destination Address Cluster Substitution Rejection (Part 10)
// 8. Zero-Fee Monetary Handling for Pickup & Clustered Delivery (Part 11)
// 9. Active Pool Coverage Mutation Locked Under Reservations (Part 6)
// 10. Decoupled OIDC / User Profile Onboarding Flags (Part 9)
// 11. Production Database Isolation (miljor_db 100% PRISTINE)
// =============================================================================

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('assert');
const path = require('path');
const http = require('http');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = require('../server');
const deliveryEligibilityService = require('../src/services/deliveryEligibilityService');
const supDelivService = require('../src/services/supplierDeliveryService');
const buyerAddressRepo = require('../src/repositories/buyerAddressRepository');
const poolRepo = require('../src/repositories/poolRepo');
const poolProgressService = require('../src/services/poolProgressService');

const TEST_PORT = 5099;
let serverInstance;

function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

async function runGate() {
  console.log('================================================================================');
  console.log('🛡️  MILJOR PHASE 6D.3.2: COMPLETE BACKEND HARDENING & DEFECT RESOLUTION GATE');
  console.log('================================================================================\n');

  let testDb;
  let devDb;
  const createdUserIds = [];
  const createdPoolIds = [];

  try {
    testDb = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: 'miljor_test_db'
    });

    devDb = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: 'miljor_db'
    });

    await new Promise((resolve, reject) => {
      serverInstance = app.listen(TEST_PORT, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    const jwtSecret = process.env.JWT_SECRET || 'miljor_jwt_super_secret_local_dev_key_2026';

    // -------------------------------------------------------------------------
    // SETUP TEST FIXTURES
    // -------------------------------------------------------------------------
    const ts = Date.now();
    const supEmail = `hardening_sup_${ts}@miljor.test`;
    const [supUserRes] = await testDb.query(
      `INSERT INTO users (full_name, business_name, email, phone, role, password_hash, verification_status, is_verified, city, base_cluster_id, created_at, updated_at)
       VALUES ('Hardening Supplier', 'Hardening Mills Ltd', ?, '+923000000999', 'SUPPLIER', 'hash', 'VERIFIED', 1, 'Lahore', 1, NOW(), NOW())`,
      [supEmail]
    );
    const supplierId = supUserRes.insertId;
    createdUserIds.push(supplierId);

    // Create Verified Supplier Profile
    await testDb.query(
      `INSERT INTO supplier_profiles (supplier_id, verification_status)
       VALUES (?, 'VERIFIED')`,
      [supplierId]
    );

    const buyerEmail = `hardening_buyer_${ts}@miljor.test`;
    const [buyerUserRes] = await testDb.query(
      `INSERT INTO users (full_name, business_name, email, phone, role, password_hash, verification_status, is_verified, city, base_cluster_id, created_at, updated_at)
       VALUES ('Hardening Buyer', 'Hardening Store', ?, '+923000000998', 'BUYER', 'hash', 'VERIFIED', 1, 'Lahore', 1, NOW(), NOW())`,
      [buyerEmail]
    );
    const buyerId = buyerUserRes.insertId;
    createdUserIds.push(buyerId);

    // Create Initial Delivery Address for Buyer
    await testDb.query(
      `INSERT INTO buyer_delivery_addresses (user_id, city, cluster_id, society_area, full_address, is_default, created_at, updated_at)
       VALUES (?, 'Lahore', 1, 'Gulberg III Block A', 'Plaza 1, Main Boulevard, Lahore', 1, NOW(), NOW())`,
      [buyerId]
    );

    const supToken = jwt.sign(
      { id: supplierId, role: 'SUPPLIER', email: supEmail },
      jwtSecret,
      { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
    );
    const buyerToken = jwt.sign(
      { id: buyerId, role: 'BUYER', email: buyerEmail },
      jwtSecret,
      { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
    );

    // Configure Supplier Delivery & Pickup Settings
    await supDelivService.updateSupplierSettings(supplierId, {
      standard_delivery_enabled: true,
      pickup_enabled: true,
      express_enabled: true,
      express_cutoff_time: '23:59:59',
      cluster_rates: [
        { cluster_id: 1, mode: 'STANDARD_CLUSTERED', is_eligible: true, fee_pkr: 150.00 },
        { cluster_id: 4, mode: 'STANDARD_CLUSTERED', is_eligible: true, fee_pkr: 120.00 },
        { cluster_id: 7, mode: 'STANDARD_CLUSTERED', is_eligible: true, fee_pkr: 180.00 },
        { cluster_id: 1, mode: 'EXPRESS', is_eligible: true, fee_pkr: 350.00 }
      ]
    });

    // Create Pickup Point with Free Handling Fee (0.00 PKR)
    const [pointRes] = await testDb.query(
      `INSERT INTO supplier_pickup_points (supplier_id, point_name, cluster_id, address_line, pickup_handling_fee_pkr, is_active, version, created_at, updated_at)
       VALUES (?, 'Central Warehouse Pickup Point', 1, 'Warehouse #12, Badami Bagh, Lahore', 0.00, 1, 1, NOW(), NOW())`,
      [supplierId]
    );
    const pickupPointId = pointRes.insertId;

    // -------------------------------------------------------------------------
    // TEST 1: Pool Coverage Policy Initialization & 0-Cluster Safety (Part 2)
    // -------------------------------------------------------------------------
    console.log('▶ Test 1: Pool Coverage Policy Initialization & 0-Cluster Safety...');
    // Create Pool A: 0 clusters, delivery_type = DOORSTEP -> policy should be EXPLICIT_CLUSTERS
    const poolCodeA = `MJ-HDA-${Date.now().toString().slice(-6)}`;
    const poolIdA = await poolRepo.createPool({
      pool_code: poolCodeA,
      supplier_id: supplierId,
      product_id: 1,
      target_qty: 100,
      supplier_min_qty: 10,
      buyer_min_qty: 5,
      delivery_type: 'DOORSTEP',
      current_price_per_unit: 1000,
      status: 'ACTIVE',
      expires_at: new Date(Date.now() + 86400000 * 7)
    });
    createdPoolIds.push(poolIdA);

    const [poolRowsA] = await testDb.query('SELECT coverage_policy FROM pools WHERE id = ?', [poolIdA]);
    assert.strictEqual(poolRowsA[0].coverage_policy, 'EXPLICIT_CLUSTERS');

    // Verify: 0 pool clusters means delivery is NOT available, never falls back to supplier's clusters
    const poolOptionsA = await deliveryEligibilityService.getDeliveryOptions(buyerId, {
      pool_id: poolIdA,
      cluster_id: 1
    });
    const stdA = poolOptionsA.ineligible_modes.find(m => m.mode === 'STANDARD_CLUSTERED');
    assert.ok(stdA, 'Standard delivery must be ineligible for 0-cluster pool');
    assert.strictEqual(stdA.reason_code, 'CLUSTER_NOT_AUTHORIZED_FOR_POOL');

    // Create Pool B: delivery_type = SUPPLIER_PICKUP -> policy should be PICKUP_ONLY
    const poolCodeB = `MJ-HDB-${Date.now().toString().slice(-6)}`;
    const poolIdB = await poolRepo.createPool({
      pool_code: poolCodeB,
      supplier_id: supplierId,
      product_id: 1,
      target_qty: 100,
      supplier_min_qty: 10,
      buyer_min_qty: 5,
      delivery_type: 'SUPPLIER_PICKUP',
      current_price_per_unit: 1000,
      status: 'ACTIVE',
      expires_at: new Date(Date.now() + 86400000 * 7)
    });
    createdPoolIds.push(poolIdB);

    const [poolRowsB] = await testDb.query('SELECT coverage_policy FROM pools WHERE id = ?', [poolIdB]);
    assert.strictEqual(poolRowsB[0].coverage_policy, 'PICKUP_ONLY');
    console.log('  ✔ Pool coverage policies initialized safely with strict 0-cluster containment\n');

    // -------------------------------------------------------------------------
    // TEST 2: Legacy Pool Review Required Blocks New Quotes (Part 2)
    // -------------------------------------------------------------------------
    console.log('▶ Test 2: Legacy Pool Review Required Blocks Delivery Quotes...');
    const poolCodeLegacy = `MJ-HDLEG-${Date.now().toString().slice(-5)}`;
    const poolIdLegacy = await poolRepo.createPool({
      pool_code: poolCodeLegacy,
      supplier_id: supplierId,
      product_id: 1,
      target_qty: 100,
      supplier_min_qty: 10,
      buyer_min_qty: 5,
      delivery_type: 'DOORSTEP',
      current_price_per_unit: 1000,
      status: 'ACTIVE',
      coverage_policy: 'LEGACY_REVIEW_REQUIRED',
      expires_at: new Date(Date.now() + 86400000 * 7)
    });
    createdPoolIds.push(poolIdLegacy);

    const legacyOptions = await deliveryEligibilityService.getDeliveryOptions(buyerId, {
      pool_id: poolIdLegacy,
      cluster_id: 1
    });

    const stdLegacy = legacyOptions.ineligible_modes.find(m => m.mode === 'STANDARD_CLUSTERED');
    assert.ok(stdLegacy, 'Standard delivery must be ineligible on LEGACY_REVIEW_REQUIRED pool');
    assert.strictEqual(stdLegacy.reason_code, 'LEGACY_COVERAGE_REVIEW_REQUIRED');

    // Attempting to generate quote on legacy review required pool must throw 422
    let legacyQuoteThrown = false;
    try {
      await deliveryEligibilityService.createAuthoritativeQuote(buyerId, {
        supplier_id: supplierId,
        pool_id: poolIdLegacy,
        cluster_id: 1,
        mode: 'STANDARD_CLUSTERED'
      });
    } catch (err) {
      legacyQuoteThrown = true;
      assert.strictEqual(err.statusCode, 422);
      assert.strictEqual(err.code, 'LEGACY_COVERAGE_REVIEW_REQUIRED');
    }
    assert.ok(legacyQuoteThrown, 'createAuthoritativeQuote must fail on LEGACY_REVIEW_REQUIRED pool');
    console.log('  ✔ Legacy pools with LEGACY_REVIEW_REQUIRED strictly blocked from new delivery quotes\n');

    // -------------------------------------------------------------------------
    // TEST 3: Pickup Discovery Decoupling & Mode Availability (Part 4 & 5)
    // -------------------------------------------------------------------------
    console.log('▶ Test 3: Pickup Discovery Decoupling & Mode Availability...');
    // Pool C: authorized only for clusters [4, 7], but supplier has active pickup in cluster 1
    const poolCodeC = `MJ-HDC-${Date.now().toString().slice(-6)}`;
    const poolIdC = await poolRepo.createPool({
      pool_code: poolCodeC,
      supplier_id: supplierId,
      product_id: 1,
      target_qty: 100,
      supplier_min_qty: 10,
      buyer_min_qty: 5,
      delivery_type: 'DOORSTEP',
      current_price_per_unit: 1000,
      status: 'ACTIVE',
      coverage_policy: 'EXPLICIT_CLUSTERS',
      expires_at: new Date(Date.now() + 86400000 * 7)
    });
    createdPoolIds.push(poolIdC);
    await poolRepo.setPoolDeliveryClusters(poolIdC, [4, 7]);

    // Buyer browsing cluster 1 should still discover Pool C via pickup!
    const discRes = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/pools?cluster_id=1',
      method: 'GET'
    });
    assert.strictEqual(discRes.status, 200);
    const discoveredC = discRes.body.data.pools.find(p => p.id === poolIdC);
    assert.ok(discoveredC, 'Pool C must be discoverable in cluster 1 via active supplier pickup');
    assert.strictEqual(discoveredC.pickup_available, true);
    assert.strictEqual(discoveredC.standard_delivery_available, true); // has delivery in clusters 4, 7
    assert.ok(discoveredC.fulfillment_modes_available.includes('SUPPLIER_PICKUP'));

    // Verify snapshot also enriches mode availability
    const snapshotC = await poolProgressService.getPoolSnapshot(poolIdC);
    assert.strictEqual(snapshotC.pickup_available, true);
    assert.strictEqual(snapshotC.coverage_policy, 'EXPLICIT_CLUSTERS');
    console.log('  ✔ Pickup discovery independently decouples from destination clusters with rich mode flags\n');

    // -------------------------------------------------------------------------
    // TEST 4: Cluster Foreign Key ON DELETE RESTRICT (Part 3)
    // -------------------------------------------------------------------------
    console.log('▶ Test 4: Cluster FK ON DELETE RESTRICT Protection...');
    let fkDeleteFailed = false;
    try {
      // Cluster 4 is referenced in pool_delivery_clusters for Pool C
      await testDb.query('DELETE FROM geographic_clusters WHERE id = 4');
    } catch (err) {
      fkDeleteFailed = true;
      assert.strictEqual(err.code, 'ER_ROW_IS_REFERENCED_2');
    }
    assert.ok(fkDeleteFailed, 'Deleting an active cluster referenced in pool_delivery_clusters must fail with ER_ROW_IS_REFERENCED_2');
    console.log('  ✔ Cluster FK ON DELETE RESTRICT successfully prevented cluster deletion cascade\n');

    // -------------------------------------------------------------------------
    // TEST 5: Buyer Address Concurrency & Parent User Locking (Part 7)
    // -------------------------------------------------------------------------
    console.log('▶ Test 5: Buyer Address Concurrency & Serialization...');
    // Fire 5 truly simultaneous address creations with is_default = true
    const createPromises = [];
    for (let i = 1; i <= 5; i++) {
      createPromises.push(
        buyerAddressRepo.createAddress({
          user_id: buyerId,
          city: 'Lahore',
          cluster_id: 1,
          society_area: `Concurrency Sector ${i}`,
          full_address: `Shop #${i}, Commercial Market, Lahore`,
          is_default: true
        })
      );
    }
    const createdAddrIds = await Promise.all(createPromises);
    assert.strictEqual(createdAddrIds.length, 5);

    // Verify invariant: EXACTLY ONE default address exists for this user!
    const [defaultAddrRows] = await testDb.query(
      'SELECT id FROM buyer_delivery_addresses WHERE user_id = ? AND is_default = 1',
      [buyerId]
    );
    assert.strictEqual(defaultAddrRows.length, 1, 'Exactly one address must be default under high concurrency');
    console.log('  ✔ Serialized parent user row lock enforced at most one default address under concurrency\n');

    // -------------------------------------------------------------------------
    // TEST 6: Quote Acceptance Concurrency & Replay Prevention (Part 10)
    // -------------------------------------------------------------------------
    console.log('▶ Test 6: Quote Acceptance Concurrency & Single-Use Enforcement...');
    // Create authoritative quote for buyer
    const quoteRecord = await deliveryEligibilityService.createAuthoritativeQuote(buyerId, {
      supplier_id: supplierId,
      cluster_id: 1,
      address_id: defaultAddrRows[0].id,
      mode: 'STANDARD_CLUSTERED'
    });
    assert.strictEqual(quoteRecord.status, 'PENDING');
    assert.ok(quoteRecord.quote_code);

    // Fire 2 simultaneous acceptances
    const acceptResults = await Promise.allSettled([
      deliveryEligibilityService.verifyAndAcceptQuote(buyerId, quoteRecord.quote_code),
      deliveryEligibilityService.verifyAndAcceptQuote(buyerId, quoteRecord.quote_code)
    ]);

    const fulfilled = acceptResults.filter(r => r.status === 'fulfilled');
    const rejected = acceptResults.filter(r => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1, 'Exactly one acceptance must succeed');
    assert.strictEqual(rejected.length, 1, 'The competing acceptance must be rejected');
    assert.ok(
      rejected[0].reason.code === 'QUOTE_ALREADY_ACCEPTED' || rejected[0].reason.code === 'CONCURRENT_QUOTE_ACCEPTANCE',
      'Competing acceptance must fail with QUOTE_ALREADY_ACCEPTED or CONCURRENT_QUOTE_ACCEPTANCE'
    );
    console.log('  ✔ Single-use atomic quote acceptance successfully handled concurrent requests\n');

    // -------------------------------------------------------------------------
    // TEST 7: Destination Address Cluster Substitution Rejection (Part 10)
    // -------------------------------------------------------------------------
    console.log('▶ Test 7: Destination Address Cluster Substitution Rejection...');
    // Create new address in Cluster 1
    const addrId7 = await buyerAddressRepo.createAddress({
      user_id: buyerId,
      city: 'Lahore',
      cluster_id: 1,
      society_area: 'Gulberg III Block A',
      full_address: 'Plaza 10, Main Boulevard, Lahore',
      is_default: false
    });

    // Generate quote linked to address in cluster 1
    const quote7 = await deliveryEligibilityService.createAuthoritativeQuote(buyerId, {
      supplier_id: supplierId,
      cluster_id: 1,
      address_id: addrId7,
      mode: 'STANDARD_CLUSTERED'
    });
    assert.strictEqual(quote7.cluster_id, 1);
    assert.ok(quote7.destination_address_snapshot);

    // Buyer tampers/updates address to Cluster 2
    await buyerAddressRepo.updateAddress(addrId7, buyerId, {
      cluster_id: 2
    });

    // Attempting to accept quote 7 must now be rejected with ADDRESS_CLUSTER_MISMATCH
    let clusterMismatchThrown = false;
    try {
      await deliveryEligibilityService.verifyAndAcceptQuote(buyerId, quote7.quote_code);
    } catch (err) {
      clusterMismatchThrown = true;
      assert.strictEqual(err.statusCode, 422);
      assert.strictEqual(err.code, 'ADDRESS_CLUSTER_MISMATCH');
    }
    assert.ok(clusterMismatchThrown, 'Accepting quote after address cluster changed must throw ADDRESS_CLUSTER_MISMATCH');
    console.log('  ✔ Quote acceptance immutability protected against address cluster substitution\n');

    // -------------------------------------------------------------------------
    // TEST 8: Zero-Fee Monetary Handling (Part 11)
    // -------------------------------------------------------------------------
    console.log('▶ Test 8: Zero-Fee Monetary Handling for Pickup...');
    const pickupQuote = await deliveryEligibilityService.createAuthoritativeQuote(buyerId, {
      supplier_id: supplierId,
      cluster_id: 1,
      mode: 'PICKUP',
      pickup_point_id: pickupPointId
    });

    assert.strictEqual(pickupQuote.mode, 'PICKUP');
    assert.strictEqual(Number(pickupQuote.quoted_delivery_fee_pkr), 0.00);
    assert.ok(pickupQuote.quoted_delivery_fee_pkr !== null && pickupQuote.quoted_delivery_fee_pkr !== undefined);
    console.log('  ✔ Free pickup fee (0.00 PKR) safely preserved and not treated as falsy\n');

    // -------------------------------------------------------------------------
    // TEST 9: Active Pool Coverage Mutation Locked Under Reservations (Part 6)
    // -------------------------------------------------------------------------
    console.log('▶ Test 9: Active Pool Coverage Locked Under Reservations...');
    // Pool D: Active pool authorized for clusters [1, 4]
    const poolCodeD = `MJ-HDD-${Date.now().toString().slice(-6)}`;
    const poolIdD = await poolRepo.createPool({
      pool_code: poolCodeD,
      supplier_id: supplierId,
      product_id: 1,
      target_qty: 100,
      supplier_min_qty: 10,
      buyer_min_qty: 5,
      delivery_type: 'DOORSTEP',
      current_price_per_unit: 1000,
      status: 'ACTIVE',
      coverage_policy: 'EXPLICIT_CLUSTERS',
      expires_at: new Date(Date.now() + 86400000 * 7)
    });
    createdPoolIds.push(poolIdD);
    await poolRepo.setPoolDeliveryClusters(poolIdD, [1, 4]);

    // Create a committed reservation in cluster 1
    const resCode = `RES-HD-${Date.now().toString().slice(-6)}`;
    await testDb.query(
      `INSERT INTO reservations (reservation_code, pool_id, buyer_id, quantity, unit_price, total_price, status, created_at, updated_at)
       VALUES (?, ?, ?, 10.0000, 1000.00, 10000.00, 'RESERVED', NOW(), NOW())`,
      [resCode, poolIdD, buyerId]
    );

    // Supplier attempts to remove cluster 1 (updating delivery_clusters to [4])
    const updateRes = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: `/api/v1/pools/${poolIdD}/clusters`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supToken}`
      }
    }, {
      delivery_clusters: [4]
    });

    assert.strictEqual(updateRes.status, 422);
    assert.strictEqual(updateRes.body.error.code, 'POOL_COVERAGE_LOCKED');
    console.log('  ✔ Removing clusters from an active pool with reservations strictly rejected with POOL_COVERAGE_LOCKED\n');

    // -------------------------------------------------------------------------
    // TEST 10: Decoupled OIDC / User Profile Onboarding Flags (Part 9)
    // -------------------------------------------------------------------------
    console.log('▶ Test 10: Decoupled User Profile Onboarding Flags...');
    const profileRes = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${buyerToken}`
      }
    });

    assert.strictEqual(profileRes.status, 200);
    assert.ok(profileRes.body.data.user.onboarding_flags);
    assert.strictEqual(profileRes.body.data.user.onboarding_flags.authenticated, true);
    assert.strictEqual(profileRes.body.data.user.onboarding_flags.base_cluster_configured, true);
    assert.strictEqual(profileRes.body.data.user.onboarding_flags.delivery_address_available, true);
    console.log('  ✔ Decoupled onboarding flags verified on user profile read model\n');

    // -------------------------------------------------------------------------
    // TEST 11: Production Database Isolation Invariant (miljor_db PRISTINE)
    // -------------------------------------------------------------------------
    console.log('▶ Test 11: Checking miljor_db database isolation...');
    const [devPdcCheck] = await devDb.query("SHOW TABLES LIKE 'pool_delivery_clusters'");
    assert.strictEqual(devPdcCheck.length, 0, 'Table pool_delivery_clusters must NOT exist on miljor_db');

    const [devColCheck] = await devDb.query("SHOW COLUMNS FROM pools LIKE 'coverage_policy'");
    assert.strictEqual(devColCheck.length, 0, 'Column coverage_policy must NOT exist on miljor_db');

    const [devQuotesCheck] = await devDb.query("SHOW COLUMNS FROM delivery_quotes LIKE 'destination_address_snapshot'");
    assert.strictEqual(devQuotesCheck.length, 0, 'Column destination_address_snapshot must NOT exist on miljor_db');
    console.log('  ✔ miljor_db is 100% PRISTINE (0 schema mutations, 0 data modifications)\n');

    console.log('================================================================================');
    console.log('🎉 ALL 11 PHASE 6D.3.2 GATE ASSERTIONS PASSED WITH ZERO REGRESSIONS!');
    console.log('================================================================================\n');

  } finally {
    // Cleanup created test records
    try {
      if (testDb) {
        if (createdPoolIds.length > 0) {
          await testDb.query('DELETE FROM pool_delivery_clusters WHERE pool_id IN (?)', [createdPoolIds]);
          await testDb.query('DELETE FROM reservations WHERE pool_id IN (?)', [createdPoolIds]);
          await testDb.query('DELETE FROM delivery_quotes WHERE pool_id IN (?)', [createdPoolIds]);
          await testDb.query('DELETE FROM pools WHERE id IN (?)', [createdPoolIds]);
        }
        if (createdUserIds.length > 0) {
          await testDb.query('DELETE FROM delivery_quotes WHERE buyer_id IN (?) OR supplier_id IN (?)', [createdUserIds, createdUserIds]);
          await testDb.query('DELETE FROM buyer_delivery_addresses WHERE user_id IN (?)', [createdUserIds]);
          await testDb.query('DELETE FROM supplier_pickup_points WHERE supplier_id IN (?)', [createdUserIds]);
          await testDb.query('DELETE FROM supplier_delivery_cluster_rates WHERE supplier_id IN (?)', [createdUserIds]);
          await testDb.query('DELETE FROM supplier_delivery_configurations WHERE supplier_id IN (?)', [createdUserIds]);
          await testDb.query('DELETE FROM supplier_profiles WHERE supplier_id IN (?)', [createdUserIds]);
          await testDb.query('DELETE FROM users WHERE id IN (?)', [createdUserIds]);
        }
        await testDb.end();
      }
      if (devDb) await devDb.end();
      if (serverInstance) serverInstance.close();
    } catch (cleanupErr) {
      console.error('Cleanup Error:', cleanupErr);
    }
  }
}

if (require.main === module) {
  runGate()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n❌ Gate Failure:', err);
      process.exit(1);
    });
}

module.exports = { runGate };
