# MilJor B5 — Clarity independent acceptance and repair handoff
Date: 2026-11-10
Branch under test: `feature/b5-flash-pools`
Accepted immutable B4 baseline: `5689c377ffe80b1c94c37ddaa84d57bf569e9ea0`

## Status — NOT AN ACCEPTANCE CLAIM
Existing B5 source is present; B5 integration is NOT verified. This document is a runnable TEST PLAN and repair contract for Clarity, not a passed test report. Do not infer a PASS from source presence. A previous planning document still says NOT STARTED and must be reconciled with current code.

## Before executing anything
1. Record local and origin B5 head SHA, worktree status and B4 head. Preserve uncommitted/unpushed work; no resets, merges or force pushes.
2. Review `backend/database/migrations/036_b5_flash_offer_lifecycle.sql` against actual test schema, baseline tables and FK/enum contracts. Take a test DB backup. Never apply to `miljor_db` or production.
3. Set NODE_ENV=test, TEST_DB_NAME=miljor_test_db. Query SELECT DATABASE() and assert exact identity before every mutating test. Serialize B4 and B5 DB tests.
4. Record protected-DB baseline counts if protected DB read-only access is explicitly permitted; do not write or test against it.
5. Run Node syntax checks and `npm --prefix frontend run build` against the precise tested source commit.

## Mandatory executable gate
Implement/run `backend/tests/b5_flash_pool_lifecycle_gate.js` using native Node assert + HTTP calls and transaction-isolated deterministic fixtures. Failure means B5 BLOCKED; fix in B5 worktree, retest. All fixture cleanup must be exception-safe and scoped to test-owned IDs. No gateway real charge. No synthetic paid status outside verified signed Safepay test webhook.

### A — Identity, draft and ownership
A01 Only active VERIFIED supplier/profile can create.
A02 Buyer/admin/non-owner cannot create, modify, publish, cancel another supplier offer.
A03 Listing ACTIVE and owned, SKU/PUBLISHED, supplier product/PUBLISHED, spec APPROVED + active, family/category approved + active.
A04 Reject mismatched listing/SKU/spec, foreign IDs, nonexistent objects.
A05 DRAFT not public, no inventory allocated until publish.
A06 Verify supplied SKU title, units, pack size and snapshots derive from seller's real published SKU, not user-provided arbitrary product_id.
A07 Expiry-related clearance requires real future best-before date; reject expired stock, bad date and false discount comparisons.
A08 Price and quantity decimals exact; reject nonfinite, negative, overflow, too-many decimals, indivisible pack fractions.

### B — Duration and modes
B01 Supplier-configured duration persists; no fixed mandatory 12h; publication begins countdown at actual server time.
B02 Duration cannot be zero, negative, excessively large or ambiguous timezone input; expiry must not run beyond best-before date.
B03 MULTI_BUYER blank min -> one valid increment; configured min/max enforced, and cumulative buyer max enforced across holds/orders.
B04 WHOLE_LOT demands exact entire stock; reject partial quantity and simultaneous second buyer.
B05 Draft changes allowed before publish; published physical terms, price, stock and mode immutable.
B06 Countdown remains accurate on refresh and uses server time; regular-pool timer remains functional.

### C — Shared inventory / concurrency
C01 B4 regular pool and B5 flash publish on same listing concurrently: only available inventory allocated; neither oversells.
C02 Duplicate publish request cannot double allocate.
C03 Flash holds concurrently obey stock cap; no lost-update, oversell or duplicate order.
C04 Enforce actual SKU purchasing unit and purchase increment, including kg/L vs bag/tin/bundle and non-unit increments. IMPORTANT: source review found `requestHold` checks whole-pack integer status but does not visibly check divisibility by `offer.purchase_increment`; investigate and repair.
C05 Allocation conservation across publish, hold, PAID, expiry, refund/cancel: ledger and flash remaining/held/committed balance reconcile.
C06 A canceled or expired flash cannot unlock stock committed to PAID orders; no B4 allocations may be modified accidentally.
C07 Lock ordering must avoid deadlocks across B4/B5 and payment callback paths.

### D — Checkout, Safepay, refunds
D01 HOLD creates authoritative AWAITING_PAYMENT order BEFORE checkout; idempotency repeated returns same order, conflicting payload fails.
D02 Buyer-only hold retrieval, no other buyer order/PII exposure.
D03 Start checkout only with live owned HELD lease and authoritative order amount; unauthorized/no-lease attempts fail.
D04 Only cryptographically verified Safepay webhook marks PAID; client callback/query parameters cannot.
D05 Webhook replay/out-of-order events do not duplicate PAID, payment ledger, inventory commitment or outbox events.
D06 Gateway init failure after `claimCheckout` must not strand PAYMENT_PENDING forever: reconcile provider truth before any release. IMPORTANT: explicit failure/timeout path needs proof.
D07 Abandoned checkout recovery needs provider status evidence, retry, monitor and safe timeout logic. Do not auto-release possibly paid pending holds.
D08 PAID webhook with failed flash stock reconciliation must produce observable recoverable reconciliation task; no silent financial drift.
D09 Reject amount, currency, provider, tracker, buyer/order mismatch; never pretend refunds completed without verified provider records.
D10 Cancellation and refund only after correct financial authority; paid orders not canceled just because flash timer ends.

### E — Discovery, UI, errors
E01 Public GET only active, eligible, stocked, nonexpired, verified supplier offers; no drafts or stale/unsafe SKUs.
E02 Accurate supplier, original listing comparison price, discount, unit, condition, best-before, delivery fees, total and expiry are visible.
E03 Supplier create/update/preview/publish/cancel and buyer Multi/Whole checkout work in browser; API errors surfaced accurately.
E04 Disable sold-out and expired CTA; do not claim PAID before server verification.
E05 Frontend build and B4's accepted 11 suites pass unchanged; B0 financial security gates pass.

## Clarity execution output required
Provide actual pass/fail results per ID, tests added, migration DB name and backup ID, code SHA(s), frontend build log, B4 266/266 regression evidence, Safepay security evidence, protected database pre/post zero-write evidence, unresolved issues, and final PASS/FAIL/BLOCKED. Do not call 266/266 PASS for the B5-integrated tree unless rerun.

## Special rule
Clarity can test and repair B5 in its own isolated worktree and push ONLY normal fast-forward to `feature/b5-flash-pools` after source status reconciliation. Do not touch `feature/b4-regular-pools`, `feature/package-e`, main, or B6 branch. Never auto-start B6.
