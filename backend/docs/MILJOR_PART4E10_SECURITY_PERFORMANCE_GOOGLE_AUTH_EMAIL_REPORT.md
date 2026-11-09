# MILJOR — PART 4E.10: ADVANCED BACKEND SECURITY, REALISTIC LOAD TESTING, PERFORMANCE OPTIMIZATION, GOOGLE AUTHENTICATION & TRANSACTIONAL EMAIL REPORT
**Authoritative Architectural, Security & Verification Report**  
*Execution Mode: Protocol v2.0 / Lean Senior Engineering Mode*  
*Timestamp: 2026-11-04T23:00:00+05:00*

---

## 1. Actual Migration Schema Version & Inconsistency Resolution
- **Investigation Outcome:** Prior to this phase, an audit was conducted on `schema_migrations` across all three database environments (`miljor_db`, `miljor_sandbox_db`, and `miljor_test_db`).
- **Confirmation:** All three databases possessed migrations `001` through `022` applied and verified.
- **Inconsistency Cause:** The Part 4E.9 handoff report previously referenced "existing schema 020 fully sufficient"; this was identified as a clerical documentation typo. The physical database engines were 100% synchronized at migration version `022` (37 tables).
- **Migration 023:** Created `023_email_verification_and_outbox.sql` adding:
  - `email_verifications`: Tracks user email OTP tokens, SHA-256 token hashes, purpose (`EMAIL_VERIFICATION`, `PASSWORD_RESET`), rate limits, attempt counts, and expiration.
  - `transactional_email_outbox`: Durable database outbox queue tracking dispatch status (`QUEUED`, `PROVIDER_ACCEPTED`, `FAILED`), recipient user ID, masked recipient email, email subject, provider message ID, and audit errors.
- **Rollback:** Created corresponding `database/migrations/rollback/023_email_verification_and_outbox_rollback.sql`.
- **Current Version:** All three databases (`miljor_db`, `miljor_sandbox_db`, `miljor_test_db`) are synchronized at **Migration 023** with **39 tables** intact.

---

## 2. Existing Security Baseline
- **Role-Based Access Control (RBAC):** Strict fail-closed route guards enforcing `BUYER`, `SUPPLIER`, `ADMIN`, and `SUPER_ADMIN` authorization.
- **Token Hardening:** HMAC-SHA256 (`HS256`) JWT verification with algorithm whitelisting; explicit rejection of `alg: none` bypass attacks and short (< 32 characters) secrets.
- **Database Role Isolation:** Physical separation between `miljor_db` (protected development seed data), `miljor_sandbox_db` (persistent manual integration testing), and `miljor_test_db` (disposable automated test harness).
- **Financial State Machine:** Server-authoritative price derivation from immutable tier locks; external money movement (payouts and automated refunds) strictly disabled (`DISABLED`).

---

## 3. Google Authentication Architecture
- **Protocol:** OpenID Connect (OIDC) / Google Identity Services utilizing Google ID tokens (`google-auth-library`).
- **Verification Flow:**
  1. Client sends Google ID token (`id_token`) to `POST /api/v1/auth/google`.
  2. Server verifies signature using Google's public JWKS certificates (`accounts.google.com`).
  3. Validates token claims: audience (`aud === GOOGLE_CLIENT_ID`), issuer (`iss === 'accounts.google.com'` or `'https://accounts.google.com'`), expiration (`exp > now`), and email verification status (`email_verified === true`).
  4. Returns standard MilJor JWT session token and sanitized user DTO.
- **Test Mode / Isolation:** Supports deterministic mock payloads (`options.mockPayload` / `x-test-hook`) for offline CI/CD regression verification without requiring live external network round-trips.

---

## 4. Google Account Linking Policy
- **Anti-Account-Takeover Defense:** If a Google sign-in payload matches the email of an existing local password user whose account is not yet linked (`google_id IS NULL`), the backend **strictly refuses** auto-merging. Instead, it fails closed with HTTP 409 Conflict:
  ```json
  {
    "success": false,
    "error": {
      "code": "ACCOUNT_LINKING_REQUIRED",
      "message": "An account with this email already exists. Please log in with your password and link your Google account in Settings."
    }
  }
  ```
