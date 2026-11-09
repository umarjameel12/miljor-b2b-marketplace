// =============================================================================
// src/controllers/supplierDeliveryController.js
// MilJor Special Phase G2: Supplier Delivery Configuration & Pricing Controller
// =============================================================================
const supDelivService = require('../services/supplierDeliveryService');

class SupplierDeliveryController {
  /**
   * GET /api/v1/supplier/delivery-settings
   */
  async getSettings(req, res) {
    try {
      const settings = await supDelivService.getSupplierSettings(req.user.id);
      return res.status(200).json({
        success: true,
        data: settings
      });
    } catch (error) {
      console.error('[SupplierDeliveryController] getSettings error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to retrieve delivery settings.' }
      });
    }
  }

  /**
   * PUT /api/v1/supplier/delivery-settings
   */
  async updateSettings(req, res) {
    try {
      const updated = await supDelivService.updateSupplierSettings(req.user.id, req.body || {});
      return res.status(200).json({
        success: true,
        data: updated,
        message: 'Delivery settings and cluster rates updated successfully.'
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
   * POST /api/v1/supplier/pickup-points
   */
  async addPickupPoint(req, res) {
    try {
      const point = await supDelivService.addPickupPoint(req.user.id, req.body || {});
      return res.status(201).json({
        success: true,
        data: point,
        message: 'Pickup point created successfully.'
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
   * PATCH /api/v1/supplier/pickup-points/:id
   */
  async updatePickupPoint(req, res) {
    try {
      const pointId = Number(req.params.id);
      const updated = await supDelivService.updatePickupPoint(pointId, req.user.id, req.body || {});
      return res.status(200).json({
        success: true,
        data: updated,
        message: 'Pickup point updated successfully.'
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

module.exports = new SupplierDeliveryController();
