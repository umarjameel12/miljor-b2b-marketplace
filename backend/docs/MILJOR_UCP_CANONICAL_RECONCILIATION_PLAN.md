# MILJOR — Canonical UCP/B6 Reconciliation, Migration Integrity & Acceptance Plan

**Execution:** This document is the frozen implementation plan for branch `feature/ucp-canonical-reconciliation-release`.  
**Base:** `fix/ucp3-5-audit-repair` (PR #6), itself based on PR #5.  
**Additional reviewed source:** `fix/ucp-3-5-integration-hardening-local` (PR #8), based on the independent UCP-3/4/5 implementation.  
**Isolation:** B4 supplier Regular and B5 supplier Flash remain separate state machines under one user-facing Pool Management experience. B6 buyer RFQ, Collective and Recurring remain separate and private. **No merge of PR #5/#6/#8 directly, no default-branch writes, no protected DB writes.**

## Canonical-source decision and file ownership
- **Canonical delivery, buyer pool discovery and core API:** PR #6, because it includes verified buyer address / Lahore supplier rate validations, paginated combined discovery, accurate source-of-truth operations, Flash best-before validation, duplicate-checked migration runner, and actual buyer hold reconciliation.
- **Canonical B4/B5 business services:** PR #6 existing authoritative `poolController`, `flashPoolService`, `safepayCheckoutService`; do not copy rewritten versions from PR #8.
- **Canonical UCP UI:** PR #6 `SupplierPoolsPage`, `BuyerPoolCard`, `FlashBuyerOrdersPanel`, `BuyerRegularReservationsPanel`; preserve its verified-address, cursor, clock, and payment-status work.
- **Selective port from PR #8:** stable mutation intents on Regular supplier draft/publish and buyer B4 cancellation; explicit B4 final offer / ACCEPT/DECLINE / order-readiness UX **only after matching backend routes, idempotency rules and response schemas**. Do not replace the PR #6 Flash card or reintroduce free-text Flash addresses. Reuse existing stable Flash hold/checkout keys.
- **Migration history:** B6 Phase2 canonical schema files `046_recurring_collective_cycles.sql`, `047_procurement_delivery_runs.sql`, `048_procurement_notification_outbox.sql` from exact pinned B6 branch snapshot; preserve UCP `051_expand_canonical_product_families.sql`, `052_demand_requester_role.sql`, `053_regular_pool_payment_hold_deadlines.sql` from PR #6, rather than duplicate version numbers. B6 application-service integration is a distinct scope; migration inclusion never implies B6 features are runtime-certified.

## R1 — Atomic migration release preflight
1. Read-only manifest check before any DB connection/DDL: filename numeric unique, strict canonical format, complete ordered migrations, known version/name mapping, pin source SHA256 and detect renamed history risk.
2. Fix incorrect escaped-digit migration-number validation in `runMigrations.js`; compare DB `schema_migrations` rows and `schema_migration_attempts` against manifest **before executing any migration SQL**. Existing 046–048 UCP-applied history must block, not auto-rename.
3. Do not infer or manufacture DB migration-ledger entries or force-delete records. If 049/050 reserved, confirm the reason; do not reassign B6 046–048 or UCP 051–053.
4. Provide a no-DB `migration:preflight` and test-only acceptance preflight separate from apply. Any mutation-run command must expressly target `miljor_test_db`; production/sandbox remain untouched.
5. Apply to disposable DB only when available, backed up / fingerprinted; never use `miljor_db` or `miljor_sandbox_db` for tests.

## R2 — Curated source reconciliation
1. Verify PR #6 already holds stable B5 stock hold and checkout keys, B4 regular checkout retry key and supplier delivery eligibility. Avoid duplicate implementations.
2. Port only missing supplier draft/publish retry keys and buyer reservation cancellation idempotency. Preserve same request key while outcome uncertain; prevent changed-payload retry.
3. Add explicit Regular buyer final commercial decision UX only if backend final-offer/decision/order-readiness API contract and required fields match. Never auto-create an order/payment; operator consent required.
4. Every order/hold timer uses server UTC; never equate frontend zero countdown with settlement, stock release or successful payment.
5. Verify saved verified Lahore buyer address remains mandatory for unified Flash checkout (not a free-text address); preserve existing legacy B5 compatibility at server boundary.
6. No public buyer contact details, no fake savings/paid revenue, and no B6 private data in UCP feeds.

## R3 — Test integration and acceptance (executed evidence only)
1. Static/syntax checks of changed backend JS and migration manifest in the current runtime.
2. Backend source gates for B4/B5/B6 and UCP; full `npm run test:release` only if dependencies + isolated DB are actually present. Never label prepared tests as PASS.
3. `miljor_test_db` migration fresh-install and upgrade-path, 046–048 B6 then 051–053 UCP, repeatability, duplicate version detection, pending/failed migration journal, renumbered-history refusal, payment-hold FK and canonical families.
4. Concurrent B4 Regular and B5 Flash publish against one listing: exact decimal ledger, no double stock reservation; buyer cross-tenant auth negative tests.
5. Buyer flows: Regular reserve→supplier qualification→buyer accept/decline→order→15m payment hold→Safepay verified paid; Flash publish→verified Lahore address→WHOLE_LOT/MULTI_BUYER→15m hold→Safepay pending/verified callbacks; retry duplicates, timeout, expired clock and no premature release.
6. Frontend production build; mobile/Desktop keyboard, timer, back/refresh, browser network timeout, category/family and delivery filter E2E.
7. B6 RFQ, recurring and collective read/write regression; preserved protected DB fingerprints and no merged workflows.
8. Report PASS/FAIL/BLOCKED by gate; no merge/deploy until all applicable gates PASS.

## Known integration boundaries
- A GitHub connector does not provide a running MySQL server, real Safepay sandbox or browser execution. Attempt actual CI/runtime only when an authorized, isolated execution environment is available; otherwise record **BLOCKED**, not fake PASS.
- Existing outbox-derived *in-app* alerts are not real SMS/email/push delivery.
- Existing `miljor_db` may already have a different 046–048 ledger; never mutate it to match this branch.
- All source modifications stay on the new reconciliation branch and PR remains draft.

**Exit:** one explicit canonical branch, reproducible migration manifest and safe guard, reconciled UI mutations, genuine test evidence (or specific blockers), and a draft PR pending approval.
