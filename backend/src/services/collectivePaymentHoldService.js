'use strict';
// Collective buyer payment holds & hybrid collective payment-failure policy.
// Integrates PR #61 bounded stock leases with PR #53/#54 procurement_collective_commitments.
// Never releases a hold if an initiated payment may have succeeded (moves to RECONCILIATION_REQUIRED).
const db = require('../config/db');
const exact = require('./exactDecimal');
const notificationService = require('./notificationService');

const HOLD_MINUTES = 15;
const fail = (code, message, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });

/**
 * Pure policy evaluator for hybrid collective payment-failure outcomes.
 * Evaluates remaining PAID buyers against supplier MOQ and price-tier invariance.
 */
function evaluateHybridGroupOutcome({
  buyers = [],
  supplierMoqQty,
  agreedUnitPrice,
  applicableUnitPriceForPaidQty,
  buyersApprovedRevisedPrice = false
}) {
  const paidBuyers = buyers.filter((b) => b.payment_status === 'PAID');
  const pendingOrFailed = buyers.filter((b) => b.payment_status !== 'PAID');
  const hasUncertain = pendingOrFailed.some(
    (b) => b.hold_status === 'RECONCILIATION_REQUIRED' || b.attempt_status === 'INITIATED' || b.attempt_status === 'RECONCILIATION_REQUIRED'
  );
  const allPaid = buyers.length > 0 && pendingOrFailed.length === 0;
  if (allPaid) {
    return {
      outcome: 'GROUP_FULLY_FUNDED',
      can_dispatch: true,
      requires_refund_review: false,
      paid_buyer_ids: paidBuyers.map((b) => Number(b.buyer_id)),
      unpaid_buyer_ids: [],
      paid_total_qty: exact.exactDecimalSum(paidBuyers.map((b) => b.quantity || '0'), 4)
    };
  }

  const paidTotalQty = exact.exactDecimalSum(paidBuyers.map((b) => b.quantity || '0'), 4);
  if (hasUncertain) {
    return {
      outcome: 'GROUP_FUNDING_INCOMPLETE_RECONCILIATION_REQUIRED',
      can_dispatch: false,
      requires_refund_review: false,
      paid_buyer_ids: paidBuyers.map((b) => Number(b.buyer_id)),
      unpaid_buyer_ids: pendingOrFailed.map((b) => Number(b.buyer_id)),
      paid_total_qty: paidTotalQty
    };
  }

  const hasReleasedOrFailed = pendingOrFailed.some(
    (b) => b.hold_status === 'RELEASED' || b.payment_status === 'FAILED' || b.payment_status === 'EXPIRED'
  );
  if (!hasReleasedOrFailed) {
    return {
      outcome: 'GROUP_FUNDING_INCOMPLETE',
      can_dispatch: false,
      requires_refund_review: false,
      paid_buyer_ids: paidBuyers.map((b) => Number(b.buyer_id)),
      unpaid_buyer_ids: pendingOrFailed.map((b) => Number(b.buyer_id)),
      paid_total_qty: paidTotalQty
    };
  }

  const moqSatisfied = supplierMoqQty == null
    ? paidBuyers.length >= 2
    : exact.exactDecimalGte(paidTotalQty, exact.toCanonical(supplierMoqQty, 4), 4);

  if (!moqSatisfied) {
    return {
      outcome: 'GROUP_CANCELLED_MOQ_UNMET',
      can_dispatch: false,
      requires_refund_review: paidBuyers.length > 0,
      paid_buyer_ids: paidBuyers.map((b) => Number(b.buyer_id)),
      unpaid_buyer_ids: pendingOrFailed.map((b) => Number(b.buyer_id)),
      paid_total_qty: paidTotalQty
    };
  }

  const priceUnchanged = agreedUnitPrice == null || applicableUnitPriceForPaidQty == null
    ? true
    : exact.exactDecimalEquals(agreedUnitPrice, applicableUnitPriceForPaidQty, 2);

  if (!priceUnchanged && !buyersApprovedRevisedPrice) {
    return {
      outcome: 'PRICE_APPROVAL_REQUIRED',
      can_dispatch: false,
      requires_refund_review: false,
      paid_buyer_ids: paidBuyers.map((b) => Number(b.buyer_id)),
      unpaid_buyer_ids: pendingOrFailed.map((b) => Number(b.buyer_id)),
      paid_total_qty: paidTotalQty
    };
  }

  return {
    outcome: 'ELIGIBLE_TO_CONTINUE',
    can_dispatch: true,
    requires_refund_review: false,
    paid_buyer_ids: paidBuyers.map((b) => Number(b.buyer_id)),
    unpaid_buyer_ids: pendingOrFailed.map((b) => Number(b.buyer_id)),
    paid_total_qty: paidTotalQty
  };
}

