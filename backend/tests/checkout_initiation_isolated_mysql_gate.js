'use strict';
// Run only against the disposable local server explicitly authorized for this gate:
// NODE_ENV=test TEST_DB_NAME=miljor_test_db DB_HOST=127.0.0.1 DB_PORT=33319 DB_USER=root
// node tests/checkout_initiation_isolated_mysql_gate.js
// No migrations, .env, server/scheduler, provider traffic, or shared fixtures.
const assert = require('node:assert/strict');
for (const [name, expected] of Object.entries({ NODE_ENV: 'test', TEST_DB_NAME: 'miljor_test_db',
  DB_HOST: '127.0.0.1', DB_USER: 'root' })) {
  assert.equal(process.env[name], expected, `ISOLATED_CHECKOUT_GATE_ABORT: ${name}`);
}
assert.ok(!process.env.DB_NAME || process.env.DB_NAME === 'miljor_test_db', 'PROTECTED_DATABASE_ABORT');
assert.equal(process.env.DB_PASSWORD || '', '', 'Only the authorized empty-password local server is allowed');

assert.ok(['33319','33321'].includes(process.env.DB_PORT),'Explicit isolated runtime/final-canonical test port required');
const testPort=Number(process.env.DB_PORT);
const mysql = require('mysql2/promise');
const crypto = require('node:crypto');
const https = require('node:https');
const { setTimeout: delay } = require('node:timers/promises');
const db = mysql.createPool({ host: '127.0.0.1', port: testPort, user: 'root', password: '',
  database: 'miljor_test_db', connectionLimit: 10, waitForConnections: true, queueLimit: 0,
  timezone: 'Z', connectTimeout: 3000 });
db.pool.on('connection', connection => connection.query("SET time_zone = '+00:00'"));

// Test-process dependency binding avoids loading config/db.js and its dotenv side effect.
// Application services and their SQL/notification/hold logic remain unchanged.
const dbPath = require.resolve('../src/config/db');
const dotenvPath = require.resolve('dotenv');
const previousDb = require.cache[dbPath], previousDotenv = require.cache[dotenvPath];
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
require.cache[dotenvPath] = { id: dotenvPath, filename: dotenvPath, loaded: true,
  exports: { config() { throw Error('DOTENV_ACCESS_FORBIDDEN_IN_ISOLATED_GATE'); } } };
const originalRequest = https.request;
https.request = () => { throw Error('PROVIDER_NETWORK_FORBIDDEN_IN_ISOLATED_GATE'); };
Object.assign(process.env, { SAFEPAY_ENV: 'sandbox', SAFEPAY_PUBLIC_KEY: 'isolated-mock-public-key',
  SAFEPAY_SECRET_KEY: 'isolated-mock-secret-key', SAFEPAY_WEBHOOK_SECRET: 'isolated-mock-webhook-key',
  FRONTEND_URL: 'http://checkout-fixture.invalid', ALLOW_EXTERNAL_MONEY_MOVEMENT: 'false' });

const tag = crypto.randomBytes(6).toString('hex');
const owned = { users: [], products: [], pools: [], reservations: [], orders: [], keys: [] };
let checks = 0, service, guard, buyer, supplier, stranger;
const pass = message => console.log(`PASS ${++checks}: ${message}`);
const pending = error => error.code === 'CHECKOUT_RECONCILIATION_REQUIRED' && error.statusCode === 409;
const key = suffix => `CKMYSQL-${tag}-${suffix}`;

async function waitForSchema() {
  const required = ['users', 'products', 'pools', 'reservations', 'orders', 'payment_attempts',
    'regular_pool_payment_holds', 'flash_purchase_holds', 'procurement_notifications', 'idempotency_records'];
  const until = Date.now() + 120000;
  let missing = required;
  do {
    const [[target]] = await db.query('SELECT DATABASE() AS name, @@port AS port');
    assert.equal(target.name, 'miljor_test_db'); assert.equal(Number(target.port), testPort);
    const [tables] = await db.query(`SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.tables
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`, [required]);
    missing = required.filter(name => !tables.some(table => table.name === name));
    const [[column]] = await db.query(`SELECT COLUMN_TYPE AS type FROM information_schema.columns
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'procurement_notifications' AND COLUMN_NAME = 'event_type'`);
    if (!column || (!/varchar|text/i.test(column.type) && !column.type.includes("'PAYMENT_INITIATED'"))) {
      missing.push('procurement_notifications.PAYMENT_INITIATED');
    }
    if (!missing.length) {
      for (const table of tables) assert.equal(table.engine, 'InnoDB', `${table.name} must be transactional`);
      return;
    }
    console.log(`WAITING_FOR_PARENT_SCHEMA: ${missing.join(', ')}`);
    await delay(2000);
  } while (Date.now() < until);
  throw Error(`SCHEMA_NOT_READY: ${missing.join(', ')}`);
}

