// =============================================================================
// backend/tests/package_e2_catalog_moderation_gate.js
// MilJor Package E2 Gate 2: Supplier Requests, Admin Moderation & Offer Integration
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
  console.log('MILJOR PACKAGE E2 GATE 2: CATALOG MODERATION & SUPPLIER OFFER INTEGRATION SUITE');
  console.log('================================================================================\n');

  let passed = 0;
  let total = 0;

  const createdUserIds = [];
  const createdRequestIds = [];
  const createdFamilyIds = [];
  const createdSpecIds = [];
  const createdProductIds = [];
  const createdListingIds = [];

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

    // Seed temporary users: 1 Verified Supplier, 1 Unverified Supplier, 1 Catalog Admin, 1 Buyer
    const ts = Date.now();
    const [s1Res] = await db.query(
      `INSERT INTO users (full_name, business_name, email, password_hash, role, verification_status)
       VALUES (?, ?, ?, 'test_hash', 'SUPPLIER', 'VERIFIED')`,
      [`E2 Verified Supplier ${ts}`, 'E2 Verified Rice & Pulse Mills', `e2_vsupp_${ts}@miljor.test`]
    );
    const verifiedSupplierId = s1Res.insertId;
    createdUserIds.push(verifiedSupplierId);
    await db.query(
      `INSERT INTO supplier_profiles (supplier_id, business_type, verification_status, verification_level, subscription_plan, max_active_listings)
       VALUES (?, 'WHOLESALER', 'VERIFIED', 'LEVEL_2_BUSINESS', 'STARTER', 4)`,
      [verifiedSupplierId]
    );

    const [s2Res] = await db.query(
      `INSERT INTO users (full_name, business_name, email, password_hash, role, verification_status)
       VALUES (?, ?, ?, 'test_hash', 'SUPPLIER', 'UNVERIFIED')`,
      [`E2 Unverified Supplier ${ts}`, 'E2 Unverified Traders', `e2_uvsupp_${ts}@miljor.test`]
    );
    const unverifiedSupplierId = s2Res.insertId;
    createdUserIds.push(unverifiedSupplierId);
    await db.query(
      `INSERT INTO supplier_profiles (supplier_id, business_type, verification_status, verification_level, subscription_plan, max_active_listings)
       VALUES (?, 'TRADER', 'NOT_SUBMITTED', 'LEVEL_1_CONTACT', 'STARTER', 4)`,
      [unverifiedSupplierId]
    );

    const [admRes] = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, verification_status)
       VALUES (?, ?, 'test_hash', 'OPERATIONS_ADMIN', 'VERIFIED')`,
      [`E2 Catalog Admin ${ts}`, `e2_admin_${ts}@miljor.test`]
    );
    const adminId = admRes.insertId;
    createdUserIds.push(adminId);

    const jwtOpts = { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' };
    const verifiedSupplierToken = jwt.sign({ id: verifiedSupplierId, role: 'SUPPLIER' }, process.env.JWT_SECRET, jwtOpts);
    const unverifiedSupplierToken = jwt.sign({ id: unverifiedSupplierId, role: 'SUPPLIER' }, process.env.JWT_SECRET, jwtOpts);
    const adminToken = jwt.sign({ id: adminId, role: 'OPERATIONS_ADMIN' }, process.env.JWT_SECRET, jwtOpts);

    let familyRequestId;
    let approvedNewFamilyId;
    let variantRequestId;
    let approvedNewSpecId;
    let rejectedRequestId;

    await runTest('Supplier submits NEW_FAMILY request under Spices & Seasonings (category 6)', async () => {
      const res = await request(
        'POST',
        '/api/v1/catalog/requests',
        {
          request_type: 'NEW_FAMILY',
          category_id: 6,
          proposed_family_name: `Turmeric Powder E2 ${ts}`,
          supporting_notes: 'High-demand Haldi powder for Lahore restaurant kitchens'
        },
        verifiedSupplierToken
      );
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.request.status, 'SUBMITTED');
      assert.strictEqual(res.body.data.request.request_type, 'NEW_FAMILY');
      familyRequestId = res.body.data.request.id;
      createdRequestIds.push(familyRequestId);
    });

    await runTest('Duplicate NEW_FAMILY request for same category + name is rejected with 409 DUPLICATE_CATALOG_REQUEST', async () => {
      const res = await request(
        'POST',
        '/api/v1/catalog/requests',
        {
          request_type: 'NEW_FAMILY',
          category_id: 6,
          proposed_family_name: `  turmeric   powder e2 ${ts} `
        },
        unverifiedSupplierToken
      );
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error.code, 'DUPLICATE_CATALOG_REQUEST');
    });

    await runTest('Admin marks NEW_FAMILY request UNDER_REVIEW and then APPROVES it, creating canonical family & base product', async () => {
      const revRes = await request(
        'POST',
        `/api/v1/admin/catalog/requests/${familyRequestId}/review`,
        { review_notes: 'Checking Haldi taxonomy' },
        adminToken
      );
      assert.strictEqual(revRes.status, 200);
      assert.strictEqual(revRes.body.data.request.status, 'UNDER_REVIEW');

      const appRes = await request(
        'POST',
        `/api/v1/admin/catalog/requests/${familyRequestId}/approve`,
        { review_notes: 'Approved canonical Turmeric family' },
        adminToken
      );
      assert.strictEqual(appRes.status, 200);
      assert.strictEqual(appRes.body.data.request.status, 'APPROVED');
      assert.ok(appRes.body.data.approved_family.id);
      approvedNewFamilyId = appRes.body.data.approved_family.id;
      createdFamilyIds.push(approvedNewFamilyId);
      if (appRes.body.data.approved_family.default_product_id) {
        createdProductIds.push(appRes.body.data.approved_family.default_product_id);
      }
    });

    await runTest('Supplier submits NEW_VARIANT request under Gur / Jaggery (family 13, category 5)', async () => {
      const res = await request(
        'POST',
        '/api/v1/catalog/requests',
        {
          request_type: 'NEW_VARIANT',
          category_id: 5,
          family_id: 13,
          brand: `Charsadda Kissan ${ts}`,
          variety: 'Peshawari Chemical-Free Desi Gur',
          crop_year: '2026',
          processing_method: 'Traditional Open Pan',
          quality_grade: 'Grade A Golden',
          packaging_type: 'PP Woven Bag',
          pack_size: 25,
          pack_unit: 'kg',
          purchasing_unit: 'bag',
          spec_attributes: { gur_origin: 'Charsadda' },
          supporting_notes: 'Pure winter jaggery cones in 25kg bags'
        },
        verifiedSupplierToken
      );
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.request.status, 'SUBMITTED');
      variantRequestId = res.body.data.request.id;
      createdRequestIds.push(variantRequestId);
    });

    await runTest('Pending NEW_VARIANT request does NOT appear in public approved variants before admin approval', async () => {
      const res = await request('GET', '/api/v1/catalog/families/13/variants');
      assert.strictEqual(res.status, 200);
      const found = res.body.data.variants.find(v => v.brand === `Charsadda Kissan ${ts}`);
      assert.strictEqual(found, undefined, 'Unapproved variant must never pollute public catalog');
    });

    await runTest('Admin approves NEW_VARIANT request, atomically creating APPROVED product_specification under Gur / Jaggery', async () => {
      const appRes = await request(
        'POST',
        `/api/v1/admin/catalog/requests/${variantRequestId}/approve`,
        { review_notes: 'Verified Charsadda Gur 25kg specification' },
        adminToken
      );
      assert.strictEqual(appRes.status, 200);
      assert.strictEqual(appRes.body.data.request.status, 'APPROVED');
      assert.ok(appRes.body.data.approved_variant.id);
      approvedNewSpecId = appRes.body.data.approved_variant.id;
      createdSpecIds.push(approvedNewSpecId);

      // Verify base product if newly created for Gur / Jaggery
      const [famRows] = await db.query('SELECT default_product_id FROM catalog_product_families WHERE id = 13');
      if (famRows[0]?.default_product_id && famRows[0].default_product_id > 11) {
        createdProductIds.push(famRows[0].default_product_id);
      }

      const pubRes = await request('GET', '/api/v1/catalog/families/13/variants');
      const found = pubRes.body.data.variants.find(v => v.id === approvedNewSpecId);
      assert.ok(found, 'Newly approved variant must immediately appear under Gur / Jaggery');
    });

    await runTest('Verified supplier publishes commercial offer against newly approved variant and E3 family counter updates', async () => {
      const res = await request(
        'POST',
        '/api/v1/listings',
        {
          product_spec_id: approvedNewSpecId,
          base_unit_price: 6850,
          available_stock: 120,
          buyer_min_qty: 5,
          supplier_min_qty: 20,
          delivery_fee_policy: 'INCLUDED_IN_PRICE',
          fulfilment_lead_time_days: 2,
          notes: 'Fresh Charsadda Gur stock'
        },
        verifiedSupplierToken
      );
      assert.strictEqual(res.status, 201);
      const listing = res.body.data.listing;
      createdListingIds.push(listing.id);
      assert.strictEqual(listing.family_id, 13);
      assert.strictEqual(listing.family_name, 'Gur / Jaggery');
      assert.strictEqual(listing.category_id, 5);

      const myRes = await request('GET', '/api/v1/listings/me', null, verifiedSupplierToken);
      assert.strictEqual(myRes.status, 200);
      assert.strictEqual(myRes.body.data.catalog_usage.active_distinct_families, 1);
      assert.strictEqual(myRes.body.data.catalog_usage.active_offers, 1);
    });

    await runTest('Rejection workflow: Admin cannot reject without reason; with reason, supplier can edit and resubmit', async () => {
      const subRes = await request(
        'POST',
        '/api/v1/catalog/requests',
        {
          request_type: 'NEW_VARIANT',
          category_id: 4,
          family_id: 9, // Daal Moong
          brand: `Moong Brand ${ts}`,
          variety: 'Washed Yellow Moong',
          processing_method: 'Washed Split',
          quality_grade: 'Grade B',
          packaging_type: 'PP Woven Bag',
          pack_size: 25,
          pack_unit: 'kg',
          purchasing_unit: 'bag'
        },
        verifiedSupplierToken
      );
      assert.strictEqual(subRes.status, 201);
      rejectedRequestId = subRes.body.data.request.id;
      createdRequestIds.push(rejectedRequestId);

      // Empty rejection reason fails with 400
      const badRej = await request(
        'POST',
        `/api/v1/admin/catalog/requests/${rejectedRequestId}/reject`,
        { rejection_reason: 'bad' },
        adminToken
      );
      assert.strictEqual(badRej.status, 400);
      assert.strictEqual(badRej.body.error.code, 'REJECTION_REASON_REQUIRED');

      // Valid rejection succeeds
      const goodRej = await request(
        'POST',
        `/api/v1/admin/catalog/requests/${rejectedRequestId}/reject`,
        { rejection_reason: 'Please specify whether Moong is Dhuli (Washed) or Chilka and upgrade grade description.' },
        adminToken
      );
      assert.strictEqual(goodRej.status, 200);
      assert.strictEqual(goodRej.body.data.request.status, 'REJECTED');

      // Supplier edits and resubmits rejected request
      const resub = await request(
        'PUT',
        `/api/v1/catalog/requests/${rejectedRequestId}`,
        {
          variety: 'Daal Moong Dhuli (Washed Split)',
          quality_grade: 'Grade A Sortexed'
        },
        verifiedSupplierToken
      );
      assert.strictEqual(resub.status, 200);
      assert.strictEqual(resub.body.data.request.status, 'SUBMITTED');
      assert.strictEqual(resub.body.data.request.quality_grade, 'Grade A Sortexed');
    });

    console.log('\n================================================================================');
    console.log(`PACKAGE E2 MODERATION GATE VERDICT: ALL ${passed}/${total} TESTS PASSED (100% GREEN)`);
    console.log('================================================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ PACKAGE E2 MODERATION GATE FAILED:', err);
    process.exit(1);
  } finally {
    if (createdListingIds.length > 0) {
      await db.query(`DELETE FROM supplier_listings WHERE id IN (${createdListingIds.join(',')})`).catch(() => {});
    }
    if (createdRequestIds.length > 0) {
      await db.query(`DELETE FROM catalog_moderation_logs WHERE request_id IN (${createdRequestIds.join(',')})`).catch(() => {});
      await db.query(`DELETE FROM catalog_requests WHERE id IN (${createdRequestIds.join(',')})`).catch(() => {});
    }
    if (createdSpecIds.length > 0) {
      await db.query(`DELETE FROM catalog_moderation_logs WHERE entity_type = 'VARIANT' AND entity_id IN (${createdSpecIds.join(',')})`).catch(() => {});
      await db.query(`DELETE FROM product_specifications WHERE id IN (${createdSpecIds.join(',')})`).catch(() => {});
    }
    if (createdFamilyIds.length > 0) {
      await db.query(`UPDATE catalog_product_families SET default_product_id = NULL WHERE id IN (${createdFamilyIds.join(',')})`).catch(() => {});
    }
    if (createdProductIds.length > 0) {
      await db.query(`UPDATE catalog_product_families SET default_product_id = NULL WHERE default_product_id IN (${createdProductIds.join(',')})`).catch(() => {});
      await db.query(`DELETE FROM products WHERE id IN (${createdProductIds.join(',')})`).catch(() => {});
    }
    if (createdFamilyIds.length > 0) {
      await db.query(`DELETE FROM catalog_product_families WHERE id IN (${createdFamilyIds.join(',')})`).catch(() => {});
    }
    if (createdUserIds.length > 0) {
      await db.query(`DELETE FROM catalog_moderation_logs WHERE actor_id IN (${createdUserIds.join(',')})`).catch(() => {});
      await db.query(`DELETE FROM supplier_profiles WHERE supplier_id IN (${createdUserIds.join(',')})`).catch(() => {});
      await db.query(`DELETE FROM users WHERE id IN (${createdUserIds.join(',')})`).catch(() => {});
    }
    if (server) server.close();
  }
})();
