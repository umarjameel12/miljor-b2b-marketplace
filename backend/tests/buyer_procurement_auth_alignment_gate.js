'use strict';

// Buyer acceptance source checks — safe, no database and no external payment provider.
// Run with: node backend/tests/buyer_procurement_auth_alignment_gate.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const auth = read('backend/src/controllers/authController.js');
const request = read('backend/src/services/procurementRequestService.js');
const recurring = read('backend/src/services/procurementRecurringService.js');
const collective = read('backend/src/services/procurementCollectiveService.js');
const authContext = read('frontend/src/context/AuthContext.jsx');
const rfq = read('frontend/src/pages/RfqPage.jsx');
const routes = read('backend/src/routes/v1/procurementRoutes.js');

const checks = [
  ['Buyer signup requests OTP verification', () => assert.match(auth, /requires_verification:\s*assignedRole === 'BUYER'/)],
  ['Buyer OTP dispatched only after registration commits', () => {
    const committed = auth.indexOf('await connection.commit()');
    const otp = auth.indexOf("await emailService.createAndSendOtp({\n            userId");
    assert.ok(committed >= 0 && otp > committed);
  }],
  ['OTP never automatically verifies suppliers', () => assert.match(auth, /WHEN role = 'BUYER' AND verification_status NOT IN \('BLOCKED', 'VERIFIED'\)/)],
  ['Blocked accounts cannot receive buyer verification', () => assert.match(auth, /WHEN role = 'BUYER' AND verification_status <> 'BLOCKED'/)],
  ['Buyer request accepts verified-email status', () => assert.match(request, /\['VERIFIED', 'EMAIL_VERIFIED'\]\.includes\(rows\[0\]\.verification_status\)/)],
  ['Buyer request requires is_verified', () => assert.match(request, /Number\(rows\[0\]\.is_verified\) !== 1/)],
  ['Buyer request rejects suspended buyers', () => assert.match(request, /buyer_trust_status === 'SUSPENDED'/)],
  ['Collective requires buyer role and verified flag', () => assert.match(collective, /role='BUYER' AND is_verified=1/)],
  ['Collective accepts email verified buyer', () => assert.match(collective, /verification_status IN \('VERIFIED','EMAIL_VERIFIED'\)/)],
  ['Recurring requires buyer role and verified flag', () => assert.match(recurring, /role='BUYER' AND is_verified=1/)],
  ['Recurring accepts email verified buyer', () => assert.match(recurring, /verification_status IN \('VERIFIED','EMAIL_VERIFIED'\)/)],
  ['Auth context refreshes server profile after OTP', () => assert.match(authContext, /const profile = await authApi\.getMe\(\)/)],
  ['B6 requests stay on canonical endpoints', () => assert.match(rfq, /\/api\/v1\/procurement\/requests/)],
  ['Retired RFQ calls removed', () => assert.doesNotMatch(rfq, /\/api\/v1\/rfqs(?:\/|['"`])/)],
  ['Buyer has actionable verification link', () => assert.match(rfq, /to="\/verify-email" state=\{\{ email: user\.email \}\}/)],
  ['Legacy endpoints remain disabled server-side', () => assert.match(routes, /LEGACY_PROCUREMENT_ENDPOINT_RETIRED/)]
];

let passed = 0;
for (const [label, run] of checks) {
  try {
    run();
    console.log('PASS ' + label);
    passed++;
  } catch (error) {
    console.error('FAIL ' + label + ': ' + error.message);
    process.exitCode = 1;
  }
}
console.log(passed + '/' + checks.length + ' buyer source checks passed');
