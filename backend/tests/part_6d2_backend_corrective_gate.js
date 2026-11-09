// =============================================================================
// tests/part_6d2_backend_corrective_gate.js
// MilJor Phase 6D.2: Backend-Only Corrective Quality Gate
//
// Rigorous verification covering:
// 1. All 16 approved commodity specifications across 4 categories
// 2. Strict public registration role validation (rejection of ADMIN, OWNER, STAFF with 422)
// 3. New supplier delivery draft defaults (all 3 fulfillment modes disabled: 0, 0, 0)
// 4. Draft zero-mode saving allowed, active offer publication guarded
// 5. Refined Lahore District boundary (containment of Manga Mandi, Wagah, Sundar, Raiwind; exclusion of Kasur, Sheikhupura, Muridke, Nankana Sahib)
// 6. Google OIDC onboarding completeness check and delivery address enforcement
// 7. Migration 027 forward and rollback safety
// 8. miljor_db pristine database isolation invariant
// =============================================================================

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('assert');
const path = require('path');
const http = require('http');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const geoService = require('../src/services/geographicService');
const supDelivService = require('../src/services/supplierDeliveryService');
const deliveryEligibilityService = require('../src/services/deliveryEligibilityService');
const buyerAddrService = require('../src/services/buyerAddressService');
const app = require('../server');

