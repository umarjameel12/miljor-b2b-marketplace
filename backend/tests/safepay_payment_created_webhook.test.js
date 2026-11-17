'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Prevent opening real MySQL pool in pure unit tests
const dbPath = require.resolve('../src/config/db');
const mockState = { reset: null };
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (...args) => mockState.query(...args),
    getConnection: async () => mockState.getConnection()
  }
};

process.env.SAFEPAY_ENV = 'sandbox';
process.env.SAFEPAY_PUBLIC_KEY = 'sec_test_pub';
process.env.SAFEPAY_SECRET_KEY = 'sec_test_secret';
process.env.SAFEPAY_WEBHOOK_SECRET = 'whsec_test_safepay_created_2026';

const safepayCheckoutService = require('../src/services/safepayCheckoutService');
const procurementAwardService = require('../src/services/procurementAwardService');
const regularPoolPaymentHoldService = require('../src/services/regularPoolPaymentHoldService');
const notificationService = require('../src/services/notificationService');
const invoiceService = require('../src/services/invoiceService');
const flashPoolService = require('../src/services/flashPoolService');

function makeFixture({ orderStatus = 'AWAITING_PAYMENT', totalAmount = '1000.00', currency = 'PKR', duplicateEvent = false } = {}) {
  const queries = [];
  let commits = 0;
  let rollbacks = 0;
  const origReconcileAward = procurementAwardService.reconcilePaidOrder;
  const origMarkPaid = regularPoolPaymentHoldService.markPaid;
  const origEnqueueEvent = notificationService.enqueueEvent;
  const origGenerateInvoice = invoiceService.generateInvoiceForOrder;
  const origFlashReconcile = flashPoolService.reconcilePaidOrder;
  procurementAwardService.reconcilePaidOrder = async () => {};
  regularPoolPaymentHoldService.markPaid = async () => {};
  notificationService.enqueueEvent = async () => {};
  invoiceService.generateInvoiceForOrder = async () => {};
  flashPoolService.reconcilePaidOrder = async () => {};

  const execQuery = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('FROM payment_webhook_events WHERE event_id')) {
      return [duplicateEvent ? [{ id: 1, event_id: params[0] }] : []];
    }
    if (sql.includes('FROM payment_attempts WHERE provider_tracker_token')) {
      return [[{
        id: 11,
        order_id: 42,
        buyer_id: 7,
        provider_tracker_token: 'track_69b331f2-5ef0-4dd5-bcb4-d288fbdac0ef',
        status: 'INITIATED',
        procurement_delivery_contract_id: null
      }]];
    }
    if (sql.includes('FROM orders WHERE id = ? FOR UPDATE')) {
      return [[{
        id: 42,
        order_code: 'ORD-TEST-42',
        buyer_id: 7,
        supplier_id: 8,
        pool_id: null,
        reservation_id: null,
        order_status: orderStatus,
        payment_status: orderStatus === 'PAID' ? 'PAID' : 'PAYMENT_INITIATED',
        total_amount: totalAmount,
        currency,
        buyer_platform_fee: '0.00'
      }]];
    }
    if (sql.includes('INSERT INTO payments')) {
      return [{ insertId: 99 }];
    }
    return [[]];
  };

  mockState.query = execQuery;
  mockState.getConnection = async () => ({
    query: execQuery,
    beginTransaction: async () => {},
    commit: async () => { commits++; },
    rollback: async () => { rollbacks++; },
    release: () => {}
  });

  return {
    queries,
    getCommits: () => commits,
    getRollbacks: () => rollbacks,
    restore: () => {
      procurementAwardService.reconcilePaidOrder = origReconcileAward;
      regularPoolPaymentHoldService.markPaid = origMarkPaid;
      notificationService.enqueueEvent = origEnqueueEvent;
      invoiceService.generateInvoiceForOrder = origGenerateInvoice;
      flashPoolService.reconcilePaidOrder = origFlashReconcile;
    }
  };
}

