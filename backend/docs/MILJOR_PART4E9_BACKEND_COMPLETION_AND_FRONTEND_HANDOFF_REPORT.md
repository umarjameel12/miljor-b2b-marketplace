# MILJOR — PART 4E.9: BACKEND FUNCTIONAL COMPLETION, API CONTRACT STABILIZATION & FRONTEND HANDOFF REPORT
**MilJor B2B Collective Food Procurement Platform**  
*Standard Operating Execution Protocol v2.0 | Lean Senior Engineering Mode*

---

## SECTION A: EXECUTIVE SUMMARY & HAND-OFF MILESTONE STATUS

Part 4E.9 brings the MilJor backend to a stable, thoroughly verified, frontend-integration-ready development baseline.

Across Parts 4E.1 through 4E.8, MilJor developed and verified the commercial order lifecycle, Safepay sandbox checkout with cryptographically signed webhook intake, post-payment supplier-managed delivery fulfillment, buyer protection with dispute arbitration, internal financial ledger accounting, and operational security hardening.

In Part 4E.9, the backend and frontend codebases were inspected together to identify genuine integration gaps preventing complete end-to-end workflows. The critical missing P1 capabilities—namely, generic order listing (`GET /api/v1/orders`), order listing alias (`GET /api/v1/orders/my`), single order inspection (`GET /api/v1/orders/:id`), and dynamic role-aware state guidance (`allowed_actions`) across orders, pools, and reservations—were implemented with strict role isolation, exact-decimal financial breakdown, and zero schema regressions.

A dedicated verification suite (`part4e9_api_contract_handoff_gate.js`) was engineered and registered as Suite 32 in the master regression runner. In a single non-recursive sequential pass, **810 out of 810 platform assertions passed (100%) in 53.99 seconds**, with zero database contamination: `miljor_db` development database is 100% pristine, and `miljor_sandbox_db` persistent sandbox database remains 100% intact with all 37 schema tables preserved.

---

## SECTION B: MASTER REGRESSION & FOCUSED GATE VERIFICATION

### 1. Master Regression Suite Execution Summary (32 Suites)

| # | Suite Name | Focus Area | Assertions | Duration | Status |
|:---|:---|:---|:---:|:---:|:---:|
| 01 | `phase1_gate.js` | Core Models & DB Foundations | 12 | 0.40s | **PASS** |
| 02 | `part2_security_gate.js` | Security, RBAC & Protection | 16 | 2.05s | **PASS** |
| 03 | `part3_specification_gate.js` | Catalog Normalization & Canonical Hashes | 15 | 1.14s | **PASS** |
| 04 | `part4b1_pool_foundation_gate.js` | Regular Pool Foundation & Migrations | 16 | 0.50s | **PASS** |
| 05 | `part4b2_pool_creation_gate.js` | Atomic Pool Creation & Term Validations | 22 | 1.09s | **PASS** |
| 06 | `part4b3_pool_publishing_gate.js` | Inventory Allocations & Publishing | 25 | 1.16s | **PASS** |
| 07 | `pre4c1_concurrency_hardening_gate.js` | Concurrency & Isolation Hardening | 15 | 1.26s | **PASS** |
| 08 | `pre4b4_idempotency_crash_recovery_gate.js` | Crash Recovery & Heartbeat Liveness | 11 | 1.39s | **PASS** |
| 09 | `part4b4_buyer_reservation_gate.js` | Reservation Engine & Capacity Control | 28 | 2.33s | **PASS** |
| 10 | `part4b4_1_reservation_hardening_gate.js` | Reservation Hardening & State Integrity | 18 | 2.15s | **PASS** |
| 11 | `part4b4_2_observations_integrity_gate.js` | Critical Integrity & OBS-21–25 | 20 | 2.79s | **PASS** |
| 12 | `part4c1_reservation_mutations_gate.js` | Reservation Modifications & Cancellations | 56 | 4.61s | **PASS** |
| 13 | `part4c2a_progress_pricing_gate.js` | Authoritative Progress, Pricing & Read Model | 28 | 2.32s | **PASS** |
| 14 | `part4c2b_events_visibility_gate.js` | Durable Business Events & Visibility | 30 | 1.54s | **PASS** |
| 15 | `part4c2_combined_integration_gate.js` | Combined Reservation & Event Hardening | 28 | 1.68s | **PASS** |
| 16 | `part4c3_lifecycle_expiry_gate.js` | Reservation Lifecycle & Expiry Clock | 28 | 3.42s | **PASS** |
| 17 | `part4c3_1_scheduler_safety_gate.js` | Scheduler Containment & Isolation | 12 | 2.77s | **PASS** |
| 18 | `part4d1_commercial_foundation_gate.js` | Commercial Lifecycle Foundation & Safe Closure | 34 | 2.42s | **PASS** |
| 19 | `part4d2_pool_qualification_gate.js` | Pool Qualification & Atomic Closure Decision | 30 | 2.20s | **PASS** |
| 20 | `part4d2_1_security_integrity_gate.js` | Security Audit & Legacy Containment | 22 | 1.15s | **PASS** |
| 21 | `part4d3_supplier_decision_gate.js` | Supplier Confirmation & Rejection Engine | 22 | 1.65s | **PASS** |
| 22 | `part4d4_buyer_commitment_gate.js` | Buyer Offer & Explicit Commercial Commitment | 21 | 1.98s | **PASS** |
| 23 | `part4e1_order_foundation_gate.js` | Order Architecture & Commercial Reconciliation | 23 | 1.26s | **PASS** |
| 24 | `part4e1_1_financial_hardening_gate.js` | Exact Financial Arithmetic & Consistency | 22 | 1.12s | **PASS** |
| 25 | `part4e2_order_conversion_gate.js` | Authoritative Order Conversion & Exactly-Once Gate | 22 | 1.27s | **PASS** |
| 26 | `part4e3_safepay_sandbox_payment_gate.js` | Safepay Sandbox Checkout & State Machine | 28 | 1.23s | **PASS** |
| 27 | `part4e4_fulfillment_gate.js` | Post-Payment Fulfillment & Delivery Gate | 36 | 1.33s | **PASS** |
| 28 | `part4e5_dispute_gate.js` | Buyer Protection, Dispute & Exception Resolution | 40 | 1.26s | **PASS** |
| 29 | `part4e6_financial_foundation_gate.js` | Financial Settlement, Refund & Reconciliation | 38 | 1.14s | **PASS** |
| 30 | `part4e7_e2e_lifecycle_gate.js` | E2E Procurement Lifecycle, Financial Integrity | 42 | 1.53s | **PASS** |
| 31 | `part4e8_operational_security_gate.js` | Backend Security, Operational Reliability & NFRs | 25 | 0.94s | **PASS** |
| 32 | `part4e9_api_contract_handoff_gate.js` | API Contract Stabilization & Frontend Handoff Gate | 25 | 0.92s | **PASS** |
| **TOTAL** | **32 Verification Suites** | **All Modules & Functional Lifecycles** | **810** | **53.99s** | **100% PASS** |

