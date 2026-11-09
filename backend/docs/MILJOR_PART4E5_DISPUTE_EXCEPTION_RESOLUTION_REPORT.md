# MILJOR — PART 4E.5: BUYER PROTECTION, DISPUTE & FULFILLMENT EXCEPTION RESOLUTION FOUNDATION REPORT
**Protocol v2.0 / Lean Senior Engineering Mode**  
**Execution Date:** 2026-10-21  
**Phase Verdict:** PASS

---

## 1. Executive Summary

This report documents the design, implementation, and rigorous verification of **MilJor Part 4E.5: Buyer Protection, Dispute & Fulfillment Exception Resolution Foundation**.

Part 4E.5 delivers a production-grade, concurrency-safe, and financially immutable dispute arbitration and operational exception resolution platform for MilJor's B2B collective food procurement marketplace:
1. **Buyer Protection & Delivery Discrepancies:** Verified buyers who have received delivery (`SUPPLIER_DELIVERED`) can report discrepancies (damaged goods, missing/shortage items, quality non-conformity, or wrong items) with line-item quantity tracking and strict decimal claim calculation.
2. **Supplier Shortage Declarations:** Verified suppliers can declare operational inventory shortages on paid pre-dispatch orders (`PREPARING`), immediately surfacing exceptions for administrative arbitration and operational remediation.
3. **Operational Remediation Lifecycle:** Suppliers can propose concrete operational remedies (replacement dispatch or operational redelivery) and record dispatch milestones. In strict adherence to separation of concerns, supplier remediation dispatch does not self-resolve disputes—the buyer maintains exclusive receipt confirmation authority.
4. **Administrative Arbitration & Case Closure:** Platform administrators possess exclusive authority to record operational decisions (`BUYER_CLAIM_ACCEPTED`, `BUYER_CLAIM_REJECTED`, `MUTUAL_RESOLUTION`, `ESCALATED_FOR_MANUAL_REVIEW`), request evidence, and formally close disputes with documented closure rationales.
5. **Safe Fulfillment Resumption:** Closing all unresolved disputes on an order safely restores fulfillment progression, enabling the buyer to confirm final receipt without operational deadlocks.
6. **Absolute Financial Safety Invariant:** Part 4E.5 strictly executes **zero automated money movement**. Escrow funds remain unreleased (`payments.escrow_status = 'HELD_IN_ESCROW'`), no Safepay refunds or payout disbursements are triggered, and the platform ledger remains untouched. Financial adjustments are intentionally decoupled and deferred to Part 4E.6.
7. **Database Isolation & Platform Preservation:** Development database `miljor_db` and persistent sandbox evidence database `miljor_sandbox_db` remained 100% untouched and pristine throughout the entire migration, implementation, and regression lifecycle.

---

## 2. Reused Platform Components

In compliance with Lean Senior Engineering Mode and Protocol v2.0, existing platform primitives were reused without duplication:
- **`src/config/db.js`:** Enforces authoritative UTC session initialization (`SET time_zone = '+00:00'`) on every physical connection.
- **`src/services/reservationEventService.js`:** Generates deterministic unique event IDs and powers transactional outbox business events (`ORDER_DISPUTE_CREATED`, `ORDER_DISPUTE_SUPPLIER_RESPONDED`, `ORDER_DISPUTE_ADMIN_DECIDED`, `ORDER_DISPUTE_CLOSED`).
- **`src/services/supplierEligibilityPolicy.js`:** Validates three-way affirmative supplier account and profile verification.
- **`src/services/fulfillmentService.js`:** Integrated dispute state validation into `confirmBuyerReceipt` to fail-closed with `409 UNRESOLVED_DISPUTE_EXISTS` if active disputes exist on the order.
- **`src/utils/exactDecimal.js`:** Powers exact BigInt-scaled half-up decimal calculations (`exactMultiplyRound(qty, price, 2)`), guaranteeing zero floating-point drift.
- **`src/middlewares/authGuard.js`:** Enforces JWT session validation and strict RBAC (`authorizeStrict('BUYER')`, `authorizeStrict('SUPPLIER')`, `authorizeAdmin`).
- **`src/middlewares/idempotencyGuard.js`:** Enforces mandatory idempotency keys (`idempotencyGuard.required`), payload hashing, concurrent request locking, and cached response replaying.

