# MILJOR — POST-4E.4 BACKEND SECURITY & NON-FUNCTIONAL REQUIREMENTS GATE REPORT

**Phase:** Post-4E.4 Security & Non-Functional Requirements (NFR) Assessment  
**Standard:** Protocol v2.0 & Lean Senior Engineering Mode  
**Working Directory:** `backend/`  
**Target Environment:** Local Sandbox / Test Isolation (`miljor_test_db`, `miljor_sandbox_db`, `miljor_db`)  
**Assessment Date:** 2026-10-21  
**Verdict:** PASS (Cleared for Part 4E.5 Development)  

---

## 1. Executive Summary & Assessment Scope

This report delivers a comprehensive, evidence-based security and non-functional requirements (NFR) assessment of the MilJor backend codebase following the successful implementation and verification of **Part 4E.4 (Post-Payment Fulfillment & Supplier-Managed Delivery Foundation)**.

The scope of this audit encompasses:
1. **Authentication, Authorization & Session Management:** Strict role-based access control (RBAC), JWT token validation, credential exposure, tenant isolation, and Insecure Direct Object Reference (IDOR) prevention.
2. **API & Input Security:** Parameterized SQL queries, SQL injection defense, payload sizing, rate limiting, error hygiene, CORS policies, and security headers.
3. **Financial Security & Escrow Safety:** Payment authenticity, Safepay HMAC-SHA512 webhook signature verification, authenticated provider reconciliation, idempotency, state-machine race prevention, and strict escrow hold invariants.
4. **Fulfillment Safety & Concurrency:** Paid-only fulfillment entry, supplier/buyer separation, milestone state machine, operational exception handling, and immutable audit trails.
5. **Database & Infrastructure Integrity:** Multi-tenant database isolation, migration safety, restorable backup verification, dependency vulnerability auditing, and least-privilege configurations.
6. **Non-Functional Requirements (10 Dimensions):** Performance, Scalability, Reliability, Availability, Maintainability, Observability, Recoverability, Data Integrity, Privacy, and Compatibility.
7. **Part 4E.5 Readiness vs. Production Readiness:** Distinguishing development prerequisites from live production deployment requirements.

---

## 2. Policy Baseline & Verification State

### 2.1 Workspace Policy Freshness Gate
All authoritative workspace policy documents were inspected directly from disk. Cryptographic SHA-256 integrity hashes:
- `backend/AGENTS.md`: `7739BA32F08A90F8D8F4B3826BA84AB0275333E56D8E8E6854E1675EDE0C2D0F`
- `backend/docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md`: `BED65E8E65EA097DD22D433F8E7B25EDEBB67CE7F1B455E9CEE4FFEE192FF3D8`
- `backend/docs/MILJOR_BUSINESS_INVARIANTS.md`: `0283585FEF3215D2DB6C8AE404FB9E859132CAEC0DF74434997F3E350704497F`
- `backend/docs/MILJOR_PART4E4_FULFILLMENT_FOUNDATION_REPORT.md`: `8514F350D510C7DE7C280B57B2644DD5E9157DCF25C9B4E9F4A34CF73CB37D92`

### 2.2 Maintained Regression Manifest
- **Master Regression Runner (`tests/master_regression_runner.js`):** 27 sequential test suites with **640 / 640 assertions PASS (100% PASS)** in 48.35s wall-clock time.
- **Suite 27 Integration (`tests/part4e4_fulfillment_gate.js`):** Fully integrated with 36 assertions covering all fulfillment milestone transitions, exceptions, RBAC boundaries, and idempotency replays.
- **Standalone Focused Recovery Gate (`tests/part4e3_6_payment_recovery_gate.js`):** Maintained as an independent focused gate with 18 assertions PASS. *(Tracked under finding SEC-03 for future consolidation)*.

