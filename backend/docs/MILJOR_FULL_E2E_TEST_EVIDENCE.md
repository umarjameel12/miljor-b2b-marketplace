# MilJor — Master E2E & Post-Acceptance Test Evidence Log

**Date:** 2026-11-12  
**Active Test Runner:** `backend/tests/master_e2e_acceptance_runner.js`  
**Execution Environment:** Node.js v24.20.0, MySQL 8.0, Windows PowerShell  
**Target Database:** `miljor_test_db`  
**Protected Database:** `miljor_db`  

---

## 1. Master E2E Runner Execution Output (31 / 31 PASS)

```
================================================================================
🚀 MILJOR MASTER E2E IMPLEMENTATION & FINAL DEMO ACCEPTANCE SUITE
================================================================================

[INIT] Test HTTP server listening on http://127.0.0.1:58603

--- PHASE 0: REPOSITORY BASELINE & DATABASE AUDIT ---
✅ MySQL Database connected successfully to miljor_test_db!
[PASS] PHASE_0 - Test 1: Database isolation verified: active database is miljor_test_db
[PASS] PHASE_0 - Test 2: Financial safety lock verified: ALLOW_EXTERNAL_MONEY_MOVEMENT=false

--- PHASE 1: BUYER JOURNEY (REGISTRATION -> CHECKOUT) ---
[PASS] PHASE_1 - Test 3: Buyer registration enforces unique email check (409 Conflict)
[PASS] PHASE_1 - Test 4: New buyer registered successfully (ID: 432) with Lahore base cluster
[PASS] PHASE_1 - Test 5: Buyer login authenticated successfully with valid JWT token
[PASS] PHASE_1 - Test 6: Invalid credentials fail closed with 401 Unauthorized
[PASS] PHASE_1 - Test 7: Unified pool discovered: ID 1 (Basmati Rice Premium) with authoritative server clock
[PASS] PHASE_1 - Test 8: Buyer created reservation ID 511 for quantity 25
[PASS] PHASE_1 - Test 9: Order created (ID: 153) with total PKR 9,600 awaiting payment

--- PHASE 2: SAFEPAY SANDBOX PAYMENT & FINANCIAL INTEGRITY ---
[PASS] PHASE_2 - Test 10: Safepay sandbox credentials verified without exposing secret values
[PASS] PHASE_2 - Test 11: Hosted Safepay checkout URL generated with authoritative sandbox query params
[PASS] PHASE_2 - Test 12: Webhook signature verified via HMAC-SHA512 over raw payload; tampered signature rejected
[PASS] PHASE_2 - Test 13: Order atomically transitioned to payment_status=PAID, order_status=PAID
[PASS] PHASE_2 - Test 14: Invoice issued (ID: 78) with matching order amount PKR 9,600.00
[PASS] PHASE_2 - Test 15: Refund guard fails closed: external money movement remains disabled

--- PHASE 3: SUPPLIER JOURNEY (LOGIN -> CATALOG -> FULFILLMENT) ---
[PASS] PHASE_3 - Test 16: Supplier profile verified with VERIFIED status and full catalog entitlements
[PASS] PHASE_3 - Test 17: Supplier specification validated: Super Kernel Basmati Rice 25kg (Super Kernel Mills, 25.00 kg)
[PASS] PHASE_3 - Test 18: Supplier fulfillment queue contains 15 PAID orders; unpaid orders excluded
[PASS] PHASE_3 - Test 19: Cross-supplier order isolation verified: supplier cannot view competitor orders

--- PHASE 4: DELIVERY, SHORTAGE SCENARIO & DISPUTES ---
[PASS] PHASE_4 - Test 20: Mandatory partial delivery scenario verified: 100kg ordered, 80kg delivered -> exactly PKR 200 dispute held

--- PHASE 5: B6 PROCUREMENT (RFQ -> QUOTE -> AWARD) ---
[PASS] PHASE_5 - Test 21: B6 RFQ 7 awarded to supplier 2 via quote 7 (PKR 25,000.00)

--- PHASE 6: SUPER ADMIN GOVERNANCE & RBAC NEGATIVE TESTS ---
[PASS] PHASE_6 - Test 22: Super Admin (admin@miljor.com) authenticated with role SUPER_ADMIN
[PASS] PHASE_6 - Test 23: RBAC Negative: Buyer blocked from admin routes (403 Forbidden)
[PASS] PHASE_6 - Test 24: RBAC Negative: Supplier blocked from admin routes (403 Forbidden)
[PASS] PHASE_6 - Test 25: RBAC Negative: Unauthenticated request blocked (401 Unauthorized)

--- PHASE 7: CONCURRENCY & STOCK INTEGRITY ---
[PASS] PHASE_7 - Test 26: UCP concurrency verified: FOR UPDATE row lock prevented overselling remaining inventory

--- PHASE 8: NOTIFICATION EVENTS & EMPTY STATE ---
[PASS] PHASE_8 - Test 27: Genuine supplier alerts loaded: 4 database-driven alerts
[PASS] PHASE_8 - Test 28: Zero fake notifications: empty state "You're all caught up." verified for clean inbox

--- PHASE 9: SECURITY TESTING & PRISTINE DB VERIFICATION ---
[PASS] PHASE_9 - Test 29: SQL Injection protection verified via parameterized prepared statements
[PASS] PHASE_9 - Test 30: Password security verified: bcrypt hash with zero plaintext leakage
[PASS] PHASE_9 - Test 31: Protected database safety: miljor_db remains 100% PRISTINE (0 orders, 0 writes)

[TEARDOWN] Test HTTP server closed.

================================================================================
E2E TEST SUMMARY: 31 PASSED, 0 FAILED, 0 BLOCKED
================================================================================
```

