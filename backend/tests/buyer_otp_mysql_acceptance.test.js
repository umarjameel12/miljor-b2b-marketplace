'use strict';
const assert = require('node:assert/strict');
const { test, after } = require('node:test');

// Must run only on a disposable MySQL database.
if (process.env.NODE_ENV !== 'test' || process.env.TEST_DB_NAME !== 'miljor_otp_acceptance_test') {
  throw new Error('Refusing to run without NODE_ENV=test and TEST_DB_NAME=miljor_otp_acceptance_test');
}
process.env.TRANSACTIONAL_EMAIL_MODE = 'mock';
process.env.JWT_SECRET ||= 'ci-only-otp-acceptance-jwt-secret';
const db = require('../src/config/db');
const email = require('../src/services/emailService');
const auth = require('../src/controllers/authController');
after(async () => { await db.end(); });

async function responseFor(fn, body, user) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
  await fn.call(auth, { body, user }, res);
  return res;
}

test('real MySQL: buyer email OTP issue, verify, persistence, single-use, resend', async () => {
  // Dedicated isolated CI DB only; never touch a developer database.
  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(30) NOT NULL,
    verification_status VARCHAR(40) NOT NULL DEFAULT 'UNVERIFIED',
    buyer_trust_status VARCHAR(40) NULL DEFAULT NULL,
    is_verified TINYINT NOT NULL DEFAULT 0
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS email_verifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    email VARCHAR(255) NOT NULL,
    otp_hash VARCHAR(128) NOT NULL,
    purpose VARCHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    attempts_count INT NOT NULL DEFAULT 0,
    consumed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS transactional_email_outbox (
    id INT PRIMARY KEY AUTO_INCREMENT,
    recipient_user_id INT,
    template_name VARCHAR(64),
    status VARCHAR(32),
    last_error TEXT,
    next_attempt_at DATETIME NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS system_audit_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    actor_id INT, actor_role VARCHAR(32), action VARCHAR(70),
    entity_name VARCHAR(70), entity_id INT
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS platform_notifications (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    role VARCHAR(32) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    event_key VARCHAR(120) NOT NULL,
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    payload JSON NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP NULL,
    visible_until DATETIME NULL,
    UNIQUE KEY uq_platform_notifications_user_event_key (user_id, event_key)
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS procurement_notifications (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    recipient_id INT NOT NULL,
    recipient_role VARCHAR(32) NOT NULL,
    event_key VARCHAR(120) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    next_attempt_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP NULL,
    last_error_code VARCHAR(80) NULL,
    projected_locale VARCHAR(8) NULL,
    UNIQUE KEY uq_procurement_notifications_recipient_event (recipient_id, event_key)
  )`);
  await db.query('DELETE FROM procurement_notifications');
  await db.query('DELETE FROM platform_notifications');
  await db.query('DELETE FROM email_verifications');
  await db.query('DELETE FROM transactional_email_outbox');
  await db.query('DELETE FROM system_audit_logs');
  await db.query('DELETE FROM users');

  const [created] = await db.query("INSERT INTO users (email, role) VALUES ('buyer@otp-ci.example', 'BUYER')");
  const userId = created.insertId;
  const sent = [];
  const originalQueue = email.queueAndSendEmail;
  email.queueAndSendEmail = async args => {
    sent.push(args);
    return { status: 'SENT' }; // Delivery provider is deliberately mocked; NOT real inbox evidence.
  };
  try {
    await email.createAndSendOtp({
      userId, email: 'buyer@otp-ci.example', userName: 'CI Buyer',
      purpose: 'REGISTRATION_VERIFY', emailContext: 'verification'
    });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].templateName, 'EMAIL_VERIFICATION_OTP');
    const code = sent[0].payload.otp;
    assert.match(code, /^\d{6}$/);
    const ok = await responseFor(auth.verifyEmail, { email: 'buyer@otp-ci.example', otp: code }, { id: userId });
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.payload));
    assert.equal(ok.payload.success, true);
    const [buyers] = await db.query('SELECT verification_status, is_verified FROM users WHERE id = ?', [userId]);
    assert.equal(buyers[0].verification_status, 'EMAIL_VERIFIED');
    assert.equal(buyers[0].is_verified, 1);
    const replay = await responseFor(auth.verifyEmail, { otp: code }, { id: userId });
    assert.equal(replay.payload.success, false);
    assert.equal(replay.payload.error.code, 'OTP_NOT_FOUND');
    const [audits] = await db.query("SELECT id FROM system_audit_logs WHERE action = 'EMAIL_VERIFIED' AND entity_id = ?", [userId]);
    assert.equal(audits.length, 1);
    // Simulate cooldown passage only in this disposable DB.
    await db.query('UPDATE email_verifications SET created_at = DATE_SUB(NOW(), INTERVAL 61 SECOND) WHERE user_id = ?', [userId]);
    await email.createAndSendOtp({
      userId, email: 'buyer@otp-ci.example', userName: 'CI Buyer',
      purpose: 'REGISTRATION_VERIFY', emailContext: 'verification'
    });
    assert.equal(sent.length, 2);
    const bad = await responseFor(auth.verifyEmail, { otp: '000000' }, { id: userId });
    assert.equal(bad.payload.success, false);
    assert.equal(bad.payload.error.code, 'INVALID_OTP');
    const secondCode = sent[1].payload.otp;
    const valid = await responseFor(auth.verifyEmail, { otp: secondCode }, { id: userId });
    assert.equal(valid.payload.success, true);
  } finally {
    email.queueAndSendEmail = originalQueue;
  }
});
