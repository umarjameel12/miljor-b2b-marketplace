'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CollectivePaymentHoldService,
  evaluateHybridGroupOutcome
} = require('../src/services/collectivePaymentHoldService');
const { assertGroupFunding } = require('../src/services/procurementCollectiveCommitmentPolicy');
const { eventProjection, eventTypes, mandatory } = require('../src/services/notificationEventPolicy');

function createMockDb(initialState = {}) {
  const state = {
    holds: (initialState.holds || []).map((h) => ({ ...h })),
    allocations: (initialState.allocations || []).map((a) => ({ ...a })),
    attempts: (initialState.attempts || []).map((a) => ({ ...a })),
    notifications: [],
    commits: 0,
    rollbacks: 0
  };

  const makeConn = () => ({
    async beginTransaction() {},
    async commit() { state.commits++; },
    async rollback() { state.rollbacks++; },
    release() {},
    async query(sql, args = []) {
      if (sql.includes('FROM collective_payment_holds ch') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        const limit = Number(args[0]) || 100;
        const rows = state.holds
          .filter((h) => h.expired === true && ['ACTIVE', 'PAYMENT_PENDING'].includes(h.payment_hold_status))
          .slice(0, limit)
          .map((h) => ({ ...h }));
        return [rows];
      }
      if (sql.includes('FROM collective_payment_holds WHERE order_id = ? FOR UPDATE')) {
        const row = state.holds.find((h) => Number(h.order_id) === Number(args[0]));
        return [row ? [{ ...row, is_open: row.expired ? 0 : 1 }] : []];
      }
      if (sql.includes("FROM payment_attempts WHERE order_id = ? AND status IN ('INITIATED','RECONCILIATION_REQUIRED')")) {
        const rows = state.attempts.filter(
          (a) => Number(a.order_id) === Number(args[0]) && ['INITIATED', 'RECONCILIATION_REQUIRED'].includes(a.status)
        );
        return [rows.map((r) => ({ id: r.id }))];
      }
      if (sql.startsWith("UPDATE collective_payment_holds SET payment_hold_status = 'COMMITTED'")) {
        const h = state.holds.find((x) => Number(x.id) === Number(args[0]));
        if (h) h.payment_hold_status = 'COMMITTED';
        return [{ affectedRows: h ? 1 : 0 }];
      }
      if (sql.startsWith("UPDATE collective_payment_holds SET payment_hold_status = 'RECONCILIATION_REQUIRED'")) {
        const h = state.holds.find((x) => Number(x.id) === Number(args[0]));
        if (h) h.payment_hold_status = 'RECONCILIATION_REQUIRED';
        return [{ affectedRows: h ? 1 : 0 }];
      }
      if (sql.includes('UPDATE supplier_inventory_allocations SET status = \'RELEASED\'')) {
        let count = 0;
        for (const a of state.allocations) {
          if (a.allocation_type === 'ORDER_DIRECT' && Number(a.reference_id) === Number(args[0]) && a.status === 'PENDING') {
            a.status = 'RELEASED';
            count++;
          }
        }
        return [{ affectedRows: count }];
      }
      if (sql.includes("SET payment_hold_status = 'RELEASED'")) {
        const reason = args[0];
        const id = Number(args[1]);
        const h = state.holds.find(
          (x) => Number(x.id) === id && ['ACTIVE', 'PAYMENT_PENDING', 'RECONCILIATION_REQUIRED'].includes(x.payment_hold_status)
        );
        if (h) {
          h.payment_hold_status = 'RELEASED';
          h.payment_hold_release_reason = reason;
          return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 0 }];
      }
      throw new Error('Unexpected SQL in mock DB: ' + sql);
    }
  });

  const notifier = {
    async enqueueEvent(_conn, event) {
      if (!state.notifications.some((n) => n.eventKey === event.eventKey)) {
        state.notifications.push({ ...event });
      }
      return { queued: true };
    }
  };

  return {
    state,
    db: { getConnection: async () => makeConn() },
    notifier
  };
}

