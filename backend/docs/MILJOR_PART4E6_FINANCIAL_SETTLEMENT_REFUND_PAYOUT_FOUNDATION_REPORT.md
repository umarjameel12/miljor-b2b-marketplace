# MILJOR — PART 4E.6: FINANCIAL SETTLEMENT, REFUND, SUPPLIER PAYOUT & RECONCILIATION FOUNDATION REPORT
**Protocol v2.0 / Lean Senior Engineering Mode**  
**Execution Date:** 2026-11-04  
**Phase Verdict:** PASS

---

## 1. Executive Summary

This report documents the design, verified provider research, database schema extensions, transactional accounting logic, and exhaustive multi-suite regression testing for **MilJor Part 4E.6: Financial Settlement, Refund, Supplier Payout & Reconciliation Foundation**.

Part 4E.6 establishes a mathematically rigorous, concurrency-safe, and provider-aware financial accounting core for MilJor's B2B collective food procurement marketplace:
1. **Critical Provider Capability Verification:** Evaluated all 20 financial capabilities against official Safepay documentation (`apidocs.getsafepay.com`, `safepay.pk/legal/content/services-agreement`) and MilJor's specific merchant credentials. Identified that Safepay operates as a regulated PSO/PSP, **not** an escrow or custody agent. True programmable escrow, automated marketplace split payments, and self-service programmatic refund endpoints on standard merchant credentials are **unsupported** or require custom aggregator onboarding.
2. **Clarified Escrow Conceptual Boundary:** Corrected the conceptual boundary between internal status flags (`HELD_IN_ESCROW`) and actual fund custody. Funds captured by Safepay settle into MilJor's merchant account; MilJor maintains internal supplier payable obligations, holds, and refund reserves.
3. **Supplier Payable Accrual Engine:** Implemented exact-decimal entitlement calculation ($Gross + Delivery - Commission$) derived exclusively from locked order snapshots, affirmative supplier verification, and configured supplier commission tiers (1.00% Business, 1.50% Growth, 2.50% Starter).
4. **Financial Holds & Governance:** Built atomic financial hold controls to freeze supplier balances during active disputes, shortage exceptions, or policy verification, preventing premature disbursement.
5. **Line-Item Refund Assessment:** Built a secure refund workflow derived from locked server unit prices ($Qty \times Unit Price$) that automatically places payable holds, prevents cumulative over-refunding, and supports administrative manual confirmation with external transaction references.
6. **Supplier Disbursement Preparation:** Built beneficiary validation (24-character Pakistani IBAN standard) and disbursement instruction tracking, restricted to `BUYER_CONFIRMED` orders with zero active holds.
7. **Absolute Financial Safety Invariant:** External refund and payout execution adapters remain strictly **`DISABLED`**. Zero automated money movement was executed; zero live API calls were made to banks or Safepay; and internal `escrow_status` remains `HELD_IN_ESCROW`.
8. **Comprehensive Regression Proof:** Level 1/2 focused suite passed **38 / 38 assertions**; authoritative Master Regression runner passed **718 / 718 assertions across 29 suites**; `miljor_db` and `miljor_sandbox_db` remained 100% pristine.

---

## 2. Provider Capability Verification Matrix

Evaluated against Safepay official documentation (`https://apidocs.getsafepay.com/`, `https://safepay.pk/legal/content/services-agreement`) and MilJor's current merchant credentials (`SAFEPAY_PUBLIC_KEY`, `SAFEPAY_SECRET_KEY` pointing to `sandbox.api.getsafepay.com`):

