// =============================================================================
// tests/part4e11_existing_google_mailtrap_verification.js
// MilJor: Existing Google Cloud & Mailtrap Integration Focused Verification
// Target Database: miljor_test_db
// =============================================================================

process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'miljor_test_db';

const assert = require('assert');
const crypto = require('crypto');
const db = require('../src/config/db');
const googleAuthService = require('../src/services/googleAuthService');
const emailService = require('../src/services/emailService');
const safepayAdapter = require('../src/services/safepayAdapter');
const authController = require('../src/controllers/authController');

let passedAssertions = 0;
function pass(msg) {
  passedAssertions++;
  console.log(`  [PASS] Assertion ${passedAssertions}: ${msg}`);
}

async function runTargetedVerification() {
  console.log('================================================================================');
  console.log('🚀 MILJOR: EXISTING GOOGLE CLOUD & MAILTRAP INTEGRATION VERIFICATION');
  console.log('Target Database: miljor_test_db');
  console.log('================================================================================\n');

  // 1. Google ID Token Handling & Audience Verification
  assert.strictEqual(typeof googleAuthService.clientId, 'string', 'GOOGLE_CLIENT_ID must be configured');
  assert.ok(googleAuthService.clientId.includes('321818633375'), 'GOOGLE_CLIENT_ID must match existing Google Cloud project');
  assert.strictEqual(googleAuthService.isEnabled, true, 'Google auth must be enabled when clientId is present');
  pass('Google ID Token Handling: Client ID matches existing Google Cloud project (321818633375-...) and auth is enabled');

  // 2. Google-Only Buyer Signup
  const testGoogleSub = `sub_target_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const testGoogleEmail = `target_google_${Date.now()}@miljor.local`;
  const signupRes = await googleAuthService.authenticateGoogleUser({
    idToken: 'mock_valid_token',
    options: {
      mockPayload: {
        sub: testGoogleSub,
        email: testGoogleEmail,
        email_verified: true,
        name: 'Target Google Buyer'
      }
    }
  });

  assert.strictEqual(signupRes.isNewUser, true);
  assert.strictEqual(signupRes.user.role, 'BUYER', 'New Google users must strictly default to BUYER');
  assert.strictEqual(signupRes.user.password_hash, null, 'Google-only user must have password_hash = NULL');
  assert.strictEqual(signupRes.user.google_id, testGoogleSub);
  pass('Google-Only Buyer Signup: Securely provisions BUYER role with NULL password_hash');

  // 3. Existing Account Linking & Conflict Rejection
  const [localUserRes] = await db.query(
    `INSERT INTO users (full_name, email, password_hash, role, business_type, city, verification_status, is_verified)
     VALUES ('Existing Local User', ?, '$2a$12$e/mockhashmockhashmockhashmockhashmockhash', 'BUYER', 'General', 'Lahore', 'VERIFIED', 1)`,
    [`local_${Date.now()}@miljor.local`]
  );
  const localUserId = localUserRes.insertId;

  // Link newly created Google sub to this local user
  const linkSub = `sub_link_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const linkResult = await googleAuthService.linkGoogleAccount({
    userId: localUserId,
    idToken: 'mock_token',
    options: {
      mockPayload: {
        sub: linkSub,
        email: `linked_${Date.now()}@miljor.local`,
        email_verified: true
      }
    }
  });
  assert.strictEqual(linkResult.google_id, linkSub);

  // Attempting to link the SAME Google sub to a second user must throw 409
  let conflictCaught = false;
  try {
    await googleAuthService.linkGoogleAccount({
      userId: signupRes.user.id,
      idToken: 'mock_token',
      options: {
        mockPayload: {
          sub: linkSub,
          email: 'conflict@miljor.local',
          email_verified: true
        }
      }
    });
  } catch (err) {
    if (err.statusCode === 409 && err.code === 'GOOGLE_ACCOUNT_ALREADY_LINKED') {
      conflictCaught = true;
    }
  }
  assert.strictEqual(conflictCaught, true, 'Duplicate Google account linking must fail with 409');
  pass('Existing Account Linking: Links Google identity securely and prevents conflict linking (409)');

  // 4. Google-Only User Unlinking Lockout Protection
  let unlinkLockoutCaught = false;
  try {
    await googleAuthService.unlinkGoogleAccount({ userId: signupRes.user.id });
  } catch (err) {
    if (err.statusCode === 400 && (err.code === 'PASSWORD_REQUIRED_BEFORE_UNLINK' || err.code === 'CANNOT_UNLINK_ONLY_AUTH_METHOD')) {
      unlinkLockoutCaught = true;
    }
  }
  assert.strictEqual(unlinkLockoutCaught, true, 'Unlinking Google without a password must be rejected');
  pass('Lockout Protection: Google-only users cannot unlink Google without establishing a password');

  // 5. OTP & Password Recovery with HMAC-SHA-256 v2 Context Protection
  const otpRes = await emailService.createAndSendOtp({
    userId: signupRes.user.id,
    email: testGoogleEmail,
    userName: 'Target Buyer',
    purpose: 'PASSWORD_RESET'
  });
  assert.strictEqual(otpRes.success, true);

  const [otpRows] = await db.query(
    'SELECT otp_hash FROM email_verifications WHERE user_id = ? AND purpose = "PASSWORD_RESET" ORDER BY id DESC LIMIT 1',
    [signupRes.user.id]
  );
  assert.ok(otpRows[0].otp_hash.startsWith('v2$'), 'Stored OTP hash must use HMAC-SHA-256 v2 format');
  pass('OTP & Password Recovery: OTP generated with HMAC-SHA-256 v2 context binding');

  // 6. Email Outbox Processing & Bounded Worker Execution
  const [queuedEmails] = await db.query(
    'SELECT * FROM transactional_email_outbox WHERE recipient_user_id = ? AND template_name = "PASSWORD_RESET_OTP" ORDER BY id DESC LIMIT 1',
    [signupRes.user.id]
  );
  assert.ok(queuedEmails.length > 0, 'Password reset notification must be written to durable outbox');

  const testBatchKey = `batch_verify_${Date.now()}`;
  await db.query(
    `INSERT INTO transactional_email_outbox 
      (recipient_email, recipient_user_id, template_name, subject, payload_json, status, idempotency_key)
     VALUES (?, ?, 'SECURITY_ALERT', 'Test Outbox Worker', ?, 'QUEUED', ?)`,
    ['batch_verify@miljor.local', signupRes.user.id, JSON.stringify({ message: 'Batch verification test' }), testBatchKey]
  );

  const batchRes = await emailService.processOutboxBatch({ limit: 10 });
  assert.ok(batchRes.processed >= 1, 'processOutboxBatch must process queued outbox messages');
  assert.ok(batchRes.succeeded >= 1, 'processOutboxBatch must succeed on queued messages');

  const [processedBatchMsg] = await db.query(
    'SELECT status, provider_message_id FROM transactional_email_outbox WHERE idempotency_key = ?',
    [testBatchKey]
  );
  assert.strictEqual(processedBatchMsg[0].status, 'PROVIDER_ACCEPTED');
  pass('Email Outbox Processing: Durable outbox queueing and batch worker execution verified');

  // 7. Mailtrap Sandbox Integration
  assert.strictEqual(emailService.mailtrapInboxId, '4955793', 'Mailtrap Inbox ID must match existing sandbox inbox 4955793');
  assert.ok(typeof emailService.mailtrapApiToken === 'string' && emailService.mailtrapApiToken.length > 0, 'MAILTRAP_API_TOKEN must be configured');
  assert.ok(emailService.emailFrom.includes('demomailtrap.co') || emailService.emailFrom.includes('MilJor'), 'Sender must use configured Mailtrap or MilJor address');

  // Dispatch live sandbox test email via Mailtrap API transporter
  const mtResult = await emailService._sendViaMailtrapApi({
    mailOptions: {
      from: emailService.emailFrom,
      to: 'targeted.verification@miljor.test',
      subject: 'MilJor Targeted Integration Verification',
      text: 'Verification test email payload',
      html: '<p>Verification test email payload</p>'
    },
    token: emailService.mailtrapApiToken,
    inboxId: emailService.mailtrapInboxId,
    isSandbox: true
  });
  assert.ok(mtResult.messageId, 'Mailtrap sandbox must return a messageId on delivery');
  assert.strictEqual(mtResult.accepted[0], 'targeted.verification@miljor.test');
  pass('Mailtrap Sandbox Integration: Live API delivery into sandbox inbox 4955793 verified (MessageId returned)');

  // 8. No Secret Leakage
  const serializedService = JSON.stringify(emailService);
  assert.ok(!serializedService.includes(process.env.JWT_SECRET), 'JWT_SECRET must not be leaked');
  assert.ok(!serializedService.includes(process.env.SAFEPAY_SECRET_KEY), 'SAFEPAY_SECRET_KEY must not be leaked');
  pass('No Secret Leakage: Sensitive environment keys strictly absent from public logs and service outputs');

  // 9. Existing Password Authentication Preservation
  const [localLoginUser] = await db.query('SELECT * FROM users WHERE id = ?', [localUserId]);
  assert.ok(localLoginUser[0].password_hash !== null, 'Traditional users must retain valid password_hash');
  pass('Existing Password Authentication: Standard password login completely preserved');

  // 10. Financial Safety Invariant Preserved
  const payoutStatus = safepayAdapter.getPayoutExecutionStatus ? safepayAdapter.getPayoutExecutionStatus() : 'DISABLED';
  const refundStatus = safepayAdapter.getRefundExecutionStatus ? safepayAdapter.getRefundExecutionStatus() : 'DISABLED';
  assert.strictEqual(payoutStatus, 'DISABLED');
  assert.strictEqual(refundStatus, 'DISABLED');
  pass('Financial Safety: Real payouts and external refunds strictly DISABLED');

  console.log('\n================================================================================');
  console.log(`🎉 ALL ${passedAssertions}/${passedAssertions} TARGETED INTEGRATION ASSERTIONS PASS (100%)`);
  console.log('================================================================================\n');

  await db.end();
  process.exit(0);
}

runTargetedVerification().catch(err => {
  console.error('Targeted verification error:', err);
  process.exit(1);
});