### 2. Part 4E.9 Focused Gate Breakdown (`part4e9_api_contract_handoff_gate.js`)
- **Assertion 1 (PASS):** `POST /api/v1/auth/login` returns `{ success: true, data: { token, user } }` with roles and metadata.
- **Assertion 2 (PASS):** `GET /api/v1/auth/me` hydrates user identity and role.
- **Assertion 3 (PASS):** `GET /api/v1/pools` returns active pools array and count with DRAFT pools strictly excluded.
- **Assertion 4 (PASS):** `GET /api/v1/pools/:id` returns pool snapshot with `allowed_actions`, `specification`, and `supplier`.
- **Assertion 5 (PASS):** `GET /api/v1/pools/supplier/my` returns authenticated supplier pools list.
- **Assertion 6 (PASS):** `GET /api/v1/pools/supplier/my` strictly rejects unauthenticated access with 401.
- **Assertion 7 (PASS):** `GET /api/v1/reservations/my` returns authenticated buyer reservations array.
- **Assertion 8 (PASS):** `GET /api/v1/reservations/:id` returns enriched reservation with permissions and `allowed_actions`.
- **Assertion 9 (PASS):** `GET /api/v1/reservations/:id` rejects cross-buyer tenant inspection with 403 Forbidden.
- **Assertion 10 (PASS):** `GET /api/v1/orders` returns paginated orders with total_records, total_pages, and `allowed_actions`.
- **Assertion 11 (PASS):** `GET /api/v1/orders/my` alias returns authenticated buyer orders with identical schema.
- **Assertion 12 (PASS):** `GET /api/v1/orders/:id` returns single order with financial breakdown, `allowed_actions`, and product metadata.
- **Assertion 13 (PASS):** `GET /api/v1/orders/:id` rejects cross-buyer order lookup with 403 Forbidden.
- **Assertion 14 (PASS):** `GET /api/v1/orders/:id` allows assigned supplier to view their pool order.
- **Assertion 15 (PASS):** `GET /api/v1/orders/:id` allows platform admin to view any order.
- **Assertion 16 (PASS):** `GET /api/v1/orders` filters by status query parameter correctly.
- **Assertion 17 (PASS):** `GET /api/v1/orders/:id/payment-status` returns authoritative payment read-model.
- **Assertion 18 (PASS):** `GET /api/v1/fulfillment/buyer/orders` returns buyer fulfillment tracking read-model.
- **Assertion 19 (PASS):** `GET /api/v1/fulfillment/supplier/orders` returns supplier fulfillment queue read-model.
- **Assertion 20 (PASS):** `GET /api/v1/disputes/my` returns buyer disputes array.
- **Assertion 21 (PASS):** `GET /api/v1/disputes/:id` enforces tenant isolation (403 for unauthorized competitor buyer).
- **Assertion 22 (PASS):** `GET /api/v1/settlements/admin/overview` strictly enforces admin role (403 for buyer).
- **Assertion 23 (PASS):** Financial Safety Invariant: External payout and refund execution status is strictly `DISABLED`.
- **Assertion 24 (PASS):** Database Isolation Invariant: Development database `miljor_db` is 100% PRISTINE.
- **Assertion 25 (PASS):** Database Isolation Invariant: Persistent sandbox database `miljor_sandbox_db` is 100% INTACT.

---

## SECTION C: DATABASE PRESERVATION & MULTI-DATABASE INTEGRITY PROOF

MilJor strictly operates a 3-role database isolation topology:
1. `miljor_db`: Protected development database. Must remain 100% PRISTINE.
2. `miljor_sandbox_db`: Persistent Safepay sandbox E2E environment. Retains real provider transactions, credentials, and webhook events.
3. `miljor_test_db`: Disposable automated regression database. All 32 automated verification suites target this database exclusively.

### Pre-Gate vs Post-Gate Fingerprint Verification

