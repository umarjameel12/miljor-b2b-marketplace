# MilJor — UCP-3/4/5 P0 Reconciliation and Functional Hardening

Implementation branch: `fix/ucp-3-5-integration-hardening-local`, based exclusively on `feature/ucp-3-5-integrated`.

## Scope boundary
This is **this chat's UCP integration hardening only**. Do not merge or cherry-pick parallel PR #5/#6, reimplement B6 RFQ/Collective/Recurring, change Regular B4 versus Flash B5 state machines, touch `miljor_db`, apply migrations, or mark production PASS. Existing PR #6 is a reference for collision detection, not authorization to modify that branch.

## Evidence and blockers found
- Separate parallel track PR #6 has already identified conflicting migration filenames/versions: branch-local UCP `046_expand_canonical_product_families`, `047_demand_requester_role`, `048_regular_pool_payment_hold_deadlines` vs parallel B6 `046_recurring_collective_cycles`, `047_procurement_delivery_runs`, `048_procurement_notification_outbox`. A unified schema migration order remains a release **BLOCKER**; never rename or mark migration entries without reconciling actual `schema_migrations` history and DB schema.
- UCP buyer Flash card mints new idempotency key every retry. An ambiguous network response can lead to duplicate flash holds or checkout attempts. Stable action keys and payment recovery are required.
- B4 buyer reservation and final decision also mint new action keys on retry, risking ambiguous outcomes. Reconcile ownership and single-active-reservation safely before retry.
- UCP supplier analytics computes read model based on verified PAID orders, not settlement revenue. UI must keep this distinction.
- UCP supplier inventory display is advisory and must never promise stock; B4/B5 publish serializes allocations.

## Implementation order (one isolated draft)
1. **I1 — Durable UI mutation intents**: stable idempotency across in-page retries for Regular reservation, Flash hold/checkout and B4 buyer decision/order conversion. Never regenerate a key on ambiguous response. Prevent new hold on network timeout until buyer retrieves historical holds; preserve pending order ID after refresh.
2. **I2 — Server authority and truthfulness**: Flash expiry uses server UTC, payment hold times use authoritative status; never infer successful payment from browser redirect, never self-release stock. Preserve separate clocks and B4/B5 transitions.
3. **I3 — Supplier exact stock/fulfillment checks**: validate that listing allocations are unit-compatible and stock availability is informational; no synthetic delivery fees or unsupported Flash G2 modes. Explicit draft partial-failure recovery.
4. **I4 — Deferred test contracts and cross-branch migration preflight**: write specific source regression gate and integration acceptance checklist, but do not run full financial/MySQL/E2E per owner, only safe syntax/source checking.
5. **I5 — Draft review and gate**: create draft PR against `feature/ucp-3-5-integrated`. No merge, deployment, protected DB mutation, or B6 migration execution.

## Acceptance at final release gate (NOT THIS BATCH)
- Disposable `miljor_test_db`; protected `miljor_db` fingerprint.
- Migration lineage 046–053 reconciled with active ledger.
- Verified supplier-owned physical SKUs and 8 categories/25 families.
- Simultaneous B4 and B5 stock publication and holds, no negative ledger or double sell.
- New orders/transactions only after explicit buyer consent and idempotency.
- B4 participation cutoff distinct from payment hold; Flash expiry distinct from buyer payment hold; provider pending safely reconciled.
- Repeated requests, network timeouts, reload and retries, paid callbacks exactly once; cross-supplier and cross-buyer negative auth.
- Browser/Vite/UI and backend API integration including correct financial and delivery amounts; no B6 cross-mode regression.
- Explicit PASS/FAIL/BLOCKED only based on executed evidence.

## Exit state of this source branch
Committed fixes + documented pending gates; source checks are not full test certification.
