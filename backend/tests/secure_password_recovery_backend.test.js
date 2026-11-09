// =============================================================================
// tests/secure_password_recovery_backend.test.js
// MilJor Secure Password Recovery Backend Verification Suite
// Enforces:
// 1. Isolated test database target (miljor_test_db) with zero mutation to miljor_db.
// 2. Account enumeration resistance: known vs unknown vs suspended accounts.
// 3. Database-backed atomic cross-worker cooldown reservation (auth_cooldown_reservations).
// 4. Two concurrent workers requesting reset for same identity: exactly one admitted.
// 5. Suspended account status privacy (no 403 disclosure without valid OTP).
// 6. Cryptographic OTP generation (v2 HMAC-SHA-256) and canonical 64-hex random secret validation.
// 7. Durable attempt counter (max 5) and lockout.
// 8. Expiry enforcement (10 min).
// 9. Atomic transaction rollback verification: zero partial state on failure.
// 10. Real-time access-token and session revocation (immediate 401 SESSION_REVOKED).
// 11. Mail provider sandbox isolation & adapter verification.
// =============================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';
process.env.ENFORCE_STRICT_SESSION_SID = 'true';

const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');
const app = require('../server');
const authController = require('../src/controllers/authController');
const emailService = require('../src/services/emailService');
const sessionService = require('../src/services/sessionService');
const EmailService = emailService.constructor;
const { assertTestDatabaseSafety } = require('./testDbSafetyGuard');

async function makeRequest({ baseUrl, method = 'POST', path = '/', body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    let bodyData = null;
    if (body) {
      bodyData = typeof body === 'string' ? body : JSON.stringify(body);
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyData);
    }

    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {
          json = { raw: data };
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: json
        });
      });
    });

    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

