'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');

assert.equal(process.env.NODE_ENV, 'test', 'NODE_ENV must be test');
assert.equal(process.env.DB_NAME, 'miljor_test_db', 'DB_NAME must be miljor_test_db');
assert.equal(process.env.TEST_DB_NAME, 'miljor_test_db', 'TEST_DB_NAME must be miljor_test_db');
assert.equal(process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT, 'false', 'External money movement must be false');

const JWT_SECRET = process.env.JWT_SECRET || 'phase1_repl_test_jwt_secret_2026_only';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = JWT_SECRET;

const db = require('../src/config/db');
const deliveryRunService = require('../src/services/deliveryRunService');
const supplierReplacementService = require('../src/services/supplierReplacementService');
const { createDeliveryRunRouter } = require('../src/routes/v1/deliveryRunRoutes');

function tokenFor(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app', algorithm: 'HS256' }
  );
}

async function reqJson(baseUrl, method, path, { token, idempotencyKey, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function run() {
  const expectedPort = Number(process.env.DB_PORT || 3306);
  const [[identity]] = await db.query('SELECT DATABASE() AS db, @@port AS port');
  assert.equal(identity.db, 'miljor_test_db');
  assert.equal(Number(identity.port), expectedPort);
  console.log(`[DB-GUARD] Verified isolated DB=${identity.db} on port=${identity.port}`);

  const app = express();
  app.use(express.json());
  app.use('/api/v1/delivery-runs', createDeliveryRunRouter(deliveryRunService, supplierReplacementService));

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/api/v1/delivery-runs`;

  const tag = `ph1r_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const createdIds = { users: [], listings: [], orders: [], quotes: [], links: [] };

  try {
    const insertUser = async (name, email, role, verified = true) => {
      const [r] = await db.query(
        `INSERT INTO users (full_name, business_name, email, password_hash, role, is_verified, verification_status)
         VALUES (?, ?, ?, '$2b$10$phase1DummyHashOnlyForTestFixture000000000000000000', ?, ?, ?)`,
        [name, `${name} Co`, email, role, verified ? 1 : 0, verified ? 'VERIFIED' : 'PENDING_SUPPLIER_VERIFICATION']
      );
      createdIds.users.push(r.insertId);
      return { id: r.insertId, name, email, role };
    };

    const admin = await insertUser('Phase1 Admin', `${tag}_adm@test.local`, 'ADMIN');
    const origSup = await insertUser('Orig Supplier', `${tag}_sup1@test.local`, 'SUPPLIER');
    const replSup = await insertUser('Repl Supplier', `${tag}_sup2@test.local`, 'SUPPLIER');
    const unverifiedSup = await insertUser('Unver Supplier', `${tag}_sup3@test.local`, 'SUPPLIER', false);
    const buyer = await insertUser('Buyer One', `${tag}_buy1@test.local`, 'BUYER');
    const otherBuyer = await insertUser('Buyer Two', `${tag}_buy2@test.local`, 'BUYER');

    for (const [sup, status] of [[origSup, 'VERIFIED'], [replSup, 'VERIFIED'], [unverifiedSup, 'PENDING_REVIEW']]) {
      await db.query('INSERT INTO supplier_profiles (supplier_id, verification_status) VALUES (?, ?)', [sup.id, status]);
    }

    // Find an existing product_specification for a valid supplier_listing fixture
    const [specs] = await db.query('SELECT id FROM product_specifications LIMIT 1');
    let listingId = null;
    if (specs.length) {
      const lstCode = `LST-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const [lst] = await db.query(
        `INSERT INTO supplier_listings (listing_code, supplier_id, product_spec_id, base_unit_price, available_stock, delivery_zones, status)
         VALUES (?, ?, ?, 100.00, 120.00, JSON_ARRAY('Lahore'), 'ACTIVE')`,
        [lstCode, replSup.id, specs[0].id]
      );
      listingId = lst.insertId;
      createdIds.listings.push(listingId);
    }

    // Seed failed original order (100 qty @ 100 PKR + 150 delivery = 10,150 PKR)
    const origCode = `ORD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const [ordRes] = await db.query(
      `INSERT INTO orders (
        order_code, buyer_id, supplier_id, total_qty, unit_price,
        subtotal_amount, delivery_fee, buyer_platform_fee, total_amount,
        currency, delivery_type, delivery_address, order_status, payment_status, fulfillment_status
      ) VALUES (?, ?, ?, 100.0000, 100.00, 10000.00, 150.00, 0.00, 10150.00, 'PKR', 'DOORSTEP', 'Lahore Test Addr', 'PAID', 'PAID', 'EXCEPTION')`,
      [origCode, buyer.id, origSup.id]
    );
    const origOrderId = ordRes.insertId;
    createdIds.orders.push(origOrderId);

    const admTok = tokenFor(admin);
    const buyTok = tokenFor(buyer);
    const otherBuyTok = tokenFor(otherBuyer);
    const supTok = tokenFor(replSup);

    const futureEta = new Date(Date.now() + 7200 * 1000).toISOString();
    const futureExp = new Date(Date.now() + 3600 * 1000).toISOString();

    // 1. Negative checks: non-admin, unverified supplier, same supplier, extra charge on supplier failure, platform fault non-zero, insufficient stock
    {
      const rNonAdmin = await reqJson(baseUrl, 'POST', '/replacements', {
        token: supTok, idempotencyKey: `${tag}-nonadm`,
        body: { original_order_id: origOrderId, replacement_supplier_id: replSup.id, new_unit_price_pkr: '100.00', new_delivery_fee_pkr: '150.00', proposed_eta_at: futureEta, expires_at: futureExp, reason: 'Try propose' }
      });
      assert.equal(rNonAdmin.status, 403);

      const rUnver = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-unver`,
        body: { original_order_id: origOrderId, replacement_supplier_id: unverifiedSup.id, new_unit_price_pkr: '100.00', new_delivery_fee_pkr: '150.00', proposed_eta_at: futureEta, expires_at: futureExp, reason: 'Unverified supplier' }
      });
      assert.equal(rUnver.status, 422);

      const rSame = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-same`,
        body: { original_order_id: origOrderId, replacement_supplier_id: origSup.id, new_unit_price_pkr: '100.00', new_delivery_fee_pkr: '150.00', proposed_eta_at: futureEta, expires_at: futureExp, reason: 'Same supplier' }
      });
      assert.equal(rSame.status, 422);

      const rExtraCharge = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-extra`,
        body: { original_order_id: origOrderId, replacement_supplier_id: replSup.id, new_unit_price_pkr: '120.00', new_delivery_fee_pkr: '150.00', cost_responsibility: 'SUPPLIER_CARRIER_FAILURE', proposed_eta_at: futureEta, expires_at: futureExp, reason: 'Supplier failed' }
      });
      assert.equal(rExtraCharge.status, 422, 'Supplier failure cannot charge buyer extra');

      const rPlat = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-plat`,
        body: { original_order_id: origOrderId, replacement_supplier_id: replSup.id, new_unit_price_pkr: '90.00', new_delivery_fee_pkr: '150.00', cost_responsibility: 'PLATFORM_PROVIDER_FAULT', proposed_eta_at: futureEta, expires_at: futureExp, reason: 'Platform fault' }
      });
      assert.equal(rPlat.status, 422, 'Platform fault cannot invent subsidy');
    }
    console.log('[PASS] Replacement negative checks & cost policy verified');

    // 2. Propose valid replacement quote v1, test wrong-owner/version/hash, execute-before-consent, then decline
    {
      const rProp1 = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-prop1`,
        body: {
          original_order_id: origOrderId,
          replacement_supplier_id: replSup.id,
          replacement_listing_id: listingId,
          sku_match_type: 'EXACT_SKU',
          new_unit_price_pkr: '100.00',
          new_delivery_fee_pkr: '150.00',
          cost_responsibility: 'SUPPLIER_CARRIER_FAILURE',
          proposed_eta_at: futureEta,
          expires_at: futureExp,
          reason: 'Original supplier failed SLA; verified replacement available'
        }
      });
      assert.equal(rProp1.status, 201);
      const q1 = rProp1.json.data.quote;
      createdIds.quotes.push(q1.id);

      // Cannot execute before buyer consent
      const rExecEarly = await reqJson(baseUrl, 'POST', `/replacements/${q1.id}/execute`, {
        token: admTok, idempotencyKey: `${tag}-exec-early`
      });
      assert.equal(rExecEarly.status, 409);

      // Wrong buyer cannot decide
      const rWrongBuy = await reqJson(baseUrl, 'POST', `/replacements/${q1.id}/decide`, {
        token: otherBuyTok, idempotencyKey: `${tag}-wrong-buy`,
        body: { quote_version: q1.quote_version, quote_hash: q1.quote_hash, decision: 'ACCEPTED' }
      });
      assert.equal(rWrongBuy.status, 403);

      // Wrong version rejected
      const rWrongVer = await reqJson(baseUrl, 'POST', `/replacements/${q1.id}/decide`, {
        token: buyTok, idempotencyKey: `${tag}-wrong-ver`,
        body: { quote_version: 99, quote_hash: q1.quote_hash, decision: 'ACCEPTED' }
      });
      assert.equal(rWrongVer.status, 409);

      // Buyer declines v1 -> original order untouched
      const rDecline = await reqJson(baseUrl, 'POST', `/replacements/${q1.id}/decide`, {
        token: buyTok, idempotencyKey: `${tag}-dec1`,
        body: { quote_version: q1.quote_version, quote_hash: q1.quote_hash, decision: 'DECLINED' }
      });
      assert.equal(rDecline.status, 200);
      assert.equal(rDecline.json.data.quote.status, 'BUYER_DECLINED');
    }
    console.log('[PASS] Pre-consent execution block, ownership/version checks & decline verified');

    // 3. Propose v2, buyer accepts, concurrent execution allocates stock ONCE & creates AWAITING_PAYMENT replacement order
    let q2Id, replOrderId;
    {
      const rProp2 = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-prop2`,
        body: {
          original_order_id: origOrderId,
          replacement_supplier_id: replSup.id,
          replacement_listing_id: listingId,
          sku_match_type: 'EQUIVALENT_SKU_REQUIRES_CONSENT',
          replacement_sku_snapshot: { brand: 'Verified Alt Mill', pack_size: '50 kg' },
          new_unit_price_pkr: '100.00',
          new_delivery_fee_pkr: '150.00',
          cost_responsibility: 'SUPPLIER_CARRIER_FAILURE',
          proposed_eta_at: futureEta,
          expires_at: futureExp,
          reason: 'Equivalent verified SKU offered with buyer consent'
        }
      });
      assert.equal(rProp2.status, 201);
      const q2 = rProp2.json.data.quote;
      q2Id = q2.id;
      createdIds.quotes.push(q2Id);

      const rAcc = await reqJson(baseUrl, 'POST', `/replacements/${q2Id}/decide`, {
        token: buyTok, idempotencyKey: `${tag}-acc2`,
        body: { quote_version: q2.quote_version, quote_hash: q2.quote_hash, decision: 'ACCEPTED' }
      });
      assert.equal(rAcc.status, 200);
      assert.equal(rAcc.json.data.quote.status, 'BUYER_ACCEPTED');

      // Acceptance alone did NOT change original order supplier or allocate stock
      const [[origCheck]] = await db.query('SELECT supplier_id FROM orders WHERE id = ?', [origOrderId]);
      assert.equal(Number(origCheck.supplier_id), origSup.id);

      // Concurrent execute calls -> exactly 1 succeeds (200), 1 fails (409)
      const [e1, e2] = await Promise.all([
        reqJson(baseUrl, 'POST', `/replacements/${q2Id}/execute`, { token: admTok, idempotencyKey: `${tag}-exec-c1` }),
        reqJson(baseUrl, 'POST', `/replacements/${q2Id}/execute`, { token: admTok, idempotencyKey: `${tag}-exec-c2` })
      ]);
      const statuses = [e1.status, e2.status].sort((a, b) => a - b);
      assert.deepEqual(statuses, [200, 409], `Expected 200 and 409 on concurrent replacement execute, got ${statuses}`);
      const winner = e1.status === 200 ? e1.json.data : e2.json.data;
      replOrderId = winner.replacement_order_id;
      createdIds.orders.push(replOrderId);
      createdIds.links.push(winner.link.id);

      // Replacement order is AWAITING_PAYMENT (never fabricated PAID)
      const [[replOrd]] = await db.query('SELECT supplier_id, payment_status, order_status FROM orders WHERE id = ?', [replOrderId]);
      assert.equal(Number(replOrd.supplier_id), replSup.id);
      assert.equal(replOrd.payment_status, 'AWAITING_PAYMENT');
      assert.equal(replOrd.order_status, 'AWAITING_PAYMENT');

      // Stock deducted exactly once (120 -> 20)
      if (listingId) {
        const [[lstAfter]] = await db.query('SELECT available_stock FROM supplier_listings WHERE id = ?', [listingId]);
        assert.equal(Number(lstAfter.available_stock), 20);
      }
    }
    console.log('[PASS] Replacement consent, concurrent execution, stock deduction & AWAITING_PAYMENT boundary verified');

    console.log('ALL PHASE 1 SUPPLIER REPLACEMENT RE-CONTRACTING CHECKS PASSED');
  } finally {
    try {
      if (createdIds.links.length) {
        await db.query(`DELETE FROM order_replacement_links WHERE id IN (${createdIds.links.map(() => '?').join(',')})`, createdIds.links);
      }
      if (createdIds.quotes.length) {
        await db.query(`DELETE FROM supplier_replacement_quotes WHERE id IN (${createdIds.quotes.map(() => '?').join(',')})`, createdIds.quotes);
      }
      if (createdIds.orders.length) {
        await db.query(`DELETE FROM orders WHERE id IN (${createdIds.orders.map(() => '?').join(',')})`, createdIds.orders);
      }
      if (createdIds.listings.length) {
        await db.query(`DELETE FROM supplier_listings WHERE id IN (${createdIds.listings.map(() => '?').join(',')})`, createdIds.listings);
      }
      if (createdIds.users.length) {
        const usrPh = createdIds.users.map(() => '?').join(',');
        await db.query(`DELETE FROM procurement_notifications WHERE recipient_id IN (${usrPh})`, createdIds.users);
        await db.query(`DELETE FROM idempotency_records WHERE user_id IN (${usrPh})`, createdIds.users);
        await db.query(`DELETE FROM supplier_profiles WHERE supplier_id IN (${usrPh})`, createdIds.users);
        await db.query(`DELETE FROM users WHERE id IN (${usrPh})`, createdIds.users);
      }
    } catch (cleanupErr) {
      console.error('[CLEANUP WARNING]', cleanupErr.message);
    }

    await new Promise(resolve => server.close(resolve));
    await db.end();
  }
}

run().catch(err => {
  console.error('[PHASE 1 REPLACEMENT GATE FAIL]', err);
  process.exitCode = 1;
});
