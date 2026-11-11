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
