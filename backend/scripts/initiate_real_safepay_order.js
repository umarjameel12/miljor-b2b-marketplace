'use strict';
require('dotenv').config();
const mysql = require('mysql2/promise');
const safepayAdapter = require('../src/services/safepayAdapter');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'miljor_test_db'
  });

  const rand = Math.floor(10000000 + Math.random() * 90000000);
  const orderCode = `ORD-${rand}`;
  const amount = 9600.00;

  // Insert test order
  const [orderRes] = await conn.query(
    `INSERT INTO orders (order_code, buyer_id, supplier_id, pool_id, total_qty, unit_price, subtotal_amount, total_amount, currency, order_status, payment_status, fulfillment_status, created_at, updated_at)
     VALUES (?, 5, 2, 1, 25.00, 384.00, 9600.00, 9600.00, 'PKR', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT', 'UNPAID', NOW(), NOW())`,
    [orderCode]
  );
  const orderId = orderRes.insertId;

  // Live call to Safepay sandbox API
  const trackerRes = await safepayAdapter.createTracker({
    amount,
    currency: 'PKR',
    orderCode
  });
  const trackerToken = trackerRes.trackerToken;

  // Insert payment attempt
  await conn.query(
    `INSERT INTO payment_attempts (attempt_code, order_id, buyer_id, provider, environment, provider_tracker_token, amount, currency, status, idempotency_key, created_at)
     VALUES (?, ?, 5, 'SAFEPAY', 'sandbox', ?, ?, 'PKR', 'INITIATED', ?, NOW())`,
    [`ATT-${rand}`, orderId, trackerToken, amount, `IDEMP-${rand}`]
  );

  const checkoutUrl = safepayAdapter.constructCheckoutUrl({
    trackerToken,
    orderCode,
    redirectUrl: `http://localhost:3000/orders?order_id=${orderId}&paid=true`
  });

  console.log(JSON.stringify({
    orderId,
    orderCode,
    trackerToken,
    checkoutUrl
  }, null, 2));

  await conn.end();
}

main().catch(err => {
  console.error('INIT ERROR:', err.message);
  process.exit(1);
});