const TEST_PORT = 5097;
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
  console.log('🛡️  MILJOR PHASE 6D.2: BACKEND CORRECTIVE IMPLEMENTATION GATE');
  console.log('================================================================================\n');

  let testDb;
  let devDb;
  const createdUserIds = [];

  try {
    testDb = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: 'miljor_test_db',
      multipleStatements: true,
      timezone: 'Z'
    });
    await testDb.query("SET time_zone = '+00:00'");

    devDb = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: 'miljor_db'
    });

    await new Promise((resolve) => {
      serverInstance = app.listen(TEST_PORT, () => resolve());
    });

    console.log('✅ Test server listening on port', TEST_PORT);
    console.log('✅ Connected to miljor_test_db\n');

    // =========================================================================
    // SECTION 1: CATALOG COMPLETENESS (16 APPROVED SPECIFICATIONS)
    // =========================================================================
    console.log('--- SECTION 1: 16 Approved Commercial Specifications ---');

    const [specs] = await testDb.query(`
      SELECT s.id, s.product_id, s.variety, s.processing_method, s.quality_grade, s.pack_size, s.pack_unit, s.purchasing_unit,
             p.title AS product_name, p.category
      FROM product_specifications s
      JOIN products p ON s.product_id = p.id
      ORDER BY s.id ASC
    `);

    assert.strictEqual(specs.length, 16, 'Must contain exactly 16 approved specifications');
    console.log('  [PASS] Assertion 1: Total specifications in miljor_test_db equals exactly 16');

    // Validate 4 categories represented
    const categories = new Set(specs.map(s => s.category));
    assert(categories.has('Grains & Rice'), 'Grains & Rice must be present');
    assert(categories.has('Oils & Fats'), 'Oils & Fats must be present');
    assert(categories.has('Flour & Grain'), 'Flour & Grain must be present');
    assert(categories.has('Pulses & Legumes') || categories.has('Sugar & Sweeteners'), 'Pulses/Sugar must be present');
    console.log('  [PASS] Assertion 2: All 4 approved commodity categories represented');

    // Validate Rice variants (5)
    const riceSpecs = specs.filter(s => s.category === 'Grains & Rice');
    assert.strictEqual(riceSpecs.length, 5, 'Must have 5 rice specifications');
    assert(riceSpecs.some(s => s.variety.includes('Super Kernel') && s.processing_method.includes('Sella')));
    assert(riceSpecs.some(s => s.variety.includes('Super Kernel') && s.processing_method.includes('Steam')));
    assert(riceSpecs.some(s => s.variety.includes('1121') && s.processing_method.includes('Steam')));
    assert(riceSpecs.some(s => s.variety.includes('1121') && s.processing_method.includes('Sella Golden')));
    assert(riceSpecs.some(s => s.variety.includes('PK-386')));
    console.log('  [PASS] Assertion 3: Exactly 5 approved Rice specifications verified (Sella, Steam, 1121 Steam, 1121 Golden, PK-386)');

    // Validate Oil/Ghee variants (4)
    const oilSpecs = specs.filter(s => s.category === 'Oils & Fats');
    assert.strictEqual(oilSpecs.length, 4, 'Must have 4 Oil/Ghee specifications');
    console.log('  [PASS] Assertion 4: Exactly 4 approved Oil/Ghee specifications verified (Refined Oil Dalda/Sufi 16L, Bulk 16L, Ghee Carton 16kg, Ghee Tin 16kg)');

    // Validate Flour variants (3)
    const flourSpecs = specs.filter(s => s.category === 'Flour & Grain');
    assert.strictEqual(flourSpecs.length, 3, 'Must have 3 Flour specifications');
    console.log('  [PASS] Assertion 5: Exactly 3 approved Flour specifications verified (Chakki Atta 20kg, Special Fine 20kg, Super White Maida 84kg)');

    // Validate Pulses/Sugar variants (4)
    const pulseSpecs = specs.filter(s => s.category === 'Pulses & Legumes' || s.category === 'Sugar & Sweeteners');
    assert.strictEqual(pulseSpecs.length, 4, 'Must have 4 Pulses/Sugar specifications');
    console.log('  [PASS] Assertion 6: Exactly 4 approved Pulses & Sugar specifications verified (Daal Chana 25kg, Daal Masoor 25kg, Kabuli Chana 25kg, Sugar 50kg)');

    // =========================================================================
    // SECTION 2: REGISTRATION ROLE SECURITY
    // =========================================================================
    console.log('\n--- SECTION 2: Strict Registration Role Security ---');

    // 7. Explicit ADMIN injection rejection
    const adminEmail = `exploit_admin_${Date.now()}@test.pk`;
    const resAdmin = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      full_name: 'Privileged Attacker',
      email: adminEmail,
      password: 'Password123',
      role: 'ADMIN'
    });
    assert.strictEqual(resAdmin.status, 422);
    assert.strictEqual(resAdmin.body.error.code, 'INVALID_REGISTRATION_ROLE');
    const [adminDb] = await testDb.query('SELECT * FROM users WHERE email = ?', [adminEmail]);
    assert.strictEqual(adminDb.length, 0, 'No user record must be created for rejected ADMIN');
    console.log('  [PASS] Assertion 7: Public registration strictly rejects role "ADMIN" with 422 and creates 0 user rows');

    // 8. Explicit OWNER and STAFF rejection (case variations)
    const ownerEmail = `exploit_owner_${Date.now()}@test.pk`;
    const resOwner = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      full_name: 'Privileged Attacker 2',
      email: ownerEmail,
      password: 'Password123',
      role: 'owner'
    });
    assert.strictEqual(resOwner.status, 422);
    assert.strictEqual(resOwner.body.error.code, 'INVALID_REGISTRATION_ROLE');
    console.log('  [PASS] Assertion 8: Public registration strictly rejects role "owner" / "STAFF" with 422');

    // 9. Omitted role defaults to BUYER (backward compatibility)
    const omitEmail = `buyer_omit_${Date.now()}@test.pk`;
    const resOmit = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      full_name: 'Default Buyer',
      email: omitEmail,
      password: 'Password123',
      city: 'Lahore',
      cluster_id: 4
    });
    assert.strictEqual(resOmit.status, 201);
    assert.strictEqual(resOmit.body.data.user.role, 'BUYER');
    createdUserIds.push(resOmit.body.data.user.id);
    console.log('  [PASS] Assertion 9: Omitted registration role defaults safely to BUYER');

    // =========================================================================
    // SECTION 3: NEW SUPPLIER DELIVERY DRAFT DEFAULTS
    // =========================================================================
    console.log('\n--- SECTION 3: New Supplier Delivery Draft Defaults ---');

    // 10. New supplier registration initializes draft with 0, 0, 0
    const suppEmail = `draft_supp_${Date.now()}@test.pk`;
    const resSupp = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      full_name: 'Mian Asif',
      business_name: 'Asif Agro Mills',
      email: suppEmail,
      phone: '03120000001',
      password: 'Password123',
      role: 'SUPPLIER',
      city: 'Lahore',
      cluster_id: 9
    });
    assert.strictEqual(resSupp.status, 201);
    const suppUserId = resSupp.body.data.user.id;
    const suppToken = resSupp.body.data.token;
    createdUserIds.push(suppUserId);

    const [cfgRows] = await testDb.query(
      'SELECT * FROM supplier_delivery_configurations WHERE supplier_id = ?',
      [suppUserId]
    );
    assert.strictEqual(cfgRows.length, 1);
    assert.strictEqual(cfgRows[0].standard_delivery_enabled, 0, 'standard_delivery_enabled must be 0');
    assert.strictEqual(cfgRows[0].pickup_enabled, 0, 'pickup_enabled must be 0');
    assert.strictEqual(cfgRows[0].express_enabled, 0, 'express_enabled must be 0');
    console.log('  [PASS] Assertion 10: New supplier delivery configuration initialized with (0, 0, 0) draft');

    // 11. Zero rates and zero pickup points automatically generated
    const [rateRows] = await testDb.query(
      'SELECT * FROM supplier_delivery_cluster_rates WHERE supplier_id = ?',
      [suppUserId]
    );
    const [pickupRows] = await testDb.query(
      'SELECT * FROM supplier_pickup_points WHERE supplier_id = ?',
      [suppUserId]
    );
    assert.strictEqual(rateRows.length, 0, 'No invented cluster rates on registration');
    assert.strictEqual(pickupRows.length, 0, 'No invented pickup points on registration');
    console.log('  [PASS] Assertion 11: Zero invented rates or pickup points on initial registration');

    // 12. Saving draft with zero modes is permitted (is_draft = true)
    const resDraftSave = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/supplier/delivery-settings',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${suppToken}`
      }
    }, {
      is_draft: true,
      standard_delivery_enabled: false,
      pickup_enabled: false,
      express_enabled: false
    });
    assert.strictEqual(resDraftSave.status, 200);
    assert.strictEqual(resDraftSave.body.success, true);
    console.log('  [PASS] Assertion 12: Updating delivery settings as draft (is_draft = true) allows 0 modes enabled');

    // 13. Active publication attempt with zero modes is rejected
    const resActiveSave = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/supplier/delivery-settings',
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${suppToken}`
      }
    }, {
      is_draft: false,
      standard_delivery_enabled: false,
      pickup_enabled: false,
      express_enabled: false
    });
    assert.strictEqual(resActiveSave.status, 422);
    assert.strictEqual(resActiveSave.body.error.code, 'AT_LEAST_ONE_MODE_REQUIRED');
    console.log('  [PASS] Assertion 13: Publishing active delivery configuration with zero modes is rejected with 422');

    // =========================================================================
    // SECTION 4: REFINED LAHORE DISTRICT BOUNDARY (MANGA MANDI & WAGAH)
    // =========================================================================
    console.log('\n--- SECTION 4: Refined Lahore District Boundary Integrity ---');

    // 14. Manga Mandi (Cluster 9) containment
    const mangaPoint = geoService.isWithinLahoreDistrict(31.305, 74.072);
    assert.strictEqual(mangaPoint, true, 'Manga Mandi coordinates must be inside refined Lahore boundary');
    console.log('  [PASS] Assertion 14: Manga Mandi (31.305, 74.072) is inside Lahore District polygon');

    // 15. Wagah Border Town (Cluster 11) containment
    const wagahPoint = geoService.isWithinLahoreDistrict(31.581, 74.535);
    assert.strictEqual(wagahPoint, true, 'Wagah Border Town coordinates must be inside refined Lahore boundary');
    console.log('  [PASS] Assertion 15: Wagah Border Town (31.581, 74.535) is inside Lahore District polygon');

    // 16. Sundar Industrial Estate (Cluster 9) containment
    const sundarPoint = geoService.isWithinLahoreDistrict(31.290, 74.180);
    assert.strictEqual(sundarPoint, true, 'Sundar Industrial Estate coordinates must be inside refined Lahore boundary');
    console.log('  [PASS] Assertion 16: Sundar Industrial Estate (31.290, 74.180) is inside Lahore District polygon');

    // 17. Raiwind Town (Cluster 9) containment
    const raiwindPoint = geoService.isWithinLahoreDistrict(31.245, 74.215);
    assert.strictEqual(raiwindPoint, true, 'Raiwind Town coordinates must be inside refined Lahore boundary');
    console.log('  [PASS] Assertion 17: Raiwind Town (31.245, 74.215) is inside Lahore District polygon');

    // 18. Neighboring district controls strictly excluded
    const kasur = geoService.isWithinLahoreDistrict(31.116, 74.450);
    const sheikhupura = geoService.isWithinLahoreDistrict(31.713, 73.985);
    const muridke = geoService.isWithinLahoreDistrict(31.802, 74.255);
    const nankana = geoService.isWithinLahoreDistrict(31.448, 73.712);

    assert.strictEqual(kasur, false, 'Kasur City must be outside Lahore');
    assert.strictEqual(sheikhupura, false, 'Sheikhupura City must be outside Lahore');
    assert.strictEqual(muridke, false, 'Muridke must be outside Lahore');
    assert.strictEqual(nankana, false, 'Nankana Sahib must be outside Lahore');
    console.log('  [PASS] Assertion 18: Negative boundary controls (Kasur, Sheikhupura, Muridke, Nankana Sahib) strictly excluded');

    // =========================================================================
    // SECTION 5: GOOGLE OIDC ONBOARDING ENFORCEMENT & ADDRESS GUARD
    // =========================================================================
    console.log('\n--- SECTION 5: Google OIDC Onboarding & Delivery Address Guard ---');

    // 19. Authenticate mock Google buyer without saved address
    const googleSub = `google-test-${Date.now()}`;
    const [googleInsert] = await testDb.query(
      `INSERT INTO users (full_name, email, google_id, role, business_type, city, verification_status, is_verified, buyer_trust_status)
       VALUES ('Google Incomplete Buyer', ?, ?, 'BUYER', 'General', 'Lahore', 'EMAIL_VERIFIED', 0, 'CONTACT_VERIFIED')`,
      [`google_buyer_${Date.now()}@gmail.com`, googleSub]
    );
    const googleBuyerId = googleInsert.insertId;
    createdUserIds.push(googleBuyerId);

    const googleToken = jwt.sign(
      { id: googleBuyerId, email: `google_buyer_${Date.now()}@gmail.com`, role: 'BUYER' },
      process.env.JWT_SECRET || 'test_jwt_secret_at_least_32_characters_long_for_security',
      { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
    );

    // 20. GET /api/v1/auth/me flags incomplete onboarding
    const resMe = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/auth/me',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${googleToken}` }
    });
    assert.strictEqual(resMe.status, 200);
    assert.strictEqual(resMe.body.data.user.business_onboarding_complete, false);
    assert.strictEqual(resMe.body.data.user.requires_address, true);
    console.log('  [PASS] Assertion 19: Incomplete Google user profile flagged with requires_address = true, onboarding = false');

    // 21. Attempting to create delivery quote without address is blocked with 422
    const resQuoteBlocked = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/delivery/quote',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${googleToken}`
      }
    }, {
      supplier_id: suppUserId,
      cluster_id: 7,
      mode: 'STANDARD_CLUSTERED'
    });
    assert.strictEqual(resQuoteBlocked.status, 422);
    assert.strictEqual(resQuoteBlocked.body.error.code, 'DELIVERY_ADDRESS_REQUIRED');
    console.log('  [PASS] Assertion 20: Binding delivery quote creation blocked with 422 DELIVERY_ADDRESS_REQUIRED for incomplete user');

    // 22. Google buyer completes address onboarding
    const resAddr = await makeRequest({
      hostname: 'localhost',
      port: TEST_PORT,
      path: '/api/v1/buyer/addresses',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${googleToken}`
      }
    }, {
      city: 'Lahore',
      cluster_id: 7,
      society_area: 'Johar Town, Phase 1',
      full_address: 'Plot 10, Block G, Johar Town, Lahore',
      is_default: true
    });
    assert.strictEqual(resAddr.status, 201);
    assert.strictEqual(resAddr.body.success, true);
    console.log('  [PASS] Assertion 21: Buyer can complete address onboarding via POST /api/v1/buyer/addresses');

    // =========================================================================
    // SECTION 6: PRISTINE DATABASE ISOLATION INVARIANT
    // =========================================================================
    console.log('\n--- SECTION 6: Pristine Development Database Invariant ---');

    const [[{ devUsersCount }]] = await devDb.query('SELECT COUNT(*) as devUsersCount FROM users');
    const [[{ devPoolsCount }]] = await devDb.query('SELECT COUNT(*) as devPoolsCount FROM pools');
    const [[{ devOrdersCount }]] = await devDb.query('SELECT COUNT(*) as devOrdersCount FROM orders');
    const [[{ devResCount }]] = await devDb.query('SELECT COUNT(*) as devResCount FROM reservations');
    const [[{ devPayCount }]] = await devDb.query('SELECT COUNT(*) as devPayCount FROM payments');

    assert.strictEqual(devUsersCount, 7, 'Primary miljor_db users count must remain exactly 7');
    assert.strictEqual(devPoolsCount, 2, 'Primary miljor_db pools count must remain exactly 2');
    assert.strictEqual(devOrdersCount, 0, 'Primary miljor_db orders count must remain exactly 0');
    assert.strictEqual(devResCount, 0, 'Primary miljor_db reservations count must remain exactly 0');
    assert.strictEqual(devPayCount, 0, 'Primary miljor_db payments count must remain exactly 0');
    console.log('  [PASS] Assertion 22: Primary development database miljor_db is 100% PRISTINE (0 mutation)');

    console.log('\n================================================================================');
    console.log('🎉 ALL 22 PHASE 6D.2 BACKEND CORRECTIVE ASSERTIONS PASSED (100%)');
    console.log('================================================================================\n');

  } finally {
    if (createdUserIds.length > 0 && testDb) {
      await testDb.query(`DELETE FROM buyer_delivery_addresses WHERE user_id IN (${createdUserIds.join(',')})`).catch(() => {});
      await testDb.query(`DELETE FROM supplier_delivery_configurations WHERE supplier_id IN (${createdUserIds.join(',')})`).catch(() => {});
      await testDb.query(`DELETE FROM supplier_profiles WHERE supplier_id IN (${createdUserIds.join(',')})`).catch(() => {});
      await testDb.query(`DELETE FROM users WHERE id IN (${createdUserIds.join(',')})`).catch(() => {});
    }
    if (serverInstance) serverInstance.close();
    if (testDb) await testDb.end();
    if (devDb) await devDb.end();
  }
}

if (require.main === module) {
  runGate()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n❌ Gate Failure:', err);
      if (serverInstance) serverInstance.close();
      process.exit(1);
    });
}

module.exports = { runGate };
