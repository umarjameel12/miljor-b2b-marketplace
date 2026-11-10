// =============================================================================
// src/controllers/procurementController.js
// MilJor Package E4: Procurement Modes Controller
// =============================================================================

const procurementService = require('../services/procurementService');

class ProcurementController {

  // Flash Pools
  async createFlashPool(req, res) {
    try {
      const pool = await procurementService.createFlashPool(req.user.id, req.body);
      res.status(201).json({ success: true, data: { flash_pool: pool } });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'SERVER_ERROR', message: err.message } });
    }
  }

  async getFlashPools(req, res) {
    try {
      const pools = await procurementService.getActiveFlashPools(req.query);
      res.status(200).json({ success: true, count: pools.length, data: { flash_pools: pools } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  }

  // Demand Requests ("Request a Pool")
  async createDemandRequest(req, res) {
    try {
      const request = await procurementService.createDemandRequest(req.user.id, req.body);
      res.status(201).json({ success: true, data: { demand_request: request } });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'SERVER_ERROR', message: err.message } });
    }
  }

  async getDemandRequests(req, res) {
    try {
      const requests = await procurementService.getDemandRequests(req.query);
      res.status(200).json({ success: true, count: requests.length, data: { demand_requests: requests } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  }

  // RFQs & Quotes
  async createRfq(req, res) {
    try {
      const rfq = await procurementService.createRfq(req.user.id, req.body);
      res.status(201).json({ success: true, data: { rfq } });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'SERVER_ERROR', message: err.message } });
    }
  }

  async submitRfqQuote(req, res) {
    try {
      const quote = await procurementService.submitRfqQuote(req.user.id, req.params.id, req.body);
      res.status(201).json({ success: true, data: { quote } });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'SERVER_ERROR', message: err.message } });
    }
  }

  async acceptRfqQuote(req, res) {
    try {
      const result = await procurementService.acceptRfqQuote(req.user.id, req.params.id, req.params.quoteId);
      res.status(200).json({ success: true, message: 'Quote accepted and order created', data: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'SERVER_ERROR', message: err.message } });
    }
  }

  // Recurring Contracts
  async createRecurringContract(req, res) {
    try {
      const contract = await procurementService.createRecurringContract(req.user.id, req.body);
      res.status(201).json({ success: true, data: { recurring_contract: contract } });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'SERVER_ERROR', message: err.message } });
    }
  }

  // Supplier Matching
  async matchSuppliers(req, res) {
    try {
      const matches = await procurementService.matchSuppliers(req.query);
      res.status(200).json({ success: true, count: matches.length, data: { matches } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new ProcurementController();
