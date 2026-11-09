// =============================================================================
// backend/tests/package_e2_catalog_security_gate.js
// MilJor Package E2 Gate 3: Security, RBAC, Direct-Creation Bypass & Cross-Commodity Integrity
// =============================================================================
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../server');
const db = require('../src/config/db');

let server;
let baseUrl;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = http.request(url, { method, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  console.log('================================================================================');
  console.log('MILJOR PACKAGE E2 GATE 3: CATALOG SECURITY & CROSS-COMMODITY INTEGRITY SUITE');
  console.log('================================================================================\n');

  let passed = 0;
  let total = 0;

  const createdUserIds = [];
  const createdRequestIds = [];

  async function runTest(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ [PASS] ${total}. ${name}`);
    } catch (err) {
      console.error(`  ❌ [FAIL] ${total}. ${name}:`, err.message);
      throw err;
    }
  }

  try {
    const [dbCheck] = await db.query('SELECT DATABASE() as db');
    assert.strictEqual(dbCheck[0].db, 'miljor_test_db');

    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const ts = Date.now();
    const [s1] = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, verification_status)
       VALUES (?, ?, 'test_hash', 'SUPPLIER', 'VERIFIED')`,
      [`Sec Supplier A ${ts}`, `sec_suppa_${ts}@miljor.test`]
    );
    const supplierAId = s1.insertId;
    createdUserIds.push(supplierAId);

    const [s2] = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, verification_status)
       VALUES (?, ?, 'test_hash', 'SUPPLIER', 'VERIFIED')`,
      [`Sec Supplier B ${ts}`, `sec_suppb_${ts}@miljor.test`]
    );
    const supplierBId = s2.insertId;
    createdUserIds.push(supplierBId);

    const [b1] = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, verification_status)
       VALUES (?, ?, 'test_hash', 'BUYER', 'VERIFIED')`,
      [`Sec Buyer ${ts}`, `sec_buyer_${ts}@miljor.test`]
    );
    const buyerId = b1.insertId;
    createdUserIds.push(buyerId);

    const jwtOpts = { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' };
    const supplierAToken = jwt.sign({ id: supplierAId, role: 'SUPPLIER' }, process.env.JWT_SECRET, jwtOpts);
    const supplierBToken = jwt.sign({ id: supplierBId, role: 'SUPPLIER' }, process.env.JWT_SECRET, jwtOpts);
    const buyerToken = jwt.sign({ id: buyerId, role: 'BUYER' }, process.env.JWT_SECRET, jwtOpts);

    await runTest('Defect A & B Closed: Supplier CANNOT directly create public products via POST /api/v1/products (403 DIRECT_CATALOG_CREATION_PROHIBITED)', async () => {
      const res = await request(
        'POST',
        '/api/v1/products',
        {
          title: 'Bypassed Unmoderated Rice',
          category: 'Grains & Rice',
          brand: 'Rogue Brand',
          variety: 'Basmati',
          processing_type: 'Steam',
          grade: 'A',
          pack_size: 25,
          unit: 'kg'
        },
        supplierAToken
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'DIRECT_CATALOG_CREATION_PROHIBITED');
    });

    await runTest('Defect A & B Closed: Supplier CANNOT directly create public specifications via POST /api/v1/specifications (403 DIRECT_CATALOG_CREATION_PROHIBITED)', async () => {
      const res = await request(
        'POST',
        '/api/v1/specifications',
        {
          product_id: 1,
          brand: 'Rogue Brand',
          variety: '1121 Steam',
          processing_method: 'Steam',
          quality_grade: 'A',
          packaging_type: 'Bag',
          pack_size: 25,
          pack_unit: 'kg'
        },
        supplierAToken
      );
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'DIRECT_CATALOG_CREATION_PROHIBITED');
    });

    await runTest('Buyer CANNOT submit catalog requests or access admin moderation endpoints (403 Forbidden)', async () => {
      const reqRes = await request(
        'POST',
        '/api/v1/catalog/requests',
        { request_type: 'NEW_FAMILY', category_id: 1, proposed_family_name: 'Buyer Rogue Family' },
        buyerToken
      );
      assert.strictEqual(reqRes.status, 403);

      const admRes = await request('GET', '/api/v1/admin/catalog/requests', null, buyerToken);
      assert.strictEqual(admRes.status, 403);
    });

    await runTest('Supplier CANNOT approve or reject their own catalog request via admin endpoints (403 Forbidden)', async () => {
      const createRes = await request(
        'POST',
        '/api/v1/catalog/requests',
        {
          request_type: 'NEW_FAMILY',
          category_id: 7,
          proposed_family_name: `Cardamom Tea Blend ${ts}`
        },
        supplierAToken
      );
      assert.strictEqual(createRes.status, 201);
      const reqId = createRes.body.data.request.id;
      createdRequestIds.push(reqId);

      const selfApprove = await request('POST', `/api/v1/admin/catalog/requests/${reqId}/approve`, {}, supplierAToken);
      assert.strictEqual(selfApprove.status, 403);
    });

    await runTest('Cross-supplier session isolation: Supplier B CANNOT view or modify Supplier A\'s catalog request (403 Forbidden)', async () => {
      const reqId = createdRequestIds[0];
      const viewRes = await request('GET', `/api/v1/catalog/requests/${reqId}`, null, supplierBToken);
      assert.strictEqual(viewRes.status, 403);

      const editRes = await request('PUT', `/api/v1/catalog/requests/${reqId}`, { proposed_family_name: 'Hijacked' }, supplierBToken);
      assert.strictEqual(editRes.status, 403);
    });

    await runTest('Cross-commodity integrity: Submitting Rice attributes or Gur variety under Refined Sugar family (id=12) is rejected with 400 COMMODITY_FAMILY_MISMATCH', async () => {
      const riceUnderSugar = await request(
        'POST',
        '/api/v1/catalog/requests',
        {
          request_type: 'NEW_VARIANT',
          category_id: 5,
          family_id: 12, // Sugar
          brand: 'Guard',
          variety: '1121 Kainat Basmati Sella',
          processing_method: 'Parboiled Sella',
          quality_grade: 'Grade A',
          packaging_type: 'PP Bag',
          pack_size: 50,
          pack_unit: 'kg'
        },
        supplierAToken
      );
      assert.strictEqual(riceUnderSugar.status, 400);
      assert.strictEqual(riceUnderSugar.body.error.code, 'COMMODITY_FAMILY_MISMATCH');

      const gurUnderSugar = await request(
        'POST',
        '/api/v1/catalog/requests',
        {
          request_type: 'NEW_VARIANT',
          category_id: 5,
          family_id: 12, // Sugar
          brand: 'Peshawar Mills',
          variety: 'Organic Desi Gur Jaggery Block',
          processing_method: 'Traditional',
          quality_grade: 'Grade A',
          packaging_type: 'Bag',
          pack_size: 25,
          pack_unit: 'kg'
        },
        supplierAToken
      );
      assert.strictEqual(gurUnderSugar.status, 400);
      assert.strictEqual(gurUnderSugar.body.error.code, 'COMMODITY_FAMILY_MISMATCH');
    });

    await runTest('Dimensional & unit integrity: Dry commodities reject Litre (L) and Cooking Oil rejects Kilogram (kg) with 400 INCOMPATIBLE_FAMILY_UNIT', async () => {
      const riceInLitres = await request(
        'POST',
        '/api/v1/catalog/requests',
        {
          request_type: 'NEW_VARIANT',
          category_id: 1,
          family_id: 1, // Rice
          brand: 'Guard',
          variety: 'Super Kernel',
          processing_method: 'Steam',
          quality_grade: 'Grade A',
          packaging_type: 'Bag',
          pack_size: 25,
          pack_unit: 'L'
        },
        supplierAToken
      );
      assert.strictEqual(riceInLitres.status, 400);
      assert.strictEqual(riceInLitres.body.error.code, 'INCOMPATIBLE_FAMILY_UNIT');

      const oilInKg = await request(
        'POST',
        '/api/v1/catalog/requests',
        {
          request_type: 'NEW_VARIANT',
          category_id: 2,
          family_id: 2, // Cooking Oil
          brand: 'Dalda',
          variety: 'Refined Canola Oil',
          processing_method: 'Double Refined',
          quality_grade: 'Grade A',
          packaging_type: 'Carton',
          pack_size: 16,
          pack_unit: 'kg'
        },
        supplierAToken
      );
      assert.strictEqual(oilInKg.status, 400);
      assert.strictEqual(oilInKg.body.error.code, 'INCOMPATIBLE_FAMILY_UNIT');
    });

    await runTest('Hierarchy & pack_size validation: Mismatched category_id + family_id or malformed pack_size ("25kg", -5) are rejected with 400', async () => {
      const mismatchRes = await request(
        'POST',
        '/api/v1/catalog/requests',
        {
          request_type: 'NEW_VARIANT',
          category_id: 1, // Grains & Rice
          family_id: 12, // Sugar (belongs to category 5!)
          brand: 'Ittefaq',
          variety: 'S-30',
          processing_method: 'Refined',
          quality_grade: 'A',
          packaging_type: 'Bag',
          pack_size: 50,
          pack_unit: 'kg'
        },
        supplierAToken
      );
      assert.strictEqual(mismatchRes.status, 400);
      assert.strictEqual(mismatchRes.body.error.code, 'CATEGORY_FAMILY_MISMATCH');

      const badSizeRes = await request(
        'POST',
        '/api/v1/catalog/requests',
        {
          request_type: 'NEW_VARIANT',
          category_id: 1,
          family_id: 1,
          brand: 'Guard',
          variety: 'Super Kernel',
          processing_method: 'Steam',
          quality_grade: 'A',
          packaging_type: 'Bag',
          pack_size: '25kg',
          pack_unit: 'kg'
        },
        supplierAToken
      );
      assert.strictEqual(badSizeRes.status, 400);
    });

    console.log('\n================================================================================');
    console.log(`PACKAGE E2 SECURITY GATE VERDICT: ALL ${passed}/${total} TESTS PASSED (100% GREEN)`);
    console.log('================================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ PACKAGE E2 SECURITY GATE FAILED:', err);
    process.exit(1);
  } finally {
    if (createdRequestIds.length > 0) {
      await db.query(`DELETE FROM catalog_moderation_logs WHERE request_id IN (${createdRequestIds.join(',')})`).catch(() => {});
      await db.query(`DELETE FROM catalog_requests WHERE id IN (${createdRequestIds.join(',')})`).catch(() => {});
    }
    if (createdUserIds.length > 0) {
      await db.query(`DELETE FROM users WHERE id IN (${createdUserIds.join(',')})`).catch(() => {});
    }
    if (server) server.close();
  }
})();