---

## 3. Schema & Migration Changes

### 3.1 Migration 021: Dispute & Fulfillment Exception Resolution
**File:** `database/migrations/021_dispute_and_fulfillment_exception_resolution.sql`
- **Extended `order_disputes` Table:**
  - `supplier_id INT NULL`: Explicit foreign key to `suppliers(id)` for performant tenancy scoping.
  - `dispute_category ENUM('DAMAGED_GOODS', 'MISSING_ITEMS', 'QUALITY_ISSUE', 'INCORRECT_ITEM', 'SUPPLIER_SHORTAGE', 'OTHER') NOT NULL`: Formal categorization replacing unstructured text.
  - `reporting_actor_role ENUM('BUYER', 'SUPPLIER', 'ADMIN') NOT NULL DEFAULT 'BUYER'`: Tracks the originating role.
  - Line-Item Accounting: `expected_quantity DECIMAL(12,4) NULL`, `reported_quantity DECIMAL(12,4) NULL`, `disputed_quantity DECIMAL(12,4) NULL`, `claimed_amount DECIMAL(12,2) NULL`, `currency VARCHAR(3) NOT NULL DEFAULT 'PKR'`.
  - Operational Remediation: `remediation_proposal ENUM('REPLACEMENT_DISPATCH', 'FULL_RETURN', 'OPERATIONAL_REDELIVERY', 'NONE') NOT NULL DEFAULT 'NONE'`, `remediation_details TEXT NULL`, `remediation_status ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING'`.
  - Operational Timestamps: `remediation_dispatched_at DATETIME NULL`, `remediation_delivered_at DATETIME NULL`, `buyer_remediation_confirmed_at DATETIME NULL`, `remediation_notes TEXT NULL`.
  - Administrative Governance: `admin_decision ENUM('BUYER_CLAIM_ACCEPTED', 'BUYER_CLAIM_REJECTED', 'MUTUAL_RESOLUTION', 'ESCALATED_FOR_MANUAL_REVIEW') NULL`, `decision_reason TEXT NULL`, `decision_recorded_at DATETIME NULL`, `decision_by INT NULL`.
  - Case Closure: `closure_reason TEXT NULL`, `closed_at DATETIME NULL`.
  - Idempotency & Evidence: `idempotency_key VARCHAR(64) NULL UNIQUE`, `evidence_metadata JSON NULL`.
  - Status Enum Expansion: `'OPEN'`, `'UNDER_SUPPLIER_REVIEW'`, `'SUPPLIER_REMEDIATION_PROPOSED'`, `'UNDER_ADMIN_REVIEW'`, `'EVIDENCE_REQUESTED'`, `'RESOLUTION_RECORDED'`, `'CLOSED'`, `'RESOLVED'`, `'REJECTED'`.
  - Performance Indexes: Compound indexes `(buyer_id, status)`, `(supplier_id, status)`, `(order_id, status)`.

- **Created `order_dispute_events` Table:**
  - Immutable chronological event ledger tracking all transitions and operational notes.
  - Schema:
    ```sql
    CREATE TABLE IF NOT EXISTS order_dispute_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      dispute_id INT NOT NULL,
      event_type VARCHAR(64) NOT NULL,
      actor_role ENUM('BUYER', 'SUPPLIER', 'ADMIN', 'SYSTEM') NOT NULL,
      actor_id INT NOT NULL,
      from_status VARCHAR(64) NULL,
      to_status VARCHAR(64) NOT NULL,
      notes TEXT NULL,
      metadata JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_dispute_events_dispute FOREIGN KEY (dispute_id) REFERENCES order_disputes (id) ON DELETE CASCADE,
      INDEX idx_dispute_events_lookup (dispute_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ```

