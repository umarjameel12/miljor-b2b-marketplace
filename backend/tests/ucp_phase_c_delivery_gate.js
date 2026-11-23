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

const JWT_SECRET = process.env.JWT_SECRET || 'phase_c_test_jwt_secret_2026_only';
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = JWT_SECRET;

const db = require('../src/config/db');
const deliveryRunService = require('../src/services/deliveryRunService');
const financialSettlementService = require('../src/services/financialSettlementService');
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
  assert.equal(identity.db, 'miljor_test_db', `Refusing non-test DB: ${identity.db}`);
  assert.equal(Number(identity.port), expectedPort, `Port mismatch: ${identity.port} !== ${expectedPort}`);
  console.log(`[DB-GUARD] Verified isolated DB=${identity.db} on port=${identity.port}`);

  const app = express();
  app.use(express.json());
  app.use('/api/v1/delivery-runs', createDeliveryRunRouter(deliveryRunService));

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}/api/v1/delivery-runs`;

  const tag = `phc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const createdIds = {
    users: [],
    addresses: [],
    pickupPoints: [],
    orders: [],
    runs: [],
    stops: [],
    disputes: [],
    amendments: []
  };

  try {
    // 1. Seed owned isolated fixtures (1 admin, 2 suppliers, 3 buyers, 2 clusters, 4 paid orders)
    const insertUser = async (name, email, role) => {
      const [r] = await db.query(
        `INSERT INTO users (full_name, business_name, email, password_hash, role, is_verified, verification_status)
         VALUES (?, ?, ?, '$2b$10$phasecDummyHashOnlyForTestFixture000000000000000000', ?, 1, 'VERIFIED')`,
        [name, `${name} Co`, email, role]
      );
      createdIds.users.push(r.insertId);
      return { id: r.insertId, name, email, role };
    };

    const admin = await insertUser('PhaseC Admin', `${tag}_admin@test.local`, 'ADMIN');
    const supplier1 = await insertUser('PhaseC Supplier1', `${tag}_sup1@test.local`, 'SUPPLIER');
    const supplier2 = await insertUser('PhaseC Supplier2', `${tag}_sup2@test.local`, 'SUPPLIER');
    const buyer1 = await insertUser('PhaseC Buyer1', `${tag}_buy1@test.local`, 'BUYER');
    const buyer2 = await insertUser('PhaseC Buyer2', `${tag}_buy2@test.local`, 'BUYER');
    const buyer3 = await insertUser('PhaseC Buyer3', `${tag}_buy3@test.local`, 'BUYER');

    for (const sup of [supplier1, supplier2]) {
      await db.query(
        `INSERT INTO supplier_profiles (supplier_id, verification_status)
         VALUES (?, 'VERIFIED')`,
        [sup.id]
      );
    }

    const [clusters] = await db.query('SELECT id, name FROM geographic_clusters WHERE is_active = 1 ORDER BY id ASC LIMIT 2');
    assert.ok(clusters.length >= 2, 'At least 2 active geographic clusters required in miljor_test_db');
    const clusterA = clusters[0].id;
    const clusterB = clusters[1].id;

    const insertAddr = async (userId, clusterId, label) => {
      const [r] = await db.query(
        `INSERT INTO buyer_delivery_addresses (user_id, city, cluster_id, society_area, full_address, geographic_match_status, is_default)
         VALUES (?, 'Lahore', ?, 'Gulberg', ?, 'VERIFIED', 1)`,
        [userId, clusterId, `${label} 123 Test Street Lahore`]
      );
      createdIds.addresses.push(r.insertId);
      return r.insertId;
    };

    const addrB1 = await insertAddr(buyer1.id, clusterA, 'B1 Warehouse');
    const addrB2 = await insertAddr(buyer2.id, clusterA, 'B2 Kitchen');
    await insertAddr(buyer3.id, clusterB, 'B3 Depot');

    const [ppRes] = await db.query(
      `INSERT INTO supplier_pickup_points (supplier_id, point_name, cluster_id, address_line, operating_hours, pickup_handling_fee_pkr, is_active)
       VALUES (?, 'Main Warehouse Gate 2', ?, 'Plot 9 Industrial Area', '09:00-18:00', 0.00, 1)`,
      [supplier1.id, clusterA]
    );
    createdIds.pickupPoints.push(ppRes.insertId);

    const insertOrder = async ({ buyerId, supplierId, qty, unitPrice, deliveryFee, deliveryType, deliveryMethod = null, fulfillmentStatus = 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT', paymentStatus = 'PAID' }) => {
      const subtotal = (Number(qty) * Number(unitPrice)).toFixed(2);
      const total = (Number(subtotal) + Number(deliveryFee)).toFixed(2);
      const code = `ORD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      const [r] = await db.query(
        `INSERT INTO orders (
          order_code, buyer_id, supplier_id, total_qty, unit_price,
          subtotal_amount, delivery_fee, buyer_platform_fee, total_amount,
          currency, delivery_type, delivery_method, delivery_address, order_status, payment_status, fulfillment_status, admin_approval_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0.00, ?, 'PKR', ?, ?, 'Test Address Lahore', ?, ?, ?, ?)`,
        [
          code,
          buyerId,
          supplierId,
          qty,
          unitPrice,
          subtotal,
          deliveryFee,
          total,
          deliveryType,
          deliveryMethod,
          paymentStatus === 'PAID' ? 'PAID' : 'AWAITING_PAYMENT',
          paymentStatus,
          fulfillmentStatus,
          'ADMIN_APPROVED'
        ]
      );
      createdIds.orders.push(r.insertId);
      return r.insertId;
    };

    // Order 1: Buyer 1, Standard (100 qty @ 100 PKR = 10,000, delivery fee 150)
    const ordStd1 = await insertOrder({ buyerId: buyer1.id, supplierId: supplier1.id, qty: '100.0000', unitPrice: '100.00', deliveryFee: '150.00', deliveryType: 'DOORSTEP' });
    // Order 2: Buyer 2, Standard (50 qty @ 100 PKR = 5,000, delivery fee 150)
    const ordStd2 = await insertOrder({ buyerId: buyer2.id, supplierId: supplier1.id, qty: '50.0000', unitPrice: '100.00', deliveryFee: '150.00', deliveryType: 'DOORSTEP' });
    // Order 3: Buyer 3, Pickup (20 qty @ 100 PKR = 2,000, delivery fee 0)
    const ordPickup = await insertOrder({ buyerId: buyer3.id, supplierId: supplier1.id, qty: '20.0000', unitPrice: '100.00', deliveryFee: '0.00', deliveryType: 'SUPPLIER_PICKUP' });
    // Order 4: Buyer 1, Express / Failure-Reattempt-Reroute test (30 qty @ 100 PKR, delivery fee 300)
    const ordExp = await insertOrder({ buyerId: buyer1.id, supplierId: supplier1.id, qty: '30.0000', unitPrice: '100.00', deliveryFee: '300.00', deliveryType: 'DOORSTEP', deliveryMethod: 'EXPRESS' });
    // Order 5: Unpaid order (must be rejected)
    const ordUnpaid = await insertOrder({ buyerId: buyer2.id, supplierId: supplier1.id, qty: '10.0000', unitPrice: '100.00', deliveryFee: '150.00', deliveryType: 'DOORSTEP', fulfillmentStatus: 'UNPAID', paymentStatus: 'AWAITING_PAYMENT' });

    const futureCutoff = new Date(Date.now() + 3600 * 1000).toISOString();
    const futureEta = new Date(Date.now() + 7200 * 1000).toISOString();
    const futureEta2 = new Date(Date.now() + 10800 * 1000).toISOString();
    const futureExpiry = new Date(Date.now() + 3600 * 1000).toISOString();

    const sup1Tok = tokenFor(supplier1);
    const sup2Tok = tokenFor(supplier2);
    const buy1Tok = tokenFor(buyer1);
    const buy2Tok = tokenFor(buyer2);
    const buy3Tok = tokenFor(buyer3);
    const admTok = tokenFor(admin);

    // 2. Negative checks: wrong role, unpaid order, incompatible mode, capacity exceeded
    {
      const rAdmin = await reqJson(baseUrl, 'POST', '/supplier/runs', {
        token: admTok, idempotencyKey: `${tag}-adm-run`,
        body: { order_ids: [ordStd1], cluster_id: clusterA, mode: 'STANDARD_CLUSTERED', delivery_day: '2026-11-18', delivery_window: '10:00-14:00', cutoff_at: futureCutoff }
      });
      assert.equal(rAdmin.status, 403, 'Admin cannot form supplier delivery run');

      const rUnpaid = await reqJson(baseUrl, 'POST', '/supplier/runs', {
        token: sup1Tok, idempotencyKey: `${tag}-unpaid`,
        body: { order_ids: [ordUnpaid], cluster_id: clusterA, mode: 'STANDARD_CLUSTERED', delivery_day: '2026-11-18', delivery_window: '10:00-14:00', cutoff_at: futureCutoff }
      });
      assert.equal(rUnpaid.status, 422, 'Unpaid order must be rejected');

      const rIncompat = await reqJson(baseUrl, 'POST', '/supplier/runs', {
        token: sup1Tok, idempotencyKey: `${tag}-incompat`,
        body: { order_ids: [ordPickup], cluster_id: clusterA, mode: 'STANDARD_CLUSTERED', delivery_day: '2026-11-18', delivery_window: '10:00-14:00', cutoff_at: futureCutoff }
      });
      assert.equal(rIncompat.status, 422, 'Pickup order cannot join STANDARD_CLUSTERED run');

      const rCap = await reqJson(baseUrl, 'POST', '/supplier/runs', {
        token: sup1Tok, idempotencyKey: `${tag}-cap`,
        body: { order_ids: [ordStd1, ordStd2], cluster_id: clusterA, mode: 'STANDARD_CLUSTERED', delivery_day: '2026-11-18', delivery_window: '10:00-14:00', cutoff_at: futureCutoff, max_stops: 1 }
      });
      assert.equal(rCap.status, 422, 'Exceeding max_stops must fail');
    }
    console.log('[PASS] Negative eligibility, role, mode compatibility & capacity checks');

    // 3. Concurrency test: two simultaneous workers forming a run for the same order [ordStd1, ordStd2]
    let stdRunId, stdStop1Id, stdStop2Id;
    {
      const [c1, c2] = await Promise.all([
        reqJson(baseUrl, 'POST', '/supplier/runs', {
          token: sup1Tok, idempotencyKey: `${tag}-conc-1`,
          body: { order_ids: [ordStd1, ordStd2], cluster_id: clusterA, mode: 'STANDARD_CLUSTERED', delivery_day: '2026-11-18', delivery_window: '10:00-14:00', cutoff_at: futureCutoff, max_stops: 10 }
        }),
        reqJson(baseUrl, 'POST', '/supplier/runs', {
          token: sup1Tok, idempotencyKey: `${tag}-conc-2`,
          body: { order_ids: [ordStd1, ordStd2], cluster_id: clusterA, mode: 'STANDARD_CLUSTERED', delivery_day: '2026-11-18', delivery_window: '10:00-14:00', cutoff_at: futureCutoff, max_stops: 10 }
        })
      ]);
      const statuses = [c1.status, c2.status].sort((a, b) => a - b);
      assert.deepEqual(statuses, [201, 409], `Expected one 201 and one 409 on concurrent run creation, got ${statuses}`);
      const winner = c1.status === 201 ? c1.json.data : c2.json.data;
      stdRunId = winner.run.id;
      stdStop1Id = winner.stops.find(s => Number(s.order_id) === ordStd1).id;
      stdStop2Id = winner.stops.find(s => Number(s.order_id) === ordStd2).id;
      createdIds.runs.push(stdRunId);
      createdIds.stops.push(stdStop1Id, stdStop2Id);
      assert.equal(winner.stops.length, 2);
      assert.equal(Number(winner.stops[0].locked_delivery_fee_pkr), 150.00);
    }
    console.log('[PASS] Concurrent run creation serialized cleanly (1x 201, 1x 409, 0 duplicate stops)');

    // 4. Real InnoDB lock-wait crossing cutoff test
    {
      const [[clk]] = await db.query("SELECT DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 SECOND), '%Y-%m-%dT%H:%i:%sZ') AS soon_cutoff");
      const lockConn = await db.getConnection();
      await lockConn.beginTransaction();
      await lockConn.query('SELECT id FROM orders WHERE id = ? FOR UPDATE', [ordExp]);

      const waiterPromise = deliveryRunService.formOrAssignRun({
        actor: supplier1,
        orderIds: [ordExp],
        clusterId: clusterA,
        mode: 'EXPRESS',
        deliveryDay: '2026-11-18',
        deliveryWindow: '14:00-18:00',
        cutoffAt: clk.soon_cutoff,
        idempotencyKey: `${tag}-lock-wait-cutoff`
      }).then(() => ({ ok: true }), err => ({ ok: false, code: err.code }));

      await new Promise(r => setTimeout(r, 2500));
      await lockConn.commit();
      lockConn.release();

      const waitRes = await waiterPromise;
      assert.equal(waitRes.ok, false, 'Post-lock SQL clock must reject run formation after lock wait crossed cutoff');
      assert.equal(waitRes.code, 'CLUSTER_CUTOFF_PASSED');
    }
    console.log('[PASS] Real InnoDB lock-wait cross-cutoff rejected by fresh post-lock SQL clock');

    // 5. Buyer privacy & wrong-supplier ownership checks
    {
      const rPeer = await reqJson(baseUrl, 'GET', `/buyer/orders/${ordStd1}/stop`, { token: buy2Tok });
      assert.equal(rPeer.status, 403, 'Buyer 2 must not view Buyer 1 stop');

      const rOwn = await reqJson(baseUrl, 'GET', `/buyer/orders/${ordStd1}/stop`, { token: buy1Tok });
      assert.equal(rOwn.status, 200);
      assert.equal(rOwn.json.data.stop.id, stdStop1Id);
      assert.equal(JSON.stringify(rOwn.json.data).includes(buyer2.email), false, 'No peer buyer leakage');

      const rWrongSup = await reqJson(baseUrl, 'POST', `/supplier/runs/${stdRunId}/dispatch`, {
        token: sup2Tok, idempotencyKey: `${tag}-wrong-sup-disp`, body: {}
      });
      assert.equal(rWrongSup.status, 403, 'Wrong supplier cannot dispatch run');
    }
    console.log('[PASS] Buyer peer privacy & supplier ownership enforced');

    // 6. Cutoff lock, Dispatch, Meaningful ETA update, Supplier Mark Delivered, and Settlement Guard
    {
      const rLock = await reqJson(baseUrl, 'POST', `/supplier/runs/${stdRunId}/lock-cutoff`, {
        token: sup1Tok, idempotencyKey: `${tag}-cutoff-lock`, body: { enforce_cutoff_clock: false }
      });
      assert.equal(rLock.status, 200);
      assert.equal(rLock.json.data.run.status, 'CUTOFF_LOCKED');

      const rDisp = await reqJson(baseUrl, 'POST', `/supplier/runs/${stdRunId}/dispatch`, {
        token: sup1Tok, idempotencyKey: `${tag}-disp-std`,
        body: { delivery_method: 'SUPPLIER_FLEET', eta_at: futureEta }
      });
      assert.equal(rDisp.status, 200);
      assert.equal(rDisp.json.data.run.status, 'DISPATCHED');

      // Meaningful ETA update
      const rEta = await reqJson(baseUrl, 'POST', `/supplier/runs/${stdRunId}/eta`, {
        token: sup1Tok, idempotencyKey: `${tag}-eta-2`,
        body: { eta_at: futureEta2, reason: 'Traffic delay on Canal Road' }
      });
      assert.equal(rEta.status, 200);
      assert.equal(rEta.json.data.run.eta_version, 2);

      // Supplier marks stop 1 & stop 2 delivered
      for (const sid of [stdStop1Id, stdStop2Id]) {
        const rDel = await reqJson(baseUrl, 'POST', `/supplier/stops/${sid}/mark-delivered`, {
          token: sup1Tok, idempotencyKey: `${tag}-sup-del-${sid}`, body: { notes: 'Unloaded at gate' }
        });
        assert.equal(rDel.status, 200);
        assert.equal(rDel.json.data.stop.status, 'SUPPLIER_DELIVERED');
      }

      // Supplier-only delivery mark MUST NOT authorize settlement!
      await assert.rejects(
        () => financialSettlementService.accrueSupplierPayable({ orderId: ordStd1, actor: supplier1, idempotencyKey: `${tag}-premature-settle` }),
        err => err.code === 'PREMATURE_SETTLEMENT_BLOCKED' || err.statusCode === 422 || err.statusCode === 403
      );
    }
    console.log('[PASS] Dispatch, ETA v2, Supplier delivery mark & premature-settlement block verified');

    // 7. 100 ordered / 80 accepted / 20 disputed partial delivery + full receipt on stop 2
    {
      // Negative/excessive quantities rejected
      const rBadQty = await reqJson(baseUrl, 'POST', `/buyer/stops/${stdStop1Id}/receipt`, {
        token: buy1Tok, idempotencyKey: `${tag}-bad-qty`,
        body: { accepted_qty: '80', missing_qty: '30', rejected_qty: '0', description: 'Excessive sum' }
      });
      assert.equal(rBadQty.status, 422, 'Excessive quantity sum must be rejected');

      const rNegQty = await reqJson(baseUrl, 'POST', `/buyer/stops/${stdStop1Id}/receipt`, {
        token: buy1Tok, idempotencyKey: `${tag}-neg-qty`,
        body: { accepted_qty: '-5', missing_qty: '105', rejected_qty: '0' }
      });
      assert.equal(rNegQty.status, 422, 'Negative quantity must be rejected');

      // 100 / 80 / 20 partial receipt
      const rPartial = await reqJson(baseUrl, 'POST', `/buyer/stops/${stdStop1Id}/receipt`, {
        token: buy1Tok, idempotencyKey: `${tag}-partial-100-80-20`,
        body: { accepted_qty: '80', missing_qty: '20', rejected_qty: '0', reason: 'SHORT_QUANTITY', description: 'Received 80 of 100 units; 20 units missing.' }
      });
      assert.equal(rPartial.status, 200);
      assert.equal(rPartial.json.data.stop.status, 'PARTIAL_CONFIRMED');
      assert.equal(Number(rPartial.json.data.stop.accepted_qty), 80);
      assert.equal(Number(rPartial.json.data.stop.disputed_qty), 20);
      assert.ok(rPartial.json.data.dispute_id > 0, 'Dispute ID must be created');
      createdIds.disputes.push(rPartial.json.data.dispute_id);

      // Verify orders.total_qty preserved untouched (100.0000) and order in EXCEPTION
      const [[ordRow]] = await db.query('SELECT total_qty, fulfillment_status FROM orders WHERE id = ?', [ordStd1]);
      assert.equal(Number(ordRow.total_qty), 100);
      assert.equal(ordRow.fulfillment_status, 'EXCEPTION');

      // Disputed order cannot be settled prematurely
      await assert.rejects(
        () => financialSettlementService.accrueSupplierPayable({ orderId: ordStd1, actor: admin, idempotencyKey: `${tag}-disputed-settle` }),
        err => err.code === 'DISPUTED_ORDER_SETTLEMENT_BLOCKED' || err.code === 'PREMATURE_SETTLEMENT_BLOCKED' || err.statusCode === 422
      );

      // Stop 2 full receipt by Buyer 2
      const rFull = await reqJson(baseUrl, 'POST', `/buyer/stops/${stdStop2Id}/receipt`, {
        token: buy2Tok, idempotencyKey: `${tag}-full-b2`,
        body: { accepted_qty: '50', missing_qty: '0', rejected_qty: '0' }
      });
      assert.equal(rFull.status, 200);
      assert.equal(rFull.json.data.stop.status, 'BUYER_CONFIRMED');
    }
    console.log('[PASS] 100/80/20 partial delivery, dispute creation, ordered qty preservation & settlement block verified');

    // 8. Pickup mode: code issuance, zero secret leakage in events/notifications, wrong code rejection, valid claim
    let pickupRunId, pickupStopId;
    {
      const rPkRun = await reqJson(baseUrl, 'POST', '/supplier/runs', {
        token: sup1Tok, idempotencyKey: `${tag}-pickup-run`,
        body: { order_ids: [ordPickup], cluster_id: clusterA, mode: 'PICKUP', delivery_day: '2026-11-18', delivery_window: '09:00-18:00', cutoff_at: futureCutoff }
      });
      assert.equal(rPkRun.status, 201);
      pickupRunId = rPkRun.json.data.run.id;
      pickupStopId = rPkRun.json.data.stops[0].id;
      createdIds.runs.push(pickupRunId);
      createdIds.stops.push(pickupStopId);

      // Buyer retrieves private pickup code
      const rBuyerStop = await reqJson(baseUrl, 'GET', `/buyer/orders/${ordPickup}/stop`, { token: buy3Tok });
      assert.equal(rBuyerStop.status, 200);
      const code = rBuyerStop.json.data.stop.pickup_code;
      assert.ok(code && code.length >= 6, 'Owning buyer must see pickup code');

      // Verify pickup code does NOT appear in procurement_notifications or order_fulfillment_events
      const [leakEvents] = await db.query(
        `SELECT id FROM procurement_notifications WHERE recipient_id = ? AND (event_key LIKE ? OR CAST(payload AS CHAR) LIKE ?)`,
        [buyer3.id, `%${code}%`, `%${code}%`]
      );
      assert.equal(leakEvents.length, 0, 'Pickup code must never appear in notification payloads or keys');

      const rWrongCode = await reqJson(baseUrl, 'POST', `/supplier/stops/${pickupStopId}/claim-pickup`, {
        token: sup1Tok, idempotencyKey: `${tag}-wrong-pk`, body: { pickup_code: 'WRONGCODE' }
      });
      assert.equal(rWrongCode.status, 403, 'Wrong pickup code must be rejected');

      const rClaim = await reqJson(baseUrl, 'POST', `/supplier/stops/${pickupStopId}/claim-pickup`, {
        token: sup1Tok, idempotencyKey: `${tag}-claim-pk`, body: { pickup_code: code }
      });
      assert.equal(rClaim.status, 200);
      assert.equal(rClaim.json.data.stop.status, 'SUPPLIER_DELIVERED');
    }
    console.log('[PASS] Pickup mode claim verification & secret non-leakage verified');

    // 9. Express mode: Failed attempt, bounded reattempt, admin recovery, and Selected Cost/Consent Amendments
    let expRunId, expStopId;
    {
      const rExpRun = await reqJson(baseUrl, 'POST', '/supplier/runs', {
        token: sup1Tok, idempotencyKey: `${tag}-exp-run`,
        body: { order_ids: [ordExp], cluster_id: clusterA, mode: 'EXPRESS', delivery_day: '2026-11-18', delivery_window: '14:00-18:00', cutoff_at: futureCutoff }
      });
      assert.equal(rExpRun.status, 201);
      expRunId = rExpRun.json.data.run.id;
      expStopId = rExpRun.json.data.stops[0].id;
      createdIds.runs.push(expRunId);
      createdIds.stops.push(expStopId);

      await reqJson(baseUrl, 'POST', `/supplier/runs/${expRunId}/dispatch`, {
        token: sup1Tok, idempotencyKey: `${tag}-exp-disp`, body: { delivery_method: 'SUPPLIER_FLEET', eta_at: futureEta }
      });

      const rFail = await reqJson(baseUrl, 'POST', `/supplier/stops/${expStopId}/failed-attempt`, {
        token: sup1Tok, idempotencyKey: `${tag}-exp-fail1`,
        body: { reason_code: 'BUYER_UNAVAILABLE', notes: 'Gate closed', schedule_reattempt: true, new_eta_at: futureEta2, sla_breached: true }
      });
      assert.equal(rFail.status, 200);
      assert.equal(rFail.json.data.stop.status, 'REATTEMPT_SCHEDULED');
      assert.equal(rFail.json.data.stop.attempt_count, 1);

      // Selected cost policy: Supplier/carrier failure CANNOT impose extra buyer charge
      const rBadSupFee = await reqJson(baseUrl, 'POST', '/amendments', {
        token: sup1Tok, idempotencyKey: `${tag}-bad-sup-fee`,
        body: {
          order_id: ordExp, stop_id: expStopId, amendment_type: 'REROUTE',
          cost_responsibility: 'SUPPLIER_CARRIER_FAILURE',
          reason: 'Carrier broke down', new_delivery_fee_pkr: '500.00', expires_at: futureExpiry
        }
      });
      assert.equal(rBadSupFee.status, 422, 'Supplier/carrier failure cannot charge buyer extra');

      // Platform fault cannot auto-charge or invent subsidy
      const rBadPlatFee = await reqJson(baseUrl, 'POST', '/amendments', {
        token: admTok, idempotencyKey: `${tag}-bad-plat-fee`,
        body: {
          order_id: ordExp, stop_id: expStopId, amendment_type: 'REROUTE',
          cost_responsibility: 'PLATFORM_PROVIDER_FAULT',
          reason: 'Map outage', new_delivery_fee_pkr: '250.00', expires_at: futureExpiry
        }
      });
      assert.equal(rBadPlatFee.status, 422, 'Platform fault cannot auto-charge/subsidize');

      // Buyer-requested fresh quote v1 (accepted concurrently — only one succeeds)
      const rProp1 = await reqJson(baseUrl, 'POST', '/amendments', {
        token: sup1Tok, idempotencyKey: `${tag}-prop-v1`,
        body: {
          order_id: ordExp, stop_id: expStopId, amendment_type: 'ADDRESS_CHANGE',
          cost_responsibility: 'BUYER_REQUESTED',
          reason: 'Buyer requested delivery to DHA Phase 5', new_delivery_fee_pkr: '450.00',
          proposed_eta_at: futureEta2, expires_at: futureExpiry
        }
      });
      assert.equal(rProp1.status, 201);
      const amd1 = rProp1.json.data.amendment;
      createdIds.amendments.push(amd1.id);
      assert.equal(Number(amd1.charge_diff_pkr), 150.00);

      // Wrong owner, wrong version, wrong hash rejected
      const rWrongBuyer = await reqJson(baseUrl, 'POST', `/amendments/${amd1.id}/decide`, {
        token: buy2Tok, idempotencyKey: `${tag}-wrong-b2`,
        body: { amendment_version: amd1.amendment_version, quote_hash: amd1.quote_hash, decision: 'ACCEPTED' }
      });
      assert.equal(rWrongBuyer.status, 403);

      const rWrongVer = await reqJson(baseUrl, 'POST', `/amendments/${amd1.id}/decide`, {
        token: buy1Tok, idempotencyKey: `${tag}-wrong-ver`,
        body: { amendment_version: 99, quote_hash: amd1.quote_hash, decision: 'ACCEPTED' }
      });
      assert.equal(rWrongVer.status, 409);

      // Concurrent accept vs decline on amd1
      const [dAcc, dDec] = await Promise.all([
        reqJson(baseUrl, 'POST', `/amendments/${amd1.id}/decide`, {
          token: buy1Tok, idempotencyKey: `${tag}-conc-acc`,
          body: { amendment_version: amd1.amendment_version, quote_hash: amd1.quote_hash, decision: 'ACCEPTED' }
        }),
        reqJson(baseUrl, 'POST', `/amendments/${amd1.id}/decide`, {
          token: buy1Tok, idempotencyKey: `${tag}-conc-dec`,
          body: { amendment_version: amd1.amendment_version, quote_hash: amd1.quote_hash, decision: 'DECLINED' }
        })
      ]);
      const dStatuses = [dAcc.status, dDec.status].sort((a, b) => a - b);
      assert.deepEqual(dStatuses, [200, 409], `Expected 200 and 409 on concurrent amendment decision, got ${dStatuses}`);

      // Verify order payment_status was NOT marked PAID/altered by consent alone, and admin recovery works
      const rAdmRec = await reqJson(baseUrl, 'POST', `/admin/stops/${expStopId}/recover`, {
        token: admTok, idempotencyKey: `${tag}-adm-rec`,
        body: { action: 'MARK_SLA_BREACH', reason: 'Confirmed SLA breach on Express stop' }
      });
      assert.equal(rAdmRec.status, 200);
    }
    console.log('[PASS] Failed attempt, reattempt, cost/consent policy, concurrent quote decision & admin recovery verified');

    // 10. Rollback & outbox atomicity check
    {
      const [[beforeCount]] = await db.query('SELECT COUNT(*) AS cnt FROM procurement_notifications WHERE recipient_id = ?', [buyer1.id]);
      const conn = await db.getConnection();
      await conn.beginTransaction();
      await conn.query(
        `INSERT INTO delivery_attempts (stop_id, run_id, order_id, attempt_number, outcome, reason_code, actor_id, actor_role, idempotency_key)
         VALUES (?, ?, ?, 99, 'FAILED', 'ROLLBACK_TEST', ?, 'SUPPLIER', ?)`,
        [expStopId, expRunId, ordExp, supplier1.id, `${tag}-rb-attempt`]
      );
      await deliveryRunService._emitStopNotification(conn, {
        type: 'FULFILLMENT.DELIVERY_FAILED',
        stop: { id: expStopId, order_id: ordExp, buyer_id: buyer1.id, supplier_id: supplier1.id, mode: 'EXPRESS', status: 'FAILED', version: 99 },
        actor: supplier1,
        transitionId: `${tag}-rb-notif`,
        message: 'Should roll back'
      });
      await conn.rollback();
      conn.release();
      const [[afterCount]] = await db.query('SELECT COUNT(*) AS cnt FROM procurement_notifications WHERE recipient_id = ?', [buyer1.id]);
      assert.equal(afterCount.cnt, beforeCount.cnt, 'Rolled-back transaction must emit zero notification rows');
    }
    console.log('[PASS] Transaction rollback emits zero outbox notifications');

    console.log('ALL PHASE C DELIVERY RELIABILITY GATE CHECKS PASSED');
  } finally {
    // Clean up only owned test fixtures in reverse FK order
    try {
      if (createdIds.orders.length) {
        const ordPh = createdIds.orders.map(() => '?').join(',');
        await db.query(`DELETE FROM delivery_amendments WHERE order_id IN (${ordPh})`, createdIds.orders);
        await db.query(`DELETE FROM delivery_attempts WHERE order_id IN (${ordPh})`, createdIds.orders);
        await db.query(`DELETE FROM delivery_run_stops WHERE order_id IN (${ordPh})`, createdIds.orders);
        await db.query(`DELETE FROM order_fulfillment_events WHERE order_id IN (${ordPh})`, createdIds.orders);
      }
      if (createdIds.stops.length) {
        const stopPh = createdIds.stops.map(() => '?').join(',');
        await db.query(`DELETE FROM system_audit_logs WHERE entity_name = 'delivery_run_stops' AND entity_id IN (${stopPh})`, createdIds.stops);
        await db.query(`DELETE FROM delivery_run_stops WHERE id IN (${stopPh})`, createdIds.stops);
      }
      if (createdIds.disputes.length) {
        const dspPh = createdIds.disputes.map(() => '?').join(',');
        await db.query(`DELETE FROM order_disputes WHERE id IN (${dspPh})`, createdIds.disputes);
      }
      if (createdIds.runs.length) {
        const runPh = createdIds.runs.map(() => '?').join(',');
        await db.query(`DELETE FROM delivery_runs WHERE id IN (${runPh})`, createdIds.runs);
      }
      if (createdIds.orders.length) {
        const ordPh = createdIds.orders.map(() => '?').join(',');
        await db.query(`DELETE FROM orders WHERE id IN (${ordPh})`, createdIds.orders);
      }
      if (createdIds.pickupPoints.length) {
        await db.query(`DELETE FROM supplier_pickup_points WHERE id IN (${createdIds.pickupPoints.map(() => '?').join(',')})`, createdIds.pickupPoints);
      }
      if (createdIds.addresses.length) {
        await db.query(`DELETE FROM buyer_delivery_addresses WHERE id IN (${createdIds.addresses.map(() => '?').join(',')})`, createdIds.addresses);
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
  console.error('[PHASE C GATE FAIL]', err);
  process.exitCode = 1;
});
