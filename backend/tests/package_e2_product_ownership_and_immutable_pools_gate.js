// =============================================================================
// tests/package_e2_product_ownership_and_immutable_pools_gate.js
// MilJor Package E2 Master Gate:
// 1. 6-Level Product Ownership Hierarchy (Supplier-Owned Products & Physical SKUs)
// 2. Optional Brand (is_unbranded) & Optional Quality Grade (zero forced grades)
// 3. Separate SKUs per Pack Size (25kg vs 50kg) & Mass vs Volume Unit Separation
// 4. SKU Lifecycle (DRAFT -> PUBLISHED Immutable -> ARCHIVED)
// 5. Regular Pool Supplier Ownership (Admin cannot create/edit/publish supplier pools)
// 6. Published Pool 100% Commercial Immutability (even with 0 reservations)
// 7. Mandatory 24–72 Hour Supplier-Defined Delivery SLA Boundary Verification
// 8. Concurrency Race Protection (Draft Update vs Publish) & Buyer Reservation Flow
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
let passed = 0;
let failed = 0;

function pass(name) {
  passed++;
  console.log(`  ✓ PASS: ${name}`);
}

function fail(name, err) {
  failed++;
  console.error(`  ✗ FAIL: ${name}`);
  console.error(`    ${err && err.stack ? err.stack : err}`);
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (!options.skipIdempotency && ['POST', 'PUT', 'PATCH'].includes(method) && !headers['X-Idempotency-Key'] && !headers['x-idempotency-key']) {
    headers['X-Idempotency-Key'] = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
        resolve({ status: res.statusCode, body, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

function makeToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

async function runGate() {
  console.log('\n================================================================================');
  console.log('MILJOR PACKAGE E2: SUPPLIER PRODUCT OWNERSHIP & IMMUTABLE POOLS GATE');
  console.log('================================================================================\n');

  const createdUserIds = [];
  const createdSupplierProductIds = [];
  const createdSupplierSkuIds = [];
  const createdSpecIds = [];
  const createdListingIds = [];
  const createdPoolIds = [];
  const createdRequestIds = [];
  const createdFamilyIds = [];

  // Record baseline counts on miljor_test_db
  const [[beforeProdCount]] = await db.query('SELECT COUNT(*) AS cnt FROM products WHERE id <= 11');
  const [[beforeSpecCount]] = await db.query('SELECT COUNT(*) AS cnt FROM product_specifications WHERE id <= 16');

  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Create test actors: Verified Supplier A, Verified Supplier B, Unverified Supplier C, Admin, Verified Buyer
    const ts = Date.now();
    const [supARes] = await db.query(
      `INSERT INTO users (full_name, business_name, email, phone, password_hash, role, is_verified, verification_status)
       VALUES ('Supplier A', 'Lahore Rice & Grain Mills', ?, ?, 'hash', 'SUPPLIER', 1, 'VERIFIED')`,
      [`supA.${ts}@miljor.test`, `0301${String(ts).slice(-7)}`]
    );
    const supAId = supARes.insertId;
    createdUserIds.push(supAId);
    await db.query(
      `INSERT INTO supplier_profiles (supplier_id, verification_status, verification_level, subscription_plan, max_active_listings)
       VALUES (?, 'VERIFIED', 'LEVEL_2_BUSINESS', 'BUSINESS', 25)`,
      [supAId]
    );

    const [supBRes] = await db.query(
      `INSERT INTO users (full_name, business_name, email, phone, password_hash, role, is_verified, verification_status)
       VALUES ('Supplier B', 'Punjab Traders', ?, ?, 'hash', 'SUPPLIER', 1, 'VERIFIED')`,
      [`supB.${ts}@miljor.test`, `0302${String(ts).slice(-7)}`]
    );
    const supBId = supBRes.insertId;
    createdUserIds.push(supBId);
    await db.query(
      `INSERT INTO supplier_profiles (supplier_id, verification_status, verification_level, subscription_plan, max_active_listings)
       VALUES (?, 'VERIFIED', 'LEVEL_2_BUSINESS', 'STARTER', 4)`,
      [supBId]
    );

    const [supCRes] = await db.query(
      `INSERT INTO users (full_name, business_name, email, phone, password_hash, role, is_verified, verification_status)
       VALUES ('Supplier C Unverified', 'New Unverified Mill', ?, ?, 'hash', 'SUPPLIER', 0, 'UNVERIFIED')`,
      [`supC.${ts}@miljor.test`, `0303${String(ts).slice(-7)}`]
    );
    const supCId = supCRes.insertId;
    createdUserIds.push(supCId);
    await db.query(
      `INSERT INTO supplier_profiles (supplier_id, subscription_plan, max_active_listings)
       VALUES (?, 'STARTER', 4)`,
      [supCId]
    );

    const [adminRes] = await db.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role, is_verified, verification_status)
       VALUES ('Catalog Admin', ?, ?, 'hash', 'SUPER_ADMIN', 1, 'VERIFIED')`,
      [`admin.${ts}@miljor.test`, `0304${String(ts).slice(-7)}`]
    );
    const adminId = adminRes.insertId;
    createdUserIds.push(adminId);

    const [buyerRes] = await db.query(
      `INSERT INTO users (full_name, business_name, email, phone, password_hash, role, is_verified, verification_status, buyer_trust_status, base_cluster_id)
       VALUES ('Buyer Restaurant', 'Gulberg Tikka House', ?, ?, 'hash', 'BUYER', 1, 'VERIFIED', 'CONTACT_VERIFIED', 4)`,
      [`buyer.${ts}@miljor.test`, `0305${String(ts).slice(-7)}`]
    );
    const buyerId = buyerRes.insertId;
    createdUserIds.push(buyerId);
    await db.query(
      `INSERT INTO buyer_delivery_addresses (user_id, city, cluster_id, society_area, full_address, is_default)
       VALUES (?, 'Lahore', 4, 'Gulberg III', 'Plot 12, MM Alam Road, Gulberg III, Lahore', 1)`,
      [buyerId]
    );

    const supAToken = makeToken({ id: supAId, email: `supA.${ts}@miljor.test`, role: 'SUPPLIER' });
    const supBToken = makeToken({ id: supBId, email: `supB.${ts}@miljor.test`, role: 'SUPPLIER' });
    const supCToken = makeToken({ id: supCId, email: `supC.${ts}@miljor.test`, role: 'SUPPLIER' });
    const adminToken = makeToken({ id: adminId, email: `admin.${ts}@miljor.test`, role: 'SUPER_ADMIN' });
    const buyerToken = makeToken({ id: buyerId, email: `buyer.${ts}@miljor.test`, role: 'BUYER' });

    // Fetch canonical families for Rice (solid mass) and Cooking Oil (liquid volume)
    const famRes = await api('/api/v1/catalog/families');
    assert.strictEqual(famRes.status, 200);
    const families = famRes.body.data.families;
    const riceFamily = families.find(f => f.slug === 'rice');
    const oilFamily = families.find(f => f.slug === 'cooking-oil');
    assert.ok(riceFamily, 'Rice canonical family must exist');
    assert.ok(oilFamily, 'Cooking Oil canonical family must exist');
    pass('1. Canonical categories and families (Rice & Cooking Oil) retrieved');

    // B1: Admin owns the family taxonomy, but cannot create a new supplier
    // physical SKU through the retired global-variant creation endpoint.
    try {
      const rejected = await api('/api/v1/admin/catalog/variants', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { family_id: riceFamily.id, variety: 'Admin Imagined Rice', packaging_type: 'Bag', pack_size: 25, pack_unit: 'kg' }
      });
      assert.strictEqual(rejected.status, 409);
      assert.strictEqual(rejected.body.error.code, 'SUPPLIER_OWNED_VARIANTS');
      pass('B1: Admin physical-variant creation blocked; supplier-owned SKU path remains authoritative');
    } catch (e) { fail('B1: Admin variant creation block', e); }

    // =========================================================================
    // SECTION A: SUPPLIER-OWNED PRODUCTS & PHYSICAL SKUs (BRAND/GRADE OPTIONAL)
    // =========================================================================
    let brandedProdId;
    let unbrandedProdId;
    let sku25kgId;
    let sku50kgId;
    let unbrandedSkuId;

    // 2. Supplier A creates a BRANDED product with optional quality_grade in DRAFT
    try {
      const res = await api('/api/v1/catalog/supplier-products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          family_id: riceFamily.id,
          brand: 'Al-Barakah Royal',
          variety: `1121 Kainat Steam ${ts}`,
          quality_grade: 'XXL Long Grain Export',
          processing_method: 'Double Silky Sortexed',
          crop_year: '2026',
          origin: 'Punjab, Pakistan'
        }
      });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      const sp = res.body.data.product;
      brandedProdId = sp.id;
      createdSupplierProductIds.push(brandedProdId);
      assert.strictEqual(sp.status, 'DRAFT');
      assert.strictEqual(sp.brand, 'Al-Barakah Royal');
      assert.strictEqual(Boolean(sp.is_unbranded), false);
      assert.strictEqual(sp.quality_grade, 'XXL Long Grain Export');
      pass('2. Supplier A creates BRANDED Supplier-Owned Product with optional grade in DRAFT');
    } catch (e) { fail('2. Branded product creation', e); }

    // 3. Supplier A creates an UNBRANDED commodity product WITHOUT quality_grade or processing_method
    try {
      const res = await api('/api/v1/catalog/supplier-products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          family_id: riceFamily.id,
          is_unbranded: true,
          variety: `Mandi Loose Super Basmati ${ts}`
          // brand, quality_grade, processing_method intentionally omitted!
        }
      });
      assert.strictEqual(res.status, 201, JSON.stringify(res.body));
      const sp = res.body.data.product;
      unbrandedProdId = sp.id;
      createdSupplierProductIds.push(unbrandedProdId);
      assert.strictEqual(sp.status, 'DRAFT');
      assert.strictEqual(sp.brand, null, 'Unbranded product must have brand = null');
      assert.strictEqual(Boolean(sp.is_unbranded), true, 'Unbranded product must have is_unbranded = true');
      assert.strictEqual(sp.quality_grade, null, 'Omitted quality_grade must remain null (never forced)');
      assert.strictEqual(sp.processing_method, null, 'Omitted processing_method must remain null');
      pass('3. Supplier A creates UNBRANDED product with NULL brand and NULL quality_grade (zero forced grades)');
    } catch (e) { fail('3. Unbranded & gradeless product creation', e); }

    // 4. Supplier A edits DRAFT product before publication
    try {
      const res = await api(`/api/v1/catalog/supplier-products/${brandedProdId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          description: 'Updated draft description for 2026 harvest'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.data.product.description, 'Updated draft description for 2026 harvest');
      pass('4. Supplier A edits DRAFT Supplier-Owned Product successfully');
    } catch (e) { fail('4. Edit draft supplier product', e); }

    // 5. Supplier A creates TWO separate Physical SKUs (25kg bag vs 50kg bag) under the same Supplier Product
    try {
      const res25 = await api('/api/v1/catalog/supplier-skus', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          supplier_product_id: brandedProdId,
          packaging_type: 'PP Woven Bag',
          pack_size: 25,
          pack_unit: 'kg',
          purchasing_unit: 'bag'
        }
      });
      assert.strictEqual(res25.status, 201, JSON.stringify(res25.body));
      sku25kgId = res25.body.data.sku.id;
      createdSupplierSkuIds.push(sku25kgId);

      const res50 = await api('/api/v1/catalog/supplier-skus', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          supplier_product_id: brandedProdId,
          packaging_type: 'PP Woven Bag',
          pack_size: 50,
          pack_unit: 'kg',
          purchasing_unit: 'bag'
        }
      });
      assert.strictEqual(res50.status, 201, JSON.stringify(res50.body));
      sku50kgId = res50.body.data.sku.id;
      createdSupplierSkuIds.push(sku50kgId);

      assert.notStrictEqual(sku25kgId, sku50kgId, '25kg and 50kg must be separate SKUs');
      assert.notStrictEqual(res25.body.data.sku.sku_hash, res50.body.data.sku.sku_hash);

      // Also create a 25kg SKU for the unbranded gradeless product
      const resUnbSku = await api('/api/v1/catalog/supplier-skus', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          supplier_product_id: unbrandedProdId,
          packaging_type: 'Jute Sack',
          pack_size: 25,
          pack_unit: 'kg',
          purchasing_unit: 'sack'
        }
      });
      assert.strictEqual(resUnbSku.status, 201);
      unbrandedSkuId = resUnbSku.body.data.sku.id;
      createdSupplierSkuIds.push(unbrandedSkuId);

      // B1: A supplier may choose an uncommon pack size and packaging term.
      // No global 25/50kg or fixed purchasing-unit list may be imposed.
      const customPack = await api('/api/v1/catalog/supplier-skus', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          supplier_product_id: brandedProdId,
          packaging_type: 'Custom Wholesale Sack',
          pack_size: 37,
          pack_unit: 'kg',
          purchasing_unit: 'bundle'
        }
      });
      assert.strictEqual(customPack.status, 201, JSON.stringify(customPack.body));
      createdSupplierSkuIds.push(customPack.body.data.sku.id);
      assert.strictEqual(Number(customPack.body.data.sku.pack_size), 37);
      assert.strictEqual(customPack.body.data.sku.purchasing_unit, 'bundle');
      pass('B1: Supplier-defined 37kg packaging and custom purchasing unit accepted without canonical variant approval');

      pass('5. Supplier A creates distinct 25kg and 50kg Physical SKUs under the same Supplier Product');
    } catch (e) { fail('5. Separate 25kg and 50kg SKUs', e); }

    // 6. Strict Mass vs Volume Separation: Solid family (Rice) rejects Litres ('L'); Liquid family (Cooking Oil) rejects Kilograms ('kg')
    try {
      const badRiceSku = await api('/api/v1/catalog/supplier-skus', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          supplier_product_id: brandedProdId,
          packaging_type: 'Tin',
          pack_size: 16,
          pack_unit: 'L', // Invalid for Rice!
          purchasing_unit: 'tin'
        }
      });
      assert.strictEqual(badRiceSku.status, 400);
      assert.strictEqual(badRiceSku.body.error.code, 'INCOMPATIBLE_FAMILY_UNIT');

      // Create a Cooking Oil product and try to attach a 'kg' SKU
      const oilProdRes = await api('/api/v1/catalog/supplier-products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          family_id: oilFamily.id,
          is_unbranded: true,
          variety: `RBD Palm Olein ${ts}`
        }
      });
      assert.strictEqual(oilProdRes.status, 201);
      const oilProdId = oilProdRes.body.data.product.id;
      createdSupplierProductIds.push(oilProdId);

      const badOilSku = await api('/api/v1/catalog/supplier-skus', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          supplier_product_id: oilProdId,
          packaging_type: 'PP Woven Bag',
          pack_size: 25,
          pack_unit: 'kg', // Invalid for Cooking Oil (allowed: L, mL)!
          purchasing_unit: 'bag'
        }
      });
      assert.strictEqual(badOilSku.status, 400);
      assert.strictEqual(badOilSku.body.error.code, 'INCOMPATIBLE_FAMILY_UNIT');

      const customOil = await api('/api/v1/catalog/supplier-skus', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          supplier_product_id: oilProdId,
          packaging_type: 'Bulk Jerrycan',
          pack_size: 12,
          pack_unit: 'L',
          purchasing_unit: 'jerrycan'
        }
      });
      assert.strictEqual(customOil.status, 201, JSON.stringify(customOil.body));
      createdSupplierSkuIds.push(customOil.body.data.sku.id);
      assert.strictEqual(Number(customOil.body.data.sku.pack_size), 12);
      pass('B1: Supplier-defined 12L oil SKU accepted; compatible volume dimension enforced');

      pass('6. Mass vs Volume unit separation enforced: Rice rejects L and Cooking Oil rejects kg (400 INCOMPATIBLE_FAMILY_UNIT)');
    } catch (e) { fail('6. Mass vs Volume unit separation', e); }

    // 7. DRAFT SKU can be edited; publishing locks both SKU and parent product permanently
    let publishedSpec25Id;
    let publishedUnbSpecId;
    try {
      const editDraftSku = await api(`/api/v1/catalog/supplier-skus/${sku25kgId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: { notes: 'Triple-stitched export bag' }
      });
      assert.strictEqual(editDraftSku.status, 200);

      // Publish 25kg branded SKU
      const pubRes = await api(`/api/v1/catalog/supplier-skus/${sku25kgId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` }
      });
      assert.strictEqual(pubRes.status, 200, JSON.stringify(pubRes.body));
      assert.strictEqual(pubRes.body.data.sku.status, 'PUBLISHED');
      assert.ok(pubRes.body.data.sku.linked_spec_id, 'Published SKU must have linked_spec_id');
      publishedSpec25Id = pubRes.body.data.sku.linked_spec_id;
      createdSpecIds.push(publishedSpec25Id);

      // Publish 25kg unbranded gradeless SKU
      const pubUnbRes = await api(`/api/v1/catalog/supplier-skus/${unbrandedSkuId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` }
      });
      assert.strictEqual(pubUnbRes.status, 200, JSON.stringify(pubUnbRes.body));
      publishedUnbSpecId = pubUnbRes.body.data.sku.linked_spec_id;
      createdSpecIds.push(publishedUnbSpecId);

      // Verify bridge row in product_specifications preserves null brand and null quality_grade
      const [unbSpecRows] = await db.query('SELECT * FROM product_specifications WHERE id = ?', [publishedUnbSpecId]);
      assert.strictEqual(unbSpecRows[0].brand, null);
      assert.strictEqual(unbSpecRows[0].is_unbranded, 1);
      assert.strictEqual(unbSpecRows[0].quality_grade, null);
      assert.strictEqual(unbSpecRows[0].lifecycle_status, 'PUBLISHED');

      // Attempting to edit PUBLISHED SKU physical identity must fail with 409 SKU_IDENTITY_LOCKED
      const mutateSku = await api(`/api/v1/catalog/supplier-skus/${sku25kgId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: { pack_size: 30 }
      });
      assert.strictEqual(mutateSku.status, 409);
      assert.strictEqual(mutateSku.body.error.code, 'SKU_IDENTITY_LOCKED');

      // Attempting to edit PUBLISHED parent product physical identity must fail with 409 PRODUCT_IDENTITY_LOCKED
      const mutateProd = await api(`/api/v1/catalog/supplier-products/${brandedProdId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: { variety: 'Tampered Variety' }
      });
      assert.strictEqual(mutateProd.status, 409);
      assert.strictEqual(mutateProd.body.error.code, 'PRODUCT_IDENTITY_LOCKED');

      pass('7. Publishing SKU links product_specifications bridge row and permanently locks SKU & parent product identity');
    } catch (e) { fail('7. SKU publish & immutability lock', e); }

    // 8. Cross-supplier isolation: Supplier B cannot edit, publish, or archive Supplier A's product or SKU
    try {
      const editByB = await api(`/api/v1/catalog/supplier-skus/${sku50kgId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supBToken}` },
        body: { pack_size: 10 }
      });
      assert.strictEqual(editByB.status, 403);

      const pubByB = await api(`/api/v1/catalog/supplier-skus/${sku50kgId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supBToken}` }
      });
      assert.strictEqual(pubByB.status, 403);

      const archByB = await api(`/api/v1/catalog/supplier-products/${brandedProdId}/archive`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supBToken}` }
      });
      assert.strictEqual(archByB.status, 403);

      pass('8. Cross-supplier isolation enforced: Supplier B blocked from editing/publishing/archiving Supplier A SKUs (403)');
    } catch (e) { fail('8. Cross-supplier SKU isolation', e); }

    // 9. Commercial Listing creation from PUBLISHED supplier_sku_id & Unverified Supplier block
    let listingAId;
    try {
      // Unverified Supplier C cannot create listing
      const unvRes = await api('/api/v1/listings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supCToken}` },
        body: {
          product_spec_id: 1,
          base_unit_price: 5000,
          available_stock: 100,
          buyer_min_qty: 2,
          supplier_min_qty: 10
        }
      });
      assert.strictEqual(unvRes.status, 403);

      // Supplier A creates commercial listing directly via supplier_sku_id
      const listRes = await api('/api/v1/listings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          supplier_sku_id: sku25kgId,
          base_unit_price: 6800,
          available_stock: 500,
          buyer_min_qty: 2,
          supplier_min_qty: 10,
          delivery_fee_policy: 'INCLUDED_IN_PRICE',
          fulfilment_lead_time_days: 2
        }
      });
      assert.strictEqual(listRes.status, 201, JSON.stringify(listRes.body));
      listingAId = listRes.body.data.listing.id;
      createdListingIds.push(listingAId);
      assert.strictEqual(Number(listRes.body.data.listing.supplier_sku_id), Number(sku25kgId));
      assert.strictEqual(Number(listRes.body.data.listing.product_spec_id), Number(publishedSpec25Id));

      pass('9. Verified Supplier A creates commercial listing from published supplier_sku_id; Unverified Supplier C blocked (403)');
    } catch (e) { fail('9. Commercial listing creation from supplier_sku_id', e); }

    // 10. Missing Family Request (NEW_FAMILY) end-to-end moderation
    try {
      const reqRes = await api('/api/v1/catalog/requests', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          request_type: 'NEW_FAMILY',
          category_id: riceFamily.category_id,
          proposed_family_name: `Barley & Jau Grain ${ts}`,
          supporting_notes: 'Needed for Lahore wholesale buyers'
        }
      });
      assert.strictEqual(reqRes.status, 201);
      const reqId = reqRes.body.data.request.id;
      createdRequestIds.push(reqId);

      const revRes = await api(`/api/v1/admin/catalog/requests/${reqId}/review`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { admin_review_notes: 'Reviewing family request' }
      });
      assert.strictEqual(revRes.status, 200);

      const appRes = await api(`/api/v1/admin/catalog/requests/${reqId}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          allowed_pack_units: ['kg', 'g'],
          allowed_purchasing_units: ['bag', 'sack']
        }
      });
      assert.strictEqual(appRes.status, 200);
      createdFamilyIds.push(appRes.body.data.approved_family_id);

      pass('10. Missing Product Family request (NEW_FAMILY) submitted, reviewed, and approved by Admin');
    } catch (e) { fail('10. NEW_FAMILY moderation workflow', e); }

    // =========================================================================
    // SECTION B: REGULAR POOL OWNERSHIP, 24–72H DELIVERY SLA & 100% IMMUTABILITY
    // =========================================================================
    const closeTime = new Date(Date.now() + 48 * 3600 * 1000); // Pool closes 48h from now

    // 11. Rule P1: Admin cannot create a Regular Pool on behalf of a supplier (403 SUPPLIER_CONSENT_REQUIRED)
    try {
      const adminCreate = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          supplier_sku_id: sku25kgId,
          supplier_listing_id: listingAId,
          target_qty: 50,
          supplier_min_qty: 10,
          buyer_min_qty: 2,
          max_capacity: 100,
          scheduled_close_at: closeTime.toISOString(),
          promised_delivery_at: new Date(closeTime.getTime() + 48 * 3600 * 1000).toISOString()
        }
      });
      assert.strictEqual(adminCreate.status, 403);
      assert.strictEqual(adminCreate.body.error.subcode, 'SUPPLIER_CONSENT_REQUIRED');
      pass('11. Rule P1: Admin blocked from creating Regular Pool (403 SUPPLIER_CONSENT_REQUIRED)');
    } catch (e) { fail('11. Admin blocked from creating pool', e); }

    // 12. Rule P7: Delivery SLA Boundary Rejections (< cutoff, +12h, +23h59m, +72h01m, +96h)
    try {
      const invalidCases = [
        { label: 'Before close (-2h)', offsetMs: -2 * 3600 * 1000, expectedSubcode: 'DELIVERY_BEFORE_POOL_CLOSE' },
        { label: 'Too early (+12h)', offsetMs: 12 * 3600 * 1000, expectedSubcode: 'DELIVERY_SLA_TOO_EARLY' },
        { label: 'Too early (+23h 59m)', offsetMs: (24 * 3600 - 60) * 1000, expectedSubcode: 'DELIVERY_SLA_TOO_EARLY' },
        { label: 'Too late (+72h 01m)', offsetMs: (72 * 3600 + 60) * 1000, expectedSubcode: 'DELIVERY_SLA_TOO_LATE' },
        { label: 'Too late (+96h)', offsetMs: 96 * 3600 * 1000, expectedSubcode: 'DELIVERY_SLA_TOO_LATE' }
      ];

      for (const tc of invalidCases) {
        const res = await api('/api/v1/pools', {
          method: 'POST',
          headers: { Authorization: `Bearer ${supAToken}` },
          body: {
            supplier_sku_id: sku25kgId,
            supplier_listing_id: listingAId,
            target_qty: 40,
            supplier_min_qty: 10,
            buyer_min_qty: 2,
            max_capacity: 80,
            scheduled_close_at: closeTime.toISOString(),
            promised_delivery_at: new Date(closeTime.getTime() + tc.offsetMs).toISOString()
          }
        });
        assert.strictEqual(res.status, 422, `Expected 422 for ${tc.label}, got ${res.status}`);
        assert.strictEqual(res.body.error.code, 'DELIVERY_SLA_OUT_OF_RANGE');
        assert.strictEqual(res.body.error.subcode, tc.expectedSubcode);
      }
      pass('12. Rule P7: Invalid promised_delivery_at offsets (-2h, +12h, +23h59m, +72h01m, +96h) strictly rejected with 422 DELIVERY_SLA_OUT_OF_RANGE');
    } catch (e) { fail('12. Delivery SLA invalid boundaries', e); }

    // 13. Rule P6 & P7: Missing promised_delivery_at at publish time is rejected (422 PROMISED_DELIVERY_REQUIRED)
    let draftPoolId;
    try {
      // Create DRAFT pool with scheduled_close_at but NO promised_delivery_at
      const draftRes = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          supplier_sku_id: sku25kgId,
          supplier_listing_id: listingAId,
          target_qty: 40,
          supplier_min_qty: 10,
          buyer_min_qty: 2,
          max_capacity: 80,
          scheduled_close_at: closeTime.toISOString(),
          delivery_clusters: [1, 4],
          price_tiers: [
            { min_qty: 10, max_qty: 39, price_per_unit: 6800, pricing_unit: 'bag' },
            { min_qty: 40, max_qty: 80, price_per_unit: 6500, pricing_unit: 'bag' }
          ]
        }
      });
      assert.strictEqual(draftRes.status, 201, JSON.stringify(draftRes.body));
      draftPoolId = draftRes.body.data.pool.id;
      createdPoolIds.push(draftPoolId);
      assert.strictEqual(draftRes.body.data.pool.status, 'DRAFT');
      assert.strictEqual(draftRes.body.data.pool.promised_delivery_at, null);

      // Attempt to publish without promised_delivery_at -> Must fail with 422 PROMISED_DELIVERY_REQUIRED
      const pubNoSla = await api(`/api/v1/pools/${draftPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {}
      });
      assert.strictEqual(pubNoSla.status, 422);
      assert.strictEqual(pubNoSla.body.error.code, 'PROMISED_DELIVERY_REQUIRED');

      pass('13. Publishing a pool without promised_delivery_at rejected with 422 PROMISED_DELIVERY_REQUIRED');
    } catch (e) { fail('13. Missing promised_delivery_at rejected on publish', e); }

    // 14. Exact 24h, 48h, and Exact 72h Delivery SLA Boundaries Accepted + Draft Editing Works
    try {
      // Test exact +24h boundary on draft update
      const exact24h = new Date(closeTime.getTime() + 24 * 3600 * 1000).toISOString();
      const up24 = await api(`/api/v1/pools/${draftPoolId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: { promised_delivery_at: exact24h }
      });
      assert.strictEqual(up24.status, 200, `Exact +24h failed: ${JSON.stringify(up24.body)}`);

      // Test exact +72h boundary on draft update
      const exact72h = new Date(closeTime.getTime() + 72 * 3600 * 1000).toISOString();
      const up72 = await api(`/api/v1/pools/${draftPoolId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: { promised_delivery_at: exact72h }
      });
      assert.strictEqual(up72.status, 200, `Exact +72h failed: ${JSON.stringify(up72.body)}`);

      // Set final draft terms with +48h promised_delivery_at and target_qty = 50
      const promised48h = new Date(closeTime.getTime() + 48 * 3600 * 1000).toISOString();
      const up48 = await api(`/api/v1/pools/${draftPoolId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          target_qty: 50,
          promised_delivery_at: promised48h,
          price_tiers: [
            { min_qty: 10, max_qty: 49, price_per_unit: 6750, pricing_unit: 'bag' },
            { min_qty: 50, max_qty: 80, price_per_unit: 6450, pricing_unit: 'bag' }
          ]
        }
      });
      assert.strictEqual(up48.status, 200);
      assert.strictEqual(Number(up48.body.data.pool.target_qty), 50);

      pass('14. Exact +24h, +48h, and exact +72h delivery SLA boundaries accepted and DRAFT pool updated');
    } catch (e) { fail('14. Valid 24h/48h/72h SLA boundaries', e); }

    // 15. Admin and Supplier B cannot edit or publish Supplier A's DRAFT pool
    try {
      const adminEdit = await api(`/api/v1/pools/${draftPoolId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { target_qty: 60 }
      });
      assert.strictEqual(adminEdit.status, 403);

      const adminPub = await api(`/api/v1/pools/${draftPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(adminPub.status, 403);

      const supBPub = await api(`/api/v1/pools/${draftPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supBToken}` }
      });
      assert.strictEqual(supBPub.status, 403);

      pass('15. Admin and Supplier B blocked from editing or publishing Supplier A\'s pool (403 FORBIDDEN)');
    } catch (e) { fail('15. Admin/Supplier B pool authorization', e); }

    // 16. Supplier A publishes DRAFT pool -> ACTIVE, is_terms_locked = 1, published_terms_snapshot recorded
    let lockedPromisedDelivery;
    try {
      const pubRes = await api(`/api/v1/pools/${draftPoolId}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` }
      });
      assert.strictEqual(pubRes.status, 200, JSON.stringify(pubRes.body));
      const pool = pubRes.body.data.pool;
      assert.strictEqual(pool.status, 'ACTIVE');
      assert.strictEqual(Number(pool.is_terms_locked), 1);
      assert.ok(pool.published_at, 'published_at must be set');
      assert.ok(pool.promised_delivery_at, 'promised_delivery_at must be set');
      assert.ok(pool.published_terms_snapshot, 'published_terms_snapshot must be recorded');
      assert.strictEqual(Number(pool.published_terms_snapshot.target_qty), 50);
      lockedPromisedDelivery = pool.promised_delivery_at;

      pass('16. Supplier A publishes pool: status = ACTIVE, is_terms_locked = 1, published_terms_snapshot recorded');
    } catch (e) { fail('16. Publish pool & lock terms', e); }

    // 17. Rule P3 & P4: Published pool WITH ZERO RESERVATIONS is 100% immutable across all commercial fields & clusters!
    try {
      const mutationAttempts = [
        { label: 'target_qty', body: { target_qty: 60 } },
        { label: 'supplier_min_qty', body: { supplier_min_qty: 15 } },
        { label: 'buyer_min_qty', body: { buyer_min_qty: 5 } },
        { label: 'max_capacity', body: { max_capacity: 90 } },
        { label: 'scheduled_close_at', body: { scheduled_close_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString() } },
        { label: 'promised_delivery_at', body: { promised_delivery_at: new Date(closeTime.getTime() + 60 * 3600 * 1000).toISOString() } },
        { label: 'delivery_type', body: { delivery_type: 'SUPPLIER_PICKUP' } },
        { label: 'price_tiers', body: { price_tiers: [{ min_qty: 10, max_qty: 80, price_per_unit: 7000, pricing_unit: 'bag' }] } },
        { label: 'revert to DRAFT', body: { status: 'DRAFT' } }
      ];

      for (const att of mutationAttempts) {
        const res = await api(`/api/v1/pools/${draftPoolId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${supAToken}` },
          body: att.body
        });
        assert.strictEqual(res.status, 422, `Expected 422 when mutating ${att.label} on published pool`);
        assert.strictEqual(res.body.error.code, 'INVALID_POOL_STATE');
        assert.strictEqual(res.body.error.subcode, 'POOL_TERMS_IMMUTABLE');
      }

      // Attempting to mutate delivery clusters on published pool WITH ZERO RESERVATIONS must also fail with 422 POOL_COVERAGE_LOCKED
      const clusterMutRes = await api(`/api/v1/pools/${draftPoolId}/clusters`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: { delivery_clusters: [1] }
      });
      assert.strictEqual(clusterMutRes.status, 422);
      assert.strictEqual(clusterMutRes.body.error.code, 'POOL_COVERAGE_LOCKED');
      assert.strictEqual(clusterMutRes.body.error.subcode, 'POOL_TERMS_IMMUTABLE');

      pass('17. Rule P3 & P4: Published pool with ZERO reservations rejects all commercial & cluster mutations (422 POOL_TERMS_IMMUTABLE)');
    } catch (e) { fail('17. Published pool 0-reservation immutability', e); }

    // 18. Concurrent DRAFT edit vs publish race condition protection
    try {
      const raceDraftRes = await api('/api/v1/pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: {
          supplier_sku_id: sku25kgId,
          supplier_listing_id: listingAId,
          target_qty: 30,
          supplier_min_qty: 10,
          buyer_min_qty: 2,
          max_capacity: 60,
          scheduled_close_at: closeTime.toISOString(),
          promised_delivery_at: new Date(closeTime.getTime() + 36 * 3600 * 1000).toISOString(),
          price_tiers: [
            { min_qty: 10, max_qty: 60, price_per_unit: 6800, pricing_unit: 'bag' }
          ]
        }
      });
      assert.strictEqual(raceDraftRes.status, 201);
      const racePoolId = raceDraftRes.body.data.pool.id;
      createdPoolIds.push(racePoolId);

      // Fire publish and draft update concurrently
      const [pubRace, editRace] = await Promise.all([
        api(`/api/v1/pools/${racePoolId}/publish`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${supAToken}` }
        }),
        api(`/api/v1/pools/${racePoolId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${supAToken}` },
          body: { target_qty: 45 }
        })
      ]);

      assert.strictEqual(pubRace.status, 200);
      // Verify the final database state matches the published snapshot!
      const finalCheck = await api(`/api/v1/pools/${racePoolId}`);
      const finalPool = finalCheck.body.data.pool;
      assert.strictEqual(finalPool.status, 'ACTIVE');
      assert.strictEqual(Number(finalPool.is_terms_locked), 1);
      assert.strictEqual(
        Number(finalPool.target_qty),
        Number(finalPool.published_terms_snapshot.target_qty),
        'Published pool target_qty must match its locked published_terms_snapshot'
      );

      pass('18. Concurrent DRAFT update vs publish serialized cleanly via SELECT FOR UPDATE with zero snapshot drift');
    } catch (e) { fail('18. Concurrent draft update vs publish race', e); }

    // 19. Rule P5: Buyer joins published pool -> current_qty updates while commercial terms & promised_delivery_at remain frozen
    try {
      const joinRes = await api('/api/v1/reservations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: {
          pool_id: draftPoolId,
          quantity: 10
        }
      });
      assert.strictEqual(joinRes.status, 201, JSON.stringify(joinRes.body));

      const afterJoin = await api(`/api/v1/pools/${draftPoolId}`);
      assert.strictEqual(afterJoin.status, 200);
      const pSnap = afterJoin.body.data.pool;
      assert.strictEqual(Number(pSnap.current_qty), 10);
      assert.strictEqual(Number(pSnap.target_qty), 50);
      assert.strictEqual(new Date(pSnap.promised_delivery_at).toISOString(), new Date(lockedPromisedDelivery).toISOString());

      // Attempting to edit pool after reservation is also rejected
      const editAfterRes = await api(`/api/v1/pools/${draftPoolId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${supAToken}` },
        body: { target_qty: 100 }
      });
      assert.strictEqual(editAfterRes.status, 422);

      // Clean up reservation before teardown
      await db.query('DELETE FROM reservation_business_events WHERE pool_id = ?', [draftPoolId]);
      await db.query('DELETE FROM reservations WHERE pool_id = ?', [draftPoolId]);

      pass('19. Buyer reservation updates current_qty dynamically while keeping published pool terms and promised_delivery_at immutable');
    } catch (e) { fail('19. Buyer reservation on immutable pool', e); }

    // 20. Historical Catalog Preservation Check (11 products & 16 specifications untouched)
    try {
      const [[afterProdCount]] = await db.query('SELECT COUNT(*) AS cnt FROM products WHERE id <= 11');
      const [[afterSpecCount]] = await db.query('SELECT COUNT(*) AS cnt FROM product_specifications WHERE id <= 16');
      assert.strictEqual(afterProdCount.cnt, beforeProdCount.cnt);
      assert.strictEqual(afterSpecCount.cnt, beforeSpecCount.cnt);
      pass('20. All 11 historical products and 16 historical specifications preserved with zero destructive changes');
    } catch (e) { fail('20. Historical catalog preservation', e); }

  } finally {
    await new Promise((resolve) => server.close(resolve));

    // Clean up test fixtures in reverse dependency order
    try {
      if (createdPoolIds.length > 0) {
        await db.query('DELETE FROM supplier_inventory_allocations WHERE reference_id IN (?) AND allocation_type = "REGULAR_POOL"', [createdPoolIds]);
        await db.query('DELETE FROM pool_delivery_clusters WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM pool_price_tiers WHERE pool_id IN (?)', [createdPoolIds]);
        await db.query('DELETE FROM pools WHERE id IN (?)', [createdPoolIds]);
      }
      if (createdListingIds.length > 0) {
        await db.query('DELETE FROM supplier_listings WHERE id IN (?)', [createdListingIds]);
      }
      if (createdSupplierSkuIds.length > 0) {
        await db.query('UPDATE product_specifications SET supplier_sku_id = NULL, supplier_product_id = NULL WHERE supplier_sku_id IN (?)', [createdSupplierSkuIds]);
        await db.query('DELETE FROM supplier_skus WHERE id IN (?)', [createdSupplierSkuIds]);
      }
      if (createdSpecIds.length > 0) {
        await db.query('DELETE FROM product_specifications WHERE id IN (?)', [createdSpecIds]);
      }
      if (createdSupplierProductIds.length > 0) {
        await db.query('DELETE FROM supplier_products WHERE id IN (?)', [createdSupplierProductIds]);
      }
      if (createdRequestIds.length > 0) {
        await db.query('DELETE FROM catalog_moderation_logs WHERE request_id IN (?)', [createdRequestIds]);
        await db.query('DELETE FROM catalog_requests WHERE id IN (?)', [createdRequestIds]);
      }
      if (createdFamilyIds.length > 0) {
        await db.query('DELETE FROM products WHERE id IN (?) AND id > 11', [createdFamilyIds]);
        await db.query('DELETE FROM catalog_product_families WHERE id IN (?)', [createdFamilyIds]);
      }
      if (createdUserIds.length > 0) {
        await db.query('DELETE FROM catalog_moderation_logs WHERE actor_id IN (?)', [createdUserIds]);
        await db.query('DELETE FROM buyer_delivery_addresses WHERE user_id IN (?)', [createdUserIds]);
        await db.query('DELETE FROM supplier_profiles WHERE supplier_id IN (?)', [createdUserIds]);
        await db.query('DELETE FROM users WHERE id IN (?)', [createdUserIds]);
      }
    } catch (cleanupErr) {
      console.error('Cleanup error:', cleanupErr.message);
    }
  }

  console.log('\n================================================================================');
  console.log(`PACKAGE E2 PRODUCT OWNERSHIP & IMMUTABLE POOLS GATE: ${passed}/${passed + failed} PASSED`);
  console.log(`FINAL VERDICT: ${failed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('================================================================================\n');

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runGate();
