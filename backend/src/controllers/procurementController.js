// =============================================================================
// src/controllers/procurementController.js
// MilJor Package E4: Procurement Modes Controller
// =============================================================================

const procurementService = require('../services/procurementService');
const procurementRequestService = require('../services/procurementRequestService');
const procurementMatchingService = require('../services/procurementMatchingService');
const procurementQuoteService = require('../services/procurementQuoteService');
const procurementQuoteComparisonService = require('../services/procurementQuoteComparisonService');
const procurementNegotiationService = require('../services/procurementNegotiationService');
const procurementAwardPolicy = require('../services/procurementAwardPolicy');
const procurementCollectiveService = require('../services/procurementCollectiveService');
const procurementRecurringService = require('../services/procurementRecurringService');
const procurementAwardService = require('../services/procurementAwardService');
const procurementCollectiveBidService = require('../services/procurementCollectiveBidService');
const procurementCollectiveApprovalService = require('../services/procurementCollectiveApprovalService');

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
      const decision = req.body?.decision || req.body?.response;
      const invitation=await procurementMatchingService.respond(req.user.id,req.params.invitationId,decision);
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

  async withdrawSmartQuote(req,res){
    try{
      const quote=await procurementQuoteService.withdraw(
        req.user.id,req.params.quoteId,req.headers['x-idempotency-key']
      );
      res.json({success:true,data:{quote}});
    }catch(err){this._smartError(res,err);}
  }
  async smartQuoteHistory(req,res){
    try{
      const history=await procurementQuoteService.getVersionsForBuyer(
        req.user.id,req.params.id,req.params.quoteId
      );
      res.json({success:true,data:history});
    }catch(err){this._smartError(res,err);}
  }

  // B6-F: supplier-quoted comparison only. No order or checkout.
  async compareSmartQuotes(req,res){
    try{
      const result=await procurementQuoteComparisonService.compareForBuyer(req.user.id,req.params.id);
      res.json({success:true,data:result});
    }catch(err){this._smartError(res,err);}
  }
  async requestSmartBetterOffer(req,res){
    try{
      const result=await procurementNegotiationService.requestBetterOffer(
        req.user.id,req.params.id,req.params.quoteId,req.body,
        req.headers['x-idempotency-key']
      );
      res.status(result.is_replay?200:201).json({success:true,data:result});
    }catch(err){this._smartError(res,err);}
  }
  async listBuyerSmartNegotiations(req,res){
    try{
      const negotiations=await procurementNegotiationService.forBuyer(req.user.id,req.params.id);
      res.json({success:true,data:{negotiations}});
    }catch(err){this._smartError(res,err);}
  }
  async listSupplierSmartNegotiations(req,res){
    try{
      const negotiations=await procurementNegotiationService.forSupplier(req.user.id);
      res.json({success:true,data:{negotiations}});
    }catch(err){this._smartError(res,err);}
  }

  // B6-G/H preview only. NO award/order/payment/stock mutation.
  async previewSmartAward(req,res){
    try{
      const preview=await procurementAwardPolicy.previewForBuyer(
        req.user.id,req.params.id,req.body?.selections
      );
      res.json({success:true,data:{preview}});
    }catch(err){this._smartError(res,err);}
  }

  // B6-I: private collective participation; joining does not charge anyone.
  async createCollectiveGroup(req,res){
    try{
      const result=await procurementCollectiveService.createGroup(
        req.user.id,req.params.id,req.body||{}
      );
      res.status(result.is_replay?200:201).json({success:true,data:result});
    }catch(err){this._smartError(res,err);}
  }
  async inviteCollectiveBuyer(req,res){
    try{
      const invitation=await procurementCollectiveService.invite(
        req.user.id,req.params.groupId,req.body?.buyer_id
      );
      res.json({success:true,data:{invitation}});
    }catch(err){this._smartError(res,err);}
  }
  async joinCollectiveGroup(req,res){
    try{
      const result=await procurementCollectiveService.join(
        req.user.id,req.params.groupId,req.body?.lines,
        req.headers['x-idempotency-key']
      );
      res.status(result.is_replay?200:201).json({success:true,data:result});
    }catch(err){this._smartError(res,err);}
  }
  async myCollectiveInvites(req,res){
    try{
      const invitations=await procurementCollectiveService.listMyInvites(req.user.id);
      res.json({success:true,data:{invitations}});
    }catch(err){this._smartError(res,err);}
  }

  // B6-L/M: recurring is opt-in; cycles never create paid orders here.
  async createSmartRecurring(req,res){
    try{
      const result=await procurementRecurringService.createDraft(
        req.user.id,req.params.id,req.body,
        req.headers['x-idempotency-key']
      );
      res.status(result.is_replay?200:201).json({success:true,data:result});
    }catch(err){this._smartError(res,err);}
  }
  async listSmartRecurring(req,res){
    try{
      const contracts=await procurementRecurringService.listMine(req.user.id);
      res.json({success:true,data:{contracts}});
    }catch(err){this._smartError(res,err);}
  }
  async smartRecurringAction(req,res){
    try{
      const result=await procurementRecurringService.changeStatus(
        req.user.id,req.params.contractId,
        String(req.params.action||'').toUpperCase(),
        req.body?.version_number,req.body?.explicit_consent===true
      );
      res.json({success:true,data:{contract:result}});
    }catch(err){this._smartError(res,err);}
  }
  async smartRecurringUpcoming(req,res){
    try{
      const result=await procurementRecurringService.previewUpcoming(
        req.user.id,req.params.contractId
      );
      res.json({success:true,data:result});
    }catch(err){this._smartError(res,err);}
  }
  async smartRecurringSkip(req,res){
    try{
      const result=await procurementRecurringService.skipCycle(
        req.user.id,req.params.contractId,req.params.cycleId
      );
      res.json({success:true,data:{cycle:result}});
    }catch(err){this._smartError(res,err);}
  }

  // B6-G/H award transaction. Financial writes stay behind server-only gate.
  async previewSmartPayable(req,res){
    try{
      const payable=await procurementAwardService.previewPayable(
        req.user.id,req.params.id,req.body?.selections
      );
      res.json({success:true,data:{preview:payable}});
    }catch(err){this._smartError(res,err);}
  }
  async acceptSmartAward(req,res){
    try{
      const result=await procurementAwardService.accept(
        req.user.id,req.params.id,req.body,req.headers['x-idempotency-key']
      );
      res.status(result.is_replay?200:201).json({success:true,data:result});
    }catch(err){this._smartError(res,err);}
  }
  async getSmartAward(req,res){
    try{
      const award=await procurementAwardService.getMine(req.user.id,req.params.awardId);
      res.json({success:true,data:{award}});
    }catch(err){this._smartError(res,err);}
  }

  // B6-J: supplier-owned collective group bidding.
  async openCollectiveBidding(req,res){
    try{
      const result=await procurementCollectiveBidService.openBidding(
        req.user.id,req.params.groupId);
      res.json({success:true,data:result});
    }catch(e){this._smartError(res,e);}
  }
  async inviteCollectiveSupplier(req,res){
    try{
      const invitation=await procurementCollectiveBidService.inviteSupplier(
        req.user.id,req.params.groupId,req.body?.supplier_id);
      res.status(201).json({success:true,data:{invitation}});
    }catch(e){this._smartError(res,e);}
  }
  async collectiveSupplierInbox(req,res){
    try{
      const invitations=await procurementCollectiveBidService.supplierInbox(req.user.id);
      res.json({success:true,data:{invitations}});
    }catch(e){this._smartError(res,e);}
  }
  async submitCollectiveBid(req,res){
    try{
      const result=await procurementCollectiveBidService.submitBid(
        req.user.id,req.params.groupId,req.body,req.headers['x-idempotency-key']);
      res.status(result.is_replay?200:201).json({success:true,data:result});
    }catch(e){this._smartError(res,e);}
  }
  async listCollectiveBids(req,res){
    try{
      const bids=await procurementCollectiveBidService.listForBuyer(
        req.user.id,req.params.groupId);
      res.json({success:true,data:{bids}});
    }catch(e){this._smartError(res,e);}
  }
  // B6-K: buyer-only quote/version acknowledgement. No financial mutation.
  async qualifyCollectiveGroup(req,res){
    try{
      const result=await procurementCollectiveApprovalService.qualifyGroup(
        req.user.id,req.params.groupId,req.body?.bid_version_id);
      res.json({success:true,data:result});
    }catch(e){this._smartError(res,e);}
  }
  async previewCollectiveApproval(req,res){
    try{
      const preview=await procurementCollectiveApprovalService.preview(
        req.user.id,req.params.groupId,req.params.bidId);
      res.json({success:true,data:{preview}});
    }catch(e){this._smartError(res,e);}
  }
  async consentCollectiveApproval(req,res){
    try{
      const result=await procurementCollectiveApprovalService.consent(
        req.user.id,req.params.groupId,req.params.bidId,req.body,
        req.headers['x-idempotency-key']);
      res.status(result.is_replay?200:201).json({success:true,data:result});
    }catch(e){this._smartError(res,e);}
  }

  // B6-M cycle buyer approval: prepares a fresh, unpaid shopping-list draft.
  async scheduleRecurringCycles(req,res){
    try{
      const result=await procurementRecurringService.scheduleUpcomingForBuyer(
        req.user.id,req.params.contractId,{limit:req.body?.limit??6});
      res.json({success:true,data:result});
    }catch(e){this._smartError(res,e);}
  }
  async prepareRecurringCycle(req,res){
    try{
      const result=await procurementRecurringService.prepareDueCycle(
        req.user.id,req.params.contractId,req.params.cycleId);
      res.json({success:true,data:result});
    }catch(e){this._smartError(res,e);}
  }
  async listRecurringCycles(req,res){
    try{
      const cycles=await procurementRecurringService.listCycles(
        req.user.id,req.params.contractId);
      res.json({success:true,data:{cycles}});
    }catch(e){this._smartError(res,e);}
  }

  // B5: Dedicated Flash Pool lifecycle. Fail closed on unsafe direct ACTIVE creation.
  async createFlashPool(req,res) {
    try {
      const flash = await require('../services/flashPoolService').createDraft(req.user.id,req.body||{});
      res.status(201).json({success:true,data:{flash_pool:flash}});
    }catch(e){res.status(e.statusCode||500).json({success:false,error:{code:e.code||'FLASH_CREATE_FAILED',message:e.statusCode?e.message:'Unable to create Flash Pool'}});}
  }
  async publishFlashPool(req,res) {
    try {
      const flash=await require('../services/flashPoolService').publish(req.user.id,Number(req.params.id));
      res.status(200).json({success:true,data:{flash_pool:flash}});
    }catch(e){res.status(e.statusCode||500).json({success:false,error:{code:e.code||'FLASH_PUBLISH_FAILED',message:e.statusCode?e.message:'Unable to publish Flash Pool'}});}
  }
  async getFlashPools(req,res) {
    try {
      const pools=await require('../services/flashPoolService').getActive(req.query);
      res.status(200).json({success:true,count:pools.length,data:{flash_pools:pools,server_time:new Date().toISOString()}});
    }catch(e){res.status(500).json({success:false,error:{code:'FLASH_DISCOVERY_FAILED',message:'Unable to retrieve Flash Pools'}});}
  }
  async getMyFlashPools(req,res) {
    try {
      const [rows]=await require('../config/db').query(
        `SELECT *,DATE_FORMAT(expiry_time,'%Y-%m-%dT%H:%i:%sZ') AS expiry_at_utc
         FROM flash_pools WHERE supplier_id=? ORDER BY created_at DESC LIMIT 200`,[req.user.id]);
      res.status(200).json({success:true,data:{flash_pools:rows,server_time:new Date().toISOString()}});
    }catch(e){res.status(500).json({success:false,error:{code:'FLASH_LIST_FAILED',message:'Unable to list supplier Flash Pools'}});}
  }
  async previewFlashDelivery(req,res) {
    try {
      const data=await require('../services/flashPoolService').previewDelivery(
        req.user.id,Number(req.params.id),{
          mode:req.query.mode||'STANDARD_CLUSTERED',
          address_id:req.query.address_id,
          cluster_id:req.query.cluster_id,
          pickup_point_id:req.query.pickup_point_id
        });
      res.status(200).json({success:true,data});
    }catch(e){res.status(e.statusCode||500).json({success:false,
      error:{code:e.code||'FLASH_DELIVERY_PREVIEW_FAILED',
        message:e.statusCode?e.message:'Unable to preview Flash delivery'}});}
  }
  async reserveFlashPool(req,res) {
    try {
      const result=await require('../services/flashPoolService').requestHold(
        req.user.id,Number(req.params.id),req.body||{},req.headers['x-idempotency-key']);
      res.status(201).json({success:true,data:{hold:result}});
    }catch(e){res.status(e.statusCode||500).json({success:false,error:{code:e.code||'FLASH_HOLD_FAILED',message:e.statusCode?e.message:'Unable to reserve Flash Pool'}});}
  }

  async updateFlashDraft(req,res) {
    try {
      const flash=await require('../services/flashPoolService').updateDraft(req.user.id,Number(req.params.id),req.body||{});
      res.status(200).json({success:true,data:{flash_pool:flash}});
    }catch(e){res.status(e.statusCode||500).json({success:false,error:{code:e.code||'FLASH_UPDATE_FAILED',message:e.statusCode?e.message:'Unable to edit Flash draft'}});}
  }
  async cancelFlashPool(req,res) {
    try {
      const flash=await require('../services/flashPoolService').cancelOffer(req.user.id,Number(req.params.id));
      res.status(200).json({success:true,data:{flash_pool:flash}});
    }catch(e){res.status(e.statusCode||500).json({success:false,error:{code:e.code||'FLASH_CANCEL_FAILED',message:e.statusCode?e.message:'Unable to cancel Flash offer'}});}
  }
  async getMyFlashHolds(req,res) {
    try {
      const holds=await require('../services/flashPoolService').listHoldsForBuyer(req.user.id);
      res.json({success:true,data:{holds}});
    }catch(e){res.status(e.statusCode||500).json({success:false,error:{
      code:e.code||'FLASH_HOLD_LIST_FAILED',
      message:e.statusCode?e.message:'Unable to list your Flash orders'
    }});}
  }
  async getFlashHold(req,res) {
    try {
      const hold=await require('../services/flashPoolService').getHoldForBuyer(req.user.id,Number(req.params.holdId));
      res.status(200).json({success:true,data:{hold}});
    }catch(e){res.status(e.statusCode||500).json({success:false,error:{code:e.code||'FLASH_HOLD_STATUS_FAILED',message:e.statusCode?e.message:'Unable to retrieve hold status'}});}
  }
  async expireFlashPool(req,res) {
    try {
      const flash=await require('../services/flashPoolService').closeExpiredOffer(req.user.id,Number(req.params.id));
      res.status(200).json({success:true,data:{flash_pool:flash}});
    }catch(e){res.status(e.statusCode||500).json({success:false,error:{code:e.code||'FLASH_EXPIRY_FAILED',message:e.statusCode?e.message:'Unable to expire Flash Pool'}});}
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
