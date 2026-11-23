'use strict';
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'miljor_pr54_pr61_test_db';
process.env.TEST_DB_NAME = 'miljor_pr54_pr61_test_db';
process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT = 'false';
process.env.B6_TAX_POLICY_APPROVED = 'false';
process.env.TRANSACTIONAL_EMAIL_MODE = 'mock';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../src/config/db');
const orderAdminApprovalService = require('../src/services/orderAdminApprovalService');
const fulfillmentService = require('../src/services/fulfillmentService');

const tag = crypto.randomUUID().slice(0, 8);
const ownedUsers = [];
const ownedOrders = [];

test.before(async () => {
  const [[identity]] = await db.query('SELECT DATABASE() AS name');
  assert.equal(identity.name, 'miljor_pr54_pr61_test_db', 'Must run strictly on disposable miljor_pr54_pr61_test_db');

  for (const [role, suffix] of [
    ['BUYER', 'buyer'],
    ['SUPPLIER', 'supplier'],
    ['ADMIN', 'admin']
  ]) {
    const [res] = await db.query(
      "INSERT INTO users (full_name, email, role, is_verified, verification_status) VALUES (?, ?, ?, 1, 'VERIFIED')",
      [`Approval Test ${suffix} ${tag}`, `approval-${suffix}-${tag}@example.invalid`, role]
    );
    ownedUsers.push(res.insertId);
  }
  await db.query(
    "INSERT INTO supplier_profiles (supplier_id, business_type, verification_status) VALUES (?, 'WHOLESALER', 'VERIFIED')",
    [ownedUsers[1]]
  );
});

test.after(async () => {
  for (const oid of ownedOrders) {
    await db.query('DELETE FROM order_fulfillment_events WHERE order_id = ?', [oid]);
    await db.query('DELETE FROM order_admin_approval_audit WHERE order_id = ?', [oid]);
    await db.query('DELETE FROM refund_obligations WHERE order_id = ?', [oid]);
    await db.query('DELETE FROM payments WHERE order_id = ?', [oid]);
    await db.query('DELETE FROM orders WHERE id = ?', [oid]);
  }
  if (ownedUsers[1]) {
    await db.query('DELETE FROM supplier_profiles WHERE supplier_id = ?', [ownedUsers[1]]);
  }
  for (const uid of ownedUsers) {
    await db.query('DELETE FROM platform_notifications WHERE user_id = ?', [uid]);
    await db.query('DELETE FROM procurement_notifications WHERE recipient_id = ?', [uid]);
    await db.query('DELETE FROM system_audit_logs WHERE actor_id = ?', [uid]);
    await db.query('DELETE FROM users WHERE id = ? AND email LIKE ?', [uid, `%-${tag}@example.invalid`]);
  }
  await db.end();
});

async function createTestOrder({ notes = null, paymentStatus = 'PAID', orderStatus = 'PAID' }) {
  const [buyerId, supplierId] = ownedUsers;
  const code = `APV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const [res] = await db.query(
    `INSERT INTO orders
       (order_code, buyer_id, supplier_id, total_qty, unit_price, subtotal_amount, delivery_fee,
        buyer_platform_fee, total_amount, currency, payment_status, order_status, fulfillment_status, notes)
     VALUES (?, ?, ?, 10.0000, 100.00, 1000.00, 0.00, 0.00, 1000.00, 'PKR', ?, ?, 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT', ?)`,
    [code, buyerId, supplierId, paymentStatus, orderStatus, notes]
  );
  ownedOrders.push(res.insertId);
  return res.insertId;
}

