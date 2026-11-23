'use strict';
// In-memory adapters only: never load config/db, dotenv, or the provider adapter.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { AsyncLocalStorage } = require('node:async_hooks');

function load(relative, dependencies) {
  const filename = path.join(__dirname, relative);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, process: { env: {} }, console,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name === 'crypto') return require('node:crypto');
      if (name === './exactDecimal') return require('../src/services/exactDecimal');
      throw Error(`Unexpected dependency: ${name}`);
    }, setInterval() { throw Error('Unexpected heartbeat'); }, clearInterval() {}
  }, { filename });
  return module.exports;
}

function fixture(options = {}) {
  const context = new AsyncLocalStorage();
  const order = { id: 1, buyer_id: 7, order_code: 'ORD-12345678', total_amount: '12345.67',
    currency: 'PKR', order_status: 'AWAITING_PAYMENT', payment_status: 'UNPAID',
    role: 'BUYER', buyer_role: 'BUYER', buyer_trust_status: 'ACTIVE', ...options.order };
  const attempts = options.attempts || [];
  const events = [];
  let tail = Promise.resolve(), locked = 0, calls = 0, releases = 0, snapshot;
  async function query(sql, args = []) {
    if (/SELECT .*FROM orders|FROM orders o/s.test(sql)) return [[{ ...order }]];
    if (/SELECT .*FROM payment_attempts/s.test(sql)) {
      let rows = attempts;
      if (/WHERE id = \?/.test(sql)) rows = rows.filter(a => a.id === args[0]);
      else if (/idempotency_key = \?/.test(sql)) rows = rows.filter(a => a.order_id === Number(args[0]) && a.idempotency_key === args[1]);
      else if (/status (?:IN|=)/.test(sql)) rows = rows.filter(a => ['INITIATED', 'RECONCILIATION_REQUIRED'].includes(a.status));
      return [[...rows].reverse().map(a => ({ ...a }))];
    }
    if (/INSERT INTO payment_attempts/.test(sql)) {
      assert.equal(locked, 1, 'reservation requires an order transaction');
      if (options.failReservation) throw Error('reservation unavailable');
      const [attempt_code, order_id, buyer_id, amount, currency, idempotency_key] = args;
      const a = { id: attempts.length + 1, attempt_code, order_id, buyer_id, amount, currency,
        idempotency_key, provider: 'SAFEPAY', environment: 'sandbox', status: 'RECONCILIATION_REQUIRED',
        provider_tracker_token: null, checkout_url: null, created_at: '2000-01-01' };
      attempts.push(a);
      return [{ insertId: a.id, affectedRows: 1 }];
    }
    if (/UPDATE payment_attempts SET provider_tracker_token/.test(sql)) {
      assert.equal(context.getStore().transaction, false, 'tracker persistence precedes final transaction');
      if (options.failTrackerSave) throw Error('tracker persistence unavailable');
      attempts.find(a => a.id === args[1]).provider_tracker_token = args[0];
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE payment_attempts/.test(sql)) {
      if (options.failFinalize) throw Error('finalization failed');
      const a = attempts.find(a => a.id === args[1]);
      a.checkout_url = args[0]; a.status = 'INITIATED';
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE orders/.test(sql)) {
      assert.notEqual(order.payment_status, 'PAID', 'never downgrade payment');
      order.payment_status = 'PAYMENT_INITIATED';
      return [{ affectedRows: 1 }];
    }
    throw Error(`Unexpected SQL: ${sql}`);
  }
  const db = { query, async getConnection() {
    let unlock;
    return { query, async beginTransaction() {
      const previous = tail;
      tail = new Promise(resolve => { unlock = resolve; });
      await previous; locked++; context.getStore().transaction = true;
      snapshot = { order: { ...order }, attempts: attempts.map(a => ({ ...a })), events: events.length };
    }, async commit() { locked--; context.getStore().transaction = false; unlock(); unlock = null; }, async rollback() {
      if (!unlock) return;
      Object.assign(order, snapshot.order); attempts.splice(0, attempts.length, ...snapshot.attempts);
      events.length = snapshot.events; locked--; context.getStore().transaction = false; unlock(); unlock = null;
    }, release() {} };
  } };
  const hold = {
    async claimCheckout() { if (options.onClaim) options.onClaim(order); },
    async assertCanCreateFreshCheckout() {
      assert.equal(typeof this.db.query, 'function', 'read-only deadline policy reuses reservation connection');
      if (options.holdExpired) throw Object.assign(Error('hold expired'), { code: 'REGULAR_PAYMENT_HOLD_EXPIRED' });
    },
    async releaseCheckoutClaim() { releases++; }
  };
  const adapter = {
    validateConfig() { if (options.configError) throw Object.assign(Error('bad config'), { code: 'CONFIG_ERROR' }); },
    async createTracker(params) {
      calls++;
      assert.equal(context.getStore().transaction, false, 'no network inside transaction');
      assert.equal(attempts.length, 1, 'durable attempt before provider');
      assert.equal(attempts[0].status, 'RECONCILIATION_REQUIRED');
      assert.equal(params.amount, order.total_amount, 'provider receives exact stored amount');
      if (options.provider) return options.provider({ order, attempts });
      await new Promise(resolve => setImmediate(resolve));
      return { trackerToken: 'track_one' };
    },
    async createPassportToken() {
      assert.equal(attempts[0].provider_tracker_token, 'track_one', 'persist tracker before passport request');
      if (options.passport) await options.passport({ order, attempts });
      return 'passport';
    },
    constructCheckoutUrl() { return options.missingUrl ? null : 'https://sandbox.example/track_one'; }
  };
  const service = load('../src/services/safepayCheckoutService.js', {
    '../config/db': db, './safepayAdapter': adapter, './reservationEventService': {}, './procurementAwardService': {},
    './flashPoolService': hold, './regularPoolPaymentHoldService': hold,
    './collectivePaymentHoldService': { claimCheckout: async () => ({ collective_order: false }), assertCanCreateFreshCheckout: async () => ({ collective_order: false }) },
    './notificationService': { async enqueueEvent(conn, event) {
      assert.equal(locked, 1); assert.equal(order.payment_status, 'PAYMENT_INITIATED');
      assert.equal(event.eventType, 'PAYMENT_INITIATED'); assert.equal(event.userId, 7);
      if (options.failNotice) throw Error('notice failed');
      events.push(event);
    } }
  });
  return { service, order, attempts, events, get calls() { return calls; }, get releases() { return releases; },
    start(key = 'key', actor = { id: 7, role: 'BUYER' }) {
      return context.run({ transaction: false }, () => service.initiateCheckout({ orderId: 1, actor, idempotencyKey: key }));
    } };
}