| # | Provider Capability | Classification | Authoritative Evidence & Technical Boundary |
|:---|:---|:---:|:---|
| 01 | Card refund support | `VERIFIED_SUPPORTED` | Supported for Visa/Mastercard transactions via merchant dashboard. Funds reverse back through card network. |
| 02 | Full vs partial refunds | `VERIFIED_SUPPORTED` | Supported via merchant dashboard; merchant can specify full or partial amount up to original capture. |
| 03 | Refund API vs dashboard-only | `VERIFIED_UNSUPPORTED` (on standard keys) | Standard merchant checkout keys (`/order/v1/...`) do not expose public self-service programmatic refund APIs. Programmatic endpoints require custom aggregator/enterprise onboarding. |
| 04 | Refund authentication & required identifiers | `ACCOUNT_APPROVAL_REQUIRED` | Programmatic refund calls require enterprise aggregator secret and tracker/payment reference token. |
| 05 | Refund status retrieval | `VERIFIED_SUPPORTED` | Refund status is queryable via tracker token inspection (`status = 'REFUNDED'`, `amount_refunded`). |
| 06 | Refund event/webhook support | `ACCOUNT_APPROVAL_REQUIRED` | Webhook event topics (e.g. `refund.*`, `payment.refunded`) exist in platform architecture but require aggregator endpoint registration. |
| 07 | Refund limits and eligibility | `VERIFIED_SUPPORTED` | Refunds cannot exceed original captured transaction value. Safepay retains original processing fees and taxes upon refund. |
| 08 | Supported currencies & units | `VERIFIED_SUPPORTED` | Pakistani Rupee (`PKR`) in major-unit decimals (e.g. `24330.00`). |
| 09 | Idempotency & duplicate refund handling | `VERIFIED_SUPPORTED` | Dashboard and aggregator APIs enforce cumulative refund caps and unique request IDs. |
| 10 | Failure & ambiguous response behavior | `VERIFIED_SUPPORTED` | Account-based bank transfers (PayFast/Nift) logged on dashboard do not auto-reverse; merchant is legally required to manually credit customer. |
| 11 | Merchant settlement behavior | `VERIFIED_SUPPORTED` | Standard batch settlement (`sb_...`) to merchant's verified bank account on predetermined schedule. |
| 12 | Merchant intentional settlement delay | `VERIFIED_UNSUPPORTED` | Merchants cannot instruct Safepay to delay or hold settlement of individual captured transactions. |
| 13 | True provider-controlled escrow | `VERIFIED_UNSUPPORTED` | Safepay is a PSO/PSP licensed by State Bank of Pakistan, **not** an escrow/trust agent. No programmable custody API exists. |
| 14 | Marketplace / split payments | `VERIFIED_UNSUPPORTED` (on standard checkout) | Standard custom hosted checkout charges single buyer for single merchant. Split disbursement at checkout requires custom aggregator setup. |
| 15 | Payments to multiple independent suppliers | `VERIFIED_UNSUPPORTED` | Checkout session initiates for single merchant; independent multi-supplier payouts are not supported at checkout. |
| 16 | Beneficiary onboarding & KYC | `ACCOUNT_APPROVAL_REQUIRED` | Payout rails (Raastwire) require Title Fetch (`GET /title-fetch`) and verified Pakistani IBAN resolution. |
| 17 | Merchant-initiated supplier payouts | `ACCOUNT_APPROVAL_REQUIRED` | Raastwire payout endpoint (`POST /v1/aggregators/{{id}}/payout`) requires approved aggregator credentials; standard checkout keys fail closed. |
| 18 | Settlement & reconciliation reports | `VERIFIED_SUPPORTED` | Settlement batch summaries and downloadable CSV reports available in dashboard (`sb_...`). |
| 19 | Chargebacks, reversals & adjustments | `VERIFIED_SUPPORTED` | Visible on dashboard Disputes / Reversals tab; programmatic retrieval requires enterprise access. |
| 20 | MilJor merchant account entitlement | `ACCOUNT_APPROVAL_REQUIRED` | MilJor currently holds standard sandbox checkout test credentials; no active aggregator payout or direct refund API entitlement is configured. |

**Architectural Takeaway:** Because true provider escrow, programmable split-checkout, and standard API refunds are not available under current merchant keys, MilJor implements a safe, internal double-check accounting foundation with external money-movement adapters explicitly **`DISABLED`**.

---

## 3. Escrow Conceptual Boundary & Fund Custody