test('Section 2: Every procurement path (Regular, Flash, RFQ, Collective, Recurring) enters PENDING_ADMIN_APPROVAL and blocks supplier fulfillment until Admin approves', async () => {
  const [buyerId, supplierId, adminId] = ownedUsers;
  const tracks = [
    { label: 'REGULAR_POOL', notes: 'REGULAR_POOL_ORDER' },
    { label: 'FLASH_POOL', notes: 'FLASH_POOL_ORDER' },
    { label: 'RFQ', notes: 'SMART_PROCUREMENT_BASKET' },
    { label: 'COLLECTIVE', notes: 'SMART_PROCUREMENT_COLLECTIVE' },
    { label: 'RECURRING', notes: 'SMART_PROCUREMENT_RECURRING' }
  ];

  for (const track of tracks) {
    const orderId = await createTestOrder({ notes: track.notes });

    // 1. Supplier cannot see unapproved order in actionable fulfillment list
    const listBefore = await fulfillmentService.listSupplierFulfillmentOrders({ actor: { id: supplierId, role: 'SUPPLIER' } });
    assert.equal(listBefore.orders.some((o) => Number(o.order_id) === orderId), false, `${track.label}: unapproved order must be hidden from supplier`);

    // 2. Supplier cannot view or transition unapproved order directly
    await assert.rejects(
      fulfillmentService.getSupplierFulfillmentOrderById({ orderId, actor: { id: supplierId, role: 'SUPPLIER' } }),
      (e) => e.code === 'ADMIN_APPROVAL_REQUIRED' && e.statusCode === 403
    );
    await assert.rejects(
      fulfillmentService.transitionSupplierFulfillment({
        orderId,
        toStatus: 'PREPARING',
        actor: { id: supplierId, role: 'SUPPLIER' },
        idempotencyKey: `unapproved-${track.label}-${tag}`
      }),
      (e) => e.code === 'ADMIN_APPROVAL_REQUIRED' && e.statusCode === 403
    );

    // 3. Buyer & Supplier self-approval prohibited
    await assert.rejects(
      orderAdminApprovalService.approveOrder({ orderId, actor: { id: buyerId, role: 'BUYER' } }),
      (e) => e.code === 'ADMIN_AUTHORIZATION_REQUIRED' && e.statusCode === 403
    );
    await assert.rejects(
      orderAdminApprovalService.approveOrder({ orderId, actor: { id: supplierId, role: 'ADMIN' } }),
      (e) => e.code === 'SELF_APPROVAL_PROHIBITED' && e.statusCode === 403
    );

    // 4. Admin approves -> audit recorded, supplier can now see order, duplicate approval is idempotent
    const approved = await orderAdminApprovalService.approveOrder({
      orderId,
      actor: { id: adminId, role: 'ADMIN' },
      notes: `Approved ${track.label}`
    });
    assert.equal(approved.is_replay, false);
    assert.equal(approved.order.admin_approval_status, 'ADMIN_APPROVED');

    const replay = await orderAdminApprovalService.approveOrder({
      orderId,
      actor: { id: adminId, role: 'ADMIN' }
    });
    assert.equal(replay.is_replay, true);

    const [auditRows] = await db.query('SELECT * FROM order_admin_approval_audit WHERE order_id = ?', [orderId]);
    assert.equal(auditRows.length, 1, 'Duplicate approval must not create duplicate audit row');
    assert.equal(auditRows[0].decision, 'APPROVED');

    const listAfter = await fulfillmentService.listSupplierFulfillmentOrders({ actor: { id: supplierId, role: 'SUPPLIER' } });
    assert.equal(listAfter.orders.some((o) => Number(o.order_id) === orderId), true, `${track.label}: approved order becomes visible to supplier`);
  }
});

test('Section 2 & 3: Admin rejection cancels order, initiates REQUESTED refund obligation if PAID (without fabricating completion), and permanently blocks supplier fulfillment', async () => {
  const [buyerId, supplierId, adminId] = ownedUsers;
  const orderId = await createTestOrder({ notes: 'REJECT_TEST', paymentStatus: 'PAID', orderStatus: 'PAID' });

  await db.query(
    `INSERT INTO payments (payment_code, order_id, buyer_id, amount, buyer_fee, payment_method, status, escrow_status, paid_at)
     VALUES (?, ?, ?, 1000.00, 0.00, 'CARD', 'PAID', 'HELD_IN_ESCROW', NOW())`,
    [`PAY-${tag}`, orderId, buyerId]
  );

  // Reason required
  await assert.rejects(
    orderAdminApprovalService.rejectOrder({ orderId, actor: { id: adminId, role: 'ADMIN' }, reason: '' }),
    (e) => e.code === 'REASON_REQUIRED' && e.statusCode === 400
  );

  const rejected = await orderAdminApprovalService.rejectOrder({
    orderId,
    actor: { id: adminId, role: 'ADMIN' },
    reason: 'Suspected duplicate commercial submission'
  });
  assert.equal(rejected.is_replay, false);
  assert.equal(rejected.refund_obligation_created, true);
  assert.equal(rejected.order.admin_approval_status, 'ADMIN_REJECTED');
  assert.equal(rejected.order.order_status, 'CANCELLED');

  // Refund obligation must be REQUESTED (not CONFIRMED/fabricated)
  const [refunds] = await db.query('SELECT status, total_refund_amount FROM refund_obligations WHERE order_id = ?', [orderId]);
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].status, 'REQUESTED');
  assert.equal(Number(refunds[0].total_refund_amount), 1000);

  // Supplier blocked
  await assert.rejects(
    fulfillmentService.getSupplierFulfillmentOrderById({ orderId, actor: { id: supplierId, role: 'SUPPLIER' } }),
    (e) => e.code === 'ADMIN_APPROVAL_REJECTED' && e.statusCode === 403
  );

  // Cannot approve after rejection
  await assert.rejects(
    orderAdminApprovalService.approveOrder({ orderId, actor: { id: adminId, role: 'ADMIN' } }),
    (e) => e.code === 'ORDER_ALREADY_REJECTED' && e.statusCode === 409
  );
});

