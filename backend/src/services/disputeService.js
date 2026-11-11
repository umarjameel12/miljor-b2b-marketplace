// =============================================================================
// src/services/disputeService.js
// MilJor Part 4E.5: Buyer Protection, Dispute & Fulfillment Exception Resolution Foundation
//
// Invariants enforced:
// 1. Correctness > Data Safety > Security > Financial Integrity > Maintainability
// 2. Paid-Only Eligibility: Only authoritative PAID orders participate.
// 3. Strict Tenant Isolation:
//    - Buyer can only view and manage disputes for their own orders.
//    - Supplier can only view and respond to disputes for their assigned orders.
//    - Admin has arbitration authority and read-only cross-tenant visibility.
// 4. Exact-Decimal Claim Assessment:
//    - Claimed amounts calculated exclusively from authoritative locked commercial
//      order prices via exactDecimal. Client inputs for prices/amounts are ignored.
//    - Financial calculations are non-executable assessments; zero money movement.
// 5. Line-Item & Quantity Integrity:
//    - Disputed quantity must be non-negative and <= total_qty.
//    - Overlapping active claims for the same order quantity are rejected.
// 6. Concurrency & Atomicity:
//    - Parent order row-level FOR UPDATE locking serializes disputes, receipt
//      confirmations, and fulfillment transitions.
//    - Mandatory X-Idempotency-Key on all mutations.
// 7. Delivery & Receipt Separation:
//    - Supplier proposed replacement or delivery DOES NOT imply buyer receipt.
//    - Buyer retains affirmative receipt authority over remediation goods.
// 8. Escrow Invariant:
//    - payments.escrow_status strictly remains unchanged (HELD_IN_ESCROW).
//    - Zero automated refund, payout, or ledger mutations.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/db');
const exactDecimal = require('./exactDecimal');
const {shortageForAwardLine}=require('./b7LineDeliveryPolicy');
const reservationEventService = require('./reservationEventService');
const supplierEligibilityPolicy = require('./supplierEligibilityPolicy');

const DISPUTE_CATEGORIES = [
  'SHORT_QUANTITY',
  'DAMAGED_GOODS',
  'WRONG_ITEM',
  'QUALITY_PROBLEM',
  'MISSING_ITEMS',
  'SUPPLIER_SHORTAGE',
  'OTHER'
];

const REMEDIATION_PROPOSALS = [
  'NONE',
  'DELIVER_MISSING_QUANTITY',
  'REPLACE_DAMAGED_GOODS',
  'CORRECT_WRONG_ITEM',
  'EXPLANATION_CONTEST',
  'ESCALATE_FOR_ADMIN_REVIEW'
];

const ADMIN_DECISIONS = [
  'BUYER_CLAIM_ACCEPTED',
  'BUYER_CLAIM_REJECTED',
  'PARTIAL_CLAIM_ACCEPTED',
  'SUPPLIER_REMEDIATION_REQUIRED',
  'FINANCIAL_REVIEW_REQUIRED'
];

const ACTIVE_DISPUTE_STATUSES = [
  'OPEN',
  'AWAITING_SUPPLIER_RESPONSE',
  'UNDER_ADMIN_REVIEW',
  'EVIDENCE_REQUESTED',
  'SUPPLIER_REMEDIATION_PROPOSED',
  'SUPPLIER_REMEDIATION_IN_PROGRESS',
  'SUPPLIER_REMEDIATION_COMPLETED',
  'RESOLUTION_RECORDED',
  'ESCALATED_FINANCIAL_REVIEW',
  'SUPPLIER_RESPONSE',
  'BUYER_RESPONSE',
  'UNDER_REVIEW',
  'ESCALATED'
];

class DisputeService {