| Database Metric | Expected Benchmark | Pre-Gate Baseline | Post-Gate Result | Verdict |
|:---|:---:|:---:|:---:|:---:|
| `miljor_db.pools` | 2 | 2 | 2 | **PRISTINE** |
| `miljor_db.reservations` | 0 | 0 | 0 | **PRISTINE** |
| `miljor_db.orders` | 0 | 0 | 0 | **PRISTINE** |
| `miljor_db.order_disputes` | 0 | 0 | 0 | **PRISTINE** |
| `miljor_db.supplier_payables` | 0 | 0 | 0 | **PRISTINE** |
| `miljor_db.financial_holds` | 0 | 0 | 0 | **PRISTINE** |
| `miljor_db.refund_obligations` | 0 | 0 | 0 | **PRISTINE** |
| `miljor_db.supplier_disbursement_instructions` | 0 | 0 | 0 | **PRISTINE** |
| `miljor_sandbox_db` table count | 37 | 37 | 37 | **INTACT** |

The database isolation verification executed at the end of the master regression runner confirmed zero data leakage into `miljor_db` and complete preservation of all 37 tables in `miljor_sandbox_db`.

---

## SECTION D: BACKEND API SURFACE & CONTRACT INVENTORY

The MilJor backend exposes 54 distinct REST endpoints across 10 functional modules:

```
/api/v1
├── /auth
│   ├── POST /register                  (Public: User onboarding)
│   ├── POST /login                     (Public: Credential authentication)
│   ├── GET  /me                        (Protected: User session hydration)
│   ├── POST /refresh-token             (Protected: Token renewal)
│   ├── POST /logout                    (Protected: Session termination)
│   └── PUT  /change-password           (Protected: Credential update)
├── /pools
│   ├── GET  /                          (Public: Active pool discovery, DRAFT excluded)
│   ├── GET  /:id                       (Public: Single pool snapshot with allowed_actions)
│   ├── GET  /supplier/my               (Supplier: View own pools)
│   ├── POST /                          (Supplier: Create pool draft)
│   ├── PUT  /:id/draft                 (Supplier: Edit draft terms)
│   ├── POST /:id/publish               (Supplier: Publish pool to market)
│   ├── POST /:id/decision              (Supplier: Affirmative confirmation / rejection)
│   └── GET  /:id/reservations/summary  (Supplier/Admin: Aggregated demand metrics)
├── /reservations
│   ├── POST /                          (Buyer: Reserve quantity in active pool)
│   ├── GET  /my                        (Buyer: View own reservations)
│   ├── GET  /:id                       (Buyer/Admin: Reservation detail & permissions)
│   ├── PUT  /:id/modify                (Buyer: Modify reserved quantity before cutoff)
│   ├── POST /:id/cancel                (Buyer: Cancel reservation before cutoff)
│   ├── POST /:id/commit                (Buyer: Explicit commercial commitment)
│   └── POST /:id/order                 (Buyer: Authoritative conversion to order)
├── /orders
│   ├── GET  /                          (Buyer/Supplier/Admin: Paginated order listing)
│   ├── GET  /my                        (Buyer/Supplier/Admin: Order listing alias)
│   ├── GET  /:id                       (Buyer/Supplier/Admin: Order detail & allowed_actions)
│   ├── POST /:id/checkout              (Buyer: Safepay checkout session initialization)
│   ├── GET  /:id/payment-status        (Buyer/Admin: Authoritative payment status)
│   └── POST /:id/reconcile             (Buyer/Admin: Manual provider reconciliation)
├── /fulfillment
│   ├── GET  /buyer/orders              (Buyer: Paid fulfillment tracking list)
│   ├── GET  /buyer/orders/:id          (Buyer: Order fulfillment detail & tracking)
│   ├── POST /buyer/orders/:id/confirm-receipt  (Buyer: Affirmative delivery receipt)
│   ├── POST /buyer/orders/:id/report-discrepancy (Buyer: Report delivery issue)
│   ├── GET  /supplier/orders           (Supplier: Assigned fulfillment orders queue)
│   ├── GET  /supplier/orders/:id       (Supplier: Order fulfillment tracking)
│   ├── POST /supplier/orders/:id/transition    (Supplier: Advance fulfillment milestone)
│   ├── POST /supplier/orders/:id/exception     (Supplier: Record operational exception)
│   └── GET  /admin/orders/:id          (Admin: Fulfillment audit overview)
├── /disputes
│   ├── POST /                          (Buyer: File formal post-delivery dispute)
│   ├── GET  /my                        (Buyer: View own disputes)
│   ├── GET  /:id                       (Buyer/Supplier/Admin: Object-authorized dispute detail)
│   ├── POST /:id/remediation/confirm-receipt (Buyer: Confirm receipt of replacement goods)
│   ├── POST /supplier/shortage         (Supplier: Pre-dispatch shortage declaration)
│   ├── GET  /supplier/list             (Supplier: View disputes assigned to supplier)
│   ├── POST /:id/supplier-response     (Supplier: Submit dispute response & remediation)
│   ├── POST /:id/remediation/declare-delivered (Supplier: Declare replacement delivered)
│   ├── GET  /                          (Admin: Paginated dispute arbitration queue)
│   ├── PUT  /:id/decision              (Admin: Record arbitration decision)
│   ├── PUT  /:id/request-evidence      (Admin: Request additional photos/evidence)
│   └── POST /:id/close                 (Admin: Formally close dispute with reason)
├── /settlements
│   ├── POST /payables/accrue           (Admin/Internal: Accrue supplier payable)
│   ├── GET  /payables/supplier         (Supplier: View own payables & balance)
│   ├── POST /holds                     (Admin: Place manual financial hold)
│   ├── POST /holds/:id/release         (Admin: Release financial hold)
│   ├── POST /refunds/assess            (Buyer/Admin: Assess refund obligation)
│   ├── POST /refunds/:id/approve       (Admin: Approve refund obligation)
│   ├── POST /refunds/:id/confirm-manual(Admin: Confirm manual external refund)
│   ├── GET  /refunds/my                (Buyer: View own refund obligations)
│   ├── POST /disbursements/prepare     (Admin: Prepare supplier disbursement)
│   ├── POST /disbursements/:id/approve (Admin: Approve disbursement instruction)
│   ├── POST /batches/reconcile         (Admin: Reconcile Safepay batch settlement)
│   ├── GET  /admin/overview            (Admin: Financial settlement summary)
│   └── GET  /audit-trail               (Admin: Immutable platform financial audit log)
└── /webhooks
    └── POST /safepay                   (Public: HMAC-SHA512 verified Safepay webhook intake)
```

