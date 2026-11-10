// =============================================================================
// src/services/invoiceService.js
// MilJor Package E5: Invoices & Receipts Module
// Generates immutable B2B tax/commercial invoice snapshots
// =============================================================================

const db = require('../config/db');

class InvoiceService {

  async generateInvoiceForOrder(orderId, connection = null) {
    const conn = connection || db;

    // Check if invoice already exists
    const [existing] = await conn.query('SELECT * FROM invoices WHERE order_id = ?', [orderId]);
    if (existing.length > 0) {
      return existing[0];
    }

    // Fetch order details
    const [orderRows] = await conn.query(
      `SELECT o.*, u_buyer.business_name as buyer_business_name, u_buyer.email as buyer_email,
              u_buyer.phone as buyer_phone, u_supp.business_name as supplier_business_name,
              sp.tax_ntn as supplier_ntn, sp.warehouse_address as supplier_address
       FROM orders o
       JOIN users u_buyer ON o.buyer_id = u_buyer.id
       JOIN users u_supp ON o.supplier_id = u_supp.id
       JOIN supplier_profiles sp ON sp.supplier_id = u_supp.id
       WHERE o.id = ?`,
      [orderId]
    );

    if (orderRows.length === 0) {
      const err = new Error('Order not found');
      err.code = 'ORDER_NOT_FOUND';
      err.statusCode = 404;
      throw err;
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
    return created[0];
  }

  async getInvoiceByOrderId(orderId, callerId, callerRole) {
    const [rows] = await db.query('SELECT * FROM invoices WHERE order_id = ?', [orderId]);
    if (rows.length === 0) {
      // Auto-generate if order exists
      return await this.generateInvoiceForOrder(orderId);
    }

    const inv = rows[0];
    if (callerRole !== 'ADMIN' && callerRole !== 'SUPER_ADMIN') {
      if (inv.buyer_id !== callerId && inv.supplier_id !== callerId) {
        const err = new Error('You do not have permission to view this invoice');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        throw err;
      }
    }
    return inv;
  }
}

module.exports = new InvoiceService();