### 3.2 Rollback Migration
**File:** `database/migrations/rollback/021_rollback_dispute_and_fulfillment_exception_resolution.sql`
- Drops `order_dispute_events` table and cleanly rolls back added columns, constraints, and indexes on `order_disputes`.
- Verified on `miljor_test_db` with 100% round-trip fidelity before baseline deployment.

---

## 4. Dispute Lifecycle & State Transition Matrix

The dispute state machine enforces strict role authorization and valid operational transitions:

| From Status | Allowed Trigger / Action | Authorized Role | Resulting Status |
|:---|:---|:---|:---|
| *(None)* | Buyer creates discrepancy dispute | Buyer (`BUYER`) | `OPEN` |
| *(None)* | Supplier declares inventory shortage | Supplier (`SUPPLIER`) | `UNDER_ADMIN_REVIEW` |
| `OPEN` | Supplier submits response / remediation proposal | Supplier (`SUPPLIER`) | `SUPPLIER_REMEDIATION_PROPOSED` |
| `OPEN` / `UNDER_SUPPLIER_REVIEW` | Admin requests evidence from parties | Admin (`ADMIN`) | `EVIDENCE_REQUESTED` |
| `SUPPLIER_REMEDIATION_PROPOSED` | Supplier declares remediation dispatched | Supplier (`SUPPLIER`) | `SUPPLIER_REMEDIATION_PROPOSED` (`remediation_status='IN_PROGRESS'`) |
| `SUPPLIER_REMEDIATION_PROPOSED` | Buyer confirms remediation receipt | Buyer (`BUYER`) | `SUPPLIER_REMEDIATION_PROPOSED` (`remediation_status='COMPLETED'`) |
| Any Active Status | Admin records arbitration decision | Admin (`ADMIN`) | `RESOLUTION_RECORDED` |
| Any Active / Resolved Status | Admin closes dispute with documented reason | Admin (`ADMIN`) | `CLOSED` |

### Key State Machine Invariants:
1. **No Supplier Self-Closure:** Suppliers cannot resolve or close disputes. Any attempt fails with `403 UNAUTHORIZED_ROLE`.
2. **Remediation Guard on Closure:** If a supplier has proposed replacement dispatch (`remediation_proposal = 'REPLACEMENT_DISPATCH'`), the dispute cannot be closed until the buyer has confirmed receipt (`remediation_status = 'COMPLETED'`), failing with `422 REMEDIATION_INCOMPLETE`.
3. **Escrow Permanence:** Transitioning to `RESOLUTION_RECORDED` or `CLOSED` explicitly keeps `payments.escrow_status = 'HELD_IN_ESCROW'`.

---

## 5. Actor Permissions & RBAC Matrix

| Endpoint | Method | Path | Allowed Roles | Enforcement Mechanism |
|:---|:---|:---|:---|:---|
| Create Buyer Dispute | `POST` | `/api/v1/disputes` | `BUYER` | JWT + `authorizeStrict('BUYER')` + Order Ownership Guard |
| Supplier Shortage Exception | `POST` | `/api/v1/disputes/supplier-shortage` | `SUPPLIER` | JWT + `authorizeStrict('SUPPLIER')` + Assigned Supplier Guard |
| Supplier Response | `POST` | `/api/v1/disputes/:id/supplier-response` | `SUPPLIER` | JWT + `authorizeStrict('SUPPLIER')` + Assigned Dispute Guard |
| Remediation Dispatched | `POST` | `/api/v1/disputes/:id/remediation-dispatched` | `SUPPLIER` | JWT + `authorizeStrict('SUPPLIER')` + Assigned Dispute Guard |
| Buyer Confirm Remediation | `POST` | `/api/v1/disputes/:id/buyer-confirm-remediation` | `BUYER` | JWT + `authorizeStrict('BUYER')` + Dispute Ownership Guard |
| Admin Decision | `POST` | `/api/v1/disputes/:id/admin-decision` | `ADMIN` | JWT + `authorizeAdmin` |
| Admin Evidence Request | `POST` | `/api/v1/disputes/:id/request-evidence` | `ADMIN` | JWT + `authorizeAdmin` |
| Admin Close Dispute | `POST` | `/api/v1/disputes/:id/close` | `ADMIN` | JWT + `authorizeAdmin` |
| Get Dispute by ID | `GET` | `/api/v1/disputes/:id` | `BUYER`, `SUPPLIER`, `ADMIN` | JWT + Multi-Tenant Ownership Authorization Guard |
| Buyer Disputes List | `GET` | `/api/v1/disputes/my` | `BUYER` | JWT + `authorizeStrict('BUYER')` |
| Supplier Disputes List | `GET` | `/api/v1/disputes/supplier/list` | `SUPPLIER` | JWT + `authorizeStrict('SUPPLIER')` |
| Admin Disputes List | `GET` | `/api/v1/disputes` | `ADMIN` | JWT + `authorizeAdmin` |