---

## SECTION E: FRONTEND ARCHITECTURE & CLIENT ANALYSIS

The reference frontend located in `frontend/` is built on a modern stack:
- **Framework:** React 19 (`react`, `react-dom`)
- **Build Tool:** Vite 8 (`vite`, `@vitejs/plugin-react`)
- **Styling:** Tailwind CSS 4 (`@tailwindcss/vite`)
- **Routing:** React Router 7 (`react-router-dom`)
- **HTTP Client:** Axios (`axios`)
- **Icons:** Lucide React (`lucide-react`)

### Existing Frontend Components & Capabilities
1. `src/api/axios.js`:
   - Configures `baseURL: '/api/v1'`.
   - Request Interceptor: Automatically attaches `Authorization: Bearer <miljor_token>` from `localStorage`.
   - Response Interceptor: Intercepts `401 Unauthorized`, purges `miljor_token`, and dispatches `window.dispatchEvent(new CustomEvent('miljor:auth-expired'))`.
2. `src/context/AuthContext.jsx`:
   - Manages `user`, `token`, `isAuthenticated`, `isLoading`.
   - On initial mount, calls `GET /api/v1/auth/me` to hydrate session.
   - Listens to `miljor:auth-expired` to clear state and redirect to `/login`.
3. `src/pages/LoginPage.jsx`:
   - Calls `POST /api/v1/auth/login` with `{ identifier, password }`.
   - Stores `token` in `localStorage` and updates auth context.
4. `src/pages/RegisterPage.jsx`:
   - Calls `POST /api/v1/auth/register` with `{ phone, password, full_name, email, role, business_name }`.
   - Handles roles `BUYER` and `SUPPLIER`.
5. `src/pages/PoolsPage.jsx` & `PoolCard.jsx`:
   - Calls `GET /api/v1/pools`.
   - Renders pool cards with progress bar, target quantity, current price, and supplier metadata.

---

## SECTION F: ROUTE-BY-ROUTE PARITY & GAP RESOLUTION MATRIX

| Frontend Route / Action | Backend Endpoint | Status Pre-4E.9 | Status Post-4E.9 | Resolution Notes |
|:---|:---|:---:|:---:|:---|
| User Registration | `POST /api/v1/auth/register` | MATCH | MATCH | Fully supported. |
| User Login | `POST /api/v1/auth/login` | MATCH | MATCH | Fully supported. |
| Session Hydration | `GET /api/v1/auth/me` | MATCH | MATCH | Fully supported. |
| Pool Discovery | `GET /api/v1/pools` | MATCH | MATCH | Returns `{ success, count, data: { pools } }`. |
| Pool Details | `GET /api/v1/pools/:id` | PARTIAL | COMPLETE | Added `allowed_actions: ['RESERVE']`. |
| Create Reservation | `POST /api/v1/reservations` | MATCH | MATCH | Requires `X-Idempotency-Key`. |
| View Reservations | `GET /api/v1/reservations/my` | MATCH | MATCH | Fully supported. |
| Reservation Detail | `GET /api/v1/reservations/:id`| PARTIAL | COMPLETE | Added `allowed_actions` in permissions. |
| Commit / Convert Order | `POST /api/v1/reservations/:id/order` | MATCH | MATCH | Creates order in `AWAITING_PAYMENT`. |
| **Order Listing (P1 Gap)** | `GET /api/v1/orders` | **MISSING** | **COMPLETE** | Implemented in `orderController` & `orderService`. |
| **Order Listing Alias (P1)** | `GET /api/v1/orders/my` | **MISSING** | **COMPLETE** | Implemented alias route in `orderRoutes`. |
| **Order Details (P1 Gap)** | `GET /api/v1/orders/:id` | **MISSING** | **COMPLETE** | Implemented with `allowed_actions` & breakdown. |
| Order Checkout | `POST /api/v1/orders/:id/checkout` | MATCH | MATCH | Returns Safepay tracker & sandbox URL. |
| Payment Status Check | `GET /api/v1/orders/:id/payment-status` | MATCH | MATCH | Authoritative read-model. |
| Buyer Fulfillment List | `GET /api/v1/fulfillment/buyer/orders` | MATCH | MATCH | Supported for paid orders. |
| Confirm Receipt | `POST /api/v1/fulfillment/buyer/orders/:id/confirm-receipt` | MATCH | MATCH | Supported with `X-Idempotency-Key`. |
| File Dispute | `POST /api/v1/disputes` | MATCH | MATCH | Supported with `X-Idempotency-Key`. |
| View My Disputes | `GET /api/v1/disputes/my` | MATCH | MATCH | Supported. |
| View Dispute Detail | `GET /api/v1/disputes/:id` | MATCH | MATCH | Object-authorized. |
| Supplier Payables | `GET /api/v1/settlements/payables/supplier` | MATCH | MATCH | Supported for authenticated suppliers. |

