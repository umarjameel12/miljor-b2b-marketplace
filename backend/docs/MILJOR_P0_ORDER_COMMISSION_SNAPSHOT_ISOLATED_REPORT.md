# MilJor — P0 Order-Locked Supplier Commission Implementation (Isolated)

Date: 2026-11-11
Branch: `fix/p0-order-commission-snapshot-isolated`
Mode: **SOURCE IMPLEMENTATION STAGED / NOT MIGRATED / NOT EXECUTED / NOT VERIFIED**

## Changes staged without disturbing concurrent branches
1. `src/services/feeService.js`: optional supplier-profile `SELECT ... FOR UPDATE` for an order-creation transaction.
2. `src/services/orderService.js`: obtains the exact supplier fee percentage under the same order transaction and writes `supplier_commission_percent` alongside the immutable order amount; includes snapshot in the order business event.
3. `src/services/financialSettlementService.js`: selects `orders.supplier_commission_percent AS locked_supplier_commission_percent`; uses that locked value for payable accrual rather than `supplier_profiles.transaction_fee_percent`.
4. `docs/proposals/ORDER_SUPPLIER_COMMISSION_SNAPSHOT_MIGRATION_PROPOSAL.sql`: unnumbered non-executable schema proposal outside migration discovery.
5. `tests/p0_order_commission_snapshot_source_gate.js`: no-DB static contract checks. **Not executed yet**.

## Blocking state
- Existing `orders` schema lacks `supplier_commission_percent`. The modified order and settlement code **MUST NOT BE DEPLOYED OR RUN** until the database schema is updated through a verified migration sequence.
- Current independent branch's 046/047 SQL conflicts with B6 Phase 2's different 046/047 migrations; B6 has 048 too. Preserve the collision guard; NEVER blindly rename, merge, delete, edit history or auto-run migration.
- Proposed 049/050 migration names from Antigravity's preliminary report are NOT approved until read-only database history and branch heads prove no collision. The new snapshot migration number must be allocated after reconciliation.
- No historical automatic backfill of supplier percentages from today's `supplier_profiles`: historical rate is unknown until proven.
- B6 `procurementAwardService.js` on feature branch independently inserts direct procurement orders and stores `supplier_transaction_fee` on `procurement_award_orders`, NOT a supplier percentage on orders. Its snapshot integration requires **separate B6 owner review**. This branch does not modify that service.
- Flash Pool and any other direct order creators also need an inventory and integration gate before full deployment.
- Database-level immutability/write authorization for snapshot edits still needs formal migration review.
- The financial contract needs explicit guidance on whether supplier commission is taken from the profile rate when an order is accepted or instead from earlier published immutable pool/quote terms; current staged code freezes the verified profile rate at order insertion. Verify that timing with approved commercial policy.

## Reconciliation/acceptance sequence
1. Ask Antigravity to produce a read-only schema_migrations + schema_migration_attempts 033-048 state and check current branch heads. Protect `miljor_db`.
2. Agree append-only new unique numbering for B6 and catalog changes, without editing an already applied historical migration.
3. Generate reviewed new migration from the staged proposal, with isolated DB backup and safe DDL safeguards.
4. Run disposable `miljor_test_db` migration and verify NULL preservation on old orders.
5. Run source contract gate, actual order HTTP flow, locked 2% profile -> profile changes to 3% -> settlement still 2%, 0%/100% boundary, missing fee rejection, idempotent replay, concurrency.
6. Reconcile independent procurement and Flash order creation paths with other-chat owners; no direct modifications here.
7. Do not mark final P0 PASS until full end-to-end audit.

## Important result
Protected DB and other branches were not modified by this preparation. **CAN START NEXT PHASE: NO** while migration and cross-mode snapshot integration remain blocked.
