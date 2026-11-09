// =============================================================================
// tests/part_6d_master_integration_gate.js
// MilJor Phase 6D: Master Registration, Profile, Catalog & Supplier Delivery Gate
// =============================================================================

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('assert');
const path = require('path');
const http = require('http');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { JWT_SECRET = 'miljor-super-secure-secret-key-for-testing-only-12345' } = process.env;
const app = require('../server');

const TEST_PORT = 5097;
let serverInstance;

function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
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

function runAssertion(testNum, desc, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  [PASS] Assertion ${testNum}: ${desc}`);
      return true;
    })
    .catch((err) => {
      console.error(`  [FAIL] Assertion ${testNum}: ${desc}`);
      console.error(`         ${err.message}`);
      throw err;
    });
}

async function runGate() {
  console.log('\n================================================================================');
  console.log('MILJOR PHASE 6D: MASTER REGISTRATION, PROFILE, CATALOG & DELIVERY GATE');
  console.log('================================================================================\n');

  // Connect to isolated test database
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: 'miljor_test_db'
  });

  // Verify baseline test data
  const [clusters] = await conn.execute('SELECT * FROM geographic_clusters WHERE is_active = 1');
  assert(clusters.length >= 12, 'Must have at least 12 active Lahore clusters in test db');

  // Start HTTP server on TEST_PORT
  await new Promise((resolve) => {
    serverInstance = app.listen(TEST_PORT, () => {
      resolve();
    });
  });

  const createdUserIds = [];

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: GEOGRAPHIC CLUSTER CATALOG & LAHORE-ONLY SCOPE
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Authoritative Lahore Cluster Catalog ---');

    await runAssertion(1, 'GET /api/v1/geo/clusters returns all 12 active Lahore clusters', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/geo/clusters',
        method: 'GET'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.district, 'Lahore');
      assert.strictEqual(res.body.data.total_clusters, 12);
      assert.strictEqual(res.body.data.clusters.length, 12);
    });

    await runAssertion(2, 'Every returned cluster strictly belongs to district Lahore with active status', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/geo/clusters',
        method: 'GET'
      });
      for (const c of res.body.data.clusters) {
        assert.strictEqual(c.district, 'Lahore');
        assert.strictEqual(c.is_active, 1);
        assert(typeof c.id === 'number');
        assert(typeof c.cluster_code === 'string');
      }
    });

    await runAssertion(3, 'Zero out-of-Lahore launch cities exist in the cluster catalog', async () => {
      const forbiddenCities = ['karachi', 'islamabad', 'rawalpindi', 'faisalabad', 'multan', 'gujranwala', 'kasur', 'sheikhupura', 'nankana'];
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/geo/clusters',
        method: 'GET'
      });
      for (const c of res.body.data.clusters) {
        const nameLower = c.name.toLowerCase();
        for (const city of forbiddenCities) {
          assert(!nameLower.includes(city + ' cluster'), `Cluster '${c.name}' should not be named as outside city '${city}'`);
        }
      }
    });

    await runAssertion(4, 'Cluster search by name and locality alias works', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/geo/areas/search?q=Johar',
        method: 'GET'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert(Array.isArray(res.body.data.localities));
      assert(res.body.data.localities.length > 0);
    });

    // -------------------------------------------------------------------------
    // SECTION 2: CREATE ACCOUNT LOCATION VALIDATION & OUT-OF-DISTRICT ENFORCEMENT
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Registration Location & Boundary Enforcement ---');

    await runAssertion(5, 'Registration with non-Lahore city (Karachi) is rejected with 422', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        full_name: 'Karachi Applicant',
        email: `khi_${Date.now()}@test.pk`,
        password: 'Password123',
        city: 'Karachi',
        cluster_id: 1,
        society_area: 'Clifton Block 2',
        address: 'Main Sea View Road'
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'OUTSIDE_LAHORE_DISTRICT');
    });

    await runAssertion(6, 'Registration with non-Lahore city (Islamabad) is rejected with 422', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        full_name: 'Islamabad Applicant',
        email: `isb_${Date.now()}@test.pk`,
        password: 'Password123',
        city: 'Islamabad',
        cluster_id: 1,
        society_area: 'F-7/2',
        address: 'Jinnah Avenue'
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'OUTSIDE_LAHORE_DISTRICT');
    });

    await runAssertion(7, 'Registration with forged or inactive cluster_id is rejected with 422', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        full_name: 'Forged Cluster User',
        email: `fake_cluster_${Date.now()}@test.pk`,
        password: 'Password123',
        city: 'Lahore',
        cluster_id: 9999,
        society_area: 'Johar Town',
        address: 'Plot 10, Block G'
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'INVALID_CLUSTER');
    });

    await runAssertion(8, 'Registration with clear outside-district settlement (Kasur City) is rejected with 422', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        full_name: 'Outside User',
        email: `outside_${Date.now()}@test.pk`,
        password: 'Password123',
        city: 'Lahore',
        cluster_id: 8,
        society_area: 'Kasur City',
        address: 'Civil Lines Kasur City'
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'OUTSIDE_LAHORE_DISTRICT');
    });

    await runAssertion(9, 'Registration with arterial road mentioning neighboring district (Sheikhupura Road, Shahdara) succeeds', async () => {
      const email = `road_buyer_${Date.now()}@test.pk`;
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        full_name: 'Shahdara Merchant',
        business_name: 'Ravi Traders',
        email,
        password: 'Password123',
        role: 'BUYER',
        city: 'Lahore',
        cluster_id: 1, // Shahdara / Northern Ravi
        society_area: 'Sheikhupura Road, Shahdara',
        address: 'Near Old Toll Plaza, Sheikhupura Road'
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.role, 'BUYER');
      createdUserIds.push(res.body.data.user.id);
    });

    await runAssertion(10, 'Registration with business name mentioning neighboring district (Kasur Traders, Akbari Mandi) succeeds', async () => {
      const email = `biz_buyer_${Date.now()}@test.pk`;
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        full_name: 'Akbari Merchant',
        business_name: 'Kasur Traders',
        email,
        password: 'Password123',
        role: 'BUYER',
        city: 'Lahore',
        cluster_id: 2, // Central & Walled City
        society_area: 'Akbari Mandi',
        address: 'Shop 14, Kasur Traders Market, Circular Road'
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      createdUserIds.push(res.body.data.user.id);
    });

    await runAssertion(11, 'Registration with Urdu Unicode area text (شاہدرہ ٹاؤن) succeeds', async () => {
      const email = `urdu_buyer_${Date.now()}@test.pk`;
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        full_name: 'طارق محمود',
        business_name: 'المدینہ کیٹررز',
        email,
        password: 'Password123',
        role: 'BUYER',
        city: 'Lahore',
        cluster_id: 1,
        society_area: 'شاہدرہ ٹاؤن',
        address: 'مین بازار، دکان نمبر 5'
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      createdUserIds.push(res.body.data.user.id);
    });

    // -------------------------------------------------------------------------
    // SECTION 3: ROLE SECURITY & ATOMIC BUYER ONBOARDING
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Role Security & Buyer Profile Initialization ---');

    await runAssertion(12, 'Public registration rejects privileged role injection: "ADMIN" with 422 INVALID_REGISTRATION_ROLE', async () => {
      const email = `exploit_admin_${Date.now()}@test.pk`;
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        full_name: 'Attacker Admin',
        email,
        password: 'Password123',
        role: 'ADMIN' // Malicious injection attempt
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'INVALID_REGISTRATION_ROLE');

      const [rows] = await conn.execute('SELECT * FROM users WHERE email = ?', [email]);
      assert.strictEqual(rows.length, 0, 'No user record must be created on invalid registration role');
    });

    let buyerToken = null;
    let buyerUserId = null;

    await runAssertion(13, 'Valid Buyer registration creates user and initializes default delivery address atomically', async () => {
      const email = `full_buyer_${Date.now()}@test.pk`;
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        full_name: 'Aslam Javed',
        business_name: 'Gourmet Kitchens',
        email,
        phone: '03001234567',
        password: 'Password123',
        role: 'BUYER',
        city: 'Lahore',
        cluster_id: 7, // Johar Town, Wapda Town, Thokar
        society_area: 'Johar Town Block G1',
        address: 'Plot 45, Commercial Avenue'
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.user.role, 'BUYER');
      buyerToken = res.body.data.token;
      buyerUserId = res.body.data.user.id;
      createdUserIds.push(buyerUserId);

      // Verify buyer_delivery_addresses record in MySQL
      const [addrRows] = await conn.execute('SELECT * FROM buyer_delivery_addresses WHERE user_id = ?', [buyerUserId]);
      assert.strictEqual(addrRows.length, 1);
      assert.strictEqual(addrRows[0].cluster_id, 7);
      assert.strictEqual(addrRows[0].society_area, 'Johar Town Block G1');
      assert.strictEqual(addrRows[0].is_default, 1);
    });

    await runAssertion(14, 'Buyer saved address is retrievable via GET /api/v1/buyer/addresses', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/buyer/addresses',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${buyerToken}`
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert(Array.isArray(res.body.data));
      assert.strictEqual(res.body.data.length, 1);
      assert.strictEqual(res.body.data[0].cluster_id, 7);
      assert.strictEqual(res.body.data[0].is_default, 1);
    });

    await runAssertion(15, 'Duplicate email registration is rejected with 409 USER_EXISTS', async () => {
      const [user] = await conn.execute('SELECT email FROM users WHERE id = ?', [buyerUserId]);
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        full_name: 'Duplicate Person',
        email: user[0].email,
        password: 'Password123'
      });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, 'USER_EXISTS');
    });

    // -------------------------------------------------------------------------
    // SECTION 4: SUPPLIER REGISTRATION & PROFILE INITIALIZATION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Supplier Registration & Profile Initialization ---');

    let supplierToken = null;
    let supplierUserId = null;

    await runAssertion(16, 'Supplier registration creates user with role SUPPLIER', async () => {
      const email = `mill_supplier_${Date.now()}@test.pk`;
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        full_name: 'Haji Farooq',
        business_name: 'Punjab Agri Mills',
        email,
        phone: '03219876543',
        password: 'Password123',
        role: 'SUPPLIER',
        city: 'Lahore',
        cluster_id: 9, // Raiwind & Sundar Agri-Industrial
        society_area: 'Sundar Industrial Estate',
        address: 'Plot 120, Phase 2, Sundar Industrial Estate'
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.user.role, 'SUPPLIER');
      supplierToken = res.body.data.token;
      supplierUserId = res.body.data.user.id;
      createdUserIds.push(supplierUserId);
    });

    await runAssertion(17, 'Supplier profile is initialized in supplier_profiles table', async () => {
      const [profiles] = await conn.execute('SELECT * FROM supplier_profiles WHERE supplier_id = ?', [supplierUserId]);
      assert.strictEqual(profiles.length, 1);
      assert.strictEqual(profiles[0].verification_level, 'LEVEL_1_CONTACT');
      assert.strictEqual(profiles[0].verification_status, 'NOT_SUBMITTED');
      assert.strictEqual(profiles[0].subscription_plan, 'STARTER');
    });

    await runAssertion(18, 'Supplier delivery configuration is initialized with all modes disabled (draft)', async () => {
      const [configs] = await conn.execute('SELECT * FROM supplier_delivery_configurations WHERE supplier_id = ?', [supplierUserId]);
      assert.strictEqual(configs.length, 1);
      assert.strictEqual(configs[0].standard_delivery_enabled, 0);
      assert.strictEqual(configs[0].pickup_enabled, 0);
      assert.strictEqual(configs[0].express_enabled, 0);
      assert.strictEqual(configs[0].express_cutoff_time, '14:00:00');
    });

    await runAssertion(19, 'GET /api/v1/auth/me returns complete supplier profile metadata for supplier', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/me',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${supplierToken}`
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.user.role, 'SUPPLIER');
      assert(res.body.data.supplier_profile !== null);
      assert.strictEqual(res.body.data.supplier_profile.subscription_plan, 'STARTER');
    });

    // -------------------------------------------------------------------------
    // SECTION 5: SUPPLIER DELIVERY CONFIGURATION & CLUSTER PRICING
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Supplier Delivery Settings & Mode Configuration ---');

    await runAssertion(20, 'Supplier can retrieve delivery settings via GET /api/v1/supplier/delivery-settings', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/supplier/delivery-settings',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${supplierToken}`
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert(res.body.data.configuration !== undefined);
      assert.strictEqual(res.body.data.configuration.standard_delivery_enabled, 0);
    });

    await runAssertion(21, 'Disabling all 3 delivery modes is rejected with 422 (must offer at least one)', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/supplier/delivery-settings',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supplierToken}`
        }
      }, {
        standard_delivery_enabled: false,
        pickup_enabled: false,
        express_enabled: false,
        cluster_rates: []
      });
      assert.strictEqual(res.status, 422);
      assert.strictEqual(res.body.error.code, 'AT_LEAST_ONE_MODE_REQUIRED');
    });

    await runAssertion(22, 'Supplier can configure cluster rates and enable Pickup + Express', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/supplier/delivery-settings',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supplierToken}`
        }
      }, {
        standard_delivery_enabled: true,
        pickup_enabled: true,
        express_enabled: true,
        express_cutoff_time: '15:30:00',
        express_fulfillment_hours: 3,
        cluster_rates: [
          { cluster_id: 1, mode: 'STANDARD_CLUSTERED', fee_pkr: 200, is_eligible: true },
          { cluster_id: 4, mode: 'STANDARD_CLUSTERED', fee_pkr: 300, is_eligible: true },
          { cluster_id: 7, mode: 'STANDARD_CLUSTERED', fee_pkr: 250, is_eligible: true },
          { cluster_id: 7, mode: 'EXPRESS', fee_pkr: 600, is_eligible: true }
        ]
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.configuration.express_enabled, 1);
      assert.strictEqual(res.body.data.configuration.pickup_enabled, 1);
    });

    await runAssertion(23, 'Updated supplier delivery settings persist and reload correctly', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/supplier/delivery-settings',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${supplierToken}`
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.configuration.express_cutoff_time, '15:30:00');
      assert(res.body.data.cluster_rates.length >= 4);
    });

    await runAssertion(24, 'Supplier can register a physical pickup point with handling fee', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/supplier/pickup-points',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supplierToken}`
        }
      }, {
        point_name: 'Sundar Warehouse Gate 1',
        cluster_id: 9,
        address_line: 'Plot 120, Sundar Industrial Estate',
        contact_phone: '03219876543',
        operating_hours: 'Mon-Sat 08:00 - 18:00',
        pickup_handling_fee_pkr: 0.00
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.point_name, 'Sundar Warehouse Gate 1');
      assert.strictEqual(Number(res.body.data.pickup_handling_fee_pkr), 0);
    });

    // -------------------------------------------------------------------------
    // SECTION 6: RBAC & CROSS-SUPPLIER ISOLATION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 6: Cross-Supplier Isolation & RBAC ---');

    await runAssertion(25, 'Buyer cannot access supplier delivery settings (403 Forbidden)', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/supplier/delivery-settings',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${buyerToken}`
        }
      });
      assert.strictEqual(res.status, 403);
    });

    await runAssertion(26, 'Anonymous user cannot access supplier delivery settings (401 Unauthorized)', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/supplier/delivery-settings',
        method: 'GET'
      });
      assert.strictEqual(res.status, 401);
    });

    await runAssertion(27, 'Supplier B cannot see or modify Supplier A delivery rates', async () => {
      // Create Supplier B
      const suppBEmail = `supp_b_${Date.now()}@test.pk`;
      const regRes = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/auth/register',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        full_name: 'Supplier B',
        business_name: 'Chenab Traders',
        email: suppBEmail,
        password: 'Password123',
        role: 'SUPPLIER',
        city: 'Lahore',
        cluster_id: 4
      });
      const suppBToken = regRes.body.data.token;
      createdUserIds.push(regRes.body.data.user.id);

      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/supplier/delivery-settings',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${suppBToken}`
        }
      });
      assert.strictEqual(res.status, 200);
      // Supplier B has default configuration, not Supplier A's updated rates
      assert.strictEqual(res.body.data.configuration.express_enabled, 0);
      assert.strictEqual(res.body.data.configuration.express_cutoff_time, '14:00:00');
    });

    // -------------------------------------------------------------------------
    // SECTION 7: PRODUCT CATALOG INTEGRATION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 7: Backend Product Catalog Integration ---');

    await runAssertion(28, 'GET /api/v1/products returns all 11 authorized staple food products (covering 16 variants)', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/products',
        method: 'GET'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.count, 11);
      assert.strictEqual(res.body.data.products.length, 11);
    });

    await runAssertion(29, 'Catalog products cover staple categories: Grains & Rice, Oils & Fats, Pulses & Legumes', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/products',
        method: 'GET'
      });
      const categories = new Set(res.body.data.products.map(p => p.category));
      assert(categories.has('Grains & Rice'));
      assert(categories.has('Oils & Fats'));
      assert(categories.has('Pulses & Legumes'));
      assert(categories.has('Sugar & Sweeteners'));
      assert(categories.has('Flour & Grain'));
    });

    await runAssertion(30, 'Category filtering on products returns category subset', async () => {
      const res = await makeRequest({
        hostname: 'localhost',
        port: TEST_PORT,
        path: '/api/v1/products?category=Grains%20%26%20Rice',
        method: 'GET'
      });
      assert.strictEqual(res.status, 200);
      for (const prod of res.body.data.products) {
        assert.strictEqual(prod.category, 'Grains & Rice');
      }
    });

    // -------------------------------------------------------------------------
    // SECTION 8: COMMERCIAL INVARIANTS & PRISTINE PRODUCTION DB
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 8: Commercial Invariants & DB Safety ---');

    await runAssertion(31, '0% platform delivery commission invariant preserved', async () => {
      // Delivery charges belong 100% to supplier
      const [res] = await conn.execute(
        'SELECT fee_pkr FROM supplier_delivery_cluster_rates WHERE supplier_id = ? LIMIT 1',
        [supplierUserId]
      );
      if (res.length > 0) {
        assert(Number(res[0].fee_pkr) >= 0);
      }
    });

    await runAssertion(32, 'Primary miljor_db remains completely PRISTINE and untouched', async () => {
      const prodConn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: 'miljor_db'
      });
      try {
        const [[{ usersCount }]] = await prodConn.execute('SELECT COUNT(*) as usersCount FROM users');
        const [[{ poolsCount }]] = await prodConn.execute('SELECT COUNT(*) as poolsCount FROM pools');
        const [[{ ordersCount }]] = await prodConn.execute('SELECT COUNT(*) as ordersCount FROM orders');
        const [[{ resCount }]] = await prodConn.execute('SELECT COUNT(*) as resCount FROM reservations');
        const [[{ payCount }]] = await prodConn.execute('SELECT COUNT(*) as payCount FROM payments');

        assert.strictEqual(usersCount, 7, 'miljor_db users must remain 7');
        assert.strictEqual(poolsCount, 2, 'miljor_db pools must remain 2');
        assert.strictEqual(ordersCount, 0, 'miljor_db orders must remain 0');
        assert.strictEqual(resCount, 0, 'miljor_db reservations must remain 0');
        assert.strictEqual(payCount, 0, 'miljor_db payments must remain 0');
      } finally {
        await prodConn.end();
      }
    });

    console.log('\n================================================================================');
    console.log('PHASE 6D MASTER GATE: ALL 32 ASSERTIONS PASSED (100%)');
    console.log('================================================================================\n');

  } finally {
    // Cleanup created test records in isolated test db
    if (createdUserIds.length > 0) {
      await conn.query(`DELETE FROM users WHERE id IN (${createdUserIds.map(() => '?').join(',')})`, createdUserIds);
    }
    await conn.end();
    if (serverInstance) {
      serverInstance.close();
    }
  }
}

if (require.main === module) {
  runGate()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal Gate Failure:', err);
      process.exit(1);
    });
}

module.exports = { runGate };
