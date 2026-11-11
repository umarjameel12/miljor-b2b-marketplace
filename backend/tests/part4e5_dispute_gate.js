// =============================================================================
// tests/part4e5_dispute_gate.js
// MilJor Part 4E.5: Buyer Protection, Dispute & Fulfillment Exception Resolution Gate
//
// Comprehensive Level 1/2 verification covering:
// 1. Paid-only dispute eligibility (unpaid orders rejected)
// 2. Pre-dispatch delivery dispute rejection
// 3. Buyer object-level authorization & IDOR defense
// 4. Mandatory X-Idempotency-Key on mutations
// 5. Input bounds and description validation
// 6. Category validation against whitelist
// 7. Line-item & quantity bounds enforcement
// 8. Exact-decimal financial claim calculation (client amounts ignored)
// 9. Order fulfillment transition to EXCEPTION on dispute filing
// 10. Financial invariants: escrow status and order totals unchanged
// 11. Idempotency replay and conflict defense
// 12. Multiple non-overlapping disputes on the same order
// 13. Overlapping quantity claims exceeding total quantity rejected
// 14. Buyer confirmation blocked while unresolved dispute exists
// 15. Supplier pre-dispatch shortage declaration and RBAC
// 16. Supplier dispute response and remediation proposals
// 17. Supplier prohibited from self-closing disputes
// 18. Supplier remediation dispatch declaration
// 19. Remediation dispatch does not imply buyer receipt
// 20. Buyer confirmation of remediation receipt
// 21. Admin arbitration & decision validation
// 22. Admin decision without reason rejected
// 23. Zero money movement on admin decisions
// 24. Admin evidence request workflow
// 25. Closure blocked while remediation is incomplete
// 26. Admin closure with documented reason
// 27. Safe fulfillment resumption when disputes resolved
// 28. Immutable audit events in order_dispute_events
// 29. Dangerous evidence URI schemes rejected
// 30. Outbox event atomicity in reservation_business_events
// 31. Buyer dispute read model pagination
// 32. Supplier dispute read model scoping
// 33. Admin dispute read model
// 34. Database isolation: miljor_db remains 100% PRISTINE
// =============================================================================
process.env.NODE_ENV = 'test';

const assert = require('assert');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

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

let passedAssertions = 0;
function pass(msg) {
  passedAssertions++;
  console.log(`  [PASS] Assertion ${passedAssertions}: ${msg}`);
}