test('Phase 1 guard ordering: unpaid returns 422 UNPAID_ORDER_NOT_IN_FULFILLMENT before 403 ADMIN_APPROVAL_REQUIRED; rejected returns 403 ADMIN_APPROVAL_REJECTED; paid + approved succeeds', async () => {
  const [, supplierId, adminId] = ownedUsers;

  // A. Unpaid + pending admin approval -> 422 UNPAID_ORDER_NOT_IN_FULFILLMENT
  const unpaidOrderId = await createTestOrder({
    notes: 'UNPAID_GUARD_ORDER',
    paymentStatus: 'AWAITING_PAYMENT',
    orderStatus: 'AWAITING_PAYMENT'
  });
  await assert.rejects(
    fulfillmentService.transitionSupplierFulfillment({
      orderId: unpaidOrderId,
      toStatus: 'PREPARING',
      actor: { id: supplierId, role: 'SUPPLIER' },
      idempotencyKey: `guard-unpaid-${tag}`
    }),
    (e) => e.code === 'UNPAID_ORDER_NOT_IN_FULFILLMENT' && e.statusCode === 422
  );

  // B. Paid + pending admin approval -> 403 ADMIN_APPROVAL_REQUIRED
  const paidPendingOrderId = await createTestOrder({
    notes: 'PAID_UNAPPROVED_GUARD_ORDER',
    paymentStatus: 'PAID',
    orderStatus: 'PAID'
  });
  await assert.rejects(
    fulfillmentService.transitionSupplierFulfillment({
      orderId: paidPendingOrderId,
      toStatus: 'PREPARING',
      actor: { id: supplierId, role: 'SUPPLIER' },
      idempotencyKey: `guard-paid-unapproved-${tag}`
    }),
    (e) => e.code === 'ADMIN_APPROVAL_REQUIRED' && e.statusCode === 403
  );

  // C. Admin-rejected order -> 403 ADMIN_APPROVAL_REJECTED (both unpaid & paid cases)
  await orderAdminApprovalService.rejectOrder({
    orderId: unpaidOrderId,
    actor: { id: adminId, role: 'ADMIN' },
    reason: 'Unpaid rejection guard check'
  });
  await assert.rejects(
    fulfillmentService.transitionSupplierFulfillment({
      orderId: unpaidOrderId,
      toStatus: 'PREPARING',
      actor: { id: supplierId, role: 'SUPPLIER' },
      idempotencyKey: `guard-rejected-unpaid-${tag}`
    }),
    (e) => e.code === 'ADMIN_APPROVAL_REJECTED' && e.statusCode === 403
  );

  const paidRejectedOrderId = await createTestOrder({
    notes: 'PAID_REJECTED_GUARD_ORDER',
    paymentStatus: 'PAID',
    orderStatus: 'PAID'
  });
  await orderAdminApprovalService.rejectOrder({
    orderId: paidRejectedOrderId,
    actor: { id: adminId, role: 'ADMIN' },
    reason: 'Paid rejection guard check'
  });
  await assert.rejects(
    fulfillmentService.transitionSupplierFulfillment({
      orderId: paidRejectedOrderId,
      toStatus: 'PREPARING',
      actor: { id: supplierId, role: 'SUPPLIER' },
      idempotencyKey: `guard-rejected-paid-${tag}`
    }),
    (e) => e.code === 'ADMIN_APPROVAL_REJECTED' && e.statusCode === 403
  );

  // D. Paid + Admin-approved order -> proceeds cleanly to PREPARING
  await orderAdminApprovalService.approveOrder({
    orderId: paidPendingOrderId,
    actor: { id: adminId, role: 'ADMIN' },
    notes: 'Approved for fulfillment'
  });
  const res = await fulfillmentService.transitionSupplierFulfillment({
    orderId: paidPendingOrderId,
    toStatus: 'PREPARING',
    actor: { id: supplierId, role: 'SUPPLIER' },
    idempotencyKey: `guard-paid-approved-${tag}`
  });
  assert.equal(res.fulfillment_status, 'PREPARING');
  assert.equal(res.is_replay, false);
});