MilJor historically used `payments.escrow_status = 'HELD_IN_ESCROW'`. This phase formally documents what this status represents:
- **Custody Reality:** When a buyer completes checkout on Safepay, funds are captured and subsequently settled by Safepay into MilJor’s primary corporate merchant bank account. Safepay does not hold funds in a programmable, segregated third-party escrow account.
- **Internal Accounting Representation:** `HELD_IN_ESCROW` represents MilJor's **internal contractual fiduciary obligation** to hold captured funds in reserve until post-delivery buyer confirmation (`BUYER_CONFIRMED`) and dispute resolution.
- **Formal State Distinctions Enforced in Part 4E.6:**
  1. `Payment Captured`: Buyer card/account charged via Safepay; recorded in `payments` as `PAID`.
  2. `Provider Settlement Pending / Reconciled`: Safepay batch settlement to MilJor merchant account; tracked in `provider_settlement_batches`.
  3. `Internal Supplier Payable Accrued`: Obligation recognized in `supplier_payables` ($Net = Gross + Delivery - Commission$).
  4. `Internal Financial Hold`: Disputed or unverified funds frozen in `financial_holds`.
  5. `Refund Obligation Assessed / Approved`: Customer refund recognized in `refund_obligations`.
  6. `Disbursement Instruction Prepared / Approved`: Payout instruction recorded in `supplier_disbursement_instructions`.
  7. `External Execution`: Real-world fund transfer (strictly `DISABLED` until future authorized phase).

---

## 4. Financial Data Model & Database Schema

Migration `022_financial_settlement_and_reconciliation.sql` introduced 6 additive tables to all databases (`miljor_test_db`, `miljor_db`, `miljor_sandbox_db`):

```
+--------------------+        +---------------------+        +-----------------------------------+
|       orders       | <----> |  supplier_payables  | <----> | supplier_disbursement_instructions|
+--------------------+        +---------------------+        +-----------------------------------+
         ^                               ^
         |                               |
         v                               v
+--------------------+        +---------------------+
|      payments      | <----> |   financial_holds   |
+--------------------+        +---------------------+
         ^                               ^
         |                               |
         v                               v
+--------------------+        +---------------------+
| refund_obligations | <----> |   order_disputes    |
+--------------------+        +---------------------+
```

### Table Specifications:
1. **`supplier_payables`**: Tracks supplier gross earnings, delivery fee entitlement, commission deductions, approved refund deductions, active held amounts, and net available balances.
2. **`financial_holds`**: Tracks frozen amounts with explicit business reasons (`ACTIVE_DISPUTE`, `SUPPLIER_SHORTAGE`, `FULFILLMENT_EXCEPTION`, `ADMINISTRATIVE_INVESTIGATION`, `POLICY_VERIFICATION`).
3. **`refund_obligations`**: Tracks full and partial refund claims with server-calculated line-item amounts, administrative approval status, and `external_execution_status = 'DISABLED'`.
4. **`supplier_disbursement_instructions`**: Prepares payout instructions with beneficiary verification (24-char Pakistani IBAN), approval workflow, and `external_execution_status = 'DISABLED'`.
5. **`provider_settlement_batches`**: Records Safepay batch settlement references (`sb_...`), gross fees, and net settlement reconciliations.
6. **`financial_audit_events`**: Immutable chronological audit ledger capturing actor roles, status transitions, amount deltas, and metadata.

---

## 5. Accounting, Conservation & Calculation Rules

### 5.1 Exact Decimal Mathematical Calculations
All calculations execute strictly via BigInt-scaled half-up decimal arithmetic (`exactDecimal.js`):
- **Gross Order Amount:**
  $$\text{Total Amount} = \text{Subtotal Amount} + \text{Delivery Fee} + \text{Buyer Platform Fee}$$
- **Supplier Net Payable:**
  $$\text{Commission Amount} = \text{exactMultiplyRound}(\text{Subtotal Amount}, \frac{\text{Fee \%}}{100}, 2)$$
  $$\text{Net Payable} = \text{Subtotal Amount} + \text{Delivery Fee} - \text{Commission Amount}$$
- **Partial Refund Assessment:**
  $$\text{Claimed Refund} = \text{exactMultiplyRound}(\text{Disputed Quantity}, \text{Locked Unit Price}, 2)$$
- **Available Balance for Disbursement:**
  $$\text{Available} = \text{Net Payable} - \text{Refund Deductions} - \text{Active Holds}$$

### 5.2 Financial Conservation Proof
For any order with captured payment:
$$\text{Captured Payment} = \text{Buyer Fee} + \text{Commission} + \text{Supplier Net Available} + \text{Refunds} + \text{Held Amounts}$$
Zero phantom money, floating-point rounding errors, or unallocated funds can exist.

---

## 6. Financial State Machines

