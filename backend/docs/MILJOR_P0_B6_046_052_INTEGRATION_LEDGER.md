# MilJor — Isolated P0/B6 migration and commission snapshot integration
Date: 2026-11-11
Branch: `integration/p0-b6-finance-migrations-046-052`

## Readiness
**SOURCE STAGED / SOURCE CHECKED / SCHEMA NOT EXECUTED / END-TO-END NOT VERIFIED / DO NOT MERGE OR DEPLOY YET.**

This integration branch was created from `fix/p0-order-commission-snapshot-isolated`. No changes were sent to `feature/b6-phase2-nq`, `feature/b6-phase2-reconciliation`, `feature/b4-regular-dual-timers`, `fix/b6-backend-hardening`, `feature/b6-private-rfq`, or the protected database.

## Final integrated manifest (file sources preserved on their original branches)
- 046 `046_recurring_collective_cycles.sql` from B6 Phase 2.
- 047 `047_procurement_delivery_runs.sql` from **B6 reconciliation branch (fixed UNIQUE syntax)**.
- 048 `048_procurement_notification_outbox.sql` from B6 Phase 2.
- 049 `049_regular_pool_payment_hold_deadlines.sql` from B4 timer original 048.
- 050 `050_expand_canonical_product_families.sql` from independent catalog original 046.
- 051 `051_demand_requester_role.sql` from independent demand original 047.
- 052 `052_order_supplier_commission_snapshot.sql` new nullable order-time commission snapshot.

Conflicting 046 catalog and 047 demand SQL files were removed from the **integration branch only**, after preserving their contents at versions 050/051. Their original source branches remain unchanged.

## Finance integration
- Regular Pool order conversion: `orderService` freezes a supplier profile percentage under `FOR UPDATE` and writes it to the new order column.
- Flash Pool order creation: `flashPoolService.requestHold` freezes the exact supplier commission under its order transaction, without changing inventory holds/expiry rules.
- B6 Smart Procurement: `procurementAwardService` snapshots the locked supplier percentage when the buyer formally accepts the award; quote previews remain read-only.
- Settlement: `financialSettlementService.accrueSupplierPayable` calculates from `orders.supplier_commission_percent`, not the mutable supplier profile. Missing historic snapshots fail closed.
- `feeService` uses exact decimal calculations and supports a profile row lock only when requested.

## Migration and data safety
- The reconciliation manifest guard requires precisely the 046–052 mapping and rejects the original 046/047/048 colliding names.
- The runner remains fail closed on historic filenames, checksums, interrupted DDL attempts and missing migrations.
- On this branch, runner *also* refuses any database except **miljor_test_db**, and requires explicit `MILJOR_RECONCILED_MIGRATION_TEST_APPROVED=true` to start; it does not connect before approval.
- This does NOT imply that the real `schema_migrations` history was compatible. The user-provided Antigravity audit reports a safe proposed sequence, but actual durable DB state/checksum equivalence must be verified before any rehearsal.
- No forced history rewriting, silent backfill, destructive order changes, production DB mutation or real money movement is authorized.
- 052 preserves old orders' unknown historical rates as `NULL`; they cannot be silently assigned a present-day supplier fee.
- 052 uses additive DDL including a 0–100 percent check constraint. MySQL DDL can partially apply. An interrupted attempt must be reconciled manually, never replayed blindly.

## Outstanding integration and acceptance
1. Compare the integration branch with latest B4 and B6 development heads; cherry-pick/merge only after reviewing their unrelated source changes. The integration branch does not magically include all B6 or B4 commits.
2. Verify the exact test DB migration history and applied SQL names/checksums. In particular, historic B6 047 attempts must match the repaired SQL or remain BLOCKED.
3. Run syntax, source gates and full B4/B5/B6/finance unit/regression suites from a clean separate worktree.
4. Rehearse on an independently backed-up disposable `miljor_test_db`. Validate 033–052 schema compatibility, 25 approved families, historical row counts and catalog discovery.
5. HTTP E2E: create Regular, Flash and B6 Smart orders, then update supplier profile and confirm that order commission and payable amounts remain unchanged.
6. Negative/concurrent tests: NULL/invalid commission, two simultaneous orders, idempotent replay, refund holds, duplicate Safepay webhook, eligibility, out-of-stock, 0/100 percent commission.
7. Verify all other order creation paths, if any, and ensure published pool/quote accepted commercial terms govern the appropriate fee snapshot time. Profile rate at order creation is a staging assumption and must be compared against the accepted business contract.
8. No real money movement. Refund confirmation remains blocked until verified Safepay completion evidence.
9. Explicit release approval is needed before any production migration; this branch's runner currently blocks production deliberately.

## Scope and status
- Source-level placeholder check performed for all three order inserts: Regular 18/18, Flash 11/11, Smart Procurement 10/10.
- New deferred no-DB gate: `backend/tests/p0_integrated_migration_finance_source_gate.js`.
- Updated deferred collision gate: `backend/tests/migration_collision_preflight_gate.js`.
- **No executed Node/database tests, MySQL migrations or live provider calls in this GitHub-only implementation session.**
- CAN MERGE/DEPLOY: **NO**. CAN CONTINUE ISOLATED DEVELOPMENT: **YES**.