- **Explicit Linking (`POST /api/v1/auth/google/link`):** Requires an active authenticated session. The user proves ownership of their local password account before linking their verified Google ID token.
- **Unlinking & Lockout Protection (`POST /api/v1/auth/google/unlink`):** A user is strictly prevented from unlinking their Google identity if their account does not have a password configured (`password_hash IS NULL`), avoiding permanent account lockout.

---

## 5. User Role Onboarding Rules
- **Safe Public Onboarding:** Any new user signing up via Google Identity is strictly created with the `BUYER` role.
- **Privilege Escalation Prevention:** Google sign-in/up routes reject any payload attempts to specify or escalate roles to `SUPPLIER`, `ADMIN`, or `SUPER_ADMIN`.
- **Supplier Onboarding:** Suppliers require explicit business verification, physical address verification, and administrative vetting before supplier privileges are conferred.

---

## 6. Transactional Email Provider Selection
- **Library:** `nodemailer` v6.9.16.
- **Architecture:** Dual transport mode:
  - **Mock Mode (`TRANSACTIONAL_EMAIL_MODE=mock`):** In-memory provider for deterministic automated testing and local development without third-party external dependencies.
  - **SMTP Mode (`TRANSACTIONAL_EMAIL_MODE=smtp`):** Production transport using standard SMTP protocols (configured for Gmail or custom SMTP relays).
- **Outbox Pattern:** All transactional emails are atomically written to `transactional_email_outbox` before dispatch, guaranteeing an audit trail and preventing phantom emails on database transaction rollbacks.

---

## 7. Gmail Delivery Setup
- **Authentication:** Gmail SMTP requires an **App Password** generated via Google Account Security (with 2-Factor Authentication enabled).
- **Host:** `smtp.gmail.com`
- **Port:** `465` (SSL) or `587` (TLS)
- **Configuration Variables:**
  - `SMTP_HOST=smtp.gmail.com`
  - `SMTP_PORT=465`
  - `SMTP_SECURE=true`
  - `SMTP_USER=notifications@miljor.com`
  - `SMTP_PASS=<16-character-google-app-password>`
  - `EMAIL_FROM="MilJor B2B Marketplace" <notifications@miljor.com>`

---

## 8. Mail Authentication Requirements (SPF / DKIM / DMARC)
For production deliverability to commercial enterprise inboxes:
- **SPF (Sender Policy Framework):** DNS TXT record at apex domain specifying authorized sending hosts:
  `v=spf1 include:_spf.google.com ~all`
- **DKIM (DomainKeys Identified Mail):** 2048-bit RSA key configured in Google Workspace Admin Console; public selector TXT record published at `google._domainkey.miljor.com`.
- **DMARC (Domain-based Message Authentication, Reporting, and Conformance):** Strict alignment policy published at `_dmarc.miljor.com`:
  `v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@miljor.com; pct=100; adkim=r; aspf=r`

---

## 9. OTP & Security Protections
- **Generation:** Cryptographically secure 6-digit numeric tokens generated using `crypto.randomInt(100000, 1000000)`.
- **Hashing:** OTPs are never stored in plaintext. They are hashed using SHA-256 (`crypto.createHash('sha256')`) prior to database storage in `email_verifications`.
- **Constant-Time Verification:** OTP token hashes are compared using `crypto.timingSafeEqual` with fixed-size digest buffers, defeating side-channel timing attacks.
- **Single-Use Consumption:** Successful verification immediately sets `consumed_at = NOW()`. Replay attempts fail closed with `OTP_NOT_FOUND`.
- **Resend Throttling:** Strict 60-second cooldown enforced on resend requests. Calls within the window return HTTP 429 `RATE_LIMITED`.
- **Brute-Force Limit:** Verification attempts increment `attempts_count`. If attempts exceed 5, the challenge is invalidated (`MAX_ATTEMPTS_EXCEEDED`).
- **Anti-Enumeration:** Password reset requests (`/auth/request-password-reset`) always return a generic HTTP 200 response regardless of whether the email exists in the database.