async function createUser(role, suffix) {
  const [row] = await db.query('INSERT INTO users(full_name,email,role) VALUES (?,?,?)',
    ['Owned checkout gate ' + suffix, `${tag}-${suffix}@example.test`, role]);
  owned.users.push(row.insertId);
  return { id: row.insertId, role };
}

async function createOrder(suffix) {
  const [pool] = await db.query(`INSERT INTO pools(pool_code,supplier_id,product_id,target_qty,
    max_capacity,supplier_min_qty,buyer_min_qty,current_price_per_unit,expires_at)
    VALUES (?,?,?,1,10,1,1,12345.67,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY))`,
  ['CP' + tag + suffix, supplier.id, owned.products[0]]);
  owned.pools.push(pool.insertId);
  const [reservation] = await db.query(`INSERT INTO reservations
    (reservation_code,pool_id,buyer_id,quantity,unit_price,total_price) VALUES (?,?,?,1,12345.67,12345.67)`,
  ['CR' + tag + suffix, pool.insertId, buyer.id]);
  owned.reservations.push(reservation.insertId);
  const [row] = await db.query(`INSERT INTO orders(order_code,buyer_id,supplier_id,pool_id,reservation_id,
    total_qty,unit_price,subtotal_amount,total_amount,currency)
    VALUES (?,?,?,?,?,1,12345.67,12345.67,12345.67,'PKR')`,
  ['CO' + tag + suffix, buyer.id, supplier.id, pool.insertId, reservation.insertId]);
  owned.orders.push(row.insertId);
  await db.query(`INSERT INTO regular_pool_payment_holds(order_id,reservation_id,pool_id,buyer_id,expires_at)
    VALUES (?,?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE))`,
  [row.insertId, reservation.insertId, pool.insertId, buyer.id]);
  return row.insertId;
}

function mock(orderId, { init, passport } = {}) {
  let calls = 0;
  const client = {
    async init(params) {
      calls++;
      assert.equal(params.amount, '12345.67'); assert.equal(params.currency, 'PKR');
      const [rows] = await db.query('SELECT * FROM payment_attempts WHERE order_id=?', [orderId]);
      assert.equal(rows.length, 1, 'attempt must already be committed before provider invocation');
      assert.equal(rows[0].status, 'RECONCILIATION_REQUIRED');
      assert.equal(rows[0].amount, '12345.67'); assert.equal(rows[0].currency, 'PKR');
      if (init) return init(params);
      return { trackerToken: 'track_isolated_' + tag + '_' + orderId };
    },
    async createPassportToken() {
      const [[attempt]] = await db.query('SELECT provider_tracker_token FROM payment_attempts WHERE order_id=?', [orderId]);
      assert.ok(attempt.provider_tracker_token, 'tracker persisted before passport request');
      if (passport) await passport();
      return 'isolated_mock_passport';
    }
  };
  return { client, get calls() { return calls; } };
}

function start(orderId, suffix, provider, actor = buyer) {
  assert.equal(typeof provider.client.init, 'function');
  assert.equal(typeof provider.client.createPassportToken, 'function');
  return service.initiateCheckout({ orderId, actor, idempotencyKey: key(suffix), mockClient: provider.client });
}

async function assertRetained(orderId, hasTracker = false) {
  const [attempts] = await db.query('SELECT * FROM payment_attempts WHERE order_id=?', [orderId]);
  assert.equal(attempts.length, 1); assert.equal(attempts[0].status, 'RECONCILIATION_REQUIRED');
  assert.equal(Boolean(attempts[0].provider_tracker_token), hasTracker);
  assert.equal(attempts[0].checkout_url, null);
  const [[hold]] = await db.query('SELECT status FROM regular_pool_payment_holds WHERE order_id=?', [orderId]);
  assert.equal(hold.status, 'PAYMENT_PENDING');
  const [[order]] = await db.query('SELECT order_status,payment_status FROM orders WHERE id=?', [orderId]);
  assert.equal(order.order_status, 'AWAITING_PAYMENT'); assert.equal(order.payment_status, 'AWAITING_PAYMENT');
  const [[notices]] = await db.query(`SELECT COUNT(*) AS n FROM procurement_notifications
    WHERE recipient_id=? AND JSON_EXTRACT(payload,'$.entityId')=?`, [buyer.id, orderId]);
  assert.equal(Number(notices.n), 0);
}

