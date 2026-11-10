# MilJor — B6 Private RFQ, Personalized Quotes & Supplier Comparison
## Approved-context implementation workflow and parallel boundary — 2026-11-10

**Branch:** `feature/b6-private-rfq`
**Starting source:** accepted B4 commit `5689c377ffe80b1c94c37ddaa84d57bf569e9ea0`.
**Current verdict:** PLAN ONLY; B6 implementation and tests NOT STARTED.
**Concurrent branch:** `feature/b5-flash-pools`; Clarity owns B5 acceptance and repairs while ChatGPT can implement B6 separately.
**Do not release B6** until B4 contract checks pass and shared E2/E3/financial interfaces are reconciled. B6 must not depend on cherry-picking unaccepted B5 changes.

## Scope and product policy
Buyer-specific B2B requests for quotations (RFQs) for published supplier-owned physical goods, including supplier-defined brand, grade, pack size and packaging. Supplier responses are independent commercial quotations, not pooled orders. A buyer may compare multiple quotations and explicitly accept one version of one eligible quote. Use existing canonical categories/families for discovery, but do not invent shared, MilJor-owned physical variants. No supplier/admin may impersonate buyer. Starting catalog food-only Lahore, while supplier product/specifications remain supplier-owned.
RFQ can specify exact physical requirements, quantity, unit, delivery location/window, required condition, deadline and special notes. Quote includes supplier-owned eligible SKU/listing, unit price, available stock, whole-pack increments, lead time, delivery fee, taxes/fees where applicable, terms, expiry and total landed cost. Historical versions remain immutable.

## Existing source audit (B4-derived baseline)
- `backend/src/services/procurementService.js` contains `createRfq`, `submitRfqQuote` and `acceptRfqQuote`, but they are simplistic legacy paths: free-form product_name, numeric arithmetic for order total, no authoritative published physical SKU/stock proof, no real quote version-control at acceptance, and automatic order insertion. Treat these as unverified source, NOT completed B6.
- `backend/src/routes/v1/procurementRoutes.js` allows ADMIN alongside BUYER/SUPPLIER for creating/submitting/accepting. Must replace with strict own-role authorization; ADMIN oversight is separate.
- Do not claim end-to-end B6 ready because `RfqPage.jsx` exists.
- Inspect actual `rfqs`, `rfq_quotes`, `orders`, stock allocation and payment schema before proposing additive migrations; preserve historical rows and IDs.

## B6 subphases
**B6-A — Source, schema, commercial/permission contracts:** Audit RFQ routes, tables, supplier SKUs and listings, identity, quotas, exactDecimal, inventory ledger, order pricing and Safepay. Define workflow state machine, RFQ privacy, quote validity, units and delivery terms. Create schema migration only if justified, using forward-only additive changes.

**B6-B — Buyer RFQ lifecycle:** Verified B2B BUYER creates DRAFT request, edits only own draft, publishes to OPEN with expiry; optionally targets invited suppliers or eligible matching listings. Validate allowed categories, quantity/unit/whole-pack increments, delivery address, deadline, special requirements; no fake supplier product ownership. Buyer can withdraw/cancel before accepting. Private messages/notifications not exposed publicly.

**B6-C — Supplier discovery and permissioning:** Eligible verified supplier can view invited/matching OPEN RFQs without buyer direct contact details. Supplier must prove ACTIVE own listing and PUBLISHED/APPROVED owned SKU/spec. Prevent cross-supplier quotation forgery or direct contact bypass.

**B6-D — Quote issue, revisions, comparison:** Supplier submits exact-Decimal quote with server-derived SKU snapshot, price, delivery fee, promised delivery, stock and expiry. Version each revision; preserve old immutable versions with SUPERSEDED status. Buyer compares total landed cost (quantity × unit price + supplier delivery fee + buyer platform fee and explicitly modeled taxes), lead time, seller verification, grade and pack unit. Never compare incompatible physical specifications as identical; disclose differences. Prevent fictitious discounts or fees. Supplier can withdraw own live quote while no acceptance exists.