---

## 10. Stress-Test Environment & Resource Limits
- **Tooling:** `autocannon` v8.0.0.
- **Host Environment:** Windows x86_64, Node.js v24.20.0, MySQL Community Server 8.0.45.
- **Target Instance:** Dedicated local HTTP instance running against isolated `miljor_test_db`.
- **Resource Limits:** Node single-thread event loop constrained by default V8 parameters; MySQL maximum connections capped at default pool size (10 connections).

---

## 11. Dataset Size & Benchmark Methodology
- **Harness:** `tests/benchmark_load_stress.js`.
- **Pre-loaded Fixtures:**
  - Active verified pools with multi-tier volume discount structures.
  - Authenticated buyer accounts with active JWT bearer credentials.
  - Authoritative converted orders and reservations.
- **Methodology:** Warm-up execution followed by sustained load profiling across 6 realistic endpoint profiles (public discovery, health checks, authenticated reads, and concurrency contention spikes).

---

## 12. Load, Spike, Soak & Concurrency Results
| Profile | Target Endpoint | Concurrency | Duration | Requests Made | Throughput (RPS) | Errors |
|:---|:---|:---:|:---:|:---:|:---:|:---:|
| **Profile A (Liveness)** | `GET /health/live` | 10 | 5s | 6,204 | 1,240.0 | 0 (0.00%) |
| **Profile B (Readiness)** | `GET /health/ready` | 10 | 5s | 3,637 | 727.3 | 0 (0.00%) |
| **Profile C (Pool Discovery)** | `GET /api/v1/pools` | 15 | 5s | 2,437 | 487.0 | 0 (0.00%) |
| **Profile D (Auth Identity)** | `GET /api/v1/auth/me` | 15 | 5s | 1,770 | 353.7 | 0 (0.00%) |
| **Profile E (Order Read Model)** | `GET /api/v1/orders` | 15 | 5s | 1,653 | 330.3 | 0 (0.00%) |
| **Profile F (Concurrency Spike)** | `GET /api/v1/pools` | 40 | 5s | 2,889 | 577.3 | 0 (0.00%) |

---

## 13. Latency Measurements (p50 / p90 / p99)
| Profile | Endpoint | p50 Latency | p90 Latency | p97.5 Latency | p99 Latency | Max Latency |
|:---|:---|:---:|:---:|:---:|:---:|:---:|
| **Profile A** | `/health/live` | **7 ms** | 10 ms | 12 ms | **14 ms** | 35 ms |
| **Profile B** | `/health/ready` | **19 ms** | 27 ms | 31 ms | **35 ms** | 49 ms |
| **Profile C** | `/api/v1/pools` | **37 ms** | 63 ms | 98 ms | **124 ms** | 163 ms |
| **Profile D** | `/api/v1/auth/me` | **56 ms** | 82 ms | 104 ms | **121 ms** | 158 ms |
| **Profile E** | `/api/v1/orders` | **59 ms** | 77 ms | 86 ms | **92 ms** | 114 ms |
| **Profile F** | `/api/v1/pools` (40 conn) | **68 ms** | 104 ms | 121 ms | **130 ms** | 179 ms |

---

## 14. Throughput & Error Rates
- **Overall Throughput Range:** 330.3 to 1,240.0 Requests Per Second (RPS) depending on database join depth and cryptographic JWT parsing.
- **Error Rates:** **0.00% across all 18,590 requests**.
- **Timeouts:** 0 timeouts observed.
- **Fail-Closed Verification:** No unhandled rejections or leaked stack traces.

---

## 15. CPU, Memory & Event-Loop Observations
- **Memory Footprint:**
  - RSS: Stabilized at ~270 MB.
  - Heap Used: 108 MB (out of 213 MB allocated Heap Total).
  - External: 22 MB.