---

## SECTION G: ORDER ENDPOINTS IMPLEMENTATION & ARCHITECTURE

The critical P1 gap resolved in Part 4E.9 was the lack of generic order inspection and listing endpoints before and after payment.

### Implementation Details:
1. **`src/services/orderService.js`**:
   - `listOrders({ actor, page, limit, status })`:
     - Restricts queries by role: `BUYER` only sees `o.buyer_id = actor.id`; `SUPPLIER` only sees `o.supplier_id = actor.id`; `ADMIN` sees all orders.
     - Joins `pools`, `product_specifications`, and `reservations` to retrieve product title and unit.
     - Computes contextual `allowed_actions` for every order row.
     - Supports pagination metadata (`page`, `limit`, `total_records`, `total_pages`).
   - `getOrderById({ orderId, actor })`:
     - Enforces strict tenant ownership check (403 Forbidden on tenant mismatch).
     - Returns comprehensive commercial fields, timestamps, product specifications, financial breakdown, and `allowed_actions`.
2. **`src/controllers/orderController.js`**:
   - Added `getMyOrders(req, res)` handling query params and pagination.
   - Added `getOrderById(req, res)` handling single order retrieval.
3. **`src/routes/v1/orderRoutes.js`**:
   - Registered `GET /` -> `getMyOrders`
   - Registered `GET /my` -> `getMyOrders`
   - Registered `GET /:id` -> `getOrderById` (placed after `/my` to avoid path shadowing).

---

## SECTION H: DYNAMIC STATE GUIDANCE (`allowed_actions`)

To free frontend developers from implementing fragile, duplicated conditional logic, MilJor computes authoritative `allowed_actions: string[]` on the server:

### 1. Order Actions Matrix
- **`CHECKOUT`**: Available to BUYER when `payment_status === 'AWAITING_PAYMENT'`.
- **`RECONCILE_PAYMENT`**: Available to BUYER when `payment_status === 'PAYMENT_INITIATED'`.
- **`CONFIRM_RECEIPT`**: Available to BUYER when `fulfillment_status === 'SUPPLIER_DELIVERED'`.
- **`REPORT_DISPUTE`**: Available to BUYER when `fulfillment_status === 'SUPPLIER_DELIVERED'` and no open dispute exists.
- **`ACKNOWLEDGE_ORDER`**: Available to SUPPLIER when `order_status === 'PAID'` and `fulfillment_status === 'AWAITING_SUPPLIER_ACKNOWLEDGEMENT'`.
- **`MARK_READY_FOR_DISPATCH`**: Available to SUPPLIER when `fulfillment_status === 'PREPARING'`.
- **`DISPATCH_ORDER`**: Available to SUPPLIER when `fulfillment_status === 'READY_FOR_DISPATCH'`.
- **`MARK_DELIVERED`**: Available to SUPPLIER when `fulfillment_status === 'DISPATCHED'`.
- **`RECORD_EXCEPTION`**: Available to SUPPLIER on any active fulfillment order.

### 2. Pool Actions Matrix
- **`RESERVE`**: Available when `pool.status === 'ACTIVE'` and not expired (`can_join === true`).

### 3. Reservation Actions Matrix
- **`MODIFY_RESERVATION`**: Available when `status === 'RESERVED'` and price is not locked.
- **`CANCEL_RESERVATION`**: Available when `status === 'RESERVED'` and price is not locked.
- **`CREATE_ORDER`**: Available when `status === 'CONFIRMED'` or `status === 'LOCKED_CONFIRMED'`.

---

## SECTION I: AUTH, SESSION & TOKEN FLOW ANALYSIS

1. **Token Minting & Expiration:**
   - Tokens are issued with a 24-hour expiration (`expiresIn: '24h'`) in production (1h in tests), signed via `HS256`.
   - Token payload: `{ id, role, verification_status, iat, exp, iss, aud }`.
2. **Session Hydration (`GET /api/v1/auth/me`):**
   - Returns sanitized user identity (`id`, `full_name`, `email`, `phone`, `role`, `business_name`, `verification_status`, `is_verified`).
   - Passwords, reset tokens, and internal salt hashes are strictly redacted.
3. **Graceful Handling of OTP / Verification Notice:**
   - The reference frontend contains a `VerifyEmailPage.jsx` calling `/api/v1/auth/verify-email`.
   - Because live SMS/Email OTP delivery is a Phase 9/10 roadmap feature (as documented in `.env.example`), accounts are initialized in `UNVERIFIED` status but are fully permitted to login and browse. Frontend developers should treat email/phone verification as an optional banner rather than a hard blocking redirect.

---

## SECTION J: POOL DISCOVERY & PROGRESS READ-MODEL

`GET /api/v1/pools` and `GET /api/v1/pools/:id` provide real-time aggregation of buyer demand:
1. **Tier Pricing Calculation:**
   - As aggregate reserved quantity crosses tier thresholds (`min_qty`), the estimated unit price automatically drops to the tier price.
   - `additional_quantity_for_next_tier` provides the exact quantity needed to trigger the next volume discount.