test('50 different keys reserve one durable attempt and one provider session', async () => {
  const f = fixture();
  const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => f.start(`key-${i}`)));
  assert.equal(f.calls, 1); assert.equal(f.attempts.length, 1); assert.equal(f.events.length, 1);
  assert.ok(results.some(r => r.status === 'fulfilled'));
  for (const r of results.filter(r => r.status === 'rejected')) assert.equal(r.reason.code, 'CHECKOUT_RECONCILIATION_REQUIRED');
  const replay = await f.start('key-0');
  assert.equal(replay.is_replay, true); assert.equal(replay.attempt.checkout_url, 'https://sandbox.example/track_one');
});

test('unknown provider timeout retains reservation and both inventory claims', async () => {
  const f = fixture({ provider: async () => { throw Object.assign(Error('timeout'), { code: 'SAFEPAY_TIMEOUT' }); } });
  await assert.rejects(f.start(), { code: 'CHECKOUT_RECONCILIATION_REQUIRED', statusCode: 409 });
  await assert.rejects(f.start('different-key'), { code: 'CHECKOUT_RECONCILIATION_REQUIRED' });
  assert.equal(f.calls, 1); assert.equal(f.releases, 0); assert.equal(f.attempts[0].status, 'RECONCILIATION_REQUIRED');
});

for (const status of ['INITIATED', 'RECONCILIATION_REQUIRED']) {
  test(`old ${status} attempt without tracker/URL blocks another session`, async () => {
    const f = fixture({ attempts: [{ id: 1, order_id: 1, buyer_id: 7, status, idempotency_key: 'old', created_at: '2000-01-01' }] });
    await assert.rejects(f.start(), { code: 'CHECKOUT_RECONCILIATION_REQUIRED' });
    assert.equal(f.calls, 0);
  });
}

test('missing tracker response stays pending', async () => {
  const f = fixture({ provider: async () => ({}) });
  await assert.rejects(f.start(), { code: 'CHECKOUT_RECONCILIATION_REQUIRED' });
  assert.equal(f.attempts[0].provider_tracker_token, null); assert.equal(f.releases, 0);
});

for (const option of ['missingUrl', 'failFinalize', 'failNotice']) {
  test(`${option} retains tracker and rolls back readiness and notification`, async () => {
    const f = fixture({ [option]: true });
    await assert.rejects(f.start(), { code: 'CHECKOUT_RECONCILIATION_REQUIRED' });
    assert.equal(f.attempts[0].provider_tracker_token, 'track_one');
    assert.equal(f.attempts[0].status, 'RECONCILIATION_REQUIRED');
    assert.equal(f.order.payment_status, 'UNPAID'); assert.equal(f.events.length, 0);
  });
}

