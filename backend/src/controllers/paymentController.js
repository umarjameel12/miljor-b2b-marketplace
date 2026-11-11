// =============================================================================
// src/controllers/paymentController.js
// MAJOR REWRITE — Fixes:
//   BUG-01: Uses 'payments' table ONLY (escrow_payments eliminated)
//   BUG-11: Validates reservation ownership, status, and amount match
//   BUG-07: Idempotency applied at route level
//   BUG-13: No hardcoded JWT fallback
// Full flow: CREATED → PENDING → PAID → Ledger entry
// =============================================================================
const paymentRepo = require('../repositories/paymentRepo');
const paymentProviderService = require('../services/paymentProviderService');
const safepayCheckoutService = require('../services/safepayCheckoutService');
const db = require('../config/db');


// Read-only provenance resolver. Payment method (CARD) is not the provider.
// Never select an arbitrary attempt belonging to the same order.
async function resolveRecordedProvider(payment) {
  let responseProvider = null;
  if (payment.provider_response) {
    try {
      const evidence = typeof payment.provider_response === 'string'
        ? JSON.parse(payment.provider_response)
        : payment.provider_response;
      if (typeof evidence?.provider === 'string') {
        responseProvider = evidence.provider.trim().toUpperCase();
      }
    } catch (_) {
      return null; // Corrupt evidence must not be silently ignored.
    }
  }

  let attemptProvider = null;
  if (payment.transaction_ref) {
    const [attempts] = await db.query(
      'SELECT provider, order_id, buyer_id FROM payment_attempts WHERE provider_tracker_token = ? LIMIT 2',
      [payment.transaction_ref]
    );
    if (attempts.length > 1) return null;
    if (attempts.length === 1) {
      const attempt = attempts[0];
      if ((payment.order_id && Number(attempt.order_id) !== Number(payment.order_id))
          || Number(attempt.buyer_id) !== Number(payment.buyer_id)) {
        return null; // Exact tracker must also belong to this payment's buyer/order.
      }
      attemptProvider = String(attempt.provider || '').toUpperCase();
    }
  }

  if (responseProvider && attemptProvider && responseProvider !== attemptProvider) return null;
  // Legacy explicit SAFEPAY method is not sufficient to override conflicting evidence.
  const legacyProvider = !payment.transaction_ref && payment.payment_method === 'SAFEPAY'
    ? 'SAFEPAY' : null;
  return responseProvider || attemptProvider || legacyProvider;
}

class PaymentController {

