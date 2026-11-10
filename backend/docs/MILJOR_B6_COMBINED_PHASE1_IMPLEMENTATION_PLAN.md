# MilJor B6 — Combined Phase 1 (G–M) Implementation Contract

**Scope:** A single coordinated engineering delivery for B6-G, H, I, J, K, L and M. Keep each internal gate measurable; do not substitute seven separate user approvals. **Never advance to N–Q automatically.**
**Source branch:** `feature/b6-private-rfq` (existing A–F implementation and latest independently reported A–E PASS).
**Acceptance requirement:** All of DB, service, HTTP authentication/authorization, UI, transaction/rollback/race, financial evidence and actual test execution before saying COMPLETE.
**Naming:** Existing MilJor camelCase services/pages, existing numbered SQL migrations and descriptive reports. No gratuitous renames or duplicate apps.
**DB isolation:** Only `miljor_test_db` for migrations and mutation tests; business `miljor_db` permanently read-only during QA. No remote connector action constitutes DB test evidence.

## 0. Immutable buyer journey — eight supported combinations

Buyer chooses independently:
- **Buying:** `SINGLE_BUYER` or `COLLECTIVE` (multiple verified independent B2B buyers).
- **Basket:** `ONE_PRODUCT` or `MULTI_PRODUCT` (up to validated safe limit, each line distinct).
- **Cadence:** `ONE_TIME`, `WEEKLY`, `MONTHLY`.

Combinations:
1. Single buyer + one product + one-time → G.
2. Single buyer + many products + one-time → G/H.
3. Single buyer + one product + recurring → L/M using G.
4. Single buyer + many products + recurring → L/M using G/H.
5. Collective + one product + one-time → I/J/K.
6. Collective + many products + one-time → I/J/K using H per approved basket.
7. Collective + one product + recurring → N, **explicitly in combined Phase 2**, not falsely included in G–M.
8. Collective + many products + recurring → N, **explicitly in combined Phase 2**.

An alternative `Request a Pool`/demand-first, Regular Pool and Flash Pool retain existing independent user journeys; use shared supplier SKU and inventory only where contracts are proven. Supplier delivers; MilJor coordinates, tracks and resolves disputes. No households, packaging/tissue/boxes as initial catalogue expansion.

## 1. Cross-system architecture and hard prerequisite

**Current repository audit:** B6 branch is based on B4 and includes B6-A–F; accepted B5 Flash lifecycle + Migration 036 are NOT yet in B6 tree. Existing B4 `orderService.createOrderFromBuyerCommitment` expects `reservations`, `pools`, qualification snapshot and accepted buyer decision. B6 **must not fake B4 reservations/pools** to force this API. Existing Safepay `safepayCheckoutService.initiateCheckout` requires valid real `orders` rows; no stand-in order rows or fake PAID.

**First shared-inventory reconciliation (mandatory before money/award):**
1. Inspect accepted B5 `supplier_inventory_allocations` and exact Flash hold/claim/paid/release statuses; inspect B4 `supplier_inventory_allocations`, listing `available_stock`, reserved/committed inventory semantics and stock decrement timing.
2. Pin B5 approved source and reconcile into isolated B6 worktree without overwriting A–F or rewriting B4/B5 branches. Apply B5 migration 036 before B6 migrations when genuine compatibility audit requires it; NO blind merge.
3. Create one authoritative supplier listing available-to-commit equation under **listing row FOR UPDATE**: `physical listed stock - all unreleased B4 allocations - live B5 holds/claims - pending/committed B6 awards`, using exact DECIMAL(12,4). Avoid double subtraction where a subsystem already physically decrements `available_stock`; explicitly define and test the accounting baseline.
4. Normalized physical pack/unit equality with immutable published supplier SKU + specification; require buyer's explicit selection for grade/variety/brand differences, no automatic substitution.
5. Consistent row-lock order across G/H and B4/B5 and unique (mode, foreign source, item) allocation reference. Two concurrent buyers cannot allocate same last units.

**Financial shared contract (mandatory before checkout):**
1. Persist real B6 source-of-order linkage to `orders` with explicit nullable B4 pool/reservation relationship if the existing schema permits; use targeted migration, NEVER fabricate pool IDs.
2. One `AWAITING_PAYMENT` order per supplier/buyer commitment; immutable exact subtotal, supplier delivery, processing fee, supplier fee, tax (if configured), final payable; no supplier-authored buyer fee.
3. Reuse `feeService` rules while computing amounts exactly (its current Number/parseFloat internals need safe authoritative replacement/adapter after approval of fee slabs). No client-provided total.
4. Reuse Safepay order checkout, verified webhook, provider reconciliation, immutable payment attempt and exactly-once ledger/outbox. No payment provider switch or storing credentials.
5. Inventory allocation state from `PENDING` to `COMMITTED/RELEASED/FULFILLED` follows confirmed payment/expiry/refund rules; no prepayment phantom PAID.
6. The precise refunds/partial settlement policy is mandatory for cancellation, supplier failure and collective shortfall; create durable obligations, not fake provider refunds. Reconcile paid orders rather than silently deleting them.