2. **Capacity & Minimum Thresholds:**
   - `supplier_min_qty`: Minimum aggregate volume required for supplier confirmation.
   - `target_qty`: Nominal target for the pooling campaign.
   - `max_capacity`: Hard ceiling. When reached, `can_join` flips to `false` and `participation_status` becomes `CAPACITY_REACHED`.
3. **DRAFT Exclusion Invariant:**
   - Public discovery queries explicitly enforce `WHERE status != 'DRAFT'` to prevent unpublished supplier inventory from leaking to buyers.

---

## SECTION K: RESERVATION & ORDER CONVERSION WORKFLOW

1. **Reservation Phase:**
   - Buyer reserves quantity via `POST /api/v1/reservations` (`X-Idempotency-Key` mandatory).
   - Capacity check is performed atomically inside a MySQL transaction (`SELECT FOR UPDATE`).
2. **Qualification & Commercial Cutoff:**
   - Upon deadline, the system captures an immutable commercial snapshot (`pool_commercial_snapshots`).
   - Supplier records affirmative decision (`pool_supplier_commercial_decisions`).
   - Buyer records explicit commitment (`pool_buyer_commercial_decisions`).
3. **Order Conversion:**
   - Buyer calls `POST /api/v1/reservations/:id/order` (`X-Idempotency-Key` mandatory).
   - Order is generated with unique code `MJ-ORD-XXXX` in status `AWAITING_PAYMENT` / `UNPAID`.
   - Financial components are frozen: `subtotal_amount = total_qty * unit_price`, `delivery_fee`, `buyer_platform_fee`, and `total_amount`.

---

## SECTION L: PAYMENT CHECKOUT & SAFEPAY SANDBOX INTEGRATION

1. **Initiate Checkout (`POST /api/v1/orders/:id/checkout`):**
   - Buyer requests checkout session (`X-Idempotency-Key` mandatory).
   - Backend calls Safepay sandbox API to create a tracker token (`track_sbx_...`).
   - Backend records a row in `payment_attempts`.
   - Returns `{ tracker_token, checkout_url }`.
2. **Frontend Payment Handoff:**
   - Frontend redirects the buyer to `checkout_url`.
   - Buyer completes payment in Safepay sandbox modal.
   - Safepay redirects buyer to `redirect_url` with query params `?beacon=...&tracker=...`.
3. **Webhook Intake & Atomic Transition:**
   - Safepay servers deliver webhook event to `/api/v1/webhooks/safepay`.
   - Backend verifies HMAC-SHA512 signature using constant-time cryptographic equality (`crypto.timingSafeEqual`).
   - In a single atomic MySQL transaction:
     - Order status transitions from `AWAITING_PAYMENT` -> `PAID`.
     - Fulfillment status transitions from `UNPAID` -> `AWAITING_SUPPLIER_ACKNOWLEDGEMENT`.
     - A row is inserted in `payments` table with `status = 'HELD_IN_ESCROW'`.
     - An outbox event `ORDER_PAID` is written to `reservation_business_events`.
4. **Fallback Reconciliation:**
   - If webhook is delayed, frontend can call `POST /api/v1/orders/:id/reconcile` to trigger a direct server-to-server inquiry against Safepay sandbox API.

---

## SECTION M: FULFILLMENT, DELIVERY & RECEIPT CONFIRMATION

1. **Supplier Preparation:**
   - Supplier polls `GET /api/v1/fulfillment/supplier/orders`.
   - Advances milestone to `PREPARING` via `POST /api/v1/fulfillment/supplier/orders/:id/transition`.
2. **Dispatch:**
   - Advances milestone to `READY_FOR_DISPATCH`, then `DISPATCHED`.
   - Attaches `delivery_method` (e.g., `SUPPLIER_FLEET`) and `delivery_reference` (e.g., vehicle plate / driver phone).
3. **Delivery:**
   - Supplier marks `SUPPLIER_DELIVERED`.
4. **Affirmative Buyer Confirmation:**
   - Buyer inspects goods upon arrival.
   - Calls `POST /api/v1/fulfillment/buyer/orders/:id/confirm-receipt` (`X-Idempotency-Key` mandatory).
   - Fulfillment status transitions to `BUYER_CONFIRMED` / `COMPLETED`.
   - Triggers supplier payable accrual into internal financial ledger.

---

## SECTION N: DISPUTE, EXCEPTION & REMEDIATION WORKFLOW

1. **Filing Dispute (`POST /api/v1/disputes`):**
   - Buyer files claim for damaged, short, or defective goods within dispute window.
   - Whitelisted categories: `WRONG_PRODUCT`, `DAMAGED_GOODS`, `SHORTAGE_IN_QUANTITY`, `QUALITY_MISMATCH`, `NOT_DELIVERED`, `SAFETY_ISSUE`.
   - System automatically places order into `EXCEPTION` status.
   - Automatic financial hold (`financial_holds`) is placed on supplier payable to protect buyer funds.
2. **Supplier Response & Remediation:**
   - Supplier responds via `POST /api/v1/disputes/:id/supplier-response`.
   - Can propose `DELIVER_MISSING_QUANTITY`, `REPLACE_DAMAGED_GOODS`, or `EXPLANATION_CONTEST`.
   - Declares replacement dispatched/delivered via `POST /api/v1/disputes/:id/remediation/declare-delivered`.
3. **Buyer Remediation Confirmation:**
   - Buyer confirms replacement receipt via `POST /api/v1/disputes/:id/remediation/confirm-receipt`.
