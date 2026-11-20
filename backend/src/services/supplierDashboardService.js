'use strict';
// =============================================================================
// src/services/supplierDashboardService.js
// MilJor Master Supplier Operations Center — KPI Aggregation & Priority Actions
// Queries strictly authenticated real database records. Zero mock data.
// =============================================================================
const defaultDb = require('../config/db');

class SupplierDashboardService {
  constructor(db = defaultDb) {
    this.db = db;
  }

  /**
   * Retrieves live KPIs and priority action items for an authenticated supplier.
   * @param {number} supplierId
   * @param {string} period '7d' | '30d' | 'all'
   */
  async getDashboardOverview(supplierId, period = '30d') {
    const id = Number(supplierId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      const err = new Error('Valid supplier ID is required');
      err.code = 'INVALID_SUPPLIER';
      err.statusCode = 400;
      throw err;
    }

    // Build period date threshold
    let dateCondition = '';
    const queryParams = [id];
    if (period === '7d') {
      dateCondition = ' AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)';
    } else if (period === '30d') {
      dateCondition = ' AND created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)';
    }

    // Execute aggregated queries concurrently
    const [
      salesRes,
      ackRes,
      poolsRes,
      rfqRes,
      recurringRes,
      deliveryRes,
      disputeRes,
      ledgerRes,
      clockRes
    ] = await Promise.all([
      // 1. Total sales & confirmed paid orders
      this.db.query(
        `SELECT COALESCE(SUM(total_amount), 0) AS total_sales,
                COUNT(*) AS confirmed_paid_orders
         FROM orders
         WHERE supplier_id = ? AND payment_status = 'PAID'${dateCondition}`,
        [id]
      ),
      // 2. Orders awaiting supplier acknowledgment
      this.db.query(
        `SELECT COUNT(*) AS awaiting_ack
         FROM orders
         WHERE supplier_id = ? AND payment_status = 'PAID'
           AND (fulfillment_status = 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT' OR acknowledged_at IS NULL)`,
        [id]
      ),
      // 3. Active Unified Pools (Regular & Flash)
      this.db.query(
        `SELECT
           (SELECT COUNT(*) FROM pools WHERE supplier_id = ? AND status = 'ACTIVE') AS active_regular,
           (SELECT COUNT(*) FROM flash_pools WHERE supplier_id = ? AND status = 'ACTIVE') AS active_flash`,
        [id, id]
      ),
      // 4. Incoming RFQs and pending quotations
      this.db.query(
        `SELECT
           (SELECT COUNT(*) FROM procurement_supplier_invitations WHERE supplier_id = ? AND status = 'INVITED') AS incoming_rfqs,
           (SELECT COUNT(*) FROM procurement_quotes WHERE supplier_id = ? AND status = 'DRAFT') AS pending_quotes`,
        [id, id]
      ),
      // 5. Upcoming recurring commitments
      this.db.query(
        `SELECT
           (SELECT COUNT(*) FROM procurement_collective_bids WHERE supplier_id = ? AND status = 'ACTIVE') AS active_bids,
           (SELECT COUNT(*) FROM procurement_recurring_contracts WHERE status = 'ACTIVE' AND template_request_id IN (
             SELECT request_id FROM procurement_quotes WHERE supplier_id = ? AND status = 'ACTIVE'
           )) AS recurring_contracts`,
        [id, id]
      ),
      // 6. Today's scheduled deliveries
      this.db.query(
        `SELECT COUNT(*) AS today_deliveries
         FROM procurement_delivery_runs
         WHERE supplier_id = ? AND delivery_day = CURRENT_DATE() AND status NOT IN ('DELIVERED', 'CANCELLED')`,
        [id]
      ),
      // 7. Pending disputes
      this.db.query(
        `SELECT COUNT(*) AS pending_disputes
         FROM order_disputes
         WHERE supplier_id = ? AND status IN ('OPEN', 'AWAITING_SUPPLIER_RESPONSE', 'UNDER_ADMIN_REVIEW', 'EVIDENCE_REQUESTED')`,
        [id]
      ),
      // 8. Financial earnings: Held, Settlement-Eligible, Completed Payouts
      this.db.query(
        `SELECT
           COALESCE(SUM(CASE WHEN l.payout_status = 'HELD_IN_ESCROW' THEN l.supplier_net_amount ELSE 0 END), 0) AS held_earnings,
           COALESCE(SUM(CASE WHEN l.payout_status = 'READY_FOR_PAYOUT' THEN l.supplier_net_amount ELSE 0 END), 0) AS settlement_eligible,
           COALESCE(SUM(CASE WHEN l.payout_status = 'PAID_TO_SUPPLIER' THEN l.supplier_net_amount ELSE 0 END), 0) AS completed_payouts
         FROM platform_ledger l
         JOIN payments p ON p.id = l.payment_id
         JOIN orders o ON o.id = p.order_id
         WHERE o.supplier_id = ?`,
        [id]
      ),
      // UTC Server Clock
      this.db.query("SELECT DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%sZ') AS server_time")
    ]);

    const salesRow = salesRes[0]?.[0] || {};
    const ackRow = ackRes[0]?.[0] || {};
    const poolsRow = poolsRes[0]?.[0] || {};
    const rfqRow = rfqRes[0]?.[0] || {};
    const recurringRow = recurringRes[0]?.[0] || {};
    const deliveryRow = deliveryRes[0]?.[0] || {};
    const disputeRow = disputeRes[0]?.[0] || {};
    const ledgerRow = ledgerRes[0]?.[0] || {};
    const serverTime = clockRes[0]?.[0]?.server_time || new Date().toISOString();

    const activeRegular = Number(poolsRow.active_regular || 0);
    const activeFlash = Number(poolsRow.active_flash || 0);
    const activeUnifiedPools = activeRegular + activeFlash;

    const kpis = {
      total_sales: Number(salesRow.total_sales || 0).toFixed(2),
      confirmed_paid_orders: Number(salesRow.confirmed_paid_orders || 0),
      orders_awaiting_acknowledgment: Number(ackRow.awaiting_ack || 0),
      active_unified_pools: activeUnifiedPools,
      active_regular_pools: activeRegular,
      active_flash_pools: activeFlash,
      incoming_rfqs: Number(rfqRow.incoming_rfqs || 0),
      pending_quotations: Number(rfqRow.pending_quotes || 0),
      upcoming_recurring_commitments: Number(recurringRow.active_bids || 0) + Number(recurringRow.recurring_contracts || 0),
      today_scheduled_deliveries: Number(deliveryRow.today_deliveries || 0),
      pending_disputes: Number(disputeRow.pending_disputes || 0),
      held_earnings: Number(ledgerRow.held_earnings || 0).toFixed(2),
      settlement_eligible: Number(ledgerRow.settlement_eligible || 0).toFixed(2),
      completed_payouts: Number(ledgerRow.completed_payouts || 0).toFixed(2),
      currency: 'PKR',
      period
    };

    // Priority Action Center Items
    const priorityActions = await this._getPriorityActions(id);

    return {
      kpis,
      priority_actions: priorityActions,
      server_time: serverTime
    };
  }