  // ---------------------------------------------------------------------------
  // POST /api/v1/payments/initiate
  // Buyer payment initiation (Safepay Only)
  // ---------------------------------------------------------------------------
  async initiatePayment(req, res) {
    try {
      const buyer_id = req.user.id;
      const { reservation_id, payment_method = 'SAFEPAY' } = req.body;

      if (!reservation_id) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'reservation_id is required' }
        });
      }

      // Phase B0: Safepay is the SOLE active payment provider
      const normalizedProvider = String(payment_method || '').toUpperCase();
      if (normalizedProvider !== 'SAFEPAY') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'UNSUPPORTED_PAYMENT_PROVIDER',
            message: `Payment provider '${payment_method}' is not supported. Safepay is the sole active payment provider for MilJor.`
          }
        });
      }

      // 1. Fetch reservation and validate ownership
      const [reservations] = await db.query(
        'SELECT * FROM reservations WHERE id = ?',
        [reservation_id]
      );

      if (!reservations[0]) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Reservation not found' }
        });
      }

      const reservation = reservations[0];

      // Ownership check
      if (reservation.buyer_id !== buyer_id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You can only pay for your own reservations' }
        });
      }

      // Status check — must be CONFIRMED (price is locked)
      if (reservation.status !== 'CONFIRMED') {
        return res.status(422).json({
          success: false,
          error: {
            code: 'INVALID_RESERVATION_STATUS',
            message: `Reservation must be CONFIRMED before payment. Current status: ${reservation.status}`
          }
        });
      }

      // Check for existing PAID payment (duplicate prevention)
      const existingPayment = await paymentRepo.findByReservationId(reservation_id);
      if (existingPayment && ['PAID', 'PENDING', 'PROCESSING'].includes(existingPayment.status)) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'PAYMENT_EXISTS',
            message: `A ${existingPayment.status} payment already exists for this reservation`,
            data: { payment_id: existingPayment.id, payment_code: existingPayment.payment_code }
          }
        });
      }

      // Canonical Safepay Flow: Check if an authoritative order has been converted for this reservation
      const [orders] = await db.query(
        'SELECT id, order_code, order_status FROM orders WHERE reservation_id = ?',
        [reservation_id]
      );

      if (!orders[0]) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'ORDER_REQUIRED_FOR_PAYMENT',
            message: 'Reservations must be converted to an authoritative order before Safepay checkout can initiate. Please use /api/v1/orders/:id/checkout once orders are generated.'
          }
        });
      }

      const order = orders[0];
      // Redirect / delegate directly to canonical Safepay checkout flow
      return res.status(200).json({
        success: true,
        message: 'Order identified for reservation. Please complete checkout via canonical Safepay order endpoint.',
        data: {
          reservation_id,
          order_id: order.id,
          order_code: order.order_code,
          checkout_endpoint: `/api/v1/orders/${order.id}/checkout`,
          payment_method: 'SAFEPAY'
        }
      });
    } catch (error) {
      console.error('Payment Initiate Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'PAYMENT_INITIATION_FAILED', message: 'Payment initiation failed. Please try again.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/payments/verify
  // Legacy read-only verification compatibility: NEVER updates financial state.
  // ---------------------------------------------------------------------------
  async verifyPayment(req, res) {
    try {
      const buyer_id = req.user.id;
      const { payment_id, transaction_ref } = req.body;

      if (!payment_id || !transaction_ref) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'payment_id and transaction_ref are required' }
        });
      }

      // Fetch payment record
      const payment = await paymentRepo.findById(payment_id);
      if (!payment) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Payment record not found' }
        });
      }

      // Ownership check
      if (payment.buyer_id !== buyer_id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied' }
        });
      }

      // Already verified?
      if (payment.status === 'PAID') {
        return res.status(200).json({
          success: true,
          message: 'Payment already verified and confirmed',
          data: { payment_id, status: 'PAID', payment_code: payment.payment_code }
        });
      }

      if (!['PENDING', 'PROCESSING'].includes(payment.status)) {
        return res.status(422).json({
          success: false,
          error: { code: 'INVALID_PAYMENT_STATUS', message: `Cannot verify a payment in status: ${payment.status}` }
        });
      }

      const provider = await resolveRecordedProvider(payment);
      if (!provider) {
        return res.status(402).json({
          success: false,
          error: { code: 'PAYMENT_VERIFICATION_FAILED', message: 'Missing or conflicting payment provider evidence.' }
        });
      }

      // Legacy endpoint must NEVER write PAID/reservation/ledger state.
      // Only canonical Safepay signed webhooks or trusted order reconciliation may complete payment.
      const verification = await paymentProviderService.verifyPayment({
        provider, transaction_ref, expected_amount: payment.amount
      });
      if (verification.verified) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'LEGACY_VERIFICATION_DISABLED',
            message: 'Complete payment through the authoritative order Safepay reconciliation endpoint.'
          }
        });
      }
      return res.status(402).json({
        success: false,
        error: {
          code: 'PAYMENT_VERIFICATION_FAILED',
          message: 'Payment is not confirmed. Use the authorized order payment-status or reconciliation endpoint.'
        }
      });
    } catch (error) {
      console.error('Payment Verify Error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'VERIFICATION_FAILED', message: 'Payment verification failed. Please try again.' }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/payments/:id  — Get payment status (buyer owns it or admin)
  // BUG-01 FIX: Queries 'payments' table
  // ---------------------------------------------------------------------------
  async getPaymentStatus(req, res) {
    try {
      const payment = await paymentRepo.findById(req.params.id);

      if (!payment) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Payment not found' }
        });
      }

      const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN'].includes(req.user.role);
      if (!isAdmin && payment.buyer_id !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Access denied' }
        });
      }

      // Strip provider_response from non-admin users
      if (!isAdmin) {
        delete payment.provider_response;
      }

      return res.status(200).json({ success: true, data: { payment } });

    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/payments/my  — Buyer's payment history
  // ---------------------------------------------------------------------------
  async getMyPayments(req, res) {
    try {
      const payments = await paymentRepo.findByBuyerId(req.user.id);
      return res.status(200).json({ success: true, count: payments.length, data: { payments } });
    } catch (error) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/payments/:id/refund  — Admin initiates refund
  // ---------------------------------------------------------------------------
  async initiateRefund(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const payment = await paymentRepo.findById(id);
      if (!payment) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Payment not found' } });
      }

      if (!['PAID', 'DISPUTED'].includes(payment.status)) {
        return res.status(422).json({
          success: false,
          error: { code: 'INVALID_STATUS', message: `Cannot refund payment in status: ${payment.status}` }
        });
      }

      const provider = await resolveRecordedProvider(payment);

      // If still missing, reject refund initiation immediately
      if (!provider) {
        return res.status(400).json({
          success: false,
          error: { code: 'UNSUPPORTED_PAYMENT_PROVIDER', message: 'Payment record lacks identifiable provider provenance' }
        });
      }

      // Initiate refund with provider
      const refundResult = await paymentProviderService.initiateRefund({
        provider,
        transaction_ref: payment.transaction_ref,
        amount: payment.amount,
        reason: reason || 'Admin-initiated refund'
      });

      if (!refundResult.success) {
        // Audit the attempted, unexecuted refund; this is NOT an approved refund obligation.
        // Do not create an actual financial refund record or change payment/ledger state.
        await db.query(
          `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
           VALUES (?, ?, 'PAYMENT_REFUND_ATTEMPT_BLOCKED', 'payments', ?, ?)`,
          [req.user.id, req.user.role, id, JSON.stringify({
            reason: reason || 'Admin-initiated refund', provider, outcome: refundResult.status
          })]
        );
        const errStatus = refundResult.status === 'UNSUPPORTED_PAYMENT_PROVIDER' ? 400 : 503;
        return res.status(errStatus).json({
          success: false,
          error: { code: refundResult.status, message: refundResult.message }
        });
      }

      // FIX 5: Legacy refund endpoint MUST NOT independently finalize refunds or mark REFUNDED.
      // External money movement is DISABLED. Refund request/approval != external refund completion.
      // Authoritative settlement completion is strictly governed by financialSettlementService.
      await db.query(
        `INSERT INTO system_audit_logs (actor_id, actor_role, action, entity_name, entity_id, new_value)
         VALUES (?, ?, 'PAYMENT_REFUND_REQUESTED', 'payments', ?, ?)`,
        [req.user.id, req.user.role, id, JSON.stringify({ reason, refund_ref: refundResult.refund_ref })]
      );

      return res.status(202).json({
        success: true,
        message: 'Refund requested successfully. Awaiting verified external/manual settlement evidence.',
        data: { payment_id: parseInt(id), status: payment.status, refund_ref: refundResult.refund_ref }
      });

    } catch (error) {
      console.error('Refund Error:', error);
      return res.status(500).json({ success: false, error: { code: 'REFUND_FAILED', message: error.message } });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/payments/webhook/safepay
  // Unauthenticated provider webhook endpoint verified via cryptographic signature
  // ---------------------------------------------------------------------------
  async handleSafepayWebhook(req, res) {
    try {
      const rawBody = req.rawBody !== undefined
        ? req.rawBody
        : (Buffer.isBuffer(req.body)
            ? req.body
            : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}), 'utf8'));

      const signature = req.headers['x-sfpy-signature'] || req.headers['x-safepay-signature'];
      const timestamp = req.headers['x-sfpy-timestamp'] || req.headers['x-safepay-timestamp'];
      const eventId = req.headers['x-sfpy-event-id'] || req.headers['x-safepay-event-id'];
      const eventType = req.headers['x-sfpy-event-type'] || req.headers['x-safepay-event-type'];

      const result = await safepayCheckoutService.processWebhookEvent({
        rawBody,
        signature,
        timestamp,
        eventId,
        eventType
      });

      return res.status(200).json({
        success: true,
        message: result.message || 'Webhook processed successfully',
        data: result
      });
    } catch (err) {
      const statusCode = err.statusCode || (
        err.code === 'INVALID_WEBHOOK_SIGNATURE' ? 401 :
        err.code === 'INVALID_PAYLOAD' ? 400 :
        err.code === 'CURRENCY_MISMATCH' || err.code === 'AMOUNT_MISMATCH' || err.code === 'MISSING_TRACKER_TOKEN' ? 422 :
        500
      );

      return res.status(statusCode).json({
        success: false,
        error: {
          code: err.code || 'WEBHOOK_PROCESSING_FAILED',
          message: err.message
        }
      });
    }
  }
}

module.exports = new PaymentController();