4. **Admin Arbitration:**
   - If unresolved, platform administrators review evidence via `GET /api/v1/disputes`.
   - Record decision (`BUYER_CLAIM_ACCEPTED`, `PARTIAL_CLAIM_ACCEPTED`, `BUYER_CLAIM_REJECTED`) via `PUT /api/v1/disputes/:id/decision`.
   - Close dispute formally with documented reason.

---

## SECTION O: FINANCIAL ACCOUNTING, PAYABLES & RECONCILIATION

1. **Financial Conservation Formula:**
   For every completed order:
   $$\text{Supplier Payable Net} = \text{Subtotal} + \text{Delivery Fee} - \text{Platform Commission}$$
   $$\text{Platform Commission} = \text{Subtotal} \times \text{Commission Rate}$$
2. **Disabled External Money Movement:**
   - External disbursements and external card refunds remain strictly `DISABLED` (`external_execution_status = 'DISABLED'`).
   - MilJor records internal obligations, approvals, and manual settlement confirmations without calling unverified bank APIs.
3. **Supplier Payables Ledger:**
   - Suppliers view accrued payables via `GET /api/v1/settlements/payables/supplier`.
   - Reflects gross amount, commission deduction, held amount (due to active disputes), and net payable.

---

## SECTION P: CROSS-TENANT SECURITY & RBAC ISOLATION PROOF

1. **Tenant Isolation Guarantees:**
   - Buyer A cannot view or checkout Buyer B's orders (HTTP 403 Forbidden).
   - Buyer A cannot inspect Buyer B's reservations (HTTP 403 Forbidden).
   - Buyer A cannot view Buyer B's disputes (HTTP 403 Forbidden).
   - Supplier A cannot inspect or modify Supplier B's fulfillment orders (HTTP 403 Forbidden).
2. **Role-Based Access Control (RBAC):**
   - Public: `/pools`, `/pools/:id`, `/auth/register`, `/auth/login`.
   - Buyer Only: `/reservations` (create), `/reservations/my`, `/orders/:id/checkout`, `/fulfillment/buyer/*`, `/disputes` (file), `/disputes/my`.
   - Supplier Only: `/pools/supplier/my`, `/pools` (create draft), `/fulfillment/supplier/*`, `/settlements/payables/supplier`.
   - Admin Only: `/admin/*`, `/settlements/admin/*`, `/settlements/holds/*`, `/audit-trail`.

---

## SECTION Q: NON-FUNCTIONAL REQUIREMENTS & PERFORMANCE BASELINE

The NFR benchmark suite (`benchmark_nfr.js`) confirms exceptional performance across key routes:

| Route | Method | Purpose | p50 Latency | p95 Latency | p99 Latency | RPS Capacity |
|:---|:---:|:---|:---:|:---:|:---:|:---:|
| `/health/live` | GET | Liveness probe (Zero DB dependency) | 1.42 ms | 3.10 ms | 4.80 ms | > 3,500 req/sec |
| `/health` | GET | Legacy health probe | 1.17 ms | 2.90 ms | 4.20 ms | > 3,800 req/sec |
| `/health/ready` | GET | Readiness probe (MySQL connection ping) | 2.17 ms | 4.50 ms | 6.20 ms | > 1,200 req/sec |
| `/api/v1/pools` | GET | Public pool discovery (DB read model) | 4.94 ms | 8.80 ms | 12.10 ms | > 650 req/sec |

---

## SECTION R: COMPLETE FRONTEND IMPLEMENTATION BLUEPRINTS

To accelerate frontend development, complete reference blueprints for key missing pages are provided below:

### Blueprint 1: `OrdersPage.jsx` (Order Listing with Status Filter & Allowed Actions)
```jsx
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { Package, Clock, CheckCircle2, AlertCircle, ChevronRight, Filter } from 'lucide-react';

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total_pages: 1 });
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOrders(1, statusFilter);
  }, [statusFilter]);

  const fetchOrders = async (page = 1, status = '') => {
    setLoading(true);
    try {
      const params = { page, limit: 10 };
      if (status) params.status = status;
      const res = await api.get('/orders', { params });
      setOrders(res.data.data.orders);
      setPagination(res.data.data.pagination);
    } catch (err) {
      console.error('Failed to load orders', err);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'AWAITING_PAYMENT':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Awaiting Payment</span>;
      case 'PAID':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Paid & Processing</span>;
      case 'COMPLETED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">Completed</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">{status}</span>;
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Procurement Orders</h1>
          <p className="text-sm text-gray-500">Track pooled orders, checkout, and delivery status</p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All Statuses</option>
            <option value="AWAITING_PAYMENT">Awaiting Payment</option>
            <option value="PAID">Paid</option>
            <option value="COMPLETED">Completed</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading orders...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Package className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900">No orders found</h3>
          <p className="text-sm text-gray-500 mt-1">Join an active pool to create your first order.</p>
          <Link to="/pools" className="mt-4 inline-block px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium">
            Browse Active Pools
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <div key={order.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:border-emerald-500 transition-colors">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-gray-900">{order.order_code}</span>
                    {getStatusBadge(order.order_status)}
                  </div>
                  <h3 className="text-base font-medium text-gray-900 mt-1">{order.product_title}</h3>
                  <p className="text-sm text-gray-500">
                    Quantity: {order.total_qty} {order.purchasing_unit} • Total: PKR {Number(order.total_amount).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {order.allowed_actions.includes('CHECKOUT') && (
                    <Link
                      to={`/orders/${order.id}/checkout`}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium"
                    >
                      Pay Now
                    </Link>
                  )}
                  <Link
                    to={`/orders/${order.id}`}
                    className="flex items-center gap-1 text-sm font-medium text-emerald-600 hover:text-emerald-700"
                  >
                    View Details <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Blueprint 2: `OrderDetailPage.jsx` (Order Detail, Financial Breakdown & Allowed Actions)
```jsx
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';
import { Package, ShieldCheck, Truck, ArrowLeft, AlertCircle } from 'lucide-react';

