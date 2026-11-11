// =============================================================================
// backend/tests/package_e2_catalog_foundation_gate.js
// MilJor Package E2 Gate 1: Canonical Catalog Foundation & Migration 033 Gate
// =============================================================================
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('assert');
const http = require('http');
const app = require('../server');
const db = require('../src/config/db');
const mysql = require('mysql2/promise');

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
  console.log('MILJOR PACKAGE E2 GATE 1: CANONICAL CATALOG FOUNDATION & HIERARCHY SUITE');
  console.log('================================================================================\n');

  let passed = 0;
  let total = 0;

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
    assert.strictEqual(dbCheck[0].db, 'miljor_test_db', 'Must run strictly against miljor_test_db');
    console.log(`🔒 Active Test Database Verified: '${dbCheck[0].db}'\n`);

    server = app.listen(0);
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;

    await runTest('Migration 033 recorded in schema_migrations and tables exist', async () => {
      const [migs] = await db.query("SELECT * FROM schema_migrations WHERE version = '033'");
      assert.strictEqual(migs.length, 1);

      const [tables] = await db.query(`
        SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = 'miljor_test_db'
          AND TABLE_NAME IN ('catalog_categories', 'catalog_product_families', 'catalog_requests', 'catalog_moderation_logs')
      `);
      assert.strictEqual(tables.length, 4);
    });

    await runTest('All 8 canonical categories exist and are active via GET /api/v1/catalog/categories', async () => {
      const res = await request('GET', '/api/v1/catalog/categories');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.count >= 8, `Expected at least 8 categories, got ${res.body.count}`);
      const names = res.body.data.categories.map(c => c.name);
      const required = [
        'Grains & Rice',
        'Cooking Oils & Ghee',
        'Flour & Milling Products',
        'Pulses & Legumes',
        'Sugar & Sweeteners',
        'Spices & Seasonings',
        'Tea & Beverages',
        'Bakery Ingredients'
      ];
      for (const reqName of required) {
        assert.ok(names.includes(reqName), `Missing canonical category: ${reqName}`);
      }
    });

    await runTest('All 13 initial canonical product families exist via GET /api/v1/catalog/families', async () => {
      const res = await request('GET', '/api/v1/catalog/families');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.count >= 13);
      const famSlugs = res.body.data.families.map(f => f.slug);
      const expectedSlugs = [
        'rice', 'cooking-oil', 'banaspati-ghee',
        'chakki-atta', 'maida', 'besan',
        'daal-chana', 'daal-masoor', 'daal-moong', 'daal-mash', 'kabuli-chana',
        'sugar', 'gur-jaggery'
      ];
      for (const s of expectedSlugs) {
        assert.ok(famSlugs.includes(s), `Missing canonical product family slug: ${s}`);
      }
    });

    await runTest('Sugar and Gur / Jaggery are strictly separate canonical product families under Sugar & Sweeteners', async () => {
      const res = await request('GET', '/api/v1/catalog/categories/5/families');
      assert.strictEqual(res.status, 200);
      const fams = res.body.data.families;
      const sugarFam = fams.find(f => f.slug === 'sugar');
      const gurFam = fams.find(f => f.slug === 'gur-jaggery');
      assert.ok(sugarFam, 'Sugar family must exist');
      assert.ok(gurFam, 'Gur / Jaggery family must exist');
      assert.notStrictEqual(sugarFam.id, gurFam.id, 'Sugar and Gur must have distinct family IDs');
    });

    await runTest('Both Basmati Rice (product 1) and Non-Basmati Rice (product 6) map to canonical Rice family (id=1)', async () => {
      const [rows] = await db.query('SELECT id, title, category_id, family_id, mapping_status FROM products WHERE id IN (1, 6) ORDER BY id');
      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].family_id, 1);
      assert.strictEqual(rows[1].family_id, 1);
      assert.strictEqual(rows[0].category_id, 1);
      assert.strictEqual(rows[1].category_id, 1);

      const res = await request('GET', '/api/v1/catalog/families/1/variants');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.count, 5, 'Rice family must expose all 5 historical approved rice variants');
    });

    await runTest('Both Cooking Oil (product 3) and Commercial Cooking Oil (product 7) map to Cooking Oil family (id=2), separate from Banaspati Ghee (id=3)', async () => {
      const [rows] = await db.query('SELECT id, family_id FROM products WHERE id IN (3, 7, 9) ORDER BY id');
      const map = Object.fromEntries(rows.map(r => [r.id, r.family_id]));
      assert.strictEqual(map[3], 2);
      assert.strictEqual(map[7], 2);
      assert.strictEqual(map[9], 3);

      const oilVars = await request('GET', '/api/v1/catalog/families/2/variants');
      const gheeVars = await request('GET', '/api/v1/catalog/families/3/variants');
      assert.strictEqual(oilVars.body.count, 2);
      assert.strictEqual(gheeVars.body.count, 2);
    });

    await runTest('All 11 historical products and 16 historical specifications remain intact and mapped with zero orphans', async () => {
      const [[{ prodCount, unmappedProds }]] = await db.query(`
        SELECT COUNT(*) as prodCount,
               SUM(CASE WHEN category_id IS NULL OR family_id IS NULL THEN 1 ELSE 0 END) as unmappedProds
        FROM products WHERE id <= 11
      `);
      assert.strictEqual(Number(prodCount), 11);
      assert.strictEqual(Number(unmappedProds), 0);

      const [[{ specCount, unmappedSpecs }]] = await db.query(`
        SELECT COUNT(*) as specCount,
               SUM(CASE WHEN category_id IS NULL OR family_id IS NULL OR approval_status != 'APPROVED' THEN 1 ELSE 0 END) as unmappedSpecs
        FROM product_specifications WHERE id <= 16
      `);
      assert.strictEqual(Number(specCount), 16);
      assert.strictEqual(Number(unmappedSpecs), 0);
    });

    await runTest('GET /api/v1/catalog/variants/:id returns complete canonical hierarchy details', async () => {
      const res = await request('GET', '/api/v1/catalog/variants/1');
      assert.strictEqual(res.status, 200);
      const v = res.body.data.variant;
      assert.strictEqual(v.id, 1);
      assert.strictEqual(v.category_id, 1);
      assert.strictEqual(v.family_id, 1);
      assert.strictEqual(v.family_name, 'Rice');
      assert.strictEqual(v.approval_status, 'APPROVED');
    });

    await runTest('Development database miljor_db remains 100% PRISTINE (0 test-fixture mutations)', async () => {
      // Disposable CI intentionally contains ONLY miljor_test_db. In that mode
      // isolation is proven by protected schema absence, never by fabricating
      // a miljor_db database or connecting to production business tables.
      if(process.env.MILJOR_TEST_ONLY_MIGRATIONS==='1'){
        const [schemas]=await db.query(
          "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN ('miljor_db','miljor_sandbox_db')"
        );
        assert.strictEqual(schemas.length,0,
          'Protected DB names must not be provisioned in disposable CI MySQL');
        return;
      }
      const devConn = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: 'miljor_db'
      });
      const [[{ uCount }]] = await devConn.query('SELECT COUNT(*) as uCount FROM users');
      const [[{ pCount }]] = await devConn.query('SELECT COUNT(*) as pCount FROM products');
      assert.strictEqual(Number(uCount), 8, 'miljor_db users count must remain 8 (zero test pollution)');
      assert.strictEqual(Number(pCount), 11, 'miljor_db products count must remain 11 (zero test pollution)');
      await devConn.end();
    });

    console.log('\n================================================================================');
    console.log(`PACKAGE E2 FOUNDATION GATE VERDICT: ALL ${passed}/${total} TESTS PASSED (100% GREEN)`);
    console.log('================================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ PACKAGE E2 FOUNDATION GATE FAILED:', err);
    process.exit(1);
  } finally {
    if (server) server.close();
  }
})();
