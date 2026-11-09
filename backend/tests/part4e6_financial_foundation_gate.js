/**
 * MILJOR PART 4E.6: FINANCIAL SETTLEMENT, REFUND, SUPPLIER PAYOUT & RECONCILIATION GATE
 * 
 * Verifies the production-oriented financial foundation:
 * 1. Supplier payable accrual & exact decimal entitlement calculation.
 * 2. Financial holds & release governance.
 * 3. Line-item refund assessments & administrative approval without premature provider execution.
 * 4. Supplier disbursement preparation & strict disabled execution boundaries.
 * 5. Provider settlement batch reconciliation & mismatch detection.
 * 6. RBAC, tenant isolation & immutable chronological audit trails.
 * 7. Database isolation & baseline data preservation.
 * 
 * Execution: node tests/part4e6_financial_foundation_gate.js
 */

process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const app = require('../server');
const exactDecimal = require('../src/services/exactDecimal');
const { assertTestDatabaseSafety } = require('./testDbSafetyGuard');

const JWT_SECRET = process.env.JWT_SECRET || 'miljor_dev_jwt_secret_key_2026';

function generateToken(userId, role, status = 'VERIFIED') {
  return jwt.sign(
    { id: userId, role, verification_status: status },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'miljor-api', audience: 'miljor-app' }
  );
}

// Seeded users:
// User 1: ADMIN
// User 2: SUPPLIER (Verified)
// User 3: SUPPLIER (Competitor Supplier)
// User 5: BUYER 1
// User 6: BUYER 2 (Competitor Buyer)
const buyer1Token = generateToken(5, 'BUYER', 'VERIFIED');
const buyer2Token = generateToken(6, 'BUYER', 'VERIFIED');
const supplierToken = generateToken(2, 'SUPPLIER', 'VERIFIED');
const competitorSupplierToken = generateToken(3, 'SUPPLIER', 'VERIFIED');
const adminToken = generateToken(1, 'ADMIN', 'VERIFIED');

let testServer = null;
let baseUrl = '';