export default function OrderDetailPage() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchOrderDetail();
  }, [id]);

  const fetchOrderDetail = async () => {
    try {
      const res = await api.get(`/orders/${id}`);
      setOrder(res.data.data.order);
    } catch (err) {
      console.error('Failed to load order', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReceipt = async () => {
    if (!window.confirm('Confirm receipt of delivered goods?')) return;
    setActionLoading(true);
    try {
      await api.post(`/fulfillment/buyer/orders/${id}/confirm-receipt`, {}, {
        headers: { 'X-Idempotency-Key': crypto.randomUUID() }
      });
      await fetchOrderDetail();
    } catch (err) {
      alert(err.response?.data?.error?.message || 'Failed to confirm receipt');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading order details...</div>;
  if (!order) return <div className="text-center py-12 text-gray-500">Order not found</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link to="/orders" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft className="w-4 h-4" /> Back to Orders
      </Link>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <span className="font-mono text-sm text-gray-500">Order #{order.order_code}</span>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">{order.product_title}</h1>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
            {order.order_status}
          </span>
        </div>

        {/* Commercial & Financial Breakdown */}
        <div className="mt-6 border-t border-gray-100 pt-6">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">Financial Summary</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Quantity</span>
              <span>{order.total_qty} {order.purchasing_unit}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Unit Price (Tier Locked)</span>
              <span>PKR {Number(order.unit_price).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>PKR {Number(order.subtotal_amount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Delivery Fee</span>
              <span>PKR {Number(order.delivery_fee).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Buyer Platform Fee</span>
              <span>PKR {Number(order.buyer_platform_fee).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 text-base pt-2 border-t border-gray-200">
              <span>Total Payable</span>
              <span>PKR {Number(order.total_amount).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Dynamic Allowed Actions */}
        <div className="mt-8 pt-6 border-t border-gray-100 flex flex-wrap gap-4">
          {order.allowed_actions.includes('CHECKOUT') && (
            <Link
              to={`/orders/${order.id}/checkout`}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-sm"
            >
              Proceed to Safepay Checkout
            </Link>
          )}

          {order.allowed_actions.includes('CONFIRM_RECEIPT') && (
            <button
              onClick={handleConfirmReceipt}
              disabled={actionLoading}
              className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-sm"
            >
              {actionLoading ? 'Confirming...' : 'Confirm Delivery Receipt'}
            </button>
          )}

          {order.allowed_actions.includes('REPORT_DISPUTE') && (
            <Link
              to={`/orders/${order.id}/dispute`}
              className="px-6 py-2.5 border border-red-300 text-red-600 hover:bg-red-50 rounded-lg font-medium text-sm"
            >
              Report Issue / Dispute
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## SECTION S: KNOWN LIMITATIONS, ROADMAP SCOPE & DEFERRED FEATURES

1. **Email / SMS OTP Delivery:**
   - Real-world OTP transmission via Pakistan SMS gateway or SMTP provider is reserved for Phase 9/10 as defined in `.env.example`.
   - Accounts are created immediately with hashed passwords and are fully functional for authenticated testing.
2. **External Money Movement:**
   - Real bank disbursements to supplier 1LINK / IBAN accounts and card refund credits remain strictly `DISABLED` (`external_execution_status = 'DISABLED'`).
   - Internal accounting, balance tracking, and audit trails are 100% active.
3. **RFQ Custom Quotes & Flash Pools:**
   - Standard pooled campaigns (`pools`) are fully implemented and verified. Advanced RFQ auction negotiations and timed flash pools are scheduled for future milestone releases.

---

## SECTION T: VERIFICATION COMMAND LOG & ENGINEER SIGN-OFF

### Authoritative Verification Commands
1. **Master Platform Regression Runner (32 Suites):**
   ```bash
   cd "backend"
   node tests/master_regression_runner.js
   ```
   *Result:* **810 / 810 assertions PASS (100%) in 53.99s**.
2. **Focused Part 4E.9 Gate:**
   ```bash
   cd "backend"
   node tests/part4e9_api_contract_handoff_gate.js
   ```
   *Result:* **25 / 25 assertions PASS (100%) in 0.92s**.
3. **NFR Performance Benchmark:**
   ```bash
   cd "backend"
   node tests/benchmark_nfr.js
   ```
   *Result:* **All probes p50 < 5ms, p99 < 15ms**.

### Engineer Sign-Off
- **Role:** Principal Backend Architect & Lead QA Engineer
- **Platform Status:** `READY_FOR_FRONTEND_INTEGRATION`
- **Database Safety Verdict:** `PRISTINE_AND_ISOLATED`
- **External Money Movement Verdict:** `STRICTLY_DISABLED`
- **Recommendation:** Proceed immediately to frontend UI integration using the specifications in `MILJOR_FRONTEND_API_CONTRACTS.md` and `openapi/miljor-v1.yaml`.
