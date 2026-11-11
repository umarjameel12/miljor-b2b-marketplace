# MilJor — P0 Safe Migration Reconciliation Audit

**Role:** Principal Software Architect, MySQL Migration Reliability Engineer, and Git Branch Integration Specialist  
**Repository:** `umarjameel12/miljor-b2b-marketplace`  
**Execution Timestamp:** 2026-11-11T21:49:00+05:00  
**Audit Mode:** ZERO-MUTATION READ-ONLY AUDIT  
**Active Protected Database Audit:** `miljor_db` verified 100% UNTOUCHED (`{"users":8,"orders":0,"payments":0,"invoices":0,"pools":2,"reservations":0}`)  

---

## 1. Branch SHA Matrix

The active concurrent development branches and their latest recorded commit SHAs as of audit time:

| Branch Name | Latest Commit SHA | Commit Subject / Description |
| :--- | :---: | :--- |
| `fix/independent-backend-integrity` | `d903a7b40f10ff786ee5ef02cd2be40d2d1987fb` | `docs: record new financial fixes as unverified and contract blocked` |
| `fix/p0-order-commission-snapshot-isolated` | `1dfdc43dda4890067a51ce0dce489ed50ccd94d5` | `docs: record isolated snapshot staging as blocked until migrations and cross-mode integration` |
| `fix/b6-backend-hardening` | `8792ad78a447a91f2b83c91482a2cebdb7fece12` | `docs(phase-log): retain upstream verified B6 Phase 1 report alongside new pending hardening gate` |
| `feature/b6-phase2-nq` | `9c0206bbfe215eef4d98115109d01a98337133e1` | `docs(b6-nq): log 81 mock checks, safe isolated Phase 2 implementation and blocked acceptance` |
| `feature/b6-private-rfq` | `0504d65c7567486483594be23c39d16ebe0cb60e` | `fix(b6): verify B6 Phase 1 (G-M) runtime acceptance, repair routes and migrations` |
| `feature/b6-phase2-reconciliation` | `6731ee04b2256ac997a7ff3e2e07d82a5133a3c6` | `fix(b6-nq): verify B6 Phase 2 (N-Q) runtime acceptance, repair migration 047 syntax` |
| `feature/b4-regular-dual-timers` | `6f79c6584aa93a50f73abe4fa21cb738826dbb97` | `docs(b4): record dual timer lifecycle and deferred final acceptance tests` |
| `feature/ucp3-5-delivery-marketplace-ops`| `6f79c6584aa93a50f73abe4fa21cb738826dbb97` | (Tracks B4 dual timers & UCP ops baseline) |

---

## 2. Migration 033–048 History & Branch Collision Analysis

### 2.1 Branch Migration Matrix (Versions 033 through 048)
Every migration file currently defined across the relevant branch histories:

| Number | Branch: `feature/b6-private-rfq` | Branch: `feature/b6-phase2-nq` | Branch: `fix/independent-backend-integrity` / `fix/p0-...` | Branch: `feature/b4-regular-dual-timers` |
| :---: | :--- | :--- | :--- | :--- |
| **033** | `033_canonical_catalog_and_moderation.sql` | *Same* | *Same* | *Same* |
| **034** | `034_supplier_owned_products_skus_and_immutable_pools.sql` | *Same* | *Same* | *Same* |
| **035** | `035_package_e3_e6_complete_marketplace_schema.sql` | *Same* | *Same* | *Same* |
| **036** | `036_b5_flash_offer_lifecycle.sql` | *Same* | *Same* | *Same* |
| **037** | `037_smart_procurement_requests.sql` | *Same* | *Same* | *Same* |
| **038** | `038_procurement_supplier_invitations.sql` | *Same* | *Same* | *Same* |
| **039** | `039_procurement_supplier_quotes.sql` | *Same* | *Same* | *Same* |
| **040** | `040_procurement_quote_negotiations.sql` | *Same* | *Same* | *Same* |
| **041** | `041_procurement_collective_participation.sql` | *Same* | *Same* | *Same* |
| **042** | `042_procurement_recurring_schedules.sql` | *Same* | *Same* | *Same* |
| **043** | `043_procurement_awards_and_orders.sql` | *Same* | *Same* | *Same* |
| **044** | `044_procurement_collective_bids.sql` | *Same* | *Same* | *Same* |
| **045** | `045_recurring_cycle_requests.sql` | *Same* | *Same* | *Same* |
| **046** | *(None)* | **`046_recurring_collective_cycles.sql`** *(COLLISION A)* | **`046_expand_canonical_product_families.sql`** *(COLLISION B)* | `046_expand_canonical_product_families.sql` |
| **047** | *(None)* | **`047_procurement_delivery_runs.sql`** *(COLLISION A)* | **`047_demand_requester_role.sql`** *(COLLISION B)* | `047_demand_requester_role.sql` |
| **048** | *(None)* | **`048_procurement_notification_outbox.sql`** *(COLLISION A)* | *(None)* | **`048_regular_pool_payment_hold_deadlines.sql`** *(COLLISION C)* |

