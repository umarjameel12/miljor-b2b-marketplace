# MilJor Independent Backend Integrity — Implementation Ledger
Date: 2026-11-11
Branch: `fix/independent-backend-integrity`
Baseline: `fix/b6-backend-hardening`
Status: IMPLEMENTED (partial), NOT TESTED, NOT VERIFIED.

## Scope and branch isolation
This branch is separate from ongoing `feature/b6-phase2-nq` and `feature/b6-private-rfq`.
Do not force-push, merge, or overwrite their work. Recompare branch heads before reconciliation.
No MySQL connection or migration was executed by this implementation session.

## Batch 1 — migration reliability
- Updated `backend/database/runMigrations.js`.
- Preflight manifest validates filenames and unique versions before a database connection.
- Advisory lock serializes migration runners for the selected database.
- Durable `schema_migration_attempts` journals RUNNING/APPLIED/FAILED and checksums.
- An interrupted or failed DDL attempt blocks automatic retry until manually reconciled.
- Existing `schema_migrations` history is retained; failures are fail-closed.
- Added deferred gate `backend/tests/migration_manifest_safety_gate.js`.

## Important limitations / next corrective steps
1. No test has been run yet; execute focused manifest gate and failure-recovery integration simulation on a disposable `miljor_test_db` at the final authorized verification stage.
2. Backup and restore proof is mandatory before any non-test database migration.
3. Reconcile current `schema_migrations` against every available repository migration, including legacy history, before applying a new migration.
4. Do not treat the new journal as a MySQL DDL rollback mechanism. Partial DDL requires explicit human recovery.
5. Compare and integrate latest B6 branch changes before running shared DB tests.
6. Payment rail inconsistency (Safepay-only implementation versus JazzCash/EasyPaisa docs) remains unresolved. Do not activate a new provider without a verified adapter, webhook and refund implementation.
7. Catalog migration 046 exists on the baseline branch; no runtime proof of 25 active families has been obtained.
8. Legacy RFQ/recurring API compatibility and RBAC must be audited and gated before retiring any route.

## Final gate outline (not executed)
```
cd backend
node tests/migration_manifest_safety_gate.js
# Use backed-up, disposable miljor_test_db only for controlled partial-DDL,
# concurrent-runner, history-drift and interrupted-attempt simulations.
# Then run relevant endpoint/security/financial regression tests sequentially.
```

Result: PARTIAL — source changes committed, integrated acceptance deferred.
CAN START NEXT PHASE: NO until branch reconciliation and verification is explicitly recorded.

## Batch 2 — legacy procurement containment and Express 5 route compatibility
Status: IMPLEMENTED, NOT TESTED; final acceptance deferred as requested.
- Existing hardening branch already retired legacy `/rfqs`, `/recurring`, and `/match-suppliers` endpoints via explicit HTTP 410; no duplicate replacement introduced.
- Fixed `backend/src/routes/v1/procurementRoutes.js`: Express 5 incompatible inline route regex changed to supported `/:action` with explicit allowlist `activate,pause,resume,cancel`. Unknown action falls through to 404; caller still passes strict BUYER auth first.
- Fixed `backend/src/controllers/procurementController.js`: public demand-list failures and create-request internal errors return generic responses instead of leaking SQL/internal details. Controlled 4xx errors preserve validation feedback.
- Added `backend/tests/legacy_procurement_containment_gate.js` for the final acceptance pass; real HTTP + authenticated B6 recurring lifecycle tests are also mandatory.
- The `GET /demand-requests` public projection was inspected and already excludes requester names, IDs and raw notes; it was deliberately preserved.
- No buyer, supplier, pool, order or historical RFQ records modified.
- The old 410 endpoints must remain read-only/retired until clients switch to B6 and historical data has a supported archival read path.
- Remaining phase work: reconciliation of payment rails, fees/subscriptions, catalog language and canonical families; do not treat this batch as full-project closure.

## Batch 3 — Financial and supplier entitlement safety
Status: IMPLEMENTED, NOT TESTED, NOT VERIFIED.
- `src/services/feeService.js`: reject absent/ambiguous supplier profiles with 422 SUPPLIER_PROFILE_REQUIRED before computing a supplier fee or net payout; preserve exact decimal formulas and configured percentages.
- `src/services/subscriptionEntitlementService.js`: reject unknown supplier subscription plans with 409 UNKNOWN_SUBSCRIPTION_PLAN; previously silently treated any unknown plan as STARTER.
- Normalize and deduplicate mysql2 family IDs from string/number representations before quota membership and counters; same family consumes one slot regardless of supplier SKU count.
- `tests/financial_entitlement_integrity_gate.js`: prepared final isolated unit checks without DB mutation. Not executed.
- Existing subscription paid-plan Safepay gate preserved. Do not enable unpaid GROWTH/BUSINESS plans and do not silently change tariffs.
- Final gate must also verify legacy/current fee parity, missing supplier rejection, concurrent family publishing, downgrade preservation, cross-supplier isolation, paid upgrade rejection and financial transaction snapshots on `miljor_test_db`.
- Business contract pending explicit reconciliation: plan family limits (4/13/25), no effective maximum SKU per family, buyer processing fee rules and historical onboarding discounts. Do not apply invented pricing rates to real orders.

## Batch 4 — Payment, refund and settlement integrity (2026-11-11)
Status: IMPLEMENTED (targeted fixes); NOT TESTED / NOT VERIFIED.
Branch isolation: `fix/independent-backend-integrity`; no main/B6 merge or database writes.