### 6.1 Supplier Payable Lifecycle
`ACCRUED` $\xrightarrow{\text{dispute / shortage}}$ `ON_HOLD` / `PARTIALLY_HELD` $\xrightarrow{\text{hold release}}$ `ELIGIBLE_FOR_DISBURSEMENT` $\xrightarrow{\text{prepare disbursement}}$ `DISBURSEMENT_PREPARED` $\xrightarrow{\text{external transfer confirmed}}$ `FULLY_DISBURSED`.

### 6.2 Refund Obligation Lifecycle
`REQUESTED` (Buyer) $\to$ `UNDER_REVIEW` (Admin) $\to$ `APPROVED` (Internal obligation locked; external execution `DISABLED`) $\to$ `CONFIRMED` (Manual external reference recorded from provider dashboard).

### 6.3 Supplier Disbursement Lifecycle
`PREPARED` (Admin validated IBAN & hold-free balance) $\to$ `APPROVED` (Admin approved instruction; external transfer `DISABLED`) $\to$ `CONFIRMED` (Future external Raastwire bank confirmation).

---

## 7. Role-Based Access Control & Security Matrix

| Endpoint | Method | Path | Allowed Roles | Enforcement Mechanism |
|:---|:---|:---|:---|:---|
| Accrue Payable | `POST` | `/api/v1/settlements/payables/accrue` | `ADMIN`, `SUPER_ADMIN` | JWT + `authorizeAdmin` |
| View Supplier Payables | `GET` | `/api/v1/settlements/payables/supplier` | `SUPPLIER` | JWT + `authorizeStrict('SUPPLIER')` (Tenant-scoped to `req.user.id`) |
| Place Financial Hold | `POST` | `/api/v1/settlements/holds` | `ADMIN`, `SUPER_ADMIN` | JWT + `authorizeAdmin` |
| Release Financial Hold | `POST` | `/api/v1/settlements/holds/:id/release` | `ADMIN`, `SUPER_ADMIN` | JWT + `authorizeAdmin` |
| Assess Refund Obligation | `POST` | `/api/v1/settlements/refunds/assess` | `BUYER`, `ADMIN` | JWT + `idempotencyGuard.required` + Order Ownership Validation |
| Approve Refund Obligation | `POST` | `/api/v1/settlements/refunds/:id/approve` | `ADMIN`, `SUPER_ADMIN` | JWT + `authorizeAdmin` |
| Confirm Manual Refund | `POST` | `/api/v1/settlements/refunds/:id/confirm-manual` | `ADMIN`, `SUPER_ADMIN` | JWT + `authorizeAdmin` + External Ref Validation |
| View Buyer Refunds | `GET` | `/api/v1/settlements/refunds/my` | `BUYER` | JWT + `authorizeStrict('BUYER')` (Tenant-scoped to `req.user.id`) |
| Prepare Disbursement | `POST` | `/api/v1/settlements/disbursements/prepare` | `ADMIN`, `SUPER_ADMIN` | JWT + `authorizeAdmin` + `idempotencyGuard.required` |
| Approve Disbursement | `POST` | `/api/v1/settlements/disbursements/:id/approve` | `ADMIN`, `SUPER_ADMIN` | JWT + `authorizeAdmin` |
| Reconcile Batch Settlement | `POST` | `/api/v1/settlements/batches/reconcile` | `ADMIN`, `SUPER_ADMIN` | JWT + `authorizeAdmin` + Arithmetic Mismatch Guard |
| Admin Financial Overview | `GET` | `/api/v1/settlements/admin/overview` | `ADMIN`, `SUPER_ADMIN` | JWT + `authorizeAdmin` |
| Financial Audit Trail | `GET` | `/api/v1/settlements/audit-trail` | `ADMIN`, `SUPER_ADMIN` | JWT + `authorizeAdmin` |

---

## 8. Test Execution & Verification Results

### 8.1 Focused Part 4E.6 Gate (`tests/part4e6_financial_foundation_gate.js`)
Execution against `miljor_test_db`: **38 / 38 Assertions PASS (1.59s)**
- Section 1: Commercial Order Fixture Setup (1/1)
- Section 2: Supplier Payable Accrual & Calculations (4/4)
- Section 3: Financial Holds & Release Governance (5/5)
- Section 4: Refund Assessment & Boundaries (6/6)
- Section 5: Refund Approval & Execution Boundaries (5/5)
- Section 6: Supplier Disbursement Preparation & Boundaries (6/6)
- Section 7: Provider Settlement Reconciliation (3/3)
- Section 8: Read Models & Audit Trails (6/6)
- Section 9: Database Isolation & Baseline Preservation (2/2)

