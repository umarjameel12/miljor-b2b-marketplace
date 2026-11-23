'use strict';
// Mandatory Admin Approval Gate for every Pool (Regular/Flash) and Smart Procurement Hub order.
// Approval is strictly separate from payment capture, financial release, and supplier payout.
const crypto = require('node:crypto');
const db = require('../config/db');
const notificationService = require('./notificationService');

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN']);
const fail = (code, message, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });

class OrderAdminApprovalService {
  constructor(database = db, notifier = notificationService) {
    this.db = database;
    this.notifications = notifier;
  }

  assertAdminRole(actor) {
    if (!actor || !Number.isSafeInteger(Number(actor.id)) || Number(actor.id) <= 0 || !ADMIN_ROLES.has(actor.role)) {
      throw fail('ADMIN_AUTHORIZATION_REQUIRED', 'Authenticated admin role required for order approval', 403);
    }
  }

  async assertOrderAdminApproved(conn, orderId) {
    const [rows] = await conn.query(
      `SELECT id, buyer_id, supplier_id, order_status, payment_status, fulfillment_status, admin_approval_status
         FROM orders WHERE id = ? FOR UPDATE`,
      [orderId]
    );
    const order = rows[0];
    if (!order) throw fail('ORDER_NOT_FOUND', 'Order not found', 404);
    if (order.admin_approval_status === 'ADMIN_REJECTED') {
      throw fail('ADMIN_APPROVAL_REJECTED', 'Order was rejected by Admin and cannot proceed to supplier fulfillment', 403);
    }
    if (order.admin_approval_status !== 'ADMIN_APPROVED') {
      throw fail('ADMIN_APPROVAL_REQUIRED', 'Order requires Admin Approval before supplier fulfillment can begin', 403);
    }
    return order;
  }

  async listPendingOrders(actor) {
    this.assertAdminRole(actor);
    const [rows] = await this.db.query(
      `SELECT o.id, o.order_code, o.buyer_id, o.supplier_id, o.total_qty, o.total_amount, o.currency,
              o.payment_status, o.order_status, o.fulfillment_status, o.admin_approval_status, o.notes, o.created_at,
              bu.full_name AS buyer_name, su.full_name AS supplier_name
         FROM orders o
         JOIN users bu ON bu.id = o.buyer_id
         JOIN users su ON su.id = o.supplier_id
        WHERE o.admin_approval_status = 'PENDING_ADMIN_APPROVAL'
        ORDER BY o.created_at ASC, o.id ASC`
    );
    return rows;
  }