### 2.3 Database State & Isolation Fingerprints
Direct read-only inspection of the local MySQL instance verified 100% physical and structural database isolation:
- **`miljor_db` (Development Baseline):** 30 tables, 0 orders, 0 payments, 0 payment_attempts, 0 order_fulfillment_events, 2 pools, 0 reservations, 7 users (**100% PRISTINE**).
- **`miljor_sandbox_db` (Persistent Sandbox Evidence):** 30 tables, 0 orders, 0 payments, 0 payment_attempts, 0 order_fulfillment_events, 2 pools, 0 reservations, 7 users (**100% PRESERVED**).
- **`miljor_test_db` (Disposable Regression Environment):** 30 tables, zero persistent test residue between runner executions.

---

## 3. Security Control Matrix

| Category | Security Control / Mechanism | Implementation Evidence | Status |
| :--- | :--- | :--- | :--- |
| **Authentication** | JWT Signature & Claim Verification | `src/middlewares/authGuard.js`: verified with `issuer: 'miljor-api'`, `audience: 'miljor-app'`, and expiration check. | **VERIFIED** |
| **Authentication** | Real-Time User Status Check | `src/middlewares/authGuard.js` queries DB per request; immediate rejection on `BLOCKED` or `SUSPENDED`. | **VERIFIED** |
| **Authentication** | Password Storage & Hashing | `src/controllers/authController.js`: bcrypt with salt rounds = 12. Password complexity enforced (>=8 chars, letter + number). | **VERIFIED** |
| **Authentication** | Credential Exposure in Responses | `src/controllers/authController.js`: `safeUser()` projection strips `password_hash` from all auth responses. | **VERIFIED** |
| **Authorization** | Strict Role Separation (RBAC) | `src/middlewares/authGuard.js`: `authorize()`, `authorizeStrict()`, `requireVerifiedSupplier()`. | **VERIFIED** |
| **Authorization** | Tenant Isolation & IDOR Defense | `safepayCheckoutService.js`, `orderController.js`, `fulfillmentService.js`: Supplier checks `order.supplier_id === actor.id`; Buyer checks `order.buyer_id === actor.id`. | **VERIFIED** |
| **Authorization** | Affirmative Supplier Verification | `src/services/supplierEligibilityPolicy.js`: requires `role = 'SUPPLIER'`, `is_verified = 1`, and `profile.verification_status = 'VERIFIED'`. | **VERIFIED** |
| **Authorization** | Cross-Actor Receipt Protection | `src/routes/v1/fulfillmentRoutes.js`: Buyer receipt confirmation restricted to `authorizeStrict('BUYER')`; suppliers cannot confirm receipt. | **VERIFIED** |
| **API & Input** | Parameterized SQL Queries | Prepared statement parameter arrays (`?`) used consistently in repository and service layers. Zero string concatenation. | **VERIFIED** |
| **API & Input** | Rate Limiting | `server.js`: `express-rate-limit` (Auth: 30 req/15m; General: 200 req/15m). | **VERIFIED** |
| **API & Input** | HTTP Security Headers | `server.js`: `helmet()` installed and mounted globally. | **VERIFIED** |
| **API & Input** | CORS Policy | `server.js`: Restricted to configured origins in production; open origins disallowed in production mode. | **VERIFIED** |
| **API & Input** | Request Body Size Sizing | `server.js`: `express.json({ limit: '10mb' })` with raw buffer retention for webhooks. | **VERIFIED** |
| **API & Input** | Stack Trace Containment | `server.js`: Global error handler suppresses internal error messages and stack traces in production (`SERVER_ERROR`). | **VERIFIED** |
| **Payment** | Webhook Cryptographic Verification | `src/services/safepayAdapter.js`: HMAC-SHA512 over untouched raw body bytes verified using `crypto.timingSafeEqual`. | **VERIFIED** |
| **Payment** | Amount & Currency Tampering Defense | `safepayCheckoutService.js`: Amounts/currencies strictly taken from locked order DB rows; webhook/provider amounts must match. | **VERIFIED** |
| **Payment** | Out-of-Lock Network Calls | `safepayCheckoutService.js`: Safepay API calls execute outside MySQL transaction blocks, eliminating long-held lock contention. | **VERIFIED** |
| **Payment** | Escrow Safety Semantics | `safepayCheckoutService.js`, `fulfillmentService.js`: Funds strictly assigned `escrow_status = 'HELD_IN_ESCROW'`. Zero auto-refunds or payouts. | **VERIFIED** |
| **Fulfillment** | Paid-Only Fulfillment Activation | `fulfillmentService.js`: Orders must have `payment_status = 'PAID'` to enter fulfillment or undergo milestone transitions. | **VERIFIED** |
| **Fulfillment** | Concurrency & Row Locking | `fulfillmentService.js`: All transitions run inside transactions with `SELECT * FROM orders WHERE id = ? FOR UPDATE`. | **VERIFIED** |
| **Fulfillment** | State Machine Gatekeeping | `fulfillmentService.js`: Enforces strict sequential transitions; skips or backward steps fail closed with 409 or 422. | **VERIFIED** |
| **Fulfillment** | Exception Halting Semantics | `fulfillmentService.js`: Setting `EXCEPTION` halts happy-path transitions (409) while preserving all financial totals. | **VERIFIED** |
| **Fulfillment** | Audit Event Trail | `order_fulfillment_events`: Immutable chronological event logging with deterministic event codes and actor metadata. | **VERIFIED** |
| **Database** | Multi-Tier Isolation | `src/config/db.js`: Strict routing based on `NODE_ENV` (`miljor_test_db`, `miljor_sandbox_db`, `miljor_db`). | **VERIFIED** |