function sign(payload) {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = crypto.createHmac('sha512', process.env.SAFEPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return { rawBody, signature };
}

test('official payment:created 1.0.0 with nested notification state=PAID captures once with fee metadata', async () => {
  const fx = makeFixture();
  try {
    const payload = {
      token: 'CNK4P631F43C73AIIF7G',
      client_id: 'sec_test_pub',
      type: 'payment:created',
      notification: {
        tracker: 'track_69b331f2-5ef0-4dd5-bcb4-d288fbdac0ef',
        reference: '969025',
        intent: 'CYBERSOURCE',
        fee: '32.77',
        net: '967.23',
        user: 'private-buyer@example.com',
        state: 'PAID',
        amount: '1000.00',
        currency: 'PKR'
      }
    };
    const { rawBody, signature } = sign(payload);
    const res = await safepayCheckoutService.processWebhookEvent({
      rawBody,
      signature,
      timestamp: Date.now(),
      eventId: payload.token,
      eventType: payload.type
    });
    assert.equal(res.success, true);
    assert.equal(res.payment_status, 'PAID');
    assert.equal(fx.getCommits(), 1);
    const payInsert = fx.queries.find((q) => q.sql.includes('INSERT INTO payments'));
    assert.ok(payInsert, 'payments row must be inserted');
    const providerResp = JSON.parse(payInsert.params[7]);
    assert.equal(providerResp.provider_fee, '32.77');
    assert.equal(providerResp.provider_net, '967.23');
    assert.equal(providerResp.provider_reference, '969025');
    assert.equal(providerResp.provider_state, 'PAID');
    assert.equal(providerResp.user, undefined, 'PII user email must not be copied into provider_response');
  } finally {
    fx.restore();
  }
});

for (const nonPaidState of ['PENDING', 'FAILED', 'CANCELLED', '']) {
  test(`payment:created with non-PAID state (${nonPaidState || 'EMPTY'}) never marks order PAID`, async () => {
    const fx = makeFixture();
    try {
      const payload = {
        token: `evt_${nonPaidState || 'empty'}`,
        type: 'payment:created',
        notification: {
          tracker: 'track_69b331f2-5ef0-4dd5-bcb4-d288fbdac0ef',
          state: nonPaidState,
          amount: '1000.00',
          currency: 'PKR'
        }
      };
      const { rawBody, signature } = sign(payload);
      const res = await safepayCheckoutService.processWebhookEvent({
        rawBody, signature, timestamp: Date.now(), eventId: payload.token, eventType: payload.type
      });
      assert.equal(res.success, true);
      assert.equal(res.payment_status, undefined);
      assert.equal(fx.queries.some((q) => q.sql.includes('INSERT INTO payments')), false);
      const evtInsert = fx.queries.find((q) => q.sql.includes('INSERT INTO payment_webhook_events'));
      assert.equal(evtInsert.params[1], `payment:created:${nonPaidState || 'UNKNOWN'}`);
    } finally {
      fx.restore();
    }
  });
}

test('payment:created rejects wrong amount (including minor-unit mismatch), wrong currency, and invalid signature', async () => {
  const fx = makeFixture();
  try {
    for (const badAmount of ['999.00', '100000.00']) {
      const p = {
        token: `evt_amt_${badAmount}`,
        type: 'payment:created',
        notification: {
          tracker: 'track_69b331f2-5ef0-4dd5-bcb4-d288fbdac0ef',
          state: 'PAID',
          amount: badAmount,
          currency: 'PKR'
        }
      };
      const { rawBody, signature } = sign(p);
      await assert.rejects(
        () => safepayCheckoutService.processWebhookEvent({ rawBody, signature, timestamp: Date.now(), eventId: p.token, eventType: p.type }),
        { code: 'AMOUNT_MISMATCH' }
      );
    }

    const badCurr = {
      token: 'evt_curr_usd',
      type: 'payment:created',
      notification: { tracker: 'track_69b331f2-5ef0-4dd5-bcb4-d288fbdac0ef', state: 'PAID', amount: '1000.00', currency: 'USD' }
    };
    const signedCurr = sign(badCurr);
    await assert.rejects(
      () => safepayCheckoutService.processWebhookEvent({ rawBody: signedCurr.rawBody, signature: signedCurr.signature, timestamp: Date.now(), eventId: badCurr.token, eventType: badCurr.type }),
      { code: 'CURRENCY_MISMATCH' }
    );

    await assert.rejects(
      () => safepayCheckoutService.processWebhookEvent({ rawBody: signedCurr.rawBody, signature: 'bad_sig', timestamp: Date.now(), eventId: 'evt_bad', eventType: 'payment:created' }),
      { code: 'INVALID_WEBHOOK_SIGNATURE' }
    );
  } finally {
    fx.restore();
  }
});

test('payment:created replay and unrelated events (refund:created, error:occurred) do not mutate payments', async () => {
  const fxDup = makeFixture({ duplicateEvent: true });
  try {
    const p = { token: 'CNK_DUP', type: 'payment:created', notification: { tracker: 'track_69b331f2-5ef0-4dd5-bcb4-d288fbdac0ef', state: 'PAID', amount: '1000.00', currency: 'PKR' } };
    const { rawBody, signature } = sign(p);
    const res = await safepayCheckoutService.processWebhookEvent({ rawBody, signature, timestamp: Date.now(), eventId: p.token, eventType: p.type });
    assert.equal(res.is_duplicate, true);
    assert.equal(fxDup.getCommits(), 0);
  } finally {
    fxDup.restore();
  }

  for (const evtType of ['refund:created', 'error:occurred']) {
    const fxOther = makeFixture();
    try {
      const p = { token: `evt_${evtType}`, type: evtType, notification: { tracker: 'track_69b331f2-5ef0-4dd5-bcb4-d288fbdac0ef', state: 'PAID', amount: '1000.00', currency: 'PKR' } };
      const { rawBody, signature } = sign(p);
      const res = await safepayCheckoutService.processWebhookEvent({ rawBody, signature, timestamp: Date.now(), eventId: p.token, eventType: p.type });
      assert.equal(res.success, true);
      assert.equal(fxOther.queries.some((q) => q.sql.includes('INSERT INTO payments')), false);
    } finally {
      fxOther.restore();
    }
  }
});

test('live Safepay { data: { type, token, notification } } envelope signed over JSON.stringify(data) captures and extracts event_id/event_type without x-sfpy-event-* headers', async () => {
  const fx = makeFixture({ totalAmount: '355.00' });
  try {
    const payload = {
      data: {
        type: 'payment:created',
        token: 'DBU6EODL2AHS7395PJVG',
        endpoint: 'https://example.trycloudflare.com/api/v1/webhooks/safepay',
        resource: 'notification',
        client_id: 'sec_test_pub',
        created_at: '2026-11-17T14:40:34Z',
        notification: {
          fee: '22.49',
          net: '332.51',
          user: 'buyer@example.test',
          state: 'PAID',
          amount: '355.00',
          intent: 'CYBERSOURCE',
          tracker: 'track_69b331f2-5ef0-4dd5-bcb4-d288fbdac0ef',
          currency: 'PKR',
          metadata: { order_id: 'MJQ-TEST' },
          reference: '906473'
        }
      }
    };
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = crypto
      .createHmac('sha512', process.env.SAFEPAY_WEBHOOK_SECRET)
      .update(Buffer.from(JSON.stringify(payload.data), 'utf8'))
      .digest('hex');

    const res = await safepayCheckoutService.processWebhookEvent({
      rawBody,
      signature,
      timestamp: undefined,
      eventId: undefined,
      eventType: undefined
    });
    assert.equal(res.success, true);
    assert.equal(res.payment_status, 'PAID');
    assert.equal(fx.getCommits(), 1);
    const evtInsert = fx.queries.find((q) => q.sql.includes('INSERT INTO payment_webhook_events'));
    assert.equal(evtInsert.params[0], 'DBU6EODL2AHS7395PJVG');
    assert.equal(evtInsert.params[1], 'payment:created');

    // Negative check: mutating notification.amount inside data invalidates data signature
    const tampered = JSON.parse(rawBody.toString('utf8'));
    tampered.data.notification.amount = '1.00';
    await assert.rejects(
      () => safepayCheckoutService.processWebhookEvent({
        rawBody: Buffer.from(JSON.stringify(tampered), 'utf8'),
        signature,
        timestamp: undefined,
        eventId: undefined,
        eventType: undefined
      }),
      { code: 'INVALID_WEBHOOK_SIGNATURE' }
    );
  } finally {
    fx.restore();
  }
});