  /**
   * Helper to generate deterministic event code for dispute timeline
   */
  _generateEventCode(disputeId, action, idempotencyKey) {
    const raw = `${disputeId}:${action}:${(idempotencyKey || '').trim()}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16);
    return `DE-DSP-${disputeId}-${action}-${hash}`;
  }

  /**
   * Validates evidence metadata ensuring no dangerous local paths or payloads
   */
  _sanitizeEvidenceMetadata(metadata) {
    if (!metadata) return null;
    if (typeof metadata !== 'object') {
      const err = new Error('Evidence metadata must be a valid JSON object or array');
      err.code = 'INVALID_EVIDENCE_METADATA';
      err.statusCode = 400;
      throw err;
    }

    const jsonStr = JSON.stringify(metadata);
    // Disallow local file schemes or path traversals
    if (jsonStr.includes('file://') || jsonStr.includes(':\\') || jsonStr.includes('..\\') || jsonStr.includes('../')) {
      const err = new Error('Evidence metadata contains forbidden file URI schemes or path traversals');
      err.code = 'FORBIDDEN_EVIDENCE_REFERENCE';
      err.statusCode = 400;
      throw err;
    }

    return metadata;
  }

  /**
   * Helper to verify verified supplier account and profile status
   */
  async _assertVerifiedSupplier(actor, connection) {
    if (!actor || !actor.id || actor.role !== 'SUPPLIER') {
      const err = new Error('Only authorized suppliers can perform this action');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    const [suppRows] = await connection.query(
      `SELECT u.id, u.role, u.is_verified, u.verification_status,
              sp.verification_status AS profile_verification_status
       FROM users u
       LEFT JOIN supplier_profiles sp ON u.id = sp.supplier_id
       WHERE u.id = ?`,
      [actor.id]
    );

    if (suppRows.length === 0) {
      const err = new Error('Supplier account not found');
      err.code = 'SUPPLIER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const supplierData = suppRows[0];
    const eligibility = supplierEligibilityPolicy.evaluateSupplierEligibility(supplierData);
    if (!eligibility.eligible) {
      const err = new Error(eligibility.reason || 'Supplier account or profile is not verified');
      err.code = eligibility.code || 'SUPPLIER_NOT_VERIFIED';
      err.statusCode = 403;
      throw err;
    }

    return supplierData;
  }

  // ===========================================================================
  // 1. BUYER DISPUTE CREATION
  // ===========================================================================

  /**
   * Buyer files a dispute against an eligible owned order
   */
  async createBuyerDispute({
    orderId,
    actor,
    category,
    description,
    disputedQuantity = null,
    reportedQuantity = null,
    evidenceMetadata = null,
    evidenceImageUrl = null,
    idempotencyKey
  }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ORDER_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!actor || !actor.id || actor.role !== 'BUYER') {
      const err = new Error('Only buyers can file delivery discrepancy disputes');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    if (!category || !DISPUTE_CATEGORIES.includes(category)) {
      const err = new Error(`Invalid dispute category. Allowed: [${DISPUTE_CATEGORIES.join(', ')}]`);
      err.code = 'INVALID_DISPUTE_CATEGORY';
      err.statusCode = 400;
      throw err;
    }

    if (!description || typeof description !== 'string' || description.trim().length < 10) {
      const err = new Error('Meaningful dispute description (minimum 10 characters) is required');
      err.code = 'DESCRIPTION_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('X-Idempotency-Key header is mandatory for filing disputes');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const cleanMetadata = this._sanitizeEvidenceMetadata(evidenceMetadata);
    const trimmedKey = idempotencyKey.trim();
    const connection = await db.getConnection();

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();

      // Lock parent order row exclusively
      const [orderRows] = await connection.query(
        `SELECT * FROM orders WHERE id = ? FOR UPDATE`,
        [orderId]
      );

      if (orderRows.length === 0) {
        const err = new Error(`Order with ID ${orderId} not found`);
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const order = orderRows[0];

      // Tenant isolation: buyer ownership
      if (Number(order.buyer_id) !== Number(actor.id)) {
        const err = new Error('Access denied. You do not own this order.');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // Paid-only eligibility check
      if (order.payment_status !== 'PAID') {
        const err = new Error(`Order is in '${order.payment_status}' status and cannot be disputed`);
        err.code = 'UNPAID_ORDER_NOT_DISPUTABLE';
        err.statusCode = 422;
        throw err;
      }

      // Fulfillment eligibility check
      const validFulfillmentStages = ['DISPATCHED', 'SUPPLIER_DELIVERED', 'BUYER_CONFIRMED', 'EXCEPTION'];
      if (!validFulfillmentStages.includes(order.fulfillment_status)) {
        const err = new Error(`Disputes cannot be filed before the order has been dispatched (current status: '${order.fulfillment_status}')`);
        err.code = 'ORDER_NOT_DISPATCHED';
        err.statusCode = 422;
        throw err;
      }

      // Idempotency replay check
      const [existingByKey] = await connection.query(
        `SELECT * FROM order_disputes WHERE order_id = ? AND idempotency_key = ?`,
        [orderId, trimmedKey]
      );

      if (existingByKey.length > 0) {
        const existingDispute = existingByKey[0];
        let replayConflict = existingDispute.dispute_category !== category;
        if (order.notes === 'SMART_PROCUREMENT_BASKET') {
          let previousEvidence = {};
          try {
            previousEvidence = typeof existingDispute.evidence_metadata === 'string' ?
              JSON.parse(existingDispute.evidence_metadata) : existingDispute.evidence_metadata || {};
          } catch { replayConflict = true; }
          replayConflict = replayConflict ||
            Number(previousEvidence.award_line_id) !== Number(evidenceMetadata?.award_line_id) ||
            !exactDecimal.exactDecimalEquals(
              previousEvidence.received_quantity, evidenceMetadata?.received_quantity, 4
            );
        } else if (disputedQuantity != null) {
          replayConflict = replayConflict ||
            !exactDecimal.exactDecimalEquals(
              existingDispute.disputed_quantity, disputedQuantity, 4
            );
        }
        if (replayConflict) {
          const err = new Error('This idempotency key has already been used for a different dispute payload.');
          err.code = 'IDEMPOTENCY_PAYLOAD_CONFLICT';
          err.statusCode = 409;
          throw err;
        }
        await connection.commit();
        return {
          is_replay: true,
          dispute_id: existingDispute.id,
          dispute_code: existingDispute.dispute_code,
          status: existingDispute.status,
          claimed_amount: existingDispute.claimed_amount,
          message: 'Dispute retrieved (idempotent replay)'
        };
      }

      // B6 Smart Procurement groups distinct physical SKUs into one supplier
      // order, using order.total_qty=1 as a basket marker. Claims must refer
      // to the immutable procurement_award_line, never the basket marker.
      const isSmartBasket = order.notes === 'SMART_PROCUREMENT_BASKET';
      let orderTotalQty = Number(order.total_qty);
      let parsedDisputedQty = null;
      let parsedReportedQty = null;
      let unitPriceStr = String(order.unit_price);
      let authoritativeEvidence = cleanMetadata;
      let claimedLineId = null;
      let lineClaim = null;
      if (isSmartBasket) {
        if (category !== 'SHORT_QUANTITY' && category !== 'MISSING_ITEMS') {
          const err = new Error('B6 claims for other issue types require a dedicated SKU-level evidence workflow.');
          err.code = 'B6_LINE_CLAIM_POLICY_REQUIRED'; err.statusCode = 409; throw err;
        }
        const evidence = evidenceMetadata || {};
        const lineId = Number(evidence.award_line_id);
        if (!Number.isSafeInteger(lineId) || lineId <= 0 ||
            evidence.received_quantity === undefined || evidence.received_quantity === null) {
          const err = new Error('B6 shortage claims require award_line_id and received_quantity.');
          err.code = 'B6_AWARD_LINE_EVIDENCE_REQUIRED'; err.statusCode = 422; throw err;
        }
        const [lines] = await connection.query(
          `SELECT l.id,l.quantity,l.purchasing_unit,l.unit_price,l.supplier_sku_id
             FROM procurement_award_orders ao
             JOIN procurement_award_lines l ON l.award_order_id=ao.id
             WHERE ao.order_id=? AND l.id=? FOR UPDATE`,
          [order.id,lineId]
        );
        if (lines.length!==1) {
          const err = new Error('Award line does not belong to this buyer order.');
          err.code = 'AWARD_LINE_NOT_FOUND'; err.statusCode = 404; throw err;
        }
        const line=lines[0];
        lineClaim=shortageForAwardLine({
          ordered_quantity:line.quantity,
          received_quantity:evidence.received_quantity,
          locked_unit_price:line.unit_price
        });
        claimedLineId=lineId;
        if (disputedQuantity!=null &&
            !exactDecimal.exactDecimalEquals(disputedQuantity,lineClaim.disputed_quantity,4)) {
          const err = new Error('Disputed quantity must equal the awarded SKU shortfall.');
          err.code = 'B6_LINE_SHORTAGE_MISMATCH'; err.statusCode = 422; throw err;
        }
        if (reportedQuantity!=null &&
            !exactDecimal.exactDecimalEquals(reportedQuantity,lineClaim.received_quantity,4)) {
          const err = new Error('Reported quantity conflicts with the immutable award-line evidence.');
          err.code = 'B6_LINE_RECEIPT_MISMATCH'; err.statusCode = 422; throw err;
        }
        orderTotalQty=Number(lineClaim.expected_quantity);
        parsedReportedQty=Number(lineClaim.received_quantity);
        parsedDisputedQty=Number(lineClaim.disputed_quantity);
        unitPriceStr=lineClaim.unit_price;
        authoritativeEvidence={
          award_line_id:lineId,supplier_sku_id:Number(line.supplier_sku_id),
          purchasing_unit:String(line.purchasing_unit),
          expected_quantity:lineClaim.expected_quantity,
          received_quantity:lineClaim.received_quantity,
          disputed_quantity:lineClaim.disputed_quantity,
          locked_unit_price:lineClaim.unit_price,
          source:'IMMUTABLE_B6_AWARD_LINE'
        };
      } else {
        if (disputedQuantity !== null && disputedQuantity !== undefined) {
          const dQty = Number(disputedQuantity);
          if (!Number.isFinite(dQty) || dQty <= 0 || dQty > orderTotalQty) {
            const err = new Error('Disputed quantity must be positive and no more than ordered quantity.');
            err.code = 'INVALID_DISPUTED_QUANTITY';err.statusCode=422;throw err;
          }
          parsedDisputedQty=dQty;
        } else {
          parsedDisputedQty=orderTotalQty;
        }
        if (reportedQuantity !== null && reportedQuantity !== undefined) {
          const rQty = Number(reportedQuantity);
          if (!Number.isFinite(rQty) || rQty < 0) {
            const err = new Error('Reported quantity must be non-negative.');
            err.code = 'INVALID_REPORTED_QUANTITY';err.statusCode=400;throw err;
          }
          parsedReportedQty=rQty;
        }
      }

      // Claims compete only with other claims on the same immutable SKU line.
      // Legacy single-product orders retain order-wide quantity limits.
      const [activeDisputes] = await connection.query(
        `SELECT id,disputed_quantity,evidence_metadata FROM order_disputes
         WHERE order_id=? AND status IN (${ACTIVE_DISPUTE_STATUSES.map(()=>'?').join(',')})`,
        [orderId,...ACTIVE_DISPUTE_STATUSES]
      );
      const relevantClaims=activeDisputes.filter(d=>{
        if (!isSmartBasket) return true;
        let evidence={};
        try {evidence=typeof d.evidence_metadata==='string' ?
          JSON.parse(d.evidence_metadata) : d.evidence_metadata||{}}
        catch {return true} // fail closed if older evidence is unreadable
        // Legacy basket-wide disputes cannot be safely treated as unrelated.
        return evidence.award_line_id==null ||
          Number(evidence.award_line_id)===claimedLineId;
      });
      const activeQty=exactDecimal.exactDecimalSum(
        relevantClaims.map(d=>String(d.disputed_quantity||'0')),4
      );
      const projectedQty=exactDecimal.exactDecimalSum(
        [activeQty,String(parsedDisputedQty)],4
      );
      if (!exactDecimal.exactDecimalGte(
        String(orderTotalQty),projectedQty,4
      )) {
        const err = new Error('Active claims would exceed the immutable physical SKU quantity.');
        err.code = 'DISPUTED_QUANTITY_EXCEEDS_ORDER_LIMIT';
        err.statusCode=422;throw err;
      }
      const calculatedClaimStr=isSmartBasket ? lineClaim.claimed_amount :
        exactDecimal.exactMultiplyRound(String(parsedDisputedQty),unitPriceStr,2);

      // Generate deterministic dispute code
      const disputeCode = `DSP-ORD-${orderId}-${crypto.createHash('sha256').update(trimmedKey).digest('hex').slice(0,16)}`;

      // Insert order_disputes row
      // Map reason column for legacy compatibility
      const legacyReasonMap = {
        'SHORT_QUANTITY': 'SHORTAGE_IN_QUANTITY',
        'DAMAGED_GOODS': 'DAMAGED_GOODS',
        'WRONG_ITEM': 'WRONG_PRODUCT',
        'QUALITY_PROBLEM': 'QUALITY_MISMATCH',
        'MISSING_ITEMS': 'SHORTAGE_IN_QUANTITY',
        'SUPPLIER_SHORTAGE': 'SHORTAGE_IN_QUANTITY',
        'OTHER': 'QUALITY_MISMATCH'
      };
      const legacyReason = legacyReasonMap[category] || 'DAMAGED_GOODS';

      const [insertRes] = await connection.query(
        `INSERT INTO order_disputes (
          dispute_code, order_id, reservation_id, buyer_id, supplier_id,
          reason, dispute_category, reporting_actor_role, description,
          expected_quantity, reported_quantity, disputed_quantity,
          claimed_amount, currency, evidence_metadata, evidence_image_url,
          status, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'BUYER', ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, NOW(), NOW())`,
        [
          disputeCode,
          order.id,
          order.reservation_id || null,
          actor.id,
          order.supplier_id,
          legacyReason,
          category,
          description.trim(),
          orderTotalQty,
          parsedReportedQty,
          parsedDisputedQty,
          calculatedClaimStr,
          order.currency || 'PKR',
          authoritativeEvidence ? JSON.stringify(authoritativeEvidence) : null,
          evidenceImageUrl || null,
          trimmedKey
        ]
      );

      const disputeId = insertRes.insertId;

      // Update parent order fulfillment status to EXCEPTION (if not already)
      if (order.fulfillment_status !== 'EXCEPTION') {
        await connection.query(
          `UPDATE orders 
           SET fulfillment_status = 'EXCEPTION',
               order_status = 'DISPUTED',
               exception_reason = ?,
               exception_details = ?,
               exception_recorded_at = NOW(),
               updated_at = NOW()
           WHERE id = ?`,
          [category, description.trim(), order.id]
        );
      }

      // Record immutable event in order_dispute_events
      const eventCode = this._generateEventCode(disputeId, 'BUYER_FILED', trimmedKey);
      await connection.query(
        `INSERT INTO order_dispute_events (
          dispute_id, event_code, from_status, to_status, action,
          actor_id, actor_role, notes, metadata, idempotency_key, created_at
        ) VALUES (?, ?, 'NONE', 'OPEN', 'BUYER_FILED_DISPUTE', ?, 'BUYER', ?, ?, ?, NOW())`,
        [
          disputeId,
          eventCode,
          actor.id,
          description.trim(),
          JSON.stringify({
            category,
            disputed_quantity: parsedDisputedQty,
            claimed_amount: calculatedClaimStr,
            metadata: authoritativeEvidence
          }),
          trimmedKey
        ]
      );

      // Emit transactional outbox business event to reservation_business_events
      const outboxEventId = reservationEventService.generateEventId({
        event_type: 'ORDER_DISPUTE_CREATED',
        pool_id: order.pool_id || 0,
        reservation_id: order.reservation_id || 0,
        actor_id: actor.id,
        mutation_type: 'DISPUTE_FILED',
        idempotency_key: trimmedKey,
        event_sequence: 1
      });

      await connection.query(
        `INSERT INTO reservation_business_events (
          event_id, pool_id, reservation_id, actor_id, actor_role,
          event_type, event_payload, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'BUYER', 'ORDER_DISPUTE_CREATED', ?, ?, NOW())`,
        [
          outboxEventId,
          order.pool_id || 0,
          order.reservation_id || 0,
          actor.id,
          JSON.stringify({
            dispute_id: disputeId,
            dispute_code: disputeCode,
            order_id: order.id,
            order_code: order.order_code,
            buyer_id: actor.id,
            category,
            disputed_quantity: parsedDisputedQty,
            claimed_amount: calculatedClaimStr
          }),
          trimmedKey
        ]
      );

      // Audit log
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, 'BUYER', 'DISPUTE_CREATED', 'order_disputes', ?, ?)`,
        [actor.id, disputeId, JSON.stringify({ dispute_code: disputeCode, category, claimed_amount: calculatedClaimStr })]
      );