**B6-E — Atomic buyer acceptance:** Buyer selects one quote/version explicitly while RFQ OPEN/QUOTED, quote unexpired and stock available. Within serializable row locking, check buyer ownership, supplier eligibility, source listing/SKU still valid, exact terms and stock allocation across B4 Regular Pools, B5 Flash offers and B6 quote commitments. Create one authoritative AWAITING_PAYMENT order and immutable accepted-quote snapshot; reject all competing quotes after successful commit. Idempotency key and concurrent double-acceptance must yield exactly one order. If allocation or payment adapter unavailable, fail closed rather than claim success.

**B6-F — Safepay, cancellations, expiry, reconciliation:** Reuse verified Safepay-only order checkout; provider signature/amount/currency/order reference verification and exactly-once financial posting. Acceptance holds time out safely with provider-confirmed payment state. Failed/abandoned orders release only their unconsumed allocation; already paid orders never silently cancel. Refunds only via authorized verified provider flow. No client-side PAID promotion.

**B6-G — UI, privacy and comparisons:** Buyer create/edit/publish RFQ, invitation/matching, supplier quote cards, compare table and acceptance confirmation; supplier RFQ inbox and quote revisions; clear live deadlines, seller SKU specifications, fee breakdown, order status, cancellation warnings. Responsive/mobile UI consistent with MilJor. No new image-storage dependency or direct buyer-supplier phone/email exposure.

**B6-H — Acceptance, regressions and report:** Add `backend/tests/b6_private_rfq_lifecycle_gate.js` with ownership/cross-role controls, quote versioning, exact arithmetic, out-of-stock, concurrent acceptance, deadline, idempotency, Safepay webhooks/refunds, ledger reconciliation, B4/B5 shared-stock interactions, full frontend build. Run against `miljor_test_db` exclusively. Compare protected `miljor_db` read-only baseline/post for zero changes. Rerun required accepted B4 and B0–B3 security gates. Evidence file `backend/docs/MILJOR_B6_IMPLEMENTATION_REPORT.md` after implementation with actual counts, timestamps, exact SHA and PASS/FAIL/BLOCKED.

## State contract (proposed; must reconcile existing SQL)
RFQ: DRAFT -> OPEN -> QUOTED -> ACCEPTED / EXPIRED / CANCELLED.
Quote: SUBMITTED -> SUPERSEDED / WITHDRAWN / REJECTED / ACCEPTED / EXPIRED.
Order: AWAITING_PAYMENT -> PAID only through verified Safepay -> fulfillment; unpaid expired/failed orders recovered safely.
Quote snapshot immutable after acceptance. No forced supplier bid; invited suppliers can decline or ignore.

## Strict B5/B6 parallel safety
1. B5 Clarity uses its own `feature/b5-flash-pools` isolated worktree. B6 uses separate `feature/b6-private-rfq` starting from accepted B4. Neither team edits the other branch.
2. Freeze shared contracts: `supplier_inventory_allocations`, `supplier_listings`, `product_specifications`, `orders`, `safepayCheckoutService`, `exactDecimal`, authentication and fee service. Reconcile via documented interfaces, not blind merges. Shared changes require deliberate review and targeted contract tests.
3. Never run two mutable suites simultaneously on `miljor_test_db`. Schedule B5 then B6 integration windows or configure isolated independently verified databases.
4. Changes only by normal fast-forward pushes to matching feature branches after re-fetching remote head. No force-push, merge to main, delete or reset.
5. B6 planning/implementation may proceed parallel to B5 QA; full B6 release stays BLOCKED until shared inventory/finance integration is verified.
6. No writes to production or `miljor_db`. Every subphase records SOURCE IMPLEMENTED / TESTED / BLOCKED and exact evidence. Never auto-start B7.

## Acceptance evidence required
- Approved contracts and updated route/API inventory.
- DDL/migration audit and test DB backup/reversible data handling proof.
- Supplier verification + buyer authorization + no cross-tenant leakage.
- 100% passing focused test cases, B4 regression, Safepay integrity and frontend build with explicit assertion counts (no fabricated counts).
- Local/remote commit parity, protected-DB unchanged evidence.
- B6 status: PLAN ONLY until implementation and execution is demonstrated.