test('Phase F.1: Four buyers, all paid -> GROUP_FULLY_FUNDED and dispatchable', () => {
  const res = evaluateHybridGroupOutcome({
    buyers: [
      { buyer_id: 1, quantity: '25.0000', payment_status: 'PAID', hold_status: 'COMMITTED' },
      { buyer_id: 2, quantity: '25.0000', payment_status: 'PAID', hold_status: 'COMMITTED' },
      { buyer_id: 3, quantity: '25.0000', payment_status: 'PAID', hold_status: 'COMMITTED' },
      { buyer_id: 4, quantity: '25.0000', payment_status: 'PAID', hold_status: 'COMMITTED' }
    ],
    supplierMoqQty: '75.0000',
    agreedUnitPrice: '100.00',
    applicableUnitPriceForPaidQty: '100.00'
  });
  assert.equal(res.outcome, 'GROUP_FULLY_FUNDED');
  assert.equal(res.can_dispatch, true);
  assert.equal(res.requires_refund_review, false);
  assert.equal(res.paid_total_qty, '100.0000');
});

test('Phase F.2: Three paid + one unpaid expiry releases ONLY unpaid PENDING allocation and keeps paid COMMITTED', async () => {
  const mock = createMockDb({
    holds: [
      { id: 1, order_id: 101, group_id: 10, buyer_id: 1, payment_hold_status: 'COMMITTED', payment_status: 'PAID', expired: false },
      { id: 2, order_id: 102, group_id: 10, buyer_id: 2, payment_hold_status: 'COMMITTED', payment_status: 'PAID', expired: false },
      { id: 3, order_id: 103, group_id: 10, buyer_id: 3, payment_hold_status: 'COMMITTED', payment_status: 'PAID', expired: false },
      { id: 4, order_id: 104, group_id: 10, buyer_id: 4, payment_hold_status: 'ACTIVE', payment_status: 'AWAITING_PAYMENT', expired: true }
    ],
    allocations: [
      { id: 11, allocation_type: 'ORDER_DIRECT', reference_id: 101, status: 'COMMITTED' },
      { id: 12, allocation_type: 'ORDER_DIRECT', reference_id: 102, status: 'COMMITTED' },
      { id: 13, allocation_type: 'ORDER_DIRECT', reference_id: 103, status: 'COMMITTED' },
      { id: 14, allocation_type: 'ORDER_DIRECT', reference_id: 104, status: 'PENDING' }
    ]
  });
  const svc = new CollectivePaymentHoldService(mock.db, mock.notifier);

  const first = await svc.processExpiredBatch(100);
  assert.equal(first.checked, 1);
  assert.equal(first.released, 1);
  assert.equal(mock.state.allocations.find((a) => a.reference_id === 101).status, 'COMMITTED');
  assert.equal(mock.state.allocations.find((a) => a.reference_id === 103).status, 'COMMITTED');
  assert.equal(mock.state.allocations.find((a) => a.reference_id === 104).status, 'RELEASED');
  assert.equal(mock.state.notifications.length, 1);
  assert.equal(mock.state.notifications[0].eventType, 'PAYMENT_FAILED');
  assert.equal(mock.state.notifications[0].userId, 4);
});

test('Phase F.5: Paid buyer hold expiry attempt is protected and marked COMMITTED rather than released', async () => {
  const mock = createMockDb({
    holds: [
      { id: 3, order_id: 103, group_id: 10, buyer_id: 3, payment_hold_status: 'ACTIVE', payment_status: 'PAID', expired: true }
    ],
    allocations: [
      { id: 13, allocation_type: 'ORDER_DIRECT', reference_id: 103, status: 'COMMITTED' }
    ]
  });
  const svc = new CollectivePaymentHoldService(mock.db, mock.notifier);
  const res = await svc.processExpiredBatch(100);
  assert.equal(res.checked, 1);
  assert.equal(res.committed, 1);
  assert.equal(res.released, 0);
  assert.equal(mock.state.holds[0].payment_hold_status, 'COMMITTED');
  assert.equal(mock.state.allocations[0].status, 'COMMITTED');
});