      await connection.commit();

      return {
        is_replay: false,
        dispute_id: disputeId,
        dispute_code: disputeCode,
        status: 'OPEN',
        order_id: order.id,
        category,
        disputed_quantity: parsedDisputedQty,
        claimed_amount: calculatedClaimStr,
        currency: order.currency || 'PKR',
        message: 'Dispute filed successfully. Order moved to EXCEPTION and held for resolution.'
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // 2. SUPPLIER SHORTAGE DECLARATION
  // ===========================================================================

  /**
   * Supplier declares a pre-dispatch shortage exception, creating an auditable dispute
   */
  async createSupplierShortageException({
    orderId,
    actor,
    shortageQuantity,
    description,
    evidenceMetadata = null,
    idempotencyKey
  }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ORDER_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!shortageQuantity || isNaN(Number(shortageQuantity)) || Number(shortageQuantity) <= 0) {
      const err = new Error('Positive shortage quantity is required');
      err.code = 'INVALID_SHORTAGE_QUANTITY';
      err.statusCode = 400;
      throw err;
    }

    if (!description || typeof description !== 'string' || description.trim().length < 5) {
      const err = new Error('Meaningful shortage description (minimum 5 characters) is required');
      err.code = 'DESCRIPTION_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('X-Idempotency-Key header is mandatory');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const cleanMetadata = this._sanitizeEvidenceMetadata(evidenceMetadata);
    const trimmedKey = idempotencyKey.trim();
    const parsedShortageQty = Number(shortageQuantity);
    const connection = await db.getConnection();

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();

      await this._assertVerifiedSupplier(actor, connection);

      const [orderRows] = await connection.query(
        `SELECT * FROM orders WHERE id = ? FOR UPDATE`,
        [orderId]
      );

      if (orderRows.length === 0) {
        const err = new Error(`Order with ID ${orderId} not found`);
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const order = orderRows[0];
      // A B6 supplier order is a multi-SKU basket with total_qty=1.
      // Supplier-originated shortage must not price a physical claim using
      // the basket marker or basket-wide synthetic unit price.
      if (order.notes === 'SMART_PROCUREMENT_BASKET') {
        const err = new Error('Supplier B6 shortage requires a dedicated immutable SKU-line claim contract.');
        err.code = 'B6_SUPPLIER_LINE_SHORTAGE_REQUIRED';
        err.statusCode = 409;
        throw err;
      }


      if (Number(order.supplier_id) !== Number(actor.id)) {
        const err = new Error('Access denied. You are not the assigned supplier for this order.');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      if (order.payment_status !== 'PAID') {
        const err = new Error(`Order is in '${order.payment_status}' status and cannot be modified`);
        err.code = 'UNPAID_ORDER_NOT_IN_FULFILLMENT';
        err.statusCode = 422;
        throw err;
      }

      const orderTotalQty = Number(order.total_qty);
      if (parsedShortageQty > orderTotalQty) {
        const err = new Error(`Shortage quantity (${parsedShortageQty}) exceeds total ordered quantity (${orderTotalQty})`);
        err.code = 'QUANTITY_EXCEEDS_ORDER';
        err.statusCode = 422;
        throw err;
      }

      // Check idempotency replay
      const [existingByKey] = await connection.query(
        `SELECT * FROM order_disputes WHERE order_id = ? AND idempotency_key = ?`,
        [orderId, trimmedKey]
      );

      if (existingByKey.length > 0) {
        const existingDispute = existingByKey[0];
        await connection.commit();
        return {
          is_replay: true,
          dispute_id: existingDispute.id,
          dispute_code: existingDispute.dispute_code,
          status: existingDispute.status,
          message: 'Supplier shortage exception retrieved (idempotent replay)'
        };
      }

      const calculatedClaimStr = exactDecimal.exactMultiplyRound(String(parsedShortageQty), String(order.unit_price), 2);
      const disputeCode = `DSP-SHG-${orderId}-${Date.now().toString().slice(-6)}`;

      const [insertRes] = await connection.query(
        `INSERT INTO order_disputes (
          dispute_code, order_id, reservation_id, buyer_id, supplier_id,
          reason, dispute_category, reporting_actor_role, description,
          expected_quantity, reported_quantity, disputed_quantity,
          claimed_amount, currency, evidence_metadata,
          status, idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'SHORTAGE_IN_QUANTITY', 'SUPPLIER_SHORTAGE', 'SUPPLIER', ?, ?, ?, ?, ?, ?, ?, 'UNDER_ADMIN_REVIEW', ?, NOW(), NOW())`,
        [
          disputeCode,
          order.id,
          order.reservation_id || null,
          order.buyer_id,
          actor.id,
          description.trim(),
          orderTotalQty,
          orderTotalQty - parsedShortageQty,
          parsedShortageQty,
          calculatedClaimStr,
          order.currency || 'PKR',
          cleanMetadata ? JSON.stringify(cleanMetadata) : null,
          trimmedKey
        ]
      );

      const disputeId = insertRes.insertId;

      // Update order to EXCEPTION
      await connection.query(
        `UPDATE orders 
         SET fulfillment_status = 'EXCEPTION',
             order_status = 'DISPUTED',
             exception_reason = 'SUPPLIER_INVENTORY_SHORTAGE',
             exception_details = ?,
             exception_recorded_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [description.trim(), order.id]
      );

      // Record dispute event
      const eventCode = this._generateEventCode(disputeId, 'SUPPLIER_DECLARED_SHORTAGE', trimmedKey);
      await connection.query(
        `INSERT INTO order_dispute_events (
          dispute_id, event_code, from_status, to_status, action,
          actor_id, actor_role, notes, metadata, idempotency_key, created_at
        ) VALUES (?, ?, 'NONE', 'UNDER_ADMIN_REVIEW', 'SUPPLIER_DECLARED_SHORTAGE', ?, 'SUPPLIER', ?, ?, ?, NOW())`,
        [
          disputeId,
          eventCode,
          actor.id,
          description.trim(),
          JSON.stringify({ shortage_quantity: parsedShortageQty, claimed_amount: calculatedClaimStr }),
          trimmedKey
        ]
      );

      // Outbox business event
      const outboxEventId = reservationEventService.generateEventId({
        event_type: 'ORDER_SUPPLIER_SHORTAGE_DECLARED',
        pool_id: order.pool_id || 0,
        reservation_id: order.reservation_id || 0,
        actor_id: actor.id,
        mutation_type: 'SHORTAGE_DECLARED',
        idempotency_key: trimmedKey,
        event_sequence: 1
      });

      await connection.query(
        `INSERT INTO reservation_business_events (
          event_id, pool_id, reservation_id, actor_id, actor_role,
          event_type, event_payload, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'SUPPLIER', 'ORDER_SUPPLIER_SHORTAGE_DECLARED', ?, ?, NOW())`,
        [
          outboxEventId,
          order.pool_id || 0,
          order.reservation_id || 0,
          actor.id,
          JSON.stringify({
            dispute_id: disputeId,
            order_id: order.id,
            shortage_quantity: parsedShortageQty,
            claimed_amount: calculatedClaimStr
          }),
          trimmedKey
        ]
      );

      await connection.commit();

      return {
        is_replay: false,
        dispute_id: disputeId,
        dispute_code: disputeCode,
        status: 'UNDER_ADMIN_REVIEW',
        order_id: order.id,
        shortage_quantity: parsedShortageQty,
        claimed_amount: calculatedClaimStr,
        message: 'Supplier shortage declared. Case routed for administrative review.'
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // 3. SUPPLIER DISPUTE RESPONSE & REMEDIATION PROPOSAL
  // ===========================================================================

  /**
   * Supplier responds to an active dispute and optionally proposes operational remediation
   */
  async submitSupplierResponse({
    disputeId,
    actor,
    response,
    remediationProposal = 'NONE',
    remediationDetails = null,
    evidenceMetadata = null,
    idempotencyKey
  }) {
    if (!disputeId || isNaN(disputeId)) {
      const err = new Error('Valid numeric dispute ID is required');
      err.code = 'INVALID_DISPUTE_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!response || typeof response !== 'string' || response.trim().length < 5) {
      const err = new Error('Meaningful supplier response (minimum 5 characters) is required');
      err.code = 'RESPONSE_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    if (remediationProposal && !REMEDIATION_PROPOSALS.includes(remediationProposal)) {
      const err = new Error(`Invalid remediation proposal. Allowed: [${REMEDIATION_PROPOSALS.join(', ')}]`);
      err.code = 'INVALID_REMEDIATION_PROPOSAL';
      err.statusCode = 400;
      throw err;
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('X-Idempotency-Key header is mandatory');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const cleanMetadata = this._sanitizeEvidenceMetadata(evidenceMetadata);
    const trimmedKey = idempotencyKey.trim();
    const connection = await db.getConnection();

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();

      await this._assertVerifiedSupplier(actor, connection);

      const [disputeRows] = await connection.query(
        `SELECT * FROM order_disputes WHERE id = ? FOR UPDATE`,
        [disputeId]
      );

      if (disputeRows.length === 0) {
        const err = new Error(`Dispute with ID ${disputeId} not found`);
        err.code = 'DISPUTE_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const dispute = disputeRows[0];

      // Tenant isolation: supplier ownership
      if (Number(dispute.supplier_id) !== Number(actor.id)) {
        const err = new Error('Access denied. You are not the assigned supplier for this dispute.');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // Check dispute state: cannot respond to closed disputes
      if (['CLOSED', 'RESOLVED_REJECTED', 'RESOLVED_REFUND', 'RESOLVED_PARTIAL_REFUND'].includes(dispute.status)) {
        const err = new Error(`Dispute is already closed or resolved (${dispute.status})`);
        err.code = 'DISPUTE_ALREADY_RESOLVED';
        err.statusCode = 409;
        throw err;
      }

      // Idempotency check
      const [existingEvent] = await connection.query(
        `SELECT * FROM order_dispute_events 
         WHERE dispute_id = ? AND idempotency_key = ? AND action = 'SUPPLIER_SUBMITTED_RESPONSE'`,
        [disputeId, trimmedKey]
      );

      if (existingEvent.length > 0) {
        await connection.commit();
        return {
          is_replay: true,
          dispute_id: dispute.id,
          status: dispute.status,
          remediation_proposal: dispute.remediation_proposal,
          message: 'Supplier response retrieved (idempotent replay)'
        };
      }

      const fromStatus = dispute.status;
      let toStatus = fromStatus;
      let remediationStatus = dispute.remediation_status || 'NOT_APPLICABLE';

      if (remediationProposal && remediationProposal !== 'NONE' && remediationProposal !== 'EXPLANATION_CONTEST') {
        toStatus = 'SUPPLIER_REMEDIATION_PROPOSED';
        remediationStatus = 'PROPOSED';
      } else {
        toStatus = 'UNDER_ADMIN_REVIEW';
      }

      await connection.query(
        `UPDATE order_disputes 
         SET supplier_response = ?,
             supplier_response_at = NOW(),
             remediation_proposal = ?,
             remediation_details = ?,
             remediation_status = ?,
             status = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          response.trim(),
          remediationProposal || 'NONE',
          remediationDetails ? remediationDetails.trim() : null,
          remediationStatus,
          toStatus,
          disputeId
        ]
      );

      // Record event
      const eventCode = this._generateEventCode(disputeId, 'SUPPLIER_RESPONSE', trimmedKey);
      await connection.query(
        `INSERT INTO order_dispute_events (
          dispute_id, event_code, from_status, to_status, action,
          actor_id, actor_role, notes, metadata, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'SUPPLIER_SUBMITTED_RESPONSE', ?, 'SUPPLIER', ?, ?, ?, NOW())`,
        [
          disputeId,
          eventCode,
          fromStatus,
          toStatus,
          actor.id,
          response.trim(),
          JSON.stringify({
            remediation_proposal: remediationProposal,
            remediation_details: remediationDetails,
            metadata: cleanMetadata
          }),
          trimmedKey
        ]
      );

      // Fetch order's pool_id for foreign key consistency
      const [orderRows] = await connection.query(
        `SELECT pool_id FROM orders WHERE id = ?`,
        [dispute.order_id]
      );
      const poolId = orderRows[0]?.pool_id;

      // Outbox event
      const outboxEventId = reservationEventService.generateEventId({
        event_type: 'ORDER_DISPUTE_SUPPLIER_RESPONDED',
        pool_id: poolId || 0,
        reservation_id: dispute.reservation_id || 0,
        actor_id: actor.id,
        mutation_type: 'SUPPLIER_RESPONSE',
        idempotency_key: trimmedKey,
        event_sequence: 1
      });

      await connection.query(
        `INSERT INTO reservation_business_events (
          event_id, pool_id, reservation_id, actor_id, actor_role,
          event_type, event_payload, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'SUPPLIER', 'ORDER_DISPUTE_SUPPLIER_RESPONDED', ?, ?, NOW())`,
        [
          outboxEventId,
          poolId,
          dispute.reservation_id || 0,
          actor.id,
          JSON.stringify({
            dispute_id: dispute.id,
            order_id: dispute.order_id,
            remediation_proposal: remediationProposal,
            to_status: toStatus
          }),
          trimmedKey
        ]
      );

      await connection.commit();

      return {
        is_replay: false,
        dispute_id: dispute.id,
        previous_status: fromStatus,
        status: toStatus,
        remediation_proposal: remediationProposal,
        remediation_status: remediationStatus,
        message: 'Supplier response and remediation proposal recorded.'
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // 4. SUPPLIER REMEDIATION DISPATCH DECLARATION
  // ===========================================================================

  /**
   * Supplier declares physical remediation goods dispatched / delivered
   * Invariant: Supplier declaration does NOT imply buyer receipt or complete resolution!
   */
  async declareSupplierRemediationDispatched({
    disputeId,
    actor,
    trackingReference = null,
    notes = null,
    idempotencyKey
  }) {
    if (!disputeId || isNaN(disputeId)) {
      const err = new Error('Valid numeric dispute ID is required');
      err.code = 'INVALID_DISPUTE_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('X-Idempotency-Key header is mandatory');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const trimmedKey = idempotencyKey.trim();
    const connection = await db.getConnection();

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();

      await this._assertVerifiedSupplier(actor, connection);

      const [disputeRows] = await connection.query(
        `SELECT * FROM order_disputes WHERE id = ? FOR UPDATE`,
        [disputeId]
      );

      if (disputeRows.length === 0) {
        const err = new Error(`Dispute with ID ${disputeId} not found`);
        err.code = 'DISPUTE_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const dispute = disputeRows[0];

      if (Number(dispute.supplier_id) !== Number(actor.id)) {
        const err = new Error('Access denied. You are not the assigned supplier for this dispute.');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      if (dispute.remediation_status !== 'PROPOSED' && dispute.remediation_status !== 'IN_PROGRESS') {
        const err = new Error(`Cannot declare remediation dispatched: Remediation is currently '${dispute.remediation_status}'`);
        err.code = 'INVALID_REMEDIATION_STATE';
        err.statusCode = 422;
        throw err;
      }

      await connection.query(
        `UPDATE order_disputes 
         SET remediation_status = 'IN_PROGRESS',
             status = 'SUPPLIER_REMEDIATION_IN_PROGRESS',
             remediation_dispatched_at = COALESCE(remediation_dispatched_at, NOW()),
             remediation_delivered_at = NOW(),
             remediation_notes = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [notes ? notes.trim() : trackingReference, disputeId]
      );

      const eventCode = this._generateEventCode(disputeId, 'REMEDIATION_DISPATCHED', trimmedKey);
      await connection.query(
        `INSERT INTO order_dispute_events (
          dispute_id, event_code, from_status, to_status, action,
          actor_id, actor_role, notes, metadata, idempotency_key, created_at
        ) VALUES (?, ?, ?, 'SUPPLIER_REMEDIATION_IN_PROGRESS', 'SUPPLIER_DECLARED_REMEDIATION_DISPATCHED', ?, 'SUPPLIER', ?, ?, ?, NOW())`,
        [
          disputeId,
          eventCode,
          dispute.status,
          actor.id,
          notes ? notes.trim() : null,
          JSON.stringify({ tracking_reference: trackingReference }),
          trimmedKey
        ]
      );

      await connection.commit();

      return {
        dispute_id: dispute.id,
        remediation_status: 'IN_PROGRESS',
        status: 'SUPPLIER_REMEDIATION_IN_PROGRESS',
        message: 'Remediation dispatched declared. Awaiting buyer receipt confirmation.'
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // 5. BUYER CONFIRMS REMEDIATION RECEIPT
  // ===========================================================================

  /**
   * Buyer confirms receipt of operational remedy (replacement / missing items)
   */
  async confirmBuyerRemediationReceipt({
    disputeId,
    actor,
    notes = null,
    idempotencyKey
  }) {
    if (!disputeId || isNaN(disputeId)) {
      const err = new Error('Valid numeric dispute ID is required');
      err.code = 'INVALID_DISPUTE_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!actor || !actor.id || actor.role !== 'BUYER') {
      const err = new Error('Only the purchasing buyer can confirm remediation receipt');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('X-Idempotency-Key header is mandatory');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const trimmedKey = idempotencyKey.trim();
    const connection = await db.getConnection();

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();

      const [disputeRows] = await connection.query(
        `SELECT * FROM order_disputes WHERE id = ? FOR UPDATE`,
        [disputeId]
      );

      if (disputeRows.length === 0) {
        const err = new Error(`Dispute with ID ${disputeId} not found`);
        err.code = 'DISPUTE_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const dispute = disputeRows[0];

      if (Number(dispute.buyer_id) !== Number(actor.id)) {
        const err = new Error('Access denied. You do not own this dispute.');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      if (dispute.remediation_status !== 'IN_PROGRESS' && dispute.remediation_status !== 'PROPOSED') {
        const err = new Error(`Cannot confirm remediation: Remediation status is '${dispute.remediation_status}'`);
        err.code = 'INVALID_REMEDIATION_STATE';
        err.statusCode = 422;
        throw err;
      }

      // Update dispute to COMPLETED
      await connection.query(
        `UPDATE order_disputes 
         SET remediation_status = 'COMPLETED',
             status = 'SUPPLIER_REMEDIATION_COMPLETED',
             buyer_remediation_confirmed_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [disputeId]
      );

      // Record event
      const eventCode = this._generateEventCode(disputeId, 'BUYER_CONFIRMED_REMEDY', trimmedKey);
      await connection.query(
        `INSERT INTO order_dispute_events (
          dispute_id, event_code, from_status, to_status, action,
          actor_id, actor_role, notes, metadata, idempotency_key, created_at
        ) VALUES (?, ?, ?, 'SUPPLIER_REMEDIATION_COMPLETED', 'BUYER_CONFIRMED_REMEDIATION_RECEIPT', ?, 'BUYER', ?, NULL, ?, NOW())`,
        [
          disputeId,
          eventCode,
          dispute.status,
          actor.id,
          notes ? notes.trim() : null,
          trimmedKey
        ]
      );

      // Check if all active disputes on this order are now resolved/completed
      const [otherDisputes] = await connection.query(
        `SELECT COUNT(*) AS activeCount 
         FROM order_disputes 
         WHERE order_id = ? AND id != ? AND status NOT IN ('CLOSED', 'RESOLVED_REJECTED', 'SUPPLIER_REMEDIATION_COMPLETED')`,
        [dispute.order_id, disputeId]
      );

      const hasOtherActive = Number(otherDisputes[0]?.activeCount || 0) > 0;
      let orderResumed = false;

      // Confirming replacement/missing goods is NOT consent to receipt of the whole order.
      // Return to supplier-delivered only if the original supplier delivery was recorded;
      // the buyer must separately call the authenticated full-order receipt endpoint.
      if (!hasOtherActive) {
        const [sourceOrders] = await connection.query(
          'SELECT supplier_delivered_at, buyer_confirmed_at FROM orders WHERE id = ? FOR UPDATE',
          [dispute.order_id]
        );
        if (sourceOrders[0]?.supplier_delivered_at) {
          await connection.query(
            `UPDATE orders SET fulfillment_status = 'SUPPLIER_DELIVERED',
               order_status = 'OUT_FOR_DELIVERY', updated_at = NOW()
             WHERE id = ? AND fulfillment_status = 'EXCEPTION'`,
            [dispute.order_id]
          );
          orderResumed = true;
        }
      }

      await connection.commit();

      return {
        dispute_id: dispute.id,
        remediation_status: 'COMPLETED',
        status: 'SUPPLIER_REMEDIATION_COMPLETED',
        order_resumed: orderResumed,
        message: 'Buyer confirmed receipt of remediation goods.'
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // 6. ADMIN ARBITRATION DECISION
  // ===========================================================================

  /**
   * Admin records an operational decision on an active dispute
   * Financial Safety Invariant: Does NOT disburse funds, execute refunds, or modify payments.escrow_status!
   */
  async recordAdminDecision({
    disputeId,
    actor,
    decision,
    decisionReason,
    adminNotes = null,
    resumeFulfillment = false,
    idempotencyKey
  }) {
    if (!disputeId || isNaN(disputeId)) {
      const err = new Error('Valid numeric dispute ID is required');
      err.code = 'INVALID_DISPUTE_ID';
      err.statusCode = 400;
      throw err;
    }

    const adminRoles = ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'SUPPORT_ADMIN'];
    if (!actor || !actor.id || !adminRoles.includes(actor.role)) {
      const err = new Error('Administrative authorization required');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    if (!decision || !ADMIN_DECISIONS.includes(decision)) {
      const err = new Error(`Invalid decision. Allowed: [${ADMIN_DECISIONS.join(', ')}]`);
      err.code = 'INVALID_DECISION';
      err.statusCode = 400;
      throw err;
    }

    if (!decisionReason || typeof decisionReason !== 'string' || decisionReason.trim().length < 5) {
      const err = new Error('Meaningful decision reason (minimum 5 characters) is mandatory');
      err.code = 'DECISION_REASON_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('X-Idempotency-Key header is mandatory');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const trimmedKey = idempotencyKey.trim();
    const connection = await db.getConnection();

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();

      const [disputeRows] = await connection.query(
        `SELECT * FROM order_disputes WHERE id = ? FOR UPDATE`,
        [disputeId]
      );

      if (disputeRows.length === 0) {
        const err = new Error(`Dispute with ID ${disputeId} not found`);
        err.code = 'DISPUTE_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const dispute = disputeRows[0];

      if (dispute.status === 'CLOSED') {
        const err = new Error('Dispute is already closed');
        err.code = 'DISPUTE_ALREADY_CLOSED';
        err.statusCode = 409;
        throw err;
      }

      // Determine target status
      let toStatus = 'RESOLUTION_RECORDED';
      if (decision === 'FINANCIAL_REVIEW_REQUIRED') {
        toStatus = 'ESCALATED_FINANCIAL_REVIEW';
      } else if (decision === 'SUPPLIER_REMEDIATION_REQUIRED') {
        toStatus = 'UNDER_ADMIN_REVIEW';
      } else if (decision === 'BUYER_CLAIM_REJECTED') {
        toStatus = 'RESOLUTION_RECORDED';
      }

      await connection.query(
        `UPDATE order_disputes 
         SET admin_decision = ?,
             decision_reason = ?,
             decision_recorded_at = NOW(),
             decision_by = ?,
             admin_notes = ?,
             status = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [
          decision,
          decisionReason.trim(),
          actor.id,
          adminNotes ? adminNotes.trim() : null,
          toStatus,
          disputeId
        ]
      );

      // Record event
      const eventCode = this._generateEventCode(disputeId, 'ADMIN_DECISION', trimmedKey);
      await connection.query(
        `INSERT INTO order_dispute_events (
          dispute_id, event_code, from_status, to_status, action,
          actor_id, actor_role, notes, metadata, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'ADMIN_RECORDED_DECISION', ?, 'ADMIN', ?, ?, ?, NOW())`,
        [
          disputeId,
          eventCode,
          dispute.status,
          toStatus,
          actor.id,
          decisionReason.trim(),
          JSON.stringify({ decision, admin_notes: adminNotes }),
          trimmedKey
        ]
      );

      // Audit log
      await connection.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, ?, 'ADMIN_DISPUTE_DECISION', 'order_disputes', ?, ?)`,
        [actor.id, actor.role, disputeId, JSON.stringify({ decision, decision_reason: decisionReason })]
      );

      // Optional explicit fulfillment resumption if buyer claim rejected and requested
      let orderResumed = false;
      if (resumeFulfillment && decision === 'BUYER_CLAIM_REJECTED') {
        const [otherActive] = await connection.query(
          `SELECT COUNT(*) AS activeCount 
           FROM order_disputes 
           WHERE order_id = ? AND id != ? AND status NOT IN ('CLOSED', 'RESOLVED_REJECTED')`,
          [dispute.order_id, disputeId]
        );

        if (Number(otherActive[0]?.activeCount || 0) === 0) {
          // Admin may clear a dispute but may not impersonate buyer receipt.
          const [sourceOrders] = await connection.query(
            'SELECT supplier_delivered_at FROM orders WHERE id = ? FOR UPDATE',
            [dispute.order_id]
          );
          if (sourceOrders[0]?.supplier_delivered_at) {
            await connection.query(
              `UPDATE orders SET fulfillment_status='SUPPLIER_DELIVERED',
                 order_status='OUT_FOR_DELIVERY', updated_at=NOW()
               WHERE id=? AND fulfillment_status='EXCEPTION'`,
              [dispute.order_id]
            );
            orderResumed = true;
          }
        }
      }

      await connection.commit();

      return {
        dispute_id: dispute.id,
        decision,
        status: toStatus,
        order_resumed: orderResumed,
        message: `Admin decision recorded: ${decision}`
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // 7. ADMIN DISPUTE CLOSURE
  // ===========================================================================

  /**
   * Admin formally closes a resolved dispute with a documented reason
   */
  async closeDispute({
    disputeId,
    actor,
    closureReason,
    idempotencyKey
  }) {
    if (!disputeId || isNaN(disputeId)) {
      const err = new Error('Valid numeric dispute ID is required');
      err.code = 'INVALID_DISPUTE_ID';
      err.statusCode = 400;
      throw err;
    }

    const adminRoles = ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'SUPPORT_ADMIN'];
    if (!actor || !actor.id || !adminRoles.includes(actor.role)) {
      const err = new Error('Administrative authorization required');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    if (!closureReason || typeof closureReason !== 'string' || closureReason.trim().length < 5) {
      const err = new Error('Meaningful closure reason (minimum 5 characters) is required to close a dispute');
      err.code = 'CLOSURE_REASON_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      const err = new Error('X-Idempotency-Key header is mandatory');
      err.code = 'IDEMPOTENCY_KEY_REQUIRED';
      err.statusCode = 400;
      throw err;
    }

    const trimmedKey = idempotencyKey.trim();
    const connection = await db.getConnection();

    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();

      const [disputeRows] = await connection.query(
        `SELECT * FROM order_disputes WHERE id = ? FOR UPDATE`,
        [disputeId]
      );

      if (disputeRows.length === 0) {
        const err = new Error(`Dispute with ID ${disputeId} not found`);
        err.code = 'DISPUTE_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const dispute = disputeRows[0];

      if (dispute.status === 'CLOSED') {
        await connection.commit();
        return {
          is_replay: true,
          dispute_id: dispute.id,
          status: 'CLOSED',
          message: 'Dispute is already closed.'
        };
      }

      // Enforce that mandatory remediation is not left dangling
      if (dispute.remediation_status === 'PROPOSED' || dispute.remediation_status === 'IN_PROGRESS') {
        const err = new Error(`Cannot close dispute while operational remediation is '${dispute.remediation_status}'`);
        err.code = 'REMEDIATION_INCOMPLETE';
        err.statusCode = 422;
        throw err;
      }

      await connection.query(
        `UPDATE order_disputes 
         SET status = 'CLOSED',
             closure_reason = ?,
             closed_at = NOW(),
             updated_at = NOW()
         WHERE id = ?`,
        [closureReason.trim(), disputeId]
      );

      const eventCode = this._generateEventCode(disputeId, 'DISPUTE_CLOSED', trimmedKey);
      await connection.query(
        `INSERT INTO order_dispute_events (
          dispute_id, event_code, from_status, to_status, action,
          actor_id, actor_role, notes, metadata, idempotency_key, created_at
        ) VALUES (?, ?, ?, 'CLOSED', 'ADMIN_CLOSED_DISPUTE', ?, 'ADMIN', ?, NULL, ?, NOW())`,
        [
          disputeId,
          eventCode,
          dispute.status,
          actor.id,
          closureReason.trim(),
          trimmedKey
        ]
      );

      // Check if all disputes for this order are closed
      const [remaining] = await connection.query(
        `SELECT COUNT(*) AS activeCount 
         FROM order_disputes 
         WHERE order_id = ? AND id != ? AND status NOT IN ('CLOSED', 'RESOLVED_REJECTED')`,
        [dispute.order_id, disputeId]
      );

      let orderResumed = false;
      if (Number(remaining[0]?.activeCount || 0) === 0) {
        // Safe fulfillment resumption check
        const [orderRows] = await connection.query(`SELECT * FROM orders WHERE id = ?`, [dispute.order_id]);
        if (orderRows.length > 0 && orderRows[0].fulfillment_status === 'EXCEPTION') {
          // If order had reached supplier delivery or confirmation, complete it
          if (orderRows[0].supplier_delivered_at) {
            await connection.query(
              `UPDATE orders
               SET fulfillment_status = 'SUPPLIER_DELIVERED',
                   order_status = 'OUT_FOR_DELIVERY',
                   updated_at = NOW()
               WHERE id = ? AND fulfillment_status = 'EXCEPTION'`,
              [dispute.order_id]
            );
            orderResumed = true;
          }
        }
      }

      await connection.commit();

      return {
        dispute_id: dispute.id,
        status: 'CLOSED',
        closure_reason: closureReason.trim(),
        order_resumed: orderResumed,
        message: 'Dispute closed successfully.'
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  // ===========================================================================
  // 8. READ & QUERY APIS
  // ===========================================================================

  /**
   * Get specific dispute by ID with object-level authorization & timeline events
   */
  async getDisputeById({ disputeId, actor }) {
    if (!disputeId || isNaN(disputeId)) {
      const err = new Error('Valid numeric dispute ID is required');
      err.code = 'INVALID_DISPUTE_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!actor || !actor.id) {
      const err = new Error('Authentication required');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    const connection = await db.getConnection();
    try {
      const [disputeRows] = await connection.query(
        `SELECT d.*, 
                o.order_code, o.total_qty AS order_total_qty, o.unit_price AS order_unit_price,
                o.total_amount AS order_total_amount, o.fulfillment_status AS order_fulfillment_status,
                bu.full_name AS buyer_name, bu.email AS buyer_email,
                su.business_name AS supplier_name
         FROM order_disputes d
         LEFT JOIN orders o ON d.order_id = o.id
         LEFT JOIN users bu ON d.buyer_id = bu.id
         LEFT JOIN users su ON d.supplier_id = su.id
         WHERE d.id = ?`,
        [disputeId]
      );

      if (disputeRows.length === 0) {
        const err = new Error(`Dispute with ID ${disputeId} not found`);
        err.code = 'DISPUTE_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const dispute = disputeRows[0];
      const adminRoles = ['ADMIN', 'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'SUPPORT_ADMIN'];
      const isAdmin = adminRoles.includes(actor.role);

      // Object Auth
      const isOwnerBuyer = actor.role === 'BUYER' && Number(dispute.buyer_id) === Number(actor.id);
      const isAssignedSupplier = actor.role === 'SUPPLIER' && Number(dispute.supplier_id) === Number(actor.id);

      if (!isAdmin && !isOwnerBuyer && !isAssignedSupplier) {
        const err = new Error('Access denied. You are not authorized to view this dispute.');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // Fetch timeline events
      const [events] = await connection.query(
        `SELECT id, event_code, from_status, to_status, action, actor_role, notes, metadata, created_at
         FROM order_dispute_events
         WHERE dispute_id = ?
         ORDER BY id ASC`,
        [disputeId]
      );

      return {
        dispute,
        timeline: events
      };

    } finally {
      connection.release();
    }
  }

  /**
   * List buyer's disputes
   */
  async getBuyerDisputes({ actor, page = 1, limit = 20 }) {
    if (!actor || !actor.id || actor.role !== 'BUYER') {
      const err = new Error('Authentication required');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    const connection = await db.getConnection();
    try {
      const parsedPage = Math.max(1, parseInt(page, 10) || 1);
      const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (parsedPage - 1) * parsedLimit;

      const [countRows] = await connection.query(
        `SELECT COUNT(*) AS total FROM order_disputes WHERE buyer_id = ?`,
        [actor.id]
      );
      const total = Number(countRows[0]?.total || 0);

      const [rows] = await connection.query(
        `SELECT d.*, o.order_code, su.business_name AS supplier_name
         FROM order_disputes d
         LEFT JOIN orders o ON d.order_id = o.id
         LEFT JOIN users su ON d.supplier_id = su.id
         WHERE d.buyer_id = ?
         ORDER BY d.created_at DESC
         LIMIT ? OFFSET ?`,
        [actor.id, parsedLimit, offset]
      );

      return {
        disputes: rows,
        pagination: {
          page: parsedPage,
          limit: parsedLimit,
          total,
          total_pages: Math.ceil(total / parsedLimit) || 1
        }
      };

    } finally {
      connection.release();
    }
  }

  /**
   * List supplier's disputes
   */
  async getSupplierDisputes({ actor, page = 1, limit = 20 }) {
    const connection = await db.getConnection();
    try {
      await this._assertVerifiedSupplier(actor, connection);

      const parsedPage = Math.max(1, parseInt(page, 10) || 1);
      const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (parsedPage - 1) * parsedLimit;

      const [countRows] = await connection.query(
        `SELECT COUNT(*) AS total FROM order_disputes WHERE supplier_id = ?`,
        [actor.id]
      );
      const total = Number(countRows[0]?.total || 0);

      const [rows] = await connection.query(
        `SELECT d.*, o.order_code, bu.full_name AS buyer_name
         FROM order_disputes d
         LEFT JOIN orders o ON d.order_id = o.id
         LEFT JOIN users bu ON d.buyer_id = bu.id
         WHERE d.supplier_id = ?
         ORDER BY d.created_at DESC
         LIMIT ? OFFSET ?`,
        [actor.id, parsedLimit, offset]
      );

      return {
        disputes: rows,
        pagination: {
          page: parsedPage,
          limit: parsedLimit,
          total,
          total_pages: Math.ceil(total / parsedLimit) || 1
        }
      };

    } finally {
      connection.release();
    }
  }

  /**
   * List all disputes for admin
   */
  async getAdminDisputes({ status = null, page = 1, limit = 20 }) {
    const connection = await db.getConnection();
    try {
      const parsedPage = Math.max(1, parseInt(page, 10) || 1);
      const parsedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
      const offset = (parsedPage - 1) * parsedLimit;

      let whereClause = '';
      const params = [];
      if (status) {
        whereClause = 'WHERE d.status = ?';
        params.push(status);
      }

      const [countRows] = await connection.query(
        `SELECT COUNT(*) AS total FROM order_disputes d ${whereClause}`,
        params
      );
      const total = Number(countRows[0]?.total || 0);

      const [rows] = await connection.query(
        `SELECT d.*, o.order_code,
                bu.full_name AS buyer_name, bu.email AS buyer_email,
                su.business_name AS supplier_name
         FROM order_disputes d
         LEFT JOIN orders o ON d.order_id = o.id
         LEFT JOIN users bu ON d.buyer_id = bu.id
         LEFT JOIN users su ON d.supplier_id = su.id
         ${whereClause}
         ORDER BY d.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, parsedLimit, offset]
      );

      return {
        disputes: rows,
        pagination: {
          page: parsedPage,
          limit: parsedLimit,
          total,
          total_pages: Math.ceil(total / parsedLimit) || 1
        }
      };

    } finally {
      connection.release();
    }
  }
}

module.exports = new DisputeService();