---

## 4. Non-Functional Requirements (NFR) Assessment

| NFR Area | Requirement Description | Target Baseline | Measured Characteristic | Evaluation |
| :--- | :--- | :--- | :--- | :--- |
| **1. Performance** | API Latency & Query Indexing | < 100ms reads, < 250ms mutations | Read queries execute in < 2ms; full regression of 27 suites (640 assertions) finishes in 48.35s (~75ms per assertion average). Indexes present on `(supplier_id, fulfillment_status)` and `(buyer_id, fulfillment_status)`. | **VERIFIED** |
| **2. Scalability** | Connection Pooling & Concurrency | Queue limits, pool size, row locking | `connectionLimit: 10`, `waitForConnections: true`, `queueLimit: 0`. Row-level `FOR UPDATE` locking and unique index on `idempotency_key` prevent concurrency corruption. | **VERIFIED** |
| **3. Reliability** | Failure Recovery & Timeouts | Graceful degradation on network/provider failures | Safepay adapter enforces 10s timeout; 504 on timeout, 502 on network drop. Transaction rollback on unhandled exceptions with clean connection release in `finally`. | **VERIFIED** |
| **4. Availability** | Health Checks & Probes | Unauthenticated liveness probe | `GET /health` returns HTTP 200 with environment and ISO timestamp. Lacks active database ping. | **PARTIAL** |
| **5. Maintainability** | Clean Boundaries & Modularity | Service/Controller/Repo separation | Dedicated fulfillment service (`fulfillmentService.js`), controller (`fulfillmentController.js`), routes (`fulfillmentRoutes.js`), and migration scripts. Clean resource draining. | **VERIFIED** |
| **6. Observability** | Audit Logging & Event Tracking | Durable audit log for operational actions | Immutable audit logs in `system_audit_logs`, outbox events in `reservation_business_events`, and tracking in `order_fulfillment_events`. Lacks structured JSON logger (e.g. Pino) and request correlation IDs. | **PARTIAL** |
| **7. Recoverability** | Database Backup & Restore | Reproducible Point-in-Time Restore | Verified restorable backup `miljor_db_backup_2026-10-20T14-02-42-270Z.sql` (70.7 KB). Clean migration `020` and verified rollback script tested. | **VERIFIED** |
| **8. Data Integrity** | Exact Arithmetic & Atomicity | Zero floating-point drift; ACID transactions | `exactDecimal.js` foundation used for monetary/inventory calculations. Indivisible packaging constraints (`step_size = 1.00`) enforced. All mutations run under `READ COMMITTED` transactions. | **VERIFIED** |
| **9. Privacy** | Sensitive Data Protection | Masking and tenant isolation | Passwords hashed with bcrypt; raw payment card numbers never touch backend; buyer/supplier personal data scoped strictly to direct transaction participants. | **VERIFIED** |
| **10. Compatibility** | Runtime & Engine Consistency | Verified platform dependencies | Node.js v24.20.0 x64, MySQL Community Server 8.0.45 x86_64, Windows OS. Authoritative UTC session timezone (`SET time_zone = '+00:00'`) enforced on all connections. | **VERIFIED** |

