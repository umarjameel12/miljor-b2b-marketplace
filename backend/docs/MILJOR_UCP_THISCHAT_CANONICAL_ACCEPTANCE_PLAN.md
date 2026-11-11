# MilJor — PR #5/#6/#8 Canonical Reconciliation + Final Acceptance Execution

## Scope and immutable business invariants

This is an isolated implementation branch based on `feature/ucp-canonical-reconciliation-release`, which already selected the PR #6 data/UX baseline and contains B6 046–048 plus UCP 051–053 files. Do **not** merge the alternative UCP engine or PR #8 wholesale.

- B4: supplier Regular Pool with volume tiers, distinct expiry and buyer committed-order 15-minute payment hold.
- B5: supplier Flash Pool with ready stock, seller listing-price-verified discount, fixed delivery fee, verified buyer Lahore address, distinct 15-minute buyer hold and Safepay.
- B6: buyer RFQ/Collective/Recurring separate. Zero automatic cross-mode conversion.
- All inventory allocated through existing `supplier_inventory_allocations`; all payment success through trusted provider verification, never a client timer.
- No writes to `miljor_db`, `miljor_sandbox_db`, default branch, PR #5/#6/#8 or other active work branches.

## File-by-file canonical selection (actual blob comparison)

1. **PR #6 wins**: `backend/src/services/unifiedPoolDiscoveryService.js`, `backend/src/routes/v1/unifiedPoolRoutes.js`, `backend/src/services/poolOperationsService.js`, `frontend/src/components/pools/BuyerPoolCard.jsx`, `frontend/src/components/pools/FlashBuyerOrdersPanel.jsx`, `frontend/src/pages/PoolsPage.jsx`, `frontend/src/components/supplier/SupplierPoolOperationsPanel.jsx`. Reasons: cursor/filter-bound discovery, verified Lahore buyer address, backend delivery eligibility, B4/B5 native financial state machines, provider-aware checkout.
2. **PR #6 wins with selective PR #8 integration**: supplier `SupplierPoolsPage.jsx` and `frontend/src/api/unifiedPools.js` (stable mutation-intent keys and safe partial-draft recovery); `BuyerRegularReservationsPanel.jsx` (explicit B4 supplier final-offer/decision/readiness/order-creation only after contract validation). PR #8's free-text Flash buyer card, duplicate inventory analytics/read models, separate OrdersPage/Flash hold implementation are rejected because they regress verified address or duplicate canonical services.
3. **B4/B5 engines untouched**: `poolController.js`, `flashPoolService.js`, `safepayCheckoutService.js`, `orderService.js`. Except narrowly justified security corrections, no generic unified payment engine.
4. **Migration lineage**: B6 authoritative 046/047/048; UCP 051/052/053. No old UCP 046–048 reintroduced. Manifest must reject duplicates and any legacy applied ledger names.
5. **Extra collision discovered**: `integration/p0-b6-finance-migrations-046-052` uses 049 regular payment hold, 050 family expansion, 051 requester role, 052 supplier commission. These SQL bodies substantially overlap UCP 053/051/052 but filenames/checksums differ. Do **not** run both sets. Finance/commission migration and PR release remain BLOCKED until canonical lineage + journal reconciled on fresh and upgrade `miljor_test_db`.

## Execution order

### R1 — Repository reconciliation
- Compare GitHub tree blob SHA for PR #5, PR #6, PR #8 and canonical release. Record exact source selection and incompatibilities.
- Record cross-branch migration file names/hashes. Never rewrite `schema_migrations` by guess or erase the original records.

### R2 — Selective source integration
- Keep PR #6 verified-address Flash buyer flow and existing stable Flash hold/retry keys.
- Harden supplier draft creation against ambiguous timeouts; reuse initial X-Idempotency-Key for B4 draft/publish, reject payload changes under unresolved request.
- Reuse original B4 buyer commercial offer/decision and readiness/order endpoints with explicit buyer consent and controlled DECLINE reasons; no order/payment created on view.
- Preserve paginated buyer discovery, accurate PAID order counters, no B6 leakage.

### R3 — Migration preflight
- Add DB-free integration collision check that compares the manifest's 046–053 file map with expected B6/UCP mapping and explicitly rejects a finance plan with conflicting names/hashes.
- Add read-only `schema_migrations` and `schema_migration_attempts` verification command for an **explicitly selected** `miljor_test_db`, no DDL or migrations.
- Never apply to protected environments; migration runner remains fail-closed.

### R4 — Acceptance
- Actual source/schema checks where runtime allows.
- If isolated MySQL, secrets and Vite installation are available, run complete B4/B5/B6, concurrent inventory, Safepay sandbox and buyer/supplier browser E2E. Otherwise record exact BLOCKED cause; no fake PASS.
- No automatic merge/deployment. Draft PR only, with final PASS/FAIL/BLOCKED matrix and evidence.

## Gates

- **SOURCE**: syntax, data contract, server ownership, idempotency and migration manifest PASS/FAIL.
- **MIGRATION**: fresh + upgrade `miljor_test_db`, no duplicate 046–053, ledger hash integrity, and finance conflict resolved.
- **FINANCE**: provider-signed callbacks, idempotent escrow/refund, pending checkout expiry and no double stock.
- **E2E**: Regular reserve→supplier qualify→buyer accept→order→hold→Safepay→delivery; Flash publish→verified address→hold→checkout→provider confirmation; B6 flows independent.
- **SECURITY**: tenant/role negatives, PII, authenticated account, invalid address/category, rate, expired SKU.
- **RELEASE**: all relevant prior gates PASS before merge.

**Any gate not actually executed is BLOCKED, not PASS.**