test('provider confirmation during passport request cannot downgrade PAID order', async () => {
  const f = fixture({ passport: async ({ order, attempts }) => {
    order.payment_status = 'PAID'; order.order_status = 'PAID'; attempts[0].status = 'COMPLETED';
  } });
  await assert.rejects(f.start(), { code: 'ORDER_ALREADY_PAID' });
  assert.equal(f.order.payment_status, 'PAID'); assert.equal(f.attempts[0].status, 'COMPLETED'); assert.equal(f.events.length, 0);
});

test('configuration, currency, owner, role and key length reject before reservation/provider', async () => {
  for (const [options, key, actor] of [
    [{ configError: true }, 'key'], [{ order: { currency: 'USD' } }, 'key'],
    [{}, 'x'.repeat(101)], [{}, 'key', { id: 8, role: 'BUYER' }],
    [{}, 'key', { id: 7, role: 'SUPPLIER' }], [{ order: { buyer_trust_status: 'SUSPENDED' } }, 'key']
  ]) {
    const f = fixture(options); await assert.rejects(f.start(key, actor));
    assert.equal(f.calls, 0); assert.equal(f.attempts.length, 0);
  }
});

test('owner, database role, suspension and payment state are revalidated after claims', async () => {
  for (const change of [{ buyer_id: 8 }, { buyer_role: 'SUPPLIER' }, { buyer_trust_status: 'SUSPENDED' },
    { payment_status: 'PAID' }, { order_status: 'CANCELLED' }]) {
    const f = fixture({ onClaim: order => Object.assign(order, change) });
    await assert.rejects(f.start());
    assert.equal(f.calls, 0); assert.equal(f.attempts.length, 0);
  }
});

test('foreign buyer receives ownership denial even when provider configuration is missing',async()=>{
  const f=fixture({configError:true});
  await assert.rejects(f.start('foreign-without-provider-config',{id:8,role:'BUYER'}),error=>error.code==='FORBIDDEN'&&error.statusCode===403);
  assert.equal(f.calls,0);assert.equal(f.attempts.length,0);
});

test('reservation persistence or fresh-hold denial prevents all provider calls', async () => {
  for (const option of ['failReservation', 'holdExpired']) {
    const f = fixture({ [option]: true });
    await assert.rejects(f.start());
    assert.equal(f.calls, 0); assert.equal(f.attempts.length, 0);
  }
});

test('tracker persistence failure leaves a blocking durable unknown attempt', async () => {
  const f = fixture({ failTrackerSave: true });
  await assert.rejects(f.start(), { code: 'CHECKOUT_RECONCILIATION_REQUIRED' });
  await assert.rejects(f.start('another'), { code: 'CHECKOUT_RECONCILIATION_REQUIRED' });
  assert.equal(f.calls, 1); assert.equal(f.releases, 0); assert.equal(f.events.length, 0);
});

test('old ready INITIATED attempt is reused across keys without a fresh session', async () => {
  const f = fixture({ attempts: [{ id: 1, order_id: 1, buyer_id: 7, idempotency_key: 'old', status: 'INITIATED',
    created_at: '2000-01-01', provider_tracker_token: 'old_tracker', checkout_url: 'https://sandbox.example/old' }] });
  const result = await f.start('fresh');
  assert.equal(result.is_existing_active, true); assert.equal(result.attempt.provider_tracker_token, 'old_tracker');
  assert.equal(f.calls, 0);
});

test('reconciliation-required attempts remain pending even when tracker and URL exist', async () => {
  const f = fixture({ attempts: [{ id: 1, order_id: 1, buyer_id: 7, idempotency_key: 'key', status: 'RECONCILIATION_REQUIRED',
    provider_tracker_token: 'old_tracker', checkout_url: 'https://sandbox.example/old' }] });
  await assert.rejects(f.start(), { code: 'CHECKOUT_RECONCILIATION_REQUIRED' });
  assert.equal(f.calls, 0);
});

test('same-key concurrency also creates one provider session', async () => {
  const f = fixture();
  const results = await Promise.allSettled(Array.from({ length: 50 }, () => f.start('shared')));
  assert.equal(f.calls, 1); assert.equal(f.attempts.length, 1); assert.equal(f.events.length, 1);
  assert.ok(results.some(r => r.status === 'fulfilled'));
  for (const r of results.filter(r => r.status === 'rejected')) assert.equal(r.reason.code, 'CHECKOUT_RECONCILIATION_REQUIRED');
});