---

## 5. Part 4E.4 Integration Verification

All 11 mandatory post-payment fulfillment integration checks were evaluated against the live codebase:

1. **Only authoritatively paid orders enter fulfillment:**  
   `fulfillmentService.js` enforces `order.payment_status === 'PAID'` across all read models, transitions, exceptions, and receipt confirmations. Unpaid orders reject with `422 UNPAID_ORDER_NOT_IN_FULFILLMENT`.
2. **Supplier cannot confirm buyer receipt:**  
   `/buyer/orders/:id/confirm-receipt` is guarded with `authorizeStrict('BUYER')`. `fulfillmentService.js` additionally validates `actor.role === 'BUYER'` and `order.buyer_id === actor.id`. Suppliers attempting to confirm receipt receive `403 FORBIDDEN` or `403 UNAUTHORIZED_ROLE`.
3. **Buyer cannot execute supplier transitions:**  
   `/supplier/orders/:id/transition` is guarded with `authorizeStrict('SUPPLIER')`. `fulfillmentService.js` validates `actor.role === 'SUPPLIER'`, asserts affirmative verification, and checks `order.supplier_id === actor.id`.
4. **Every transition is authorized and idempotent:**  
   All mutation routes require `idempotencyGuard.required`. `fulfillmentService.js` checks existing records in `order_fulfillment_events` by `order_id` and `idempotency_key`, returning `{ is_replay: true }` without repeating side effects.
5. **Concurrent transitions cannot corrupt the state machine:**  
   Mutations execute within `READ COMMITTED` transactions holding exclusive `SELECT * FROM orders WHERE id = ? FOR UPDATE` row locks, preventing race conditions.
6. **Fulfillment exception blocks invalid happy-path transitions:**  
   An order in `fulfillment_status = 'EXCEPTION'` rejects forward milestone transitions with `409 UNRESOLVED_FULFILLMENT_EXCEPTION`.
7. **`payments.escrow_status` remains unchanged:**  
   In all milestone transitions (including `BUYER_CONFIRMED`), `payments.escrow_status` strictly remains `HELD_IN_ESCROW`. No database queries in `fulfillmentService.js` alter payment records.
8. **Fulfillment does not automatically trigger refund or payout:**  
   Zero payout, refund, or settlement routines are executed or referenced in Part 4E.4.
9. **Event history is consistent and audit-safe:**  
   Every milestone and exception atomically creates a record in `order_fulfillment_events` and an outbox event in `reservation_business_events`.
10. **The documented number of fulfillment stages matches the actual implementation:**  
    The 6 distinct post-payment fulfillment lifecycle stages (`AWAITING_SUPPLIER_ACKNOWLEDGEMENT`, `PREPARING`, `READY_FOR_DISPATCH`, `DISPATCHED`, `SUPPLIER_DELIVERED`, `BUYER_CONFIRMED`) and the `EXCEPTION` state in `src/services/fulfillmentService.js` match `database/migrations/020_post_payment_fulfillment_foundation.sql`.
11. **Post-payment reconciliation and fulfillment activation are consistent across supported payment-confirmation paths:**  
    Both `processSafepayWebhook` (line 464) and `reconcileOrderStatusWithProvider` (line 849) in `src/services/safepayCheckoutService.js` execute:
    ```sql
    UPDATE orders 
    SET payment_status = 'PAID', order_status = 'PAID', fulfillment_status = 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT', updated_at = NOW() 
    WHERE id = ?
    ```

---

## 6. Prioritized Findings Matrix