async function recover(orderId, suffix, actor, attemptKey) {
  const recoveryKey = attemptKey || key(suffix);
  owned.keys.push(recoveryKey);
  const url = `/api/v1/orders/${orderId}/checkout`;
  await db.query(`INSERT INTO idempotency_records
    (idempotency_key,user_id,request_path,status,response_status,response_body,last_heartbeat_at)
    VALUES (?,?,?,'UNKNOWN',0,'',DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 MINUTE))`,
  [recoveryKey, actor.id, 'POST:' + url]);
  const req = { headers: { 'x-idempotency-key': recoveryKey }, user: actor, method: 'POST', originalUrl: url, body: {} };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  await guard.required(req, res, error => { throw error || Error('Recovery must not retry an unknown checkout'); });
  return res;
}

async function runChecks() {
  const concurrentOrder = await createOrder('a');
  let signalEntered, releaseProvider;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const resume = new Promise(resolve => { releaseProvider = resolve; });
  const provider = mock(concurrentOrder, { init: async () => {
    signalEntered(); await resume;
    return { trackerToken: 'track_isolated_' + tag + '_concurrent' };
  } });
  const first = start(concurrentOrder, 'concurrent-0', provider);
  // Attach a handler immediately so an unexpected early failure never escapes.
  const primary = first.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
  try {
    await Promise.race([entered, primary.then(result => {
      if (result.status === 'rejected') throw result.reason;
      throw Error('Provider barrier was not reached');
    })]);
    const results = await Promise.allSettled(Array.from({ length: 49 }, (_, i) => start(concurrentOrder, `concurrent-${i + 1}`, provider)));
    for (const result of results) {
      assert.equal(result.status, 'rejected', 'all contenders must observe pending reservation');
      assert.ok(pending(result.reason), result.reason && result.reason.message);
    }
    assert.equal(provider.calls, 1);
    await assertRetained(concurrentOrder);
  } finally { releaseProvider(); }
  const result = await primary;
  if (result.status === 'rejected') throw result.reason;
  assert.ok(result.value.attempt.checkout_url);
  const [[count]] = await db.query('SELECT COUNT(*) AS n FROM payment_attempts WHERE order_id=?', [concurrentOrder]);
  assert.equal(Number(count.n), 1); assert.equal(provider.calls, 1);
  const [[noticeCount]] = await db.query(`SELECT COUNT(*) AS n FROM procurement_notifications
    WHERE recipient_id=? AND event_type='PAYMENT_INITIATED' AND JSON_EXTRACT(payload,'$.entityId')=?`, [buyer.id, concurrentOrder]);
  assert.equal(Number(noticeCount.n), 1);
  pass('50 distinct checkout keys: 1 provider invocation, 1 committed attempt, 49 pending conflicts, 1 ready checkout and buyer event');

  await db.query('UPDATE payment_attempts SET created_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 DAY) WHERE order_id=?', [concurrentOrder]);
  const replay = await start(concurrentOrder, 'concurrent-0', provider);
  const reuse = await start(concurrentOrder, 'old-active-different-key', provider);
  assert.equal(replay.is_replay, true); assert.equal(reuse.is_existing_active, true);
  assert.equal(reuse.attempt.checkout_url, result.value.attempt.checkout_url); assert.equal(provider.calls, 1);
  pass('two-day-old INITIATED session replays/reuses across keys without a second provider invocation');

  for (const [suffix, init] of [['timeout', async () => { throw Object.assign(Error('synthetic timeout'), { code: 'SAFEPAY_TIMEOUT' }); }],
    ['incomplete', async () => ({})]]) {
    const orderId = await createOrder(suffix[0]);
    const unknown = mock(orderId, { init });
    await assert.rejects(start(orderId, suffix, unknown), pending);
    await assertRetained(orderId);
    await db.query('UPDATE payment_attempts SET created_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 DAY) WHERE order_id=?', [orderId]);
    await db.query('UPDATE regular_pool_payment_holds SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE order_id=?', [orderId]);
    await assert.rejects(start(orderId, suffix + '-retry', unknown), pending);
    await assertRetained(orderId); assert.equal(unknown.calls, 1);
    const recovered = await recover(orderId, suffix, buyer);
    assert.equal(recovered.statusCode, 409); assert.equal(recovered.body.error.code, 'CHECKOUT_RECONCILIATION_REQUIRED');
    assert.equal(recovered.body.data, undefined);
    let trackerLookups = 0;
    await assert.rejects(service.reconcilePaymentWithProvider({ orderId, actor: buyer,
      mockClient: { async fetchTracker() { trackerLookups++; throw Error('Tracker identity must not be invented'); } }
    }), pending);
    assert.equal(trackerLookups, 0);
    pass(`${suffix}: old unresolved attempt and expired PAYMENT_PENDING hold retained; no fake-ready recovery or second session`);
  }

  const missingUrlOrder = await createOrder('u');
  const missingUrl = mock(missingUrlOrder, { passport: async () => { throw Error('synthetic passport unavailable'); } });
  // Simulate a persisted crash window using an owned row, without modifying the adapter.
  const urlResult = await start(missingUrlOrder, 'url-window', missingUrl);
  assert.ok(urlResult.attempt.provider_tracker_token);
  await db.query("UPDATE payment_attempts SET checkout_url=NULL,status='RECONCILIATION_REQUIRED' WHERE order_id=?", [missingUrlOrder]);
  await db.query("UPDATE orders SET payment_status='AWAITING_PAYMENT' WHERE id=?", [missingUrlOrder]);
  await db.query("DELETE FROM procurement_notifications WHERE recipient_id=? AND event_key=?", [buyer.id, 'payment-initiated:' +
    (await db.query('SELECT id FROM payment_attempts WHERE order_id=?', [missingUrlOrder]))[0][0].id]);
  await assertRetained(missingUrlOrder, true);
  await assert.rejects(start(missingUrlOrder, 'url-retry', missingUrl), pending);
  const pendingRecovery = await recover(missingUrlOrder, 'url-window', buyer);
  assert.equal(pendingRecovery.statusCode, 409); assert.equal(missingUrl.calls, 1);
  pass('persisted tracker without checkout URL blocks fresh initiation and returns explicit pending recovery');

  let providerLookups = 0;
  const lookupClient = { async fetchTracker(token) {
    providerLookups++;
    assert.equal(token, urlResult.attempt.provider_tracker_token);
    return { data: { token, state: 'TRACKER_STARTED' } };
  } };
  const independentRecovery = await service.reconcilePaymentWithProvider({
    orderId: missingUrlOrder, actor: buyer, mockClient: lookupClient
  });
  assert.equal(independentRecovery.reconciled, false);
  assert.equal(independentRecovery.provider_state, 'TRACKER_STARTED');
  assert.equal(providerLookups, 1);
  await assertRetained(missingUrlOrder, true);
  await assert.rejects(service.reconcilePaymentWithProvider({ orderId: missingUrlOrder, actor: stranger,
    mockClient: lookupClient }), error => error.code === 'FORBIDDEN');
  assert.equal(providerLookups, 1);
  pass('RECONCILIATION_REQUIRED with persisted tracker permits independent owner-scoped provider lookup; null trackers stay pending without lookup');

  const paidOrder = await createOrder('p');
  const paidProvider = mock(paidOrder, { passport: async () => {
    // Controlled fixture transition represents authoritative confirmation racing finalization.
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("UPDATE orders SET payment_status='PAID',order_status='PAID' WHERE id=?", [paidOrder]);
      await conn.query("UPDATE payment_attempts SET status='COMPLETED' WHERE order_id=?", [paidOrder]);
      await conn.query("UPDATE regular_pool_payment_holds SET status='PAID' WHERE order_id=?", [paidOrder]);
      await conn.commit();
    } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
  } });
  await assert.rejects(start(paidOrder, 'paid-race', paidProvider), error => error.code === 'ORDER_ALREADY_PAID');
  await assert.rejects(start(paidOrder, 'paid-retry', paidProvider), error => error.code === 'ORDER_ALREADY_PAID');
  const [[paid]] = await db.query('SELECT payment_status,order_status FROM orders WHERE id=?', [paidOrder]);
  assert.equal(paid.payment_status, 'PAID'); assert.equal(paid.order_status, 'PAID'); assert.equal(paidProvider.calls, 1);
  const [[paidAttempt]] = await db.query('SELECT status FROM payment_attempts WHERE order_id=?', [paidOrder]);
  assert.equal(paidAttempt.status, 'COMPLETED');
  const alreadyPaid = await service.reconcilePaymentWithProvider({ orderId: paidOrder, actor: buyer,
    mockClient: { async fetchTracker() { throw Error('Already-paid reconciliation must not query provider'); } } });
  assert.equal(alreadyPaid.already_paid, true);
  pass('simulated authoritative PAID transition during passport call survives checkout finalization and retry');

  const privateOrder = await createOrder('o');
  const privateProvider = mock(privateOrder);
  await assert.rejects(start(privateOrder, 'private', privateProvider, stranger), error => error.code === 'FORBIDDEN');
  await assert.rejects(start(privateOrder, 'role', privateProvider, supplier), error => error.code === 'UNAUTHORIZED_ROLE');
  assert.equal(privateProvider.calls, 0);
  await start(privateOrder, 'private', privateProvider);
  await assert.rejects(start(privateOrder, 'private', privateProvider, stranger), error => error.code === 'FORBIDDEN');
  const foreignBuyerRecovery = await recover(privateOrder, 'private', stranger);
  assert.equal(foreignBuyerRecovery.statusCode, 409); assert.equal(foreignBuyerRecovery.body.data, undefined);
  const foreignOrderRecovery = await recover(privateOrder, 'different-order', buyer, key('concurrent-0'));
  assert.equal(foreignOrderRecovery.statusCode, 409); assert.equal(foreignOrderRecovery.body.data, undefined);
  assert.equal(privateProvider.calls, 1);
  pass('buyer/role isolation and real idempotency recovery never return another buyer/order session');

  const [[payments]] = await db.query('SELECT COUNT(*) AS n FROM payments WHERE order_id IN (?)', [owned.orders]);
  assert.equal(Number(payments.n), 0);
  pass('all scenarios produced zero payments/financial transactions');
}