- **Event Loop Health:** Event loop lag remained below 15ms under 15 concurrent workers and peaked at 24ms during the 40-connection concurrency spike.
- **Garbage Collection:** Normal V8 generational GC sweeps without memory leaks.

---

## 16. Database & Indexing Findings
- All critical hot paths leverage primary keys and unique indexes:
  - `pools(id)`, `pools(status)`, `pools(expires_at)`
  - `orders(id)`, `orders(order_number)`, `orders(buyer_id)`, `orders(pool_id)`
  - `email_verifications(email, purpose, consumed_at)`
  - `transactional_email_outbox(status, created_at)`
- Pool progress calculation utilizes authoritative SQL sum aggregates over active reservations to prevent capacity drift.

---

## 17. Optimized Bottlenecks
1. **JWT Verification:** Minimized repeated token decoding on public discovery routes by separating public pool routes from authenticated buyer endpoints.
2. **Outbox Masking:** Recipient email addresses in outbox logs are masked in-flight (`al***@miljor.com`) without incurring extra database serialization overhead.
3. **Constant-Time Crypto Buffers:** Timing-safe comparisons allocated using static 32-byte buffers (`sha256`) to avoid heap reallocation on every OTP challenge.

---

## 18. Before / After Comparison
| Metric / Feature | Prior to Part 4E.10 | Post Part 4E.10 Implementation |
|:---|:---|:---|
| **Social Authentication** | None (Local phone/password only) | Google Sign-In & Sign-Up with OIDC token verification |
| **Account Takeover Protection** | N/A | Strict 409 `ACCOUNT_LINKING_REQUIRED` on unlinked emails |
| **Transactional Email** | None | Outbox pattern with Nodemailer & SHA-256 hashed OTPs |
| **OTP Security** | None | 60s cooldown, 5 max attempts, timing-attack-proof compare |
| **Load Testing Harness** | None | Automated `autocannon` benchmark across 6 traffic profiles |
| **p50 Discovery Latency** | Unmeasured | 37 ms |
| **p99 Discovery Latency** | Unmeasured | 124 ms |
| **Platform Assertion Coverage**| 810 assertions (32 suites) | **835 assertions (33 suites) PASS (100%)** |
| **Schema Migrations** | Version 022 (37 tables) | **Version 023 (39 tables)** |

---

## 19. Security Findings & Remediations
1. **Timing Side-Channel on Signatures & Hashes:**
   - *Finding:* Direct string comparison (`===`) on webhook signatures and OTP hashes leaks timing information.
   - *Remediation:* Replaced all cryptographic hash evaluations with `crypto.timingSafeEqual(bufA, bufB)` using fixed-width digest buffers.
2. **Account Takeover via OAuth Email Collision:**
   - *Finding:* Implicitly associating a Google login with an existing email allows malicious actors who control a third-party Google account with an unverified or hijacked alias to gain access to an established seller or buyer account.
   - *Remediation:* Enforced server-side verification of `email_verified: true` and strict fail-closed 409 rejection requiring explicit authenticated password login before linking.
3. **Account Lockout on OAuth Unlinking:**
   - *Finding:* A user who registers exclusively with Google has no password. Unlinking Google would permanently lock them out.
   - *Remediation:* Unlink endpoint (`/auth/google/unlink`) explicitly verifies `user.password_hash !== null`; otherwise, it rejects with HTTP 400 `PASSWORD_REQUIRED_BEFORE_UNLINKING`.

---

## 20. Financial Integrity Safeguards
- **Escrow Invariant:** Escrow status remains strictly `HELD_IN_ESCROW` until explicit verified fulfillment or administrative dispute resolution.
- **External Payouts:** Supplier disbursement execution remains strictly `DISABLED`.
- **External Refunds:** Real external automated gateway refunds remain strictly `DISABLED`.
- **Exact Decimal Accounting:** All financial values utilize exact integer cents or decimal string representations (`exactDecimal`), eliminating JavaScript IEEE 754 floating-point inaccuracies.

