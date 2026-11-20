'use strict';
// =============================================================================
// src/controllers/supplierDashboardController.js
// MilJor Master Supplier Operations Center — Controller
// =============================================================================
const dashboardService = require('../services/supplierDashboardService');

class SupplierDashboardController {
  /**
   * GET /api/v1/supplier/dashboard-kpis
   * Fetch authenticated supplier's operations center KPIs & priority actions
   */
  async getDashboardKpis(req, res) {
    try {
      const supplierId = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN'
        ? (Number(req.query.supplier_id) || req.user.id)
        : req.user.id;

      const period = ['7d', '30d', 'all'].includes(req.query.period)
        ? req.query.period
        : '30d';

      const data = await dashboardService.getDashboardOverview(supplierId, period);

      return res.status(200).json({
        success: true,
        data
      });
    } catch (error) {
      console.error('Get Supplier Dashboard KPIs Error:', error);
      const statusCode = error.statusCode || 500;
      return res.status(statusCode).json({
        success: false,
        error: {
          code: error.code || 'SERVER_ERROR',
          message: error.message || 'Could not fetch supplier dashboard KPIs'
        }
      });
    }
  }
}

module.exports = new SupplierDashboardController();
