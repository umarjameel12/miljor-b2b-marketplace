// =============================================================================
// src/services/promotionService.js
// MilJor Package E6: Sponsored Campaigns & Promotions Module
// =============================================================================

const db = require('../config/db');

class PromotionService {

  async createCampaign(supplierId, payload) {
    const { campaign_type, listing_id, pool_id, daily_budget_pkr, start_date, end_date } = payload;

    if (!campaign_type || !start_date || !end_date) {
      const err = new Error('campaign_type, start_date, and end_date are required');
      err.code = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    const code = `CMP-${Date.now().toString().slice(-6)}`;

    const [res] = await db.query(
      `INSERT INTO sponsored_campaigns (
        campaign_code, supplier_id, campaign_type, listing_id, pool_id,
        daily_budget_pkr, start_date, end_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        code, supplierId, campaign_type, listing_id || null, pool_id || null,
        daily_budget_pkr || 0, start_date, end_date
      ]
    );

    const [created] = await db.query('SELECT * FROM sponsored_campaigns WHERE id = ?', [res.insertId]);
    return created[0];
  }

  async getActivePromotions() {
    const [rows] = await db.query(
      `SELECT sc.*, u.business_name as supplier_name
       FROM sponsored_campaigns sc
       JOIN users u ON sc.supplier_id = u.id
       WHERE sc.status = 'ACTIVE' AND sc.start_date <= CURDATE() AND sc.end_date >= CURDATE()`
    );
    return rows;
  }
}

module.exports = new PromotionService();