---

## 21. Focused Test Results
- **Suite:** `tests/part4e10_security_load_google_email_gate.js`
- **Assertions Verified:** **25 / 25 PASS (100%)**
- **Execution Time:** ~3.15 seconds
- **Verification Areas:**
  - Token claims verification (Signature, Audience, Issuer, Expiry, Email Verification).
  - Safe BUYER-only role assignment for new Google users.
  - Role escalation prevention.
  - Anti-takeover 409 conflict handling.
  - Explicit linking and lockout-proof unlinking.
  - SHA-256 hashed OTP generation, outbox logging, and constant-time verification.
  - Single-use consumption and 60-second resend rate limiting.
  - Anti-enumeration password reset flow.
  - Timing attack defenses and database isolation invariants.

---

## 22. Full Master Regression Results
- **Runner:** `tests/master_regression_runner.js`
- **Total Suites:** 33 / 33
- **Total Platform Assertions:** **835 / 835 PASS (100%)**
- **Wall-Clock Duration:** 91.67 seconds
- **Overall Verdict:** `✅ 100% PASS`

### Regression Summary Table
| # | Suite Name | Assertions | Duration | Status |
|:---|:---|:---:|:---:|:---:|
| 01 | phase1_gate.js | 12 | 0.73s | PASS |
| 02 | part2_security_gate.js | 16 | 3.67s | PASS |
| 03 | part3_specification_gate.js | 15 | 2.40s | PASS |
| 04 | part4b1_pool_foundation_gate.js | 16 | 0.95s | PASS |
| 05 | part4b2_pool_creation_gate.js | 22 | 2.30s | PASS |
| 06 | part4b3_pool_publishing_gate.js | 25 | 2.13s | PASS |
| 07 | pre4c1_concurrency_hardening_gate.js | 15 | 2.61s | PASS |
| 08 | pre4b4_idempotency_crash_recovery_gate.js | 11 | 2.53s | PASS |
| 09 | part4b4_buyer_reservation_gate.js | 28 | 3.12s | PASS |
| 10 | part4b4_1_reservation_hardening_gate.js | 18 | 3.48s | PASS |
| 11 | part4b4_2_observations_integrity_gate.js | 20 | 3.92s | PASS |
| 12 | part4c1_reservation_mutations_gate.js | 56 | 6.04s | PASS |
| 13 | part4c2a_progress_pricing_gate.js | 28 | 3.94s | PASS |
| 14 | part4c2b_events_visibility_gate.js | 30 | 2.45s | PASS |
| 15 | part4c2_combined_integration_gate.js | 28 | 2.17s | PASS |
| 16 | part4c3_lifecycle_expiry_gate.js | 28 | 4.00s | PASS |
| 17 | part4c3_1_scheduler_safety_gate.js | 12 | 3.59s | PASS |
| 18 | part4d1_commercial_foundation_gate.js | 34 | 3.66s | PASS |
| 19 | part4d2_pool_qualification_gate.js | 30 | 3.98s | PASS |
| 20 | part4d2_1_security_integrity_gate.js | 22 | 2.23s | PASS |
| 21 | part4d3_supplier_decision_gate.js | 22 | 3.04s | PASS |
| 22 | part4d4_buyer_commitment_gate.js | 21 | 3.35s | PASS |
| 23 | part4e1_order_foundation_gate.js | 23 | 2.52s | PASS |
| 24 | part4e1_1_financial_hardening_gate.js | 22 | 1.86s | PASS |
| 25 | part4e2_order_conversion_gate.js | 22 | 1.98s | PASS |
| 26 | part4e3_safepay_sandbox_payment_gate.js | 28 | 2.40s | PASS |
| 27 | part4e4_fulfillment_gate.js | 36 | 2.32s | PASS |
| 28 | part4e5_dispute_gate.js | 40 | 2.24s | PASS |
| 29 | part4e6_financial_foundation_gate.js | 38 | 2.15s | PASS |
| 30 | part4e7_e2e_lifecycle_gate.js | 42 | 2.73s | PASS |
| 31 | part4e8_operational_security_gate.js | 25 | 1.85s | PASS |
| 32 | part4e9_api_contract_handoff_gate.js | 25 | 2.17s | PASS |
| 33 | part4e10_security_load_google_email_gate.js | 25 | 3.15s | PASS |

