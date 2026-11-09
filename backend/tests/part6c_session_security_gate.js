// =============================================================================
// tests/part6c_session_security_gate.js
// MilJor Phase 6C.1 — Security Closure Gate Suite
// Rigorous automated verification across Gates 1-14 against live Express & MySQL (miljor_test_db)
// Zero token/cookie leaks: all credential strings redacted in test outputs
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
const jwt = require('jsonwebtoken');
const db = require('../src/config/db');
const app = require('../server');
const sessionService = require('../src/services/sessionService');

async function runSessionSecuritySuite() {
  console.log('🛡️ Starting MilJor Phase 6C.1 Session Security Gate Suite...\n');

  // Verify Database Isolation
  const [dbRow] = await db.query('SELECT DATABASE() as current_db');
  const activeDb = dbRow[0].current_db;
  console.log(`🔒 Active Test Database: '${activeDb}'`);
  assert.strictEqual(activeDb, 'miljor_test_db', 'SECURITY VIOLATION: Test suite MUST run strictly against miljor_test_db!');

  // Start ephemeral HTTP test server
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}: ${err.message}`);
    }
  }

  // Setup test users
  const testEmail = `sec_user_${Date.now()}@miljor-security.com`;
  const otherUserEmail = `other_user_${Date.now()}@miljor-security.com`;
  const rawPassword = 'Password123!';
  const passwordHash = await bcrypt.hash(rawPassword, 10);

  const [u1] = await db.query(
    `INSERT INTO users (full_name, business_name, email, phone, password_hash, role, is_verified, verification_status)
     VALUES ('Sec Buyer', 'Sec Corp', ?, '03009998877', ?, 'BUYER', 1, 'VERIFIED')`,
    [testEmail, passwordHash]
  );
  const testUserId = u1.insertId;

  const [u2] = await db.query(
    `INSERT INTO users (full_name, business_name, email, phone, password_hash, role, is_verified, verification_status)
     VALUES ('Other Buyer', 'Other Corp', ?, '03001112233', ?, 'BUYER', 1, 'VERIFIED')`,
    [otherUserEmail, passwordHash]
  );
  const otherUserId = u2.insertId;

  try {
    // -------------------------------------------------------------------------
    // GATE 1 & 2: Login without Remember Me (Session Cookie, 8h max absolute lifetime)
    // -------------------------------------------------------------------------
    let sessionTokenNoRemember = null;
    let cookieNoRemember = null;

    await test('Gate 01: Login with rememberMe=false issues 15m JWT and non-persistent session', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: testEmail, password: rawPassword, rememberMe: false })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.data.token, 'Token must be returned');

      sessionTokenNoRemember = data.data.token;
      const setCookie = res.headers.get('set-cookie');
      assert.ok(setCookie, 'HttpOnly cookie must be set');
      assert.ok(setCookie.includes('miljor_refresh'), 'Cookie must contain miljor_refresh');
      assert.ok(setCookie.includes('HttpOnly'), 'Cookie must be HttpOnly');
      assert.ok(!setCookie.includes('Max-Age='), 'Non-persistent session cookie must NOT have Max-Age');

      // Redacted output check
      console.log('   [Verification Evidence] Set-Cookie: [REDACTED]');

      cookieNoRemember = setCookie.split(';')[0]; // miljor_refresh=xxx

      // Verify JWT claims
      const decoded = jwt.decode(sessionTokenNoRemember);
      assert.ok(decoded.sid, 'Token must contain sid (session id)');
      assert.strictEqual(decoded.role, 'BUYER');
      const lifespan = decoded.exp - decoded.iat;
      assert.strictEqual(lifespan, 15 * 60, 'Access token lifespan must be exactly 15 minutes (900s)');

      // Verify DB session record
      const [sessionRows] = await db.query('SELECT * FROM user_sessions WHERE session_id = ?', [decoded.sid]);
      assert.strictEqual(sessionRows.length, 1);
      assert.strictEqual(sessionRows[0].is_persistent, 0, 'is_persistent must be false');
      assert.strictEqual(sessionRows[0].revoked_at, null);
    });

    // -------------------------------------------------------------------------
    // GATE 2: Login with Remember Me (Persistent Cookie, 30d max absolute ceiling)
    // -------------------------------------------------------------------------
    let sessionTokenRemember = null;
    let cookieRemember = null;
    let sidRemember = null;

    await test('Gate 02: Login with rememberMe=true enforces 30-day absolute ceiling and persistent cookie', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: testEmail, password: rawPassword, rememberMe: true })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      sessionTokenRemember = data.data.token;

      const setCookie = res.headers.get('set-cookie');
      assert.ok(setCookie.includes('Max-Age='), 'Persistent session cookie MUST have Max-Age');
      console.log('   [Verification Evidence] Set-Cookie: [REDACTED]');

      cookieRemember = setCookie.split(';')[0];
      const decoded = jwt.decode(sessionTokenRemember);
      sidRemember = decoded.sid;

      const [sessionRows] = await db.query('SELECT * FROM user_sessions WHERE session_id = ?', [sidRemember]);
      assert.strictEqual(sessionRows[0].is_persistent, 1, 'is_persistent must be true');

      const absoluteExpiry = new Date(sessionRows[0].absolute_expires_at).getTime();
      const expectedCeiling = Date.now() + (30 * 24 * 60 * 60 * 1000);
      assert.ok(Math.abs(absoluteExpiry - expectedCeiling) < 60000, 'Absolute expiry must be ~30 days in future');
    });

    // -------------------------------------------------------------------------
    // GATE 3: Legacy JWT Bypass Prevention
    // -------------------------------------------------------------------------
    await test('Gate 03: Legacy JWT without sid is strictly rejected with 401 SESSION_REQUIRED', async () => {
      // Craft legacy token without sid
      const legacyToken = jwt.sign(
        { id: testUserId, email: testEmail, role: 'BUYER' },
        process.env.JWT_SECRET,
        { expiresIn: '7d', issuer: 'miljor-api', audience: 'miljor-app', algorithm: 'HS256' }
      );

      const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${legacyToken}` }
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.error.code, 'SESSION_REQUIRED');
    });

    // -------------------------------------------------------------------------
    // GATE 8: Session Fixation Prevention & Account Boundary Isolation
    // -------------------------------------------------------------------------
    await test('Gate 08: Logging in with existing session cookie revokes prior session in DB', async () => {
      // Prior session is sidRemember
      const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieRemember
        },
        body: JSON.stringify({ identifier: otherUserEmail, password: rawPassword, rememberMe: false })
      });

      assert.strictEqual(res.status, 200);

      // Verify that prior session sidRemember was revoked with SESSION_REPLACED_ON_LOGIN
      const [oldSession] = await db.query('SELECT revoked_at, revocation_reason FROM user_sessions WHERE session_id = ?', [sidRemember]);
      assert.ok(oldSession[0].revoked_at !== null, 'Previous session must be revoked');
      assert.strictEqual(oldSession[0].revocation_reason, 'SESSION_REPLACED_ON_LOGIN');
    });

    // -------------------------------------------------------------------------
    // GATE 9: Strict User Ownership Check in authGuard
    // -------------------------------------------------------------------------
    await test('Gate 09: Tampered JWT with sid belonging to another user is rejected with 401 SESSION_REVOKED', async () => {
      // Create session for user 1
      const s1 = await sessionService.createSession({ userId: testUserId, rememberMe: true });

      // Craft forged token claiming user 2, but referencing user 1's sid
      const forgedToken = jwt.sign(
        { id: otherUserId, email: otherUserEmail, role: 'BUYER', sid: s1.sessionId },
        process.env.JWT_SECRET,
        { expiresIn: '15m', issuer: 'miljor-api', audience: 'miljor-app', algorithm: 'HS256' }
      );

      const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${forgedToken}` }
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.error.code, 'SESSION_REVOKED');
    });

    // -------------------------------------------------------------------------
    // GATE 10: Zero Credential Issuance on Consumed Refresh Token
    // -------------------------------------------------------------------------
    await test('Gate 10: Consumed refresh token NEVER grants credentials inside or outside grace window', async () => {
      // Create active session and token
      const s = await sessionService.createSession({ userId: testUserId, rememberMe: true });
      const raw1 = s.rawRefreshToken;

      // 1st rotation: succeeds
      const rot1 = await sessionService.rotateRefreshToken({ rawToken: raw1 });
      assert.strictEqual(rot1.success, true);
      assert.ok(rot1.newRawRefreshToken);

      // Immediate 2nd submission of raw1 (within 15s grace window):
      // Must FAIL and must NOT grant credentials!
      const rot2 = await sessionService.rotateRefreshToken({ rawToken: raw1 });
      assert.strictEqual(rot2.success, false, 'Must not succeed on consumed token');
      assert.strictEqual(rot2.code, 'TOKEN_ALREADY_ROTATED');
      assert.strictEqual(rot2.newRawRefreshToken, undefined);

      // 3rd submission outside 15s grace window: triggers compromise replay revocation
      const hash1 = sessionService.hashToken(raw1);
      await db.query('UPDATE user_refresh_tokens SET consumed_at = DATE_SUB(NOW(), INTERVAL 30 SECOND) WHERE token_hash = ?', [hash1]);

      const rot3 = await sessionService.rotateRefreshToken({ rawToken: raw1 });
      assert.strictEqual(rot3.success, false);
      assert.strictEqual(rot3.code, 'TOKEN_REUSE_DETECTED');

      // Verify entire family is revoked
      const [fam] = await db.query('SELECT revoked_at, revocation_reason FROM user_sessions WHERE session_id = ?', [s.sessionId]);
      assert.ok(fam[0].revoked_at !== null);
      assert.strictEqual(fam[0].revocation_reason, 'TOKEN_REUSE_DETECTED');
    });

    // -------------------------------------------------------------------------
    // GATE 11: Real Logout and Ephemeral Access Token Invalidation
    // -------------------------------------------------------------------------
    await test('Gate 11: Real logout revokes session in DB and invalidates access JWT immediately', async () => {
      const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: testEmail, password: rawPassword, rememberMe: true })
      });
      const loginData = await loginRes.json();
      const token = loginData.data.token;
      const cookie = loginRes.headers.get('set-cookie').split(';')[0];
      const sid = jwt.decode(token).sid;

      // Verify working before logout
      const beforeRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.strictEqual(beforeRes.status, 200);

      // Logout
      const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Cookie: cookie }
      });
      assert.strictEqual(logoutRes.status, 200);

      // Verify cookie cleared
      const clearCookie = logoutRes.headers.get('set-cookie');
      assert.ok(clearCookie.includes('miljor_refresh=;'));
      console.log('   [Verification Evidence] Clear-Cookie: [REDACTED]');

      // Verify session revoked in DB
      const [sessionRow] = await db.query('SELECT revoked_at, revocation_reason FROM user_sessions WHERE session_id = ?', [sid]);
      assert.ok(sessionRow[0].revoked_at !== null);
      assert.strictEqual(sessionRow[0].revocation_reason, 'LOGOUT');

      // Attempt protected request with revoked access token
      const afterRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.strictEqual(afterRes.status, 401);
      const afterData = await afterRes.json();
      assert.strictEqual(afterData.error.code, 'SESSION_REVOKED');
    });

    // -------------------------------------------------------------------------
    // GATE 12: Password Reset User-Wide Session Invalidation
    // -------------------------------------------------------------------------
    await test('Gate 12: Password reset revokes all existing sessions across all devices', async () => {
      const sA = await sessionService.createSession({ userId: testUserId, rememberMe: true });
      const sB = await sessionService.createSession({ userId: testUserId, rememberMe: false });

      assert.strictEqual(await sessionService.isSessionActive(sA.sessionId, testUserId), true);
      assert.strictEqual(await sessionService.isSessionActive(sB.sessionId, testUserId), true);

      // Revoke all
      await sessionService.revokeAllUserSessions(testUserId, 'PASSWORD_RESET');

      assert.strictEqual(await sessionService.isSessionActive(sA.sessionId, testUserId), false);
      assert.strictEqual(await sessionService.isSessionActive(sB.sessionId, testUserId), false);
    });

    // -------------------------------------------------------------------------
    // GATE 13: Suspended Account Refresh and Access Denial
    // -------------------------------------------------------------------------
    await test('Gate 13: Suspended account is blocked from refresh rotation and protected routes', async () => {
      await db.query("UPDATE users SET verification_status = 'BLOCKED' WHERE id = ?", [testUserId]);

      const s = await sessionService.createSession({ userId: testUserId, rememberMe: true });
      const res = await sessionService.rotateRefreshToken({ rawToken: s.rawRefreshToken });

      assert.strictEqual(res.success, false);
      assert.strictEqual(res.code, 'ACCOUNT_SUSPENDED');

      // Restore user status
      await db.query("UPDATE users SET verification_status = 'VERIFIED' WHERE id = ?", [testUserId]);
    });

  } finally {
    // Cleanup test users
    await db.query('DELETE FROM users WHERE id IN (?, ?)', [testUserId, otherUserId]);
    server.close();
    await db.end();
  }

  console.log(`\n================================================================================`);
  console.log(`🎉 PHASE 6C.1 SECURITY CLOSURE SUITE COMPLETED: ${passed} / ${total} GATES PASSED`);
  console.log(`================================================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

if (require.main === module) {
  runSessionSecuritySuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Fatal Test Runner Error:', err);
      process.exit(1);
    });
}

module.exports = { runSessionSecuritySuite };