## 2. B6-G — Single buyer quote award + Safepay

**API:** buyer POST `/api/v1/procurement/requests/:id/award` with exact `quote_id`, `version_number`, explicit selected lines, idempotency key and delivery choice; then **separately** buyer initiates checkout on resulting real order using existing order endpoint.

**Transaction sequence:** buyer active/verified → lock request → check one-time single-buyer, open/current server time → lock selected quote/version → confirm ACTIVE, not expired, supplier still verified, physical SKU snapshot unchanged → enumerate every line exactly once, verify unit/pack/MOQ/service zone and buyer consent → lock listing IDs sorted ascending → check shared inventory → insert allocation(s), immutable award and real order(s), calculated fees, durable response snapshot & outbox → commit. External Safepay network call only AFTER commit, via existing service.

**State:** `PROPOSED → AWAITING_PAYMENT → PAYMENT_PENDING → PAID → FULFILLING → DELIVERED → COMPLETED`, with permitted EXPIRED/FAILED/CANCELLED/REFUND_PENDING branches; only provider evidence transitions to PAID. Retry same key returns original award without duplicate stock/fees/orders. Different payload conflicts. Reprice or stale quote requires fresh explicit buyer consent.

**Gate G:** 1 supplier 1 item and full basket, hold expiration and claim release, B4/B5/G last-unit concurrency, no phantom PAID/ledger duplication, webhook replay, failed provider initiation, timeout/refund evidence.

## 3. B6-H — Single buyer, many products, split supplier award

Buyer explicitly selects one eligible supplier quote/version per requested line; preserve all line identities and physical SKU snapshots. Validate complete coverage and that a line isn't awarded twice. Count shipping fee ONCE PER selected supplier (not per line). Each supplier receives its own real order, independent fulfillment/settlement. One buyer-facing parent award groups all orders; buyer must authorize the **full aggregate amount and number of supplier payments** before committing. If any listing/quote changed or can't allocate: **rollback the entire proposed split allocation**; return `REAPPROVAL_REQUIRED`, no partial phantom order. Checkout each real supplier order explicitly; aggregate summary is not fake single provider payment unless an authorized multi-order payment product exists.

**Gate H:** 4 items/2 suppliers, exact 2 delivery fees, no double line, mixed brand explicitly reviewed, one out-of-stock rolls back all, independent order/refund, buyer cross-tenant isolation.

## 4. B6-I — Collective formation & buyer-specific consent

Verified B2B organizer creates collective request; specify discoverability `PRIVATE_INVITE` or explicit controlled area listing, join cutoff, minimum compatible demand/participants, expiry, cancellation policy, geography, requested product families with optional individual line requirements. Invited buyers must accept **their own** distinct participation snapshots and only view own address/payment data. Organizer cannot commit or pay on anyone else's behalf. Buyer can withdraw before lock (policy-dependent), never erase paid history. Group countdown uses server UTC. Require at least 2 verified distinct buyers to be genuinely collective.

**Gate I:** parallel invites/joins, duplicate participant keys, organizer impersonation denied, invited but unaccepted buyer excluded, no address leaks, cutoff and withdrawal.

## 5. B6-J — Compatible collective demand + supplier bids

Group by exact accepted `supplier SKU/spec identity + purchasing unit + grade/pack or explicit exact request requirement` and delivery route compatibility. Never combine 100kg rice and 100kg sugar, or 25kg bags with 50kg bags as if equivalent. Seller can bid on specific product lines, all-basket or subset; declare tier thresholds, MOQ, delivery fee per buyer/cluster or pickup, delivery area, bid expiry and qualification/cutoff. Compute matched group demand from eligible participants only; immutable qualification snapshots capture input versions and supplier constraints.

**Gate J:** mixed physical specs not pooled, partial qualification consent, bid expiry/threshold, zero client-authoritative tiers, exact arithmetic.

## 6. B6-K — Collective group award, separate payment, fallout

Freeze each participant's quantities and explicitly confirmed line prices/fees; supplier selection locked under group state and snapshot. Each buyer sees own final payable and independently confirms/pays; separate order/payment/ledger/refund evidence per buyer. Group may qualify ALL_OR_NOTHING by default; partial threshold allowed ONLY with predeclared consent, minimum-tier price and no higher hidden buyer liability. If checkout cutoff leaves insufficient funded quantity, invalidate unqualified allocations safely and establish refunds/void obligations for paid buyers. No silent re-price on remaining buyers.

