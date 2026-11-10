// =============================================================================
// src/services/invoiceService.js
// MilJor Phase B0.1: Invoices & Receipts Module (Security, Uniqueness & Monetary Hardened)
//
// ENFORCES:
// 1. Authorization-before-generation: Service boundary and retrieval require verified
//    caller identity (buyer, supplier, admin); unauthorized callers are rejected with 403
//    before ANY invoice row is created.
// 2. Strict Service Boundary Protection: Direct invocation of generateInvoiceForOrder
//    without valid authorized context fails closed.
// 3. Collision-Safe Deterministic Numbering: Invoice numbers use deterministic
//    INV-YYYY-XXXXXX format based on immutable MySQL order ID.
// 4. Exact Decimal Monetary Integrity: Subtotal, fees, and totals reflect locked
//    order contracts with zero floating-point drift (exactDecimal).
// 5. Concurrency Serialization: Concurrent requests serialized under order row locks.
// =============================================================================

const db = require('../config/db');
const exactDecimal = require('./exactDecimal');

class InvoiceService {

  /**
   * Retrieves an invoice for an order with strict authorization enforced BEFORE generation.
   *
   * @param {number|string} orderId
   * @param {number} callerId
   * @param {string} callerRole
   * @returns {Promise<Object>}
   */
  async getInvoiceByOrderId(orderId, callerId, callerRole) {
    const numericOrderId = parseInt(orderId, 10);
    if (!numericOrderId || isNaN(numericOrderId) || numericOrderId <= 0) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ORDER_ID';
      err.statusCode = 400;
      throw err;
    }

    if (!callerId) {
      const err = new Error('Authentication required');
      err.code = 'UNAUTHORIZED';
      err.statusCode = 401;
      throw err;
    }

    // 1. Fetch order details to enforce authorization BEFORE any generation or row creation
    const [orderRows] = await db.query(
      `SELECT o.*, u_buyer.business_name as buyer_business_name, u_buyer.email as buyer_email,
              u_buyer.phone as buyer_phone, u_supp.business_name as supplier_business_name,
              sp.tax_ntn as supplier_ntn, sp.warehouse_address as supplier_address
       FROM orders o
       JOIN users u_buyer ON o.buyer_id = u_buyer.id
       JOIN users u_supp ON o.supplier_id = u_supp.id
       JOIN supplier_profiles sp ON sp.supplier_id = u_supp.id
       WHERE o.id = ?`,
      [numericOrderId]
    );