function makeRequest(method, url, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    let postData = null;
    if (body !== null) {
      postData = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(JSON.stringify(body), 'utf8');
    }

    const reqHeaders = { ...headers };
    if (postData) {
      if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      reqHeaders['Content-Length'] = postData.length;
    }

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method.toUpperCase(),
      headers: reqHeaders
    };

    const req = http.request(options, (res) => {
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(rawData);
        } catch (e) {
          json = { raw: rawData };
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json
        });
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runFinancialFoundationGate() {
  console.log('================================================================================');
  console.log('MILJOR PART 4E.6: FINANCIAL SETTLEMENT, REFUND & RECONCILIATION GATE');
  console.log('Target Database: miljor_test_db');
  console.log('================================================================================\n');

  // Verify DB safety
  await assertTestDatabaseSafety(db, 'Part 4E.6 Financial Foundation Gate');

  // Start dedicated test server on ephemeral port
  testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve));
  const port = testServer.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`📡 Test server listening at ${baseUrl}\n`);

  let passedAssertions = 0;
  function pass(msg) {
    passedAssertions++;
    console.log(`  [PASS] Assertion ${passedAssertions}: ${msg}`);
  }

  // Fixture IDs to clean up in teardown
  let poolId = null;
  let snapshotId = null;
  let paidOrderId = null;
  let unpaidOrderId = null;
  let paymentId = null;
  let payableId = null;
  let holdId = null;
  let refundId = null;
  let disbursementId = null;
  let batchRef = `sb_test_${Date.now()}`;

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: Commercial Fixture Setup
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Commercial Order Fixture Setup ---');

    // Create Pool
    const poolCode = `POOL-FIN-${Date.now().toString().slice(-6)}`;
    const [poolRes] = await db.query(
      `INSERT INTO pools (
        pool_code, product_id, product_spec_id, supplier_listing_id, supplier_id,
        status, pool_unit, buyer_min_qty, purchase_increment, target_qty,
        supplier_min_qty, max_capacity, current_qty, current_price_per_unit,
        delivery_type, delivery_fee_policy, expires_at, created_at, updated_at
      ) VALUES (
        ?, 1, 1, 1, 2,
        'CONFIRMED', 'BAG_50KG', 5.0000, 1.0000, 100.0000,
        50.0000, 500.0000, 100.0000, 243.30,
        'DOORSTEP', 'STANDARD_DELIVERY', DATE_ADD(NOW(), INTERVAL 2 DAY), NOW(), NOW()
      )`,
      [poolCode]
    );
    poolId = poolRes.insertId;

    // Create Snapshot
    const [snapRes] = await db.query(
      `INSERT INTO pool_commercial_snapshots (
        snapshot_code, pool_id, snapshot_version, qualification_status,
        participation_cutoff, supplier_id, product_id, product_spec_id,
        canonical_spec_hash, pool_unit, eligible_aggregate_qty, supplier_min_qty,
        target_qty, max_capacity, applicable_tier_index, candidate_unit_price,
        participating_reservations_count, participating_reservations_summary,
        delivery_type, supplier_confirmation_deadline, buyer_commitment_deadline,
        status
      ) VALUES (
        CONCAT('S4E6-', SUBSTRING(UNIX_TIMESTAMP(), -6), FLOOR(RAND() * 1000)), ?, 1, 'QUALIFIED',
        NOW(), 2, 1, 1, 'mock-hash-4e6', 'BAG_50KG', 100.0000, 50.0000,
        100.0000, 500.0000, 1, 243.30,
        1, '[]',
        'DOORSTEP', DATE_ADD(NOW(), INTERVAL 1 DAY), DATE_ADD(NOW(), INTERVAL 2 DAY), 'ACCEPTED'
      )`,
      [poolId]
    );
    snapshotId = snapRes.insertId;

    // Create PAID Order: subtotal 24330.00, delivery 500.00, buyer fee 250.00, total 25080.00
    const orderCode1 = `ORD-FIN-${Date.now().toString().slice(-6)}-1`;
    const [order1Res] = await db.query(
      `INSERT INTO orders (
        order_code, buyer_id, supplier_id, pool_id, snapshot_id,
        total_qty, unit_price, subtotal_amount, delivery_fee, buyer_platform_fee, total_amount,
        currency, delivery_type, payment_status, order_status, fulfillment_status,
        supplier_delivered_at, buyer_confirmed_at, completed_at, created_at, updated_at
      ) VALUES (?, 5, 2, ?, ?, 100.0000, 243.30, 24330.00, 500.00, 250.00, 25080.00,
        'PKR', 'DOORSTEP', 'PAID', 'DELIVERED', 'BUYER_CONFIRMED',
        NOW(), NOW(), NOW(), NOW(), NOW())`,
      [orderCode1, poolId, snapshotId]
    );
    paidOrderId = order1Res.insertId;

    // Create Authoritative Payment Record
    const payCode = `PAY-FIN-${Date.now().toString().slice(-6)}`;
    const trackerToken = `track_fin_${Date.now()}`;
    const [payRes] = await db.query(
      `INSERT INTO payments (
        payment_code, order_id, buyer_id, amount, buyer_fee, payment_method,
        status, escrow_status, transaction_ref, provider_response, paid_at, created_at
      ) VALUES (?, ?, 5, 25080.00, 250.00, 'CARD', 'PAID', 'HELD_IN_ESCROW', ?, '{"status":"captured"}', NOW(), NOW())`,
      [payCode, paidOrderId, trackerToken]
    );
    paymentId = payRes.insertId;

    // Create UNPAID Order for boundary testing
    const orderCode2 = `ORD-FIN-${Date.now().toString().slice(-6)}-2`;
    const [order2Res] = await db.query(
      `INSERT INTO orders (
        order_code, buyer_id, supplier_id, pool_id, snapshot_id,
        total_qty, unit_price, subtotal_amount, delivery_fee, buyer_platform_fee, total_amount,
        currency, delivery_type, payment_status, order_status, fulfillment_status,
        created_at, updated_at
      ) VALUES (?, 5, 2, ?, ?, 50.0000, 243.30, 12165.00, 500.00, 150.00, 12815.00,
        'PKR', 'DOORSTEP', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT', 'UNPAID', NOW(), NOW())`,
      [orderCode2, poolId, snapshotId]
    );
    unpaidOrderId = order2Res.insertId;

    pass('Commercial test fixtures initialized (Pool, Snapshot, Paid Order 1, Payment, Unpaid Order 2)');

    // -------------------------------------------------------------------------
    // SECTION 2: Supplier Payable Accrual & Exact Decimal Math
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Supplier Payable Accrual & Calculations ---');

    // 2. Accrual rejected on UNPAID order
    const unpaidAccrueRes = await makeRequest('POST', `${baseUrl}/api/v1/settlements/payables/accrue`, {
      Authorization: `Bearer ${adminToken}`
    }, { order_id: unpaidOrderId });
    assert.strictEqual(unpaidAccrueRes.status, 422);
    assert.strictEqual(unpaidAccrueRes.body.error.code, 'UNPAID_ORDER_NOT_PAYABLE');
    pass('Payable Accrual: Rejected on unpaid order (422 UNPAID_ORDER_NOT_PAYABLE)');

    // 3. Non-admin blocked from triggering direct accrual
    const nonAdminAccrue = await makeRequest('POST', `${baseUrl}/api/v1/settlements/payables/accrue`, {
      Authorization: `Bearer ${supplierToken}`
    }, { order_id: paidOrderId });
    assert.strictEqual(nonAdminAccrue.status, 403);
    pass('RBAC: Non-admin caller blocked from direct payable accrual (403)');

    // 4. Valid Supplier Payable Accrual via Admin
    const accrueRes = await makeRequest('POST', `${baseUrl}/api/v1/settlements/payables/accrue`, {
      Authorization: `Bearer ${adminToken}`,
      'X-Idempotency-Key': `IDEM-PAYABLE-${Date.now()}`
    }, { order_id: paidOrderId });
    if (accrueRes.status !== 201) {
      console.error('accrueRes error body:', accrueRes.body);
    }
    assert.strictEqual(accrueRes.status, 201);
    assert.strictEqual(accrueRes.body.success, true);
    payableId = accrueRes.body.data.payable.id;

    // Verify exact math: gross 24330.00, delivery 500.00, commission 243.30 (1.0% BUSINESS tier), net 24586.70
    const payableData = accrueRes.body.data.payable;
    assert.strictEqual(Number(payableData.gross_amount), 24330.00);
    assert.strictEqual(Number(payableData.delivery_fee_amount), 500.00);
    assert.strictEqual(Number(payableData.commission_rate_percent), 1.00);
    assert.strictEqual(Number(payableData.commission_amount), 243.30);
    assert.strictEqual(Number(payableData.net_payable_amount), 24586.70);
    assert.strictEqual(Number(payableData.available_amount), 24586.70);
    assert.strictEqual(payableData.currency, 'PKR');
    pass('Exact Decimal Entitlement: Correctly computed net payable = PKR 24,586.70 (Gross 24,330 + Delivery 500 - Commission 243.30)');

    // 5. Idempotent accrual returns existing record without duplicating
    const replayAccrue = await makeRequest('POST', `${baseUrl}/api/v1/settlements/payables/accrue`, {
      Authorization: `Bearer ${adminToken}`
    }, { order_id: paidOrderId });
    assert.strictEqual(replayAccrue.status, 201);
    assert.strictEqual(replayAccrue.body.data.payable.id, payableId);
    pass('Idempotent Accrual: Repeated accrual returns existing record without duplication');

    // -------------------------------------------------------------------------
    // SECTION 3: Financial Holds & Governance
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Financial Holds & Release Governance ---');

    // 6. Non-admin blocked from placing financial hold
    const nonAdminHold = await makeRequest('POST', `${baseUrl}/api/v1/settlements/holds`, {
      Authorization: `Bearer ${supplierToken}`
    }, { order_id: paidOrderId, amount: 5000, reason: 'POLICY_VERIFICATION' });
    assert.strictEqual(nonAdminHold.status, 403);
    pass('RBAC: Non-admin caller blocked from placing financial hold (403)');

    // 7. Excessive hold amount rejected
    const excessHold = await makeRequest('POST', `${baseUrl}/api/v1/settlements/holds`, {
      Authorization: `Bearer ${adminToken}`
    }, { order_id: paidOrderId, amount: 999999, reason: 'POLICY_VERIFICATION' });
    assert.strictEqual(excessHold.status, 422);
    assert.strictEqual(excessHold.body.error.code, 'HOLD_EXCEEDS_PAYABLE_LIMIT');
    pass('Hold Limits: Hold exceeding net payable entitlement rejected (422 HOLD_EXCEEDS_PAYABLE_LIMIT)');

    // 8. Place valid financial hold of PKR 5,000.00
    const holdRes = await makeRequest('POST', `${baseUrl}/api/v1/settlements/holds`, {
      Authorization: `Bearer ${adminToken}`
    }, { order_id: paidOrderId, amount: 5000.00, reason: 'POLICY_VERIFICATION', notes: 'Routine audit freeze' });
    assert.strictEqual(holdRes.status, 201);
    holdId = holdRes.body.data.hold.id;
    assert.strictEqual(Number(holdRes.body.data.payable_held_amount), 5000.00);
    assert.strictEqual(Number(holdRes.body.data.payable_available_amount), 19586.70);
    pass('Financial Hold: Placed PKR 5,000.00 hold (Available balance updated to PKR 19,586.70)');

    // 9. Non-admin blocked from releasing hold
    const nonAdminRelease = await makeRequest('POST', `${baseUrl}/api/v1/settlements/holds/${holdId}/release`, {
      Authorization: `Bearer ${buyer1Token}`
    }, { notes: 'Buyer trying to release' });
    assert.strictEqual(nonAdminRelease.status, 403);
    pass('RBAC: Non-admin caller blocked from releasing financial hold (403)');

    // 10. Admin releases financial hold
    const releaseRes = await makeRequest('POST', `${baseUrl}/api/v1/settlements/holds/${holdId}/release`, {
      Authorization: `Bearer ${adminToken}`
    }, { notes: 'Verification completed satisfactorily' });
    assert.strictEqual(releaseRes.status, 200);
    assert.strictEqual(releaseRes.body.data.status, 'RELEASED');
    assert.strictEqual(Number(releaseRes.body.data.payable_held_amount), 0.00);
    assert.strictEqual(Number(releaseRes.body.data.payable_available_amount), 24586.70);
    pass('Financial Hold Release: Hold released cleanly (Available balance restored to PKR 24,586.70)');

    // -------------------------------------------------------------------------
    // SECTION 4: Refund Assessment & Invariants
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Refund Assessment & Boundaries ---');

    // 11. Unpaid order refund assessment rejected
    const unpaidRefund = await makeRequest('POST', `${baseUrl}/api/v1/settlements/refunds/assess`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEM-RFND-UNPAID-${Date.now()}`
    }, { order_id: unpaidOrderId, disputed_quantity: 5, refund_type: 'PARTIAL', reason: 'Unpaid order refund attempt' });
    assert.strictEqual(unpaidRefund.status, 404);
    pass('Refund Assessment: Unpaid order cannot be refunded (404 PAID_ORDER_NOT_FOUND)');

    // 12. Non-owner buyer blocked from assessing refund on peer order
    const peerRefund = await makeRequest('POST', `${baseUrl}/api/v1/settlements/refunds/assess`, {
      Authorization: `Bearer ${buyer2Token}`,
      'X-Idempotency-Key': `IDEM-RFND-PEER-${Date.now()}`
    }, { order_id: paidOrderId, disputed_quantity: 5, refund_type: 'PARTIAL', reason: 'Competitor buyer refund' });
    assert.strictEqual(peerRefund.status, 403);
    pass('RBAC: Non-owner buyer blocked from accessing peer order refund (403 FORBIDDEN)');

    // 13. Supplier strictly blocked from assessing/requesting refunds
    const supplierRefund = await makeRequest('POST', `${baseUrl}/api/v1/settlements/refunds/assess`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': `IDEM-RFND-SUPP-${Date.now()}`
    }, { order_id: paidOrderId, disputed_quantity: 5, refund_type: 'PARTIAL', reason: 'Supplier refund attempt' });
    assert.strictEqual(supplierRefund.status, 403);
    pass('RBAC: Supplier strictly blocked from assessing or requesting refunds (403)');

    // 14. Partial refund disputed quantity exceeding order quantity rejected
    const excessQtyRefund = await makeRequest('POST', `${baseUrl}/api/v1/settlements/refunds/assess`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEM-RFND-EXCESS-${Date.now()}`
    }, { order_id: paidOrderId, disputed_quantity: 999, refund_type: 'PARTIAL', reason: 'Excess quantity refund' });
    assert.strictEqual(excessQtyRefund.status, 422);
    assert.strictEqual(excessQtyRefund.body.error.code, 'QUANTITY_EXCEEDS_ORDER');
    pass('Claim Limits: Disputed quantity exceeding order total rejected (422 QUANTITY_EXCEEDS_ORDER)');

    // 15. Valid partial refund assessed (10 bags * 243.30 = 2433.00 PKR)
    const refundRes = await makeRequest('POST', `${baseUrl}/api/v1/settlements/refunds/assess`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEM-RFND-VALID-${Date.now()}`
    }, { order_id: paidOrderId, disputed_quantity: 10, refund_type: 'PARTIAL', reason: 'Damaged packaging on 10 bags' });
    assert.strictEqual(refundRes.status, 201);
    refundId = refundRes.body.data.refund.id;
    assert.strictEqual(Number(refundRes.body.data.refund.assessed_refund_amount), 2433.00);
    assert.strictEqual(Number(refundRes.body.data.refund.total_refund_amount), 2433.00);
    assert.strictEqual(refundRes.body.data.refund.status, 'REQUESTED');
    pass('Refund Assessment: Server calculated exact claim of PKR 2,433.00 (10 bags @ locked unit price 243.30)');

    // 16. Automatic financial hold created on supplier payable for the refund amount
    const [autoHold] = await db.query(
      `SELECT * FROM financial_holds WHERE order_id = ? AND hold_amount = 2433.00 AND status = 'ACTIVE'`,
      [paidOrderId]
    );
    assert.strictEqual(autoHold.length, 1);
    pass('Auto-Hold: Automatically placed PKR 2,433.00 financial hold on supplier payable');

    // -------------------------------------------------------------------------
    // SECTION 5: Refund Approval & Execution Boundaries
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Refund Approval & Execution Boundaries ---');

    // 17. Non-admin blocked from approving refund
    const nonAdminApprove = await makeRequest('POST', `${baseUrl}/api/v1/settlements/refunds/${refundId}/approve`, {
      Authorization: `Bearer ${buyer1Token}`
    }, { notes: 'Buyer attempting self-approval' });
    assert.strictEqual(nonAdminApprove.status, 403);
    pass('RBAC: Non-admin caller strictly blocked from approving refund (403)');

    // 18. Admin approves refund obligation
    const approveRefundRes = await makeRequest('POST', `${baseUrl}/api/v1/settlements/refunds/${refundId}/approve`, {
      Authorization: `Bearer ${adminToken}`
    }, { notes: 'Damaged packaging confirmed via photo evidence' });
    assert.strictEqual(approveRefundRes.status, 200);
    assert.strictEqual(approveRefundRes.body.data.refund.status, 'APPROVED');
    assert.strictEqual(approveRefundRes.body.data.refund.external_execution_status, 'DISABLED');
    pass('Refund Approval: Admin approved refund obligation; external execution strictly remains DISABLED');

    // 19. Payable balance reflects refund deduction
    const [updatedPayable] = await db.query(
      `SELECT * FROM supplier_payables WHERE id = ?`,
      [payableId]
    );
    assert.strictEqual(Number(updatedPayable[0].refund_deduction_amount), 2433.00);
    assert.strictEqual(Number(updatedPayable[0].available_amount), 22153.70); // 24586.70 - 2433.00
    pass('Payable Accounting: Deducted PKR 2,433.00 refund from supplier payable (Available balance: PKR 22,153.70)');

    // 20. Financial Invariant: Escrow status remains HELD_IN_ESCROW (zero premature provider execution)
    const [paymentCheck] = await db.query(`SELECT escrow_status FROM payments WHERE id = ?`, [paymentId]);
    assert.strictEqual(paymentCheck[0].escrow_status, 'HELD_IN_ESCROW');
    pass('Financial Invariant: Escrow status strictly remains HELD_IN_ESCROW on internal refund approval');

    // 21. Record manual confirmed external refund with external reference
    const confirmRefundRes = await makeRequest('POST', `${baseUrl}/api/v1/settlements/refunds/${refundId}/confirm-manual`, {
      Authorization: `Bearer ${adminToken}`
    }, { external_reference: 'sfpy_rfnd_ref_987234', notes: 'Processed via Safepay Dashboard' });
    assert.strictEqual(confirmRefundRes.status, 200);
    assert.strictEqual(confirmRefundRes.body.data.status, 'CONFIRMED');
    assert.strictEqual(confirmRefundRes.body.data.payment_status, 'PARTIALLY_REFUNDED');
    pass('Manual Refund Confirmation: Recorded verified external reference (Payment status updated to PARTIALLY_REFUNDED)');

    // -------------------------------------------------------------------------
    // SECTION 6: Supplier Disbursement Preparation & Approval
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 6: Supplier Disbursement Preparation & Boundaries ---');

    // 22. Beneficiary title validation: Too short rejected
    const badTitleDisb = await makeRequest('POST', `${baseUrl}/api/v1/settlements/disbursements/prepare`, {
      Authorization: `Bearer ${adminToken}`,
      'X-Idempotency-Key': `IDEM-DISB-BADT-${Date.now()}`
    }, { payable_id: payableId, beneficiary_title: 'AB', beneficiary_iban: 'PK36SCBL0000001123456701' });
    assert.strictEqual(badTitleDisb.status, 400);
    assert.strictEqual(badTitleDisb.body.error.code, 'INVALID_BENEFICIARY_TITLE');
    pass('Beneficiary Validation: Short title rejected (400 INVALID_BENEFICIARY_TITLE)');

    // 23. Beneficiary IBAN validation: Invalid format rejected
    const badIbanDisb = await makeRequest('POST', `${baseUrl}/api/v1/settlements/disbursements/prepare`, {
      Authorization: `Bearer ${adminToken}`,
      'X-Idempotency-Key': `IDEM-DISB-BADI-${Date.now()}`
    }, { payable_id: payableId, beneficiary_title: 'Punjab Agri Mills', beneficiary_iban: 'INVALID_IBAN_FORMAT' });
    assert.strictEqual(badIbanDisb.status, 400);
    assert.strictEqual(badIbanDisb.body.error.code, 'INVALID_IBAN');
    pass('Beneficiary Validation: Invalid IBAN rejected (400 INVALID_IBAN)');

    // 24. Disbursement blocked if active financial holds exist
    // Place a temporary hold
    const [tempHoldRes] = await db.query(
      `INSERT INTO financial_holds (
        hold_code, order_id, supplier_payable_id, hold_amount, currency,
        reason, status, placed_by_role, placed_by_id, created_at
      ) VALUES ('TEMP-HOLD-1', ?, ?, 1000.00, 'PKR', 'ACTIVE_DISPUTE', 'ACTIVE', 'ADMIN', 1, NOW())`,
      [paidOrderId, payableId]
    );
    await db.query(`UPDATE supplier_payables SET held_amount = 1000.00 WHERE id = ?`, [payableId]);

    const holdBlockDisb = await makeRequest('POST', `${baseUrl}/api/v1/settlements/disbursements/prepare`, {
      Authorization: `Bearer ${adminToken}`,
      'X-Idempotency-Key': `IDEM-DISB-HOLD-${Date.now()}`
    }, { payable_id: payableId, beneficiary_title: 'Punjab Agri Mills', beneficiary_iban: 'PK36SCBL0000001123456701' });
    assert.strictEqual(holdBlockDisb.status, 422);
    assert.strictEqual(holdBlockDisb.body.error.code, 'PAYABLE_HAS_ACTIVE_HOLDS');
    pass('Financial Hold Guard: Disbursement blocked while active holds exist (422 PAYABLE_HAS_ACTIVE_HOLDS)');

    // Release temporary hold
    await db.query(`DELETE FROM financial_holds WHERE id = ?`, [tempHoldRes.insertId]);
    await db.query(`UPDATE supplier_payables SET held_amount = 0.00 WHERE id = ?`, [payableId]);

    // 25. Valid Disbursement Prepared
    const validDisbRes = await makeRequest('POST', `${baseUrl}/api/v1/settlements/disbursements/prepare`, {
      Authorization: `Bearer ${adminToken}`,
      'X-Idempotency-Key': `IDEM-DISB-VAL-${Date.now()}`
    }, {
      payable_id: payableId,
      beneficiary_title: 'Punjab Agri Mills Pvt Ltd',
      beneficiary_iban: 'PK36SCBL0000001123456701',
      beneficiary_bank_code: 'SCBL'
    });
    assert.strictEqual(validDisbRes.status, 201);
    disbursementId = validDisbRes.body.data.disbursement.id;
    assert.strictEqual(Number(validDisbRes.body.data.disbursement.amount), 22153.70);
    assert.strictEqual(validDisbRes.body.data.disbursement.status, 'PREPARED');
    assert.strictEqual(validDisbRes.body.data.disbursement.external_execution_status, 'DISABLED');
    pass('Disbursement Preparation: Instruction prepared for PKR 22,153.70 (External execution strictly DISABLED)');

    // 26. Non-admin blocked from approving disbursement
    const nonAdminDisbApprove = await makeRequest('POST', `${baseUrl}/api/v1/settlements/disbursements/${disbursementId}/approve`, {
      Authorization: `Bearer ${supplierToken}`
    }, { notes: 'Supplier attempting self-approval' });
    assert.strictEqual(nonAdminDisbApprove.status, 403);
    pass('RBAC: Supplier strictly blocked from approving disbursement instruction (403)');

    // 27. Admin approves disbursement instruction
    const approveDisbRes = await makeRequest('POST', `${baseUrl}/api/v1/settlements/disbursements/${disbursementId}/approve`, {
      Authorization: `Bearer ${adminToken}`
    }, { notes: 'Beneficiary title & IBAN verified' });
    assert.strictEqual(approveDisbRes.status, 200);
    assert.strictEqual(approveDisbRes.body.data.disbursement.status, 'APPROVED');
    assert.strictEqual(approveDisbRes.body.data.disbursement.external_execution_status, 'DISABLED');
    pass('Disbursement Approval: Instruction marked APPROVED; external execution remains strictly DISABLED');

    // -------------------------------------------------------------------------
    // SECTION 7: Provider Settlement Batch Reconciliation
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 7: Provider Settlement Reconciliation ---');

    // 28. Non-admin blocked from reconciling settlement batch
    const nonAdminRecon = await makeRequest('POST', `${baseUrl}/api/v1/settlements/batches/reconcile`, {
      Authorization: `Bearer ${supplierToken}`
    }, { batch_reference: batchRef, gross_amount: 25080.00, net_amount: 25080.00 });
    assert.strictEqual(nonAdminRecon.status, 403);
    pass('RBAC: Non-admin caller blocked from reconciling settlement batch (403)');

    // 29. Batch with arithmetic mismatch flagged with MISMATCH_DETECTED
    const mismatchBatchRef = `sb_bad_${Date.now()}`;
    const mismatchRes = await makeRequest('POST', `${baseUrl}/api/v1/settlements/batches/reconcile`, {
      Authorization: `Bearer ${adminToken}`
    }, {
      batch_reference: mismatchBatchRef,
      gross_amount: 25080.00,
      provider_fee: 500.00,
      net_amount: 20000.00 // Intentionally incorrect: 25080 - 500 != 20000
    });
    assert.strictEqual(mismatchRes.status, 200);
    assert.strictEqual(mismatchRes.body.data.batch.status, 'MISMATCH_DETECTED');
    pass('Reconciliation Mismatch Guard: Flagged status MISMATCH_DETECTED on arithmetic discrepancy');

    // 30. Valid Batch Reconciled
    const validBatchRes = await makeRequest('POST', `${baseUrl}/api/v1/settlements/batches/reconcile`, {
      Authorization: `Bearer ${adminToken}`
    }, {
      batch_reference: batchRef,
      gross_amount: 25080.00,
      provider_fee: 627.00, // 2.5% provider fee
      net_amount: 24453.00, // 25080 - 627
      matched_tracker_tokens: [trackerToken],
      raw_metadata: { safepay_payout_id: 'po_test_12345' }
    });
    assert.strictEqual(validBatchRes.status, 200);
    assert.strictEqual(validBatchRes.body.data.batch.status, 'RECONCILED');
    assert.strictEqual(validBatchRes.body.data.matched_payments_count, 1);
    pass('Reconciliation: Settlement batch reconciled with matched Safepay tracker token');

    // -------------------------------------------------------------------------
    // SECTION 8: Read Models & Audit Trails
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 8: Read Models & Audit Trails ---');

    // 31. Buyer views own refunds
    const buyerRefundsRes = await makeRequest('GET', `${baseUrl}/api/v1/settlements/refunds/my`, {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(buyerRefundsRes.status, 200);
    assert.ok(buyerRefundsRes.body.data.refunds.length >= 1);
    pass('Read Model: Buyer views own scoped refund obligations');

    // 32. Competitor buyer views empty list (tenant isolation)
    const buyer2RefundsRes = await makeRequest('GET', `${baseUrl}/api/v1/settlements/refunds/my`, {
      Authorization: `Bearer ${buyer2Token}`
    });
    assert.strictEqual(buyer2RefundsRes.status, 200);
    assert.strictEqual(buyer2RefundsRes.body.data.refunds.length, 0);
    pass('Tenant Isolation: Competitor buyer views 0 refunds from peer order');

    // 33. Supplier views own payables
    const suppPayablesRes = await makeRequest('GET', `${baseUrl}/api/v1/settlements/payables/supplier`, {
      Authorization: `Bearer ${supplierToken}`
    });
    assert.strictEqual(suppPayablesRes.status, 200);
    assert.ok(suppPayablesRes.body.data.payables.length >= 1);
    pass('Read Model: Supplier views own payables and balances');

    // 34. Competitor supplier views empty list (tenant isolation)
    const compPayablesRes = await makeRequest('GET', `${baseUrl}/api/v1/settlements/payables/supplier`, {
      Authorization: `Bearer ${competitorSupplierToken}`
    });
    assert.strictEqual(compPayablesRes.status, 200);
    assert.strictEqual(compPayablesRes.body.data.payables.length, 0);
    pass('Tenant Isolation: Competitor supplier views 0 payables from peer order');

    // 35. Admin financial overview
    const adminOverviewRes = await makeRequest('GET', `${baseUrl}/api/v1/settlements/admin/overview?order_id=${paidOrderId}`, {
      Authorization: `Bearer ${adminToken}`
    });
    if (adminOverviewRes.status !== 200) {
      console.error('adminOverviewRes error body:', adminOverviewRes.body);
    }
    assert.strictEqual(adminOverviewRes.status, 200);
    assert.ok(adminOverviewRes.body.data.payables.length >= 1);
    assert.ok(adminOverviewRes.body.data.refunds.length >= 1);
    assert.ok(adminOverviewRes.body.data.disbursements.length >= 1);
    pass('Admin Read Model: Admin overview aggregates payables, holds, refunds, and disbursements');

    // 36. Immutable financial audit trail
    const auditRes = await makeRequest('GET', `${baseUrl}/api/v1/settlements/audit-trail?order_id=${paidOrderId}`, {
      Authorization: `Bearer ${adminToken}`
    });
    assert.strictEqual(auditRes.status, 200);
    assert.ok(auditRes.body.data.events.length >= 4);
    pass(`Audit Integrity: Immutable financial audit trail preserved (${auditRes.body.data.events.length} events logged)`);

    // -------------------------------------------------------------------------
    // SECTION 9: Database Isolation & Baseline Preservation
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 9: Database Isolation & Baseline Preservation ---');

    // 37. Development database isolation: miljor_db remains 100% PRISTINE
    const [devPayables] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.supplier_payables');
    const [devHolds] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.financial_holds');
    const [devRefunds] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.refund_obligations');
    const [devDisbursements] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.supplier_disbursement_instructions');
    assert.strictEqual(Number(devPayables[0].c), 0);
    assert.strictEqual(Number(devHolds[0].c), 0);
    assert.strictEqual(Number(devRefunds[0].c), 0);
    assert.strictEqual(Number(devDisbursements[0].c), 0);
    pass('Database Isolation: Development database miljor_db remains 100% PRISTINE (0 payables, 0 holds, 0 refunds, 0 disbursements)');

    // 38. Persistent sandbox database intact
    const [sbTables] = await db.query('SHOW TABLES FROM miljor_sandbox_db');
    assert.ok(sbTables.length >= 37, 'Persistent sandbox database must retain all schema tables');
    pass(`Database Preservation: Persistent sandbox database miljor_sandbox_db intact (${sbTables.length} tables)`);

  } catch (err) {
    console.error('❌ Exception in test body:', err);
    throw err;
  } finally {
    // Teardown
    if (testServer) {
      try {
        await new Promise((resolve) => testServer.close(resolve));
      } catch (e) {}
    }

    console.log('\nCleaning up test fixtures from miljor_test_db...');
    try {
      const orderIds = [paidOrderId || 0, unpaidOrderId || 0];
      await db.query('DELETE FROM financial_audit_events WHERE order_id IN (?, ?)', orderIds);
      await db.query('DELETE FROM provider_settlement_batches WHERE batch_reference IN (?, ?)', [batchRef, `sb_bad_${batchRef}`]);
      await db.query('DELETE FROM supplier_disbursement_instructions WHERE order_id IN (?, ?)', orderIds);
      await db.query('DELETE FROM refund_obligations WHERE order_id IN (?, ?)', orderIds);
      await db.query('DELETE FROM financial_holds WHERE order_id IN (?, ?)', orderIds);
      await db.query('DELETE FROM supplier_payables WHERE order_id IN (?, ?)', orderIds);
      await db.query('DELETE FROM payments WHERE order_id IN (?, ?)', orderIds);
      await db.query('DELETE FROM orders WHERE id IN (?, ?)', orderIds);
      if (poolId) {
        await db.query('DELETE FROM pool_commercial_snapshots WHERE id = ?', [snapshotId || 0]);
        await db.query('DELETE FROM pools WHERE id = ?', [poolId]);
      }
    } catch (cleanupErr) {
      console.error('Warning: cleanup failed:', cleanupErr.message);
    }

    await db.end();
  }

  console.log('\n================================================================================');
  console.log(`Part 4E.6 Financial Foundation Gate: ${passedAssertions} / 38 assertions passed`);
  console.log('Status: PASS');
  console.log('================================================================================\n');
}

if (require.main === module) {
  runFinancialFoundationGate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ Gate Execution Failed:', err);
      process.exit(1);
    });
}

module.exports = { runFinancialFoundationGate };