---

## 6. Financial Safety Invariants & Claim Arithmetic

### 6.1 Server-Calculated Line-Item Claims
Client-submitted monetary amounts are strictly ignored. The claimed amount is computed deterministically by the backend using locked order snapshot figures:
$$\text{Claimed Amount} = \text{exactMultiplyRound}(\text{disputed\_quantity}, \text{order.unit\_price}, 2)$$
- Computed using `BigInt` half-up rounding (`exactDecimal.js`).
- Enforces $\text{disputed\_quantity} \le \text{order.total\_qty}$.
- Prevents overlapping claims: The sum of active disputed quantities across all open/pending disputes on an order cannot exceed the order's total quantity ($\sum Q_{\text{disputed}} \le Q_{\text{order}}$).

### 6.2 Zero Automated Money Movement Proof
During Part 4E.5 execution:
- `payments.escrow_status` strictly remains `'HELD_IN_ESCROW'`.
- Zero Safepay API refund or disbursement calls are executed.
- Zero mutations occur in `platform_ledger`.
- Zero cash adjustments occur on buyer or supplier balances.
All monetary adjustments, return settlements, and liability debits are decoupled and deferred to Part 4E.6.

---

## 7. Concurrency, Locking & Idempotency Strategy

1. **Row-Level Pessimistic Locking:** All dispute state mutations (`createBuyerDispute`, `createSupplierShortageException`, `submitSupplierResponse`, `confirmBuyerRemediationReceipt`, `recordAdminDecision`, `closeDispute`) lock the order and dispute rows using `SELECT ... FOR UPDATE` within atomic MySQL transactions.
2. **Mandatory Idempotency (`idempotencyGuard.required`):**
   - Dispute creation requires `X-Idempotency-Key`.
   - Identical payloads replay the cached response immediately.
   - Replaying with conflicting payloads fails with `409 IDEMPOTENCY_PAYLOAD_CONFLICT`.
3. **Dispute vs. Fulfillment Confirmation Race Safety:**
   - `confirmBuyerReceipt` in `fulfillmentService.js` performs an authoritative row-locked check against `order_disputes` for active unresolved cases (`status NOT IN ('CLOSED', 'REJECTED')`).
   - If active disputes exist, confirmation immediately halts with `409 UNRESOLVED_DISPUTE_EXISTS`.

---

## 8. Evidence Handling Security Boundaries