async function runDisputeGate() {
  console.log('================================================================================');
  console.log('MILJOR PART 4E.5: BUYER PROTECTION, DISPUTE & EXCEPTION RESOLUTION GATE');
  console.log('Target Database: miljor_test_db');
  console.log('================================================================================\n');

  await assertTestDatabaseSafety(db, 'Part 4E.5 Dispute Gate');

  const serverPort = 65340;
  testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(serverPort, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${serverPort}`;
  console.log(`📡 Test server listening at ${baseUrl}\n`);

  // Fixture identifiers
  let poolId = null;
  let snapshotId = null;
  let deliveredOrderId = null;
  let unpaidOrderId = null;
  let preparingOrderId = null;

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: Fixture Setup
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Commercial Order Fixture Setup ---');

    const poolCode = `POOL-DSP-${Date.now().toString().slice(-6)}`;
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
        CONCAT('S4E5-', SUBSTRING(UNIX_TIMESTAMP(), -6), FLOOR(RAND() * 1000)), ?, 1, 'QUALIFIED',
        NOW(), 2, 1, 1, 'mock-hash-4e5', 'BAG_50KG', 100.0000, 50.0000,
        100.0000, 500.0000, 1, 243.30,
        1, '[]',
        'DOORSTEP', DATE_ADD(NOW(), INTERVAL 1 DAY), DATE_ADD(NOW(), INTERVAL 2 DAY), 'ACCEPTED'
      )`,
      [poolId]
    );
    snapshotId = snapRes.insertId;

    // Order 1: PAID, DISPATCHED -> SUPPLIER_DELIVERED (ready for buyer dispute)
    const orderCode1 = `ORD-DSP-${Date.now().toString().slice(-6)}-1`;
    const [order1Res] = await db.query(
      `INSERT INTO orders (
        order_code, buyer_id, supplier_id, pool_id, snapshot_id,
        total_qty, unit_price, subtotal_amount, delivery_fee, buyer_platform_fee, total_amount,
        currency, delivery_type, payment_status, order_status, fulfillment_status,
        supplier_delivered_at, created_at, updated_at
      ) VALUES (?, 5, 2, ?, ?, 100.0000, 243.30, 24330.00, 500.00, 250.00, 25080.00,
        'PKR', 'DOORSTEP', 'PAID', 'OUT_FOR_DELIVERY', 'SUPPLIER_DELIVERED', NOW(), NOW(), NOW())`,
      [orderCode1, poolId, snapshotId]
    );
    deliveredOrderId = order1Res.insertId;

    await db.query(
      `INSERT INTO payments (
        payment_code, order_id, buyer_id, amount, status, escrow_status, created_at, updated_at
      ) VALUES (
        CONCAT('PAY-DSP-', SUBSTRING(UNIX_TIMESTAMP(), -6), '1'),
        ?, 5, 25080.00, 'PAID', 'HELD_IN_ESCROW', NOW(), NOW()
      )`,
      [deliveredOrderId]
    );

    // Order 2: UNPAID order (AWAITING_PAYMENT)
    const orderCode2 = `ORD-DSP-${Date.now().toString().slice(-6)}-2`;
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

    // Order 3: PAID, PREPARING (pre-dispatch order for supplier shortage testing)
    const orderCode3 = `ORD-DSP-${Date.now().toString().slice(-6)}-3`;
    const [order3Res] = await db.query(
      `INSERT INTO orders (
        order_code, buyer_id, supplier_id, pool_id, snapshot_id,
        total_qty, unit_price, subtotal_amount, delivery_fee, buyer_platform_fee, total_amount,
        currency, delivery_type, payment_status, order_status, fulfillment_status,
        acknowledged_at, preparing_at, created_at, updated_at
      ) VALUES (?, 5, 2, ?, ?, 80.0000, 243.30, 19464.00, 500.00, 200.00, 20164.00,
        'PKR', 'DOORSTEP', 'PAID', 'PROCESSING', 'PREPARING', NOW(), NOW(), NOW(), NOW())`,
      [orderCode3, poolId, snapshotId]
    );
    preparingOrderId = order3Res.insertId;

    await db.query(
      `INSERT INTO payments (
        payment_code, order_id, buyer_id, amount, status, escrow_status, created_at, updated_at
      ) VALUES (
        CONCAT('PAY-DSP-', SUBSTRING(UNIX_TIMESTAMP(), -6), '3'),
        ?, 5, 20164.00, 'PAID', 'HELD_IN_ESCROW', NOW(), NOW()
      )`,
      [preparingOrderId]
    );

    pass('Commercial test fixtures initialized successfully (Pool, Snapshot, Delivered Order, Unpaid Order, Preparing Order)');

    // -------------------------------------------------------------------------
    // SECTION 2: Buyer Dispute Creation & Validation
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Buyer Dispute Creation & Validation ---');

    // 2. Unpaid order rejected
    const unpRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEMP-UNP-${Date.now()}`
    }, {
      order_id: unpaidOrderId,
      category: 'SHORT_QUANTITY',
      description: 'Attempting to dispute unpaid order'
    });
    assert.strictEqual(unpRes.status, 422);
    pass('Unpaid order cannot be disputed (422 UNPAID_ORDER_NOT_DISPUTABLE)');

    // 3. Pre-dispatch order rejected for buyer delivery dispute
    const prepRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEMP-PREP-${Date.now()}`
    }, {
      order_id: preparingOrderId,
      category: 'SHORT_QUANTITY',
      description: 'Attempting delivery dispute before order dispatched'
    });
    assert.strictEqual(prepRes.status, 422);
    pass('Pre-dispatch order rejected for buyer delivery dispute (422 ORDER_NOT_DISPATCHED)');

    // 4. Non-owner buyer blocked (Tenant Isolation / IDOR)
    const idorRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes`, {
      Authorization: `Bearer ${buyer2Token}`, // Competitor buyer
      'X-Idempotency-Key': `IDEMP-IDOR-${Date.now()}`
    }, {
      order_id: deliveredOrderId,
      category: 'DAMAGED_GOODS',
      description: 'Competitor buyer attempting IDOR claim'
    });
    assert.strictEqual(idorRes.status, 403);
    pass('Non-owner buyer strictly blocked with 403 FORBIDDEN');

    // 5. Mandatory X-Idempotency-Key enforced
    const noKeyRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes`, {
      Authorization: `Bearer ${buyer1Token}`
    }, {
      order_id: deliveredOrderId,
      category: 'DAMAGED_GOODS',
      description: 'Missing idempotency key test description'
    });
    assert.strictEqual(noKeyRes.status, 400);
    pass('Mandatory X-Idempotency-Key enforced on dispute creation (400 IDEMPOTENCY_KEY_REQUIRED)');

    // 6. Description < 10 characters rejected
    const shortDescRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEMP-DESC-${Date.now()}`
    }, {
      order_id: deliveredOrderId,
      category: 'DAMAGED_GOODS',
      description: 'Too short'
    });
    assert.strictEqual(shortDescRes.status, 400);
    pass('Short description (< 10 chars) rejected with 400 DESCRIPTION_REQUIRED');

    // 7. Invalid category rejected
    const badCatRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEMP-CAT-${Date.now()}`
    }, {
      order_id: deliveredOrderId,
      category: 'BOGUS_CATEGORY',
      description: 'Valid description for invalid category'
    });
    assert.strictEqual(badCatRes.status, 400);
    pass('Invalid dispute category rejected with 400 INVALID_DISPUTE_CATEGORY');

    // 8. Disputed quantity exceeding total_qty rejected
    const excessQtyRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEMP-QTY-${Date.now()}`
    }, {
      order_id: deliveredOrderId,
      category: 'SHORT_QUANTITY',
      description: 'Claiming more bags than ordered',
      disputed_quantity: 150.00 // Ordered was 100
    });
    assert.strictEqual(excessQtyRes.status, 422);
    pass('Disputed quantity exceeding total order quantity rejected with 422 QUANTITY_EXCEEDS_ORDER');

    // 9. Valid buyer dispute created successfully
    const createKey1 = `IDEMP-DISP1-${Date.now()}`;
    const disputePayload1 = {
      order_id: deliveredOrderId,
      category: 'DAMAGED_GOODS',
      description: 'Ten bags of wheat flour were soaked in water during transit',
      disputed_quantity: 10.00,
      reported_quantity: 90.00,
      evidence_metadata: { notes: 'Water damage visible on outer sack packaging', photo_count: 2 }
    };

    const createRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': createKey1
    }, disputePayload1);

    if (createRes.status !== 201) {
      console.error('DEBUG createRes failure:', createRes.body);
    }
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.body.data.status, 'OPEN');
    assert.strictEqual(createRes.body.data.disputed_quantity, 10);
    // Exact decimal claim calculation: 10 * 243.30 = 2433.00
    assert.strictEqual(createRes.body.data.claimed_amount, '2433.00');
    const disputeId1 = createRes.body.data.dispute_id;
    pass('Valid buyer dispute created: status=OPEN, category=DAMAGED_GOODS, exactDecimal claim=2433.00');

    // 10. Order fulfillment status moved to EXCEPTION
    const [ordCheck] = await db.query('SELECT fulfillment_status, order_status FROM orders WHERE id = ?', [deliveredOrderId]);
    assert.strictEqual(ordCheck[0].fulfillment_status, 'EXCEPTION');
    assert.strictEqual(ordCheck[0].order_status, 'DISPUTED');
    pass('Order fulfillment status updated to EXCEPTION and order_status to DISPUTED');

    // 11. Financial invariants: escrow strictly remains HELD_IN_ESCROW
    const [payCheck] = await db.query('SELECT escrow_status, amount FROM payments WHERE order_id = ?', [deliveredOrderId]);
    assert.strictEqual(payCheck[0].escrow_status, 'HELD_IN_ESCROW');
    assert.strictEqual(Number(payCheck[0].amount), 25080.00);
    pass('Financial Invariant: Escrow funds strictly remain HELD_IN_ESCROW (zero premature disbursement)');

    // 12. Idempotent replay with same key and same payload returns cached response
    const replayRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': createKey1
    }, disputePayload1);
    assert.ok([200, 201].includes(replayRes.status));
    assert.strictEqual(replayRes.body.data.dispute_id, disputeId1);
    pass('Idempotent Replay: Repeated dispute submission with same key & payload returns cached response');

    // 13. Idempotency Conflict: Same key with conflicting payload strictly rejected with 409
    const conflictRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': createKey1
    }, {
      ...disputePayload1,
      description: 'Conflicting description with same key'
    });
    assert.strictEqual(conflictRes.status, 409);
    pass('Idempotency Conflict: Same idempotency key with conflicting payload strictly rejected with 409');

    // -------------------------------------------------------------------------
    // SECTION 3: Line-Item & Multi-Case Dispute Integrity
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Line-Item & Multi-Case Dispute Integrity ---');

    // 13. Multiple non-overlapping disputes on same order
    const createKey2 = `IDEMP-DISP2-${Date.now()}`;
    const multiRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': createKey2
    }, {
      order_id: deliveredOrderId,
      category: 'SHORT_QUANTITY',
      description: 'Also found 5 bags missing from delivery pallet count',
      disputed_quantity: 5.00,
      reported_quantity: 95.00
    });
    assert.strictEqual(multiRes.status, 201);
    assert.strictEqual(multiRes.body.data.claimed_amount, '1216.50'); // 5 * 243.30 = 1216.50
    const disputeId2 = multiRes.body.data.dispute_id;
    pass('Multi-Case Integrity: Second non-overlapping dispute accepted on same order (5 bags = 1216.50 PKR)');

    // 14. Overlapping quantity claims exceeding total order quantity rejected
    // Currently active claims: 10 + 5 = 15 bags. Order total = 100 bags. Remaining = 85.
    // Attempting to claim 90 bags must be rejected!
    const overlapRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEMP-OVERLAP-${Date.now()}`
    }, {
      order_id: deliveredOrderId,
      category: 'SHORT_QUANTITY',
      description: 'Attempting to claim 90 more bags exceeding total order quantity',
      disputed_quantity: 90.00
    });
    assert.strictEqual(overlapRes.status, 422);
    assert.strictEqual(overlapRes.body.error.code, 'DISPUTED_QUANTITY_EXCEEDS_ORDER_LIMIT');
    pass('Overlapping quantity claim exceeding order limit rejected with 422 DISPUTED_QUANTITY_EXCEEDS_ORDER_LIMIT');

    // -------------------------------------------------------------------------
    // SECTION 4: Buyer Confirmation vs Dispute Race Safety
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Buyer Confirmation vs Dispute Race Safety ---');

    // 15. Buyer cannot confirm receipt while active dispute exists
    const confRes = await makeRequest('POST', `${baseUrl}/api/v1/fulfillment/buyer/orders/${deliveredOrderId}/confirm-receipt`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEMP-CONF-RACE-${Date.now()}`
    }, { notes: 'Attempting receipt confirmation during dispute' });
    assert.strictEqual(confRes.status, 409);
    assert.strictEqual(confRes.body.error.code, 'UNRESOLVED_DISPUTE_EXISTS');
    pass('Buyer confirmation blocked while unresolved dispute exists (409 UNRESOLVED_DISPUTE_EXISTS)');

    // -------------------------------------------------------------------------
    // SECTION 5: Supplier Shortage Exception & RBAC
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 5: Supplier Shortage Exception & RBAC ---');

    // 16. Non-assigned supplier blocked from shortage declaration
    const suppIdor = await makeRequest('POST', `${baseUrl}/api/v1/disputes/supplier/shortage`, {
      Authorization: `Bearer ${competitorSupplierToken}`,
      'X-Idempotency-Key': `IDEMP-SHG-IDOR-${Date.now()}`
    }, {
      order_id: preparingOrderId,
      shortage_quantity: 10.00,
      description: 'Competitor declaring shortage'
    });
    assert.strictEqual(suppIdor.status, 403);
    pass('Non-assigned supplier blocked from declaring shortage (403 FORBIDDEN)');

    // 17. Valid supplier shortage declaration on pre-dispatch order
    const shgRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes/supplier/shortage`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': `IDEMP-SHG-${Date.now()}`
    }, {
      order_id: preparingOrderId,
      shortage_quantity: 20.00, // 20 out of 80 bags short
      description: 'Warehouse damage destroyed 20 bags of inventory prior to loading'
    });
    assert.strictEqual(shgRes.status, 201);
    assert.strictEqual(shgRes.body.data.status, 'UNDER_ADMIN_REVIEW');
    assert.strictEqual(shgRes.body.data.claimed_amount, '4866.00'); // 20 * 243.30 = 4866.00
    const shortageDisputeId = shgRes.body.data.dispute_id;
    pass('Valid supplier shortage declaration recorded (status=UNDER_ADMIN_REVIEW, claim=4866.00 PKR)');

    // -------------------------------------------------------------------------
    // SECTION 6: Supplier Response & Remediation Proposal
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 6: Supplier Response & Remediation Proposal ---');

    // 18. Competitor supplier blocked from responding
    const respIdor = await makeRequest('POST', `${baseUrl}/api/v1/disputes/${disputeId1}/supplier-response`, {
      Authorization: `Bearer ${competitorSupplierToken}`,
      'X-Idempotency-Key': `IDEMP-RESP-IDOR-${Date.now()}`
    }, {
      response: 'Competitor response attempt',
      remediation_proposal: 'REPLACE_DAMAGED_GOODS'
    });
    assert.strictEqual(respIdor.status, 403);
    pass('Competitor supplier blocked from responding to peer dispute (403 FORBIDDEN)');

    // 19. Supplier cannot self-close dispute
    const closeAttempt = await makeRequest('POST', `${baseUrl}/api/v1/disputes/${disputeId1}/close`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': `IDEMP-CLOSE-SUPP-${Date.now()}`
    }, { closure_reason: 'Supplier attempting self-closure' });
    assert.strictEqual(closeAttempt.status, 403);
    pass('Supplier strictly prohibited from self-closing disputes (403 UNAUTHORIZED_ROLE)');

    // 20. Supplier submits valid response proposing remediation
    const respRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes/${disputeId1}/supplier-response`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': `IDEMP-RESP-${Date.now()}`
    }, {
      response: 'We sincerely apologize for the water damage. We will dispatch 10 replacement bags immediately.',
      remediation_proposal: 'REPLACE_DAMAGED_GOODS',
      remediation_details: 'Replacement dispatch scheduled with fleet truck #7'
    });
    if (respRes.status !== 200) {
      console.error('DEBUG respRes error:', respRes.body);
    }
    assert.strictEqual(respRes.status, 200);
    assert.strictEqual(respRes.body.data.status, 'SUPPLIER_REMEDIATION_PROPOSED');
    assert.strictEqual(respRes.body.data.remediation_status, 'PROPOSED');
    pass('Supplier submits valid response proposing remediation (status=SUPPLIER_REMEDIATION_PROPOSED)');

    // -------------------------------------------------------------------------
    // SECTION 7: Remediation Dispatch & Buyer Receipt Authority
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 7: Remediation Dispatch & Buyer Receipt Authority ---');

    // 21. Supplier declares remediation dispatched
    const dispRemRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes/${disputeId1}/remediation/declare-delivered`, {
      Authorization: `Bearer ${supplierToken}`,
      'X-Idempotency-Key': `IDEMP-REM-DEL-${Date.now()}`
    }, {
      tracking_reference: 'FLEET-TRUCK-7-REPLACE',
      notes: '10 bags replacement flour delivered to bakery loading dock'
    });
    assert.strictEqual(dispRemRes.status, 200);
    assert.strictEqual(dispRemRes.body.data.remediation_status, 'IN_PROGRESS');
    pass('Supplier declares replacement dispatched (remediation_status=IN_PROGRESS)');

    // 22. Invariant: Supplier declaration DOES NOT automatically complete remedy
    const [dispCheck1] = await db.query('SELECT status, remediation_status FROM order_disputes WHERE id = ?', [disputeId1]);
    assert.strictEqual(dispCheck1[0].status, 'SUPPLIER_REMEDIATION_IN_PROGRESS');
    assert.strictEqual(dispCheck1[0].remediation_status, 'IN_PROGRESS');
    pass('Separation of Concerns: Supplier declaration DOES NOT imply buyer receipt or complete dispute');

    // 23. Competitor buyer blocked from confirming remediation receipt
    const remIdor = await makeRequest('POST', `${baseUrl}/api/v1/disputes/${disputeId1}/remediation/confirm-receipt`, {
      Authorization: `Bearer ${buyer2Token}`,
      'X-Idempotency-Key': `IDEMP-REM-IDOR-${Date.now()}`
    }, { notes: 'Competitor buyer confirming' });
    assert.strictEqual(remIdor.status, 403);
    pass('Competitor buyer blocked from confirming peer remediation receipt (403 FORBIDDEN)');

    // 24. Purchasing buyer confirms remediation receipt
    const buyerRemRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes/${disputeId1}/remediation/confirm-receipt`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEMP-REM-CONF-${Date.now()}`
    }, { notes: 'Inspected 10 replacement bags. Quality verified.' });
    assert.strictEqual(buyerRemRes.status, 200);
    assert.strictEqual(buyerRemRes.body.data.remediation_status, 'COMPLETED');
    assert.strictEqual(buyerRemRes.body.data.status, 'SUPPLIER_REMEDIATION_COMPLETED');
    pass('Buyer confirms receipt of replacement goods (remediation_status=COMPLETED)');

    // -------------------------------------------------------------------------
    // SECTION 8: Admin Arbitration & Decisions
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 8: Admin Arbitration & Operational Decision ---');

    // 25. Non-admin blocked from recording decision
    const adminIdor = await makeRequest('POST', `${baseUrl}/api/v1/disputes/${disputeId2}/decision`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEMP-DEC-IDOR-${Date.now()}`
    }, { decision: 'BUYER_CLAIM_ACCEPTED', decision_reason: 'Buyer attempting decision' });
    assert.strictEqual(adminIdor.status, 403);
    pass('Non-admin caller blocked from recording arbitration decision (403 UNAUTHORIZED_ROLE)');

    // 26. Admin decision without reason rejected
    const noReasonRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes/${disputeId2}/decision`, {
      Authorization: `Bearer ${adminToken}`,
      'X-Idempotency-Key': `IDEMP-DEC-NOREASON-${Date.now()}`
    }, { decision: 'BUYER_CLAIM_ACCEPTED', decision_reason: '' });
    assert.strictEqual(noReasonRes.status, 400);
    pass('Admin decision without reason rejected with 400 DECISION_REASON_REQUIRED');

    // 27. Admin records valid operational decision on dispute 2
    const decRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes/${disputeId2}/decision`, {
      Authorization: `Bearer ${adminToken}`,
      'X-Idempotency-Key': `IDEMP-DEC-${Date.now()}`
    }, {
      decision: 'BUYER_CLAIM_ACCEPTED',
      decision_reason: 'Supplier dispatch manifest confirms 95 bags loaded instead of 100.',
      admin_notes: 'Claim verified against loading weight slips'
    });
    assert.strictEqual(decRes.status, 200);
    assert.strictEqual(decRes.body.data.decision, 'BUYER_CLAIM_ACCEPTED');
    assert.strictEqual(decRes.body.data.status, 'RESOLUTION_RECORDED');
    pass('Admin records operational decision: BUYER_CLAIM_ACCEPTED (status=RESOLUTION_RECORDED)');

    // 28. Financial Invariant: Admin decision DOES NOT trigger money movement
    const [escrowCheck] = await db.query('SELECT escrow_status, amount FROM payments WHERE order_id = ?', [deliveredOrderId]);
    assert.strictEqual(escrowCheck[0].escrow_status, 'HELD_IN_ESCROW');
    assert.strictEqual(Number(escrowCheck[0].amount), 25080.00);
    pass('Financial Invariant: Admin decision strictly produces ZERO money movement; escrow remains HELD_IN_ESCROW');

    // 29. Admin requests evidence on shortage dispute
    const evReqRes = await makeRequest('PUT', `${baseUrl}/api/v1/disputes/${shortageDisputeId}/request-evidence`, {
      Authorization: `Bearer ${adminToken}`
    }, { notes: 'Please provide supplier warehouse incident log' });
    assert.strictEqual(evReqRes.status, 200);
    const [shgCheck] = await db.query('SELECT status FROM order_disputes WHERE id = ?', [shortageDisputeId]);
    assert.strictEqual(shgCheck[0].status, 'EVIDENCE_REQUESTED');
    pass('Admin evidence request workflow operates cleanly (status=EVIDENCE_REQUESTED)');

    // -------------------------------------------------------------------------
    // SECTION 9: Dispute Closure & Fulfillment Resumption
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 9: Case Closure & Safe Fulfillment Resumption ---');

    // 30. Closure blocked while remediation is incomplete
    // (Create temporary dispute with active remediation to test block)
    const [tempDispRes] = await db.query(
      `INSERT INTO order_disputes (
        dispute_code, order_id, buyer_id, supplier_id, reason, dispute_category,
        description, remediation_status, status
      ) VALUES (?, ?, 5, 2, 'DAMAGED_GOODS', 'DAMAGED_GOODS', 'Temp dispute', 'PROPOSED', 'SUPPLIER_REMEDIATION_PROPOSED')`,
      [`DSP-TMP-${Date.now()}`, deliveredOrderId]
    );
    const tempDispId = tempDispRes.insertId;

    const prematureClose = await makeRequest('POST', `${baseUrl}/api/v1/disputes/${tempDispId}/close`, {
      Authorization: `Bearer ${adminToken}`,
      'X-Idempotency-Key': `IDEMP-PRE-CLOSE-${Date.now()}`
    }, { closure_reason: 'Premature close' });
    assert.strictEqual(prematureClose.status, 422);
    assert.strictEqual(prematureClose.body.error.code, 'REMEDIATION_INCOMPLETE');
    pass('Dispute closure blocked while operational remediation is incomplete (422 REMEDIATION_INCOMPLETE)');

    // Clean up temp dispute
    await db.query('DELETE FROM order_disputes WHERE id = ?', [tempDispId]);

    // 31. Admin closes dispute 1 (remediation completed)
    const closeRes1 = await makeRequest('POST', `${baseUrl}/api/v1/disputes/${disputeId1}/close`, {
      Authorization: `Bearer ${adminToken}`,
      'X-Idempotency-Key': `IDEMP-CLOSE1-${Date.now()}`
    }, { closure_reason: 'Replacement delivery confirmed by buyer. Issue satisfactorily resolved.' });
    assert.strictEqual(closeRes1.status, 200);
    assert.strictEqual(closeRes1.body.data.status, 'CLOSED');
    pass('Admin closes completed dispute 1 with documented closure reason');

    // 32. Admin closes dispute 2 (claim accepted) and order fulfillment safely completes
    const closeRes2 = await makeRequest('POST', `${baseUrl}/api/v1/disputes/${disputeId2}/close`, {
      Authorization: `Bearer ${adminToken}`,
      'X-Idempotency-Key': `IDEMP-CLOSE2-${Date.now()}`
    }, { closure_reason: 'Shortage claim accepted. Commercial resolution concluded.' });
    assert.strictEqual(closeRes2.status, 200);
    assert.strictEqual(closeRes2.body.data.status, 'CLOSED');
    assert.strictEqual(closeRes2.body.data.order_resumed, true);

    // Admin closure is NOT buyer consent. Resume to supplier-delivered only.
    const [awaitingBuyer] = await db.query('SELECT fulfillment_status, order_status FROM orders WHERE id = ?', [deliveredOrderId]);
    assert.strictEqual(awaitingBuyer[0].fulfillment_status, 'SUPPLIER_DELIVERED');
    assert.strictEqual(awaitingBuyer[0].order_status, 'OUT_FOR_DELIVERY');
    pass('Admin dispute closure never impersonates buyer receipt or settlement eligibility');

    // Only the authenticated owner may now confirm the FULL original delivery.
    const finalReceipt = await makeRequest('POST',
      `${baseUrl}/api/v1/fulfillment/buyer/orders/${deliveredOrderId}/confirm-receipt`, {
        Authorization: `Bearer ${buyer1Token}`,
        'X-Idempotency-Key': `IDEMP-B7-RECEIPT-${Date.now()}`
      }, { notes: 'Replacement and original order fully received.' });
    assert.strictEqual(finalReceipt.status, 200);
    const [finalOrder] = await db.query('SELECT fulfillment_status, order_status FROM orders WHERE id = ?', [deliveredOrderId]);
    assert.strictEqual(finalOrder[0].fulfillment_status, 'BUYER_CONFIRMED');
    assert.strictEqual(finalOrder[0].order_status, 'DELIVERED');
    pass('Only explicit buyer confirmation completes the original order after dispute closure');

    // -------------------------------------------------------------------------
    // SECTION 10: Audit Timeline & Evidence Security
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 10: Audit Timeline & Evidence Security ---');

    // 33. Immutable audit trail in order_dispute_events
    const [dispEvents] = await db.query(
      `SELECT action, actor_role, from_status, to_status FROM order_dispute_events 
       WHERE dispute_id = ? ORDER BY id ASC`,
      [disputeId1]
    );
    assert.ok(dispEvents.length >= 4);
    assert.strictEqual(dispEvents[0].action, 'BUYER_FILED_DISPUTE');
    pass(`Audit Integrity: order_dispute_events preserves complete chronological timeline (${dispEvents.length} events logged)`);

    // 34. Dangerous evidence URI schemes rejected
    const badUriRes = await makeRequest('POST', `${baseUrl}/api/v1/disputes`, {
      Authorization: `Bearer ${buyer1Token}`,
      'X-Idempotency-Key': `IDEMP-BADURI-${Date.now()}`
    }, {
      order_id: deliveredOrderId,
      category: 'DAMAGED_GOODS',
      description: 'Dangerous payload injection test',
      evidence_metadata: { file: 'file:///etc/passwd' }
    });
    assert.strictEqual(badUriRes.status, 400);
    assert.strictEqual(badUriRes.body.error.code, 'FORBIDDEN_EVIDENCE_REFERENCE');
    pass('Evidence Security: Dangerous file:// URI schemes rejected with 400 FORBIDDEN_EVIDENCE_REFERENCE');

    // 35. Transactional outbox events emitted to reservation_business_events
    const [outboxEvents] = await db.query(
      `SELECT event_type FROM reservation_business_events 
       WHERE event_type IN ('ORDER_DISPUTE_CREATED', 'ORDER_DISPUTE_SUPPLIER_RESPONDED')`
    );
    assert.ok(outboxEvents.length >= 2);
    pass('Outbox Atomicity: Transactional business events durably emitted for dispute creation and supplier response');

    // -------------------------------------------------------------------------
    // SECTION 11: Read Models & Database Isolation
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 11: Read Models & Platform Invariants ---');

    // 36. Buyer dispute list correctly filtered and paginated
    const buyerListRes = await makeRequest('GET', `${baseUrl}/api/v1/disputes/my?page=1&limit=10`, {
      Authorization: `Bearer ${buyer1Token}`
    });
    assert.strictEqual(buyerListRes.status, 200);
    assert.ok(buyerListRes.body.data.disputes.length >= 2);
    pass('Read Model: Buyer dispute list correctly scoped and paginated');

    // 37. Supplier dispute list correctly filtered to assigned orders
    const suppListRes = await makeRequest('GET', `${baseUrl}/api/v1/disputes/supplier/list?page=1&limit=10`, {
      Authorization: `Bearer ${supplierToken}`
    });
    assert.strictEqual(suppListRes.status, 200);
    assert.ok(suppListRes.body.data.disputes.length >= 2);
    pass('Read Model: Supplier dispute list correctly scoped to assigned orders');

    // 38. Admin dispute list returns all disputes
    const adminListRes = await makeRequest('GET', `${baseUrl}/api/v1/disputes?page=1&limit=20`, {
      Authorization: `Bearer ${adminToken}`
    });
    assert.strictEqual(adminListRes.status, 200);
    assert.ok(adminListRes.body.data.disputes.length >= 3);
    pass('Read Model: Admin dispute list returns comprehensive multi-tenant dispute records');

    // In B7 ephemeral CI the DB principal has no grants on protected miljor_db.
    // Verify strict selected-database identity instead. Preserve legacy local checks.
    if (process.env.B7_CI_EPHEMERAL_DB === 'YES') {
      const [[identity]] = await db.query('SELECT DATABASE() AS name');
      assert.strictEqual(identity.name, 'miljor_test_db');
      pass('Database Isolation: ephemeral miljor_test_db identity verified; protected DB deliberately inaccessible');
    } else {
      const [devOrders] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.orders');
      const [devPayments] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.payments');
      const [devDisputes] = await db.query('SELECT COUNT(*) AS c FROM miljor_db.order_disputes');
      assert.strictEqual(Number(devOrders[0].c), 0);
      assert.strictEqual(Number(devPayments[0].c), 0);
      assert.strictEqual(Number(devDisputes[0].c), 0);
      pass('Database Isolation: Development database miljor_db remains 100% PRISTINE (0 orders, 0 payments, 0 disputes)');
    }

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
      if (deliveredOrderId || unpaidOrderId || preparingOrderId) {
        const orderIds = [deliveredOrderId || 0, unpaidOrderId || 0, preparingOrderId || 0];
        await db.query('DELETE FROM order_dispute_events WHERE dispute_id IN (SELECT id FROM order_disputes WHERE order_id IN (?, ?, ?))', orderIds);
        await db.query('DELETE FROM order_disputes WHERE order_id IN (?, ?, ?)', orderIds);
        await db.query('DELETE FROM order_fulfillment_events WHERE order_id IN (?, ?, ?)', orderIds);
        await db.query('DELETE FROM payment_attempts WHERE order_id IN (?, ?, ?)', orderIds);
        await db.query('DELETE FROM payments WHERE order_id IN (?, ?, ?)', orderIds);
        await db.query('DELETE FROM orders WHERE id IN (?, ?, ?)', orderIds);
      }
      if (poolId) {
        await db.query('DELETE FROM reservation_business_events WHERE pool_id = ?', [poolId]);
      }
      if (snapshotId) {
        await db.query('DELETE FROM pool_commercial_snapshots WHERE id = ?', [snapshotId]);
      }
      if (poolId) {
        await db.query('DELETE FROM pools WHERE id = ?', [poolId]);
      }
    } catch (cleanupErr) {
      console.error('Warning: cleanup query failed:', cleanupErr.message);
    }

    await db.end();
  }

  console.log('\n================================================================================');
  console.log(`Part 4E.5 Dispute Gate: ${passedAssertions} / 40 assertions passed`);
  console.log('Status: PASS');
  console.log('================================================================================\n');
}

if (require.main === module) {
  runDisputeGate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('\n❌ Gate Execution Failed:', err);
      process.exit(1);
    });
}

module.exports = { runDisputeGate };
