'use strict';

// Load the real service with isolated dependencies; never load config/db or a provider.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const {eventProjection} = require('../src/services/notificationEventPolicy');

function harness(overrides = {}, options = {}) {
  const order = {id:41, order_code:'ORD-41', buyer_id:7, supplier_id:19,
    payment_status:'PAID', fulfillment_status:'PREPARING', total_qty:'10.0000',
    pool_id:null, reservation_id:null, delivery_type:'DOORSTEP', ...overrides};
  const calls = [];
  let notices = [];
  const connection = {
    async query(sql, args) {
      calls.push({sql, args});
      if (sql === 'SELECT id,role FROM users WHERE id=?') return [[{id:args[0], role:args[0] === 7 ? 'BUYER' : 'SUPPLIER'}]];
      if (sql.includes('FROM users u')) return [[{id:19, role:'SUPPLIER', is_verified:1,
        verification_status:'VERIFIED', profile_verification_status:'VERIFIED'}]];
      if (sql.includes('FROM orders WHERE') || sql.includes('FROM orders WHERE id = ?')) return [[{ ...order, admin_approval_status: 'ADMIN_APPROVED' }]];
      if (sql.includes('SELECT * FROM order_fulfillment_events')) return [options.replay ? [{id:93}] : []];
      if (sql.includes('FROM order_disputes')) return [[{activeCount:options.disputes || 0}]];
      if (sql.includes('FROM procurement_award_lines')) return [[{line_count:options.lines || 0}]];
      if (/^(SET TRANSACTION|UPDATE orders|UPDATE pools|INSERT INTO order_fulfillment_events|INSERT INTO reservation_business_events)/.test(sql.trim())) {
        if (options.failMilestone && sql.includes('INSERT INTO order_fulfillment_events')) throw Error('milestone failed');
        return [{affectedRows:1, insertId:93}];
      }
      throw Error('Unexpected SQL: ' + sql);
    },
    async beginTransaction() { calls.push({sql:'BEGIN'}); },
    async commit() { calls.push({sql:'COMMIT'}); },
    async rollback() { calls.push({sql:'ROLLBACK'}); notices = []; },
    release() { calls.push({sql:'RELEASE'}); }
  };
  const deps = {
    crypto,
    '../config/db': {getConnection:async () => connection},
    './reservationEventService': {generateEventId:() => 'legacy-event'},
    './supplierEligibilityPolicy': require('../src/services/supplierEligibilityPolicy'),
    './deliveryQuantityPolicy': require('../src/services/deliveryQuantityPolicy'),
    './orderAdminApprovalService': { assertOrderAdminApproved: async (_conn, id) => ({ id, admin_approval_status: 'ADMIN_APPROVED' }) },
    './notificationService': {async enqueueEvent(tx, event) {
      assert.equal(tx, connection);
      assert.deepEqual(Object.keys(event).sort(), ['entityId','eventKey','eventType','role','userId']);
      eventProjection(event);
      assert.equal(calls.some(c => c.sql === 'COMMIT'), false);
      assert.ok(calls.some(c => c.sql.includes('INSERT INTO order_fulfillment_events')));
      calls.push({sql:'ENQUEUE', event});
      if (options.failNotice === calls.filter(c => c.sql === 'ENQUEUE').length) throw Error('outbox failed');
      notices.push({...event});
      return [{affectedRows:1}];
    }}
  };
  const adapterFile = path.join(__dirname, '../src/services/ucpTransactionalNotifications.js');
  const adapterContext = {module:{exports:{}}, require(name) {
    if (name === './notificationService') return deps[name];
    if (name === './ucpNotificationEventCatalog') return require('../src/services/ucpNotificationEventCatalog');
    throw Error('Unexpected adapter dependency: ' + name);
  }};
  vm.runInNewContext(fs.readFileSync(adapterFile, 'utf8'), adapterContext, {filename:adapterFile});
  deps['./ucpTransactionalNotifications'] = adapterContext.module.exports;
  const filename = path.join(__dirname, '../src/services/fulfillmentService.js');
  const context = {module:{exports:{}}, require(name) {
    if (!Object.hasOwn(deps, name)) throw Error('Unexpected dependency: ' + name);
    return deps[name];
  }};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, {filename});
  return {service:context.module.exports, calls, get notices() { return notices; }};
}

