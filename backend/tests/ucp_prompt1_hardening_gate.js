'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

assert.equal(process.env.NODE_ENV, 'test', 'NODE_ENV must be test');
assert.equal(process.env.DB_NAME, 'miljor_test_db', 'DB_NAME must be miljor_test_db');
assert.equal(process.env.TEST_DB_NAME, 'miljor_test_db', 'TEST_DB_NAME must be miljor_test_db');
assert.equal(process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT, 'false', 'ALLOW_EXTERNAL_MONEY_MOVEMENT must be false');

process.env.SAFEPAY_WEBHOOK_SECRET = process.env.SAFEPAY_WEBHOOK_SECRET || 'prompt1_test_webhook_secret_32_chars_min';
process.env.SAFEPAY_PUBLIC_KEY = process.env.SAFEPAY_PUBLIC_KEY || 'sec_prompt1_pub';
process.env.SAFEPAY_SECRET_KEY = process.env.SAFEPAY_SECRET_KEY || 'sec_prompt1_priv';

const db = require('../src/config/db');
const poolClosureService = require('../src/services/poolClosureService');
const safepayCheckoutService = require('../src/services/safepayCheckoutService');
const notificationService = require('../src/services/notificationService');

function signWebhook(bodyStr, secret) {
  return crypto.createHmac('sha512', secret).update(bodyStr).digest('hex');
}

