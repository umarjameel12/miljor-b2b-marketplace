'use strict';
// Runs real service actions and notification capture with in-memory SQL only.
// No application DB config, adapter, scheduler or provider module is loaded.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const services = path.resolve(__dirname, '../src/services');

function load(name, dependencies) {
  const filename = path.join(services, name + '.js');
  const module = { exports: {} };
  const localRequire = id => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    if (id === 'crypto' || id === 'node:crypto') return require(id);
    if (id === './collectivePaymentHoldService') return { markPaid: async () => ({ handled: false }), markFailed: async () => ({ handled: false }) };
    if (id === './safepayV3ContractService') return require(path.join(services, id));
    if (['./exactDecimal', './notificationEventPolicy', './notificationDeliveryPolicy', './ucpNotificationEventCatalog', './supplierEligibilityPolicy'].includes(id)) {
      return require(path.join(services, id));
    }
    throw Error('Unmocked dependency: ' + id);
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: localRequire, module, exports: module.exports, console, process, Buffer }, { filename });
  return module.exports;
}

function fixture(options = {}) {
  let order = { id: 42, order_code: 'ORD-00000042', buyer_id: 7, supplier_id: 8,
    order_status: 'AWAITING_PAYMENT', payment_status: 'PAYMENT_INITIATED',
    fulfillment_status: 'DISPATCHED', total_amount: '100.00', subtotal_amount: '100.00',
    total_qty: '10', unit_price: '10.00', currency: 'PKR', captured_amount: '100.00', payment_row_id: 11,
    ...options.order };
  let dispute = { id: 21, order_id: 42, buyer_id: 999, supplier_id: 998, status: 'OPEN', remediation_status: 'NONE', ...options.dispute };
  const attempt = { id: 12, order_id: 42, provider_tracker_token: 'track_test', status: 'INITIATED' };
  const payable = { id: 31, order_id: 42, supplier_id: 998, payment_id: 11, order_code: order.order_code,
    fulfillment_status: 'BUYER_CONFIRMED', supplier_user_verified: 1, supplier_profile_status: 'VERIFIED',
    held_amount: '0.00', available_amount: '100.00', ...options.payable };
  let notices = [], staged = [], snapshot, active = false, commits = 0, rollbacks = 0, captures = 0, refund, disbursement, opened = false;
  const trace = [];
  const connection = {
    async beginTransaction() { assert.equal(active, false); active = true; staged = []; snapshot = { order: { ...order }, dispute: { ...dispute }, refund, disbursement, opened }; trace.push('begin'); },
    async commit() { assert.equal(active, true); notices.push(...staged); staged = []; active = false; commits++; trace.push('commit'); },
    async rollback() { if (snapshot) { ({ order, dispute, refund, disbursement, opened } = snapshot); } staged = []; active = false; rollbacks++; trace.push('rollback'); },
    release() { trace.push('release'); },
    async query(sql, args = []) {
      const q = sql.replace(/\s+/g, ' ').trim(); trace.push(q);
      if (q.startsWith('SET TRANSACTION')) return [[], []];
      if (q === 'SELECT id,role FROM users WHERE id=?') return [[{ id: args[0], role: args[0] === 7 ? 'BUYER' : 'SUPPLIER' }]];
      if (q.startsWith('INSERT INTO procurement_notifications')) {
        assert.equal(active, true, 'notification must share action transaction');
        captures++;
        if (options.failOutbox === true || options.failOutbox === captures) throw Error('outbox unavailable');
        if (![...notices, ...staged].some(n => n[0] === args[0] && n[2] === args[2])) staged.push(args);
        return [{ insertId: 1 }];
      }
      if (q.includes('FROM users u')) return [[{ id: 8, role: 'SUPPLIER', is_verified: 1, verification_status: 'VERIFIED', profile_verification_status: 'VERIFIED' }]];
      if (q.includes('FROM orders')) return [[{ ...order }]];
      if (q.includes('FROM collective_payment_holds')) return [[]];
      if (q.includes('FROM payment_attempts')) return [[attempt]];
      if (q.includes('FROM payment_webhook_events')) return [[]];
      if (q.includes('FROM payments')) return [[{ id: 11 }]];
      if (q.includes('FROM procurement_award_lines')) return [[{ line_count: 0 }]];
      if (q.includes('FROM order_disputes')) {
        if (q.includes('COUNT(*)')) return [[{ activeCount: 0 }]];
        if (q.includes('idempotency_key')) return [opened ? [{ ...dispute, buyer_id: 7, supplier_id: 8 }] : []];
        if (q.includes('WHERE id = ?')) return [[{ ...dispute }]];
        return [[]];
      }
      if (q.includes('FROM refund_obligations')) {
        if (q.includes('SUM(')) return [[{ total_refunded: '0.00' }]];
        return [refund ? [refund] : []];
      }
      if (q.includes('FROM supplier_payables')) return [options.withPayable || q.includes('WHERE sp.id') ? [payable] : []];
      if (q.includes('FROM supplier_disbursement_instructions')) return [disbursement ? [disbursement] : []];
      if (q.startsWith('INSERT INTO order_disputes')) { opened = true; return [{ insertId: 21 }]; }
      if (q.startsWith('INSERT INTO refund_obligations')) {
        refund = { id: 51, order_id: args[1], buyer_id: args[3], dispute_id: args[4], refund_type: args[9], total_refund_amount: args[8], status: args[10] };
        return [{ insertId: 51 }];
      }
      if (q.startsWith('INSERT INTO supplier_disbursement_instructions')) { disbursement = { id: 61, order_id: args[3], supplier_payable_id:args[2],payment_id: 11, amount:args[7],beneficiary_title:args[4],beneficiary_iban:args[5],beneficiary_bank_code:args[6],idempotency_key:args[8],external_execution_status:'DISABLED',status: 'PREPARED' }; return [{ insertId: 61 }]; }
      if (q.startsWith('UPDATE orders') && q.includes("payment_status = 'PAID'")) order.order_status = order.payment_status = 'PAID';
      if (q.startsWith('UPDATE order_disputes') && q.includes("status = 'CLOSED'")) dispute.status = 'CLOSED';
      if (q.startsWith('UPDATE order_disputes') && q.includes("remediation_status = 'COMPLETED'")) { dispute.status = 'SUPPLIER_REMEDIATION_COMPLETED'; dispute.remediation_status = 'COMPLETED'; }
      if (/^(INSERT INTO|UPDATE) (orders|order_disputes|order_dispute_events|payments|payment_attempts|payment_webhook_events|reservation_business_events|system_audit_logs|financial_audit_events|supplier_payables|refund_obligations|supplier_disbursement_instructions)\b/.test(q)) return [{ affectedRows: 1, insertId: 11 }];
      throw Error('Unexpected SQL: ' + q);
    }
  };
  const database = { getConnection: async () => connection, query: (...args) => connection.query(...args) };
  const notification = load('notificationService', { '../config/db': database });
  const lifecycle = { claimCheckout: async () => {}, assertCanCreateFreshCheckout: async () => {}, markPaid: async () => {}, reconcilePaidOrder: async () => {}, releaseCheckoutClaim: async () => {} };
  const adapter = {
    verifyWebhookSignature: () => options.authentic !== false,
    verifyWebhookSignatureScope: () => options.authentic !== false ? 'raw_body' : null,
    fetchTracker: async () => ({ data: { token: 'track_test', state: options.providerState || 'PAID', currency: options.currency || 'PKR', amount: options.amount || '100.00', transaction: { token: 'txn_test' } } })
  };
  const dependencies = { '../config/db': database, './notificationService': notification,
    './reservationEventService': { generateEventId: () => 'business-event' }, './feeService': {},
    './safepayAdapter': adapter, './procurementAwardService': lifecycle,
    './regularPoolPaymentHoldService': lifecycle, './flashPoolService': lifecycle,
    './invoiceService': { generateInvoiceForOrder: async () => {} } };
  dependencies['./ucpTransactionalNotifications']=load('ucpTransactionalNotifications',dependencies);
  return { checkout: load('safepayCheckoutService', dependencies), disputes: load('disputeService', dependencies),
    finance: load('financialSettlementService', dependencies), notices: () => notices,
    order: () => order, dispute: () => dispute, trace, commits: () => commits, rollbacks: () => rollbacks };
}
const buyer = { id: 7, role: 'BUYER' }, supplier = { id: 8, role: 'SUPPLIER' }, admin = { id: 90, role: 'ADMIN' };
const webhook = (extra = {}) => ({ rawBody: JSON.stringify({ type: extra.eventType || 'payment.succeeded', data: { tracker: 'track_test', amount: 100, currency: 'PKR' } }), signature: 'mocked-signature', timestamp: '1', eventId: 'delivery-one', ...extra });
const openBuyer = (s, extra = {}) => s.disputes.createBuyerDispute({ orderId: 42, actor: buyer, category: 'DAMAGED_GOODS', description: 'Goods arrived damaged', disputedQuantity: 1, idempotencyKey: 'http-open', ...extra });
const close = (s, key = 'http-close') => s.disputes.closeDispute({ disputeId: 21, actor: admin, closureReason: 'Case reviewed and closed', idempotencyKey: key });
const assess = (s, key = 'http-refund') => s.finance.assessRefundObligation({ orderId: 42, actor: buyer, refundType: 'FULL', reason: 'Order refund requested', idempotencyKey: key });
const prepare = (s, key = 'http-payout') => s.finance.prepareSupplierDisbursement({ payableId: 31, beneficiaryTitle: 'Supplier bank account', beneficiaryIban: 'PK' + '1'.repeat(22), actor: admin, idempotencyKey: key });
function expectEvents(s, type, key, recipients) {
  // SQL parameters originate in an isolated VM; compare values in this realm.
  assert.deepEqual(s.notices().map(n => Array.from(n).slice(0, 4)), recipients.map(([id, role]) => [id, role, key, type]));
  for (const n of s.notices()) assert.deepEqual(JSON.parse(n[4]), { entityId: 42, schemaVersion: 1 });
}