const supplier = {id:19, role:'SUPPLIER'};
const buyer = {id:7, role:'BUYER'};
const base = {orderId:41, idempotencyKey:' hook-key '};
function transition(h, toStatus, extra = {}) {
  return h.service.transitionSupplierFulfillment({...base, actor:supplier, toStatus,
    deliveryMethod:'SUPPLIER_FLEET', ...extra});
}
function exception(h, reason, extra = {}) {
  return h.service.recordSupplierFulfillmentException({...base, actor:supplier, reason,
    description:'Recorded delivery issue', ...extra});
}
function discrepancy(h, reason = 'QUANTITY_MISMATCH', extra = {}) {
  return h.service.reportBuyerDiscrepancy({...base, actor:buyer, reason,
    reportedQuantity:'4.0000', description:'Recorded receipt issue', ...extra});
}
function receipt(h, extra = {}) {
  return h.service.confirmBuyerReceipt({...base, actor:buyer, ...extra});
}
function expectNotices(h, eventType, action) {
  assert.equal(h.notices.length, 2);
  const hash = crypto.createHash('sha256').update(`41:${action}:hook-key`).digest('hex').slice(0,20);
  for (const [index, [userId, role]] of [[7,'BUYER'], [19,'SUPPLIER']].entries()) {
    assert.deepEqual(h.notices[index], {userId, role, eventType,
      eventKey:`FE-ORD-41-${action}-${hash}:${eventType}`, entityId:41});
  }
  assert.equal(h.calls.at(-2).sql, 'COMMIT');
  assert.equal(h.calls.at(-1).sql, 'RELEASE');
}