### Finding SEC-01: Exposed Development JWT Secret in Local Configuration
- **Evidence:** `.env` references `miljor_dev_jwt_secret_key_2026`.
- **Exploitation / Threat:** If this default key were deployed to a public staging or production environment, an adversary could forge arbitrary JWT tokens with `role: SUPER_ADMIN`.
- **Severity:** **HIGH** (Confidence: 100%)
- **Recommended Minimal Remediation:** Enforce high-entropy 256-bit secret generation in production environments and include a boot-time assertion in `server.js` that crashes if the dev secret is detected when `NODE_ENV === 'production'`.
- **Blocks Part 4E.5 Development?** **NO** (Isolated to local test/sandbox environment).
- **Blocks Production Deployment?** **YES** (Mandatory production gate).

### Finding SEC-02: Missing DB Connectivity Probe in `/health` Endpoint
- **Evidence:** `server.js` lines 136-143 returns HTTP 200 without issuing a `SELECT 1` ping.
- **Exploitation / Threat:** In a containerized or multi-instance deployment, an orchestrator (e.g. Kubernetes, AWS ECS) would route user traffic to an instance even if its MySQL connection pool is saturated or dead.
- **Severity:** **MEDIUM** (Confidence: 100%)
- **Recommended Minimal Remediation:** Add a lightweight `await db.query('SELECT 1')` check or implement a separate `/health/ready` probe.
- **Blocks Part 4E.5 Development?** **NO**.
- **Blocks Production Deployment?** **YES**.

### Finding SEC-03: `part4e3_6_payment_recovery_gate.js` Maintained Independently from Master Runner
- **Evidence:** `tests/master_regression_runner.js` contains 27 suites (640 assertions). The 18 assertions of `part4e3_6_payment_recovery_gate.js` run as a standalone suite.
- **Exploitation / Threat:** Developers modifying provider payment recovery logic might run only `master_regression_runner.js`, missing silent regressions in Safepay tracker recovery.
- **Severity:** **MEDIUM** (Confidence: 100%)
- **Recommended Minimal Remediation:** Consolidate `part4e3_6_payment_recovery_gate.js` into `master_regression_runner.js` as Suite 28 using isolated fixtures.
- **Blocks Part 4E.5 Development?** **NO** (Both suites pass 100% independently).
- **Blocks Production Deployment?** **NO**.

### Finding SEC-04: Lack of IP Rate Limiting on Direct Provider Webhook Endpoint
- **Evidence:** `src/routes/v1/paymentRoutes.js`: `POST /webhook/safepay` and `server.js` line 131 `/api/v1/webhooks/safepay` are unauthenticated public routes.
- **Exploitation / Threat:** Denial of Service (DoS) via high-volume forged webhook payloads causing excessive CPU consumption during HMAC-SHA512 hashing.
- **Severity:** **MEDIUM** (Confidence: 95%)
- **Recommended Minimal Remediation:** Attach a dedicated rate limiter (e.g., 60 req/min per IP) to the webhook routes and restrict ingress to known Safepay IP blocks or reverse proxy headers in production.
- **Blocks Part 4E.5 Development?** **NO**.
- **Blocks Production Deployment?** **YES**.

### Finding SEC-05: Console-Based Logging Lacking Structured Correlation IDs
- **Evidence:** `server.js` and controllers utilize `console.error` / `console.log` rather than structured JSON loggers.
- **Exploitation / Threat:** In distributed production environments, tracking a payment or fulfillment lifecycle across multiple requests is hindered by the absence of request/correlation IDs.
- **Severity:** **LOW** (Confidence: 100%)
- **Recommended Minimal Remediation:** Introduce an asynchronous structured logger (e.g. Pino) with request correlation middleware before production launch.
- **Blocks Part 4E.5 Development?** **NO**.
- **Blocks Production Deployment?** **YES**.

### Finding SEC-06: Fulfillment Exception Resolution Flow Deferred
- **Evidence:** `fulfillmentService.js` lines 338-344: When an order is in `EXCEPTION`, all further transitions return `409 UNRESOLVED_FULFILLMENT_EXCEPTION`.
- **Exploitation / Threat:** Once an operational exception (shortage, damage, logistics failure) is recorded, the order remains blocked until an admin dispute resolution / settlement workflow is executed.
- **Severity:** **LOW / INFORMATIONAL** (Architecture Boundary)
- **Recommended Minimal Remediation:** Implement admin exception resolution, replacement dispatch, or partial refund workflows during Part 4E.5.
- **Blocks Part 4E.5 Development?** **NO** (This is the planned scope for Part 4E.5).
- **Blocks Production Deployment?** **YES** (Operational orders would remain stuck without resolution).

