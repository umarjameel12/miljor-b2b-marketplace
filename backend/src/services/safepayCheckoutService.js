// =============================================================================
// src/services/safepayCheckoutService.js
// MilJor Part 4E.3: Safepay Sandbox Checkout & Payment State Machine
//
// Governs checkout session creation, durable payment attempts, raw webhook
// verification, and exactly-once payment confirmation transitions.
//
// Core Invariants Enforced:
// 1. Order-before-payment: Checkout only initiates on valid AWAITING_PAYMENT orders.
// 2. Client Amount Tampering Immunity: Amount and currency are fetched strictly
//    from the locked database order row.
// 3. Network Out-of-Lock Invariant: Safepay API calls occur strictly outside
//    MySQL transaction locks.
// 4. Exactly-once payment confirmation: Transactional order state transition to PAID
//    with immutable payment record and ORDER_PAID outbox event.
// =============================================================================

const crypto = require('crypto');
const db = require('../config/db');
const safepayAdapter = require('./safepayAdapter');
const reservationEventService = require('./reservationEventService');
const exactDecimal = require('./exactDecimal');
const procurementAwardService = require('./procurementAwardService');
const notificationService = require('./notificationService');

class SafepayCheckoutService {

  /**
   * Initiates a Safepay sandbox checkout session for a valid buyer order.
   *
   * @param {Object} params
   * @param {number} params.orderId - Target order ID
   * @param {Object} params.actor - Authenticated caller { id, role, buyer_trust_status }
   * @param {string} params.idempotencyKey - Mandatory unique idempotency key
   * @param {string} [params.redirectUrl] - Optional success redirect URL
   * @param {string} [params.cancelUrl] - Optional cancel redirect URL
   * @param {Object} [params.mockClient] - Injected test client for simulated network behavior
   * @returns {Promise<Object>} Checkout attempt representation with hosted checkout URL
   */
  async initiateCheckout({
    orderId,
    actor,
    idempotencyKey,
    redirectUrl = null,
    cancelUrl = null,
    mockClient = null
  }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!actor || !actor.id) {
      const err = new Error('Authentication required');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    if (actor.role !== 'BUYER') {
      const err = new Error('Checkout initiation is strictly restricted to BUYER role');
      err.code = 'UNAUTHORIZED_ROLE';
      err.statusCode = 403;
      throw err;
    }

    if (actor.buyer_trust_status === 'SUSPENDED') {
      const err = new Error('Suspended buyer accounts are prohibited from checkout');
      err.code = 'ACCOUNT_SUSPENDED';
      err.statusCode = 403;
      throw err;
    }

    const trimmedKey = idempotencyKey ? String(idempotencyKey).trim() : null;
    if (!trimmedKey) {
      const err = new Error('X-Idempotency-Key is mandatory for checkout initiation');
      err.code = 'MISSING_IDEMPOTENCY_KEY';
      err.statusCode = 400;
      throw err;
    }

    if (trimmedKey.length > 100) {
      throw this._checkoutError('INVALID_IDEMPOTENCY_KEY', 'Checkout idempotency key must not exceed 100 characters', 400);
    }

    // Fail known local configuration errors before any inventory claim or
    // durable reservation. A failure after reservation is an unknown outcome.
    const [initialOrders] = await db.query(
      `SELECT o.*, u.role AS buyer_role, u.buyer_trust_status
       FROM orders o JOIN users u ON o.buyer_id = u.id WHERE o.id = ?`, [orderId]
    );
    this._validateCheckoutOrder(initialOrders[0], actor);
    safepayAdapter.validateConfig();

    // Existing hold engines acquire their parent locks first. Never call them
    // while holding the order lock (their transactions use other connections).
    await require('./flashPoolService').claimCheckout(orderId, actor.id);
    await require('./regularPoolPaymentHoldService').claimCheckout(orderId, actor.id);

    let order, attemptId;
    const reservation = await db.getConnection();
    try {
      await reservation.beginTransaction();
      const [orders] = await reservation.query(
        `SELECT o.*, u.role AS buyer_role, u.buyer_trust_status
         FROM orders o JOIN users u ON o.buyer_id = u.id WHERE o.id = ? FOR UPDATE`, [orderId]
      );
      order = orders[0];
      this._validateCheckoutOrder(order, actor);
      const [existing] = await reservation.query(
        `SELECT * FROM payment_attempts WHERE order_id = ? AND idempotency_key = ? AND procurement_delivery_contract_id IS NULL
         ORDER BY id DESC LIMIT 1 FOR UPDATE`, [order.id, trimmedKey]
      );
      if (existing.length) {
        this._assertCheckoutReady(existing[0], actor);
        await reservation.commit();
        return { is_replay: true, attempt: this._formatAttempt(existing[0], order) };
      }
      // No age cutoff: elapsed local time cannot prove provider failure.
      const [active] = await reservation.query(
        `SELECT * FROM payment_attempts WHERE order_id = ?
         AND status IN ('INITIATED', 'RECONCILIATION_REQUIRED')
         ORDER BY id DESC LIMIT 1 FOR UPDATE`, [order.id]
      );
      if (active.length) {
        this._assertCheckoutReady(active[0], actor);
        await reservation.commit();
        return { is_replay: false, is_existing_active: true, attempt: this._formatAttempt(active[0], order) };
      }
      // Reuse the read-only policy on this connection. Acquiring another pool
      // connection here can stall when concurrent callers occupy the pool
      // waiting for this order lock. The policy only depends on this.db.query.
      const regularHolds = require('./regularPoolPaymentHoldService');
      await regularHolds.assertCanCreateFreshCheckout.call({ db: reservation }, order.id, actor.id);
      const attemptCode = `ATT-${crypto.randomBytes(16).toString('hex')}`;
      const [insert] = await reservation.query(
        `INSERT INTO payment_attempts (
          attempt_code, order_id, buyer_id, provider, environment,
          amount, currency, status, idempotency_key, created_at
        ) VALUES (?, ?, ?, 'SAFEPAY', 'sandbox', ?, ?, 'RECONCILIATION_REQUIRED', ?, NOW())`,
        [attemptCode, order.id, order.buyer_id, order.total_amount, order.currency, trimmedKey]
      );
      attemptId = insert.insertId;
      await reservation.commit();
    } catch (error) {
      await reservation.rollback();
      throw error;
    } finally {
      reservation.release();
    }

    // A committed unresolved attempt now serializes every key for this order.
    // Never unwind holds on timeout, malformed response, or persistence failure:
    // the provider may have created a session even when its reply was lost.
    try {
      const tracker = await safepayAdapter.createTracker({
        amount: order.total_amount, currency: order.currency, orderCode: order.order_code, mockClient
      });
      const trackerToken = tracker && tracker.trackerToken;
      if (typeof trackerToken !== 'string' || !trackerToken.trim() || trackerToken.length > 128) {
        throw this._checkoutError('CHECKOUT_RECONCILIATION_REQUIRED', 'Provider initiation outcome requires reconciliation', 409);
      }
      // Persist immediately, before any optional passport request or URL work.
      // Do not overwrite a terminal state written by a verified webhook.
      const [saved] = await db.query(
        `UPDATE payment_attempts SET provider_tracker_token = ?, updated_at = NOW()
         WHERE id = ? AND provider_tracker_token IS NULL`, [trackerToken, attemptId]
      );
      if (saved.affectedRows !== 1) throw new Error('Tracker persistence could not be confirmed');

      let tbtToken = null;
      try { tbtToken = await safepayAdapter.createPassportToken({ mockClient }); } catch (_) {
        // Passport remains optional for the existing hosted checkout contract.
      }
      const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';
      const checkoutUrl = safepayAdapter.constructCheckoutUrl({
        trackerToken, orderCode: order.order_code, tbtToken,
        redirectUrl: redirectUrl || `${frontendBase}/payment/return?order_id=${order.id}&beacon=${trackerToken}`,
        cancelUrl: cancelUrl || `${frontendBase}/payment/cancelled?order_id=${order.id}`
      });
      if (typeof checkoutUrl !== 'string' || !checkoutUrl.trim()) throw new Error('Checkout URL unavailable');

      const connection = await db.getConnection();
      try {
        await connection.beginTransaction();
        const [orders] = await connection.query(
          `SELECT o.*, u.role AS buyer_role, u.buyer_trust_status
           FROM orders o JOIN users u ON o.buyer_id = u.id WHERE o.id = ? FOR UPDATE`, [order.id]
        );
        this._validateCheckoutOrder(orders[0], actor);
        const [attempts] = await connection.query('SELECT * FROM payment_attempts WHERE id = ? FOR UPDATE', [attemptId]);
        const attempt = attempts[0];
        if (!attempt || Number(attempt.buyer_id) !== Number(actor.id) || Number(attempt.order_id) !== Number(order.id) ||
            attempt.provider_tracker_token !== trackerToken || !['RECONCILIATION_REQUIRED', 'INITIATED'].includes(attempt.status)) {
          throw new Error('Checkout attempt requires reconciliation');
        }
        await connection.query(
          `UPDATE payment_attempts SET checkout_url = ?, status = 'INITIATED', updated_at = NOW() WHERE id = ?`,
          [checkoutUrl, attemptId]
        );
        const [updatedOrder] = await connection.query(
          `UPDATE orders SET payment_status = 'PAYMENT_INITIATED', updated_at = NOW()
           WHERE id = ? AND (payment_status IS NULL OR payment_status <> 'PAID')
             AND order_status = 'AWAITING_PAYMENT'`, [order.id]
        );
        if (updatedOrder.affectedRows !== 1) throw new Error('Order checkout transition could not be confirmed');
        await notificationService.enqueueEvent(connection, {
          userId: order.buyer_id, role: 'BUYER', eventType: 'PAYMENT_INITIATED',
          eventKey: `payment-initiated:${attemptId}`, entityId: order.id
        });
        const [rows] = await connection.query('SELECT * FROM payment_attempts WHERE id = ?', [attemptId]);
        await connection.commit();
        return { is_replay: false, attempt: this._formatAttempt(rows[0], orders[0]) };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } catch (error) {
      if (error.code === 'ORDER_ALREADY_PAID') throw error;
      const pending = this._checkoutError('CHECKOUT_RECONCILIATION_REQUIRED',
        'Checkout initiation is pending reconciliation. Do not create another payment session.', 409);
      pending.cause = error;
      throw pending;
    }
  }

  _checkoutError(code, message, statusCode) {
    return Object.assign(new Error(message), { code, statusCode });
  }

  _validateCheckoutOrder(order, actor) {
    if (!order) throw this._checkoutError('ORDER_NOT_FOUND', 'Order not found', 404);
    if (Number(order.buyer_id) !== Number(actor.id)) throw this._checkoutError('FORBIDDEN', 'You do not have permission to checkout this order', 403);
    if (order.buyer_role !== 'BUYER') throw this._checkoutError('UNAUTHORIZED_ROLE', 'Checkout requires a current buyer account', 403);
    if (order.buyer_trust_status === 'SUSPENDED') throw this._checkoutError('ACCOUNT_SUSPENDED', 'Suspended buyer accounts are prohibited from checkout', 403);
    if (order.order_status === 'PAID' || order.payment_status === 'PAID') throw this._checkoutError('ORDER_ALREADY_PAID', 'Order has already been paid in full', 409);
    if (order.order_status !== 'AWAITING_PAYMENT') throw this._checkoutError('INVALID_ORDER_STATUS', `Order is in '${order.order_status}' status and cannot be paid`, 422);
    try {
      exactDecimal.toDecimalString(order.total_amount, { maxPrecision: 12, maxScale: 2, allowNegative: false });
      if (!/[1-9]/.test(String(order.total_amount))) throw new Error('Zero amount');
    } catch (_) {
      throw this._checkoutError('INVALID_PAYABLE_TOTAL', 'Order does not have a complete, valid payable total', 422);
    }
    if (order.currency !== 'PKR') throw this._checkoutError('UNSUPPORTED_CURRENCY', 'Safepay integration currently only accepts PKR', 422);
  }

  _assertCheckoutReady(attempt, actor) {
    if (Number(attempt.buyer_id) !== Number(actor.id)) throw this._checkoutError('FORBIDDEN', 'Checkout attempt belongs to another buyer', 403);
    if (attempt.status === 'RECONCILIATION_REQUIRED' || !attempt.provider_tracker_token || !attempt.checkout_url) {
      throw this._checkoutError('CHECKOUT_RECONCILIATION_REQUIRED', 'Checkout initiation is pending reconciliation. Do not create another payment session.', 409);
    }
  }

  /**
   * Processes a verified Safepay webhook event.
   * Atomically transitions the order to PAID upon verified 'payment.completed'.
   *
   * @param {Object} params
   * @param {Buffer|string} params.rawBody - Raw request body
   * @param {string} params.signature - X-SFPY-SIGNATURE header
   * @param {string} params.timestamp - X-SFPY-TIMESTAMP header
   * @param {string} params.eventId - X-SFPY-EVENT-ID header
   * @param {string} params.eventType - X-SFPY-EVENT-TYPE header
   * @returns {Promise<Object>} Verification and transition outcome
   */
  async processWebhookEvent({
    rawBody,
    signature,
    timestamp,
    eventId,
    eventType
  }) {
    // 1. Signature Verification (Official Safepay HMAC-SHA512 over untouched raw body bytes)
    const signatureScope = safepayAdapter.verifyWebhookSignatureScope({
      rawBody,
      signature
    });

    if (!signatureScope) {
      const err = new Error('Cryptographic signature verification failed');
      err.code = 'INVALID_WEBHOOK_SIGNATURE';
      err.statusCode = 401;
      throw err;
    }

    let parsedPayload;
    try {
      parsedPayload = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
      if (signatureScope === 'data') parsedPayload = parsedPayload.data;
      if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) throw new Error('Object payload required');
    } catch (e) {
      const err = new Error('Malformed webhook JSON payload');
      err.code = 'INVALID_PAYLOAD';
      err.statusCode = 400;
      throw err;
    }

    const envelopeData = (parsedPayload.data && typeof parsedPayload.data === 'object' && !Array.isArray(parsedPayload.data))
      ? parsedPayload.data
      : null;
    // Tracker identity is shared by multiple lifecycle events, so it cannot be
    // the receipt key. Data-signed envelopes must supply a signed event ID;
    // raw-body legacy payloads can use their header or a deterministic digest.
    const signedEventId = [parsedPayload.token, parsedPayload.id, envelopeData?.token, envelopeData?.id]
      .find(value => typeof value === 'string' && value.trim() && !value.startsWith('track_'));
    const effectiveEventId = signedEventId
      || (signatureScope === 'raw_body' ? eventId : null)
      || (signatureScope === 'raw_body' ? `evt_${crypto.createHash('sha256').update(rawBody).digest('hex')}` : null);
    if (!effectiveEventId) {
      const err = new Error('Authenticated webhook payload requires a stable event identity');
      err.code = 'MISSING_WEBHOOK_EVENT_ID'; err.statusCode = 400; throw err;
    }
    const effectiveEventType = parsedPayload.type
      || parsedPayload.event
      || parsedPayload.webhook_event_type
      || envelopeData?.type
      || envelopeData?.event
      || envelopeData?.webhook_event_type
      || (signatureScope === 'raw_body' ? eventType : null)
      || 'unknown';

    // 2. Check for duplicate webhook receipt (Idempotency)
    const [existingEvent] = await db.query(
      `SELECT * FROM payment_webhook_events WHERE event_id = ?`,
      [effectiveEventId]
    );

    if (existingEvent.length > 0) {
      return {
        success: true,
        is_duplicate: true,
        message: 'Duplicate webhook event acknowledged without state mutation'
      };
    }

    // 3. Extract transaction details from webhook payload
    // Official Safepay v1/v2 webhooks (e.g. payment:created 1.0.0) nest fields inside `notification`
    const notification = (parsedPayload.notification && typeof parsedPayload.notification === 'object' && !Array.isArray(parsedPayload.notification))
      ? parsedPayload.notification
      : ((parsedPayload.data?.notification && typeof parsedPayload.data.notification === 'object' && !Array.isArray(parsedPayload.data.notification))
          ? parsedPayload.data.notification
          : null);
    const data = notification || parsedPayload.data || parsedPayload;
    
    // Official Safepay v2 schema: data.tracker can be a string ('track_...') or an object ({ token: 'track_...' })
    let trackerToken = null;
    if (typeof data.tracker === 'string') {
      trackerToken = data.tracker;
    } else if (data.tracker && data.tracker.token) {
      trackerToken = data.tracker.token;
    } else if (data.token) {
      trackerToken = data.token;
    } else if (parsedPayload.token && typeof parsedPayload.token === 'string' && parsedPayload.token.startsWith('track_')) {
      trackerToken = parsedPayload.token;
    }

    const isCreatedEvent = ['payment:created', 'payment.created'].includes(effectiveEventType);
    const rawProviderAmount = (data.tracker && typeof data.tracker === 'object' && data.tracker.amount !== undefined)
      ? data.tracker.amount
      : (data.amount !== undefined
          ? data.amount
          : null);
    const providerAmount = (rawProviderAmount !== null && rawProviderAmount !== '' && !Number.isNaN(Number(rawProviderAmount)))
      ? Number(rawProviderAmount)
      : null;
    const providerCurrency = (data.tracker && typeof data.tracker === 'object' && data.tracker.currency)
      || data.currency
      || parsedPayload.currency
      || null;

    // Support both official Safepay event 'payment.succeeded', 'payment:created' (ONLY when state === 'PAID'),
    // and backwards-compatible 'payment.completed' / variants
    const normalizedProviderState = String(data.state || parsedPayload.state || '').trim().toUpperCase();
    const isExplicitSuccessType = [
      'payment.succeeded',
      'payment:succeeded',
      'payment.completed',
      'payment:completed',
      'payment.settled',
      'payment:settled'
    ].includes(effectiveEventType);
    const isCreatedPaidEvent = isCreatedEvent && normalizedProviderState === 'PAID';
    const explicitStateAllowsSuccess = !normalizedProviderState || ['PAID', 'COMPLETED', 'SUCCEEDED', 'SETTLED'].includes(normalizedProviderState);
    const isSuccessEvent = (isExplicitSuccessType && explicitStateAllowsSuccess) || isCreatedPaidEvent;

    if (!isSuccessEvent) {
      const recordedEventType = (isCreatedEvent || (isExplicitSuccessType && normalizedProviderState))
        ? `${effectiveEventType}:${normalizedProviderState || 'UNKNOWN'}`.slice(0, 100)
        : effectiveEventType;
      // Record event but take no financial mutation
      await db.query(
        `INSERT INTO payment_webhook_events (
          event_id, provider, event_type, provider_tracker_token,
          signature, timestamp_header, raw_payload, processed_status
        ) VALUES (?, 'SAFEPAY', ?, ?, ?, ?, ?, 'PROCESSED')`,
        [
          effectiveEventId,
          recordedEventType,
          trackerToken,
          signature,
          String(timestamp),
          JSON.stringify(parsedPayload)
        ]
      );
      return {
        success: true,
        event_type: effectiveEventType,
        provider_state: normalizedProviderState || null,
        message: 'Webhook event recorded; no state transition required'
      };
    }

    if (!trackerToken) {
      const err = new Error('Webhook success event missing tracker token');
      err.code = 'MISSING_TRACKER_TOKEN';
      err.statusCode = 422;
      throw err;
    }

    // 4. Atomic Database Transaction: Confirm Payment
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Find matching payment attempt
      const [attempts] = await connection.query(
        `SELECT * FROM payment_attempts WHERE provider_tracker_token = ? FOR UPDATE`,
        [trackerToken]
      );

      if (attempts.length === 0) {
        // Unknown tracker: record event in RECONCILIATION_REQUIRED
        await connection.query(
          `INSERT INTO payment_webhook_events (
            event_id, provider, event_type, provider_tracker_token,
            signature, timestamp_header, raw_payload, processed_status, error_message
          ) VALUES (?, 'SAFEPAY', ?, ?, ?, ?, ?, 'RECONCILIATION_REQUIRED', 'No payment_attempt row matches tracker token')`,
          [
            effectiveEventId,
            effectiveEventType,
            trackerToken,
            signature,
            String(timestamp),
            JSON.stringify(parsedPayload)
          ]
        );
        await connection.commit();
        return {
          success: true,
          status: 'RECONCILIATION_REQUIRED',
          message: 'Payment received for untracked session; flagged for reconciliation'
        };
      }

      const attempt = attempts[0];


      // The initial event lookup is deliberately fast but NOT sufficient under
      // concurrent provider retries. Acquiring the payment attempt's FOR UPDATE
      // lock serializes callbacks for the same tracker; recheck event identity
      // inside this transaction after waiting for any previous callback commit.
      // This prevents duplicate-key HTTP 500s without changing financial state.
      const [completedEvent]=await connection.query(
        'SELECT event_id FROM payment_webhook_events WHERE event_id=? FOR UPDATE',
        [effectiveEventId]);
      if(completedEvent.length){
        await connection.commit();
        return {success:true,is_duplicate:true,
          message:'Duplicate authenticated webhook acknowledged after serialized tracker lock'};
      }

      if(attempt.procurement_delivery_contract_id){
        const result=await require('./procurementDeliveryPaymentService').captureWithinTransaction(connection,{attempt,providerAmount,providerCurrency,eventId:effectiveEventId,eventType:effectiveEventType,signature,timestamp,rawPayload:parsedPayload});
        await connection.commit();return result;
      }
      // Lock parent order row FOR UPDATE
      const [orders] = await connection.query(
        `SELECT * FROM orders WHERE id = ? FOR UPDATE`,
        [attempt.order_id]
      );

      if (orders.length === 0) {
        throw new Error(`Order ${attempt.order_id} not found during payment confirmation`);
      }

      const order = orders[0];

      // Currency check
      if (providerCurrency !== (order.currency || 'PKR')) {
        const err = new Error(`Currency mismatch: Expected ${order.currency}, received ${providerCurrency}`);
        err.code = 'CURRENCY_MISMATCH';
        err.statusCode = 422;
        throw err;
      }

      // Exact Amount check (fail-closed - Repair P0-C & B0.2 Fix 4)
      if (providerAmount === null || providerAmount === undefined || isNaN(providerAmount) || providerAmount <= 0) {
        const err = new Error('Safepay webhook payment event must contain a valid positive amount');
        err.code = 'INVALID_PAYLOAD';
        err.statusCode = 422;
        throw err;
      }

      // Safepay official contract: tracker amount is in major units (PKR decimal e.g. 192450.00).
      // Speculative 100x subunit normalizations are strictly eliminated (B0.2 Fix 4).
      const expectedAmountStr = exactDecimal.toCanonicalString(order.total_amount, 2);
      const receivedAmountStr = exactDecimal.toCanonicalString(providerAmount, 2);

      if (!exactDecimal.exactDecimalEquals(expectedAmountStr, receivedAmountStr, 2)) {
        const err = new Error(`Amount mismatch: Expected ${expectedAmountStr}, received ${receivedAmountStr}`);
        err.code = 'AMOUNT_MISMATCH';
        err.statusCode = 422;
        throw err;
      }

      // Check if order was already confirmed PAID
      if (order.order_status === 'PAID') {
        // Mark duplicate webhook receipt safely
        await connection.query(
          `INSERT INTO payment_webhook_events (
            event_id, provider, event_type, order_id, attempt_id, provider_tracker_token,
            signature, timestamp_header, raw_payload, processed_status
          ) VALUES (?, 'SAFEPAY', ?, ?, ?, ?, ?, ?, ?, 'IGNORED_DUPLICATE')`,
          [
            effectiveEventId,
            effectiveEventType,
            order.id,
            attempt.id,
            trackerToken,
            signature,
            String(timestamp),
            JSON.stringify(parsedPayload)
          ]
        );
        await connection.commit();
        return {
          success: true,
          is_duplicate: true,
          message: 'Order was already verified as PAID'
        };
      }

      // 5. Update Payment Attempt to COMPLETED
      await connection.query(
        `UPDATE payment_attempts 
         SET status = 'COMPLETED', updated_at = NOW() 
         WHERE id = ?`,
        [attempt.id]
      );

      // 6. Transition Order to PAID and activate Fulfillment lifecycle
      await connection.query(
        `UPDATE orders 
         SET payment_status = 'PAID', order_status = 'PAID', fulfillment_status = 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT', updated_at = NOW() 
         WHERE id = ?`,
        [order.id]
      );

      // 7. Insert Authoritative Payment Record in `payments` table
      const paymentCode = `PAY-${order.order_code.slice(-8)}-${Date.now().toString().slice(-4)}`;
      await connection.query(
        `INSERT INTO payments (
          payment_code, order_id, reservation_id, buyer_id, amount,
          buyer_fee, payment_method, status, escrow_status,
          transaction_ref, provider_response, paid_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'CARD', 'PAID', 'HELD_IN_ESCROW', ?, ?, NOW(), NOW())`,
        [
          paymentCode,
          order.id,
          order.reservation_id,
          order.buyer_id,
          order.total_amount,
          order.buyer_platform_fee || 0.00,
          trackerToken,
          JSON.stringify({
            event_id: effectiveEventId,
            event_type: effectiveEventType,
            provider: 'SAFEPAY',
            tracker_token: trackerToken,
            provider_state: normalizedProviderState || null,
            provider_reference: data.reference || null,
            provider_fee: data.fee !== undefined ? String(data.fee) : null,
            provider_net: data.net !== undefined ? String(data.net) : null
          })
        ]
      );

      // For B6 supplier orders, atomically mark the shared ORDER_DIRECT
      // listing allocations COMMITTED only after verified provider payment.
      await procurementAwardService.reconcilePaidOrder(connection,order.id);
      await require('./regularPoolPaymentHoldService').markPaid(connection,order.id);

      // 8. Record Webhook Event as PROCESSED
      await connection.query(
        `INSERT INTO payment_webhook_events (
          event_id, provider, event_type, order_id, attempt_id, provider_tracker_token,
          signature, timestamp_header, raw_payload, processed_status
        ) VALUES (?, 'SAFEPAY', ?, ?, ?, ?, ?, ?, ?, 'PROCESSED')`,
        [
          effectiveEventId,
          effectiveEventType,
          order.id,
          attempt.id,
          trackerToken,
          signature,
          String(timestamp),
          JSON.stringify(parsedPayload)
        ]
      );

      // 9. Transactional Outbox Event: ORDER_PAID (only if associated with a pool)
      if (order.pool_id) {
        const eventIdOutbox = reservationEventService.generateEventId({
          event_type: 'ORDER_PAID',
          pool_id: order.pool_id,
          reservation_id: order.reservation_id || 0,
          actor_id: order.buyer_id,
          mutation_type: 'PAYMENT_CONFIRMATION',
          idempotency_key: effectiveEventId,
          event_sequence: 1
        });

        await connection.query(
          `INSERT INTO reservation_business_events (
            event_id, pool_id, reservation_id, actor_id, actor_role,
            event_type, event_payload, idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, 'BUYER', 'ORDER_PAID', ?, ?, NOW())`,
          [
            eventIdOutbox,
            order.pool_id,
            order.reservation_id || null,
            order.buyer_id,
            JSON.stringify({
              order_id: order.id,
              order_code: order.order_code,
              amount: Number(order.total_amount),
              currency: order.currency || 'PKR',
              provider: 'SAFEPAY',
              tracker_token: trackerToken,
              payment_status: 'PAID',
              order_status: 'PAID'
            }),
            effectiveEventId
          ]
        );
      }

      // One order payment transition identity across webhook and reconciliation.
      for (const [userId, role] of [[order.buyer_id, 'BUYER'], [order.supplier_id, 'SUPPLIER']]) {
        await notificationService.enqueueEvent(connection, {
          userId, role, eventType: 'PAYMENT_VERIFIED',
          eventKey: `order:${order.id}:payment:verified`, entityId: order.id
        });
      }

      await connection.commit();

      // B5 Flash pool stock transitions only AFTER an authentic confirmed
      // payment. Reconciliation uses its own transaction and is idempotent;
      // a transient failure must stay recoverable from the buyer hold endpoint.
      try {
        await require('./flashPoolService').reconcilePaidOrder(order.id);
      } catch (flashError) {
        console.error('[B5/B6] Verified Flash payment needs reconciliation:',
          flashError.code || flashError.message);
      }

      try {
        await require('./invoiceService').generateInvoiceForOrder(order.id, { id: order.buyer_id, role: 'BUYER' });
      } catch (invoiceError) {
        console.warn('[Safepay Webhook] Auto-invoice generation notice:', invoiceError.message);
      }

      return {
        success: true,
        order_id: order.id,
        order_code: order.order_code,
        payment_status: 'PAID',
        order_status: 'PAID',
        message: 'Order payment successfully confirmed via authentic Safepay webhook'
      };

    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Retrieves the authoritative payment status for a buyer order.
   *
   * @param {Object} params
   * @param {number} params.orderId - Target order ID
   * @param {Object} params.actor - Authenticated caller { id, role }
   * @returns {Promise<Object>} Payment status representation
   */
  async getOrderPaymentStatus({ orderId, actor }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ID';
      err.statusCode = 400;
      throw err;
    }

    const [orders] = await db.query(
      `SELECT o.*, u.business_name AS buyer_name
       FROM orders o
       JOIN users u ON o.buyer_id = u.id
       WHERE o.id = ?`,
      [orderId]
    );

    if (orders.length === 0) {
      const err = new Error('Order not found');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const order = orders[0];

    // Payment and checkout tracker URLs are private to the buyer or finance/admin roles.
    if (!actor || !(actor.role === 'BUYER' && Number(order.buyer_id) === Number(actor.id)) &&
        !['ADMIN','SUPER_ADMIN','FINANCE_ADMIN'].includes(actor.role)) {
      const err = new Error('You do not have permission to view payment status for this order');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    // Fetch latest payment attempt
    const [attempts] = await db.query(
      `SELECT * FROM payment_attempts 
       WHERE order_id = ? AND procurement_delivery_contract_id IS NULL
       ORDER BY id DESC LIMIT 1`,
      [orderId]
    );

    const latestAttempt = attempts[0] || null;

    let lifecyclePhase = 'CHECKOUT_NOT_STARTED';
    if (order.order_status === 'PAID') {
      lifecyclePhase = 'VERIFIED_PAYMENT_COMPLETED';
    } else if (latestAttempt) {
      if (latestAttempt.status === 'INITIATED') {
        lifecyclePhase = 'WAITING_FOR_PROVIDER_CONFIRMATION';
      } else if (latestAttempt.status === 'FAILED') {
        lifecyclePhase = 'CHECKOUT_FAILED';
      } else if (latestAttempt.status === 'RECONCILIATION_REQUIRED') {
        lifecyclePhase = 'RECONCILIATION_REQUIRED';
      }
    }

    const regularPoolPaymentHold = await require('./regularPoolPaymentHoldService')
      .readForOrder(order.id,order.buyer_id);

    return {
      order_id: order.id,
      order_code: order.order_code,
      buyer_id: order.buyer_id,
      payment_status: order.payment_status,
      order_status: order.order_status,
      total_amount: Number(order.total_amount),
      currency: order.currency,
      lifecycle_phase: lifecyclePhase,
      regular_pool_payment_hold: regularPoolPaymentHold,
      latest_attempt: latestAttempt ? {
        attempt_code: latestAttempt.attempt_code,
        status: latestAttempt.status,
        provider: latestAttempt.provider,
        environment: latestAttempt.environment,
        provider_tracker_token: latestAttempt.provider_tracker_token,
        checkout_url: latestAttempt.checkout_url,
        created_at: latestAttempt.created_at
      } : null
    };
  }

  /**
   * Authoritatively reconciles an order's payment status with Safepay.
   * Fetches provider state directly from Safepay API outside database locks,
   * validates cryptographic signature and exact amounts, and transactionally
   * confirms the order if captured.
   *
   * @param {Object} params
   * @param {number} params.orderId - Target order ID
   * @param {Object} [params.actor] - Optional authenticated caller { id, role }
   * @param {Object} [params.mockClient] - Optional injected client for tests
   * @returns {Promise<Object>} Reconciliation result
   */
  async reconcilePaymentWithProvider({ orderId, actor = null, mockClient = null }) {
    if (!orderId || isNaN(orderId)) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ID';
      err.statusCode = 400;
      throw err;
    }

    // Step 1: Read order and latest attempt
    const [orders] = await db.query(
      `SELECT o.*, u.buyer_trust_status
       FROM orders o
       JOIN users u ON o.buyer_id = u.id
       WHERE o.id = ?`,
      [orderId]
    );

    if (orders.length === 0) {
      const err = new Error('Order not found');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const order = orders[0];

    // An authenticated caller cannot reconcile somebody else's payment.
    // Internal trusted provider hooks may call with actor=null.
    if (actor && !(actor.role === 'BUYER' && Number(order.buyer_id) === Number(actor.id)) &&
        !['ADMIN','SUPER_ADMIN','FINANCE_ADMIN'].includes(actor.role)) {
      const err = new Error('You do not have permission to reconcile this order');
      err.code = 'FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    // If order is already PAID, return idempotent confirmation
    if (order.order_status === 'PAID' || order.payment_status === 'PAID') {
      const [existingPayments] = await db.query(
        `SELECT * FROM payments WHERE order_id = ? AND procurement_delivery_contract_id IS NULL ORDER BY id DESC LIMIT 1`,
        [orderId]
      );
      return {
        success: true,
        reconciled: false,
        already_paid: true,
        order_status: 'PAID',
        payment_status: 'PAID',
        payment: existingPayments[0] || null,
        message: 'Order is already verified as PAID'
      };
    }

    // Must be in AWAITING_PAYMENT / PAYMENT_INITIATED
    if (order.order_status !== 'AWAITING_PAYMENT') {
      const err = new Error(`Order is in '${order.order_status}' status and cannot be reconciled`);
      err.code = 'INVALID_ORDER_STATUS';
      err.statusCode = 422;
      throw err;
    }

    // A crash after tracker persistence can leave an unresolved reservation
    // without a checkout URL. It still has a real provider identity to recover.
    const [attempts] = await db.query(
      `SELECT * FROM payment_attempts 
       WHERE order_id = ? AND status IN ('INITIATED', 'RECONCILIATION_REQUIRED') AND procurement_delivery_contract_id IS NULL
       ORDER BY id DESC LIMIT 1`,
      [orderId]
    );

    if (attempts.length === 0) {
      const err = new Error('No unresolved payment attempt found for this order');
      err.code = 'NO_ACTIVE_PAYMENT_ATTEMPT';
      err.statusCode = 422;
      throw err;
    }

    const attempt = attempts[0];
    const trackerToken = attempt.provider_tracker_token;
    if (typeof trackerToken !== 'string' || !trackerToken.trim()) {
      throw this._checkoutError('CHECKOUT_RECONCILIATION_REQUIRED',
        'Checkout initiation is pending reconciliation; no provider tracker has been persisted.', 409);
    }

    // Step 2: Fetch authoritative tracker status from Safepay OUTSIDE transaction lock
    const providerResponse = await safepayAdapter.fetchTracker(trackerToken, { mockClient });

    if (!providerResponse || !providerResponse.data) {
      const err = new Error('Safepay returned empty tracker data');
      err.code = 'INVALID_PROVIDER_RESPONSE';
      err.statusCode = 502;
      throw err;
    }

    const trackerData = providerResponse.data;

    // Verify token identity
    if (trackerData.token !== trackerToken) {
      const err = new Error(`Tracker token mismatch: expected ${trackerToken}, received ${trackerData.token}`);
      err.code = 'TRACKER_MISMATCH';
      err.statusCode = 502;
      throw err;
    }

    // Verify state: Safepay marks captured/completed sessions as 'TRACKER_ENDED' with transaction object
    const isCaptured = ['TRACKER_ENDED', 'COMPLETED', 'PAID'].includes(trackerData.state) && !!trackerData.transaction;
    if (!isCaptured) {
      return {
        success: true,
        reconciled: false,
        order_status: order.order_status,
        payment_status: order.payment_status,
        provider_state: trackerData.state,
        message: `Payment not yet captured by provider (state: ${trackerData.state})`
      };
    }

    const transaction = trackerData.transaction;

    // Verify currency
    const providerCurrency = trackerData.currency || transaction.currency || 'PKR';
    if (providerCurrency !== (order.currency || 'PKR')) {
      const err = new Error(`Currency mismatch: Expected ${order.currency}, received ${providerCurrency}`);
      err.code = 'CURRENCY_MISMATCH';
      err.statusCode = 422;
      throw err;
    }

    // Verify exact amount
    const providerAmount = Number(trackerData.amount || transaction.amount);
    const expectedAmountStr = exactDecimal.toCanonicalString(order.total_amount, 2);
    const receivedAmountStr = exactDecimal.toCanonicalString(providerAmount, 2);

    if (!exactDecimal.exactDecimalEquals(expectedAmountStr, receivedAmountStr, 2)) {
      const err = new Error(`Amount mismatch: Expected ${expectedAmountStr}, received ${receivedAmountStr}`);
      err.code = 'AMOUNT_MISMATCH';
      err.statusCode = 422;
      throw err;
    }

    // Cryptographic signature check on transaction if secretKey available
    if (transaction.signature && safepayAdapter.secretKey) {
      const computedSig = crypto
        .createHmac('sha256', safepayAdapter.secretKey)
        .update(trackerToken)
        .digest('hex');

      const expectedSigBuf = Buffer.from(computedSig.toLowerCase(), 'utf8');
      const receivedSigBuf = Buffer.from(String(transaction.signature).toLowerCase(), 'utf8');

      if (expectedSigBuf.length !== receivedSigBuf.length || !crypto.timingSafeEqual(expectedSigBuf, receivedSigBuf)) {
        const err = new Error('Cryptographic signature verification on provider transaction failed');
        err.code = 'INVALID_TRANSACTION_SIGNATURE';
        err.statusCode = 422;
        throw err;
      }
    }

    // Step 3: Transactional confirmation under MySQL locks
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Lock attempt and order
      const [lockedAttempts] = await connection.query(
        `SELECT * FROM payment_attempts WHERE id = ? FOR UPDATE`,
        [attempt.id]
      );
      const [lockedOrders] = await connection.query(
        `SELECT * FROM orders WHERE id = ? FOR UPDATE`,
        [order.id]
      );

      const lockedOrder = lockedOrders[0];
      if (lockedOrder.order_status === 'PAID' || lockedOrder.payment_status === 'PAID') {
        await connection.commit();
        return {
          success: true,
          reconciled: false,
          already_paid: true,
          order_status: 'PAID',
          payment_status: 'PAID',
          message: 'Order was already verified as PAID'
        };
      }

      // Update payment attempt to COMPLETED
      await connection.query(
        `UPDATE payment_attempts SET status = 'COMPLETED', updated_at = NOW() WHERE id = ?`,
        [attempt.id]
      );

      // Transition order to PAID and activate Fulfillment lifecycle
      await connection.query(
        `UPDATE orders SET payment_status = 'PAID', order_status = 'PAID', fulfillment_status = 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT', updated_at = NOW() WHERE id = ?`,
        [order.id]
      );

      await require('./regularPoolPaymentHoldService').markPaid(connection,order.id);

      // Insert into payments
      const paymentCode = `PAY-${order.order_code.slice(-8)}-${Date.now().toString().slice(-4)}`;
      const [paymentInsert] = await connection.query(
        `INSERT INTO payments (
          payment_code, order_id, reservation_id, buyer_id, amount,
          buyer_fee, payment_method, status, escrow_status,
          transaction_ref, provider_response, paid_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'CARD', 'PAID', 'HELD_IN_ESCROW', ?, ?, NOW(), NOW())`,
        [
          paymentCode,
          order.id,
          order.reservation_id,
          order.buyer_id,
          order.total_amount,
          order.buyer_platform_fee || 0.00,
          transaction.token || trackerToken,
          JSON.stringify({
            reconciled_via: 'DIRECT_PROVIDER_VERIFICATION',
            tracker_token: trackerToken,
            transaction_token: transaction.token,
            transaction_ref: transaction.reference,
            provider_state: trackerData.state,
            amount: providerAmount,
            currency: providerCurrency
          })
        ]
      );

      // Record in payment_webhook_events as an authoritative reconciliation record
      const reconciliationEventId = `evt_rec_${transaction.token || Date.now()}`;
      await connection.query(
        `INSERT INTO payment_webhook_events (
          event_id, provider, event_type, order_id, attempt_id, provider_tracker_token,
          signature, timestamp_header, raw_payload, processed_status
        ) VALUES (?, 'SAFEPAY', 'payment.reconciled', ?, ?, ?, ?, ?, ?, 'PROCESSED')`,
        [
          reconciliationEventId,
          order.id,
          attempt.id,
          trackerToken,
          transaction.signature || 'verified_reconciliation',
          String(transaction.created_at || Date.now()),
          JSON.stringify(providerResponse)
        ]
      );

      await procurementAwardService.reconcilePaidOrder(connection,order.id);

      // B4 pool outbox: only valid for actual pool-backed orders.
      // B5/B6 poolless orders use verified payment rows and their own lifecycle events.
      if (order.pool_id) {
      // Transactional Outbox Event: ORDER_PAID
      const eventIdOutbox = reservationEventService.generateEventId({
        event_type: 'ORDER_PAID',
        pool_id: order.pool_id || 0,
        reservation_id: order.reservation_id || 0,
        actor_id: order.buyer_id,
        mutation_type: 'PAYMENT_CONFIRMATION',
        idempotency_key: reconciliationEventId,
        event_sequence: 1
      });

      await connection.query(
        `INSERT INTO reservation_business_events (
          event_id, pool_id, reservation_id, actor_id, actor_role,
          event_type, event_payload, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, 'BUYER', 'ORDER_PAID', ?, ?, NOW())`,
        [
          eventIdOutbox,
          order.pool_id || 0,
          order.reservation_id || 0,
          order.buyer_id,
          JSON.stringify({
            order_id: order.id,
            order_code: order.order_code,
            amount: Number(order.total_amount),
            currency: order.currency || 'PKR',
            provider: 'SAFEPAY',
            tracker_token: trackerToken,
            transaction_token: transaction.token,
            payment_status: 'PAID',
            order_status: 'PAID',
            reconciliation: true
          }),
          reconciliationEventId
        ]
      );
      }

      for (const [userId, role] of [[lockedOrder.buyer_id, 'BUYER'], [lockedOrder.supplier_id, 'SUPPLIER']]) {
        await notificationService.enqueueEvent(connection, {
          userId, role, eventType: 'PAYMENT_VERIFIED',
          eventKey: `order:${lockedOrder.id}:payment:verified`, entityId: lockedOrder.id
        });
      }

      await connection.commit();

      try {
        await require('./flashPoolService').reconcilePaidOrder(order.id);
      } catch (flashError) {
        console.error('[B5/B6] Reconciled Flash payment needs stock update:',
          flashError.code || flashError.message);
      }

      try {
        await require('./invoiceService').generateInvoiceForOrder(order.id, { id: order.buyer_id, role: 'BUYER' });
      } catch (invoiceError) {
        console.warn('[Safepay Reconcile] Auto-invoice generation notice:', invoiceError.message);
      }

      const [newPayments] = await db.query(
        `SELECT * FROM payments WHERE id = ?`,
        [paymentInsert.insertId]
      );

      return {
        success: true,
        reconciled: true,
        order_status: 'PAID',
        payment_status: 'PAID',
        payment: newPayments[0],
        message: 'Order payment successfully reconciled and confirmed from authoritative provider state'
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  _formatAttempt(attempt, order) {
    return {
      attempt_code: attempt.attempt_code,
      order_id: order.id,
      order_code: order.order_code,
      amount: Number(attempt.amount),
      currency: attempt.currency,
      provider: attempt.provider,
      environment: attempt.environment,
      status: attempt.status,
      provider_tracker_token: attempt.provider_tracker_token,
      checkout_url: attempt.checkout_url,
      created_at: attempt.created_at
    };
  }
}

module.exports = new SafepayCheckoutService();