---

## 2. Real B6 Award & Paid Fulfillment MySQL Gate (7 / 7 PASS)

```
PASS B6 AWARD MYSQL 1: Verified buyer creates B6 request
PASS B6 AWARD MYSQL 2: Supplier invitation and quote are persisted
PASS B6 AWARD MYSQL 3: Fee-inclusive buyer award preview
PASS B6 AWARD MYSQL 4: B6 award created unpaid order and immutable supplier line
PASS B6 AWARD MYSQL 5: Unpaid award is not fulfillable
PASS B6 AWARD MYSQL 6: Synthetic signed callback reconciled real paid B6 award/stock
PASS B6 AWARD MYSQL 7: Real supplier paid fulfillment and B6 immutable-line invoice
REAL B6 AWARD PAID FULFILLMENT: 7/7 PASS; synthetic provider signature only, no real Safepay attestation
```

---

## 3. Real MySQL Postpurchase 100/80/20 Shortage Gate (10 / 10 PASS)

```
PASS REAL MYSQL 100/80/20 1: Isolated synthetic payment is PAID and funds remain HELD in internal escrow ledger
PASS REAL MYSQL 100/80/20 2: Real database supplier queue lists paid test order
PASS REAL MYSQL 100/80/20 3: Real JWT HTTP buyer/supplier details and nonowner/cross-role denial
PASS REAL MYSQL 100/80/20 4: Real SQL supplier transition through delivered does not confirm buyer receipt
PASS REAL MYSQL 100/80/20 5: Buyer shortage 100/80/20 persisted exactly and spoofed metadata ignored
PASS REAL MYSQL 100/80/20 6: Real MySQL dispute creates exact 20kg x PKR10 = PKR200 claim
PASS REAL MYSQL 100/80/20 7: Buyer receipt cannot be silently confirmed while discrepancy/dispute unresolved
PASS REAL MYSQL 100/80/20 8: Dispute-scoped PKR200 refund obligation is non-executable and idempotent
PASS REAL MYSQL 100/80/20 9: Exact persisted invoice line and all fees reconcile to PKR1145
PASS REAL MYSQL 100/80/20 10: Unresolved 20kg claim cannot release escrow, complete order or create duplicate refunds
REAL MYSQL POSTPURCHASE 100/80/20: 10/10 PASS; synthetic Safepay fixture only, no provider-issued callback or external refund
```

---

## 4. Live Safepay Sandbox API Session Attestation

```javascript
// Invocation against https://sandbox.api.getsafepay.com/order/v1/init
const init = await safepayAdapter.createTracker({
  amount: 9600.00,
  currency: 'PKR',
  orderCode: 'ORD-TEST-123'
});
// Result:
// trackerToken: 'track_1216a64c-0fb4-48b6-9f0f-bbae39312c8b'
// Lookup state: 'TRACKER_STARTED'
// Status: { errors: [], message: 'success' }
```

---

## 5. Super Admin Credential Rotation & Session Revocation

```
🔒 Starting secure SUPER_ADMIN credential rotation...
✅ Generated new high-entropy admin password and persisted to local gitignored .env
✅ Password hashed with bcrypt (12 rounds) — plaintext never printed
✅ [miljor_db] Admin password rotated, 2 sessions revoked, 4 tokens revoked.
✅ [miljor_test_db] Admin password rotated, 5 sessions revoked, 5 tokens revoked.
🎉 SUPER_ADMIN credential rotation completed securely across databases.
```
