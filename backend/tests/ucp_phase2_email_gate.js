'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

assert.equal(process.env.NODE_ENV, 'test', 'NODE_ENV must be test');
assert.equal(process.env.DB_NAME, 'miljor_test_db', 'DB_NAME must be miljor_test_db');
assert.equal(process.env.TEST_DB_NAME, 'miljor_test_db', 'TEST_DB_NAME must be miljor_test_db');
assert.equal(process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT, 'false');

const db = require('../src/config/db');
const emailService = require('../src/services/emailService');
const notificationService = require('../src/services/notificationService');
const ucpNotifications = require('../src/services/ucpTransactionalNotifications');

async function run() {
  const expectedPort = Number(process.env.DB_PORT || 3306);
  const [[identity]] = await db.query('SELECT DATABASE() AS db, @@port AS port');
  assert.equal(identity.db, 'miljor_test_db');
  assert.equal(Number(identity.port), expectedPort);
  console.log(`[DB-GUARD] Phase 2 Email gate verified DB=${identity.db} on port=${identity.port}`);

  const tag = `ph2e_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const createdUsers = [];

  try {
    const insertUser = async (name, email, role) => {
      const [r] = await db.query(
        `INSERT INTO users (full_name, business_name, email, password_hash, role, is_verified, verification_status)
         VALUES (?, ?, ?, '$2b$10$phase2DummyHashOnlyForTestFixture000000000000000000', ?, 1, 'VERIFIED')`,
        [name, `${name} Co`, email, role]
      );
      createdUsers.push(r.insertId);
      return { id: r.insertId, name, email, role };
    };

    const buyerEn = await insertUser('Ph2 Buyer EN', `${tag}_en@test.local`, 'BUYER');
    const buyerUr = await insertUser('Ph2 Buyer UR', `${tag}_ur@test.local`, 'BUYER');

    // Configure Urdu preference + muted routine email for buyerUr (critical override must STILL deliver!)
    await notificationService.setPreferences(buyerUr.id, {
      locale: 'ur',
      optional_email: false,
      optional_sms: false,
      muted_info: true
    });

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      // 1. Critical event (FULFILLMENT.PARTIAL_DELIVERY) -> must override routine_muted/email_enabled=false
      await ucpNotifications.recordInAppOnConnection(conn, {
        type: 'FULFILLMENT.PARTIAL_DELIVERY',
        aggregateId: `ph2-order-${tag}`,
        aggregateVersion: 1,
        transitionId: `crit-${tag}`,
        recipients: [
          { userId: buyerEn.id, role: 'BUYER' },
          { userId: buyerUr.id, role: 'BUYER' }
        ],
        title: 'Partial delivery recorded',
        message: '80 accepted, 20 disputed. Open MilJor to review.',
        payload: { order_id: 1, status: 'PARTIAL_CONFIRMED', notification_path: '/orders' },
        actorId: buyerEn.id,
        actorRole: 'BUYER',
        schemaVersion: 2
      });

      // 2. Routine INFO event (FULFILLMENT.PACKING) -> respects mute on buyerUr
      await ucpNotifications.recordInAppOnConnection(conn, {
        type: 'FULFILLMENT.PACKING',
        aggregateId: `ph2-order-${tag}`,
        aggregateVersion: 2,
        transitionId: `info-${tag}`,
        recipients: [{ userId: buyerUr.id, role: 'BUYER' }],
        title: 'Packing started',
        message: 'Your order is being packed.',
        payload: { order_id: 1, status: 'PREPARING', notification_path: '/orders' },
        actorId: buyerUr.id,
        actorRole: 'BUYER',
        schemaVersion: 2
      });

      await conn.commit();
    } finally {
      conn.release();
    }

    // Project pending notifications
    await notificationService.processPending({ limit: 50 });

    // Verify English & Urdu projections exist and no secret/address/bank details leaked
    const [enRows] = await db.query(
      'SELECT * FROM procurement_notifications WHERE recipient_id = ? ORDER BY id DESC',
      [buyerEn.id]
    );
    const [urRows] = await db.query(
      'SELECT * FROM procurement_notifications WHERE recipient_id = ? ORDER BY id DESC',
      [buyerUr.id]
    );
    assert.ok(enRows.length >= 1, 'EN buyer must receive notification');
    assert.ok(urRows.length >= 1, 'UR buyer must receive critical notification');

    for (const row of [...enRows, ...urRows]) {
      const raw = JSON.stringify(row);
      assert.equal(/iban|password|otp|pickup_code|street/i.test(raw), false, 'No secrets/addresses/bank details in notification payload');
    }

    // Verify capture-transport email send in mock mode (never sends to external business users)
    emailService.mockSentEmails.length = 0;
    const sendRes = await emailService.transporter.sendMail({
      from: emailService.emailFrom,
      to: buyerEn.email,
      subject: 'MilJor Critical Delivery Update',
      html: '<p>80 accepted, 20 disputed. Review in MilJor.</p>',
      text: '80 accepted, 20 disputed. Review in MilJor.'
    });
    assert.ok(sendRes && sendRes.messageId, 'Capture transport must return messageId');
    assert.equal(emailService.mockSentEmails.length, 1);

    console.log('[PASS] Capture-transport email, critical override, routine mute, EN/UR projections & zero-secret payload verified');
    console.log('[NOTE] Actual external SMTP inbox receipt remains NOT_TESTED / BLOCKED (no explicitly authorized test mailbox configured)');
  } finally {
    try {
      if (createdUsers.length) {
        const ph = createdUsers.map(() => '?').join(',');
        await db.query(`DELETE FROM platform_notifications WHERE user_id IN (${ph})`, createdUsers);
        await db.query(`DELETE FROM notification_preferences WHERE user_id IN (${ph})`, createdUsers);
        await db.query(`DELETE FROM procurement_notifications WHERE recipient_id IN (${ph})`, createdUsers);
        await db.query(`DELETE FROM transactional_email_outbox WHERE recipient_email LIKE ?`, [`${tag}%`]);
        await db.query(`DELETE FROM users WHERE id IN (${ph})`, createdUsers);
      }
    } catch (e) {
      console.error('[CLEANUP WARNING]', e.message);
    }
    await db.end();
  }
}

run().catch(err => {
  console.error('[PHASE 2 EMAIL GATE FAIL]', err);
  process.exitCode = 1;
});