test('Phase F.9: Duplicate expiry worker execution is idempotent with zero double release or duplicate notification', async () => {
  const mock = createMockDb({
    holds: [
      { id: 4, order_id: 104, group_id: 10, buyer_id: 4, payment_hold_status: 'ACTIVE', payment_status: 'AWAITING_PAYMENT', expired: true }
    ],
    allocations: [
      { id: 14, allocation_type: 'ORDER_DIRECT', reference_id: 104, status: 'PENDING' }
    ]
  });
  const svc = new CollectivePaymentHoldService(mock.db, mock.notifier);
  const first = await svc.processExpiredBatch(100);
  assert.equal(first.released, 1);
  assert.equal(mock.state.notifications.length, 1);

  const second = await svc.processExpiredBatch(100);
  assert.equal(second.checked, 0);
  assert.equal(second.released, 0);
  assert.equal(mock.state.notifications.length, 1);
});

test('Phase F.3: Unpaid buyer with INITIATED payment is NEVER released, moves to RECONCILIATION_REQUIRED', async () => {
  const mock = createMockDb({
    holds: [
      { id: 4, order_id: 104, group_id: 10, buyer_id: 4, payment_hold_status: 'PAYMENT_PENDING', payment_status: 'PAYMENT_INITIATED', expired: true }
    ],
    allocations: [
      { id: 14, allocation_type: 'ORDER_DIRECT', reference_id: 104, status: 'PENDING' }
    ],
    attempts: [
      { id: 99, order_id: 104, status: 'INITIATED' }
    ]
  });
  const svc = new CollectivePaymentHoldService(mock.db, mock.notifier);
  const res = await svc.processExpiredBatch(100);
  assert.equal(res.reconciliation_required, 1);
  assert.equal(res.released, 0);
  assert.equal(mock.state.holds[0].payment_hold_status, 'RECONCILIATION_REQUIRED');
  assert.equal(mock.state.allocations[0].status, 'PENDING');
  assert.equal(mock.state.notifications.length, 0);
});

test('Phase F.4: Unpaid buyer with uncertain provider result moves to RECONCILIATION_REQUIRED without releasing', async () => {
  const mock = createMockDb({
    holds: [
      { id: 4, order_id: 104, group_id: 10, buyer_id: 4, payment_hold_status: 'PAYMENT_PENDING', payment_status: 'PAYMENT_INITIATED', expired: false }
    ],
    allocations: [
      { id: 14, allocation_type: 'ORDER_DIRECT', reference_id: 104, status: 'PENDING' }
    ]
  });
  const svc = new CollectivePaymentHoldService(mock.db, mock.notifier);
  const conn = await mock.db.getConnection();
  const res = await svc.markFailed(conn, 104, { uncertain: true });
  assert.equal(res.status, 'RECONCILIATION_REQUIRED');
  assert.equal(mock.state.allocations[0].status, 'PENDING');
  assert.equal(mock.state.notifications.length, 0);
});

test('Phase F.6: MOQ satisfied after one buyer fails and price unchanged -> ELIGIBLE_TO_CONTINUE', () => {
  const res = evaluateHybridGroupOutcome({
    buyers: [
      { buyer_id: 1, quantity: '30.0000', payment_status: 'PAID', hold_status: 'COMMITTED' },
      { buyer_id: 2, quantity: '30.0000', payment_status: 'PAID', hold_status: 'COMMITTED' },
      { buyer_id: 3, quantity: '30.0000', payment_status: 'PAID', hold_status: 'COMMITTED' },
      { buyer_id: 4, quantity: '30.0000', payment_status: 'AWAITING_PAYMENT', hold_status: 'RELEASED' }
    ],
    supplierMoqQty: '80.0000',
    agreedUnitPrice: '100.00',
    applicableUnitPriceForPaidQty: '100.00'
  });
  assert.equal(res.outcome, 'ELIGIBLE_TO_CONTINUE');
  assert.equal(res.can_dispatch, true);
  assert.equal(res.requires_refund_review, false);
});