  /**
   * Evaluates actionable tasks requiring supplier attention.
   * @private
   */
  async _getPriorityActions(supplierId) {
    const actions = [];

    // 1. Paid orders awaiting acknowledgment
    const [unackOrders] = await this.db.query(
      `SELECT id, order_code, total_amount, total_qty, created_at
       FROM orders
       WHERE supplier_id = ? AND payment_status = 'PAID'
         AND (fulfillment_status = 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT' OR acknowledged_at IS NULL)
       ORDER BY id DESC LIMIT 3`,
      [supplierId]
    );

    for (const ord of unackOrders) {
      actions.push({
        id: `order-ack-${ord.id}`,
        type: 'ORDER_ACKNOWLEDGMENT',
        severity: 'URGENT',
        title: `Order ${ord.order_code} Awaiting Acknowledgment`,
        description: `Paid order for ${ord.total_qty} units (PKR ${ord.total_amount}) requires confirmation.`,
        link: '/orders',
        action_label: 'Acknowledge Order'
      });
    }

    // 2. Pools approaching expiry (< 24 hours)
    const [expiringPools] = await this.db.query(
      `SELECT id, pool_code, 'REGULAR' AS pool_type, scheduled_close_at AS expires_at
       FROM pools
       WHERE supplier_id = ? AND status = 'ACTIVE' AND scheduled_close_at IS NOT NULL
         AND scheduled_close_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
       UNION ALL
       SELECT id, flash_code AS pool_code, 'FLASH' AS pool_type, expiry_time AS expires_at
       FROM flash_pools
       WHERE supplier_id = ? AND status = 'ACTIVE'
         AND expiry_time <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
       LIMIT 3`,
      [supplierId, supplierId]
    );

    for (const pool of expiringPools) {
      actions.push({
        id: `pool-exp-${pool.id}`,
        type: 'POOL_EXPIRING',
        severity: 'WARNING',
        title: `${pool.pool_type} Pool ${pool.pool_code} Expiring Soon`,
        description: `Scheduled to close within 24 hours. Review volume target or fulfillment preparation.`,
        link: '/supplier/pools',
        action_label: 'View Pool'
      });
    }

    // 3. Incoming RFQ Invitations awaiting response
    const [rfqInvites] = await this.db.query(
      `SELECT psi.id, psi.request_id, pr.request_code, pr.quote_deadline
       FROM procurement_supplier_invitations psi
       JOIN procurement_requests pr ON pr.id = psi.request_id
       WHERE psi.supplier_id = ? AND psi.status = 'INVITED' AND pr.status = 'OPEN'
       ORDER BY pr.quote_deadline ASC LIMIT 3`,
      [supplierId]
    );

    for (const rfq of rfqInvites) {
      actions.push({
        id: `rfq-inv-${rfq.id}`,
        type: 'RFQ_INVITATION',
        severity: 'ACTION_REQUIRED',
        title: `RFQ Invitation ${rfq.request_code}`,
        description: `Buyer submitted a procurement request. Submit your quotation before deadline.`,
        link: '/rfqs',
        action_label: 'Submit Quotation'
      });
    }

    // 4. Orders ready for dispatch
    const [dispatchOrders] = await this.db.query(
      `SELECT id, order_code, total_qty, delivery_type
       FROM orders
       WHERE supplier_id = ? AND fulfillment_status = 'READY_FOR_DISPATCH'
       ORDER BY id ASC LIMIT 3`,
      [supplierId]
    );

    for (const disp of dispatchOrders) {
      actions.push({
        id: `order-disp-${disp.id}`,
        type: 'DELIVERY_DISPATCH',
        severity: 'URGENT',
        title: `Order ${disp.order_code} Ready for Dispatch`,
        description: `Package packed and staged. Dispatch via ${disp.delivery_type}.`,
        link: '/orders',
        action_label: 'Mark Dispatched'
      });
    }

    // 5. Active disputes awaiting supplier response
    const [disputes] = await this.db.query(
      `SELECT id, dispute_code, dispute_category, claimed_amount
       FROM order_disputes
       WHERE supplier_id = ? AND status IN ('OPEN', 'AWAITING_SUPPLIER_RESPONSE')
       ORDER BY id DESC LIMIT 3`,
      [supplierId]
    );

    for (const disp of disputes) {
      actions.push({
        id: `dispute-${disp.id}`,
        type: 'DISPUTE_RESPONSE',
        severity: 'CRITICAL',
        title: `Dispute ${disp.dispute_code} Requires Response`,
        description: `${disp.dispute_category}: Buyer reported an issue (PKR ${disp.claimed_amount}).`,
        link: '/supplier/disputes',
        action_label: 'Respond to Dispute'
      });
    }

    // 6. Low stock alerts
    const [lowStock] = await this.db.query(
      `SELECT id, listing_code, available_stock, pricing_unit
       FROM supplier_listings
       WHERE supplier_id = ? AND status = 'ACTIVE' AND available_stock <= 20
       ORDER BY available_stock ASC LIMIT 3`,
      [supplierId]
    );

    for (const item of lowStock) {
      actions.push({
        id: `stock-${item.id}`,
        type: 'LOW_STOCK',
        severity: 'WARNING',
        title: `Low Stock: ${item.listing_code}`,
        description: `Remaining stock is ${item.available_stock} ${item.pricing_unit}. Update inventory.`,
        link: '/supplier/catalog',
        action_label: 'Update Stock'
      });
    }

    // 7. Profile verification status
    const [prof] = await this.db.query(
      `SELECT verification_status FROM supplier_profiles WHERE supplier_id = ?`,
      [supplierId]
    );

    if (prof.length > 0 && prof[0].verification_status !== 'VERIFIED') {
      actions.push({
        id: 'verification-pending',
        type: 'VERIFICATION_REQUIRED',
        severity: 'INFO',
        title: 'Supplier Verification Incomplete',
        description: `Status: ${prof[0].verification_status}. Complete documents to unlock verified tier badges.`,
        link: '/supplier/profile',
        action_label: 'Complete Profile'
      });
    }

    return actions;
  }
}

module.exports = new SupplierDashboardService();
module.exports.SupplierDashboardService = SupplierDashboardService;
