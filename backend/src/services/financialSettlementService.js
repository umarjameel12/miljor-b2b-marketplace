// =============================================================================
// src/services/financialSettlementService.js
// MilJor Part 4E.6: Financial Settlement, Refund, Supplier Payout & Reconciliation Foundation
//
// Governs supplier payable accrual, financial holds, refund obligations,
// disbursement preparation, and provider settlement reconciliation.
//
// Core Financial Invariants Enforced:
// 1. Zero Automated Money Movement: External refund and payout execution are strictly DISABLED.
// 2. Exact Decimal Arithmetic: Zero JavaScript floating-point drift (exactDecimal.js).
// 3. Strict Source of Truth: Supplier entitlement and refund claims are derived exclusively
//    from server-locked order snapshots; client monetary values are ignored.
// 4. Financial Conservation: Sum of allocations (payable + commission + refunds + holds)
//    must always balance with the captured payment amount.
// 5. Fail-Closed Concurrency: Row-level pessimistic locking (FOR UPDATE) and idempotency guards.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/db');
const exactDecimal = require('./exactDecimal');
const feeService = require('./feeService');
const reservationEventService = require('./reservationEventService');

function exactSub(a, b, scale = 2) {
  const bStr = exactDecimal.toCanonical(b, scale);
  const negB = bStr.startsWith('-') ? bStr.slice(1) : `-${bStr}`;
  return exactDecimal.exactDecimalSum([a, negB], scale);
}