for (const [from, to, type] of [
  ['PREPARING','READY_FOR_DISPATCH','DISPATCH_SCHEDULED'],
  ['READY_FOR_DISPATCH','DISPATCHED','OUT_FOR_DELIVERY'],
  ['DISPATCHED','SUPPLIER_DELIVERED','DELIVERY_REPORTED']
]) {
  test(`${to} enqueues only order participants after evidence and before commit`, async () => {
    const h = harness({fulfillment_status:from});
    assert.equal((await transition(h, to, {metadata:{otherBuyerAddress:'private'}})).is_replay, false);
    expectNotices(h, type, to);
  });
  test(`${to} replay does not enqueue`, async () => {
    const h = harness({fulfillment_status:to}, {replay:true});
    assert.equal((await transition(h, to)).is_replay, true);
    assert.equal(h.notices.length, 0);
  });
}
test('buyer receipt emits its own milestone', async () => {
  const h = harness({fulfillment_status:'SUPPLIER_DELIVERED'});
  await receipt(h);
  expectNotices(h, 'RECEIPT_CONFIRMED', 'BUYER_CONFIRMED');
});
for (const [reason, type] of [
  ['SUPPLIER_DELIVERY_DELAYED','DELIVERY_DELAYED'],
  ['SUPPLIER_LOGISTICS_FAILURE','DELIVERY_FAILED']
]) {
  test(`${reason} emits only its actual exception type`, async () => {
    const h = harness();
    await exception(h, reason);
    expectNotices(h, type, 'SUPPLIER_EXCEPTION');
  });
  test(`${reason} replay does not enqueue`, async () => {
    const h = harness({fulfillment_status:'EXCEPTION', exception_reason:reason}, {replay:true});
    assert.equal((await exception(h, reason)).is_replay, true);
    assert.equal(h.notices.length, 0);
  });
}
test('safely recorded single-item shortage emits partial delivery', async () => {
  const h = harness({fulfillment_status:'SUPPLIER_DELIVERED'});
  await discrepancy(h);
  expectNotices(h, 'PARTIAL_DELIVERY', 'BUYER_DISCREPANCY');
});
for (const [name, order, options, invoke, code] of [
  ['other supplier', {}, {}, h => transition(h,'READY_FOR_DISPATCH',{actor:{id:20,role:'SUPPLIER'}}), 'FORBIDDEN'],
  ['other buyer', {fulfillment_status:'SUPPLIER_DELIVERED'}, {}, h => receipt(h,{actor:{id:8,role:'BUYER'}}), 'FORBIDDEN'],
  ['unpaid', {payment_status:'PENDING'}, {}, h => transition(h,'READY_FOR_DISPATCH'), 'UNPAID_ORDER_NOT_IN_FULFILLMENT'],
  ['skipped transition', {}, {}, h => transition(h,'SUPPLIER_DELIVERED'), 'INVALID_FULFILLMENT_TRANSITION'],
  ['missing dispatch method', {fulfillment_status:'READY_FOR_DISPATCH'}, {}, h => transition(h,'DISPATCHED',{deliveryMethod:null}), 'DELIVERY_METHOD_REQUIRED'],
  ['bound doorstep cannot become pickup', {fulfillment_status:'READY_FOR_DISPATCH',procurement_delivery_snapshot:'{"mode":"STANDARD_CLUSTERED"}'}, {}, h => transition(h,'DISPATCHED',{deliveryMethod:'BUYER_PICKUP'}), 'PROCUREMENT_DELIVERY_METHOD_MISMATCH'],
  ['bound pickup cannot become courier', {fulfillment_status:'READY_FOR_DISPATCH',delivery_type:'SUPPLIER_PICKUP',procurement_delivery_snapshot:'{"mode":"PICKUP"}'}, {}, h => transition(h,'DISPATCHED',{deliveryMethod:'SUPPLIER_FLEET'}), 'PICKUP_DELIVERY_METHOD_MISMATCH'],
  ['receipt before supplier claim', {}, {}, receipt, 'PREREQUISITE_NOT_MET'],
  ['unresolved dispute', {fulfillment_status:'SUPPLIER_DELIVERED'}, {disputes:1}, receipt, 'UNRESOLVED_DISPUTE_EXISTS'],
  ['B6 per-line requirement', {fulfillment_status:'DISPATCHED'}, {lines:2}, discrepancy, 'LINE_ITEM_RECEIPT_REQUIRED'],
  ['equal quantity', {fulfillment_status:'DISPATCHED'}, {}, h => discrepancy(h,'QUANTITY_MISMATCH',{reportedQuantity:'10'}), 'NO_QUANTITY_SHORTAGE'],
  ['excess quantity', {fulfillment_status:'DISPATCHED'}, {}, h => discrepancy(h,'QUANTITY_MISMATCH',{reportedQuantity:'11'}), 'RECEIVED_QUANTITY_EXCEEDS_ORDER'],
  ['invented failure enum', {}, {}, h => exception(h,'DELIVERY_FAILED'), 'INVALID_EXCEPTION_REASON']
]) {
  test(`${name} rejects without notifications`, async () => {
    const h = harness(order, options);
    await assert.rejects(() => invoke(h), {code});
    assert.equal(h.notices.length, 0);
    assert.equal(h.calls.some(c => c.sql === 'COMMIT'), false);
  });
}
for (const [name, order, invoke] of [
  ['inventory shortage', {}, h => exception(h,'SUPPLIER_INVENTORY_SHORTAGE')],
  ['damaged goods', {fulfillment_status:'DISPATCHED'}, h => discrepancy(h,'DAMAGED_GOODS')],
  ['wrong product', {fulfillment_status:'DISPATCHED'}, h => discrepancy(h,'WRONG_PRODUCT')],
  ['unreceived report', {fulfillment_status:'DISPATCHED'}, h => discrepancy(h,'DELIVERY_NOT_RECEIVED')],
  ['zero received', {fulfillment_status:'DISPATCHED'}, h => discrepancy(h,'QUANTITY_MISMATCH',{reportedQuantity:'0'})]
]) {
  test(`${name} does not fabricate partial delivery or delivery failure`, async () => {
    const h = harness(order);
    await invoke(h);
    assert.equal(h.notices.length, 0);
  });
}
for (const [name, order, invoke] of [
  ['receipt', {fulfillment_status:'BUYER_CONFIRMED'}, receipt],
  ['partial', {fulfillment_status:'EXCEPTION', exception_reason:'QUANTITY_MISMATCH'}, discrepancy]
]) {
  test(`${name} replay emits nothing`, async () => {
    const h = harness(order, {replay:true});
    assert.equal((await invoke(h)).is_replay, true);
    assert.equal(h.notices.length, 0);
  });
}
for (const [name, order, invoke] of [
  ['ready', {}, h => transition(h,'READY_FOR_DISPATCH')],
  ['receipt', {fulfillment_status:'SUPPLIER_DELIVERED'}, receipt],
  ['delay', {}, h => exception(h,'SUPPLIER_DELIVERY_DELAYED')],
  ['partial', {fulfillment_status:'DISPATCHED'}, discrepancy]
]) {
  test(`${name} second-recipient enqueue failure rolls back the transaction`, async () => {
    const h = harness(order, {failNotice:2});
    await assert.rejects(() => invoke(h), /outbox failed/);
    assert.equal(h.notices.length, 0);
    assert.equal(h.calls.filter(c => c.sql === 'ENQUEUE').length, 2);
    assert.equal(h.calls.some(c => c.sql === 'COMMIT'), false);
    assert.equal(h.calls.at(-2).sql, 'ROLLBACK');
    assert.equal(h.calls.at(-1).sql, 'RELEASE');
  });
}
test('failed milestone insert emits nothing', async () => {
  const h = harness({}, {failMilestone:true});
  await assert.rejects(() => transition(h,'READY_FOR_DISPATCH'), /milestone failed/);
  assert.equal(h.calls.some(c => c.sql === 'ENQUEUE'), false);
});