All evidence metadata passed to `/api/v1/disputes` is sanitized:
- Strict JSON type validation.
- Protocol enforcement: Only safe HTTP/HTTPS and approved storage schemes (`http://`, `https://`, `storage://`, `s3://`) are allowed.
- Dangerous URI schemes (`file://`, `data:`, `javascript:`, `ftp:`) are strictly rejected with `400 FORBIDDEN_EVIDENCE_REFERENCE`.
- Path traversal sequences (`../`, `..\`) are strictly prohibited.

---

## 9. Comprehensive Verification & Master Regression Results

### 9.1 Focused Part 4E.5 Dispute Gate (`tests/part4e5_dispute_gate.js`)
Execution against `miljor_test_db`: **40 / 40 Assertions PASS (0.88s)**
- Section 1: Commercial Order Fixture Setup (1/1)
- Section 2: Buyer Dispute Creation & Validation (12/12)
- Section 3: Line-Item & Multi-Case Dispute Integrity (2/2)
- Section 4: Buyer Confirmation vs Dispute Race Safety (1/1)
- Section 5: Supplier Shortage Exception & RBAC (2/2)
- Section 6: Supplier Response & Remediation Proposal (3/3)
- Section 7: Remediation Dispatch & Buyer Receipt Authority (4/4)
- Section 8: Admin Arbitration & Operational Decision (5/5)
- Section 9: Case Closure & Safe Fulfillment Resumption (3/3)
- Section 10: Audit Timeline & Evidence Security (3/3)
- Section 11: Read Models & Platform Invariants (4/4)

### 9.2 Authoritative Platform Master Regression (`tests/master_regression_runner.js`)
Sequential execution across all 28 platform test suites:

| # | Suite Name | Focus | Assertions | Duration | Status |
|:---|:---|:---|:---:|:---:|:---:|
| 01 | `phase1_gate.js` | Core Models & DB Foundations | 12 | 0.28s | PASS |
| 02 | `part2_security_gate.js` | Security, RBAC & Protection | 16 | 1.73s | PASS |
| 03 | `part3_specification_gate.js` | Catalog Normalization & Canonical Hashes | 15 | 0.97s | PASS |
| 04 | `part4b1_pool_foundation_gate.js` | Regular Pool Foundation & Migrations | 16 | 0.37s | PASS |
| 05 | `part4b2_pool_creation_gate.js` | Atomic Pool Creation & Term Validations | 22 | 0.90s | PASS |
| 06 | `part4b3_pool_publishing_gate.js` | Inventory Allocations & Publishing | 25 | 0.85s | PASS |
| 07 | `pre4c1_concurrency_hardening_gate.js` | Concurrency & Isolation Hardening | 15 | 1.06s | PASS |
| 08 | `pre4b4_idempotency_crash_recovery_gate.js` | Crash Recovery & Heartbeat Liveness | 11 | 1.03s | PASS |
| 09 | `part4b4_buyer_reservation_gate.js` | Reservation Engine & Capacity Control | 28 | 1.65s | PASS |
| 10 | `part4b4_1_reservation_hardening_gate.js` | Reservation Hardening & State Integrity | 18 | 2.05s | PASS |
| 11 | `part4b4_2_observations_integrity_gate.js` | Critical Integrity & OBS-21–25 | 20 | 2.18s | PASS |
| 12 | `part4c1_reservation_mutations_gate.js` | Reservation Modifications & Cancellations | 56 | 3.86s | PASS |
| 13 | `part4c2a_progress_pricing_gate.js` | Authoritative Progress, Pricing & Read Model | 28 | 1.59s | PASS |
| 14 | `part4c2b_events_visibility_gate.js` | Durable Business Events & Visibility | 30 | 1.02s | PASS |
| 15 | `part4c2_combined_integration_gate.js` | Combined Reservation & Event Hardening | 28 | 0.88s | PASS |
| 16 | `part4c3_lifecycle_expiry_gate.js` | Reservation Lifecycle, Expiry & Participation | 28 | 2.31s | PASS |
| 17 | `part4c3_1_scheduler_safety_gate.js` | Scheduler Containment & Expiry Clock | 12 | 1.97s | PASS |
| 18 | `part4d1_commercial_foundation_gate.js` | Commercial Lifecycle Foundation & Safe Closure | 34 | 2.16s | PASS |
| 19 | `part4d2_pool_qualification_gate.js` | Pool Qualification & Atomic Closure Decision | 30 | 2.17s | PASS |
| 20 | `part4d2_1_security_integrity_gate.js` | Security Audit, Legacy Containment & Hardening | 22 | 0.85s | PASS |
| 21 | `part4d3_supplier_decision_gate.js` | Supplier Confirmation & Rejection Engine | 22 | 1.18s | PASS |
| 22 | `part4d4_buyer_commitment_gate.js` | Buyer Offer, Explicit Commitment & Final Demand | 21 | 1.66s | PASS |
| 23 | `part4e1_order_foundation_gate.js` | Order Architecture & Commercial Reconciliation | 23 | 0.83s | PASS |
| 24 | `part4e1_1_financial_hardening_gate.js` | Exact Financial Arithmetic & Consistency | 22 | 0.70s | PASS |
| 25 | `part4e2_order_conversion_gate.js` | Authoritative Order Conversion Gate | 22 | 0.80s | PASS |
| 26 | `part4e3_safepay_sandbox_payment_gate.js` | Safepay Sandbox Checkout & Payment State Machine | 28 | 0.74s | PASS |
| 27 | `part4e4_fulfillment_gate.js` | Post-Payment Fulfillment & Supplier Delivery Gate | 36 | 0.89s | PASS |
| 28 | `part4e5_dispute_gate.js` | Buyer Protection & Dispute Resolution Gate | 40 | 0.88s | PASS |

- **Total Platform Assertions Verified:** 680 / 680 (100% PASS)
- **Total Wall-Clock Execution Time:** 37.57 seconds
- **Overall Platform Verdict:** ✅ 100% PASS

---

## 10. Database Isolation & Preservation Evidence

Both protected databases were independently verified before and after migration and regression testing:
1. **`miljor_db` (Development Database):**
   - Tables: 31 intact.
   - Baseline Rows: Pools = 2, Reservations = 0, Business Events = 0, Mutations = 0, Commercial Snapshots = 0, Supplier Decisions = 0, Buyer Decisions = 0, Orders = 0, Payment Attempts = 0, Payments = 0, Fulfillment Events = 0, Disputes = 0, Dispute Events = 0.
   - Status: **100% PRISTINE**.
2. **`miljor_sandbox_db` (Persistent Sandbox Evidence Database):**
   - Tables: 31 intact.
   - Persistent Safepay E2E evidence preserved without corruption or schema mismatch.
   - Status: **100% PRESERVED**.

---

## 11. Deferred Business Policies (Part 4E.6 Settlement & Refund Engine)

The following financial features were intentionally excluded from Part 4E.5 and are deferred to Part 4E.6:
1. **Automated Refund Issuance:** Safepay sandbox refund API calls for partial or full refunds.
2. **Supplier Settlement & Escrow Release:** Transitioning `payments.escrow_status` from `HELD_IN_ESCROW` to `RELEASED_TO_SUPPLIER`.
3. **Platform Fee Disbursements:** Platform commission recognition and platform ledger postings for completed orders.
4. **Supplier Penalty Adjustments:** Automated deduction of compensation amounts from supplier future disbursements.

---

## 12. Final Status Block

```
================================================================================
MILJOR PART 4E.5 FINAL STATUS BLOCK
================================================================================
Status: COMPLETE
Overall Verdict: PASS (680 / 680 Platform Assertions PASS across 28 suites)
Focused Gate Verdict: PASS (40 / 40 Assertions in tests/part4e5_dispute_gate.js)
Regression Execution Time: 37.57 seconds
Migration Applied: 021_dispute_and_fulfillment_exception_resolution.sql (31 tables)
Rollback Verified: 021_rollback_dispute_and_fulfillment_exception_resolution.sql
Development Database (miljor_db): 100% PRISTINE (0 test rows, 0 disputes, 0 orders)
Persistent Sandbox Database (miljor_sandbox_db): 100% PRESERVED (31 tables intact)
Financial Safety Invariant: Escrow strictly HELD_IN_ESCROW (0 refunds, 0 disbursements)
Next Planned Milestone: Part 4E.6 (Supplier Settlement, Escrow Release & Refund Engine)
================================================================================
```