function isAdminRole(role) {
  return ['ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'SUPPORT_ADMIN'].includes(role);
}
function isFinancialAdminRole(role) {
  return ['ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN'].includes(role);
}

class FinancialSettlementService {

  /**
   * Generates a deterministic unique audit event code.
   * Format: FIN-EVT-<TYPE>-<TIMESTAMP>-<HEX>
   */
  _generateEventCode(entityType) {
    const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `FIN-EVT-${entityType}-${Date.now().toString().slice(-6)}-${rand}`;
  }

  /**
   * Helper: Logs an immutable financial audit event.
   */
  async _logAuditEvent(connection, {
    orderId = null,
    paymentId = null,
    entityType,
    entityId,
    eventType,
    actorRole,
    actorId,
    fromStatus = null,
    toStatus,
    amountDelta = null,
    currency = 'PKR',
    notes = null,
    metadata = null
  }) {
    const eventCode = this._generateEventCode(entityType);
    let normalizedRole = actorRole || 'SYSTEM';
    if (['ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'SUPPORT_ADMIN'].includes(normalizedRole)) {
      normalizedRole = 'ADMIN';
    } else if (!['BUYER', 'SUPPLIER', 'SYSTEM'].includes(normalizedRole)) {
      normalizedRole = 'SYSTEM';
    }

    await connection.query(
      `INSERT INTO financial_audit_events (
        event_code, order_id, payment_id, entity_type, entity_id,
        event_type, actor_role, actor_id, from_status, to_status,
        amount_delta, currency, notes, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        eventCode,
        orderId,
        paymentId,
        entityType,
        entityId,
        eventType,
        normalizedRole,
        actorId,
        fromStatus,
        toStatus,
        amountDelta === null || amountDelta === undefined
          ? null : exactDecimal.toCanonical(amountDelta, 2),
        currency,
        notes,
        metadata ? JSON.stringify(metadata) : null
      ]
    );
    return eventCode;
  }

  // ===========================================================================
  // 1. SUPPLIER PAYABLE ACCRUAL
  // ===========================================================================

  /**
   * Accrues supplier payable for an order once it is genuinely PAID.
   * Can be triggered post-payment confirmation or during financial initialization.
   */
  async accrueSupplierPayable({ orderId, actor, idempotencyKey = null, clientConnection = null }) {
    const isExternalTx = !!clientConnection;
    const connection = clientConnection || await db.getConnection();

    if (!isExternalTx) {
      await connection.beginTransaction();
    }

    try {
      // 1. Lock and fetch order
      const [orders] = await connection.query(
        `SELECT o.*, u.is_verified AS supplier_user_verified, sp.verification_status AS supplier_profile_status
         FROM orders o
         JOIN users u ON o.supplier_id = u.id
         LEFT JOIN supplier_profiles sp ON sp.supplier_id = o.supplier_id
         WHERE o.id = ? FOR UPDATE`,
        [orderId]
      );

      if (orders.length === 0) {
        const err = new Error('Order not found');
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const order = orders[0];

      // Order must be PAID
      if (order.payment_status !== 'PAID') {
        const err = new Error(`Cannot accrue payable for non-paid order. Current payment status: ${order.payment_status}`);
        err.code = 'UNPAID_ORDER_NOT_PAYABLE';
        err.statusCode = 422;
        throw err;
      }

      // Check payment record
      const [payments] = await connection.query(
        `SELECT * FROM payments WHERE order_id = ? AND status = 'PAID' ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [orderId]
      );

      if (payments.length === 0) {
        const err = new Error('No confirmed payment record found for paid order');
        err.code = 'PAYMENT_RECORD_MISSING';
        err.statusCode = 422;
        throw err;
      }

      const payment = payments[0];

      // Check if payable already exists (Idempotent Accrual)
      const [existing] = await connection.query(
        `SELECT * FROM supplier_payables WHERE order_id = ? FOR UPDATE`,
        [orderId]
      );

      if (existing.length > 0) {
        if (!isExternalTx) await connection.commit();
        return {
          success: true,
          message: 'Supplier payable already accrued for this order',
          data: { payable: existing[0] }
        };
      }

      // Calculate supplier commission and net entitlement
      const grossAmount = order.subtotal_amount;
      const deliveryFeeAmount = order.delivery_fee || 0.00;

      // A settlement must use the immutable order-time supplier fee,
      // never silently pick today's profile rate or an invented default.
      const commissionPercent = order.supplier_commission_percent;
      if (commissionPercent === null || commissionPercent === undefined ||
          String(commissionPercent).trim() === '') {
        const err = new Error('Locked order supplier commission is missing; settlement policy reconciliation required');
        err.code = 'LOCKED_SUPPLIER_COMMISSION_REQUIRED';
        err.statusCode = 409;
        throw err;
      }
      let percent;
      try {
        percent = exactDecimal.toCanonical(commissionPercent, 2);
      } catch (_) {
        const err = new Error('Locked supplier commission is invalid');
        err.code = 'INVALID_LOCKED_SUPPLIER_COMMISSION';
        err.statusCode = 409;
        throw err;
      }
      if (!exactDecimal.exactDecimalGte(percent, '0.00', 2) ||
          !exactDecimal.exactDecimalGte('100.00', percent, 2)) {
        const err = new Error('Locked supplier commission is outside 0-100 percent');
        err.code = 'INVALID_LOCKED_SUPPLIER_COMMISSION';
        err.statusCode = 409;
        throw err;
      }
      const policyStatus = 'APPROVED';
      const policyNotes = null;

      // Exact rate: 2.50 percent -> 0.0250, with no Number conversion.
      const commissionBasisPoints = BigInt(percent.replace('.', ''));
      const commissionRateDecimal = (commissionBasisPoints / 10000n).toString() + '.' +
        (commissionBasisPoints % 10000n).toString().padStart(4, '0');
      const commissionAmount = exactDecimal.exactMultiplyRound(grossAmount.toString(), commissionRateDecimal, 2);

      // net_payable_amount = gross + deliveryFee - commission
      const grossAndDelivery = exactDecimal.exactDecimalSum([grossAmount.toString(), deliveryFeeAmount.toString()], 2);
      const netPayable = exactSub(grossAndDelivery, commissionAmount.toString(), 2);

      const payableCode = `SPAY-${order.order_code.slice(-8)}-${Date.now().toString().slice(-4)}`;

      // Initial status: ACCRUED (or ON_HOLD if active exceptions exist)
      let initialStatus = 'ACCRUED';
      let heldAmount = '0.00';
      let availableAmount = netPayable;

      if (order.fulfillment_status === 'EXCEPTION' || order.order_status === 'DISPUTED') {
        initialStatus = 'ON_HOLD';
        heldAmount = netPayable;
        availableAmount = '0.00';
      }

      const [payableInsert] = await connection.query(
        `INSERT INTO supplier_payables (
          payable_code, order_id, supplier_id, payment_id,
          gross_amount, delivery_fee_amount, commission_rate_percent, commission_amount,
          net_payable_amount, refund_deduction_amount, held_amount, available_amount,
          disbursed_amount, currency, status, policy_status, policy_notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?, 0.00, 'PKR', ?, ?, ?, NOW())`,
        [
          payableCode,
          order.id,
          order.supplier_id,
          payment.id,
          grossAmount,
          deliveryFeeAmount,
          commissionPercent,
          commissionAmount,
          netPayable,
          heldAmount,
          availableAmount,
          initialStatus,
          policyStatus,
          policyNotes
        ]
      );

      const payableId = payableInsert.insertId;

      // Log Audit Event
      await this._logAuditEvent(connection, {
        orderId: order.id,
        paymentId: payment.id,
        entityType: 'SUPPLIER_PAYABLE',
        entityId: payableId,
        eventType: 'PAYABLE_ACCRUED',
        actorRole: actor.role || 'SYSTEM',
        actorId: actor.id || 1,
        fromStatus: null,
        toStatus: initialStatus,
        amountDelta: netPayable,
        notes: `Accrued net payable: PKR ${netPayable} (Gross: ${grossAmount}, Delivery: ${deliveryFeeAmount}, Commission: ${commissionAmount})`
      });

      const [createdRows] = await connection.query('SELECT * FROM supplier_payables WHERE id = ?', [payableId]);

      if (!isExternalTx) {
        await connection.commit();
      }

      return {
        success: true,
        message: 'Supplier payable successfully accrued',
        data: { payable: createdRows[0] }
      };

    } catch (err) {
      if (!isExternalTx) {
        await connection.rollback();
      }
      throw err;
    } finally {
      if (!isExternalTx) {
        connection.release();
      }
    }
  }

  // ===========================================================================
  // 2. FINANCIAL HOLDS MANAGEMENT
  // ===========================================================================

  /**
   * Places a financial hold against a supplier payable.
   */
  async placeFinancialHold({
    orderId,
    disputeId = null,
    amount,
    reason,
    notes = null,
    actor
  }) {
    if (!amount || Number(amount) <= 0) {
      const err = new Error('Hold amount must be a positive number');
      err.code = 'INVALID_HOLD_AMOUNT';
      err.statusCode = 400;
      throw err;
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 1. Lock and fetch supplier payable
      const [payables] = await connection.query(
        `SELECT * FROM supplier_payables WHERE order_id = ? FOR UPDATE`,
        [orderId]
      );

      if (payables.length === 0) {
        const err = new Error('No supplier payable found for order');
        err.code = 'PAYABLE_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const payable = payables[0];
      const holdAmountStr = exactDecimal.toCanonical(amount, 2);

      // Validate hold amount does not exceed net payable
      const maxPossibleHold = exactSub(
        payable.net_payable_amount.toString(),
        payable.refund_deduction_amount.toString(),
        2
      );

      const currentHeld = payable.held_amount.toString();
      const newTotalHeld = exactDecimal.exactDecimalSum([currentHeld, holdAmountStr], 2);

      if (Number(newTotalHeld) > Number(maxPossibleHold)) {
        const err = new Error(`Requested hold exceeds maximum available payable entitlement. Current held: ${currentHeld}, Requested: ${holdAmountStr}, Max: ${maxPossibleHold}`);
        err.code = 'HOLD_EXCEEDS_PAYABLE_LIMIT';
        err.statusCode = 422;
        throw err;
      }

      const newAvailable = exactSub(maxPossibleHold, newTotalHeld, 2);
      const newStatus = Number(newAvailable) === 0 ? 'ON_HOLD' : 'PARTIALLY_HELD';

      const holdCode = `HOLD-${orderId}-${Date.now().toString().slice(-6)}`;
      let placedRole = actor.role || 'SYSTEM';
      if (['ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN', 'OPERATIONS_ADMIN', 'VERIFICATION_ADMIN', 'SUPPORT_ADMIN'].includes(placedRole)) {
        placedRole = 'ADMIN';
      } else if (placedRole !== 'SYSTEM') {
        placedRole = 'ADMIN';
      }

      const [holdInsert] = await connection.query(
        `INSERT INTO financial_holds (
          hold_code, order_id, supplier_payable_id, dispute_id,
          hold_amount, currency, reason, status, placed_by_role,
          placed_by_id, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, 'PKR', ?, 'ACTIVE', ?, ?, ?, NOW())`,
        [
          holdCode,
          orderId,
          payable.id,
          disputeId,
          holdAmountStr,
          reason,
          placedRole,
          actor.id,
          notes
        ]
      );

      const holdId = holdInsert.insertId;

      // Update payable balances
      await connection.query(
        `UPDATE supplier_payables
         SET held_amount = ?, available_amount = ?, status = ?, updated_at = NOW()
         WHERE id = ?`,
        [newTotalHeld, newAvailable, newStatus, payable.id]
      );

      // Audit
      await this._logAuditEvent(connection, {
        orderId,
        paymentId: payable.payment_id,
        entityType: 'FINANCIAL_HOLD',
        entityId: holdId,
        eventType: 'FINANCIAL_HOLD_PLACED',
        actorRole: actor.role,
        actorId: actor.id,
        fromStatus: null,
        toStatus: 'ACTIVE',
        amountDelta: holdAmountStr,
        notes: `Placed financial hold of PKR ${holdAmountStr} for reason: ${reason}`
      });

      await connection.commit();

      const [createdHold] = await connection.query('SELECT * FROM financial_holds WHERE id = ?', [holdId]);

      return {
        success: true,
        message: 'Financial hold placed successfully',
        data: {
          hold: createdHold[0],
          payable_held_amount: newTotalHeld,
          payable_available_amount: newAvailable
        }
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Releases an active financial hold (Admin only).
   */
  async releaseFinancialHold({ holdId, notes = null, actor }) {
    if (!actor || !actor.id || !isAdminRole(actor.role)) {
      const err = new Error('Financial holds can only be released by administrators');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Lock the parent payable BEFORE the financial hold. This shares the
      // lock order used by payout preparation/approval and prevents hold-release
      // racing with a newly prepared disbursement.
      const [holdLinks] = await connection.query(
        'SELECT supplier_payable_id FROM financial_holds WHERE id = ?',
        [holdId]
      );
      if (holdLinks.length !== 1) {
        const err = new Error('Financial hold record not found');
        err.code = 'HOLD_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }
      const [payables] = await connection.query(
        `SELECT sp.*, o.fulfillment_status
         FROM supplier_payables sp
         JOIN orders o ON sp.order_id = o.id
         WHERE sp.id = ? FOR UPDATE`,
        [holdLinks[0].supplier_payable_id]
      );
      if (payables.length !== 1) {
        const err = new Error('Associated supplier payable not found');
        err.code = 'PAYABLE_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }
      const payable = payables[0];
      const [holds] = await connection.query(
        'SELECT * FROM financial_holds WHERE id = ? FOR UPDATE',
        [holdId]
      );

      if (holds.length === 0) {
        const err = new Error('Financial hold record not found');
        err.code = 'HOLD_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const hold = holds[0];

      if (hold.status !== 'ACTIVE') {
        const err = new Error(`Cannot release non-active financial hold. Current status: ${hold.status}`);
        err.code = 'HOLD_NOT_ACTIVE';
        err.statusCode = 422;
        throw err;
      }


      // Refund-specific holds are reserved against a buyer claim. An admin
      // cannot release them through the generic hold endpoint and thereby
      // make disputed buyer money eligible for supplier payout.
      if (String(hold.hold_code || '').startsWith('HOLD-RFND-')) {
        const err = new Error('Refund-specific hold requires an audited refund resolution, not generic release');
        err.code = 'REFUND_HOLD_RELEASE_FORBIDDEN';
        err.statusCode = 409;
        throw err;
      }
      if (Number(hold.supplier_payable_id) !== Number(payable.id)) {
        const err = new Error('Financial hold/payable linkage changed during locking');
        err.code = 'HOLD_PAYABLE_LINK_MISMATCH';
        err.statusCode = 409;
        throw err;
      }
      const [disbursements] = await connection.query(
        'SELECT id FROM supplier_disbursement_instructions WHERE supplier_payable_id = ? LIMIT 1 FOR UPDATE',
        [payable.id]
      );
      if (disbursements.length > 0) {
        const err = new Error('Cannot release a hold while a supplier payout instruction exists');
        err.code = 'HOLD_DISBURSEMENT_CONFLICT';
        err.statusCode = 409;
        throw err;
      }
      const currentHeldBefore = exactDecimal.toCanonical(payable.held_amount, 2);
      const entitlementBefore = exactSub(payable.net_payable_amount,
        payable.refund_deduction_amount, 2);
      const availableBefore = exactSub(entitlementBefore, currentHeldBefore, 2);
      if (!exactDecimal.exactDecimalGte(currentHeldBefore, hold.hold_amount, 2) ||
          !exactDecimal.exactDecimalGte(availableBefore, '0.00', 2) ||
          !exactDecimal.exactDecimalEquals(availableBefore, payable.available_amount, 2)) {
        const err = new Error('Payable balances cannot safely release this hold');
        err.code = 'HOLD_RELEASE_ACCOUNTING_MISMATCH';
        err.statusCode = 409;
        throw err;
      }

      // Update Hold
      await connection.query(
        `UPDATE financial_holds
         SET status = 'RELEASED', released_by_id = ?, released_at = NOW(), notes = CONCAT_WS(' | ', notes, ?), updated_at = NOW()
         WHERE id = ?`,
        [actor.id, notes, holdId]
      );

      // Re-calculate payable balances
      const holdAmountStr = hold.hold_amount.toString();
      const currentHeld = payable.held_amount.toString();
      const newHeld = exactSub(currentHeld, holdAmountStr, 2);

      const maxEntitlement = exactSub(
        payable.net_payable_amount.toString(),
        payable.refund_deduction_amount.toString(),
        2
      );
      const newAvailable = exactSub(maxEntitlement, newHeld, 2);

      // Check new status
      let newPayableStatus = payable.status;
      if (exactDecimal.exactDecimalEquals(newHeld, '0.00', 2)) {
        if (payable.fulfillment_status === 'BUYER_CONFIRMED' || payable.fulfillment_status === 'COMPLETED') {
          newPayableStatus = 'ELIGIBLE_FOR_DISBURSEMENT';
        } else {
          newPayableStatus = 'ACCRUED';
        }
      } else {
        newPayableStatus = 'PARTIALLY_HELD';
      }

      await connection.query(
        `UPDATE supplier_payables
         SET held_amount = ?, available_amount = ?, status = ?, updated_at = NOW()
         WHERE id = ?`,
        [newHeld, newAvailable, newPayableStatus, payable.id]
      );

      // Audit
      await this._logAuditEvent(connection, {
        orderId: hold.order_id,
        paymentId: payable.payment_id,
        entityType: 'FINANCIAL_HOLD',
        entityId: holdId,
        eventType: 'FINANCIAL_HOLD_RELEASED',
        actorRole: actor.role,
        actorId: actor.id,
        fromStatus: 'ACTIVE',
        toStatus: 'RELEASED',
        amountDelta: holdAmountStr,
        notes: `Released financial hold of PKR ${holdAmountStr}. Reason: ${notes || 'Admin approved release'}`
      });

      await connection.commit();

      return {
        success: true,
        message: 'Financial hold released successfully',
        data: {
          hold_id: holdId,
          status: 'RELEASED',
          payable_held_amount: newHeld,
          payable_available_amount: newAvailable,
          payable_status: newPayableStatus
        }
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // 3. REFUND ASSESSMENT & APPROVAL
  // ===========================================================================

  /**
   * Assesses and records a refund obligation.
   * Derives claim amounts strictly from server locked unit prices.
   */
  async assessRefundObligation({
    orderId,
    disputeId = null,
    disputedQuantity = null,
    refundType = 'PARTIAL',
    reason,
    actor,
    idempotencyKey = null
  }) {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 1. Lock and fetch order and payment
      const [orders] = await connection.query(
        `SELECT o.*, p.id AS payment_row_id, p.amount AS captured_amount, p.status AS payment_row_status
         FROM orders o
         JOIN payments p ON p.order_id = o.id
         WHERE o.id = ? AND p.status IN ('PAID', 'PARTIALLY_REFUNDED')
         ORDER BY p.id DESC LIMIT 1 FOR UPDATE`,
        [orderId]
      );

      if (orders.length === 0) {
        const err = new Error('No confirmed paid order found for refund assessment');
        err.code = 'PAID_ORDER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const order = orders[0];

      // Only the owning buyer or an explicitly recognized administrator may
      // assess a refund. Other authenticated roles must never inherit admin
      // privileges through the absence of a deny condition.
      if (!actor || !actor.id ||
          (actor.role !== 'BUYER' && !isAdminRole(actor.role))) {
        const err = new Error('Only the owning buyer or an authorized administrator may assess refunds');
        err.code = 'UNAUTHORIZED_ROLE';
        err.statusCode = 403;
        throw err;
      }
      if (actor.role === 'BUYER' && Number(order.buyer_id) !== Number(actor.id)) {
        const err = new Error('Access denied: You do not own this order');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // Reserve the captured-payment ceiling across ALL outstanding claims,
      // not just approved ones. The locked parent order serializes assessments.
      // A pending request must not allow another pending request to overbook
      // the same money; rejected/cancelled claims are excluded.
      const [existingRefunds] = await connection.query(
        `SELECT COALESCE(SUM(total_refund_amount), 0) AS total_refunded
         FROM refund_obligations
         WHERE order_id = ? AND status IN
           ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'CONFIRMED',
            'AWAITING_EXTERNAL_EXECUTION', 'EXTERNAL_PROCESSING')`,
        [orderId]
      );

      const alreadyRefunded = existingRefunds[0]?.total_refunded ?? '0.00';
      const remainingRefundable = exactSub(
        order.captured_amount.toString(),
        alreadyRefunded.toString(),
        2
      );

      if (!exactDecimal.exactDecimalGte(remainingRefundable, '0.01', 2)) {
        const err = new Error('Order is already fully refunded; no refundable balance remains');
        err.code = 'ORDER_ALREADY_FULLY_REFUNDED';
        err.statusCode = 422;
        throw err;
      }

      // Determine assessed refund amount
      let assessedItemAmount = '0.00';
      let feeRefundAmount = '0.00';

      if (refundType === 'FULL') {
        assessedItemAmount = order.subtotal_amount.toString();
        feeRefundAmount = exactDecimal.exactDecimalSum([
          (order.delivery_fee || 0.00).toString(),
          (order.buyer_platform_fee || 0.00).toString()
        ], 2);
      } else {
        // PARTIAL: based on disputed quantity and locked order.unit_price
        if (!disputedQuantity || Number(disputedQuantity) <= 0) {
          const err = new Error('Valid disputed quantity is required for partial refund assessment');
          err.code = 'DISPUTED_QUANTITY_REQUIRED';
          err.statusCode = 400;
          throw err;
        }

        if (Number(disputedQuantity) > Number(order.total_qty)) {
          const err = new Error(`Disputed quantity (${disputedQuantity}) cannot exceed total order quantity (${order.total_qty})`);
          err.code = 'QUANTITY_EXCEEDS_ORDER';
          err.statusCode = 422;
          throw err;
        }

        // Server-calculated: exactMultiplyRound(qty, unit_price, 2)
        assessedItemAmount = exactDecimal.exactMultiplyRound(
          disputedQuantity.toString(),
          order.unit_price.toString(),
          2
        );
      }

      const totalRefundAmount = exactDecimal.exactDecimalSum([assessedItemAmount, feeRefundAmount], 2);

      // Verify not exceeding remaining refundable balance
      if (!exactDecimal.exactDecimalGte(remainingRefundable, totalRefundAmount, 2)) {
        const err = new Error(`Assessed refund amount (PKR ${totalRefundAmount}) exceeds remaining refundable balance (PKR ${remainingRefundable})`);
        err.code = 'REFUND_EXCEEDS_CAPTURED_AMOUNT';
        err.statusCode = 422;
        throw err;
      }

      // Idempotency check if key provided
      if (idempotencyKey) {
        const [existingIdem] = await connection.query(
          `SELECT * FROM refund_obligations WHERE idempotency_key = ?`,
          [idempotencyKey]
        );
        if (existingIdem.length > 0) {
          await connection.commit();
          return {
            success: true,
            message: 'Idempotent replay: Refund assessment already recorded',
            data: { refund: existingIdem[0] }
          };
        }
      }

      const refundCode = `RFND-${order.order_code.slice(-8)}-${Date.now().toString().slice(-4)}`;
      const initialStatus = isAdminRole(actor.role) ? 'UNDER_REVIEW' : 'REQUESTED';

      const [refundInsert] = await connection.query(
        `INSERT INTO refund_obligations (
          refund_code, order_id, payment_id, buyer_id, dispute_id,
          disputed_quantity, assessed_refund_amount, fee_refund_amount,
          total_refund_amount, currency, refund_type, status,
          external_execution_status, idempotency_key, audit_notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', ?, ?, 'DISABLED', ?, ?, NOW())`,
        [
          refundCode,
          order.id,
          order.payment_row_id,
          order.buyer_id,
          disputeId,
          disputedQuantity,
          assessedItemAmount,
          feeRefundAmount,
          totalRefundAmount,
          refundType,
          initialStatus,
          idempotencyKey,
          reason
        ]
      );

      const refundId = refundInsert.insertId;

      // Automatically place a financial hold for the refund amount on supplier payable
      const [payables] = await connection.query(
        `SELECT * FROM supplier_payables WHERE order_id = ? FOR UPDATE`,
        [orderId]
      );

      if (payables.length > 0) {
        const payable = payables[0];
        const holdCode = `HOLD-RFND-${refundId}-${Date.now().toString().slice(-4)}`;
        const currentHeld = payable.held_amount.toString();
        const newHeld = exactDecimal.exactDecimalSum([currentHeld, assessedItemAmount], 2);
        const maxEntitlement = exactSub(
          payable.net_payable_amount.toString(),
          payable.refund_deduction_amount.toString(),
          2
        );
        // Holds cannot exceed the supplier's remaining entitlement.
        // If this refund exceeds supplier proceeds, an admin needs a
        // separate platform-funded refund policy; never manufacture a negative
        // or unbacked supplier balance.
        if (!exactDecimal.exactDecimalGte(maxEntitlement, newHeld, 2)) {
          const err = new Error('Supplier payable cannot cover the requested refund hold');
          err.code = 'REFUND_HOLD_EXCEEDS_PAYABLE';
          err.statusCode = 422;
          throw err;
        }
        const newAvailable = exactSub(maxEntitlement, newHeld, 2);

        await connection.query(
          `INSERT INTO financial_holds (
            hold_code, order_id, supplier_payable_id, dispute_id,
            hold_amount, currency, reason, status, placed_by_role,
            placed_by_id, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, 'PKR', 'ACTIVE_DISPUTE', 'ACTIVE', 'SYSTEM', ?, ?, NOW())`,
          [
            holdCode,
            orderId,
            payable.id,
            disputeId,
            assessedItemAmount,
            actor.id,
            `Auto-hold for pending refund obligation ${refundCode}`
          ]
        );

        await connection.query(
          `UPDATE supplier_payables
           SET held_amount = ?, available_amount = ?, status = 'ON_HOLD', updated_at = NOW()
           WHERE id = ?`,
          [newHeld, newAvailable, payable.id]
        );
      }

      // Audit
      await this._logAuditEvent(connection, {
        orderId: order.id,
        paymentId: order.payment_row_id,
        entityType: 'REFUND_OBLIGATION',
        entityId: refundId,
        eventType: 'REFUND_REQUESTED',
        actorRole: actor.role,
        actorId: actor.id,
        fromStatus: null,
        toStatus: initialStatus,
        amountDelta: totalRefundAmount,
        notes: `Assessed refund obligation: PKR ${totalRefundAmount} (${refundType})`
      });

      await connection.commit();

      const [createdRefund] = await connection.query('SELECT * FROM refund_obligations WHERE id = ?', [refundId]);

      return {
        success: true,
        message: 'Refund obligation successfully assessed',
        data: { refund: createdRefund[0] }
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Approves a refund obligation (Admin only).
   * Deducts from supplier payable and updates internal accounting.
   * External execution remains strictly DISABLED.
   */
  async approveRefundObligation({ refundId, notes = null, actor }) {
    if (!actor || !actor.id || !isFinancialAdminRole(actor.role)) {
      const err = new Error('Refund approval is strictly restricted to finance administrators');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      const [refunds] = await connection.query(
        `SELECT r.*, o.order_code
         FROM refund_obligations r
         JOIN orders o ON r.order_id = o.id
         WHERE r.id = ? FOR UPDATE`,
        [refundId]
      );

      if (refunds.length === 0) {
        const err = new Error('Refund obligation record not found');
        err.code = 'REFUND_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const refund = refunds[0];

      if (!['REQUESTED', 'UNDER_REVIEW'].includes(refund.status)) {
        const err = new Error(`Cannot approve refund in status '${refund.status}'. Expected REQUESTED or UNDER_REVIEW.`);
        err.code = 'INVALID_REFUND_STATUS';
        err.statusCode = 422;
        throw err;
      }

      // Lock supplier payable
      const [payables] = await connection.query(
        `SELECT * FROM supplier_payables WHERE order_id = ? FOR UPDATE`,
        [refund.order_id]
      );

      if (payables.length !== 1) {
        const err = new Error('Refund cannot be approved before supplier liability and funding are reconciled');
        err.code = 'REFUND_PAYABLE_RECONCILIATION_REQUIRED';
        err.statusCode = 409;
        throw err;
      }
      const [payoutInstructions] = await connection.query(
        'SELECT id FROM supplier_disbursement_instructions WHERE supplier_payable_id=? LIMIT 1 FOR UPDATE',
        [payables[0].id]
      );
      if (payoutInstructions.length) {
        const err = new Error('Approved refund cannot overtake a previously prepared supplier payout');
        err.code = 'REFUND_DISBURSEMENT_CONFLICT';
        err.statusCode = 409;
        throw err;
      }
      if (payables.length > 0) {
        const payable = payables[0];

        // Deduct approved refund amount from supplier net payable
        const refundItemAmount = refund.assessed_refund_amount.toString();
        const currentDeductions = payable.refund_deduction_amount.toString();
        const newDeductions = exactDecimal.exactDecimalSum([currentDeductions, refundItemAmount], 2);

        // Forfeit the auto-hold
        const [holds] = await connection.query(
          `SELECT id, hold_amount FROM financial_holds
           WHERE order_id = ? AND supplier_payable_id = ?
             AND hold_code LIKE ? AND status = 'ACTIVE' FOR UPDATE`,
          [refund.order_id, payable.id, `HOLD-RFND-${refundId}-%`]
        );
        if (holds.length !== 1 ||
            !exactDecimal.exactDecimalGte(holds[0].hold_amount.toString(), refundItemAmount, 2) ||
            !exactDecimal.exactDecimalGte(refundItemAmount, holds[0].hold_amount.toString(), 2)) {
          const err = new Error('Refund-specific financial hold is missing or inconsistent');
          err.code = 'REFUND_HOLD_MISMATCH';
          err.statusCode = 409;
          throw err;
        }
        const currentHeld = payable.held_amount.toString();
        if (!exactDecimal.exactDecimalGte(currentHeld, refundItemAmount, 2)) {
          const err = new Error('Supplier held balance is below the refund hold');
          err.code = 'REFUND_HELD_BALANCE_MISMATCH';
          err.statusCode = 409;
          throw err;
        }
        await connection.query(
          `UPDATE financial_holds SET status = 'FORFEITED_TO_REFUND', updated_at = NOW() WHERE id = ?`,
          [holds[0].id]
        );
        const newHeld = exactSub(currentHeld, refundItemAmount, 2);

        const maxEntitlement = exactSub(
          payable.net_payable_amount.toString(),
          newDeductions,
          2
        );
        if (!exactDecimal.exactDecimalGte(maxEntitlement, newHeld, 2)) {
          const err = new Error('Refund deductions and other financial holds exceed supplier entitlement');
          err.code = 'REFUND_PAYABLE_BALANCE_MISMATCH';
          err.statusCode = 409;
          throw err;
        }
        const newAvailable = exactSub(maxEntitlement, newHeld, 2);

        await connection.query(
          `UPDATE supplier_payables
           SET refund_deduction_amount = ?, held_amount = ?, available_amount = ?, updated_at = NOW()
           WHERE id = ?`,
          [newDeductions, newHeld, newAvailable, payable.id]
        );
      }

      // Update Refund Status: APPROVED (External execution remains DISABLED)
      await connection.query(
        `UPDATE refund_obligations
         SET status = 'APPROVED', approved_by = ?, approved_at = NOW(),
             audit_notes = CONCAT_WS(' | ', audit_notes, ?),
             updated_at = NOW()
         WHERE id = ?`,
        [actor.id, notes, refundId]
      );

      // Audit
      await this._logAuditEvent(connection, {
        orderId: refund.order_id,
        paymentId: refund.payment_id,
        entityType: 'REFUND_OBLIGATION',
        entityId: refundId,
        eventType: 'REFUND_APPROVED',
        actorRole: actor.role,
        actorId: actor.id,
        fromStatus: refund.status,
        toStatus: 'APPROVED',
        amountDelta: refund.total_refund_amount.toString(),
        notes: `Admin approved refund obligation of PKR ${refund.total_refund_amount}. External execution remains DISABLED.`
      });

      await connection.commit();

      const [updatedRefund] = await connection.query('SELECT * FROM refund_obligations WHERE id = ?', [refundId]);

      return {
        success: true,
        message: 'Refund obligation approved. Recorded internally; external execution disabled.',
        data: { refund: updatedRefund[0] }
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * SECURITY STOP: an admin-supplied reference is not Safepay-issued proof
   * that a refund was actually executed. Until provider-authenticated refund
   * events or a verified server-to-server refund-status API is integrated,
   * this historical endpoint cannot label money as returned.
   *
   * Assessment and approval remain available, but neither marks CONFIRMED.
   * No client-provided reference or attachment can bypass this rule.
   */
  async recordManualConfirmedRefund({ refundId, externalReference, notes = null, actor }) {
    if (!actor || !isAdminRole(actor.role)) {
      const err = new Error('Only authorized administrators may access refund confirmation');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }
    const err = new Error('Safepay-authenticated refund completion evidence is required before a refund may be confirmed');
    err.code = 'PROVIDER_REFUND_VERIFICATION_REQUIRED';
    err.statusCode = 409;
    throw err;
  }

  // ===========================================================================
  // 4. SUPPLIER DISBURSEMENT PREPARATION & APPROVAL
  // ===========================================================================

  /**
   * Prepares a supplier disbursement instruction.
   * Validates supplier eligibility, buyer confirmed receipt, and hold-free balances.
   * External payout execution is strictly DISABLED.
   */
  async prepareSupplierDisbursement({
    payableId,
    beneficiaryTitle,
    beneficiaryIban,
    beneficiaryBankCode = null,
    actor,
    idempotencyKey = null
  }) {
    if (!actor || !actor.id || !isFinancialAdminRole(actor.role)) {
      const err = new Error('Only authorized finance administrators may prepare supplier disbursements');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }
    if (!idempotencyKey || typeof idempotencyKey !== 'string' ||
        idempotencyKey.trim().length < 8 || idempotencyKey.length > 120) {
      const err = new Error('Valid idempotency key is mandatory for disbursement preparation');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.statusCode = 400;
      throw err;
    }
    if (!beneficiaryTitle || String(beneficiaryTitle).trim().length < 3) {
      const err = new Error('Beneficiary title is required (minimum 3 characters)');
      err.code = 'INVALID_BENEFICIARY_TITLE';
      err.statusCode = 400;
      throw err;
    }

    const cleanIban = String(beneficiaryIban || '').replace(/\s+/g, '').toUpperCase();
    if (!cleanIban.startsWith('PK') || cleanIban.length !== 24) {
      const err = new Error('Valid 24-character Pakistani IBAN starting with PK is required');
      err.code = 'INVALID_IBAN';
      err.statusCode = 400;
      throw err;
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 1. Lock and fetch supplier payable with order & supplier profile
      const [payables] = await connection.query(
        `SELECT sp.*, o.order_code, o.fulfillment_status, o.order_status,
                u.is_verified AS supplier_user_verified,
                prof.verification_status AS supplier_profile_status
         FROM supplier_payables sp
         JOIN orders o ON sp.order_id = o.id
         JOIN users u ON sp.supplier_id = u.id
         LEFT JOIN supplier_profiles prof ON prof.supplier_id = sp.supplier_id
         WHERE sp.id = ? FOR UPDATE`,
        [payableId]
      );

      if (payables.length === 0) {
        const err = new Error('Supplier payable not found');
        err.code = 'PAYABLE_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const payable = payables[0];

      // Existing instruction check is serialized by the locked payable row.
      // Never create a second payout intent for the same payable, even when
      // a caller supplies a different idempotency key or changes IBAN.
      const [existingInstructions] = await connection.query(
        `SELECT * FROM supplier_disbursement_instructions
         WHERE supplier_payable_id = ? ORDER BY id ASC FOR UPDATE`,
        [payable.id]
      );
      const [globalReplays] = await connection.query(
        `SELECT * FROM supplier_disbursement_instructions
         WHERE idempotency_key = ? FOR UPDATE`,
        [idempotencyKey.trim()]
      );
      const replay = existingInstructions.find(x => x.idempotency_key === idempotencyKey.trim());
      if (globalReplays.length &&
          (!replay || Number(globalReplays[0].id) !== Number(replay.id))) {
        const err = new Error('Idempotency key belongs to a different disbursement');
        err.code = 'DISBURSEMENT_IDEMPOTENCY_CONFLICT';
        err.statusCode = 409;
        throw err;
      }
      if (replay &&
          replay.beneficiary_iban === cleanIban &&
          replay.beneficiary_title === beneficiaryTitle.trim() &&
          String(replay.beneficiary_bank_code || '') === String(beneficiaryBankCode || '') &&
          exactDecimal.exactDecimalEquals(replay.amount, payable.available_amount, 2)) {
        await connection.commit();
        return {
          success: true,
          message: 'Idempotent replay: disbursement instruction already recorded',
          data: { disbursement: replay }
        };
      }
      if (existingInstructions.length > 0 || globalReplays.length > 0) {
        const err = new Error('Disbursement already prepared or idempotency payload differs; reconciliation required');
        err.code = 'DISBURSEMENT_ALREADY_EXISTS';
        err.statusCode = 409;
        throw err;
      }

      // Supplier Affirmative Verification Invariant
      if (!payable.supplier_user_verified || payable.supplier_profile_status !== 'VERIFIED') {
        const err = new Error('Supplier must be affirmatively verified before preparing disbursement');
        err.code = 'SUPPLIER_NOT_VERIFIED';
        err.statusCode = 403;
        throw err;
      }

      // Fulfillment must be BUYER_CONFIRMED or COMPLETED
      if (!['BUYER_CONFIRMED', 'COMPLETED'].includes(payable.fulfillment_status)) {
        const err = new Error(`Order fulfillment is '${payable.fulfillment_status}'. Disbursement requires BUYER_CONFIRMED or COMPLETED.`);
        err.code = 'ORDER_NOT_BUYER_CONFIRMED';
        err.statusCode = 422;
        throw err;
      }

      // Internal PAID labels are not provider evidence. A supplier payout
      // needs an independently verified Safepay completion linked to this
      // captured payment and authoritative order.
      const [paymentEvidence] = await connection.query(
        `SELECT pa.id FROM payment_attempts pa
         JOIN payments p ON p.transaction_ref = pa.provider_tracker_token
         WHERE pa.order_id=? AND p.id=? AND pa.status='COMPLETED'
           AND p.status IN ('PAID','PARTIALLY_REFUNDED')
         LIMIT 2 FOR UPDATE`,
        [payable.order_id,payable.payment_id]
      );
      if (paymentEvidence.length!==1) {
        const err = new Error('Authoritative completed Safepay capture evidence is required before payout');
        err.code = 'SUPPLIER_PAYOUT_PROVIDER_PROOF_REQUIRED';
        err.statusCode = 409;
        throw err;
      }

      // A pending or approved refund is a live claim even before gateway
      // execution. It must not be paid away to the supplier.
      const [refundClaims] = await connection.query(
        `SELECT id FROM refund_obligations
         WHERE order_id = ? AND status IN
           ('REQUESTED','UNDER_REVIEW','APPROVED',
            'AWAITING_EXTERNAL_EXECUTION','EXTERNAL_PROCESSING')
         LIMIT 1 FOR UPDATE`,
        [payable.order_id]
      );
      if (refundClaims.length > 0) {
        const err = new Error('Open refund obligation prevents disbursement preparation');
        err.code = 'PENDING_REFUND_DISBURSEMENT_BLOCKED';
        err.statusCode = 409;
        throw err;
      }

      // Validate the full payable conservation equation before creating a
      // durable instruction. Never use floating point for money comparisons.
      const netAfterRefund = exactSub(
        payable.net_payable_amount.toString(),
        payable.refund_deduction_amount.toString(), 2
      );
      const expectedAvailable = exactSub(
        netAfterRefund, payable.held_amount.toString(), 2
      );
      if (!exactDecimal.exactDecimalEquals(
            expectedAvailable, payable.available_amount.toString(), 2) ||
          !exactDecimal.exactDecimalGte(expectedAvailable, '0.00', 2) ||
          !exactDecimal.exactDecimalEquals(payable.disbursed_amount || '0.00', '0.00', 2)) {
        const err = new Error('Supplier payable balances require reconciliation');
        err.code = 'PAYABLE_ACCOUNTING_MISMATCH';
        err.statusCode = 409;
        throw err;
      }
      if (!['ACCRUED', 'ELIGIBLE_FOR_DISBURSEMENT'].includes(payable.status)) {
        const err = new Error('Supplier payable status does not permit a new disbursement');
        err.code = 'PAYABLE_DISBURSEMENT_STATE_CONFLICT';
        err.statusCode = 409;
        throw err;
      }

      // Cannot disburse if active holds exist
      if (!exactDecimal.exactDecimalEquals(payable.held_amount, '0.00', 2)) {
        const err = new Error(`Cannot prepare disbursement while active financial holds exist (Held: PKR ${payable.held_amount})`);
        err.code = 'PAYABLE_HAS_ACTIVE_HOLDS';
        err.statusCode = 422;
        throw err;
      }

      // Available amount check
      const availableAmount = payable.available_amount.toString();
      if (!exactDecimal.exactDecimalGte(availableAmount, '0.01', 2)) {
        const err = new Error('No available funds remaining for disbursement on this payable');
        err.code = 'ZERO_AVAILABLE_FUNDS';
        err.statusCode = 422;
        throw err;
      }

      const disbursementCode = `DISB-${payable.order_code.slice(-8)}-${Date.now().toString().slice(-4)}`;

      const [disbInsert] = await connection.query(
        `INSERT INTO supplier_disbursement_instructions (
          disbursement_code, supplier_id, supplier_payable_id, order_id,
          beneficiary_title, beneficiary_iban, beneficiary_bank_code,
          amount, currency, status, external_execution_status, idempotency_key,
          prepared_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PKR', 'PREPARED', 'DISABLED', ?, ?, NOW())`,
        [
          disbursementCode,
          payable.supplier_id,
          payable.id,
          payable.order_id,
          beneficiaryTitle.trim(),
          cleanIban,
          beneficiaryBankCode,
          availableAmount,
          idempotencyKey.trim(),
          actor.id
        ]
      );

      const disbId = disbInsert.insertId;

      // Update payable status to DISBURSEMENT_PREPARED
      await connection.query(
        `UPDATE supplier_payables
         SET status = 'DISBURSEMENT_PREPARED', updated_at = NOW()
         WHERE id = ?`,
        [payable.id]
      );

      // Audit
      await this._logAuditEvent(connection, {
        orderId: payable.order_id,
        paymentId: payable.payment_id,
        entityType: 'DISBURSEMENT',
        entityId: disbId,
        eventType: 'DISBURSEMENT_PREPARED',
        actorRole: actor.role,
        actorId: actor.id,
        fromStatus: null,
        toStatus: 'PREPARED',
        amountDelta: availableAmount,
        notes: `Prepared disbursement instruction of PKR ${availableAmount} to IBAN ${cleanIban.slice(0, 4)}...${cleanIban.slice(-4)}. External execution DISABLED.`
      });

      await connection.commit();

      const [createdDisb] = await connection.query('SELECT * FROM supplier_disbursement_instructions WHERE id = ?', [disbId]);

      return {
        success: true,
        message: 'Supplier disbursement instruction successfully prepared (External execution disabled)',
        data: { disbursement: createdDisb[0] }
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Approves a prepared supplier disbursement (Admin only).
   * External execution remains strictly DISABLED.
   */
  async approveSupplierDisbursement({ disbursementId, notes = null, actor }) {
    if (!actor || !actor.id || !isFinancialAdminRole(actor.role)) {
      const err = new Error('Disbursement approval is strictly restricted to finance administrators');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Serialize approval against any hold/refund/disbursement preparation:
      // acquire payable lock BEFORE instruction lock (shared lock ordering).
      const [links] = await connection.query(
        'SELECT supplier_payable_id FROM supplier_disbursement_instructions WHERE id = ?',
        [disbursementId]
      );
      if (links.length === 0) {
        const err = new Error('Disbursement instruction record not found');
        err.code = 'DISBURSEMENT_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }
      const [payables] = await connection.query(
        'SELECT * FROM supplier_payables WHERE id = ? FOR UPDATE',
        [links[0].supplier_payable_id]
      );
      if (payables.length !== 1) {
        const err = new Error('Supplier payable is missing');
        err.code = 'PAYABLE_NOT_FOUND';
        err.statusCode = 409;
        throw err;
      }
      const payable = payables[0];
      const [disbursements] = await connection.query(
        `SELECT d.*, sp.order_id, sp.payment_id,
                o.fulfillment_status,
                u.is_verified AS supplier_user_verified,
                prof.verification_status AS supplier_profile_status
         FROM supplier_disbursement_instructions d
         JOIN supplier_payables sp ON d.supplier_payable_id = sp.id
         JOIN orders o ON o.id = sp.order_id
         JOIN users u ON u.id = sp.supplier_id
         LEFT JOIN supplier_profiles prof ON prof.supplier_id = sp.supplier_id
         WHERE d.id = ? FOR UPDATE`,
        [disbursementId]
      );

      if (disbursements.length === 0) {
        const err = new Error('Disbursement instruction record not found');
        err.code = 'DISBURSEMENT_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const disb = disbursements[0];

      // Separation of duties is fail-closed, including legacy rows whose
      // preparer identity is missing or unverifiable.
      if (disb.prepared_by === null || disb.prepared_by === undefined ||
          !Number.isSafeInteger(Number(disb.prepared_by)) ||
          Number(disb.prepared_by) <= 0) {
        const err = new Error('Original payout preparer identity is not verified');
        err.code = 'DISBURSEMENT_PREPARER_UNVERIFIED';
        err.statusCode = 409;
        throw err;
      }
      if (Number(disb.prepared_by) === Number(actor.id)) {
        const err = new Error('A second authorized administrator must approve a supplier payout');
        err.code = 'DISBURSEMENT_DUAL_CONTROL_REQUIRED';
        err.statusCode = 403;
        throw err;
      }

      if (disb.status !== 'PREPARED') {
        const err = new Error(`Cannot approve disbursement in status '${disb.status}'. Expected PREPARED.`);
        err.code = 'DISBURSEMENT_NOT_PREPARED';
        err.statusCode = 422;
        throw err;
      }

      // Financial approval is not a stale approval of eligibility at prepare
      // time. Check current supplier verification and buyer receipt again.
      if (!disb.supplier_user_verified || disb.supplier_profile_status !== 'VERIFIED' ||
          !['BUYER_CONFIRMED', 'COMPLETED'].includes(disb.fulfillment_status) ||
          disb.external_execution_status !== 'DISABLED') {
        const err = new Error('Supplier, delivery or external execution state changed; payout approval blocked');
        err.code = 'DISBURSEMENT_ELIGIBILITY_REVOKED';
        err.statusCode = 409;
        throw err;
      }

      // Internal PAID labels are not provider evidence. A supplier payout
      // needs an independently verified Safepay completion linked to this
      // captured payment and authoritative order.
      const [paymentEvidence] = await connection.query(
        `SELECT pa.id FROM payment_attempts pa
         JOIN payments p ON p.transaction_ref = pa.provider_tracker_token
         WHERE pa.order_id=? AND p.id=? AND pa.status='COMPLETED'
           AND p.status IN ('PAID','PARTIALLY_REFUNDED')
         LIMIT 2 FOR UPDATE`,
        [payable.order_id,payable.payment_id]
      );
      if (paymentEvidence.length!==1) {
        const err = new Error('Authoritative completed Safepay capture evidence is required before payout');
        err.code = 'SUPPLIER_PAYOUT_PROVIDER_PROOF_REQUIRED';
        err.statusCode = 409;
        throw err;
      }

      const [pendingClaims] = await connection.query(
        `SELECT id FROM refund_obligations
         WHERE order_id = ? AND status IN
           ('REQUESTED','UNDER_REVIEW','APPROVED',
            'AWAITING_EXTERNAL_EXECUTION','EXTERNAL_PROCESSING')
         LIMIT 1 FOR UPDATE`,
        [payable.order_id]
      );
      const [activeHolds] = await connection.query(
        `SELECT id FROM financial_holds
         WHERE supplier_payable_id = ? AND status = 'ACTIVE'
         LIMIT 1 FOR UPDATE`,
        [payable.id]
      );
      if (pendingClaims.length || activeHolds.length ||
          !exactDecimal.exactDecimalEquals(payable.held_amount, '0.00', 2) ||
          !exactDecimal.exactDecimalEquals(payable.disbursed_amount || '0.00', '0.00', 2) ||
          !exactDecimal.exactDecimalEquals(
            exactSub(
              exactSub(payable.net_payable_amount, payable.refund_deduction_amount, 2),
              payable.held_amount, 2
            ), payable.available_amount, 2
          ) ||
          !exactDecimal.exactDecimalEquals(payable.available_amount, disb.amount, 2) ||
          payable.status !== 'DISBURSEMENT_PREPARED') {
        const err = new Error('Disbursement financial conditions changed after preparation');
        err.code = 'DISBURSEMENT_REAPPROVAL_REQUIRED';
        err.statusCode = 409;
        throw err;
      }

      await connection.query(
        `UPDATE supplier_disbursement_instructions
         SET status = 'APPROVED', approved_by = ?, approved_at = NOW(),
             audit_notes = CONCAT_WS(' | ', audit_notes, ?),
             updated_at = NOW()
         WHERE id = ?`,
        [actor.id, notes, disbursementId]
      );

      // Audit
      await this._logAuditEvent(connection, {
        orderId: disb.order_id,
        paymentId: disb.payment_id,
        entityType: 'DISBURSEMENT',
        entityId: disbursementId,
        eventType: 'DISBURSEMENT_APPROVED',
        actorRole: actor.role,
        actorId: actor.id,
        fromStatus: 'PREPARED',
        toStatus: 'APPROVED',
        amountDelta: disb.amount.toString(),
        notes: `Admin approved disbursement instruction of PKR ${disb.amount}. External execution remains DISABLED.`
      });

      await connection.commit();

      const [updatedDisb] = await connection.query('SELECT * FROM supplier_disbursement_instructions WHERE id = ?', [disbursementId]);

      return {
        success: true,
        message: 'Disbursement instruction approved. External execution remains disabled.',
        data: { disbursement: updatedDisb[0] }
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // 5. PROVIDER SETTLEMENT RECONCILIATION
  // ===========================================================================

  /**
   * Reconciles a Safepay provider settlement batch (e.g. from settlement CSV or API).
   */
  async reconcileProviderSettlementBatch({
    batchReference, grossAmount, providerFee, netAmount, settlementDate,
    matchedTrackerTokens = [], rawMetadata = null, actor
  }) {
    if (!actor || !actor.id || !isFinancialAdminRole(actor.role)) {
      const err = new Error('Provider settlement reconciliation requires an authorized administrator');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }
    // A spreadsheet, admin-entered gross/net total, or matching token count
    // is NOT independently verified proof of funds received by MilJor.
    // Do not persist RECONCILED until an authenticated Safepay provider
    // settlement endpoint or cryptographically trusted settlement artifact
    // and custody agreement have been integrated and reconciled.
    const err = new Error('Authenticated Safepay settlement evidence is required; admin-entered totals cannot mark a batch reconciled');
    err.code = 'PROVIDER_SETTLEMENT_EVIDENCE_REQUIRED';
    err.statusCode = 409;
    throw err;
  }

  // ===========================================================================
  // 6. READ MODELS & QUERY METHODS
  // ===========================================================================

  /**
   * Retrieves buyer's refund obligations.
   */
  async getBuyerRefunds({ buyerId, orderId = null, page = 1, limit = 20 }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let query = `SELECT r.*, o.order_code FROM refund_obligations r JOIN orders o ON r.order_id = o.id WHERE r.buyer_id = ?`;
    const params = [buyerId];

    if (orderId) {
      query += ` AND r.order_id = ?`;
      params.push(orderId);
    }

    query += ` ORDER BY r.id DESC LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);

    const [rows] = await db.query(query, params);
    return { refunds: rows, page: pageNum, limit: limitNum };
  }

  /**
   * Retrieves supplier's payables.
   */
  async getSupplierPayables({ supplierId, status = null, page = 1, limit = 20 }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let query = `SELECT sp.*, o.order_code, o.fulfillment_status FROM supplier_payables sp JOIN orders o ON sp.order_id = o.id WHERE sp.supplier_id = ?`;
    const params = [supplierId];

    if (status) {
      query += ` AND sp.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY sp.id DESC LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);

    const [rows] = await db.query(query, params);
    return { payables: rows, page: pageNum, limit: limitNum };
  }

  /**
   * Retrieves administrative overview of financial records.
   */
  async getAdminFinancialOverview({ orderId = null, page = 1, limit = 20 }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    let pQuery = `SELECT sp.*, o.order_code, u.full_name AS supplier_name FROM supplier_payables sp JOIN orders o ON sp.order_id = o.id JOIN users u ON sp.supplier_id = u.id`;
    const params = [];

    if (orderId) {
      pQuery += ` WHERE sp.order_id = ?`;
      params.push(orderId);
    }

    pQuery += ` ORDER BY sp.id DESC LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);

    const [payables] = await db.query(pQuery, params);
    const [holds] = await db.query(`SELECT * FROM financial_holds ORDER BY id DESC LIMIT 20`);
    const [refunds] = await db.query(`SELECT r.*, o.order_code FROM refund_obligations r JOIN orders o ON r.order_id = o.id ORDER BY r.id DESC LIMIT 20`);
    const [disbursements] = await db.query(`SELECT * FROM supplier_disbursement_instructions ORDER BY id DESC LIMIT 20`);

    return {
      payables,
      holds,
      refunds,
      disbursements,
      page: pageNum,
      limit: limitNum
    };
  }

  /**
   * Retrieves financial audit trail for an entity or order.
   */
  async getFinancialAuditTrail({ entityType = null, entityId = null, orderId = null, page = 1, limit = 50 }) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    let query = `SELECT * FROM financial_audit_events WHERE 1=1`;
    const params = [];

    if (entityType && entityId) {
      query += ` AND entity_type = ? AND entity_id = ?`;
      params.push(entityType, entityId);
    }
    if (orderId) {
      query += ` AND order_id = ?`;
      params.push(orderId);
    }

    query += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);

    const [events] = await db.query(query, params);
    return { events, page: pageNum, limit: limitNum };
  }
}

module.exports = new FinancialSettlementService();