### 8.2 Authoritative Master Regression Runner (`tests/master_regression_runner.js`)
Sequential execution across all 29 platform verification suites:

| # | Suite Name | Focus | Assertions | Duration | Status |
|:---|:---|:---|:---:|:---:|:---:|
| 01 | `phase1_gate.js` | Core Models & DB Foundations | 12 | 0.54s | PASS |
| 02 | `part2_security_gate.js` | Security, RBAC & Protection | 16 | 3.11s | PASS |
| 03 | `part3_specification_gate.js` | Catalog Normalization & Canonical Hashes | 15 | 1.69s | PASS |
| 04 | `part4b1_pool_foundation_gate.js` | Regular Pool Foundation & Migrations | 16 | 0.79s | PASS |
| 05 | `part4b2_pool_creation_gate.js` | Atomic Pool Creation & Term Validations | 22 | 1.57s | PASS |
| 06 | `part4b3_pool_publishing_gate.js` | Inventory Allocations & Publishing | 25 | 1.60s | PASS |
| 07 | `pre4c1_concurrency_hardening_gate.js` | Concurrency & Isolation Hardening | 15 | 1.95s | PASS |
| 08 | `pre4b4_idempotency_crash_recovery_gate.js` | Crash Recovery & Heartbeat Liveness | 11 | 1.74s | PASS |
| 09 | `part4b4_buyer_reservation_gate.js` | Reservation Engine & Capacity Control | 28 | 2.59s | PASS |
| 10 | `part4b4_1_reservation_hardening_gate.js` | Reservation Hardening & State Integrity | 18 | 2.80s | PASS |
| 11 | `part4b4_2_observations_integrity_gate.js` | Critical Integrity & OBS-21–25 | 20 | 3.06s | PASS |
| 12 | `part4c1_reservation_mutations_gate.js` | Reservation Modifications & Cancellations | 56 | 5.58s | PASS |
| 13 | `part4c2a_progress_pricing_gate.js` | Authoritative Progress, Pricing & Read Model | 28 | 2.63s | PASS |
| 14 | `part4c2b_events_visibility_gate.js` | Durable Business Events & Visibility | 30 | 1.86s | PASS |
| 15 | `part4c2_combined_integration_gate.js` | Combined Reservation & Event Hardening | 28 | 1.64s | PASS |
| 16 | `part4c3_lifecycle_expiry_gate.js` | Reservation Lifecycle, Expiry & Participation | 28 | 3.46s | PASS |
| 17 | `part4c3_1_scheduler_safety_gate.js` | Scheduler Containment & Expiry Clock | 12 | 2.73s | PASS |
| 18 | `part4d1_commercial_foundation_gate.js` | Commercial Lifecycle Foundation & Safe Closure | 34 | 2.99s | PASS |
| 19 | `part4d2_pool_qualification_gate.js` | Pool Qualification & Atomic Closure Decision | 30 | 3.57s | PASS |
| 20 | `part4d2_1_security_integrity_gate.js` | Security Audit, Legacy Containment & Hardening | 22 | 1.44s | PASS |
| 21 | `part4d3_supplier_decision_gate.js` | Supplier Confirmation & Rejection Engine | 22 | 2.29s | PASS |
| 22 | `part4d4_buyer_commitment_gate.js` | Buyer Offer, Explicit Commitment & Final Demand | 21 | 2.58s | PASS |
| 23 | `part4e1_order_foundation_gate.js` | Order Architecture & Commercial Reconciliation | 23 | 1.53s | PASS |
| 24 | `part4e1_1_financial_hardening_gate.js` | Exact Financial Arithmetic & Consistency | 22 | 1.33s | PASS |
| 25 | `part4e2_order_conversion_gate.js` | Authoritative Order Conversion Gate | 22 | 1.53s | PASS |
| 26 | `part4e3_safepay_sandbox_payment_gate.js` | Safepay Sandbox Checkout & Payment State Machine | 28 | 1.31s | PASS |
| 27 | `part4e4_fulfillment_gate.js` | Post-Payment Fulfillment & Supplier Delivery Gate | 36 | 1.55s | PASS |
| 28 | `part4e5_dispute_gate.js` | Buyer Protection & Dispute Resolution Gate | 40 | 1.72s | PASS |
| 29 | `part4e6_financial_foundation_gate.js` | Financial Settlement, Refund & Reconciliation Gate | 38 | 1.59s | PASS |