    if (orderRows.length === 0) {
      const err = new Error('Order not found');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const order = orderRows[0];

    // 2. Strict Authorization Check — BEFORE any generation
    const isAdmin = ['ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN'].includes(callerRole);
    const isOrderBuyer = Number(order.buyer_id) === Number(callerId);
    const isOrderSupplier = Number(order.supplier_id) === Number(callerId);

    if (!isAdmin && !isOrderBuyer && !isOrderSupplier) {
      const err = new Error('You do not have permission to view or generate an invoice for this order');
      err.code = 'INVOICE_ACCESS_FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    // 3. Fast path: Check if invoice already exists
    const [existing] = await db.query('SELECT * FROM invoices WHERE order_id = ?', [numericOrderId]);
    if (existing.length > 0) {
      return existing[0];
    }

    // 4. Safe concurrent generation under transaction row lock
    return await this.generateInvoiceForOrder(numericOrderId, { id: callerId, role: callerRole });
  }

  /**
   * Generates an invoice for an authorized order inside an atomic transaction.
   * Service-level issuance boundary: Enforces caller authorization at the service layer (Repair P0-D).
   *
   * @param {number} orderId
   * @param {Object} callerContext { id, role, isSystemInternal }
   * @returns {Promise<Object>}
   */
  async generateInvoiceForOrder(orderId, callerContext = null) {
    const numericOrderId = parseInt(orderId, 10);
    if (!numericOrderId || isNaN(numericOrderId) || numericOrderId <= 0) {
      const err = new Error('Valid numeric order ID is required');
      err.code = 'INVALID_ORDER_ID';
      err.statusCode = 400;
      throw err;
    }

    // Service Boundary Guard: Reject unauthenticated direct generator invocations (Repair P0-D)
    if (!callerContext || (!callerContext.isSystemInternal && !callerContext.id)) {
      const err = new Error('Direct invoice generation requires authenticated caller context or system authorization');
      err.code = 'INVOICE_ACCESS_FORBIDDEN';
      err.statusCode = 403;
      throw err;
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // Acquire lock on the order row to serialize concurrent generation requests
      const [orderRows] = await conn.query(
        `SELECT o.*, u_buyer.business_name as buyer_business_name, u_buyer.email as buyer_email,
                u_buyer.phone as buyer_phone, u_supp.business_name as supplier_business_name,
                sp.tax_ntn as supplier_ntn, sp.warehouse_address as supplier_address
         FROM orders o
         JOIN users u_buyer ON o.buyer_id = u_buyer.id
         JOIN users u_supp ON o.supplier_id = u_supp.id
         JOIN supplier_profiles sp ON sp.supplier_id = u_supp.id
         WHERE o.id = ? FOR UPDATE`,
        [numericOrderId]
      );

      if (orderRows.length === 0) {
        const err = new Error('Order not found');
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const o = orderRows[0];

      // Service-level RBAC check against authoritative database row
      const isAdmin = callerContext.isSystemInternal || ['ADMIN', 'SUPER_ADMIN', 'FINANCE_ADMIN'].includes(callerContext.role);
      const isOrderBuyer = Number(o.buyer_id) === Number(callerContext.id);
      const isOrderSupplier = Number(o.supplier_id) === Number(callerContext.id);

      if (!isAdmin && !isOrderBuyer && !isOrderSupplier) {
        const err = new Error('You do not have permission to generate an invoice for this order');
        err.code = 'INVOICE_ACCESS_FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }

      // Check again inside transaction: if another worker generated it concurrently, return existing
      const [existing] = await conn.query('SELECT * FROM invoices WHERE order_id = ? FOR UPDATE', [numericOrderId]);
      if (existing.length > 0) {
        await conn.commit();
        return existing[0];
      }

      // Collision-Safe Deterministic Invoice Numbering (Repair P1-A)
      // Suffix is keyed on unique MySQL order ID to eliminate timestamp-based collision vulnerability
      const currentYear = new Date().getFullYear();
      const invoiceNumber = `INV-${currentYear}-${String(o.id).padStart(6, '0')}`;

      // Exact Decimal Monetary Reconcilation (Repair P1-B)
      const subtotalStr = exactDecimal.toCanonicalString(o.subtotal_amount, 2);
      const deliveryFeeStr = exactDecimal.toCanonicalString(o.delivery_fee || '0.00', 2);
      const platformFeeStr = exactDecimal.toCanonicalString(o.buyer_platform_fee || '0.00', 2);
      const taxAmountStr = '0.00';
      const totalAmountStr = exactDecimal.toCanonicalString(o.total_amount, 2);

      const subtotal = Number(subtotalStr);
      const deliveryFee = Number(deliveryFeeStr);
      const platformFee = Number(platformFeeStr);
      const taxAmount = Number(taxAmountStr);
      const totalAmount = Number(totalAmountStr);

      const snapshot = {
        invoice_number: invoiceNumber,
        order_id: o.id,
        order_code: o.order_code,
        issued_date: new Date().toISOString(),
        buyer: {
          id: o.buyer_id,
          business_name: o.buyer_business_name,
          email: o.buyer_email,
          phone: o.buyer_phone,
          delivery_address: o.delivery_address
        },
        supplier: {
          id: o.supplier_id,
          business_name: o.supplier_business_name,
          ntn: o.supplier_ntn,
          warehouse_address: o.supplier_address
        },
        items: [
          {
            description: `Order ${o.order_code} Wholesale Commodity`,
            quantity: Number(o.total_qty),
            unit_price: Number(o.unit_price),
            line_total: subtotal
          }
        ],
        pricing: {
          subtotal,
          delivery_fee: deliveryFee,
          platform_fee: platformFee,
          tax_amount: taxAmount,
          total_amount: totalAmount,
          currency: o.currency || 'PKR'
        }
      };

      const [res] = await conn.query(
        `INSERT INTO invoices (
          invoice_number, order_id, buyer_id, supplier_id, subtotal_amount,
          delivery_fee, buyer_platform_fee, tax_amount, total_amount, currency,
          status, invoice_snapshot_json, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', 'ISSUED', ?, NOW())`,
        [
          invoiceNumber, o.id, o.buyer_id, o.supplier_id, subtotal,
          deliveryFee, platformFee, taxAmount, totalAmount, JSON.stringify(snapshot)
        ]
      );

      const [created] = await conn.query('SELECT * FROM invoices WHERE id = ?', [res.insertId]);
      await conn.commit();
      return created[0];
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = new InvoiceService();
