// =============================================================================
// src/services/reviewService.js
// MilJor Package E6: Two-Way Rating and Review System
// Verifies completed order linkage, anti-self-dealing, and rating aggregation
// =============================================================================

const db = require('../config/db');

class ReviewService {

  async submitReview({ orderId, reviewerId, reviewerRole, rating, qualityRating, deliveryRating, communicationRating, reviewText }) {
    if (!orderId || !rating || rating < 1 || rating > 5) {
      const err = new Error('order_id and valid rating (1-5) are required');
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    // Check order existence and status
    const [orderRows] = await db.query(
      'SELECT id, buyer_id, supplier_id, order_status, fulfillment_status FROM orders WHERE id = ?',
      [orderId]
    );

    if (!orderRows[0]) {
      const err = new Error('Order not found');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const o = orderRows[0];

    // Must be COMPLETED or DELIVERED to review
    if (o.order_status !== 'COMPLETED' && o.order_status !== 'DELIVERED') {
      const err = new Error('Reviews can only be submitted for delivered or completed orders');
      err.code = 'ORDER_NOT_COMPLETED';
      err.statusCode = 422;
      throw err;
    }

    // Determine target and check participant authority
    let targetId;
    if (reviewerRole === 'BUYER') {
      if (o.buyer_id !== reviewerId) {
        const err = new Error('Only the buyer who placed this order can review it');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }
      targetId = o.supplier_id;
    } else if (reviewerRole === 'SUPPLIER') {
      if (o.supplier_id !== reviewerId) {
        const err = new Error('Only the fulfilling supplier can review the buyer for this order');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }
      targetId = o.buyer_id;
    } else {
      const err = new Error('Reviewer must be BUYER or SUPPLIER');
      err.code = 'INVALID_ROLE';
      err.statusCode = 403;
      throw err;
    }

    // Anti-self-dealing check
    if (reviewerId === targetId) {
      const err = new Error('Self-reviews are strictly prohibited');
      err.code = 'SELF_REVIEW_PROHIBITED';
      err.statusCode = 403;
      throw err;
    }

    // Check for duplicate review
    const [existing] = await db.query(
      'SELECT id FROM order_reviews WHERE order_id = ? AND reviewer_id = ?',
      [orderId, reviewerId]
    );
    if (existing.length > 0) {
      const err = new Error('You have already submitted a review for this order');
      err.code = 'DUPLICATE_REVIEW';
      err.statusCode = 409;
      throw err;
    }

    const [res] = await db.query(
      `INSERT INTO order_reviews (
        order_id, reviewer_id, reviewer_role, target_id, rating,
        quality_rating, delivery_rating, communication_rating, review_text,
        is_verified_purchase, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'PUBLISHED')`,
      [
        orderId, reviewerId, reviewerRole, targetId, rating,
        qualityRating || rating, deliveryRating || rating, communicationRating || rating,
        reviewText || null
      ]
    );

    const [created] = await db.query('SELECT * FROM order_reviews WHERE id = ?', [res.insertId]);
    return created[0];
  }

  async getSupplierReviews(supplierId) {
    const [reviews] = await db.query(
      `SELECT r.*, u.business_name as reviewer_name
       FROM order_reviews r
       JOIN users u ON r.reviewer_id = u.id
       WHERE r.target_id = ? AND r.status = 'PUBLISHED'
       ORDER BY r.created_at DESC`,
      [supplierId]
    );

    const [stats] = await db.query(
      `SELECT COUNT(*) as total_reviews,
              AVG(rating) as avg_rating,
              AVG(quality_rating) as avg_quality,
              AVG(delivery_rating) as avg_delivery
       FROM order_reviews
       WHERE target_id = ? AND status = 'PUBLISHED'`,
      [supplierId]
    );

    return {
      reviews,
      summary: {
        total_reviews: stats[0].total_reviews || 0,
        avg_rating: stats[0].avg_rating ? Number(Number(stats[0].avg_rating).toFixed(1)) : 5.0,
        avg_quality: stats[0].avg_quality ? Number(Number(stats[0].avg_quality).toFixed(1)) : 5.0,
        avg_delivery: stats[0].avg_delivery ? Number(Number(stats[0].avg_delivery).toFixed(1)) : 5.0
      }
    };
  }
}

module.exports = new ReviewService();