test('PREPARING records acceptance and packing for persisted participants in the same transaction', async () => {
  const h = harness({fulfillment_status:'AWAITING_SUPPLIER_ACKNOWLEDGEMENT'});
  await transition(h, 'PREPARING', {metadata:{buyer_id:999,supplier_id:998}});
  assert.deepEqual(h.notices.map(n => [n.userId,n.role,n.eventType,n.entityId]), [
    [7,'BUYER','FULFILLMENT.ACCEPTED',41], [19,'SUPPLIER','FULFILLMENT.ACCEPTED',41],
    [7,'BUYER','FULFILLMENT.PACKING',41], [19,'SUPPLIER','FULFILLMENT.PACKING',41]
  ]);
  assert.equal(h.notices[0].eventKey, h.notices[1].eventKey);
  assert.match(h.notices[0].eventKey, /^FULFILLMENT\.ACCEPTED:[a-f0-9]{64}$/);
  assert.match(h.notices[2].eventKey, /^FULFILLMENT\.PACKING:[a-f0-9]{64}$/);
  assert.equal(h.calls.at(-2).sql, 'COMMIT');
});
test('PREPARING replay emits neither acceptance nor packing', async () => {
  const h = harness({fulfillment_status:'PREPARING'}, {replay:true});
  assert.equal((await transition(h,'PREPARING')).is_replay, true);
  assert.equal(h.notices.length,0);
});
test('another supplier cannot emit acceptance or packing', async () => {
  const h = harness({fulfillment_status:'AWAITING_SUPPLIER_ACKNOWLEDGEMENT'});
  await assert.rejects(() => transition(h,'PREPARING',{actor:{id:20,role:'SUPPLIER'}}), {code:'FORBIDDEN'});
  assert.equal(h.notices.length,0);
});
for (const failNotice of [1,2,3,4]) {
  test(`PREPARING recipient write ${failNotice} failure rolls back both canonical events`, async () => {
    const h = harness({fulfillment_status:'AWAITING_SUPPLIER_ACKNOWLEDGEMENT'}, {failNotice});
    await assert.rejects(() => transition(h,'PREPARING'), /outbox failed/);
    assert.equal(h.notices.length,0);
    assert.equal(h.calls.some(c => c.sql === 'COMMIT'),false);
    assert.equal(h.calls.at(-2).sql,'ROLLBACK');
  });
}
