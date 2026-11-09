// =============================================================================
// src/controllers/buyerAddressController.js
// MilJor Special Phase G2: Buyer Delivery Addresses Controller
// =============================================================================
const buyerAddrService = require('../services/buyerAddressService');

class BuyerAddressController {
  /**
   * GET /api/v1/buyer/addresses
   */
  async getAddresses(req, res) {
    try {
      const addresses = await buyerAddrService.getBuyerAddresses(req.user.id);
      return res.status(200).json({
        success: true,
        data: addresses
      });
    } catch (error) {
      console.error('[BuyerAddressController] getAddresses error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to retrieve addresses.' }
      });
    }
  }

  /**
   * POST /api/v1/buyer/addresses
   */
  async createAddress(req, res) {
    try {
      const result = await buyerAddrService.createBuyerAddress(req.user.id, req.body || {});
      return res.status(201).json({
        success: true,
        data: result.address,
        mismatch_warning: result.mismatch || null
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
   * PATCH /api/v1/buyer/addresses/:id
   */
  async updateAddress(req, res) {
    try {
      const addressId = Number(req.params.id);
      const updated = await buyerAddrService.updateBuyerAddress(req.user.id, addressId, req.body || {});
      return res.status(200).json({
        success: true,
        data: updated
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
   * DELETE /api/v1/buyer/addresses/:id
   */
  async deleteAddress(req, res) {
    try {
      const addressId = Number(req.params.id);
      await buyerAddrService.deleteBuyerAddress(req.user.id, addressId);
      return res.status(200).json({
        success: true,
        message: 'Delivery address deleted successfully.'
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

module.exports = new BuyerAddressController();
