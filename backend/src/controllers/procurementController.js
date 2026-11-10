// =============================================================================
// src/controllers/procurementController.js
// MilJor Package E4: Procurement Modes Controller
// =============================================================================

const procurementService = require('../services/procurementService');
const procurementRequestService = require('../services/procurementRequestService');
const procurementMatchingService = require('../services/procurementMatchingService');
const procurementQuoteService = require('../services/procurementQuoteService');

class ProcurementController {

  // B6: buyer-owned shopping lists (no checkout, inventory allocation or quotes).
  async createSmartRequest(req, res) {
    try {
      const result = await procurementRequestService.createDraft(
        req.user.id, req.body, req.headers['x-idempotency-key']
      );
      res.status(result.is_replay ? 200 : 201).json({ success: true, data: result });
    } catch (err) { this._smartError(res, err); }
  }

  async listSmartRequests(req, res) {
    try {
      const requests = await procurementRequestService.listMine(req.user.id);
      res.json({ success: true, data: { requests } });
    } catch (err) { this._smartError(res, err); }
  }

  async getSmartRequest(req, res) {
    try {
      const request = await procurementRequestService.getMine(req.user.id,req.params.id);
      res.json({ success: true, data: { request } });
    } catch (err) { this._smartError(res, err); }
  }

  async updateSmartRequest(req, res) {
    try {
      this._smartKey(req);
      const request = await procurementRequestService.updateDraft(
        req.user.id, req.params.id, req.body, req.body?.version_number,
        req.headers['x-idempotency-key']
      );
      res.json({ success: true, data: { request } });
    } catch (err) { this._smartError(res, err); }
  }

  async publishSmartRequest(req, res) {
    try {
      this._smartKey(req);
      const result = await procurementRequestService.publish(
        req.user.id, req.params.id, req.body?.version_number,
        req.headers['x-idempotency-key']
      );
      res.json({ success: true, data: result });
    } catch (err) { this._smartError(res, err); }
  }

  _smartKey(req) {
    const value = req.headers['x-idempotency-key'];
    if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{12,120}$/.test(value.trim())) {
      const err = new Error('A valid X-Idempotency-Key is required.');
      err.code = 'INVALID_IDEMPOTENCY_KEY';
      err.statusCode = 400;
      throw err;
    }
  }

  _smartError(res, err) {
    res.status(err.statusCode || 500).json({
      success: false,
      error: {
        code: err.statusCode ? err.code : 'SERVER_ERROR',
        message: err.statusCode ? err.message : 'Procurement request could not be processed.'
      }
    });
  }

  // B6-D: supplier matching and invitations. No quote/checkout authority.
  async getSmartRequestMatches(req,res){
    try{
      const matches=await procurementMatchingService.findForBuyer(req.user.id,req.params.id);
      res.json({success:true,data:{matches}});
    }catch(err){this._smartError(res,err);}
  }
  async inviteSmartSupplier(req,res){
    try{
      const invitation=await procurementMatchingService.invite(
        req.user.id,req.params.id,req.body?.supplier_id
      );
      res.status(201).json({success:true,data:{invitation}});
    }catch(err){this._smartError(res,err);}
  }
  async listSmartInvitations(req,res){
    try{
      const invitations=await procurementMatchingService.listInvitationsForBuyer(req.user.id,req.params.id);
      res.json({success:true,data:{invitations}});
    }catch(err){this._smartError(res,err);}
  }
  async smartSupplierInbox(req,res){
    try{
      const invitations=await procurementMatchingService.inbox(req.user.id);
      res.json({success:true,data:{invitations}});
    }catch(err){this._smartError(res,err);}
  }
  async respondSmartInvitation(req,res){
    try{
      const invitation=await procurementMatchingService.respond(req.user.id,req.params.invitationId,req.body?.decision);
      res.json({success:true,data:{invitation}});
    }catch(err){this._smartError(res,err);}
  }

  // B6-E: versioned supplier quotations; read-only buyer comparisons.
  async submitSmartQuote(req,res){
    try{
      const quote=await procurementQuoteService.submit(
        req.user.id,req.params.id,req.body,req.headers['x-idempotency-key']
      );
      res.status(quote.is_replay?200:201).json({success:true,data:{quote}});
    }catch(err){this._smartError(res,err);}
  }
  async listSmartQuotes(req,res){
    try{
      const quotes=await procurementQuoteService.getForBuyer(req.user.id,req.params.id);
      res.json({success:true,data:{quotes}});
    }catch(err){this._smartError(res,err);}
  }
  async listMySmartQuotes(req,res){
    try{
      const quotes=await procurementQuoteService.getMine(req.user.id);
      res.json({success:true,data:{quotes}});
    }catch(err){this._smartError(res,err);}
  }

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
