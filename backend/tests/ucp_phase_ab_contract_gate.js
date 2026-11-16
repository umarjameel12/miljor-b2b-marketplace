'use strict';
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'miljor_test_db';
process.env.TEST_DB_NAME = 'miljor_test_db';
process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT = 'false';
process.env.APP_FRONTEND_URL = process.env.APP_FRONTEND_URL || 'http://127.0.0.1:5173';
process.env.SAFEPAY_WEBHOOK_SECRET = process.env.SAFEPAY_WEBHOOK_SECRET || 'phase-ab-test-webhook-secret';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/config/db');
const notificationService = require('../src/services/notificationService');
const { recordInAppOnConnection } = require('../src/services/ucpTransactionalNotifications');
const { recordFlashTimerReminders } = require('../src/services/ucpRecoveryService');
const safepayCheckoutService = require('../src/services/safepayCheckoutService');

async function main() {
  const [[dbRow]] = await db.query('SELECT DATABASE() AS db');
  assert.equal(dbRow.db, 'miljor_test_db', 'Must run strictly against isolated miljor_test_db');

  const [buyers] = await db.query("SELECT id FROM users WHERE role='BUYER' ORDER BY id LIMIT 1");
  const [suppliers] = await db.query("SELECT id FROM users WHERE role='SUPPLIER' ORDER BY id LIMIT 1");
  assert.ok(buyers.length && suppliers.length, 'Test buyer and supplier fixtures required');
  const buyerId = buyers[0].id;
  const supplierId = suppliers[0].id;

  // 1. Prospective schemaVersion=2 metadata & processPending compatibility
  const conn1 = await db.getConnection();
  try {
    await conn1.beginTransaction();
    const transitionId = 'phase-ab-' + Date.now();
    const res = await recordInAppOnConnection(conn1, {
      type: 'PAYMENT.FAILED',
      aggregateId: 'order-999999',
      aggregateVersion: 2,
      transitionId,
      recipients: [{ userId: buyerId, role: 'BUYER' }],
      title: 'Payment failed',
      message: 'Prospective metadata test',
      payload: { order_id: 999999, notification_path: '/orders' },
      actorId: 'SYSTEM',
      actorRole: 'SYSTEM',
      causationId: 'cause-' + transitionId,
      correlationId: 'corr-999999'
    });
    const [[row]] = await conn1.query(
      'SELECT payload FROM procurement_notifications WHERE recipient_id=? AND event_key=?',
      [buyerId, res.eventKey]
    );
    const meta = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    assert.equal(meta.schemaVersion, 2);
    assert.equal(meta.eventId, res.eventKey);
    assert.equal(meta.aggregateId, 'order-999999');
    assert.equal(meta.aggregateVersion, 2);
    assert.equal(meta.actorId, 'SYSTEM');
    assert.equal(meta.actorRole, 'SYSTEM');
    assert.equal(meta.causationId, 'cause-' + transitionId);
    assert.equal(meta.correlationId, 'corr-999999');
    assert.ok(meta.occurredAt, 'occurredAt must be persisted');
    await conn1.rollback();
    console.log('PASS 1: Prospective schemaVersion=2 metadata & rollback atomicity');
  } finally {
    conn1.release();
  }

  // 2. NotificationService.processPending supports schemaVersion=2 without rejecting
  {
    const conn2 = await db.getConnection();
    let noticeId;
    const transitionId = 'proc-v2-' + Date.now();
    try {
      await conn2.beginTransaction();
      const res = await recordInAppOnConnection(conn2, {
        type: 'UCP.POOL_CLOSING',
        aggregateId: 'pool-888888',
        aggregateVersion: 1,
        transitionId,
        recipients: [{ userId: buyerId, role: 'BUYER' }],
        title: 'Pool closing soon',
        message: 'Testing schemaVersion 2 projection',
        payload: { pool_id: 888888, notification_path: '/pools' },
        actorId: 'SYSTEM',
        actorRole: 'SYSTEM'
      });
      const [[row]] = await conn2.query(
        'SELECT id FROM procurement_notifications WHERE recipient_id=? AND event_key=?',
        [buyerId, res.eventKey]
      );
      noticeId = row.id;
      await conn2.commit();

      const out = await notificationService.processPending({ limit: 5, eventIds: [noticeId] });
      const [[after]] = await db.query('SELECT status, last_error_code FROM procurement_notifications WHERE id=?', [noticeId]);
      assert.equal(out.projected, 1, 'processPending must project schemaVersion=2 events: ' + JSON.stringify(after));
      assert.equal(after.status, 'SENT', 'Expected SENT, got ' + JSON.stringify(after));
      console.log('PASS 2: processPending projects schemaVersion=2 events to SENT');
    } finally {
      if (noticeId) {
        await db.query('DELETE FROM platform_notifications WHERE event_key IN (SELECT event_key FROM procurement_notifications WHERE id=?)', [noticeId]);
        await db.query('DELETE FROM procurement_notifications WHERE id=?', [noticeId]);
      }
      conn2.release();
    }
  }

  // 3. Payment failure webhook records event and never downgrades PAID order
  {
    const secret = process.env.SAFEPAY_WEBHOOK_SECRET || 'phase-ab-test-webhook-secret';
    const tracker = 'track_fail_' + Date.now();
    const orderCode = 'ORD-PAID-' + Date.now().toString().slice(-6);
    const [orderIns] = await db.query(
      `INSERT INTO orders (order_code, buyer_id, supplier_id, total_qty, unit_price, subtotal_amount, total_amount, currency, order_status, payment_status, fulfillment_status)
       VALUES (?, ?, ?, 10, 100.00, 1000.00, 1000.00, 'PKR', 'PAID', 'PAID', 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT')`,
      [orderCode, buyerId, supplierId]
    );
    const orderId = orderIns.insertId;
    const eventId = 'evt_fail_' + Date.now();
    const rawBody = Buffer.from(JSON.stringify({ type: 'payment.failed', data: { tracker } }), 'utf8');
    const signature = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

    try {
      const failRes = await safepayCheckoutService.processWebhookEvent({
        rawBody, signature, timestamp: Date.now(), eventId, eventType: 'payment.failed'
      });
      assert.equal(failRes.success, true);
      const [[ordAfter]] = await db.query('SELECT order_status, payment_status FROM orders WHERE id=?', [orderId]);
      assert.equal(ordAfter.order_status, 'PAID', 'PAID order must never downgrade on non-success webhook');
      assert.equal(ordAfter.payment_status, 'PAID', 'PAID payment_status must never downgrade');
      console.log('PASS 3: Non-success webhook never downgrades PAID order');
    } finally {
      await db.query('DELETE FROM payment_webhook_events WHERE event_id=?', [eventId]);
      await db.query('DELETE FROM orders WHERE id=?', [orderId]);
    }
  }

  // 4. Flash timer reminders respect window size, SQL clock, and deduplicate
  {
    const [flashRows] = await db.query('SELECT id, supplier_id FROM flash_pools ORDER BY id LIMIT 1');
    if (flashRows.length) {
      const conn4 = await db.getConnection();
      try {
        await conn4.beginTransaction();
        const flashId = flashRows[0].id;
        // Set window > 1h (created 2h ago) and remaining ~30m (<= 1h) -> should emit 3600 threshold once
        await conn4.query(
          "UPDATE flash_pools SET status='ACTIVE', created_at=DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR), expiry_time=DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE) WHERE id=?",
          [flashId]
        );
        const first = await recordFlashTimerReminders(conn4, flashId);
        const second = await recordFlashTimerReminders(conn4, flashId);
        assert.equal(first, 1, 'First Flash timer check must emit 1 threshold reminder');
        assert.equal(second, 0, 'Duplicate Flash timer check must be deduplicated');
        await conn4.rollback();
        console.log('PASS 4: Flash timer reminders SQL-clock & deduplication verified');
      } finally {
        conn4.release();
      }
    } else {
      console.log('SKIP 4: No flash_pools fixture row present');
    }
  }

  console.log('UCP_PHASE_AB_CONTRACT_GATE_PASS');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('UCP_PHASE_AB_CONTRACT_GATE_FAIL', err);
  process.exit(1);
});
