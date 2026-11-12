# MilJor — Master E2E Full Test Evidence

**Date:** 2026-11-12  
**Active Test Runner:** `backend/tests/master_e2e_acceptance_runner.js`  
**Execution Environment:** Node.js v24.20.0, MySQL 8.0, Windows PowerShell  
**Target Database:** `miljor_test_db`  
**Protected Database:** `miljor_db`  

---

## 1. Master E2E Runner Execution Output

```
================================================================================
🚀 MILJOR MASTER E2E IMPLEMENTATION & FINAL DEMO ACCEPTANCE SUITE
================================================================================

[INIT] Test HTTP server listening on http://127.0.0.1:62990

--- PHASE 0: REPOSITORY BASELINE & DATABASE AUDIT ---
✅ MySQL Database connected successfully to miljor_test_db!
[PASS] PHASE_0 - Test 1: Database isolation verified: active database is miljor_test_db
[PASS] PHASE_0 - Test 2: Financial safety lock verified: ALLOW_EXTERNAL_MONEY_MOVEMENT=false

--- PHASE 1: BUYER JOURNEY (REGISTRATION -> CHECKOUT) ---
[PASS] PHASE_1 - Test 3: Buyer registration enforces unique email check (409 Conflict)
[PASS] PHASE_1 - Test 4: New buyer registered successfully (ID: 429) with Lahore base cluster
[PASS] PHASE_1 - Test 5: Buyer login authenticated successfully with valid JWT token
[PASS] PHASE_1 - Test 6: Invalid credentials fail closed with 401 Unauthorized
[PASS] PHASE_1 - Test 7: Unified pool discovered: ID 1 (Basmati Rice Premium) with authoritative server clock
[PASS] PHASE_1 - Test 8: Buyer created reservation ID 509 for quantity 25
[PASS] PHASE_1 - Test 9: Order created (ID: 149) with total PKR 9,600 awaiting payment

--- PHASE 2: SAFEPAY SANDBOX PAYMENT & FINANCIAL INTEGRITY ---
[PASS] PHASE_2 - Test 10: Safepay sandbox credentials verified without exposing secret values
[PASS] PHASE_2 - Test 11: Hosted Safepay checkout URL generated with authoritative sandbox query params
[PASS] PHASE_2 - Test 12: Webhook signature verified via HMAC-SHA512 over raw payload; tampered signature rejected
[PASS] PHASE_2 - Test 13: Order atomically transitioned to payment_status=PAID, order_status=PAID
[PASS] PHASE_2 - Test 14: Invoice issued (ID: 74) with matching order amount PKR 9,600.00
[PASS] PHASE_2 - Test 15: Refund guard fails closed: external money movement remains disabled

--- PHASE 3: SUPPLIER JOURNEY (LOGIN -> CATALOG -> FULFILLMENT) ---
[PASS] PHASE_3 - Test 16: Supplier profile verified with VERIFIED status and full catalog entitlements
[PASS] PHASE_3 - Test 17: Supplier specification validated: Super Kernel Basmati Rice 25kg (Super Kernel Mills, 25.00 kg)
[PASS] PHASE_3 - Test 18: Supplier fulfillment queue contains 11 PAID orders; unpaid orders excluded
[PASS] PHASE_3 - Test 19: Cross-supplier order isolation verified: supplier cannot view competitor orders

--- PHASE 4: DELIVERY, SHORTAGE SCENARIO & DISPUTES ---
[PASS] PHASE_4 - Test 20: Mandatory partial delivery scenario verified: 100kg ordered, 80kg delivered -> exactly PKR 200 dispute held

--- PHASE 5: B6 PROCUREMENT (RFQ -> QUOTE -> AWARD) ---
[PASS] PHASE_5 - Test 21: B6 RFQ 5 awarded to supplier 2 via quote 5 (PKR 25,000.00)

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

## 2. Safepay Sandbox Readiness Gate Evidence

```
✔ no placeholders qualify as real credentials (7.1698ms)
✔ safe sandbox configuration is ready for provider attempts but not certified (1.701ms)
✔ production Safepay configuration fails closed (1.2484ms)
✔ any external-money movement flag fails closed (0.7313ms)
✔ protected database names fail closed (2.9474ms)
✔ production host override fails closed (0.5346ms)
✔ missing secrets report variable names only, never values (2.1833ms)
✔ gateway refund stub does not masquerade as real refund (0.5684ms)
✔ supplier payout remains unverified even for sandbox credentials (1.0556ms)
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 51.577
```

---

## 3. Frontend Test Suite Evidence

```
================================================================================
🎨 MILJOR PART 5A.1: DESIGN SYSTEM, BRAND & TOKEN VERIFICATION
================================================================================

  [PASS] Assertion 1: Brand Palette: All 5 approved colors (#072a21, #0f5a48, #c8b276, #f7f3e8, #121417) tokenized in src/index.css
  [PASS] Assertion 2: Typography: Playfair Display (editorial serif) and Inter (interface/numbers) properly configured
  [PASS] Assertion 3: Theme Tokens: Complete Light & Dark semantic variables established without pure black
  [PASS] Assertion 4: Anti-Flash & Typography Loading: Synchronous theme script and web font links verified in index.html
  [PASS] Assertion 5: Logo System: Flowing Champagne-Gold Ribbon-M Monogram implemented in SVG & Logo component
  [PASS] Assertion 6: Opening Treatment: Strictly monogram-only without "MilJor" wordmark text
  [PASS] Assertion 7: Content Truthfulness: Fabricated marketing claims removed and replaced with Quiet Luxury facts
  [PASS] Assertion 8: UI Primitives: Button, Input, Card, Badge, Skeleton, Drawer, and ThemeSelector present
  [PASS] Assertion 9: Sidebar & Navigation: Collapsible desktop sidebar (w-64/w-20) and mobile drawer implemented in AppShell
  [PASS] Assertion 10: Landing Page: Editorial luxury hero, fresh food imagery showcase, and value pillars verified

================================================================================
🎉 ALL 10 DESIGN SYSTEM INTEGRITY ASSERTIONS PASSED!
================================================================================

PASS: UTC MySQL datetime
PASS: UTC ISO without timezone
PASS: MySQL fractional seconds
PASS: UTC Z timestamp
PASS: Explicit positive offset
PASS: Explicit negative offset
PASS: Numeric epoch milliseconds
PASS: Date object
PASS: Empty deadline
PASS: Null deadline
PASS: Invalid date
PASS: Invalid hour
PASS: Malformed string
PASS: Unsupported object
B6 DEADLINE PARSER: 14/14 PASS
```

---

## 4. Frontend Production Build Evidence

```
vite v8.3.4 building client environment for production...
transforming...
✓ 2229 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                         1.96 kB │ gzip:   0.96 kB
dist/assets/premium_rice_sack-C5NhsV4G.jpg            323.17 kB
dist/assets/miljor-rice-hero-dark-Djr4sxjI.png        557.55 kB
dist/assets/miljor-rice-hero-light-DHheI7N1.png       559.25 kB
dist/assets/ProfilePage-vh-t_kPv.css                   15.09 kB │ gzip:   6.36 kB
dist/assets/index-PJcm4Yri.css                        102.22 kB │ gzip:  17.86 kB
dist/assets/FlashPoolsPage-kYZXi5Vu.js                  0.15 kB │ gzip:   0.15 kB
dist/assets/plus-KuhzoDk-.js                            0.19 kB │ gzip:   0.17 kB
dist/assets/arrow-left-CqAzvDNj.js                      0.20 kB │ gzip:   0.18 kB
dist/assets/info-DcNqYNdV.js                            0.24 kB │ gzip:   0.20 kB
dist/assets/Skeleton-CFEz8lxI.js                        0.25 kB │ gzip:   0.21 kB
dist/assets/circle-x-FxinO1i3.js                        0.26 kB │ gzip:   0.21 kB
dist/assets/credit-card-DOiKmvx7.js                     0.28 kB │ gzip:   0.23 kB
dist/assets/external-link-CVcQjcTp.js                   0.29 kB │ gzip:   0.22 kB
dist/assets/triangle-exclamation-point-DFHAIjKJ.js      0.36 kB │ gzip:   0.26 kB
dist/assets/save-B4A4irRp.js                            0.36 kB │ gzip:   0.25 kB
dist/assets/admin-DSTC0Dc2.js                           0.38 kB │ gzip:   0.21 kB
dist/assets/key-round-BMpm_9oJ.js                       0.39 kB │ gzip:   0.28 kB
dist/assets/Card-Cqlz6IUe.js                            0.41 kB │ gzip:   0.30 kB
dist/assets/package-check-CBorfChw.js                   0.45 kB │ gzip:   0.30 kB
dist/assets/SupplierOnboardingPage-CSnJOGes.js          2.20 kB │ gzip:   1.02 kB
dist/assets/supplier-DUPsXYAO.js                        2.48 kB │ gzip:   1.02 kB
dist/assets/VerifyEmailPage-BgKYEdBR.js                 4.95 kB │ gzip:   1.99 kB
dist/assets/AdminDashboardPage-hhk288od.js              6.48 kB │ gzip:   2.26 kB
dist/assets/SupplierDashboardPage-DhfXs_f1.js           8.01 kB │ gzip:   2.28 kB
dist/assets/SupplierSubscriptionPage-C2eikmJ3.js        8.04 kB │ gzip:   3.15 kB
dist/assets/DemandRequestsPage-CzBv7Gt_.js              9.76 kB │ gzip:   2.63 kB
dist/assets/SupplierProfilePage-koqjXvXh.js            10.65 kB │ gzip:   2.92 kB
dist/assets/PaymentReturnPage-BIdm8c5v.js              11.87 kB │ gzip:   2.75 kB
dist/assets/ForgotPasswordPage-Duh71nN8.js             15.57 kB │ gzip:   4.80 kB
dist/assets/AdminVerificationPage-FYwqkTid.js          17.04 kB │ gzip:   4.46 kB
dist/assets/SupplierDeliverySettingsForm-BfOuvKyw.js   18.03 kB │ gzip:   4.15 kB
dist/assets/CheckoutPage-neo8B3BF.js                   18.48 kB │ gzip:   4.63 kB
dist/assets/SupplierOnboardingWizard-DaGCNHBQ.js       19.41 kB │ gzip:   4.98 kB
dist/assets/AdminCatalogPage-DCUSp9FO.js               22.53 kB │ gzip:   4.52 kB
dist/assets/PoolsPage-CdtgdjDY.js                      29.15 kB │ gzip:   8.48 kB
dist/assets/OrdersPage-yQ6S_EkA.js                     33.79 kB │ gzip:   8.14 kB
dist/assets/SupplierPoolsPage-muqC3WAC.js              35.74 kB │ gzip:   9.82 kB
dist/assets/jsx-runtime-DnOqM0h3.js                    49.30 kB │ gzip:  17.56 kB
dist/assets/createLucideIcon-BAeob1Lu.js               66.98 kB │ gzip:  24.65 kB
dist/assets/RfqPage-BZ0aOcpz.js                        71.08 kB │ gzip:  14.31 kB
dist/assets/SupplierCatalogPage-BVwF1Pwm.js            76.80 kB │ gzip:  14.28 kB
dist/assets/ProfilePage-Ch-h5To-.js                   179.43 kB │ gzip:  50.96 kB
dist/assets/index-DEzD-RCg.js                         418.43 kB │ gzip: 113.02 kB

✓ built in 2.28s
```