  async approveOrder({ orderId, actor, notes = null }) {
    this.assertAdminRole(actor);
    const id = Number(orderId);
    if (!Number.isSafeInteger(id) || id <= 0) throw fail('INVALID_ORDER_ID', 'Valid numeric order ID required', 400);

    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id]);
      const order = rows[0];
      if (!order) throw fail('ORDER_NOT_FOUND', 'Order not found', 404);

      if (Number(actor.id) === Number(order.buyer_id) || Number(actor.id) === Number(order.supplier_id)) {
        throw fail('SELF_APPROVAL_PROHIBITED', 'Buyers and suppliers cannot approve their own orders', 403);
      }
      if (order.admin_approval_status === 'ADMIN_REJECTED') {
        throw fail('ORDER_ALREADY_REJECTED', 'Rejected order cannot be approved', 409);
      }
      if (order.order_status === 'CANCELLED') {
        throw fail('ORDER_CANCELLED', 'Cancelled order cannot be approved', 409);
      }
      if (order.admin_approval_status === 'ADMIN_APPROVED') {
        await conn.commit();
        return { success: true, is_replay: true, order };
      }

      const previous = order.admin_approval_status || 'PENDING_ADMIN_APPROVAL';
      await conn.query(
        `UPDATE orders
            SET admin_approval_status = 'ADMIN_APPROVED',
                admin_approved_at = UTC_TIMESTAMP(),
                admin_approved_by = ?,
                updated_at = NOW()
          WHERE id = ? AND admin_approval_status = 'PENDING_ADMIN_APPROVAL'`,
        [actor.id, id]
      );

      await conn.query(
        `INSERT INTO order_admin_approval_audit
           (order_id, admin_id, admin_role, decision, reason, previous_status, new_status)
         VALUES (?, ?, ?, 'APPROVED', ?, ?, 'ADMIN_APPROVED')`,
        [id, actor.id, actor.role, notes ? String(notes).slice(0, 500) : null, previous]
      );

      await conn.query(
        `INSERT INTO system_audit_logs
           (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, ?, 'ORDER_ADMIN_APPROVED', 'orders', ?, ?, ?)`,
        [actor.id, actor.role, id, JSON.stringify({ admin_approval_status: previous }), JSON.stringify({ order_code: order.order_code, admin_approval_status: 'ADMIN_APPROVED' })]
      );

      await this.notifications.enqueueEvent(conn, {
        userId: Number(order.supplier_id),
        role: 'SUPPLIER',
        eventType: 'APPROVAL_GRANTED',
        eventKey: `order:${id}:admin-approved:supplier`,
        entityId: id
      });
      await this.notifications.enqueueEvent(conn, {
        userId: Number(order.buyer_id),
        role: 'BUYER',
        eventType: 'APPROVAL_GRANTED',
        eventKey: `order:${id}:admin-approved:buyer`,
        entityId: id
      });

      const [updated] = await conn.query('SELECT * FROM orders WHERE id = ?', [id]);
      await conn.commit();
      return { success: true, is_replay: false, order: updated[0] };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async rejectOrder({ orderId, actor, reason }) {
    this.assertAdminRole(actor);
    const id = Number(orderId);
    if (!Number.isSafeInteger(id) || id <= 0) throw fail('INVALID_ORDER_ID', 'Valid numeric order ID required', 400);
    const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmedReason) throw fail('REASON_REQUIRED', 'Rejection reason is required', 400);

    const conn = await this.db.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id]);
      const order = rows[0];
      if (!order) throw fail('ORDER_NOT_FOUND', 'Order not found', 404);

      if (Number(actor.id) === Number(order.buyer_id) || Number(actor.id) === Number(order.supplier_id)) {
        throw fail('SELF_APPROVAL_PROHIBITED', 'Buyers and suppliers cannot reject their own orders via admin gate', 403);
      }
      if (order.admin_approval_status === 'ADMIN_APPROVED') {
        throw fail('ORDER_ALREADY_APPROVED', 'Already approved order cannot be rejected via pending approval gate', 409);
      }
      if (order.admin_approval_status === 'ADMIN_REJECTED') {
        await conn.commit();
        return { success: true, is_replay: true, order };
      }

      const previous = order.admin_approval_status || 'PENDING_ADMIN_APPROVAL';
      await conn.query(
        `UPDATE orders
            SET admin_approval_status = 'ADMIN_REJECTED',
                admin_rejected_at = UTC_TIMESTAMP(),
                admin_rejected_by = ?,
                admin_rejection_reason = ?,
                order_status = 'CANCELLED',
                fulfillment_status = 'EXCEPTION',
                updated_at = NOW()
          WHERE id = ? AND admin_approval_status = 'PENDING_ADMIN_APPROVAL'`,
        [actor.id, trimmedReason.slice(0, 500), id]
      );

      // Release only PENDING stock allocations (ORDER_DIRECT / POOL_RESERVATION) for this order
      await conn.query(
        `UPDATE supplier_inventory_allocations
            SET status = 'RELEASED'
          WHERE reference_id = ? AND allocation_type IN ('ORDER_DIRECT', 'POOL_RESERVATION') AND status = 'PENDING'`,
        [id]
      );

      // If already paid, initiate verified refund obligation review (never fabricate provider refund completion)
      let refundCreated = false;
      if (order.payment_status === 'PAID') {
        const [payments] = await conn.query(
          "SELECT id, amount, buyer_fee FROM payments WHERE order_id = ? AND status = 'PAID' ORDER BY id DESC LIMIT 1 FOR UPDATE",
          [id]
        );
        if (payments.length) {
          const [existingRefund] = await conn.query(
            "SELECT id FROM refund_obligations WHERE order_id = ? AND status NOT IN ('REJECTED','FAILED') LIMIT 1",
            [id]
          );
          if (!existingRefund.length) {
            const p = payments[0];
            const code = 'RFND-' + crypto.randomBytes(6).toString('hex').toUpperCase();
            await conn.query(
              `INSERT INTO refund_obligations
                 (refund_code, order_id, payment_id, buyer_id, assessed_refund_amount, fee_refund_amount, total_refund_amount, currency, refund_type, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FULL', 'REQUESTED')`,
              [code, id, p.id, order.buyer_id, p.amount, p.buyer_fee || 0, p.amount, order.currency || 'PKR']
            );
            refundCreated = true;
          }
        }
      }

      await conn.query(
        `INSERT INTO order_admin_approval_audit
           (order_id, admin_id, admin_role, decision, reason, previous_status, new_status)
         VALUES (?, ?, ?, 'REJECTED', ?, ?, 'ADMIN_REJECTED')`,
        [id, actor.id, actor.role, trimmedReason.slice(0, 500), previous]
      );

      await conn.query(
        `INSERT INTO system_audit_logs
           (actor_id, actor_role, action, entity_name, entity_id, previous_value, new_value)
         VALUES (?, ?, 'ORDER_ADMIN_REJECTED', 'orders', ?, ?, ?)`,
        [actor.id, actor.role, id, JSON.stringify({ admin_approval_status: previous }), JSON.stringify({ order_code: order.order_code, admin_approval_status: 'ADMIN_REJECTED', reason: trimmedReason.slice(0, 200), refund_obligation_created: refundCreated })]
      );

      await this.notifications.enqueueEvent(conn, {
        userId: Number(order.buyer_id),
        role: 'BUYER',
        eventType: 'APPROVAL_REJECTED',
        eventKey: `order:${id}:admin-rejected:buyer`,
        entityId: id
      });

      const [updated] = await conn.query('SELECT * FROM orders WHERE id = ?', [id]);
      await conn.commit();
      return { success: true, is_replay: false, refund_obligation_created: refundCreated, order: updated[0] };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = new OrderAdminApprovalService();
module.exports.OrderAdminApprovalService = OrderAdminApprovalService;
module.exports.ADMIN_ROLES = ADMIN_ROLES;