async function cleanup() {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (owned.keys.length) await conn.query('DELETE FROM idempotency_records WHERE idempotency_key IN (?)', [owned.keys]);
    if (owned.users.length) await conn.query('DELETE FROM procurement_notifications WHERE recipient_id IN (?)', [owned.users]);
    if (owned.orders.length) {
      await conn.query('DELETE FROM regular_pool_payment_holds WHERE order_id IN (?)', [owned.orders]);
      await conn.query('DELETE FROM payment_attempts WHERE order_id IN (?)', [owned.orders]);
      await conn.query('DELETE FROM orders WHERE id IN (?)', [owned.orders]);
    }
    for (const table of ['reservations', 'pools', 'products', 'users']) {
      if (owned[table].length) await conn.query(`DELETE FROM ${table} WHERE id IN (?)`, [owned[table]]);
    }
    await conn.commit();
    for (const table of ['orders', 'reservations', 'pools', 'products', 'users']) {
      if (!owned[table].length) continue;
      const [[remaining]] = await conn.query(`SELECT COUNT(*) AS n FROM ${table} WHERE id IN (?)`, [owned[table]]);
      assert.equal(Number(remaining.n), 0, 'Owned fixture cleanup: ' + table);
    }
  } catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}

async function main() {
  let safeToMutate = false;
  try {
    await waitForSchema(); safeToMutate = true;
    console.log(`TARGET VERIFIED: 127.0.0.1:${testPort} / miljor_test_db / root; explicit pool limit 10; no .env or provider network`);
    service = require('../src/services/safepayCheckoutService');
    guard = require('../src/middlewares/idempotencyGuard');
    buyer = await createUser('BUYER', 'buyer'); supplier = await createUser('SUPPLIER', 'supplier'); stranger = await createUser('BUYER', 'stranger');
    const [product] = await db.query(`INSERT INTO products(title,category,brand,variety,processing_type,grade,pack_size)
      VALUES (?,'test','fixture','fixture','fixture','fixture','1 kg')`, ['Owned checkout product ' + tag]);
    owned.products.push(product.insertId);
    await runChecks();
  } finally {
    try {
      if (safeToMutate) { await cleanup(); console.log('CLEANUP VERIFIED: only this run\'s owned fixtures removed'); }
    } finally {
      await db.end(); https.request = originalRequest;
      if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
      if (previousDotenv) require.cache[dotenvPath] = previousDotenv; else delete require.cache[dotenvPath];
    }
  }
  console.log(`CHECKOUT_ISOLATED_MYSQL_GATE_PASS: ${checks} scenario checks`);
}
main().catch(error => {
  console.error('CHECKOUT_ISOLATED_MYSQL_GATE_FAIL:', error.code || 'ASSERTION', error.message);
  process.exitCode = 1;
});
