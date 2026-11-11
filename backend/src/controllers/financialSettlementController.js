// =============================================================================
// src/controllers/financialSettlementController.js
// MilJor Part 4E.6: Financial Settlement, Refund, Supplier Payout & Reconciliation Controller
// =============================================================================

const financialSettlementService = require('../services/financialSettlementService');
const financialConservationService = require('../services/financialConservationService');

class FinancialSettlementController {

  // POST /api/v1/settlements/payables/accrue (Admin or Internal)
  async accruePayable(req, res) {
    try {
      const { order_id } = req.body;
      const idempotencyKey = req.headers['x-idempotency-key'];

      const result = await financialSettlementService.accrueSupplierPayable({
        orderId: parseInt(order_id, 10),
        actor: req.user,
        idempotencyKey
      });

      return res.status(201).json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INVALID_FINANCIAL_REQUEST', message: status >= 500 ? 'Financial operation could not be completed.' : err.message }
      });
    }
  }

  // GET /api/v1/settlements/payables/supplier (Supplier View)
  async getSupplierPayables(req, res) {
    try {
      const supplierId = req.user.id;
      const { status, page, limit } = req.query;

      const result = await financialSettlementService.getSupplierPayables({
        supplierId,
        status,
        page,
        limit
      });

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INVALID_FINANCIAL_REQUEST', message: status >= 500 ? 'Financial operation could not be completed.' : err.message }
      });
    }
  }

  // POST /api/v1/settlements/holds (Admin Place Hold)
  async placeHold(req, res) {
    try {
      const { order_id, dispute_id, amount, reason, notes } = req.body;

      const result = await financialSettlementService.placeFinancialHold({
        orderId: parseInt(order_id, 10),
        disputeId: dispute_id ? parseInt(dispute_id, 10) : null,
        amount,
        reason,
        notes,
        actor: req.user
      });

      return res.status(201).json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INVALID_FINANCIAL_REQUEST', message: status >= 500 ? 'Financial operation could not be completed.' : err.message }
      });
    }
  }

  // POST /api/v1/settlements/holds/:id/release (Admin Release Hold)
  async releaseHold(req, res) {
    try {
      const holdId = parseInt(req.params.id, 10);
      const { notes } = req.body;

      const result = await financialSettlementService.releaseFinancialHold({
        holdId,
        notes,
        actor: req.user
      });

      return res.status(200).json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INVALID_FINANCIAL_REQUEST', message: status >= 500 ? 'Financial operation could not be completed.' : err.message }
      });
    }
  }

  // POST /api/v1/settlements/refunds/assess (Buyer or Admin)
  async assessRefund(req, res) {
    try {
      const { order_id, dispute_id, disputed_quantity, refund_type, reason } = req.body;
      const idempotencyKey = req.headers['x-idempotency-key'];

      const result = await financialSettlementService.assessRefundObligation({
        orderId: parseInt(order_id, 10),
        disputeId: dispute_id ? parseInt(dispute_id, 10) : null,
        disputedQuantity: disputed_quantity,
        refundType: refund_type || 'PARTIAL',
        reason,
        actor: req.user,
        idempotencyKey
      });

      return res.status(201).json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INVALID_FINANCIAL_REQUEST', message: status >= 500 ? 'Financial operation could not be completed.' : err.message }
      });
    }
  }

  // POST /api/v1/settlements/refunds/:id/approve (Admin Approve)
  async approveRefund(req, res) {
    try {
      const refundId = parseInt(req.params.id, 10);
      const { notes } = req.body;

      const result = await financialSettlementService.approveRefundObligation({
        refundId,
        notes,
        actor: req.user
      });

      return res.status(200).json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INVALID_FINANCIAL_REQUEST', message: status >= 500 ? 'Financial operation could not be completed.' : err.message }
      });
    }
  }

  // POST /api/v1/settlements/refunds/:id/confirm-manual (Admin Confirm External Manual Refund)
  async confirmManualRefund(req, res) {
    try {
      const refundId = parseInt(req.params.id, 10);
      const { external_reference, notes } = req.body;

      const result = await financialSettlementService.recordManualConfirmedRefund({
        refundId,
        externalReference: external_reference,
        notes,
        actor: req.user
      });

      return res.status(200).json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INVALID_FINANCIAL_REQUEST', message: status >= 500 ? 'Financial operation could not be completed.' : err.message }
      });
    }
  }

  // GET /api/v1/settlements/refunds/my (Buyer View)
  async getBuyerRefunds(req, res) {
    try {
      const buyerId = req.user.id;
      const { order_id, page, limit } = req.query;

      const result = await financialSettlementService.getBuyerRefunds({
        buyerId,
        orderId: order_id ? parseInt(order_id, 10) : null,
        page,
        limit
      });

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INVALID_FINANCIAL_REQUEST', message: status >= 500 ? 'Financial operation could not be completed.' : err.message }
      });
    }
  }

  // POST /api/v1/settlements/disbursements/prepare (Admin Prepare)
  async prepareDisbursement(req, res) {
    try {
      const { payable_id, beneficiary_title, beneficiary_iban, beneficiary_bank_code } = req.body;
      const idempotencyKey = req.headers['x-idempotency-key'];

      const result = await financialSettlementService.prepareSupplierDisbursement({
        payableId: parseInt(payable_id, 10),
        beneficiaryTitle: beneficiary_title,
        beneficiaryIban: beneficiary_iban,
        beneficiaryBankCode: beneficiary_bank_code,
        actor: req.user,
        idempotencyKey
      });

      return res.status(201).json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INVALID_FINANCIAL_REQUEST', message: status >= 500 ? 'Financial operation could not be completed.' : err.message }
      });
    }
  }

  // POST /api/v1/settlements/disbursements/:id/approve (Admin Approve)
  async approveDisbursement(req, res) {
    try {
      const disbursementId = parseInt(req.params.id, 10);
      const { notes } = req.body;

      const result = await financialSettlementService.approveSupplierDisbursement({
        disbursementId,
        notes,
        actor: req.user
      });

      return res.status(200).json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INVALID_FINANCIAL_REQUEST', message: status >= 500 ? 'Financial operation could not be completed.' : err.message }
      });
    }
  }

  // POST /api/v1/settlements/batches/reconcile (Admin Batch Reconcile)
  async reconcileBatch(req, res) {
    try {
      const {
        batch_reference,
        gross_amount,
        provider_fee,
        net_amount,
        settlement_date,
        matched_tracker_tokens,
        raw_metadata
      } = req.body;

      const result = await financialSettlementService.reconcileProviderSettlementBatch({
        batchReference: batch_reference,
        grossAmount: gross_amount,
        providerFee: provider_fee,
        netAmount: net_amount,
        settlementDate: settlement_date,
        matchedTrackerTokens: matched_tracker_tokens || [],
        rawMetadata: raw_metadata,
        actor: req.user
      });

      return res.status(200).json(result);
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INVALID_FINANCIAL_REQUEST', message: status >= 500 ? 'Financial operation could not be completed.' : err.message }
      });
    }
  }

  // GET /api/v1/settlements/admin/overview (Admin Overview)
  async getAdminOverview(req, res) {
    try {
      const { order_id, page, limit } = req.query;

      const result = await financialSettlementService.getAdminFinancialOverview({
        orderId: order_id ? parseInt(order_id, 10) : null,
        page,
        limit
      });

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INVALID_FINANCIAL_REQUEST', message: status >= 500 ? 'Financial operation could not be completed.' : err.message }
      });
    }
  }

  // GET /api/v1/settlements/admin/orders/:id/integrity
  // Read-only exact financial conservation report; not bank custody proof.
  async getOrderIntegrity(req,res) {
    try {
      const result=await financialConservationService.getOrderIntegrity({
        orderId:req.params.id,actor:req.user
      });
      return res.status(200).json({success:true,data:result});
    } catch(err) {
      const status=err.statusCode||500;
      return res.status(status).json({success:false,error:{
        code:status>=500?'INTERNAL_ERROR':err.code||'INVALID_FINANCIAL_REQUEST',
        message:status>=500?'Financial audit could not be completed.':err.message
      }});
    }
  }

  // GET /api/v1/settlements/audit-trail (Admin Audit Trail)
  async getAuditTrail(req, res) {
    try {
      const { entity_type, entity_id, order_id, page, limit } = req.query;

      const result = await financialSettlementService.getFinancialAuditTrail({
        entityType: entity_type,
        entityId: entity_id ? parseInt(entity_id, 10) : null,
        orderId: order_id ? parseInt(order_id, 10) : null,
        page,
        limit
      });

      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      const status = err.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: { code: status >= 500 ? 'INTERNAL_ERROR' : err.code || 'INVALID_FINANCIAL_REQUEST', message: status >= 500 ? 'Financial operation could not be completed.' : err.message }
      });
    }
  }
}

module.exports = new FinancialSettlementController();
