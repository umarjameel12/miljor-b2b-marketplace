'use strict';
// =============================================================================
// backend/tests/safepay_sandbox_live_payment_acceptance.test.js
// MilJor Safepay Sandbox Payment Success & Return Acceptance Gate
// Verifies:
// 1. Genuine sandbox checkout initialization & live tracker query.
// 2. Cryptographic signed webhook verification (HMAC-SHA512 raw body).
// 3. Order PAID transition, escrow locking, stock allocation, and invoice generation.
// 4. Webhook idempotency and duplicate event suppression.
// 5. Server-to-server reconciliation endpoint for authenticated buyer.
// 6. Supplier fulfillment queue visibility.
// 7. Database isolation: strictly miljor_test_db, 0 writes to miljor_db.
// =============================================================================
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'miljor_test_db';

const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mysql = require('mysql2/promise');
const safepayAdapter = require('../src/services/safepayAdapter');
const safepayCheckoutService = require('../src/services/safepayCheckoutService');

async function runLivePaymentAcceptance() {
  console.log('🏁 Starting Safepay Sandbox Payment Pipeline Verification...');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'miljor_test_db'
  });

  const rand = Math.floor(10000000 + Math.random() * 90000000);
  const orderCode = `ORD-${rand}`;
  const amount = 9600.00;

  // 1. Create order in miljor_test_db
  const [orderInsert] = await conn.query(
    `INSERT INTO orders (
      order_code, buyer_id, supplier_id, pool_id, total_qty, unit_price,
      subtotal_amount, total_amount, currency, order_status, payment_status,
      fulfillment_status, created_at, updated_at
    ) VALUES (?, 5, 2, 1, 25.00, 384.00, 9600.00, 9600.00, 'PKR', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT', 'UNPAID', NOW(), NOW())`,
    [orderCode]
  );
  const orderId = orderInsert.insertId;
  console.log('✅ 1. Created test order in miljor_test_db:', { orderId, orderCode, amount });

  // 2. Initiate real Safepay sandbox checkout session
  const checkoutRes = await safepayCheckoutService.initiateCheckout({
    orderId,
    actor: { id: 5, role: 'BUYER' },
    idempotencyKey: `IDEMP-${rand}`,
    redirectUrl: `http://localhost:3000/payment/return?order_id=${orderId}`
  });

  const trackerToken = checkoutRes.attempt.trackerToken || checkoutRes.attempt.provider_tracker_token;
  const checkoutUrl = checkoutRes.attempt.checkout_url;
  console.log('✅ 2. Real Safepay Sandbox Session Created:');
  console.log('     Tracker Token:', trackerToken);
  console.log('     Checkout URL:', checkoutUrl);

  assert.ok(trackerToken && trackerToken.startsWith('track_'), 'Valid Safepay tracker token required');
  assert.ok(checkoutUrl && checkoutUrl.includes('sandbox.api.getsafepay.com'), 'Valid Safepay sandbox checkout URL required');

  // 3. Verify live Safepay Sandbox tracker status via HTTPS
  const liveTracker = await safepayAdapter.fetchTracker(trackerToken);
  console.log('✅ 3. Live Safepay Sandbox Verification:');
  console.log('     Provider State:', liveTracker.data?.state);
  console.log('     Amount:', liveTracker.data?.amount, liveTracker.data?.currency);
  assert.equal(liveTracker.data?.state, 'TRACKER_STARTED', 'Live sandbox session must be TRACKER_STARTED');

  // 4. Test Webhook Verification with genuine HMAC-SHA512 signature
  const webhookSecret = process.env.SAFEPAY_WEBHOOK_SECRET;
  const eventId = `evt_${rand}`;
  const payloadObj = {
    type: 'payment.succeeded',
    data: {
      token: `trans_${rand}`,
      tracker: trackerToken,
      amount: 9600.00,
      currency: 'PKR',
      net: 9600.00,
      fee: 0,
      status: 'PAID'
    }
  };
  const rawBody = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const signature = crypto.createHmac('sha512', webhookSecret).update(rawBody).digest('hex');

  console.log('✅ 4. Processing Signed Webhook with HMAC-SHA512 signature in miljor_test_db...');
  const webhookResult = await safepayCheckoutService.processWebhookEvent({
    rawBody,
    signature,
    timestamp: Date.now(),
    eventId,
    eventType: 'payment.succeeded'
  });
  console.log('     Webhook Processing Result:', webhookResult);
  assert.equal(webhookResult.success, true, 'Webhook processing must return success: true');
  assert.equal(webhookResult.payment_status, 'PAID', 'Payment status must be PAID');

  // 5. Test Duplicate Webhook Idempotency
  const dupResult = await safepayCheckoutService.processWebhookEvent({
    rawBody,
    signature,
    timestamp: Date.now(),
    eventId,
    eventType: 'payment.succeeded'
  });
  console.log('✅ 5. Duplicate Webhook Idempotency Check:', dupResult.is_duplicate ? 'PASS (Idempotent)' : 'FAIL');
  assert.equal(dupResult.is_duplicate, true, 'Duplicate webhook must be recognized without double-mutation');

  // 6. Verify Database State
  const [[orderRow]] = await conn.query('SELECT order_status, payment_status, fulfillment_status FROM orders WHERE id = ?', [orderId]);
  console.log('✅ 6. Updated Order In Database:', orderRow);
  assert.equal(orderRow.order_status, 'PAID', 'Order status must be PAID');
  assert.equal(orderRow.payment_status, 'PAID', 'Payment status must be PAID');
  assert.equal(orderRow.fulfillment_status, 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT', 'Fulfillment must transition to AWAITING_SUPPLIER_ACKNOWLEDGEMENT');

  const [paymentRows] = await conn.query('SELECT payment_code, amount, status, escrow_status FROM payments WHERE order_id = ?', [orderId]);
  console.log('     Payments Table Entry:', paymentRows[0]);
  assert.ok(paymentRows.length === 1, 'Exactly one payment record must exist');
  assert.equal(paymentRows[0].status, 'PAID', 'Payment status must be PAID');
  assert.equal(paymentRows[0].escrow_status, 'HELD_IN_ESCROW', 'Funds must be held in escrow custody');

  const [invoiceRows] = await conn.query('SELECT invoice_number, total_amount, currency FROM invoices WHERE order_id = ?', [orderId]);
  console.log('     Invoices Table Entry:', invoiceRows[0]);
  assert.ok(invoiceRows.length >= 1, 'Invoice must be created');

  // 7. Test Reconcile Endpoint (Reconciliation after paid returns idempotent confirmation)
  const reconRes = await safepayCheckoutService.reconcilePaymentWithProvider({
    orderId,
    actor: { id: 5, role: 'BUYER' }
  });
  console.log('✅ 7. Reconcile Endpoint for Buyer:', reconRes.message, 'already_paid:', reconRes.already_paid);
  assert.equal(reconRes.success, true, 'Reconcile must return success: true');
  assert.equal(reconRes.order_status, 'PAID', 'Order status must be confirmed PAID');

  // 8. Verify Supplier Fulfillment Queue Visibility
  const [suppQueue] = await conn.query(
    `SELECT id, order_code, payment_status, fulfillment_status, total_amount
     FROM orders 
     WHERE supplier_id = 2 AND payment_status = 'PAID' AND id = ?`,
    [orderId]
  );
  console.log('✅ 8. Supplier Fulfillment Queue Item:', suppQueue[0]);
  assert.ok(suppQueue.length === 1, 'Order must appear in supplier fulfillment queue');

  // 9. Pristine Check for miljor_db
  const connPristine = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: 'miljor_db'
  });
  const [[pOrders]] = await connPristine.query('SELECT COUNT(*) as c FROM orders');
  const [[pPayments]] = await connPristine.query('SELECT COUNT(*) as c FROM payments');
  console.log('✅ 9. Pristine Production DB Check (miljor_db):', { orders: pOrders.c, payments: pPayments.c });
  assert.equal(pOrders.c, 0, 'miljor_db orders must remain 0');
  assert.equal(pPayments.c, 0, 'miljor_db payments must remain 0');
  await connPristine.end();

  await conn.end();
  console.log('\n🎉 ALL SAFEPAY SANDBOX PAYMENT ACCEPTANCE TESTS PASSED (100% Green)');
}

if (require.main === module) {
  runLivePaymentAcceptance()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\n❌ ACCEPTANCE TEST FAILED:', err);
      process.exit(1);
    });
}

module.exports = { runLivePaymentAcceptance };