- **Total Platform Assertions Verified:** 718 / 718 (100% PASS)
- **Total Wall-Clock Execution Time:** 62.75 seconds
- **Overall Platform Verdict:** ✅ 100% PASS

---

## 9. Database Preservation Proof

1. **`miljor_db` (Development Database):**
   - Tables: 37 intact.
   - Rows: Pools = 2, Reservations = 0, Business Events = 0, Mutations = 0, Snapshots = 0, Supplier Decisions = 0, Buyer Decisions = 0, Orders = 0, Payment Attempts = 0, Payments = 0, Fulfillment Events = 0, Disputes = 0, Payables = 0, Holds = 0, Refunds = 0, Disbursements = 0.
   - Status: **100% PRISTINE**.
2. **`miljor_sandbox_db` (Persistent Sandbox Evidence Database):**
   - Tables: 37 intact.
   - Status: **100% PRESERVED**.

---

## 10. Deliberately Deferred Scope & Pending Policies

1. **External Fund Disbursements (Raastwire Payouts):** Requires formal onboarding as an approved Safepay Aggregator and commercial agreement on payout limits. Execution remains disabled.
2. **Programmatic Refund API Execution:** Standard merchant API does not expose refunds; refunds remain dashboard-managed or assisted until specialized aggregator credentials are provisioned.
3. **Tax & Withholding Allocation:** Sales tax on marketplace commission (e.g. PRA 16% in Punjab) is deferred to formal taxation configuration.
4. **Automated Supplier Penalty Adjustments:** Automated clawbacks against future supplier orders remain subject to merchant commercial policy definition.

---

## 11. Production Security & Non-Functional Backlog

1. **JWT Secret Rotation:** Replace development secret with production HSM/KMS-managed key.
2. **Least-Privilege Database Users:** Migrate application connection from `root` to an isolated application user with restricted DDL/DML grants.
3. **Webhook Ingress Firewalls:** Enforce IP allowlisting on Safepay webhook ingress.
4. **Structured JSON Telemetry & Correlation IDs:** Standardize distributed request tracing across HTTP headers and MySQL connections.

---

## 12. Final Status Block

```
================================================================================
MILJOR PART 4E.6 FINAL STATUS BLOCK
================================================================================
PART 4E.6: PASS
PROVIDER CAPABILITY VERIFICATION: PASS
FINANCIAL ACCOUNTING MODEL: PASS
LEDGER INTEGRITY: PASS
SUPPLIER PAYABLE MODEL: PASS
REFUND ASSESSMENT: PASS
DISBURSEMENT PREPARATION: PASS
FINANCIAL HOLDS: PASS
DISPUTE INTEGRATION: PASS
RBAC & TENANT ISOLATION: PASS
CONCURRENCY & IDEMPOTENCY: PASS
PROVIDER RECONCILIATION: PASS
EXTERNAL REFUND EXECUTION: DISABLED
EXTERNAL SUPPLIER PAYOUT EXECUTION: DISABLED
PRODUCTION MONEY MOVEMENT: DISABLED
AUDIT & OUTBOX: PASS
FOCUSED TESTS: 38 / 38 PASS (1.59s in tests/part4e6_financial_foundation_gate.js)
MASTER REGRESSION: 718 / 718 PASS across 29 suites (62.75s)
DEVELOPMENT DB PRESERVED: YES (100% PRISTINE, 37 tables)
SANDBOX DB PRESERVED: YES (100% PRESERVED, 37 tables)
NEW SAFEPAY CHARGES: ZERO
NEW REFUNDS EXECUTED: ZERO
NEW PAYOUTS EXECUTED: ZERO
PRODUCTION READINESS: NOT READY (Financial foundation complete; real transfers disabled)
PART 4E.6 FOUNDATION FINAL GATE: PASS
================================================================================
```