for (const mode of ['webhook', 'reconciliation']) {
  const pay = (s, extra) => mode === 'webhook' ? s.checkout.processWebhookEvent(webhook(extra)) : s.checkout.reconcilePaymentWithProvider({ orderId: 42, actor: buyer });
  test(mode + ' captures verified payment on same connection and replays without another notification', async () => {
    const s = fixture(); await pay(s);
    expectEvents(s, 'PAYMENT_VERIFIED', 'order:42:payment:verified', [[7, 'BUYER'], [8, 'SUPPLIER']]);
    await pay(s, { eventId: 'another-http-delivery' }); assert.equal(s.notices().length, 2);
  });
  test(mode + ' rolls back payment and outbox together on capture failure', async () => {
    const s = fixture({ failOutbox: true }); await assert.rejects(pay(s), /outbox unavailable/);
    assert.equal(s.commits(), 0); assert.equal(s.rollbacks(), 1); assert.equal(s.order().payment_status, 'PAYMENT_INITIATED'); assert.equal(s.notices().length, 0);
  });
  test(mode + ' amount mismatch produces no verified or failed notification', async () => {
    const s = fixture({ amount: '99.00', order: mode === 'webhook' ? { total_amount: '99.00' } : {} });
    await assert.rejects(pay(s), { code: 'AMOUNT_MISMATCH' }); assert.equal(s.notices().length, 0);
  });
  test(mode + ' currency mismatch produces no notification', async () => {
    const s = fixture({ currency: 'USD', order: mode === 'webhook' ? { currency: 'USD' } : {} });
    await assert.rejects(pay(s), { code: 'CURRENCY_MISMATCH' }); assert.equal(s.notices().length, 0);
  });
}
test('webhook and server reconciliation share payment identity across delivery mechanisms', async () => {
  const s = fixture(); await s.checkout.processWebhookEvent(webhook());
  await s.checkout.reconcilePaymentWithProvider({ orderId: 42, actor: buyer });
  expectEvents(s, 'PAYMENT_VERIFIED', 'order:42:payment:verified', [[7, 'BUYER'], [8, 'SUPPLIER']]);
});
test('invalid webhook signature and non-success event never notify', async () => {
  const bad = fixture({ authentic: false }); await assert.rejects(bad.checkout.processWebhookEvent(webhook()), { code: 'INVALID_WEBHOOK_SIGNATURE' }); assert.equal(bad.notices().length, 0);
  const failed = fixture(); await failed.checkout.processWebhookEvent(webhook({ eventType: 'payment.failed' })); assert.equal(failed.notices().length, 0);
});
test('authenticated success without explicit currency cannot fabricate PKR verification',async()=>{
 const s=fixture();await assert.rejects(s.checkout.processWebhookEvent(webhook({rawBody:JSON.stringify({type:'payment.succeeded',data:{tracker:'track_test',amount:100}})})),{code:'CURRENCY_MISMATCH'});assert.equal(s.notices().length,0);assert.equal(s.commits(),0);
});
test('provider pending and foreign buyer never notify', async () => {
  const s = fixture({ providerState: 'PENDING' }); await s.checkout.reconcilePaymentWithProvider({ orderId: 42, actor: buyer }); assert.equal(s.notices().length, 0);
  await assert.rejects(s.checkout.reconcilePaymentWithProvider({ orderId: 42, actor: { id: 99, role: 'BUYER' } }), { code: 'FORBIDDEN' }); assert.equal(s.notices().length, 0);
});
test('buyer dispute open captures both order owners and replay does not duplicate', async () => {
  const s = fixture({ order: { payment_status: 'PAID' } }); await openBuyer(s);
  expectEvents(s, 'DISPUTE_OPENED', 'dispute:21:opened', [[7, 'BUYER'], [8, 'SUPPLIER']]);
  await openBuyer(s); assert.equal(s.notices().length, 2);
});
test('supplier shortage opening captures both order owners', async () => {
  const s = fixture({ order: { payment_status: 'PAID' } });
  await s.disputes.createSupplierShortageException({ orderId: 42, actor: supplier, shortageQuantity: 1, description: 'One unit missing', idempotencyKey: 'supplier-open' });
  expectEvents(s, 'DISPUTE_OPENED', 'dispute:21:opened', [[7, 'BUYER'], [8, 'SUPPLIER']]);
});
test('dispute closure uses order recipients, not actor or stale dispute recipients; changed key replay does not duplicate', async () => {
  const s = fixture(); await close(s);
  expectEvents(s, 'DISPUTE_RESOLVED', 'dispute:21:resolved', [[7, 'BUYER'], [8, 'SUPPLIER']]);
  await close(s, 'different-http-key'); assert.equal(s.notices().length, 2);
});
test('buyer-confirmed remediation and subsequent closure share a single resolution identity', async () => {
  const s = fixture({ dispute: { buyer_id: 7, remediation_status: 'IN_PROGRESS' } });
  await s.disputes.confirmBuyerRemediationReceipt({ disputeId: 21, actor: buyer, idempotencyKey: 'receipt' });
  expectEvents(s, 'DISPUTE_RESOLVED', 'dispute:21:resolved', [[7, 'BUYER'], [8, 'SUPPLIER']]);
  await close(s); assert.equal(s.notices().length, 2);
});
test('admin decision still requiring resolution never announces resolved', async () => {
  const s = fixture(); await s.disputes.recordAdminDecision({ disputeId: 21, actor: admin, decision: 'FINANCIAL_REVIEW_REQUIRED', decisionReason: 'Needs financial review', idempotencyKey: 'decision' }); assert.equal(s.notices().length, 0);
});
test('refund obligation initiation notifies buyer only, replay keeps identity and never announces completion', async () => {
  const s = fixture(); await assess(s);
  expectEvents(s, 'PAYMENT.REFUND_REQUESTED', 'refund:51:requested', [[7, 'BUYER']]);
  await assess(s); assert.equal(s.notices().length, 1);
});
test('prepared payout notifies actual order supplier as pending only and replay does not duplicate', async () => {
  const s = fixture(); await prepare(s);
  expectEvents(s, 'SETTLEMENT_PENDING', 'disbursement:61:pending', [[8, 'SUPPLIER']]);
  await prepare(s); assert.equal(s.notices().length, 1);
});
test('active hold blocks preparation and produces no settlement notification', async () => {
  const s = fixture({ payable: { held_amount: '10.00' } });
  await assert.rejects(prepare(s), { code: 'PAYABLE_HAS_ACTIVE_HOLDS' }); assert.equal(s.notices().length, 0); assert.equal(s.commits(), 0);
});
test('internal refund and disbursement approval cannot announce completed money movement', async () => {
  const refund = fixture(); await assess(refund);
  expectEvents(refund, 'PAYMENT.REFUND_REQUESTED', 'refund:51:requested', [[7, 'BUYER']]);
  await refund.finance.approveRefundObligation({ refundId: 51, actor: admin });
  assert.equal(refund.notices().length,3);
  const approvals=refund.notices().slice(1);
  assert.deepEqual(approvals.map(n=>[n[0],n[1],n[3]]),[[7,'BUYER','PAYMENT.REFUND_APPROVED'],[8,'SUPPLIER','PAYMENT.REFUND_APPROVED']]);
  assert.equal(approvals[0][2],approvals[1][2],'both owners share the approved transition identity');
  assert.ok(refund.notices().every(n=>!['REFUND_COMPLETED','PAYMENT.REFUND_SUCCEEDED'].includes(n[3])));
  const payout = fixture(); await prepare(payout);
  await payout.finance.approveSupplierDisbursement({ disbursementId: 61, actor: admin });
  expectEvents(payout, 'SETTLEMENT_PENDING', 'disbursement:61:pending', [[8, 'SUPPLIER']]);
});
test('second-recipient failure discards first-recipient capture and verified payment mutation', async () => {
  const s = fixture({ failOutbox: 2 });
  await assert.rejects(s.checkout.processWebhookEvent(webhook()), /outbox unavailable/);
  assert.equal(s.notices().length, 0); assert.equal(s.order().payment_status, 'PAYMENT_INITIATED'); assert.equal(s.commits(), 0); assert.equal(s.rollbacks(), 1);
});
for (const [name, action, options] of [
  ['dispute opening', openBuyer, { order: { payment_status: 'PAID' } }],
  ['dispute closure', close, {}], ['refund initiation', assess, {}], ['payout preparation', prepare, {}]
]) test(name + ' rolls back on notification failure', async () => {
  const s = fixture({ ...options, failOutbox: true }); await assert.rejects(action(s), /outbox unavailable/);
  assert.equal(s.commits(), 0); assert.equal(s.rollbacks(), 1); assert.equal(s.notices().length, 0);
});
test('foreign buyer and incomplete remediation cannot publish financial notifications', async () => {
  const s = fixture({ order: { buyer_id: 99, payment_status: 'PAID' }, dispute: { remediation_status: 'PROPOSED' } });
  await assert.rejects(openBuyer(s), { code: 'FORBIDDEN' }); await assert.rejects(assess(s), { code: 'FORBIDDEN' });
  await assert.rejects(close(s), { code: 'REMEDIATION_INCOMPLETE' }); assert.equal(s.notices().length, 0);
});
test('manual refund and settlement confirmation remain blocked without any event', async () => {
  const s = fixture(); await assert.rejects(s.finance.recordManualConfirmedRefund({ actor: admin }), { code: 'PROVIDER_REFUND_VERIFICATION_REQUIRED' });
  await assert.rejects(s.finance.reconcileProviderSettlementBatch({ actor: admin }), { code: 'PROVIDER_SETTLEMENT_EVIDENCE_REQUIRED' }); assert.equal(s.notices().length, 0); assert.equal(s.commits(), 0);
});