class CollectivePaymentHoldService {
  constructor(database = db, notifier = notificationService) {
    this.db = database;
    this.notifications = notifier;
  }

  async createForOrder(conn, { orderId, groupId, commitmentId, buyerId }) {
    if (![orderId, buyerId].every((v) => Number.isSafeInteger(Number(v)) && Number(v) > 0)) {
      throw fail('INVALID_COLLECTIVE_HOLD_CONTEXT', 'Valid collective order and buyer are required', 400);
    }
    let gid = groupId ? Number(groupId) : null;
    let cid = commitmentId ? Number(commitmentId) : null;
    if (!gid || !cid) {
      const [links] = await conn.query(
        `SELECT c.id AS commitment_id, c.group_id
           FROM procurement_collective_commitments c
           JOIN procurement_award_orders ao ON ao.award_id = c.award_id
          WHERE ao.order_id = ? AND c.buyer_id = ? LIMIT 1`,
        [orderId, buyerId]
      );
      if (!links.length) return null;
      gid = Number(links[0].group_id);
      cid = Number(links[0].commitment_id);
    }

    await conn.query(
      `INSERT INTO collective_payment_holds
         (order_id, group_id, commitment_id, buyer_id, payment_expires_at, payment_hold_status)
       VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE), 'ACTIVE')
       ON DUPLICATE KEY UPDATE id = id`,
      [orderId, gid, cid, buyerId, HOLD_MINUTES]
    );
    const [rows] = await conn.query(
      `SELECT DATE_FORMAT(payment_expires_at, '%Y-%m-%dT%H:%i:%sZ') AS payment_expires_at
         FROM collective_payment_holds WHERE order_id = ? AND buyer_id = ?`,
      [orderId, buyerId]
    );
    return { payment_expires_at: rows[0]?.payment_expires_at || null };
  }

  async _release(conn, row, reason) {
    await conn.query(
      `UPDATE supplier_inventory_allocations SET status = 'RELEASED'
        WHERE allocation_type = 'ORDER_DIRECT' AND reference_id = ? AND status = 'PENDING'`,
      [row.order_id]
    );
    await conn.query(
      `UPDATE collective_payment_holds
          SET payment_hold_status = 'RELEASED',
              payment_hold_released_at = UTC_TIMESTAMP(),
              payment_hold_release_reason = ?
        WHERE id = ? AND payment_hold_status IN ('ACTIVE', 'PAYMENT_PENDING', 'RECONCILIATION_REQUIRED')`,
      [reason, row.id]
    );
  }