test('Phase F.7: MOQ NOT satisfied after one buyer fails -> GROUP_CANCELLED_MOQ_UNMET with verified refund review (not fabricated)', () => {
  const res = evaluateHybridGroupOutcome({
    buyers: [
      { buyer_id: 1, quantity: '20.0000', payment_status: 'PAID', hold_status: 'COMMITTED' },
      { buyer_id: 2, quantity: '20.0000', payment_status: 'PAID', hold_status: 'COMMITTED' },
      { buyer_id: 3, quantity: '20.0000', payment_status: 'PAID', hold_status: 'COMMITTED' },
      { buyer_id: 4, quantity: '20.0000', payment_status: 'AWAITING_PAYMENT', hold_status: 'RELEASED' }
    ],
    supplierMoqQty: '75.0000',
    agreedUnitPrice: '100.00',
    applicableUnitPriceForPaidQty: '100.00'
  });
  assert.equal(res.outcome, 'GROUP_CANCELLED_MOQ_UNMET');
  assert.equal(res.can_dispatch, false);
  assert.equal(res.requires_refund_review, true);
});

test('Phase F.8: Price tier changes after one buyer fails -> PRICE_APPROVAL_REQUIRED until buyers approve', () => {
  const buyers = [
    { buyer_id: 1, quantity: '30.0000', payment_status: 'PAID', hold_status: 'COMMITTED' },
    { buyer_id: 2, quantity: '30.0000', payment_status: 'PAID', hold_status: 'COMMITTED' },
    { buyer_id: 3, quantity: '30.0000', payment_status: 'PAID', hold_status: 'COMMITTED' },
    { buyer_id: 4, quantity: '30.0000', payment_status: 'AWAITING_PAYMENT', hold_status: 'RELEASED' }
  ];
  const unapproved = evaluateHybridGroupOutcome({
    buyers,
    supplierMoqQty: '80.0000',
    agreedUnitPrice: '100.00',
    applicableUnitPriceForPaidQty: '110.00',
    buyersApprovedRevisedPrice: false
  });
  assert.equal(unapproved.outcome, 'PRICE_APPROVAL_REQUIRED');
  assert.equal(unapproved.can_dispatch, false);

  const approved = evaluateHybridGroupOutcome({
    buyers,
    supplierMoqQty: '80.0000',
    agreedUnitPrice: '100.00',
    applicableUnitPriceForPaidQty: '110.00',
    buyersApprovedRevisedPrice: true
  });
  assert.equal(approved.outcome, 'ELIGIBLE_TO_CONTINUE');
  assert.equal(approved.can_dispatch, true);
});

test('Phase F.10: Dispatch attempt while group funding is incomplete is blocked with GROUP_FUNDING_INCOMPLETE', () => {
  assert.throws(
    () =>
      assertGroupFunding(4, [
        { status: 'ORDERED', payment_status: 'PAID' },
        { status: 'ORDERED', payment_status: 'PAID' },
        { status: 'ORDERED', payment_status: 'PAID' },
        { status: 'ORDERED', payment_status: 'AWAITING_PAYMENT' }
      ]),
    (err) => err.code === 'GROUP_FUNDING_INCOMPLETE' && err.statusCode === 409
  );
});

test('Phase G: Notification consolidation preserves UCP + Smart Hub + PR #61 events and mandatory validation', () => {
  for (const required of [
    'PAYMENT_FAILED',
    'REFUND_ASSESSED',
    'REFUND_APPROVED',
    'SUBSCRIPTION_ACTIVATED',
    'VERIFICATION_SUBMITTED',
    'UCP.POOL_FAILED',
    'PAYMENT.CONFIRMED',
    'DISPUTE.OPENED'
  ]) {
    assert.ok(eventTypes.includes(required), `Missing event type: ${required}`);
    assert.equal(mandatory(required), true, `Event must be mandatory: ${required}`);
    const proj = eventProjection({ eventType: required, entityId: 42, locale: 'ur' });
    assert.ok(proj.title.length > 0);
    assert.equal(proj.mandatory, true);
  }
});