### Finding SEC-07: DevDependencies Security Advisory (`braces` via `nodemon`)
- **Evidence:** `npm audit --json` reported 3 high vulnerabilities (`braces` CVE via `chokidar` -> `nodemon`).
- **Exploitation / Threat:** Denial of service via nested pattern parsing in development file watcher.
- **Severity:** **LOW** (Confidence: 100%)
- **Recommended Minimal Remediation:** `nodemon` is strictly a `devDependency` and is excluded from production container builds (`npm install --omit=dev`). Upgrade `nodemon` to latest release during regular maintenance.
- **Blocks Part 4E.5 Development?** **NO**.
- **Blocks Production Deployment?** **NO**.

---

## 7. Safe Credential Rotation & Deployment Guide

To safely rotate credentials and transition to production without disrupting active sessions:

1. **Dual-Key JWT Rotation Procedure:**
   - Configure application to accept `JWT_SECRET` (primary for signing new tokens) and `JWT_SECRET_PREVIOUS` (fallback for verifying existing unexpired tokens).
   - Generate high-entropy 256-bit secret via: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   - Update deployment environment variables setting `JWT_SECRET_PREVIOUS` to old secret and `JWT_SECRET` to new secret.
   - Decommission `JWT_SECRET_PREVIOUS` after the 7-day token expiration window (`JWT_EXPIRES_IN = '7d'`).
2. **Production Startup Environment Gate:**
   - In `server.js`:
     ```javascript
     if (process.env.NODE_ENV === 'production') {
       if (process.env.JWT_SECRET === 'miljor_dev_jwt_secret_key_2026') {
         console.error('FATAL: Insecure default JWT_SECRET detected in production. Refusing to boot.');
         process.exit(1);
       }
       if (!process.env.SAFEPAY_WEBHOOK_SECRET) {
         console.error('FATAL: SAFEPAY_WEBHOOK_SECRET is required in production. Refusing to boot.');
         process.exit(1);
       }
     }
     ```
3. **Database Credentials:**
   - Production instances must never connect with MySQL `root` or empty passwords. Use a dedicated least-privilege user `miljor_app` with `SELECT, INSERT, UPDATE, DELETE` permissions strictly scoped to `miljor_db`.

---

## 8. Residual Risks & Observations

1. **Platform Custody Hold vs. Financial Institution Escrow:**  
   MilJor records `escrow_status = 'HELD_IN_ESCROW'` as an internal state machine control preventing supplier disbursement before delivery. This represents a platform-managed custody restriction and does not constitute a third-party licensed banking escrow account.
2. **Part 4E.5 Scope Demarcation:**  
   Part 4E.4 cleanly isolated post-payment fulfillment. The escrowed funds remain held in their initial state until Part 4E.5 implements the settlement, payout, and dispute resolution engines.

---

## 9. Final Status Block

```text
================================================================================
SECURITY: PASS
AUTHORIZATION & TENANT ISOLATION: PASS
FINANCIAL INTEGRITY: PASS
FULFILLMENT SAFETY: PASS
NON-FUNCTIONAL REQUIREMENTS: PARTIAL
DATABASE SAFETY: PASS
CRITICAL FINDINGS: 0
HIGH FINDINGS: 1
PRODUCTION READINESS: NOT READY
PART 4E.5 ENTRY GATE: PASS
================================================================================
```

*Summary: Zero CRITICAL findings exist. The single HIGH finding (SEC-01: Dev JWT Secret Rotation) and operational findings (SEC-02, SEC-04, SEC-05) are production deployment prerequisites that do not compromise development safety or data integrity in the isolated test environment. All 11 Part 4E.4 integration requirements are authoritatively verified, and databases remain pristine. The MilJor platform is cleared to enter Part 4E.5.*