async function recover({ attempts = [], mutations = [], url = '/api/v1/orders/1/checkout',
  actor = { id: 7, role: 'BUYER' }, record = {}, race = false } = {}) {
  const queries = [];
  const stored = { id: 11, user_id: 7, idempotency_key: 'key', status: 'UNKNOWN', inactive_seconds: 120,
    request_path: `POST:${url}`, ...record };
  const db = { async query(sql, args = []) {
    queries.push({ sql, args });
    if (sql.includes('FROM idempotency_records')) return [race && queries.length === 1 ? [] : [stored]];
    if (sql.includes('INSERT INTO idempotency_records')) throw Object.assign(Error('duplicate'), { code: 'ER_DUP_ENTRY' });
    if (sql.includes('FROM payment_attempts')) {
      assert.match(sql, /pa.order_id = \?/); assert.match(sql, /pa.buyer_id = \?/); assert.match(sql, /o.buyer_id = \?/);
      assert.equal(args.length, 4);
      return [attempts.filter(a => a.idempotency_key === args[0] && a.order_id === Number(args[1]) &&
        a.buyer_id === args[2] && a.buyer_id === args[3])];
    }
    if (sql.includes('FROM reservation_mutation_history')) {
      assert.match(sql, /buyer_id = \?/);
      return [mutations.filter(m => m.idempotency_key === args[0] && m.buyer_id === args[1] &&
        (args[2] === null || m.reservation_id === Number(args[3])))];
    }
    if (sql.includes('FROM system_audit_logs')) return [[]];
    if (sql.startsWith('UPDATE idempotency_records')) return [{ affectedRows: 1 }];
    throw Error(`Unexpected recovery SQL: ${sql}`);
  } };
  const guard = load('../src/middlewares/idempotencyGuard.js', { '../config/db': db });
  const req = { headers: { 'x-idempotency-key': 'key' }, method: 'POST', originalUrl: url, user: actor, body: {} };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await guard.required(req, res, error => { throw error || Error('Unexpected retry after unknown operation'); });
  return { res, queries };
}

const readyAttempt = { id: 1, order_id: 1, buyer_id: 7, idempotency_key: 'key', order_code: 'ORD-1',
  amount: '12345.67', currency: 'PKR', status: 'INITIATED', provider_tracker_token: 'track_private',
  checkout_url: 'https://sandbox.example/private', provider: 'SAFEPAY', environment: 'sandbox' };

test('stale checkout recovery preserves existing ready API response', async () => {
  const { res } = await recover({ attempts: [readyAttempt] });
  assert.equal(res.statusCode, 200); assert.equal(res.body.data.checkout_url, readyAttempt.checkout_url);
  assert.equal(res.body.data.amount, 12345.67); assert.equal(res.body.message, 'Checkout session retrieved (idempotent replay)');
});

for (const override of [{ status: 'RECONCILIATION_REQUIRED' }, { provider_tracker_token: null }, { checkout_url: null }]) {
  test(`stale checkout recovery returns pending for ${JSON.stringify(override)}`, async () => {
    const { res } = await recover({ attempts: [{ ...readyAttempt, ...override }] });
    assert.equal(res.statusCode, 409); assert.equal(res.body.error.code, 'CHECKOUT_RECONCILIATION_REQUIRED');
    assert.equal(res.body.data, undefined);
  });
}

test('stale checkout key cannot recover another buyer or order', async () => {
  for (const override of [{ buyer_id: 8 }, { order_id: 2 }]) {
    const { res } = await recover({ attempts: [{ ...readyAttempt, ...override }] });
    assert.equal(res.statusCode, 409); assert.equal(res.body.error.code, 'IDEMPOTENCY_OUTCOME_UNKNOWN');
    assert.equal(res.body.data, undefined);
  }
});

test('unrelated routes cannot recover a globally matching checkout key', async () => {
  const { res, queries } = await recover({ url: '/api/v1/procurement/requests', attempts: [readyAttempt] });
  assert.equal(res.statusCode, 409);
  assert.ok(!queries.some(q => q.sql.includes('payment_attempts')));
});

test('reservation history recovery binds authenticated owner and requested reservation', async () => {
  const foreign = { idempotency_key: 'key', buyer_id: 8, reservation_id: 6, response_payload: { private: true } };
  for (const mutation of [foreign, { ...foreign, buyer_id: 7, reservation_id: 9 }]) {
    const { res } = await recover({ url: '/api/v1/reservations/6/cancel', mutations: [mutation] });
    assert.equal(res.statusCode, 409); assert.equal(res.body.private, undefined);
  }
});

