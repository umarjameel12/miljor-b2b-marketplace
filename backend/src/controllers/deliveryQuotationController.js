// =============================================================================
// src/controllers/deliveryQuotationController.js
// MilJor Special Phase G2: Delivery Options & Quotation Controller
// =============================================================================
const deliveryEligibilityService = require('../services/deliveryEligibilityService');

class DeliveryQuotationController {
  /**
   * GET /api/v1/pools/:id/delivery-options?cluster_id=...&supplier_id=...
   */
  async getPoolDeliveryOptions(req, res) {
    try {
      const poolId = Number(req.params.id);
      const clusterId = Number(req.query.cluster_id);
      const supplierId = req.query.supplier_id ? Number(req.query.supplier_id) : null;
      const addressId = req.query.address_id ? Number(req.query.address_id) : null;

      if (!poolId || !clusterId) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_PARAMETERS', message: 'Valid pool ID in path and ?cluster_id= query parameter are required.' }
        });
      }

      const options = await deliveryEligibilityService.getDeliveryOptions(req.user?.id, {
        pool_id: poolId,
        cluster_id: clusterId,
        supplier_id: supplierId,
        address_id: addressId
      });

      return res.status(200).json({
        success: true,
        data: options
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message }
      });
    }
  }

  /**
   * POST /api/v1/delivery/quote
   */
  async createQuote(req, res) {
    try {
      const quote = await deliveryEligibilityService.createAuthoritativeQuote(req.user.id, req.body || {});
      return res.status(201).json({
        success: true,
        data: quote,
        message: 'Authoritative delivery quote generated successfully.'
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message }
      });
    }
  }

  /**
   * POST /api/v1/delivery/quote/accept
   * Verified single-use quote acceptance (DEFECT-G2-04 Fix & Phase 7 Preparation)
   */
  async acceptQuote(req, res) {
    try {
      const { quote_code } = req.body || {};
      if (!quote_code) {
        return res.status(400).json({
          success: false,
          error: { code: 'QUOTE_CODE_REQUIRED', message: 'quote_code is required in payload.' }
        });
      }

      const accepted = await deliveryEligibilityService.verifyAndAcceptQuote(req.user.id, quote_code, req.body || {});
      return res.status(200).json({
        success: true,
        data: accepted,
        message: 'Delivery quote accepted successfully.'
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: { code: error.code || 'SERVER_ERROR', message: error.message }
      });
    }
  }
}

module.exports = new DeliveryQuotationController();