  async claimCheckout(orderId, buyerId) {
    const conn = await this.db.getConnection();
    let expired = false;
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        `SELECT ch.id, ch.order_id, ch.group_id, ch.buyer_id, ch.payment_hold_status,
                ch.payment_expires_at, (ch.payment_expires_at > UTC_TIMESTAMP()) AS is_open,
                o.payment_status, o.order_status
           FROM collective_payment_holds ch
           JOIN orders o ON o.id = ch.order_id
          WHERE ch.order_id = ? FOR UPDATE`,
        [orderId]
      );
      const row = rows[0];
      if (!row) {
        await conn.commit();
        return { collective_order: false };
      }
      if (Number(row.buyer_id) !== Number(buyerId)) {
        throw fail('FORBIDDEN', 'Cannot start another buyer collective checkout', 403);
      }
      if (row.payment_status === 'PAID' || row.payment_hold_status === 'COMMITTED') {
        await conn.commit();
        return { collective_order: true, paid: true };
      }
      if (!row.payment_expires_at) {
        await conn.commit();
        return { collective_order: true, legacy: true, pending: true };
      }
      if (row.payment_hold_status === 'RELEASED') {
        throw fail('COLLECTIVE_PAYMENT_HOLD_EXPIRED', 'This group order stock hold has expired; request a fresh group award');
      }
      if (row.payment_hold_status === 'RECONCILIATION_REQUIRED') {
        await conn.commit();
        return { collective_order: true, reconciliation_required: true };
      }
      if (Number(row.is_open) !== 1) {
        const [attempts] = await conn.query(
          "SELECT id FROM payment_attempts WHERE order_id = ? AND status IN ('INITIATED','RECONCILIATION_REQUIRED') LIMIT 1 FOR UPDATE",
          [orderId]
        );
        if (attempts.length) {
          await conn.query("UPDATE collective_payment_holds SET payment_hold_status = 'RECONCILIATION_REQUIRED' WHERE id = ?", [row.id]);
          await conn.commit();
          return { collective_order: true, reconciliation_required: true };
        }
        await this._release(conn, row, 'PAYMENT_WINDOW_EXPIRED');
        await this.notifications.enqueueEvent(conn, {
          userId: Number(row.buyer_id),
          role: 'BUYER',
          eventType: 'PAYMENT_FAILED',
          eventKey: `collective-order:${orderId}:payment-window-expired:${row.id}`,
          entityId: Number(orderId)
        });
        expired = true;
      } else {
        await conn.query(
          `UPDATE collective_payment_holds
              SET payment_hold_status = 'PAYMENT_PENDING',
                  checkout_started_at = COALESCE(checkout_started_at, UTC_TIMESTAMP())
            WHERE id = ? AND payment_hold_status IN ('ACTIVE', 'PAYMENT_PENDING')`,
          [row.id]
        );
      }
      await conn.commit();
      if (expired) {
        throw fail('COLLECTIVE_PAYMENT_HOLD_EXPIRED', 'This 15-minute payment window ended; stock was released and the group must be requalified');
      }
      return { collective_order: true, pending: true };
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  }

  async assertCanCreateFreshCheckout(orderId, buyerId) {
    const queryDb = this.db;
    const [rows] = await queryDb.query(
      `SELECT buyer_id, payment_hold_status, payment_expires_at,
              (payment_expires_at > UTC_TIMESTAMP()) AS is_open
         FROM collective_payment_holds WHERE order_id = ? FOR UPDATE`,
      [orderId]
    );
    const row = rows[0];
    if (!row) return { collective_order: false };
    if (Number(row.buyer_id) !== Number(buyerId)) {
      throw fail('FORBIDDEN', 'Cannot create checkout for another buyer collective order', 403);
    }
    if (row.payment_hold_status === 'RELEASED') {
      throw fail('COLLECTIVE_PAYMENT_HOLD_EXPIRED', 'Collective payment hold already released');
    }
    if (row.payment_hold_status === 'RECONCILIATION_REQUIRED') {
      throw fail('CHECKOUT_RECONCILIATION_REQUIRED', 'Payment outcome requires reconciliation before retry');
    }
    if (row.payment_expires_at && Number(row.is_open) !== 1 && row.payment_hold_status !== 'COMMITTED') {
      throw fail('COLLECTIVE_PAYMENT_HOLD_EXPIRED', 'Collective payment window expired');
    }
    return { collective_order: true };
  }

  async releaseCheckoutClaim(orderId, buyerId) {
    const [rows] = await this.db.query(
      `UPDATE collective_payment_holds
          SET payment_hold_status = 'ACTIVE', checkout_started_at = NULL
        WHERE order_id = ? AND buyer_id = ? AND payment_hold_status = 'PAYMENT_PENDING'`,
      [orderId, buyerId]
    );
    return { released: rows.affectedRows > 0 };
  }

  async markPaid(conn, orderId) {
    const [rows] = await conn.query(
      `SELECT id, buyer_id, group_id, payment_hold_status
         FROM collective_payment_holds WHERE order_id = ? FOR UPDATE`,
      [orderId]
    );
    const row = rows[0];
    if (!row) return { handled: false };
    await conn.query(
      `UPDATE collective_payment_holds
          SET payment_hold_status = 'COMMITTED', payment_hold_release_reason = NULL
        WHERE id = ?`,
      [row.id]
    );
    return { handled: true, status: 'COMMITTED', group_id: row.group_id };
  }

  async markFailed(conn, orderId, { uncertain = false } = {}) {
    const [rows] = await conn.query(
      `SELECT id, buyer_id, group_id, payment_hold_status, payment_expires_at,
              (payment_expires_at > UTC_TIMESTAMP()) AS is_open
         FROM collective_payment_holds WHERE order_id = ? FOR UPDATE`,
      [orderId]
    );
    const row = rows[0];
    if (!row) return { handled: false };
    if (['COMMITTED', 'RELEASED'].includes(row.payment_hold_status)) {
      return { handled: true, status: row.payment_hold_status };
    }
    const [active] = await conn.query(
      "SELECT id FROM payment_attempts WHERE order_id = ? AND status IN ('INITIATED','RECONCILIATION_REQUIRED') LIMIT 1 FOR UPDATE",
      [orderId]
    );
    if (uncertain || active.length) {
      await conn.query("UPDATE collective_payment_holds SET payment_hold_status = 'RECONCILIATION_REQUIRED' WHERE id = ?", [row.id]);
      return { handled: true, status: 'RECONCILIATION_REQUIRED' };
    }
    if (!row.payment_expires_at || Number(row.is_open) === 1) {
      await conn.query(
        `UPDATE collective_payment_holds
            SET payment_hold_status = 'ACTIVE', checkout_started_at = NULL
          WHERE id = ? AND payment_hold_status IN ('ACTIVE', 'PAYMENT_PENDING', 'RECONCILIATION_REQUIRED')`,
        [row.id]
      );
      await this.notifications.enqueueEvent(conn, {
        userId: Number(row.buyer_id),
        role: 'BUYER',
        eventType: 'PAYMENT_FAILED',
        eventKey: `collective-order:${orderId}:provider-payment-failed`,
        entityId: Number(orderId)
      });
      return { handled: true, status: 'ACTIVE' };
    }
    await this._release(conn, { ...row, order_id: orderId }, 'PROVIDER_CONFIRMED_PAYMENT_FAILURE_AFTER_EXPIRY');
    await this.notifications.enqueueEvent(conn, {
      userId: Number(row.buyer_id),
      role: 'BUYER',
      eventType: 'PAYMENT_FAILED',
      eventKey: `collective-order:${orderId}:provider-payment-failed`,
      entityId: Number(orderId)
    });
    return { handled: true, status: 'RELEASED' };
  }

  async readForOrder(orderId, buyerId) {
    const [rows] = await this.db.query(
      `SELECT payment_hold_status,
              DATE_FORMAT(payment_expires_at, '%Y-%m-%dT%H:%i:%sZ') AS expires_at_utc,
              DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%sZ') AS server_time_utc,
              (payment_expires_at > UTC_TIMESTAMP()) AS can_start,
              checkout_started_at IS NOT NULL AS checkout_started,
              payment_hold_release_reason
         FROM collective_payment_holds WHERE order_id = ? AND buyer_id = ?`,
      [orderId, buyerId]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    const expired = ['ACTIVE', 'PAYMENT_PENDING'].includes(r.payment_hold_status) && !r.can_start;
    const status = expired ? (r.checkout_started ? 'RECONCILIATION_REQUIRED' : 'EXPIRED') : r.payment_hold_status;
    return {
      kind: 'COLLECTIVE',
      status,
      expires_at: r.expires_at_utc,
      server_time: r.server_time_utc,
      checkout_started: Boolean(r.checkout_started),
      can_start_checkout: ['ACTIVE', 'PAYMENT_PENDING'].includes(r.payment_hold_status) && Boolean(r.can_start),
      release_reason: r.payment_hold_release_reason || null
    };
  }

  async processExpiredBatch(limit = 100) {
    const size = Math.max(1, Math.min(500, Number(limit) || 100));
    const conn = await this.db.getConnection();
    const result = { checked: 0, released: 0, reconciliation_required: 0, committed: 0 };
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        `SELECT ch.id, ch.order_id, ch.group_id, ch.buyer_id, ch.payment_hold_status, o.payment_status
           FROM collective_payment_holds ch
           JOIN orders o ON o.id = ch.order_id
          WHERE ch.payment_expires_at <= UTC_TIMESTAMP()
            AND ch.payment_hold_status IN ('ACTIVE', 'PAYMENT_PENDING')
          ORDER BY ch.payment_expires_at, ch.id LIMIT ? FOR UPDATE SKIP LOCKED`,
        [size]
      );
      for (const row of rows) {
        result.checked++;
        if (row.payment_status === 'PAID') {
          await conn.query("UPDATE collective_payment_holds SET payment_hold_status = 'COMMITTED' WHERE id = ?", [row.id]);
          result.committed++;
          continue;
        }
        const [attempts] = await conn.query(
          "SELECT id FROM payment_attempts WHERE order_id = ? AND status IN ('INITIATED','RECONCILIATION_REQUIRED') LIMIT 1 FOR UPDATE",
          [row.order_id]
        );
        if (attempts.length) {
          await conn.query("UPDATE collective_payment_holds SET payment_hold_status = 'RECONCILIATION_REQUIRED' WHERE id = ?", [row.id]);
          result.reconciliation_required++;
          continue;
        }
        await this._release(conn, row, 'PAYMENT_WINDOW_EXPIRED');
        await this.notifications.enqueueEvent(conn, {
          userId: Number(row.buyer_id),
          role: 'BUYER',
          eventType: 'PAYMENT_FAILED',
          eventKey: `collective-order:${row.order_id}:payment-window-expired:${row.id}`,
          entityId: Number(row.order_id)
        });
        result.released++;
      }
      await conn.commit();
      return result;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
}

module.exports = new CollectivePaymentHoldService();
module.exports.CollectivePaymentHoldService = CollectivePaymentHoldService;
module.exports.evaluateHybridGroupOutcome = evaluateHybridGroupOutcome;
