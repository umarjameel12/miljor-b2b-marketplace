// =============================================================================
// src/services/invoiceService.js
// MilJor Phase B0: Invoices & Receipts Module (Security & Concurrency Hardened)
//
// ENFORCES:
// 1. Authorization-before-generation: Third parties are blocked with 403 BEFORE any
//    invoice row is created or returned.
// 2. Strict RBAC: Accessible only by purchasing buyer, fulfilling supplier, or admin.
// 3. Exactly-once concurrent generation: Serialized under row lock to prevent duplicate
//    snapshots or conflicting invoice identities.
// 4. Immutability: Once issued, snapshot content is permanently preserved.
// =============================================================================

const db = require('../config/db');

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
    return await this.generateInvoiceForOrder(numericOrderId, order);
  }

  /**
   * Generates an invoice for an authorized order inside an atomic transaction.
   *
   * @param {number} orderId
   * @param {Object} [cachedOrder] Pre-fetched and authorized order details
   * @returns {Promise<Object>}
   */
  async generateInvoiceForOrder(orderId, cachedOrder = null) {
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
        [orderId]
      );

      if (orderRows.length === 0) {
        const err = new Error('Order not found');
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      // Check again inside transaction: if another worker generated it concurrently, return existing
      const [existing] = await conn.query('SELECT * FROM invoices WHERE order_id = ? FOR UPDATE', [orderId]);
      if (existing.length > 0) {
        await conn.commit();
        return existing[0];
      }

      const o = orderRows[0];
      const invoiceNumber = `INV-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
      const subtotal = Number(o.subtotal_amount);
      const deliveryFee = Number(o.delivery_fee || 0);
      const platformFee = Number(o.buyer_platform_fee || 0);
      const taxAmount = 0.00;
      const totalAmount = subtotal + deliveryFee + platformFee + taxAmount;

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
