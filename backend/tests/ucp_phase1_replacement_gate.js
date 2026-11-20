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
  const createdIds = { users: [], listings: [], orders: [], runs: [], stops: [], quotes: [], links: [] };

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

    const [specs] = await db.query('SELECT id FROM product_specifications WHERE is_active = 1 AND approval_status = ? LIMIT 1', ['APPROVED']);
    assert.ok(specs.length > 0, 'Active approved product_specification required');
    const lstCode = `LST-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const [lst] = await db.query(
      `INSERT INTO supplier_listings (listing_code, supplier_id, product_spec_id, base_unit_price, available_stock, delivery_zones, status)
       VALUES (?, ?, ?, 100.00, 120.00, JSON_ARRAY('Lahore'), 'ACTIVE')`,
      [lstCode, replSup.id, specs[0].id]
    );
    const listingId = lst.insertId;
    createdIds.listings.push(listingId);

    const [clusters] = await db.query('SELECT id FROM geographic_clusters WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
    const clusterId = clusters[0].id;

    // Seed original order (100 ordered, 80 accepted, 20 disputed)
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

    // Seed a PARTIAL_CONFIRMED stop (100 ordered / 80 accepted / 20 disputed)
    const [runRes] = await db.query(
      `INSERT INTO delivery_runs (run_code, supplier_id, cluster_id, mode, handling_class, delivery_day, delivery_window, cutoff_at, max_stops, planned_stops, status, idempotency_key, request_hash, snapshot_json)
       VALUES (?, ?, ?, 'STANDARD_CLUSTERED', 'AMBIENT', '2026-11-18', '10:00-14:00', UTC_TIMESTAMP(), 10, 1, 'PARTIAL', ?, ?, '{}')`,
      [`RUN-${tag}`, origSup.id, clusterId, `${tag}-run`, crypto.createHash('sha256').update(tag).digest('hex')]
    );
    createdIds.runs.push(runRes.insertId);
    const [stopRes] = await db.query(
      `INSERT INTO delivery_run_stops (run_id, order_id, buyer_id, supplier_id, cluster_id, mode, stop_sequence, status, locked_delivery_fee_pkr, ordered_qty, accepted_qty, missing_qty, rejected_qty, disputed_qty, snapshot_json)
       VALUES (?, ?, ?, ?, ?, 'STANDARD_CLUSTERED', 1, 'PARTIAL_CONFIRMED', 150.00, 100.0000, 80.0000, 20.0000, 0.0000, 20.0000, '{}')`,
      [runRes.insertId, origOrderId, buyer.id, origSup.id, clusterId]
    );
    createdIds.stops.push(stopRes.insertId);

    const admTok = tokenFor(admin);
    const buyTok = tokenFor(buyer);
    const otherBuyTok = tokenFor(otherBuyer);
    const supTok = tokenFor(replSup);
    const origSupTok = tokenFor(origSup);

    const futureEta = new Date(Date.now() + 7200 * 1000).toISOString();
    const futureExp = new Date(Date.now() + 3600 * 1000).toISOString();

    // 1. Negative checks: missing listing, non-admin, unverified supplier, same supplier, 100 units on 20-unit partial obligation, cost policy
    {
      const rNoListing = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-nolist`,
        body: { original_order_id: origOrderId, replacement_supplier_id: replSup.id, new_unit_price_pkr: '100.00', new_delivery_fee_pkr: '0.00', proposed_eta_at: futureEta, expires_at: futureExp, reason: 'Missing listing' }
      });
      assert.equal(rNoListing.status, 422, 'Missing replacement_listing_id must be rejected');

      const rExcessQty = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-excess100`,
        body: { original_order_id: origOrderId, replacement_supplier_id: replSup.id, replacement_listing_id: listingId, quantity: '100.0000', new_unit_price_pkr: '100.00', new_delivery_fee_pkr: '0.00', proposed_eta_at: futureEta, expires_at: futureExp, reason: 'Try replacing full 100 on 80/20 partial' }
      });
      assert.equal(rExcessQty.status, 422, 'Cannot replace 100 units when only 20 units are disputed');

      const rNonAdmin = await reqJson(baseUrl, 'POST', '/replacements', {
        token: supTok, idempotencyKey: `${tag}-nonadm`,
        body: { original_order_id: origOrderId, replacement_supplier_id: replSup.id, replacement_listing_id: listingId, new_unit_price_pkr: '100.00', new_delivery_fee_pkr: '0.00', proposed_eta_at: futureEta, expires_at: futureExp, reason: 'Try propose' }
      });
      assert.equal(rNonAdmin.status, 403);

      const rUnver = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-unver`,
        body: { original_order_id: origOrderId, replacement_supplier_id: unverifiedSup.id, replacement_listing_id: listingId, new_unit_price_pkr: '100.00', new_delivery_fee_pkr: '0.00', proposed_eta_at: futureEta, expires_at: futureExp, reason: 'Unverified supplier' }
      });
      assert.equal(rUnver.status, 422);

      const rSame = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-same`,
        body: { original_order_id: origOrderId, replacement_supplier_id: origSup.id, replacement_listing_id: listingId, new_unit_price_pkr: '100.00', new_delivery_fee_pkr: '0.00', proposed_eta_at: futureEta, expires_at: futureExp, reason: 'Same supplier' }
      });
      assert.equal(rSame.status, 422);

      const rExtraCharge = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-extra`,
        body: { original_order_id: origOrderId, replacement_supplier_id: replSup.id, replacement_listing_id: listingId, new_unit_price_pkr: '120.00', new_delivery_fee_pkr: '0.00', cost_responsibility: 'SUPPLIER_CARRIER_FAILURE', proposed_eta_at: futureEta, expires_at: futureExp, reason: 'Supplier failed' }
      });
      assert.equal(rExtraCharge.status, 422, 'Supplier failure cannot charge buyer extra');

      const rPlat = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-plat`,
        body: { original_order_id: origOrderId, replacement_supplier_id: replSup.id, replacement_listing_id: listingId, new_unit_price_pkr: '90.00', new_delivery_fee_pkr: '0.00', cost_responsibility: 'PLATFORM_PROVIDER_FAULT', proposed_eta_at: futureEta, expires_at: futureExp, reason: 'Platform fault' }
      });
      assert.equal(rPlat.status, 422, 'Platform fault cannot invent subsidy');
    }
    console.log('[PASS] Mandatory listing, 20-unit partial obligation bound & cost policy verified');

    // 2. Propose v1 for 20 units: buyer cannot accept before supplier acceptance; wrong supplier rejected; supplier accepts; buyer declines
    {
      const rProp1 = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-prop1`,
        body: {
          original_order_id: origOrderId,
          replacement_supplier_id: replSup.id,
          replacement_listing_id: listingId,
          sku_match_type: 'EXACT_SKU',
          new_unit_price_pkr: '100.00',
          new_delivery_fee_pkr: '0.00',
          cost_responsibility: 'SUPPLIER_CARRIER_FAILURE',
          proposed_eta_at: futureEta,
          expires_at: futureExp,
          reason: 'Replace 20 disputed units from 100/80/20 stop'
        }
      });
      assert.equal(rProp1.status, 201);
      const q1 = rProp1.json.data.quote;
      createdIds.quotes.push(q1.id);
      assert.equal(Number(q1.quantity), 20);
      assert.equal(q1.supplier_offer_status, 'PENDING_SUPPLIER_ACCEPTANCE');

      // Buyer cannot accept before replacement supplier accepts
      const rBuyEarly = await reqJson(baseUrl, 'POST', `/replacements/${q1.id}/decide`, {
        token: buyTok, idempotencyKey: `${tag}-buy-early`,
        body: { quote_version: q1.quote_version, quote_hash: q1.quote_hash, decision: 'ACCEPTED' }
      });
      assert.equal(rBuyEarly.status, 409, 'Buyer consent blocked until replacement supplier accepts');

      // Wrong supplier cannot accept
      const rWrongSup = await reqJson(baseUrl, 'POST', `/replacements/${q1.id}/supplier-accept`, {
        token: origSupTok, idempotencyKey: `${tag}-wrong-sup`,
        body: { quote_version: q1.quote_version, quote_hash: q1.quote_hash, decision: 'ACCEPTED' }
      });
      assert.equal(rWrongSup.status, 403);

      // Assigned replacement supplier accepts
      const rSupAcc = await reqJson(baseUrl, 'POST', `/replacements/${q1.id}/supplier-accept`, {
        token: supTok, idempotencyKey: `${tag}-sup-acc1`,
        body: { quote_version: q1.quote_version, quote_hash: q1.quote_hash, decision: 'ACCEPTED' }
      });
      assert.equal(rSupAcc.status, 200);
      assert.equal(rSupAcc.json.data.quote.supplier_offer_status, 'SUPPLIER_ACCEPTED');

      // Wrong buyer & wrong version rejected
      const rWrongBuy = await reqJson(baseUrl, 'POST', `/replacements/${q1.id}/decide`, {
        token: otherBuyTok, idempotencyKey: `${tag}-wrong-buy`,
        body: { quote_version: q1.quote_version, quote_hash: q1.quote_hash, decision: 'ACCEPTED' }
      });
      assert.equal(rWrongBuy.status, 403);

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
    console.log('[PASS] Supplier acceptance gate, ownership/version checks & decline verified');

    // 3. Propose v2 (20 units), supplier accepts, buyer accepts, concurrent execution allocates 20 ONCE & prevents duplicate replacement
    let q2Id, replOrderId;
    {
      const rProp2 = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-prop2`,
        body: {
          original_order_id: origOrderId,
          replacement_supplier_id: replSup.id,
          replacement_listing_id: listingId,
          quantity: '20.0000',
          sku_match_type: 'EQUIVALENT_SKU_REQUIRES_CONSENT',
          replacement_sku_snapshot: { brand: 'Verified Alt Mill', pack_size: '50 kg' },
          new_unit_price_pkr: '100.00',
          new_delivery_fee_pkr: '0.00',
          cost_responsibility: 'SUPPLIER_CARRIER_FAILURE',
          proposed_eta_at: futureEta,
          expires_at: futureExp,
          reason: 'Equivalent verified SKU for 20 disputed units'
        }
      });
      assert.equal(rProp2.status, 201);
      const q2 = rProp2.json.data.quote;
      q2Id = q2.id;
      createdIds.quotes.push(q2Id);

      const rSupAcc2 = await reqJson(baseUrl, 'POST', `/replacements/${q2Id}/supplier-accept`, {
        token: supTok, idempotencyKey: `${tag}-sup-acc2`,
        body: { quote_version: q2.quote_version, quote_hash: q2.quote_hash, decision: 'ACCEPTED' }
      });
      assert.equal(rSupAcc2.status, 200);

      const rAcc = await reqJson(baseUrl, 'POST', `/replacements/${q2Id}/decide`, {
        token: buyTok, idempotencyKey: `${tag}-acc2`,
        body: { quote_version: q2.quote_version, quote_hash: q2.quote_hash, decision: 'ACCEPTED' }
      });
      assert.equal(rAcc.status, 200);
      assert.equal(rAcc.json.data.quote.status, 'BUYER_ACCEPTED');

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

      // Replacement order is AWAITING_PAYMENT for 20 units (original 100-unit order preserved)
      const [[replOrd]] = await db.query('SELECT supplier_id, total_qty, total_amount, payment_status, order_status FROM orders WHERE id = ?', [replOrderId]);
      assert.equal(Number(replOrd.supplier_id), replSup.id);
      assert.equal(Number(replOrd.total_qty), 20);
      assert.equal(Number(replOrd.total_amount), 2000);
      assert.equal(replOrd.payment_status, 'AWAITING_PAYMENT');
      assert.equal(replOrd.order_status, 'AWAITING_PAYMENT');

      const [[origOrd]] = await db.query('SELECT supplier_id, total_qty, total_amount FROM orders WHERE id = ?', [origOrderId]);
      assert.equal(Number(origOrd.supplier_id), origSup.id);
      assert.equal(Number(origOrd.total_qty), 100);
      assert.equal(Number(origOrd.total_amount), 10150);

      // Stock deducted exactly once (120 -> 100)
      const [[lstAfter]] = await db.query('SELECT available_stock FROM supplier_listings WHERE id = ?', [listingId]);
      assert.equal(Number(lstAfter.available_stock), 100);

      // Duplicate replacement proposal for the already-replaced 20 units MUST fail
      const rDupProp = await reqJson(baseUrl, 'POST', '/replacements', {
        token: admTok, idempotencyKey: `${tag}-dup-prop`,
        body: {
          original_order_id: origOrderId,
          replacement_supplier_id: replSup.id,
          replacement_listing_id: listingId,
          quantity: '20.0000',
          sku_match_type: 'EXACT_SKU',
          new_unit_price_pkr: '100.00',
          new_delivery_fee_pkr: '0.00',
          cost_responsibility: 'SUPPLIER_CARRIER_FAILURE',
          proposed_eta_at: futureEta,
          expires_at: futureExp,
          reason: 'Should fail: 20 units already replaced'
        }
      });
      assert.equal(rDupProp.status, 422, 'Cannot create duplicate replacement once 20-unit obligation is covered');
    }
    console.log('[PASS] Concurrent replacement execution, 20-unit obligation lock, stock deduction & original order preservation verified');

    // 4. Transaction rollback emits zero outbox notifications
    {
      const [[beforeCnt]] = await db.query('SELECT COUNT(*) AS cnt FROM procurement_notifications WHERE recipient_id = ?', [buyer.id]);
      const conn = await db.getConnection();
      await conn.beginTransaction();
      await supplierReplacementService.notifications.recordInAppOnConnection(conn, {
        type: 'UCP.ORDER_CONFIRMED',
        aggregateId: `replacement-rollback-${origOrderId}`,
        aggregateVersion: 99,
        transitionId: `${tag}-rb`,
        recipients: [{ userId: buyer.id, role: 'BUYER' }],
        title: 'Rollback test',
        message: 'Should never commit',
        payload: { order_id: origOrderId, status: 'AWAITING_PAYMENT', notification_path: '/orders' },
        actorId: admin.id,
        actorRole: 'ADMIN',
        schemaVersion: 2
      });
      await conn.rollback();
      conn.release();
      const [[afterCnt]] = await db.query('SELECT COUNT(*) AS cnt FROM procurement_notifications WHERE recipient_id = ?', [buyer.id]);
      assert.equal(afterCnt.cnt, beforeCnt.cnt, 'Rolled-back replacement notification must emit zero rows');
    }
    console.log('[PASS] Replacement notification rollback emits zero rows');

    console.log('ALL PHASE 1 SUPPLIER REPLACEMENT RE-CONTRACTING CHECKS PASSED');
  } finally {
    try {
      if (createdIds.links.length) {
        await db.query(`DELETE FROM order_replacement_links WHERE id IN (${createdIds.links.map(() => '?').join(',')})`, createdIds.links);
      }
      if (createdIds.quotes.length) {
        await db.query(`DELETE FROM supplier_replacement_quotes WHERE id IN (${createdIds.quotes.map(() => '?').join(',')})`, createdIds.quotes);
      }
      if (createdIds.stops.length) {
        await db.query(`DELETE FROM delivery_run_stops WHERE id IN (${createdIds.stops.map(() => '?').join(',')})`, createdIds.stops);
      }
      if (createdIds.runs.length) {
        await db.query(`DELETE FROM delivery_runs WHERE id IN (${createdIds.runs.map(() => '?').join(',')})`, createdIds.runs);
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