**Gate K:** 3 buyers, one declines, late payment, webhook race, partial funding, refund obligations, no shared PII, no organizer-captured charges, group commitment threshold.

## 7. B6-L — Single-buyer recurring contract setup

Schedule applies to one or many products. Weekly selected weekday / monthly day-of-month with explicit end-of-month handling, timezone `Asia/Karachi`, start/end date, delivery window, cutoff, unit/pack policy, approved supplier strategy, `PER_CYCLE_REQUOTE` default or explicit supplier fixed-price commitment. Buyer can SKIP next occurrence, PAUSE/RESUME and CANCEL future cycles. Schedule stores no raw payment credentials. Generated cycles are **proposals**, not charges; buyer must explicitly authorize payment if no separately approved standing payment mandate. Buyer price changes require fresh approval.

**Gate L:** DST/clock offset safety, Monday and month-end, date boundary, two concurrent pause and cycle claim calls, ownership, contract immutable history.

## 8. B6-M — Recurring execution worker

Persistent unique `(contract_id,cycle_key)`, exactly-once cycle creation/claim, due-time using server UTC, attempts/outbox and bounded retry backoff. Cycle progresses `SCHEDULED → PREPARING → QUOTING → AWAITING_BUYER_APPROVAL → (G/H award) → PAYMENT_PENDING → PAID` with SKIPPED/PAUSED/FAILED, all transitions durable; call shared G/H once explicitly authorized and verify supplier stock/quotes per-cycle. Crash recovery, idempotent retries, supplier unavailable and buyer skip must not duplicate Monday or monthly orders. Completed historical cycles immutable; cancellation affects only future cycles.

**Gate M:** crash-between-persist-and-job, concurrent scheduler workers, skip/pause/resume timing, no unauthorized charges, missing stock and expired quote, one cycle per key.

## 9. Implementation and QA sequence inside the SINGLE G–M batch

1. **Audit and isolate:** pin B4/B5/A–F heads, inspect active SQL baseline, B5 migration 036 and shared stock/payment; no DB mutation.
2. **Lock commercial and schema contracts:** transactional schema for awards/orders/items, stock reference, collective requests/participants/bids/qualifications, recurring contracts/cycles and immutable events. Forward SQL only; no production migrations.
3. **Implement G + H transactions** and buyer award/checkout UI; full last-unit and Safepay regression.
4. **Implement I + J + K** on top of award/payment services, with separate buyer liabilities.
5. **Implement L + M** using same one-time engines for cycle preparation, no background charge.
6. **One combined phase gate:** serial `miljor_test_db` migrations and tests for G–M + affected A–F/B0–B5, live authorized API, frontend build, collision/replay tests, protected DB zero-write audit. Update `MILJOR_PHASE_LOG.md` with actual SHA and measured outputs.
7. **STOP:** if any critical stock or payment invariant remains unverified, report `BLOCKED` and prohibit money-taking endpoints, even if read-only planning is complete.

## 10. Acceptance scenarios (minimum; enlarge from actual defects)

- Single/4-item buyer one supplier; 4-item buyer two suppliers, exact totals/shipping.
- Two simultaneous G/H buyers claim last listing unit; one must reject, no oversell.
- B4 pool + B5 Flash hold + B6 award competing against same exact supplier stock.
- Duplicate accept, browser refresh, network retry, delayed webhooks, provider outage, duplicate provider event.
- Amount tampering, supplier SKU/grade change, wrong pack unit, buyer MOQ, no confirmed delivery area; all fail closed.
- Owner/supplier/admin role positives and negatives; no buyer addresses across sellers or collective participants.
- Collective 3 buyers, one joins late, one leaves unpaid, paid group fail creates refund obligation; no billing rest.
- Weekly Monday, monthly 31st, pause/resume, skip, cutoff race, same-cycle duplicate worker, crash replay.
- Actual Safepay sandbox confirmation must be cryptographically verified, ledger/outbox exactly once.
- Final frontend build, `miljor_db` pristine, GitHub push only B6; never mark G–M PASS from static source checks.

## 11. Current execution checkpoint (source-only)

This file is the **approved detailed G–M implementation contract** for the current combined phase, not proof that its transaction engines run. In particular B6 branch still needs B5 source/migration and shared inventory reconciliation. Independent A–E acceptance reported PASS, F source implemented but QA unresolved. New code may implement safe independently testable policy helpers and gated schema, **not enable real buyer charges until transactional and gateway invariants are satisfied**.