test('insert-race cached response cannot bypass actor or endpoint binding', async () => {
  for (const [override, expected] of [[{ user_id: 8 }, 403], [{ request_path: 'POST:/api/v1/orders/2/checkout' }, 409]]) {
    const { res } = await recover({ race: true, record: { status: 'COMPLETED', response_status: 200,
      response_body: JSON.stringify({ private: true }), ...override } });
    assert.equal(res.statusCode, expected); assert.equal(res.body.private, undefined);
  }
});

test('cached ready checkout response remains byte-for-byte compatible', async () => {
  const body = { success: true, message: 'Checkout session initiated successfully', data: readyAttempt };
  const { res } = await recover({ record: { status: 'COMPLETED', response_status: 200, response_body: JSON.stringify(body) } });
  assert.equal(JSON.stringify(res.body), JSON.stringify(body));
});

test('legacy cached checkout records without an authenticated owner are rejected', async () => {
  const { res } = await recover({ record: { user_id: null, status: 'COMPLETED', response_status: 200,
    response_body: JSON.stringify({ private: true }) } });
  assert.equal(res.statusCode, 403); assert.equal(res.body.private, undefined);
});

function reconciliationFixture({ status = 'RECONCILIATION_REQUIRED', tracker = 'track_persisted',
  orderStatus = 'AWAITING_PAYMENT', paymentStatus = 'AWAITING_PAYMENT', response } = {}) {
  let lookups = 0;
  const attempt = { id: 12, order_id: 1, buyer_id: 7, status, provider_tracker_token: tracker };
  const order = { id: 1, buyer_id: 7, order_status: orderStatus, payment_status: paymentStatus,
    total_amount: '12345.67', currency: 'PKR' };
  const db = { async query(sql) {
    if (sql.includes('FROM orders')) return [[order]];
    if (sql.includes('FROM payments')) return [[]];
    if (sql.includes('FROM payment_attempts')) {
      // Model the SQL predicate rather than silently accepting either query.
      const eligible = sql.includes("status = 'INITIATED'")
        ? status === 'INITIATED' : ['INITIATED', 'RECONCILIATION_REQUIRED'].includes(status);
      return [eligible ? [attempt] : []];
    }
    throw Error('Unexpected reconciliation query: ' + sql);
  }, async getConnection() { throw Error('Noncaptured reconciliation must not start a financial transaction'); } };
  const service = load('../src/services/safepayCheckoutService.js', {
    '../config/db': db, './reservationEventService': {}, './procurementAwardService': {}, './notificationService': {},
    './safepayAdapter': { async fetchTracker(token) {
      lookups++; assert.equal(token, tracker, 'only the persisted provider identity may be queried');
      return response || { data: { token, state: 'TRACKER_STARTED' } };
    } }
  });
  return { get lookups() { return lookups; }, reconcile(actor = { id: 7, role: 'BUYER' }) {
    return service.reconcilePaymentWithProvider({ orderId: 1, actor });
  } };
}

for (const status of ['INITIATED', 'RECONCILIATION_REQUIRED']) {
  test(`provider reconciliation queries persisted tracker for ${status} without a checkout URL`, async () => {
    const f = reconciliationFixture({ status });
    const result = await f.reconcile();
    assert.equal(f.lookups, 1); assert.equal(result.reconciled, false);
    assert.equal(result.provider_state, 'TRACKER_STARTED'); assert.equal(result.order_status, 'AWAITING_PAYMENT');
  });
  test(`provider reconciliation keeps trackerless ${status} explicitly pending`, async () => {
    const f = reconciliationFixture({ status, tracker: null });
    await assert.rejects(f.reconcile(), { code: 'CHECKOUT_RECONCILIATION_REQUIRED', statusCode: 409 });
    assert.equal(f.lookups, 0);
  });
}

test('unresolved provider recovery preserves ownership and tracker identity checks', async () => {
  const f = reconciliationFixture();
  await assert.rejects(f.reconcile({ id: 8, role: 'BUYER' }), { code: 'FORBIDDEN' });
  assert.equal(f.lookups, 0);
  const wrongTracker = reconciliationFixture({ response: { data: { token: 'other_tracker', state: 'TRACKER_STARTED' } } });
  await assert.rejects(wrongTracker.reconcile(), { code: 'TRACKER_MISMATCH' });
});

test('provider recovery recognizes either PAID order field without querying provider', async () => {
  for (const paid of [{ orderStatus: 'PAID' }, { paymentStatus: 'PAID' }]) {
    const f = reconciliationFixture(paid);
    const result = await f.reconcile();
    assert.equal(result.already_paid, true); assert.equal(f.lookups, 0);
  }
});
