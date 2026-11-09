// =============================================================================
// backend/tests/e2e_password_recovery_sandbox.test.js
// MilJor Package AUTH-032: Level C Real Flow End-to-End Verification
// Uses Mailtrap Sandbox API Message Capture, Legitimate Server Verification,
// Post-Reset Login, Old-Password Invalidation, and Session Revocation
// Target Database: miljor_test_db ONLY
// =============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';
process.env.TRANSACTIONAL_EMAIL_MODE = 'sandbox';
process.env.FORCE_REAL_EMAIL = 'true';

const assert = require('assert');
const https = require('https');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const host = process.env.DB_HOST || 'localhost';
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const testDb = 'miljor_test_db';
const mailtrapToken = process.env.MAILTRAP_API_TOKEN;
const mailtrapInboxId = process.env.MAILTRAP_INBOX_ID || '4955793';

// Fetch helper for Mailtrap API
function fetchMailtrap(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'mailtrap.io',
      port: 443,
      path: apiPath,
      method: 'GET',
      headers: {
        'Api-Token': mailtrapToken,
        'Accept': 'application/json'
      },
      timeout: 15000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
          } catch {
            resolve({ statusCode: res.statusCode, raw: data });
          }
        } else {
          reject(new Error(`Mailtrap API returned ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Mailtrap request timeout')));
    req.on('error', reject);
    req.end();
  });
}

function fetchMailtrapText(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'mailtrap.io',
      port: 443,
      path: apiPath,
      method: 'GET',
      headers: {
        'Api-Token': mailtrapToken
      },
      timeout: 15000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Mailtrap API returned ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Mailtrap request timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function runE2ESandboxTest() {
  console.log('================================================================================');
  console.log('MILJOR AUTH-032: LEVEL C REAL FLOW E2E SANDBOX VERIFICATION');
  console.log('================================================================================');

  // Gate 1: Target Database Identity Check
  console.log('\n▶ Gate 1: Checking Target Database Identity...');
  const conn = await mysql.createConnection({ host, user, password, database: testDb });
  const [[meta]] = await conn.query('SELECT DATABASE() AS current_db');
  console.log(`Connected to: ${meta.current_db}`);
  assert.strictEqual(meta.current_db, testDb, 'Must be strictly connected to miljor_test_db');
  console.log('  ✔ Database connection verified strictly to miljor_test_db');

  // Gate 2: Mailtrap Sandbox Configuration Check
  console.log('\n▶ Gate 2: Checking Mailtrap Sandbox Readiness...');
  assert(mailtrapToken, 'MAILTRAP_API_TOKEN must be configured in environment');
  console.log(`  ✔ Mailtrap token configured, targeting inbox: ${mailtrapInboxId}`);

  // Setup ephemeral Express app on test port
  const express = require('express');
  const app = express();
  app.use(express.json());
  const authRoutes = require('../src/routes/v1/authRoutes');
  app.use('/api/v1/auth', authRoutes);

  const server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api/v1/auth`;
  console.log(`  ✔ Ephemeral test backend active on port ${port}`);

  const testEmail = `auth032_e2e_${Date.now()}@miljor.com`;
  const initialPassword = 'InitialTestPassword123!';
  const newPassword = 'NewStrongPassword2026!';
  let testUserId = null;

  try {
    // 3. Create disposable test user
    console.log(`\n▶ Gate 3: Provisioning isolated test account (${testEmail})...`);
    const initialHash = await bcrypt.hash(initialPassword, 10);
    const [userRes] = await conn.query(
      `INSERT INTO users (full_name, business_name, email, phone, password_hash, role, verification_status, buyer_trust_status)
       VALUES (?, ?, ?, ?, ?, 'BUYER', 'VERIFIED', 'CONTACT_VERIFIED')`,
      ['AUTH-032 E2E Buyer', 'MilJor QA Procurement', testEmail, `0300${Math.floor(1000000 + Math.random() * 9000000)}`, initialHash]
    );
    testUserId = userRes.insertId;
    console.log(`  ✔ Disposable test user created: ID ${testUserId}`);

    // 4. Pre-reset authentication and session capture
    console.log('\n▶ Gate 4: Authenticating test user before reset...');
    const loginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testEmail, password: initialPassword })
    });
    const loginData = await loginRes.json();
    assert.strictEqual(loginRes.status, 200, 'Initial login must succeed');
    const priorToken = loginData.data?.token;
    assert(priorToken, 'Must receive initial access token');

    // Verify token works on /me
    const meRes = await fetch(`${baseUrl}/me`, {
      headers: { 'Authorization': `Bearer ${priorToken}` }
    });
    assert.strictEqual(meRes.status, 200, 'Initial token must authenticate successfully');
    console.log('  ✔ Pre-reset session verified active');

    // 5. Trigger password reset request
    console.log('\n▶ Gate 5: Dispatching password reset request via API...');
    const resetReqRes = await fetch(`${baseUrl}/request-password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail })
    });
    const resetReqData = await resetReqRes.json();
    assert.strictEqual(resetReqRes.status, 200, 'Request password reset must return 200');
    assert.strictEqual(resetReqData.success, true);
    console.log('  ✔ Password reset request accepted by backend');

    // 6. Inspect Mailtrap sandbox inbox and extract legitimate OTP
    console.log('\n▶ Gate 6: Inspecting Mailtrap Sandbox Inbox for message capture...');
    let capturedMessage = null;
    let attempts = 0;
    while (!capturedMessage && attempts < 10) {
      attempts++;
      await new Promise(r => setTimeout(r, 2000));
      const inboxList = await fetchMailtrap(`/api/inboxes/${mailtrapInboxId}/messages`);
      const msg = inboxList.data?.find(m => m.to_email === testEmail);
      if (msg) {
        capturedMessage = msg;
        break;
      }
    }

    assert(capturedMessage, 'Mailtrap sandbox must capture password reset email for test identity');
    console.log(`  ✔ Message successfully captured in Mailtrap inbox (Message ID: ${capturedMessage.id})`);

    // Verify Outbox-to-Mailtrap ID Correlation (Section 3)
    const [outboxRows] = await conn.query(
      `SELECT id, status, provider_message_id, template_name, recipient_email
       FROM transactional_email_outbox
       WHERE recipient_email = ? AND template_name = 'PASSWORD_RESET_OTP'
       ORDER BY id DESC LIMIT 1`,
      [testEmail]
    );
    assert.ok(outboxRows.length > 0, 'Must record outbox dispatch entry');
    const outboxEntry = outboxRows[0];
    assert.strictEqual(outboxEntry.status, 'PROVIDER_ACCEPTED', 'Outbox status must be PROVIDER_ACCEPTED');
    assert.strictEqual(String(outboxEntry.provider_message_id), String(capturedMessage.id), 'Provider message ID must correlate 1:1 with captured sandbox message ID');
    console.log(`  ✔ Mailtrap message correlation verified: Outbox provider_message_id (${outboxEntry.provider_message_id}) === Inbox message ID (${capturedMessage.id})`);

    // Fetch message body text using txt_path
    const messageBody = await fetchMailtrapText(capturedMessage.txt_path);
    assert(capturedMessage.subject.includes('MilJor') && messageBody.includes('password reset code is'), 'Message must be authentic MilJor password reset template');
    assert(messageBody.includes('expire in 10 minutes') || messageBody.includes('10 minutes'), 'Message body must state 10 minute expiration');

    // Extract 6-digit OTP in-memory without logging it
    const otpMatch = messageBody.match(/\b([0-9]{6})\b/);
    assert(otpMatch && otpMatch[1], 'Must securely extract 6-digit OTP from message body');
    const capturedOtp = otpMatch[1];
    console.log('  ✔ 6-digit numeric OTP extracted securely in-memory (not disclosed in logs)');

    // 7. Execute reset-password using captured OTP
    console.log('\n▶ Gate 7: Executing password reset with captured OTP...');
    const resetRes = await fetch(`${baseUrl}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        otp: capturedOtp,
        new_password: newPassword
      })
    });
    const resetData = await resetRes.json();
    assert.strictEqual(resetRes.status, 200, 'Password reset must succeed with captured OTP');
    assert.strictEqual(resetData.success, true);
    console.log('  ✔ Password reset committed atomically in database');

    // 8. Verify previous session was revoked
    console.log('\n▶ Gate 8: Verifying previous authenticated session revocation...');
    const postResetMe = await fetch(`${baseUrl}/me`, {
      headers: { 'Authorization': `Bearer ${priorToken}` }
    });
    assert.strictEqual(postResetMe.status, 401, 'Prior session token must be immediately rejected with 401');
    console.log('  ✔ Old session token successfully revoked upon password change');

    // 9. Verify credential updates: old password rejected, new password accepted
    console.log('\n▶ Gate 9: Verifying credential updates...');
    const oldLoginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testEmail, password: initialPassword })
    });
    assert.strictEqual(oldLoginRes.status, 401, 'Old password must fail authentication');

    const newLoginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: testEmail, password: newPassword })
    });
    const newLoginData = await newLoginRes.json();
    assert.strictEqual(newLoginRes.status, 200, 'New password must authenticate successfully');
    assert(newLoginData.data?.token, 'Must receive fresh active access token');
    console.log('  ✔ Old password rejected; new password authenticated successfully');

    // 10. Replay prevention: submitting consumed OTP must be rejected
    console.log('\n▶ Gate 10: Verifying OTP replay prevention...');
    const replayRes = await fetch(`${baseUrl}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        otp: capturedOtp,
        new_password: 'AnotherPassword999!'
      })
    });
    const replayData = await replayRes.json();
    assert(replayRes.status === 400 || replayRes.status === 409, 'Replay of consumed OTP must fail');
    assert.strictEqual(replayData.success, false);
    console.log('  ✔ Consumed OTP replay rejected by single-use guard');

    console.log('\n================================================================================');
    console.log('LEVEL C VERIFICATION VERDICT: ALL 10 E2E GATES PASSED (100% GREEN)');
    console.log('================================================================================\n');

  } finally {
    // 11. Deterministic cleanup
    if (testUserId) {
      console.log(`Cleaning up test user ${testUserId}...`);
      try {
        await conn.query('DELETE FROM user_refresh_tokens WHERE session_id IN (SELECT session_id FROM user_sessions WHERE user_id = ?)', [testUserId]);
        await conn.query('DELETE FROM user_sessions WHERE user_id = ?', [testUserId]);
        await conn.query('DELETE FROM email_verifications WHERE user_id = ?', [testUserId]);
        await conn.query('DELETE FROM system_audit_logs WHERE actor_id = ?', [testUserId]);
        await conn.query('DELETE FROM users WHERE id = ?', [testUserId]);
        console.log('  ✔ Isolated test user resources cleaned up deterministically');
      } catch (cleanErr) {
        console.error('Non-fatal cleanup warning:', cleanErr.message);
      }
    }
    await conn.end();
    server.close();
  }
}

runE2ESandboxTest()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ E2E Sandbox Test Failed:', err);
    process.exit(1);
  });