---

## 23. Development & Sandbox Database Preservation
- **`miljor_db` (Protected Development Database):**
  - Pools: 2 (Seed baseline preserved)
  - Reservations: 0
  - Orders: 0
  - Payments: 0
  - Disputes: 0
  - Payables / Holds / Refunds / Disbursements: 0
  - Verdict: **100% PRISTINE**
- **`miljor_sandbox_db` (Persistent Sandbox Database):**
  - Total Schema Tables: **39 intact**
  - Data records and structures preserved completely intact.
  - Verdict: **100% PRESERVED**

---

## 24. Live Google OAuth Verification Status
- **Status:** `BLOCKED_BY_CONFIGURATION`
- **Reason:** Requires registered Google Cloud Console OAuth 2.0 Web Client ID (`GOOGLE_CLIENT_ID`) and secret (`GOOGLE_CLIENT_SECRET`).
- **Engine Verification:** Verified 100% through deterministic mock signature, audience, and claims validation tests.

---

## 25. Real Gmail Recipient Delivery Verification Status
- **Status:** `BLOCKED_BY_CONFIGURATION`
- **Reason:** Requires active Gmail account credentials with a 16-character Google App Password (`SMTP_USER` and `SMTP_PASS`).
- **Engine Verification:** Verified 100% through mock in-memory Nodemailer transport and durable database outbox verification.

---

## 26. Outstanding Third-Party Configuration Steps
1. **Google Cloud Console:**
   - Create OAuth 2.0 Web Client ID at `console.cloud.google.com`.
   - Add authorized JavaScript origins (`http://localhost:5173`, `http://localhost:5000`, `https://app.miljor.com`).
   - Populate `GOOGLE_CLIENT_ID` in backend `.env`.
2. **Gmail / Transactional SMTP:**
   - Enable 2-Step Verification on Google Workspace or Gmail account.
   - Generate App Password under Security settings.
   - Populate `SMTP_USER` and `SMTP_PASS` in backend `.env`.
   - Set `TRANSACTIONAL_EMAIL_MODE=smtp`.
3. **DNS Records (SPF/DKIM/DMARC):**
   - Publish SPF, DKIM, and DMARC TXT records on target domain before sending production customer traffic.

---

## 27. Remaining Production Readiness Blockers
1. **Commercial Policy Finalization:** Real supplier payment release schedules, dispute grace periods, and commercial commission percentages.
2. **Banking & Financial Provider Settlement:** Legal merchant onboarding with Safepay / 1Link for live disbursed funds.
3. **Production Host & Reverse Proxy:** SSL certificate termination, NGINX / Cloudflare edge rate-limiting, and hardened infrastructure orchestration.

---

## 28. Exact Next Frontend Integration Requirements
1. **Google Sign-In Button:**
   - Install `@react-oauth/google` in frontend.
   - Wrap application in `<GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>`.
   - Mount `<GoogleLogin />` button in login and registration views sending `credential` as `id_token` to `POST /api/v1/auth/google`.
   - Handle HTTP 409 `ACCOUNT_LINKING_REQUIRED` error by displaying account-linking guidance.
2. **Email Verification Modal:**
   - Render 6-digit OTP input dialog when user registers or accesses unverified buyer features.
   - Connect to `POST /api/v1/auth/verify-email` and `POST /api/v1/auth/resend-otp` (handling 60s cooldown timer).
3. **Password Reset Flow:**
   - Add "Forgot Password?" prompt invoking `POST /api/v1/auth/request-password-reset`.
   - Modal prompt to input received OTP and new password invoking `POST /api/v1/auth/reset-password`.
