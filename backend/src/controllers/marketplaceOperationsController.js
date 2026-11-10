// =============================================================================
// src/controllers/marketplaceOperationsController.js
// MilJor Package E5 & E6: Invoices, Reviews, Messaging & Promotions Controller
// =============================================================================

const invoiceService = require('../services/invoiceService');
const reviewService = require('../services/reviewService');
const messagingService = require('../services/messagingService');
const promotionService = require('../services/promotionService');

class MarketplaceOperationsController {

  // Invoices
  async getInvoiceByOrderId(req, res) {
    try {
      const invoice = await invoiceService.getInvoiceByOrderId(req.params.orderId, req.user.id, req.user.role);
      res.status(200).json({ success: true, data: { invoice } });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'SERVER_ERROR', message: err.message } });
    }
  }

  // Reviews
  async submitReview(req, res) {
    try {
      const review = await reviewService.submitReview({
        orderId: req.body.order_id,
        reviewerId: req.user.id,
        reviewerRole: req.user.role,
        rating: req.body.rating,
        qualityRating: req.body.quality_rating,
        deliveryRating: req.body.delivery_rating,
        communicationRating: req.body.communication_rating,
        reviewText: req.body.review_text
      });
      res.status(201).json({ success: true, message: 'Review submitted successfully', data: { review } });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'SERVER_ERROR', message: err.message } });
    }
  }

  async getSupplierReviews(req, res) {
    try {
      const data = await reviewService.getSupplierReviews(req.params.supplierId);
      res.status(200).json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  }

  // Messaging
  async getOrCreateConversation(req, res) {
    try {
      const conv = await messagingService.getOrCreateConversation({
        buyerId: req.user.role === 'BUYER' ? req.user.id : req.body.buyer_id,
        supplierId: req.user.role === 'SUPPLIER' ? req.user.id : req.body.supplier_id,
        orderId: req.body.order_id,
        poolId: req.body.pool_id
      });
      res.status(200).json({ success: true, data: { conversation: conv } });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'SERVER_ERROR', message: err.message } });
    }
  }

  async sendMessage(req, res) {
    try {
      const result = await messagingService.sendMessage({
        conversationId: req.params.conversationId,
        senderId: req.user.id,
        text: req.body.text
      });
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'SERVER_ERROR', message: err.message } });
    }
  }

  async getMessages(req, res) {
    try {
      const data = await messagingService.getMessages(req.params.conversationId, req.user.id);
      res.status(200).json({ success: true, data });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'SERVER_ERROR', message: err.message } });
    }
  }

  // Promotions
  async createPromotion(req, res) {
    try {
      const campaign = await promotionService.createCampaign(req.user.id, req.body);
      res.status(201).json({ success: true, data: { campaign } });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, error: { code: err.code || 'SERVER_ERROR', message: err.message } });
    }
  }

  async getActivePromotions(req, res) {
    try {
      const campaigns = await promotionService.getActivePromotions();
      res.status(200).json({ success: true, count: campaigns.length, data: { campaigns } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
    }
  }
}

module.exports = new MarketplaceOperationsController();