### Payment authorization boundary
- Legacy `POST /payments/initiate`, `POST /payments/verify`, `GET /payments/my` now use `authorizeStrict('BUYER')`. The broad authorize helper previously allowed SUPER_ADMIN to assume BUYER-only routes.
- Canonical order-first checkout, Safepay webhook confirmation and financial-escrow ledger remain unchanged.

### Refund financial conservation
- Under the locked PAID order, cumulative refund claim balance includes REQUESTED, UNDER_REVIEW, APPROVED, CONFIRMED and in-flight external statuses.
- Multiple pending refund claims cannot individually pass based on the same refundable amount.
- Refund assessment rejects a supplier payable hold which would exceed its remaining entitlement instead of creating unbacked balances. This conservative rule means certain full refunds need an explicit platform-funded component/policy before they can be approved. No false claim that the full policy is implemented.
- Refund approval selects only the exact matching `HOLD-RFND-<refundId>-%` ACTIVE hold, validates amount and held balance, and fails closed if the hold is missing or inconsistent.
- Hold and refund accounting comparisons use exact decimals, not floating-point Number comparisons.
- Financial settlement controller uses generic 5xx errors rather than exposing SQL/internals.

### Deferred final acceptance
- New `backend/tests/phase4_refund_integrity_gate.js`: isolated transaction mocks for pending refund overbooking and exact refund-hold matching. Committed only; not executed.
- On `miljor_test_db` verify signed and forged Safepay webhooks, double webhook, checkout idempotency, PAID-only payable accrual, refund requests vs captured amount, simultaneous refund claims, multiple distinct holds, refund approval, manual reconciliation evidence, hold release, payout preparation after buyer confirmation, supplier KYC, seller/buyer ownership, permissions and transfer-disabled contract.
- No real funds were moved; no external refund execution or payout implementation was enabled.

### Explicit incomplete business-plan items
- Full refunds exceeding supplier net payable need a separately audited platform-fee/delivery-fee funding and reserve allocation model. Do not fake financial conservation by over-holding supplier money.
- Payment rail decision: code and authoritative business invariants specify Safepay-only, whereas older business plan called for JazzCash sandbox. Do not silently enable JazzCash until signed callback verification, reconciliation and refund handling are implemented end-to-end.
- Refund state/payment status across repeated partial refunds and accounting allocation need final integrated DB proof.
- Await final test evidence and branch reconciliation before any production approval.

## Batch 5 — Launch catalog and supplier-owned SKU experience (2026-11-11)
Status: IMPLEMENTED (targeted source changes); NOT TESTED / NOT VERIFIED.
No backend/front-end build or MySQL database operations executed.

### Implemented
1. `frontend/src/pages/SupplierCatalogPage.jsx`: removed runtime fetch/presentation of historical global approved physical variants on the supplier family-selection view. The family browser now directs supplier to define their own product and distinct immutable physical SKUs. Existing my-products/SKUs, offers and pools tabs remain.
2. `backend/src/controllers/catalogController.js`: public category/family responses omit `urdu_name`, treating it as legacy metadata rather than buyer/supplier-facing text. Unexpected 5xx catalog errors are redacted to avoid leaking SQL internals.
3. `frontend/src/pages/AdminCatalogPage.jsx`: removed unused Urdu taxonomy fields from category/family creation state and payload. Existing historical Urdu metadata remains unchanged in the DB.
4. `backend/docs/MILJOR_BUSINESS_INVARIANTS.md`: current 25-family English-only launch decision documented; supplier-owned specifications and SKU immutable lifecycle preserved.
5. `backend/tests/phase5_canonical_catalog_launch_gate.js`: prepared read-only test-database check for 25 approved families/8 food categories; not executed.

### Critical concurrent-branch schema collision (BLOCKED)
- `fix/independent-backend-integrity` inherits migration `046_expand_canonical_product_families.sql` and `047_demand_requester_role.sql` from `fix/b6-backend-hardening`.
- `feature/b6-phase2-nq` independently added `046_recurring_collective_cycles.sql` and `047_procurement_delivery_runs.sql`, plus `048_procurement_notification_outbox.sql`.
- The same version identifiers 046 and 047 have different migration meanings. A direct merge is unsafe. Do not rename an applied SQL migration blindly or apply conflicting versions.
- Reconcile both migration histories using read-only `schema_migrations` checks against the *actual target database*, determine which versions (if any) have already been applied, then establish one immutable consolidated append-only migration sequence with approved repair/mapping and tests on `miljor_test_db`.
- Existing migration runner now rejects duplicate version numbers rather than pretending both applied; this is an intentional safety stop.
- No claim that 25 active families exist in a live database. Migration 046 was not executed here.

### Final acceptance (deferred)
- Run migration collision recovery and preservation rehearsal on `miljor_test_db`.
- Read-only canonical count gate plus public English-only response checks.
- Supplier product/SKU creation, publish, immutable edit rejection, and new SKU-after-change with ownership and entitlement tests.
- Supplier listing/pool creation must only reference supplier-owned published SKU, not historical shared variants.
- Frontend build, buyer family discovery, supplier product/offer UX, and no old 16-staples/Urdu regression.
- Reconcile latest B6 changes before any merge or production rollout.

### Follow-up business identity enforcement
- `backend/src/controllers/supplierListingController.js`: new ACTIVE offers now require a supplier-owned published SKU and its linked physical specification. Legacy `product_spec_id` alone cannot generate a new commercial offer. Cross-supplier or mismatched SKU/spec inputs fail closed, while existing historical listings and orders are preserved.
- The final test gate must verify legacy-global-spec-only rejection, spoofed SKU/spec mismatch rejection, archived/draft SKU rejection, cross-supplier isolation, and legitimate published supplier SKU listing creation.