async function runTestSuite() {
  console.log('🛡️ Starting MilJor Secure Password Recovery Backend Test Suite...\n');

  // 1. Verify strict test database isolation
  await assertTestDatabaseSafety(db, 'secure_password_recovery_backend.test.js');
  const [dbRow] = await db.query('SELECT DATABASE() as current_db');
  const activeDb = dbRow[0].current_db;
  console.log(`🔒 Connected Database: '${activeDb}'`);
  assert.strictEqual(activeDb, 'miljor_test_db', 'SECURITY VIOLATION: Test suite MUST run strictly against miljor_test_db!');

  // 2. Start ephemeral HTTP test server
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`🌐 Ephemeral test server listening on port ${port}`);

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  const TEST_USER_EMAIL = `test_pwd_reset_${Date.now()}@example.com`;
  const TEST_SUSPENDED_EMAIL = `test_suspended_${Date.now()}@example.com`;
  const UNKNOWN_EMAIL = `unknown_account_${Date.now()}@miljor.pk`;
  const INITIAL_PASSWORD = 'InitialPassword123';
  let testUserId = null;
  let suspendedUserId = null;

  try {
    // 3. Setup test accounts in miljor_test_db
    const initialHash = await bcrypt.hash(INITIAL_PASSWORD, 10);
    const [userRes] = await db.query(
      `INSERT INTO users (full_name, business_name, email, phone, role, password_hash, verification_status, buyer_trust_status)
       VALUES (?, ?, ?, ?, 'BUYER', ?, 'VERIFIED', 'CONTACT_VERIFIED')`,
      ['Test Recovery User', 'Recovery Test Corp', TEST_USER_EMAIL, `+92300${Math.floor(1000000 + Math.random() * 9000000)}`, initialHash]
    );
    testUserId = userRes.insertId;

    const [suspRes] = await db.query(
      `INSERT INTO users (full_name, business_name, email, phone, role, password_hash, verification_status, buyer_trust_status)
       VALUES (?, ?, ?, ?, 'BUYER', ?, 'BLOCKED', 'SUSPENDED')`,
      ['Suspended User', 'Suspended Corp', TEST_SUSPENDED_EMAIL, `+92300${Math.floor(1000000 + Math.random() * 9000000)}`, initialHash]
    );
    suspendedUserId = suspRes.insertId;

    // Reset cooldown reservations before running tests
    if (authController._clearCooldownReservations) await authController._clearCooldownReservations();

    // --- TEST 1: Account Enumeration Resistance (Single Request) ---
    await test('1. Account Enumeration: Non-existent email returns generic 200 message', async () => {
      const res = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/request-password-reset',
        body: { email: UNKNOWN_EMAIL }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.message, 'If an account exists with this email address, a password reset code has been sent.');
    });

    await test('2. Account Enumeration: Existing email returns identical generic 200 message', async () => {
      const res = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/request-password-reset',
        body: { email: TEST_USER_EMAIL }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.message, 'If an account exists with this email address, a password reset code has been sent.');
    });

    await test('3. Account Enumeration: Suspended email returns identical generic 200 message without leakage', async () => {
      const res = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/request-password-reset',
        body: { email: TEST_SUSPENDED_EMAIL }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.message, 'If an account exists with this email address, a password reset code has been sent.');

      // Verify no OTP was created for suspended user
      const [challenges] = await db.query('SELECT * FROM email_verifications WHERE user_id = ?', [suspendedUserId]);
      assert.strictEqual(challenges.length, 0, 'No challenge should be generated for suspended accounts');
    });

    // --- TEST 2: Rate Limiting & Cooldown Enumeration Oracle Defense ---
    await test('4. Cooldown Oracle Defense: Known email returns 429 RATE_LIMITED on repeated request', async () => {
      const res = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/request-password-reset',
        body: { email: TEST_USER_EMAIL }
      });
      assert.strictEqual(res.statusCode, 429);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.error.code, 'RATE_LIMITED');
      assert.match(res.data.error.message, /60 seconds/i);
    });

    await test('5. Cooldown Oracle Defense: Unknown email returns identical 429 RATE_LIMITED on repeated request', async () => {
      const res = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/request-password-reset',
        body: { email: UNKNOWN_EMAIL }
      });
      assert.strictEqual(res.statusCode, 429);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.error.code, 'RATE_LIMITED');
      assert.match(res.data.error.message, /60 seconds/i);
    });

    await test('6. Cooldown Oracle Defense: Suspended email returns identical 429 RATE_LIMITED on repeated request', async () => {
      const res = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/request-password-reset',
        body: { email: TEST_SUSPENDED_EMAIL }
      });
      assert.strictEqual(res.statusCode, 429);
      assert.strictEqual(res.data.success, false);
      assert.strictEqual(res.data.error.code, 'RATE_LIMITED');
      assert.match(res.data.error.message, /60 seconds/i);
    });

    // --- TEST 3: Cryptographic OTP Generation & Database Record ---
    await test('7. Cryptographic OTP: Challenge stored with v2 HMAC hash and 10 min expiration', async () => {
      const [rows] = await db.query(
        'SELECT * FROM email_verifications WHERE user_id = ? AND purpose = ? ORDER BY id DESC LIMIT 1',
        [testUserId, 'PASSWORD_RESET']
      );
      assert.strictEqual(rows.length, 1);
      const ch = rows[0];
      assert.strictEqual(ch.purpose, 'PASSWORD_RESET');
      assert.ok(ch.otp_hash.startsWith('v2$'), 'otp_hash must use v2$ HMAC prefix');
      assert.strictEqual(ch.attempts_count, 0);
      assert.strictEqual(ch.consumed_at, null);

      const expiresAt = new Date(ch.expires_at).getTime();
      const now = Date.now();
      assert.ok(expiresAt > now + 8 * 60 * 1000, 'Expiration must be ~10 minutes in future');
    });

    // --- TEST 4: Password Complexity Enforcement ---
    await test('8. Complexity: Weak password rejected before transaction with 400 VALIDATION_ERROR', async () => {
      const res = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/reset-password',
        body: { email: TEST_USER_EMAIL, otp: '123456', new_password: 'short' }
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.data.error.code, 'VALIDATION_ERROR');
    });

    // --- TEST 5: Suspended User Reset Privacy Defense ---
    await test('9. Suspended Account Privacy: Probe with fake OTP returns 400 INVALID_REQUEST, NOT 403', async () => {
      const res = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/reset-password',
        body: { email: TEST_SUSPENDED_EMAIL, otp: '123456', new_password: 'ValidPassword123' }
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.data.error.code, 'INVALID_REQUEST');
      assert.strictEqual(res.data.error.message, 'Invalid or expired password reset request.');
    });

    await test('10. Suspended Account Enforcement: Reset with valid OTP returns 403 ACCOUNT_SUSPENDED and burns challenge', async () => {
      const validSuspendedOtp = '556677';
      const otpHmac = emailService.computeOtpHmac({
        otp: validSuspendedOtp,
        userId: suspendedUserId,
        email: TEST_SUSPENDED_EMAIL,
        purpose: 'PASSWORD_RESET'
      });
      const [insRes] = await db.query(
        `INSERT INTO email_verifications (user_id, email, otp_hash, purpose, expires_at)
         VALUES (?, ?, ?, 'PASSWORD_RESET', NOW() + INTERVAL 10 MINUTE)`,
        [suspendedUserId, TEST_SUSPENDED_EMAIL, otpHmac]
      );
      const chId = insRes.insertId;

      const res = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/reset-password',
        body: { email: TEST_SUSPENDED_EMAIL, otp: validSuspendedOtp, new_password: 'ValidPassword123' }
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.data.error.code, 'ACCOUNT_SUSPENDED');

      const [burned] = await db.query('SELECT consumed_at FROM email_verifications WHERE id = ?', [chId]);
      assert.ok(burned[0].consumed_at !== null, 'Challenge must be burned on suspended reset rejection');
    });

    // --- TEST 6: Invalid OTP & Durable Attempt Limiting ---
    await test('11. Attempt Tracking: Invalid OTP returns 400 INVALID_OTP and increments attempts_count', async () => {
      const [chBefore] = await db.query(
        'SELECT id, attempts_count FROM email_verifications WHERE user_id = ? AND purpose = "PASSWORD_RESET" AND consumed_at IS NULL',
        [testUserId]
      );
      assert.strictEqual(chBefore[0].attempts_count, 0);

      const res = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/reset-password',
        body: { email: TEST_USER_EMAIL, otp: '000000', new_password: 'ValidNewPassword123' }
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.data.error.code, 'INVALID_OTP');

      const [chAfter] = await db.query(
        'SELECT attempts_count FROM email_verifications WHERE id = ?',
        [chBefore[0].id]
      );
      assert.strictEqual(chAfter[0].attempts_count, 1, 'attempts_count must be durably committed to 1');
    });

    await test('12. Lockout: 5 failed attempts locks challenge with 429 MAX_ATTEMPTS_EXCEEDED and burns challenge', async () => {
      const [ch] = await db.query(
        'SELECT id FROM email_verifications WHERE user_id = ? AND purpose = "PASSWORD_RESET" AND consumed_at IS NULL',
        [testUserId]
      );
      const chId = ch[0].id;

      for (let i = 2; i <= 5; i++) {
        const res = await makeRequest({
          baseUrl,
          path: '/api/v1/auth/reset-password',
          body: { email: TEST_USER_EMAIL, otp: '999999', new_password: 'ValidNewPassword123' }
        });
        if (i < 5) {
          assert.strictEqual(res.statusCode, 400);
        }
      }

      const lockRes = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/reset-password',
        body: { email: TEST_USER_EMAIL, otp: '999999', new_password: 'ValidNewPassword123' }
      });
      assert.strictEqual(lockRes.statusCode, 429);
      assert.strictEqual(lockRes.data.error.code, 'MAX_ATTEMPTS_EXCEEDED');

      const [chBurned] = await db.query('SELECT consumed_at FROM email_verifications WHERE id = ?', [chId]);
      assert.ok(chBurned[0].consumed_at !== null, 'Burned challenge must have consumed_at populated');
    });

    // --- TEST 7: Expired Challenge Rejection ---
    await test('13. Expiration: Expired OTP rejected with 410 OTP_EXPIRED', async () => {
      const rawOtp = '112233';
      const otpHmac = emailService.computeOtpHmac({
        otp: rawOtp,
        userId: testUserId,
        email: TEST_USER_EMAIL,
        purpose: 'PASSWORD_RESET'
      });
      await db.query(
        `INSERT INTO email_verifications (user_id, email, otp_hash, purpose, expires_at, created_at)
         VALUES (?, ?, ?, 'PASSWORD_RESET', NOW() - INTERVAL 5 MINUTE, NOW() - INTERVAL 15 MINUTE)`,
        [testUserId, TEST_USER_EMAIL, otpHmac]
      );

      const res = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/reset-password',
        body: { email: TEST_USER_EMAIL, otp: rawOtp, new_password: 'ValidNewPassword123' }
      });
      assert.strictEqual(res.statusCode, 410);
      assert.strictEqual(res.data.error.code, 'OTP_EXPIRED');

      await db.query('UPDATE email_verifications SET consumed_at = NOW() WHERE user_id = ? AND consumed_at IS NULL', [testUserId]);
    });

    // --- TEST 8: Successful Atomic Password Reset & Immediate Real-time Session Revocation ---
    let validOtp = '654321';
    let priorAccessToken = null;
    await test('14. Atomic Reset & Real-time Access Token Revocation: Immediate 401 SESSION_REVOKED for prior token', async () => {
      await db.query('DELETE FROM email_verifications WHERE user_id = ?', [testUserId]);

      const loginInitial = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/login',
        body: { identifier: TEST_USER_EMAIL, password: INITIAL_PASSWORD }
      });
      assert.strictEqual(loginInitial.statusCode, 200);
      priorAccessToken = loginInitial.data.data.token;
      assert.ok(priorAccessToken, 'Must have active JWT access token');

      const meBefore = await makeRequest({
        baseUrl,
        method: 'GET',
        path: '/api/v1/auth/me',
        headers: { Authorization: `Bearer ${priorAccessToken}` }
      });
      assert.strictEqual(meBefore.statusCode, 200);
      assert.strictEqual(meBefore.data.success, true);

      const otpHmac = emailService.computeOtpHmac({
        otp: validOtp,
        userId: testUserId,
        email: TEST_USER_EMAIL,
        purpose: 'PASSWORD_RESET'
      });
      await db.query(
        `INSERT INTO email_verifications (user_id, email, otp_hash, purpose, expires_at)
         VALUES (?, ?, ?, 'PASSWORD_RESET', NOW() + INTERVAL 10 MINUTE)`,
        [testUserId, TEST_USER_EMAIL, otpHmac]
      );

      const NEW_PASSWORD = 'BrandNewP@ssword2026';
      const resetRes = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/reset-password',
        body: { email: TEST_USER_EMAIL, otp: validOtp, new_password: NEW_PASSWORD }
      });

      assert.strictEqual(resetRes.statusCode, 200);
      assert.strictEqual(resetRes.data.success, true);
      assert.match(resetRes.data.message, /Password reset successfully/i);

      const [consumedCh] = await db.query(
        'SELECT * FROM email_verifications WHERE user_id = ? AND purpose = "PASSWORD_RESET" ORDER BY id DESC LIMIT 1',
        [testUserId]
      );
      assert.ok(consumedCh[0].consumed_at !== null, 'Challenge must be marked consumed');

      const [userRows] = await db.query('SELECT password_hash FROM users WHERE id = ?', [testUserId]);
      const newHashMatches = await bcrypt.compare(NEW_PASSWORD, userRows[0].password_hash);
      assert.strictEqual(newHashMatches, true, 'Updated password hash must match new password');

      const meAfter = await makeRequest({
        baseUrl,
        method: 'GET',
        path: '/api/v1/auth/me',
        headers: { Authorization: `Bearer ${priorAccessToken}` }
      });
      assert.strictEqual(meAfter.statusCode, 401, 'Prior access token MUST be rejected immediately after reset');
      assert.strictEqual(meAfter.data.error.code, 'SESSION_REVOKED');

      const loginNewRes = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/login',
        body: { identifier: TEST_USER_EMAIL, password: NEW_PASSWORD }
      });
      assert.strictEqual(loginNewRes.statusCode, 200);
      assert.strictEqual(loginNewRes.data.success, true);

      const loginOldRes = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/login',
        body: { identifier: TEST_USER_EMAIL, password: INITIAL_PASSWORD }
      });
      assert.strictEqual(loginOldRes.statusCode, 401);
      assert.strictEqual(loginOldRes.data.error.code, 'INVALID_CREDENTIALS');
    });

    // --- TEST 9: Replay Prevention ---
    await test('15. Replay Prevention: Submitting already-consumed OTP fails with 400 INVALID_REQUEST', async () => {
      const replayRes = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/reset-password',
        body: { email: TEST_USER_EMAIL, otp: validOtp, new_password: 'YetAnotherPassword123' }
      });
      assert.strictEqual(replayRes.statusCode, 400);
      assert.strictEqual(replayRes.data.error.code, 'INVALID_REQUEST');
    });

    // --- TEST 10: Concurrency Race Condition Defense on Reset Completion ---
    await test('16. Concurrency Safety: Simultaneous requests for same challenge result in exactly one winner', async () => {
      await db.query('DELETE FROM email_verifications WHERE user_id = ?', [testUserId]);

      const raceOtp = '778899';
      const otpHmac = emailService.computeOtpHmac({
        otp: raceOtp,
        userId: testUserId,
        email: TEST_USER_EMAIL,
        purpose: 'PASSWORD_RESET'
      });
      await db.query(
        `INSERT INTO email_verifications (user_id, email, otp_hash, purpose, expires_at)
         VALUES (?, ?, ?, 'PASSWORD_RESET', NOW() + INTERVAL 10 MINUTE)`,
        [testUserId, TEST_USER_EMAIL, otpHmac]
      );

      const p1 = makeRequest({
        baseUrl,
        path: '/api/v1/auth/reset-password',
        body: { email: TEST_USER_EMAIL, otp: raceOtp, new_password: 'RacePasswordWinner1' }
      });
      const p2 = makeRequest({
        baseUrl,
        path: '/api/v1/auth/reset-password',
        body: { email: TEST_USER_EMAIL, otp: raceOtp, new_password: 'RacePasswordWinner2' }
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      const statusCodes = [r1.statusCode, r2.statusCode].sort();
      assert.deepStrictEqual(statusCodes, [200, 400], 'Exactly one concurrent request must win; the other must receive 400');
    });

    // --- TEST 11: Synchronous Delivery Failure Handling ---
    await test('17. Delivery Failure Invalidation: Phantom OTP burned if mail dispatch fails or times out', async () => {
      await db.query('DELETE FROM email_verifications WHERE user_id = ?', [testUserId]);
      if (authController._clearCooldownReservations) await authController._clearCooldownReservations();

      const originalSendMail = emailService.transporter.sendMail;
      emailService.transporter.sendMail = async () => {
        throw new Error('SMTP connection refused / simulation error');
      };

      let threw = false;
      try {
        await emailService.createAndSendOtp({
          userId: testUserId,
          email: TEST_USER_EMAIL,
          purpose: 'PASSWORD_RESET'
        });
      } catch (err) {
        threw = true;
      } finally {
        emailService.transporter.sendMail = originalSendMail;
      }

      assert.strictEqual(threw, true, 'createAndSendOtp must propagate delivery error');

      const [failedCh] = await db.query(
        'SELECT * FROM email_verifications WHERE user_id = ? AND purpose = "PASSWORD_RESET" ORDER BY id DESC LIMIT 1',
        [testUserId]
      );
      assert.strictEqual(failedCh.length, 1);
      assert.ok(failedCh[0].consumed_at !== null, 'Challenge must be burned on delivery failure so no phantom OTP exists');
    });

    // --- TEST 12: FIX 2 — Secret Environment Configuration Validation ---
    await test('18. FIX 2: Production strictly requires 64-hex random secret; rejects missing/short/placeholders; no fallback', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalSecret = process.env.OTP_HMAC_SECRET;

      try {
        process.env.NODE_ENV = 'production';

        // 1. Missing secret must throw fatal error
        delete process.env.OTP_HMAC_SECRET;
        assert.throws(() => {
          new EmailService();
        }, /FATAL: OTP_HMAC_SECRET environment variable is missing/);

        // 2. Short secret (< 64 hex characters) must throw fatal error
        process.env.OTP_HMAC_SECRET = 'short_insecure_secret_123';
        assert.throws(() => {
          new EmailService();
        }, /exactly 64 hexadecimal characters/);

        // 3. Known placeholder secret must throw fatal error
        process.env.OTP_HMAC_SECRET = '0000000000000000000000000000000000000000000000000000000000000000';
        assert.throws(() => {
          new EmailService();
        }, /cannot be a known trivial or placeholder value/);

        // 4. Non-hex characters must throw fatal error
        process.env.OTP_HMAC_SECRET = 'z'.repeat(64);
        assert.throws(() => {
          new EmailService();
        }, /exactly 64 hexadecimal characters/);

        // 5. Valid 32-byte (64-hex) cryptographically random secret must succeed
        const secureRandomSecret = crypto.randomBytes(32).toString('hex');
        process.env.OTP_HMAC_SECRET = secureRandomSecret;
        const prodService = new EmailService();
        assert.strictEqual(prodService.otpHmacSecret, secureRandomSecret);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalSecret !== undefined) {
          process.env.OTP_HMAC_SECRET = originalSecret;
        } else {
          delete process.env.OTP_HMAC_SECRET;
        }
      }
    });

    // --- TEST 13: Transaction Rollback on Failure After Password Update ---
    await test('19. Transaction Atomicity: Rollback on failure after password update leaves password and challenge unchanged', async () => {
      await db.query('DELETE FROM email_verifications WHERE user_id = ?', [testUserId]);

      const [userBefore] = await db.query('SELECT password_hash FROM users WHERE id = ?', [testUserId]);
      const originalHash = userBefore[0].password_hash;

      const activeSession = await sessionService.createSession({
        userId: testUserId,
        rememberMe: true,
        userAgent: 'RollbackTest/1.0',
        ipAddress: '127.0.0.1'
      });
      assert.ok(activeSession.sessionId);

      const crashOtp = '445566';
      const otpHmac = emailService.computeOtpHmac({
        otp: crashOtp,
        userId: testUserId,
        email: TEST_USER_EMAIL,
        purpose: 'PASSWORD_RESET'
      });
      const [insRes] = await db.query(
        `INSERT INTO email_verifications (user_id, email, otp_hash, purpose, expires_at)
         VALUES (?, ?, ?, 'PASSWORD_RESET', NOW() + INTERVAL 10 MINUTE)`,
        [testUserId, TEST_USER_EMAIL, otpHmac]
      );
      const challengeId = insRes.insertId;

      const res = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/reset-password',
        headers: { 'x-simulate-failure': 'true' },
        body: { email: TEST_USER_EMAIL, otp: crashOtp, new_password: 'ShouldBeRolledBack123' }
      });

      assert.strictEqual(res.statusCode, 500);

      const [userAfter] = await db.query('SELECT password_hash FROM users WHERE id = ?', [testUserId]);
      assert.strictEqual(userAfter[0].password_hash, originalHash, 'Password hash must NOT have changed after rollback');

      const [chAfter] = await db.query('SELECT consumed_at FROM email_verifications WHERE id = ?', [challengeId]);
      assert.strictEqual(chAfter[0].consumed_at, null, 'Challenge must NOT be consumed after transaction rollback');

      const isSessionStillActive = await sessionService.isSessionActive(activeSession.sessionId, testUserId);
      assert.strictEqual(isSessionStillActive, true, 'User sessions must NOT be revoked when reset transaction rolls back');
    });

    // --- TEST 14: FIX 1 — Atomic Cross-Worker Simultaneous Reset Requests ---
    await test('20. FIX 1: Simultaneous requests on separate connections: exactly one admitted, no duplicate OTPs', async () => {
      const ATOMIC_RACE_EMAIL = `atomic_race_${Date.now()}@miljor.pk`;
      if (authController._clearCooldownReservations) await authController._clearCooldownReservations(ATOMIC_RACE_EMAIL);

      // Create an active test user for this race test
      const tempHash = await bcrypt.hash('TempPassword123', 10);
      const [raceUser] = await db.query(
        `INSERT INTO users (full_name, business_name, email, phone, role, password_hash, verification_status, buyer_trust_status)
         VALUES ('Race User', 'Race Corp', ?, '+923009988776', 'BUYER', ?, 'VERIFIED', 'CONTACT_VERIFIED')`,
        [ATOMIC_RACE_EMAIL, tempHash]
      );
      const raceUserId = raceUser.insertId;

      try {
        // Fire 2 simultaneous request-password-reset calls (simulating independent Node.js worker processes)
        const req1 = makeRequest({
          baseUrl,
          path: '/api/v1/auth/request-password-reset',
          body: { email: ATOMIC_RACE_EMAIL }
        });
        const req2 = makeRequest({
          baseUrl,
          path: '/api/v1/auth/request-password-reset',
          body: { email: ATOMIC_RACE_EMAIL }
        });

        const [res1, res2] = await Promise.all([req1, req2]);
        const statuses = [res1.statusCode, res2.statusCode].sort();

        // Exactly ONE request must be admitted (200) and the concurrent racer must receive 429 RATE_LIMITED
        assert.deepStrictEqual(statuses, [200, 429], 'Exactly one concurrent reset request must win; the other must receive 429');

        // Check that exactly ONE active OTP challenge was created in email_verifications
        const [activeChallenges] = await db.query(
          'SELECT id FROM email_verifications WHERE user_id = ? AND purpose = "PASSWORD_RESET" AND consumed_at IS NULL',
          [raceUserId]
        );
        assert.strictEqual(activeChallenges.length, 1, 'Must have created exactly one active OTP challenge, no duplicates');

        // Verify that the identity was recorded in auth_cooldown_reservations
        const identityHash = authController.computeCooldownIdentityHash(ATOMIC_RACE_EMAIL);
        const [cooldownRows] = await db.query(
          'SELECT id, cooldown_until > NOW() AS is_active FROM auth_cooldown_reservations WHERE identity_hash = ?',
          [identityHash]
        );
        assert.strictEqual(cooldownRows.length, 1);
        assert.strictEqual(Number(cooldownRows[0].is_active), 1);
      } finally {
        await db.query('DELETE FROM email_verifications WHERE user_id = ?', [raceUserId]);
        await db.query('DELETE FROM users WHERE id = ?', [raceUserId]);
      }
    });

    // --- TEST 15: FIX 3 — Mail Provider Configuration & Sandbox Isolation Verification ---
    await test('21. FIX 3: Mail transport inspection confirms sandbox isolation and zero credential/OTP leakage', async () => {
      const transportStatus = emailService.verifyMailTransportConfiguration();

      // Verify that sandbox isolation is active and external delivery is NOT enabled in dev/test
      assert.strictEqual(transportStatus.isSandbox, true, 'Environment must be sandbox/mock isolated');
      assert.strictEqual(transportStatus.isAuthorizedForExternalDelivery, false, 'External delivery must NOT be authorized without live SMTP');
      assert.ok(transportStatus.missingProductionKeys.length > 0, 'Must report missing production keys');

      // Verify reset OTP is never returned in response data for any endpoint
      const reqRes = await makeRequest({
        baseUrl,
        path: '/api/v1/auth/request-password-reset',
        body: { email: `leak_check_${Date.now()}@miljor.pk` }
      });
      assert.strictEqual(reqRes.data.otp, undefined, 'request-password-reset response must never contain raw OTP');
      assert.strictEqual(reqRes.data.code, undefined);

      // Verify toJSON() on emailService sanitizes secrets
      const serialized = JSON.stringify(emailService);
      assert.ok(!serialized.includes('otpHmacSecret'), 'Serialized emailService must never expose otpHmacSecret');
      assert.ok(!serialized.includes('mailtrapApiToken'), 'Serialized emailService must never expose mailtrapApiToken');
    });

  } finally {
    // Clean up test records from miljor_test_db
    try {
      if (testUserId) {
        await db.query('DELETE FROM email_verifications WHERE user_id = ?', [testUserId]);
        await db.query('DELETE rt FROM user_refresh_tokens rt JOIN user_sessions s ON rt.session_id = s.session_id WHERE s.user_id = ?', [testUserId]);
        await db.query('DELETE FROM user_sessions WHERE user_id = ?', [testUserId]);
        await db.query('DELETE FROM system_audit_logs WHERE actor_id = ?', [testUserId]);
        await db.query('DELETE FROM users WHERE id = ?', [testUserId]);
      }
      if (suspendedUserId) {
        await db.query('DELETE FROM email_verifications WHERE user_id = ?', [suspendedUserId]);
        await db.query('DELETE FROM users WHERE id = ?', [suspendedUserId]);
      }
      if (authController._clearCooldownReservations) {
        await authController._clearCooldownReservations();
      }
    } catch (cleanupErr) {
      console.warn('⚠️ Cleanup warning:', cleanupErr.message);
    }

    server.close();
  }

  console.log(`\n======================================================`);
  console.log(`🏁 Password Recovery Security Closure Test Results: ${passed}/${total} Passed (100%)`);
  console.log(`======================================================\n`);
  assert.strictEqual(passed, total, `All ${total} tests must pass!`);
}

runTestSuite()
  .then(() => {
    console.log('✅ All Secure Password Recovery Security Closure Tests PASSED successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Test Suite FAILED with error:', err);
    process.exit(1);
  });