async function run() {
  const [[idRow]] = await db.query('SELECT DATABASE() AS db_name, @@port AS db_port');
  assert.equal(idRow.db_name, 'miljor_test_db');
  console.log(`[DB-GUARD] Verified DB=${idRow.db_name} port=${idRow.db_port}`);

  const tag = crypto.randomBytes(6).toString('hex');
  const createdUsers = [];
  const createdOrders = [];
  const createdFlash = [];
  const createdTrackers = [];
  const createdEventIds = [];

  try {
    // 1. Seed synthetic buyer A, buyer B, and suspended supplier
    const [bA] = await db.query(
      "INSERT INTO users(full_name,email,role,is_verified,verification_status) VALUES ('Prompt1 Buyer A',?,'BUYER',1,'VERIFIED')",
      [`p1-ba-${tag}@example.invalid`]
    );
    const [bB] = await db.query(
      "INSERT INTO users(full_name,email,role,is_verified,verification_status) VALUES ('Prompt1 Buyer B',?,'BUYER',1,'VERIFIED')",
      [`p1-bb-${tag}@example.invalid`]
    );
    const [sup] = await db.query(
      "INSERT INTO users(full_name,email,role,is_verified,verification_status) VALUES ('Prompt1 Susp Sup',?,'SUPPLIER',0,'BLOCKED')",
      [`p1-sup-${tag}@example.invalid`]
    );
    createdUsers.push(bA.insertId, bB.insertId, sup.insertId);

    // 2. Bulk Flash expiry delegation: expired offer owned by suspended supplier + unresolved hold
    const [[prod]] = await db.query('SELECT id FROM products ORDER BY id ASC LIMIT 1');
    const [fp] = await db.query(
      `INSERT INTO flash_pools (
        flash_code, supplier_id, product_id, total_stock, remaining_stock, held_stock, committed_stock,
        min_quantity, discounted_unit_price, clearance_reason, expiry_time, status, version_number
      ) VALUES (?, ?, ?, 10.00, 5.00, 5.00, 0.00, 1.00, 100.00, 'Prompt1 recovery test', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE), 'ACTIVE', 1)`,
      [`FP-P1-${tag}`, sup.insertId, prod ? prod.id : 1]
    );
    createdFlash.push(fp.insertId);

    const [[listing]] = await db.query('SELECT id FROM supplier_listings ORDER BY id ASC LIMIT 1');
    await db.query(
      `INSERT INTO supplier_inventory_allocations (supplier_listing_id, allocation_type, reference_id, allocated_qty, status)
       VALUES (?, 'FLASH_POOL', ?, 10.00, 'COMMITTED')`,
      [listing ? listing.id : 1, fp.insertId]
    );

    const processed = await poolClosureService.processExpiredFlashPools();
    assert.ok(Number(processed) >= 1, 'processExpiredFlashPools must delegate to UCP Flash recovery');

    const [[fpAfter]] = await db.query('SELECT status FROM flash_pools WHERE id = ?', [fp.insertId]);
    assert.equal(fpAfter.status, 'EXPIRED', 'Suspended supplier expired flash pool must transition to EXPIRED');

    const [[allocAfter]] = await db.query(
      "SELECT allocated_qty, status FROM supplier_inventory_allocations WHERE allocation_type='FLASH_POOL' AND reference_id=?",
      [fp.insertId]
    );
    assert.equal(allocAfter.status, 'COMMITTED', 'Unresolved held_stock must preserve COMMITTED allocation');
    assert.equal(Number(allocAfter.allocated_qty), 5, 'Unused 5.00 released, held 5.00 preserved');
    console.log('[PASS] Bulk Flash expiry delegates to transactional UCP recovery & preserves held stock');

    // 3. Webhook tracker vs event identity + concurrent duplicate replay
    const tracker = `track_p1_${tag}`;
    createdTrackers.push(tracker);
    const [ord] = await db.query(
      `INSERT INTO orders (order_code, buyer_id, supplier_id, total_qty, unit_price, subtotal_amount, total_amount, currency, order_status, payment_status)
       VALUES (?, ?, ?, 1, 150, 150, 150, 'PKR', 'AWAITING_PAYMENT', 'AWAITING_PAYMENT')`,
      [`P1-ORD-${tag}`, bA.insertId, sup.insertId]
    );
    createdOrders.push(ord.insertId);

    await db.query(
      `INSERT INTO payment_attempts (attempt_code, order_id, buyer_id, provider, environment, amount, currency, status, provider_tracker_token, idempotency_key)
       VALUES (?, ?, ?, 'SAFEPAY', 'sandbox', 150.00, 'PKR', 'INITIATED', ?, ?)`,
      [`ATT-P1-${tag}`, ord.insertId, bA.insertId, tracker, `ik-${tag}`]
    );

    const evt1 = `evt_p1_started_${tag}`;
    const evt2 = `evt_p1_paid_${tag}`;
    createdEventIds.push(evt1, evt2);

    const body1 = JSON.stringify({
      type: 'payment:created',
      id: evt1,
      data: { tracker, state: 'TRACKER_STARTED', amount: 150, currency: 'PKR' }
    });
    const sig1 = signWebhook(body1, process.env.SAFEPAY_WEBHOOK_SECRET);

    // Concurrent non-success webhook replay with same eventId must not throw ER_DUP_ENTRY
    const [r1a, r1b] = await Promise.all([
      safepayCheckoutService.processWebhookEvent({ rawBody: body1, signature: sig1, timestamp: Date.now(), eventId: evt1, eventType: 'payment:created' }),
      safepayCheckoutService.processWebhookEvent({ rawBody: body1, signature: sig1, timestamp: Date.now(), eventId: evt1, eventType: 'payment:created' })
    ]);
    assert.equal(r1a.success, true);
    assert.equal(r1b.success, true);
    assert.ok(r1a.is_duplicate || r1b.is_duplicate, 'One concurrent non-success replay must be marked is_duplicate');

    // Second legitimate event on the SAME tracker must NOT be discarded!
    const body2 = JSON.stringify({
      type: 'payment:created',
      id: evt2,
      data: { tracker, state: 'PAID', amount: 150, currency: 'PKR' }
    });
    const sig2 = signWebhook(body2, process.env.SAFEPAY_WEBHOOK_SECRET);
    const [r2a, r2b] = await Promise.all([
      safepayCheckoutService.processWebhookEvent({ rawBody: body2, signature: sig2, timestamp: Date.now(), eventId: evt2, eventType: 'payment:created' }),
      safepayCheckoutService.processWebhookEvent({ rawBody: body2, signature: sig2, timestamp: Date.now(), eventId: evt2, eventType: 'payment:created' })
    ]);
    assert.equal(r2a.success, true);
    assert.equal(r2b.success, true);

    const [[payCount]] = await db.query('SELECT COUNT(*) AS cnt FROM payments WHERE order_id = ?', [ord.insertId]);
    assert.equal(Number(payCount.cnt), 1, 'Same-tracker distinct PAID event must succeed once with 0 duplicate payments');
    console.log('[PASS] Distinct webhook events on same tracker processed; concurrent duplicates safe');

    // 4. Cross-user notification authorization
    const nRes = await notificationService.createNotification({
      userId: bA.insertId,
      role: 'BUYER',
      eventType: 'ORDER_PAID',
      eventKey: `p1-iso-${tag}`,
      title: 'Order Paid',
      message: 'Private buyer A notice',
      payload: { schemaVersion: 1, entityType: 'ORDER', entityId: ord.insertId }
    });
    const bList = await notificationService.listUserNotifications(bB.insertId, { limit: 50 });
    assert.equal(bList.some(n => n.id === nRes.id), false, 'Buyer B must never see Buyer A notification');
    const markedByB = await notificationService.markAsRead(bB.insertId, nRes.id);
    assert.equal(Boolean(markedByB), false, 'Buyer B must not be able to mark Buyer A notification as read');
    console.log('[PASS] Cross-user notification isolation & mark-as-read authorization verified');

    console.log('ALL PROMPT 1 HARDENING CHECKS PASSED');
  } finally {
    if (createdEventIds.length) {
      await db.query(`DELETE FROM payment_webhook_events WHERE event_id IN (${createdEventIds.map(() => '?').join(',')})`, createdEventIds).catch(() => {});
    }
    if (createdOrders.length) {
      await db.query(`DELETE FROM payments WHERE order_id IN (${createdOrders.map(() => '?').join(',')})`, createdOrders).catch(() => {});
      await db.query(`DELETE FROM payment_attempts WHERE order_id IN (${createdOrders.map(() => '?').join(',')})`, createdOrders).catch(() => {});
      await db.query(`DELETE FROM orders WHERE id IN (${createdOrders.map(() => '?').join(',')})`, createdOrders).catch(() => {});
    }
    if (createdFlash.length) {
      await db.query(`DELETE FROM supplier_inventory_allocations WHERE allocation_type='FLASH_POOL' AND reference_id IN (${createdFlash.map(() => '?').join(',')})`, createdFlash).catch(() => {});
      await db.query(`DELETE FROM flash_pools WHERE id IN (${createdFlash.map(() => '?').join(',')})`, createdFlash).catch(() => {});
    }
    if (createdUsers.length) {
      const ph = createdUsers.map(() => '?').join(',');
      await db.query(`DELETE FROM platform_notifications WHERE user_id IN (${ph})`, createdUsers).catch(() => {});
      await db.query(`DELETE FROM procurement_notifications WHERE recipient_id IN (${ph})`, createdUsers).catch(() => {});
      await db.query(`DELETE FROM users WHERE id IN (${ph})`, createdUsers).catch(() => {});
    }
    await db.end();
  }
}

run().catch(err => {
  console.error('[PROMPT 1 HARDENING GATE FAIL]', err);
  process.exitCode = 1;
});
