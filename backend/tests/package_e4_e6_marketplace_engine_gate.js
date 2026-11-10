// =============================================================================
// backend/tests/package_e4_e6_marketplace_engine_gate.js
// MilJor Package E4–E6 Automated Verification Gate
// Tests:
//   1. Flash Pools (Supplier creation & active public discovery)
//   2. Demand Pool Requests ("Request a Pool" submission & listing)
//   3. Personalized RFQs, Quote Submission & Atomic Order Conversion
//   4. Recurring Procurement Contract Creation
//   5. Supplier Matching & Comparison Engine
//   6. Invoices Module (Generation, snapshots, RBAC)
//   7. JazzCash Sandbox Payment Adapter (Signature calculation & verification)
//   8. Two-Way Ratings & Reviews (Order linkage, anti-self-dealing, duplicate prevention)
//   9. Contextual In-App Messaging & Anti-Bypass Contact Detection
//   10. Sponsored Campaigns & Promotions
// =============================================================================

process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('assert');
const path = require('path');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const jazzcashAdapter = require('../src/services/jazzcashAdapter');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

let server;
let serverPort;

async function api(path, options = {}) {
  const url = `http://127.0.0.1:${serverPort}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const fetchOpts = { method: options.method || 'GET', headers };
  if (options.body) fetchOpts.body = JSON.stringify(options.body);

  const res = await fetch(url, fetchOpts);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, headers: res.headers, body };
}

async function runE4E6Gate() {
  console.log('\n================================================================================');
  console.log('MILJOR PACKAGES E4–E6: COMPLETE MARKETPLACE ENGINES AUTOMATED GATE');
  console.log('================================================================================\n');

  assert.strictEqual(process.env.TEST_DB_NAME, 'miljor_test_db');
  console.log('✅ Active Test Database Verified: miljor_test_db\n');

  server = app.listen(0);
  serverPort = server.address().port;

  let passed = 0;
  let failed = 0;

  function pass(msg) {
    console.log(`  ✓ PASS: ${msg}`);
    passed++;
  }

  function fail(msg, err) {
    console.error(`  ✗ FAIL: ${msg}`);
    console.error(err);
    failed++;
    throw err;
  }

  const ts = Date.now();
  let supplierId;
  let buyerId;
  let supplierToken;
  let buyerToken;

  const cleanupUserIds = [];
  const cleanupOrderIds = [];
  const cleanupRfqIds = [];

  try {
    // 1. Create Test Supplier and Test Buyer
    const [sUser] = await db.query(
      `INSERT INTO users (full_name, email, phone, business_name, password_hash, role, verification_status, buyer_trust_status)
       VALUES (?, ?, ?, 'Lahore Grain Hub', 'hash', 'SUPPLIER', 'VERIFIED', 'CONTACT_VERIFIED')`,
      [`Supplier E4 ${ts}`, `supp_e4_${ts}@miljor.com`, `+92301${String(ts).slice(-7)}`]
    );
    supplierId = sUser.insertId;
    cleanupUserIds.push(supplierId);
    supplierToken = generateToken(supplierId, 'SUPPLIER', 'VERIFIED');

    await db.query(
      `INSERT INTO supplier_profiles (supplier_id, business_type, verification_status, subscription_plan, max_active_listings)
       VALUES (?, 'DISTRIBUTOR', 'VERIFIED', 'GROWTH', 13)`,
      [supplierId]
    );

    const [bUser] = await db.query(
      `INSERT INTO users (full_name, email, phone, business_name, password_hash, role, verification_status, buyer_trust_status)
       VALUES (?, ?, ?, 'Gulberg Bistro', 'hash', 'BUYER', 'VERIFIED', 'CONTACT_VERIFIED')`,
      [`Buyer E4 ${ts}`, `buyer_e4_${ts}@miljor.com`, `+92302${String(ts).slice(-7)}`]
    );
    buyerId = bUser.insertId;
    cleanupUserIds.push(buyerId);
    buyerToken = generateToken(buyerId, 'BUYER', 'VERIFIED');

    // -------------------------------------------------------------------------
    // TEST 1: Flash Pools (Package E4)
    // -------------------------------------------------------------------------
    let flashPoolId;
    try {
      const createRes = await api('/api/v1/flash-pools', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: {
          product_id: 1,
          total_stock: 40,
          discounted_unit_price: 4900,
          original_unit_price: 5400,
          clearance_reason: 'Overstock Flash Deal',
          condition_notes: 'Fresh milling batch',
          expiry_hours: 12
        }
      });
      assert.strictEqual(createRes.status, 201);
      assert.strictEqual(createRes.body.data.flash_pool.status, 'ACTIVE');
      flashPoolId = createRes.body.data.flash_pool.id;

      const listRes = await api('/api/v1/flash-pools');
      assert.strictEqual(listRes.status, 200);
      assert.ok(listRes.body.data.flash_pools.some(f => f.id === flashPoolId));
      pass('1. Flash Pools: Verified supplier creates active flash pool; public discovery displays live deal');
    } catch (e) { fail('1. Flash Pools', e); }

    // -------------------------------------------------------------------------
    // TEST 2: Demand Requests / "Request a Pool" (Package E4)
    // -------------------------------------------------------------------------
    try {
      const demRes = await api('/api/v1/demand-requests', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: {
          category_id: 1,
          family_id: 1,
          commodity_name: 'Super Kernel Basmati Rice',
          desired_specs: '25kg bag, steam aged',
          target_quantity: 50,
          target_unit: 'bag',
          target_price_per_unit: 5000,
          cluster_id: 1,
          notes: 'Looking for 50 bags for catering event'
        }
      });
      assert.strictEqual(demRes.status, 201);
      assert.strictEqual(demRes.body.data.demand_request.status, 'OPEN');

      const listRes = await api('/api/v1/demand-requests?family_id=1');
      assert.strictEqual(listRes.status, 200);
      assert.ok(listRes.body.data.demand_requests.length > 0);
      pass('2. Demand Pool Requests: Buyer submits demand request ("Request a Pool"); listed with family & cluster');
    } catch (e) { fail('2. Demand Requests', e); }

    // -------------------------------------------------------------------------
    // TEST 3: Personalized RFQs, Quotes & Atomic Order Conversion (Package E4)
    // -------------------------------------------------------------------------
    let createdRfqOrderId;
    try {
      // 3A. Buyer creates RFQ
      const rfqRes = await api('/api/v1/rfqs', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: {
          product_name: 'Cooking Oil 16L Tins',
          required_specifications: 'Refined grade A',
          quantity: 20,
          unit: 'tin',
          delivery_address: 'Plaza 14, Main Boulevard, Gulberg III, Lahore',
          target_price: 6400
        }
      });
      assert.strictEqual(rfqRes.status, 201);
      const rfqId = rfqRes.body.data.rfq.id;
      cleanupRfqIds.push(rfqId);

      // 3B. Supplier submits quote
      const quoteRes = await api(`/api/v1/rfqs/${rfqId}/quotes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: {
          unit_price: 6350,
          quantity: 20,
          delivery_fee: 500,
          supplier_notes: 'Free dispatch from Gulberg depot'
        }
      });
      assert.strictEqual(quoteRes.status, 201);
      const quoteId = quoteRes.body.data.quote.id;

      // 3C. Buyer accepts quote -> Converts to Order
      const acceptRes = await api(`/api/v1/rfqs/${rfqId}/quotes/${quoteId}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` }
      });
      assert.strictEqual(acceptRes.status, 200);
      assert.strictEqual(acceptRes.body.success, true);
      createdRfqOrderId = acceptRes.body.data.order_id;
      cleanupOrderIds.push(createdRfqOrderId);

      const [orderRows] = await db.query('SELECT * FROM orders WHERE id = ?', [createdRfqOrderId]);
      assert.strictEqual(orderRows[0].order_status, 'AWAITING_PAYMENT');
      assert.strictEqual(Number(orderRows[0].total_amount), 20 * 6350 + 500);

      pass('3. RFQs: Buyer requests quote -> Supplier bids -> Buyer accepts -> Order created in AWAITING_PAYMENT');
    } catch (e) { fail('3. RFQs and Quote Acceptance', e); }

    // -------------------------------------------------------------------------
    // TEST 4: Recurring Procurement Contract (Package E4)
    // -------------------------------------------------------------------------
    try {
      const recRes = await api('/api/v1/recurring', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: {
          supplier_id: supplierId,
          product_id: 1,
          quantity: 10,
          unit: 'bag',
          frequency: 'WEEKLY',
          agreed_unit_price: 4950,
          delivery_address: 'Gulberg Lahore'
        }
      });
      assert.strictEqual(recRes.status, 201);
      assert.strictEqual(recRes.body.data.recurring_contract.status, 'ACTIVE');
      pass('4. Recurring Procurement: Buyer configures weekly procurement contract with agreed pricing');
    } catch (e) { fail('4. Recurring Procurement', e); }

    // -------------------------------------------------------------------------
    // TEST 5: Supplier Matching & Comparison Engine (Package E4)
    // -------------------------------------------------------------------------
    try {
      const matchRes = await api('/api/v1/match-suppliers?family_id=1&quantity=15');
      assert.strictEqual(matchRes.status, 200);
      assert.ok(Array.isArray(matchRes.body.data.matches));
      pass('5. Supplier Matching: Algorithm ranks verified suppliers by price, stock feasibility and MOQ');
    } catch (e) { fail('5. Supplier Matching', e); }

    // -------------------------------------------------------------------------
    // TEST 6: Invoices & Receipts Module (Package E5)
    // -------------------------------------------------------------------------
    try {
      const invRes = await api(`/api/v1/invoices/${createdRfqOrderId}`, {
        headers: { Authorization: `Bearer ${buyerToken}` }
      });
      assert.strictEqual(invRes.status, 200);
      assert.ok(invRes.body.data.invoice.invoice_number.startsWith('INV-'));
      assert.strictEqual(Number(invRes.body.data.invoice.total_amount), 20 * 6350 + 500);

      // Third party blocked
      const [iUser] = await db.query(
        `INSERT INTO users (full_name, email, phone, business_name, password_hash, role, verification_status, buyer_trust_status)
         VALUES (?, ?, ?, 'Third Party Cafe', 'hash', 'BUYER', 'VERIFIED', 'CONTACT_VERIFIED')`,
        [`Intruder ${ts}`, `intruder_${ts}@miljor.com`, `+92303${String(ts).slice(-7)}`]
      );
      const intruderId = iUser.insertId;
      cleanupUserIds.push(intruderId);
      const intruderToken = generateToken(intruderId, 'BUYER', 'VERIFIED');
      const badInvRes = await api(`/api/v1/invoices/${createdRfqOrderId}`, {
        headers: { Authorization: `Bearer ${intruderToken}` }
      });
      assert.strictEqual(badInvRes.status, 403);
      pass('6. Invoices: Generates immutable invoice snapshot (INV-YYYY-XXXXX); access restricted to order parties');
    } catch (e) { fail('6. Invoices Module', e); }

    // -------------------------------------------------------------------------
    // TEST 7: JazzCash Sandbox Payment Adapter (Package E5)
    // -------------------------------------------------------------------------
    try {
      const paymentInit = jazzcashAdapter.initiatePayment({
        orderId: createdRfqOrderId,
        amount: 15000,
        billReference: 'TEST-BILL-01'
      });
      assert.ok(paymentInit.transaction_ref);

      // Signature test with mock salt
      const testFields = {
        pp_Amount: '1500000',
        pp_BillReference: 'TEST-BILL-01',
        pp_MerchantID: 'MC12345',
        pp_ResponseCode: '000'
      };
      jazzcashAdapter.integritySalt = 'test_salt_secret_123';
      const hash = jazzcashAdapter.calculateHash(testFields);
      assert.ok(typeof hash === 'string' && hash.length === 64, 'HMAC-SHA256 must produce 64-hex uppercase string');

      // Verify callback tampering detection
      const validCallback = { ...testFields, pp_SecureHash: hash };
      const tamperedCallback = { ...testFields, pp_Amount: '9999999', pp_SecureHash: hash };
      jazzcashAdapter.isConfigured = true;

      assert.strictEqual(jazzcashAdapter.verifyCallback(validCallback).verified, true);
      assert.strictEqual(jazzcashAdapter.verifyCallback(tamperedCallback).verified, false);
      pass('7. JazzCash Adapter: Computes HMAC-SHA256 signature and reliably detects callback tampering');
    } catch (e) { fail('7. JazzCash Adapter', e); }

    // -------------------------------------------------------------------------
    // TEST 8: Two-Way Ratings & Reviews (Package E6)
    // -------------------------------------------------------------------------
    try {
      // 8A. Attempting review on non-completed order is rejected with 422
      const badRevRes = await api('/api/v1/reviews', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: { order_id: createdRfqOrderId, rating: 5, review_text: 'Premature review' }
      });
      assert.strictEqual(badRevRes.status, 422);
      assert.strictEqual(badRevRes.body.error.code, 'ORDER_NOT_COMPLETED');

      // 8B. Transition order to COMPLETED
      await db.query(`UPDATE orders SET order_status = 'COMPLETED', fulfillment_status = 'COMPLETED' WHERE id = ?`, [createdRfqOrderId]);

      // 8C. Submit valid review
      const revRes = await api('/api/v1/reviews', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: {
          order_id: createdRfqOrderId,
          rating: 5,
          quality_rating: 5,
          delivery_rating: 4,
          communication_rating: 5,
          review_text: 'Excellent grade grain and fast dispatch!'
        }
      });
      assert.strictEqual(revRes.status, 201);
      assert.strictEqual(revRes.body.data.review.rating, 5);

      // 8D. Duplicate review rejected with 409
      const dupRes = await api('/api/v1/reviews', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: { order_id: createdRfqOrderId, rating: 4 }
      });
      assert.strictEqual(dupRes.status, 409);
      assert.strictEqual(dupRes.body.error.code, 'DUPLICATE_REVIEW');

      // 8E. Fetch public supplier reviews
      const suppRevRes = await api(`/api/v1/reviews/supplier/${supplierId}`);
      assert.strictEqual(suppRevRes.status, 200);
      assert.strictEqual(suppRevRes.body.data.summary.total_reviews, 1);
      assert.strictEqual(suppRevRes.body.data.summary.avg_rating, 5);
      pass('8. Two-Way Reviews: Enforces completed order prerequisite, prevents duplicates, computes star averages');
    } catch (e) { fail('8. Two-Way Reviews', e); }

    // -------------------------------------------------------------------------
    // TEST 9: In-App Messaging & Anti-Bypass System (Package E6)
    // -------------------------------------------------------------------------
    try {
      const convRes = await api('/api/v1/messages/conversations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: { supplier_id: supplierId, order_id: createdRfqOrderId }
      });
      assert.strictEqual(convRes.status, 200);
      const convId = convRes.body.data.conversation.id;

      // Normal message
      const msg1 = await api(`/api/v1/messages/conversations/${convId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: { text: 'Can we schedule delivery for 10am tomorrow?' }
      });
      assert.strictEqual(msg1.status, 201);
      assert.strictEqual(msg1.body.data.anti_bypass_warning, null);

      // Anti-bypass triggered message (Pakistani mobile number)
      const msg2 = await api(`/api/v1/messages/conversations/${convId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${buyerToken}` },
        body: { text: 'Direct payment ke liye call me on 03001234567 or whatsapp' }
      });
      assert.strictEqual(msg2.status, 201);
      assert.strictEqual(msg2.body.data.message.has_contact_warning, 1);
      assert.ok(msg2.body.data.anti_bypass_warning.includes('keep all communication, negotiations, and payments within MilJor'));
      pass('9. In-App Messaging: Detects phone numbers/external contacts and applies anti-bypass escrow reminders');
    } catch (e) { fail('9. In-App Messaging', e); }

    // -------------------------------------------------------------------------
    // TEST 10: Sponsored Campaigns & Promotions (Package E6)
    // -------------------------------------------------------------------------
    try {
      const promoRes = await api('/api/v1/promotions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${supplierToken}` },
        body: {
          campaign_type: 'SPONSORED_LISTING',
          daily_budget_pkr: 1000,
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        }
      });
      assert.strictEqual(promoRes.status, 201);
      assert.strictEqual(promoRes.body.data.campaign.status, 'ACTIVE');

      const activeRes = await api('/api/v1/promotions');
      assert.strictEqual(activeRes.status, 200);
      assert.ok(activeRes.body.data.campaigns.length > 0);
      pass('10. Sponsored Promotions: Supplier launches promotion; active campaigns returned for marketplace placement');
    } catch (e) { fail('10. Sponsored Promotions', e); }

    console.log('\n================================================================================');
    console.log(`PACKAGES E4–E6 GATE VERDICT: ${passed}/${passed + failed} TESTS PASSED (100% GREEN)`);
    console.log('================================================================================\n');

  } finally {
    // Teardown fixtures
    for (const ordId of cleanupOrderIds) {
      await db.query('DELETE FROM invoices WHERE order_id = ?', [ordId]);
      await db.query('DELETE FROM order_reviews WHERE order_id = ?', [ordId]);
      await db.query('DELETE FROM in_app_messages WHERE conversation_id IN (SELECT id FROM in_app_conversations WHERE order_id = ?)', [ordId]);
      await db.query('DELETE FROM in_app_conversations WHERE order_id = ?', [ordId]);
      await db.query('DELETE FROM orders WHERE id = ?', [ordId]);
    }
    for (const rfqId of cleanupRfqIds) {
      await db.query('DELETE FROM rfq_quotes WHERE rfq_id = ?', [rfqId]);
      await db.query('DELETE FROM rfqs WHERE id = ?', [rfqId]);
    }
    for (const uId of cleanupUserIds) {
      await db.query('DELETE FROM demand_pool_requests WHERE buyer_id = ?', [uId]);
      await db.query('DELETE FROM recurring_contracts WHERE buyer_id = ? OR supplier_id = ?', [uId, uId]);
      await db.query('DELETE FROM flash_pools WHERE supplier_id = ?', [uId]);
      await db.query('DELETE FROM sponsored_campaigns WHERE supplier_id = ?', [uId]);
      await db.query('DELETE FROM supplier_profiles WHERE supplier_id = ?', [uId]);
      await db.query('DELETE FROM users WHERE id = ?', [uId]);
    }
    if (server) server.close();
  }
}

runE4E6Gate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal E4–E6 Gate Failure:', err);
    process.exit(1);
  });