---

## 3. Database Schema Evidence (`miljor_test_db`)

Direct read-only inspection of `miljor_test_db` revealed:

1. **`SELECT DATABASE()`:** Confirmed strictly connected to `miljor_test_db`.
2. **`schema_migrations` applied versions:**
   - Versions `001` through `048` are recorded as applied in `miljor_test_db`.
   - Versions 046–048 recorded in `schema_migrations` are:
     - `046`: `046_recurring_collective_cycles.sql`
     - `047`: `047_procurement_delivery_runs.sql`
     - `048`: `048_procurement_notification_outbox.sql`
3. **Table presence in `miljor_test_db`:**
   - `procurement_delivery_runs`: **EXISTS** (InnoDB, applied via 047).
   - `procurement_notifications`: **EXISTS** (InnoDB, applied via 048).
   - `flash_pools`: **EXISTS** (InnoDB, applied via 036).
   - `catalog_product_families`: **EXISTS** (InnoDB, baseline 033; has 44 test rows, not the clean 25 from 046-expand).
   - `demand_requests`: **NOT PRESENT** (requires `047_demand_requester_role.sql`).
   - `regular_pool_payment_holds`: **NOT PRESENT** (requires `048_regular_pool_payment_hold_deadlines.sql`).
4. **`orders` table schema:**
   - Columns: `id, order_code, reservation_id, buyer_id, supplier_id, pool_id, snapshot_id, buyer_decision_id, total_qty, unit_price, subtotal_amount, delivery_fee, buyer_platform_fee, total_amount, currency, delivery_type, delivery_method, supplier_delivery_reference, delivery_evidence_notes, acknowledged_at, preparing_at, ready_for_dispatch_at, dispatched_at, supplier_delivered_at, buyer_confirmed_at, completed_at, exception_reason, exception_details, exception_recorded_at, delivery_address, cluster_zone, payment_status, order_status, fulfillment_status, notes, created_at, updated_at`.
   - **`supplier_commission_percent`:** **NOT PRESENT** in `orders` table.

---

## 4. Collision & Free Number Inventory

### 4.1 Conflicting Number Claims
- **Claim on 046:**
  - Branch B6 Phase 2 (`feature/b6-phase2-nq`): `046_recurring_collective_cycles.sql` (Creates 5 tables: cohorts, participants, cycles, member_cycles, events).
  - Branch Integrity/Catalog (`fix/independent-backend-integrity`): `046_expand_canonical_product_families.sql` (Seeds 12 canonical product families: tea, salt, red-chilli, etc.).
- **Claim on 047:**
  - Branch B6 Phase 2 (`feature/b6-phase2-nq`): `047_procurement_delivery_runs.sql` (Creates 3 tables: order_delivery_choices, delivery_runs, delivery_stops).
  - Branch Integrity/Demand (`fix/independent-backend-integrity`): `047_demand_requester_role.sql` (Alters `demand_requests` table to add requester_role and category_id).
- **Claim on 048:**
  - Branch B6 Phase 2 (`feature/b6-phase2-nq`): `048_procurement_notification_outbox.sql` (Creates `procurement_notifications`).
  - Branch B4 Dual Timers (`feature/b4-regular-dual-timers`): `048_regular_pool_payment_hold_deadlines.sql` (Creates `regular_pool_payment_holds`).

### 4.2 Available Future Migration Numbers
Across all examined active branches (`feature/b6-private-rfq`, `feature/b6-phase2-nq`, `fix/independent-backend-integrity`, `fix/p0-order-commission-snapshot-isolated`, `feature/b4-regular-dual-timers`, `feature/ucp3-5-delivery-marketplace-ops`), the highest migration number claimed is **048**.

Therefore, the following version numbers are completely **FREE and UNCLAIMED** across the entire repository:
- **`049`**
- **`050`**
- **`051`**
- **`052`** (and higher)

---

## 5. Cross-Order Creation Commission Snapshot Analysis

### 5.1 The Four Order-Creation Paths in MilJor
Audit of all backend code inserting into the `orders` table identified exactly 4 entry points:

1. **Regular Pool Order Creation:**
   - *Path:* [`backend/src/services/orderService.js`](file:///c:/Users/Umar%20Jameel/OneDrive%20-%20Higher%20Education%20Commission/Documents/MilJor%20Project/backend/src/services/orderService.js#L399) (`createOrderFromReservation`)
   - *Current Implementation in `p0-order-commission-snapshot-isolated`:* Added `feeService.calculateSupplierFeeExact(pool.supplier_id, ..., { lockProfile: true })` and inserted `supplier_commission_percent`.
2. **Flash Clearance Pool Order Creation:**
   - *Path:* [`backend/src/services/flashPoolService.js`](file:///c:/Users/Umar%20Jameel/OneDrive%20-%20Higher%20Education%20Commission/Documents/MilJor%20Project/backend/src/services/flashPoolService.js#L429) (`createHoldAndOrder`)
   - *Current Implementation:* Does NOT yet insert `supplier_commission_percent`. It will default to NULL if not updated, which will block supplier payable accrual upon settlement!
3. **B6 Procurement Single / Split Award Order Creation:**
   - *Path:* [`backend/src/services/procurementAwardService.js`](file:///c:/Users/Umar%20Jameel/OneDrive%20-%20Higher%20Education%20Commission/Documents/MilJor%20Project/backend/src/services/procurementAwardService.js#L311) (`acceptAward`)
   - *Current Implementation:* Creates orders for each awarded supplier in the split basket. Does NOT yet insert `supplier_commission_percent`.
4. **Legacy RFQ Order Creation:**
   - *Path:* [`backend/src/services/procurementService.js`](file:///c:/Users/Umar%20Jameel/OneDrive%20-%20Higher%20Education%20Commission/Documents/MilJor%20Project/backend/src/services/procurementService.js#L286) (`acceptQuote`)
   - *Current Implementation:* Retired in B6, but still contains direct INSERT into `orders`.

### 5.2 Architectural Reconciliation Rule for Commission Snapshots
To ensure zero duplicate financial logic:
1. `feeService.calculateSupplierFeeExact(supplierId, subtotal, connection, { lockProfile: true })` must be the single source of truth called at order-creation time across all 3 active paths (Regular Pool, Flash Pool, B6 Award).
2. The snapshot value must be stored in `orders.supplier_commission_percent` at INSERT time.
3. Historical orders with `NULL` `supplier_commission_percent` must remain fail-closed upon settlement until an approved historical backfill policy is authorized. Never assume a default 2.50% or read the current mutable profile.

---

## 6. Proposed Safe Forward-Only Integration Design

### 6.1 Version Allocation Plan (Linear & Immutable)

| Target Migration Number | Canonical Name | Source Branch Origin | Scope & Responsibility |
| :---: | :--- | :--- | :--- |
| **046** | `046_recurring_collective_cycles.sql` | `feature/b6-phase2-nq` | B6-N Recurring Collective cohorts, cycles, and events schema. |
| **047** | `047_procurement_delivery_runs.sql` | `feature/b6-phase2-nq` | B6-O Paid-order delivery choices, runs, and stops schema (with fixed UNIQUE syntax). |
| **048** | `048_procurement_notification_outbox.sql` | `feature/b6-phase2-nq` | B6-Q Private notification outbox schema. |
| **049** | `049_regular_pool_payment_hold_deadlines.sql` | `feature/b4-regular-dual-timers` | B4 Regular Pool dual-timer payment hold schema (renumbered from 048). |
| **050** | `050_expand_canonical_product_families.sql` | `fix/independent-backend-integrity` | Canonical catalog 12 launch expansion families (renumbered from 046). |
| **051** | `051_demand_requester_role.sql` | `fix/independent-backend-integrity` | Demand requests requester role and category linkage (renumbered from 047). |
| **052** | `052_order_supplier_commission_snapshot.sql` | `fix/p0-order-commission-snapshot-isolated` | Add `supplier_commission_percent DECIMAL(5,2) NULL` to `orders` table. |

### 6.2 Collision Guard Update Strategy
1. The collision guard (`backend/database/migrationCollisionGuard.js`) must be updated to remove the hardcoded abort once the filenames on disk match the linear sequence `046 → 047 → 048 → 049 → 050 → 051 → 052`.
2. The preflight check will confirm that no duplicate numerical prefixes exist across `database/migrations/`.

### 6.3 Recovery Strategy for MySQL DDL
- MySQL does not support transactional DDL (statements like `ALTER TABLE` or `CREATE TABLE` issue an implicit commit).
- If any DDL fails midway:
  1. The migration runner records failure in `schema_migration_attempts`.
  2. The runner fails closed and blocks subsequent migrations until manual inspection.
  3. Every migration must use `CREATE TABLE IF NOT EXISTS` and `ADD COLUMN` checks or idempotent error ignoring (e.g. `ER_DUP_FIELDNAME`, `ER_CHECK_CONSTRAINT_DUP_NAME`) to prevent partial re-run breakage.

---

## 7. Audit Verdict & Blockers

- **Branch SHA Audit:** **VERIFIED**
- **Collision Analysis:** **IDENTIFIED & MAPPED (Versions 046, 047, 048)**
- **Free Migration Space:** **CONFIRMED (049 through 052+ available)**
- **Database Identity & Preservation:** **VERIFIED (`miljor_db` 100% UNTOUCHED)**
- **Audit Verdict:** **PASS — SAFE INTEGRATION DESIGN READY FOR IMPLEMENTATION**

**CAN START NEXT PHASE: NO** (Awaiting explicit user authorization to implement the reconciliation plan)
