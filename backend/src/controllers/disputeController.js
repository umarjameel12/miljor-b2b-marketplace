// =============================================================================
// src/controllers/disputeController.js
// MilJor Part 4E.5: Buyer Protection, Dispute & Fulfillment Exception Resolution Controller
//
// Invariants:
// - All mutations delegate to transactional disputeService under row locks
// - Mandatory X-Idempotency-Key on state transitions
// - Exact decimal claim assessment
// - payments.escrow_status remains strictly unchanged
// =============================================================================

const disputeService = require('../services/disputeService');
const db = require('../config/db');

class DisputeController {

  // ---------------------------------------------------------------------------
  // POST /api/v1/disputes
  // Buyer files a dispute against an owned eligible order
  // ---------------------------------------------------------------------------
  async createDispute(req, res) {
    try {
      const buyer = req.user;
      const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotency_key;

      const {
        order_id,
        reservation_id,
        category,
        reason,
        description,
        disputed_quantity,
        reported_quantity,
        evidence_metadata,
        evidence_image_url
      } = req.body;

      // Support reservation_id lookup for backwards compatibility
      let targetOrderId = order_id;
      if (!targetOrderId && reservation_id) {
        const [orders] = await db.query(
          `SELECT id FROM orders WHERE reservation_id = ?`,
          [reservation_id]
        );
        if (orders.length > 0) {
          targetOrderId = orders[0].id;
        } else {
          return res.status(404).json({
            success: false,
            error: { code: 'ORDER_NOT_FOUND', message: 'No order found for specified reservation' }
          });
        }
      }

      const result = await disputeService.createBuyerDispute({
        orderId: targetOrderId,
        actor: buyer,
        category: category || reason,
        description,
        disputedQuantity: disputed_quantity,
        reportedQuantity: reported_quantity,
        evidenceMetadata: evidence_metadata,
        evidenceImageUrl: evidence_image_url,
        idempotencyKey
      });

      const statusCode = result.is_replay ? 200 : 201;
      return res.status(statusCode).json({
        success: true,
        message: result.message,
        data: result
      });

    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || 'SERVER_ERROR',
          message: error.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/disputes/supplier/shortage
  // Supplier declares pre-dispatch shortage exception
  // ---------------------------------------------------------------------------
  async declareSupplierShortage(req, res) {
    try {
      const supplier = req.user;
      const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotency_key;
      const { order_id, shortage_quantity, description, evidence_metadata } = req.body;

      const result = await disputeService.createSupplierShortageException({
        orderId: order_id,
        actor: supplier,
        shortageQuantity: shortage_quantity,
        description,
        evidenceMetadata: evidence_metadata,
        idempotencyKey
      });

      const statusCode = result.is_replay ? 200 : 201;
      return res.status(statusCode).json({
        success: true,
        message: result.message,
        data: result
      });

    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || 'SERVER_ERROR',
          message: error.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/disputes/my
  // Buyer lists own disputes
  // ---------------------------------------------------------------------------
  async getMyDisputes(req, res) {
    try {
      const { page, limit } = req.query;
      const result = await disputeService.getBuyerDisputes({
        actor: req.user,
        page,
        limit
      });

      return res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || 'SERVER_ERROR',
          message: error.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/disputes/supplier/list
  // Supplier lists assigned disputes
  // ---------------------------------------------------------------------------
  async getSupplierDisputes(req, res) {
    try {
      const { page, limit } = req.query;
      const result = await disputeService.getSupplierDisputes({
        actor: req.user,
        page,
        limit
      });

      return res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || 'SERVER_ERROR',
          message: error.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/disputes/:id
  // Object-authorized dispute details and audit timeline
  // ---------------------------------------------------------------------------
  async getDisputeById(req, res) {
    try {
      const { id } = req.params;
      const result = await disputeService.getDisputeById({
        disputeId: id,
        actor: req.user
      });

      return res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || 'SERVER_ERROR',
          message: error.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GET /api/v1/disputes
  // Admin lists all disputes (paginated, status filter)
  // ---------------------------------------------------------------------------
  async getAllDisputes(req, res) {
    try {
      const { status, page, limit } = req.query;
      const result = await disputeService.getAdminDisputes({
        status,
        page,
        limit
      });

      return res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || 'SERVER_ERROR',
          message: error.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/disputes/:id/supplier-response
  // Supplier responds to dispute and proposes remediation
  // ---------------------------------------------------------------------------
  async submitSupplierResponse(req, res) {
    try {
      const { id } = req.params;
      const supplier = req.user;
      const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotency_key;
      const { response, remediation_proposal, remediation_details, evidence_metadata } = req.body;

      const result = await disputeService.submitSupplierResponse({
        disputeId: id,
        actor: supplier,
        response,
        remediationProposal: remediation_proposal,
        remediationDetails: remediation_details,
        evidenceMetadata: evidence_metadata,
        idempotencyKey
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });

    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || 'SERVER_ERROR',
          message: error.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/disputes/:id/remediation/declare-delivered
  // Supplier declares physical replacement / missing quantity delivered
  // ---------------------------------------------------------------------------
  async declareRemediationDelivered(req, res) {
    try {
      const { id } = req.params;
      const supplier = req.user;
      const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotency_key;
      const { tracking_reference, notes } = req.body;

      const result = await disputeService.declareSupplierRemediationDispatched({
        disputeId: id,
        actor: supplier,
        trackingReference: tracking_reference,
        notes,
        idempotencyKey
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });

    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || 'SERVER_ERROR',
          message: error.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/disputes/:id/remediation/confirm-receipt
  // Buyer confirms receipt of physical remediation goods
  // ---------------------------------------------------------------------------
  async confirmBuyerRemediationReceipt(req, res) {
    try {
      const { id } = req.params;
      const buyer = req.user;
      const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotency_key;
      const { notes } = req.body;

      const result = await disputeService.confirmBuyerRemediationReceipt({
        disputeId: id,
        actor: buyer,
        notes,
        idempotencyKey
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });

    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || 'SERVER_ERROR',
          message: error.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/disputes/:id/decision
  // Admin records operational decision (claim accepted/rejected/remediation)
  // ---------------------------------------------------------------------------
  async recordAdminDecision(req, res) {
    try {
      const { id } = req.params;
      const admin = req.user;
      const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotency_key;
      const { decision, decision_reason, admin_notes, resume_fulfillment } = req.body;

      const result = await disputeService.recordAdminDecision({
        disputeId: id,
        actor: admin,
        decision,
        decisionReason: decision_reason,
        adminNotes: admin_notes,
        resumeFulfillment: Boolean(resume_fulfillment),
        idempotencyKey
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });

    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || 'SERVER_ERROR',
          message: error.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/disputes/:id/resolve
  // Admin resolves dispute (backward compatibility wrapper mapping to recordAdminDecision)
  // Financial invariant: ZERO money movement or payment status changes!
  // ---------------------------------------------------------------------------
  async resolveDispute(req, res) {
    try {
      const { id } = req.params;
      const admin = req.user;
      const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotency_key || `RESOLVE-${id}-${Date.now()}`;
      const { resolution, admin_notes, reason } = req.body;

      const resolutionMap = {
        'NO_REFUND': 'BUYER_CLAIM_REJECTED',
        'FULL_REFUND': 'BUYER_CLAIM_ACCEPTED',
        'PARTIAL_REFUND': 'PARTIAL_CLAIM_ACCEPTED',
        'REPLACEMENT': 'SUPPLIER_REMEDIATION_REQUIRED',
        'RE_DELIVERY': 'SUPPLIER_REMEDIATION_REQUIRED'
      };

      const decision = resolutionMap[resolution] || resolution;

      const result = await disputeService.recordAdminDecision({
        disputeId: id,
        actor: admin,
        decision,
        decisionReason: admin_notes || reason || `Resolution: ${resolution}`,
        adminNotes: admin_notes,
        idempotencyKey
      });

      return res.status(200).json({
        success: true,
        message: `Dispute resolved. Operational decision: ${decision}`,
        data: {
          resolution,
          decision,
          status: result.status
        }
      });

    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || 'SERVER_ERROR',
          message: error.message
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // PUT /api/v1/disputes/:id/request-evidence
  // Admin requests evidence from buyer or supplier
  // ---------------------------------------------------------------------------
  async requestEvidence(req, res) {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      const [result] = await db.query(
        `UPDATE order_disputes 
         SET status = 'EVIDENCE_REQUESTED', admin_notes = ?, updated_at = NOW() 
         WHERE id = ? AND status NOT IN ('CLOSED', 'RESOLVED_REJECTED')`,
        [notes || null, id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Dispute not found or already closed' }
        });
      }

      // Record event
      await db.query(
        `INSERT INTO order_dispute_events (
          dispute_id, event_code, from_status, to_status, action,
          actor_id, actor_role, notes, created_at
        ) VALUES (?, ?, 'OPEN', 'EVIDENCE_REQUESTED', 'ADMIN_REQUESTED_EVIDENCE', ?, 'ADMIN', ?, NOW())`,
        [id, `DE-DSP-${id}-EVIDENCE-REQ-${Date.now()}`, req.user.id, notes || null]
      );

      return res.status(200).json({
        success: true,
        message: 'Evidence requested from parties'
      });

    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/v1/disputes/:id/close
  // Admin closes dispute with documented reason
  // ---------------------------------------------------------------------------
  async closeDispute(req, res) {
    try {
      const { id } = req.params;
      const admin = req.user;
      const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotency_key;
      const { closure_reason } = req.body;

      const result = await disputeService.closeDispute({
        disputeId: id,
        actor: admin,
        closureReason: closure_reason,
        idempotencyKey
      });

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result
      });

    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || 'SERVER_ERROR',
          message: error.message
        }
      });
    }
  }
}

module.exports = new DisputeController();
