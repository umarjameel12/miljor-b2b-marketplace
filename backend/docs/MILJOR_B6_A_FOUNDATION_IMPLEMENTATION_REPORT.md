# MILJOR B6-A — Smart Procurement Hub Contract Audit / Foundation Checkpoint

**Date:** 2026-11-10
**Branch:** `feature/b6-private-rfq`
**Starting accepted B4:** `5689c377ffe80b1c94c37ddaa84d57bf569e9ea0`
**Plan:** `backend/docs/MILJOR_B6_PRIVATE_RFQ_IMPLEMENTATION_PLAN.md` (B6-A through B6-Q)
**Status:** SOURCE IMPLEMENTED (PURE POLICY ONLY) — FULL B6-A GATE BLOCKED PENDING TEST DATABASE SCHEMA AUDIT AND LIVE B5 INTEGRATION CONTRACT.
**Next subphase B6-B:** NOT STARTED.

## B6-A verified-by-reading source findings
1. `backend/src/services/procurementService.js`: legacy RFQ is free-text/single-product; direct quote acceptance creates an order with JavaScript Number multiplication, without supplier-owned physical SKU/listing and inventory allocation proof. Legacy recurring directly creates ACTIVE contracts without approved per-cycle buyer consent and scheduling/checkout lifecycle.
2. `backend/src/routes/v1/procurementRoutes.js`: legacy role guards include ADMIN for supplier/buyer mutations. B6 endpoints require fail-closed own-role access and object-level authorization.
3. `backend/src/controllers/procurementController.js`: existing B6-facing methods call legacy service; new B6 functionality must be routed through hardened domain services after reviewed schema changes, not silently claim current handlers are safe.
4. `backend/src/services/exactDecimal.js`: authoritative exact BigInt-backed decimal helpers are reusable; no float pricing in new B6.
5. `backend/docs/MILJOR_BUSINESS_INVARIANTS.md`: supplier physical SKUs/packaging immutable; B4 quantity/increment/stock, buyer privacy, committed inventory, Safepay order-before-payment, provider-verified PAID and idempotency are non-negotiable.
6. B5 branch is separately under test; do not infer readiness or merge, and require accepted B5 inventory/shared payment contract before B6 final release.
7. B6 branch already holds reusable frontend countdown code for Regular Pool; no runtime build for B6 source verified here.

## Actual source implemented in original tracked app paths
- `backend/src/services/procurementRequestPolicy.js`: PURE normalization of B2B ownership, SINGLE/COLLECTIVE, ONE_TIME/WEEKLY/MONTHLY, one/multi item, full/split award, priority, family IDs, valid purchasing units, exact positive DECIMAL(12,4) quantity, indivisible bags/tins/cartons, validated explicit-offset UTC deadlines, join/quote ordering, and buyer consent flags. Does NOT trust user input as verified physical SKU facts.
- `backend/tests/b6_procurement_request_policy_gate.js`: 15 planned positive/negative assertions covering multi-product, collective weekly intent, invalid family/units/quantities, deadline and mode restrictions. This test is source committed but NOT EXECUTED by GitHub-only interface; assertion results cannot be claimed PASS.
- Original implementation plan expanded to B6-A through B6-Q, all with acceptance gates, safe finance/inventory flows and buyer-facing UI.

## Required remaining B6-A gate before B6-B implementation
- Local working-tree and Git SHA parity check; preserve user's uncommitted changes.
- Inspect current physical MySQL schema for existing RFQ, RFQ_quotes, recurring_contracts, orders, inventory allocations, supplier SKU/offer tables; choose additive migration with actual column/FK/enum compatibility.
- Confirm owner role + permissions, item/discrete increment rules and multi-buyer invitation/privacy/withdrawal policy.
- Confirm shared listing-lock ordering with accepted B4 and pending B5; serialize mutable tests on `miljor_test_db`.
- Execute from backend: `node tests/b6_procurement_request_policy_gate.js` and record actual output, exit code; reject failures and repair before accepting gate.
- Run focused relevant DB/API and security negatives for any B6-A source that becomes wired to routes; do not write to `miljor_db`.
- Record exact merged-compatible contract and protected DB unchanged evidence.
- B6-B is NOT to be advanced without an explicit source-and-verification gate record.

## Safety and release
No live DB connections, schema migrations, money movements, HTTP API tests or frontend build executed by the GitHub connector in this checkpoint. No B4/B5/main mutations. A no-database policy helper being present does not make the buyer-facing feature functional.
**B6-A VERDICT: PARTIAL / BLOCKED FOR ACCEPTANCE.**
**CAN START NEXT PHASE: NO**.
