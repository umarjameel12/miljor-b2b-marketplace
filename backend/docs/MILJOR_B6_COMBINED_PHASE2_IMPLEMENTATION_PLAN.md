# MILJOR — B6 Combined Phase 2 (N–Q) Fixed Implementation Contract

**Baseline:** `0504d65c7567486483594be23c39d16ebe0cb60e`, forked as `feature/b6-phase2-nq`.
**Parallel work:** B6-G–M audit/auto-repair continues separately on `feature/b6-private-rfq`. Never overwrite those changes. Later cherry-pick/reconcile only after comparing the actual changed files and latest accepted QA report.
**Delivery:** ONE combined implementation phase with N, O, conditional P and Q. No feature creep, no independent duplicate supplier catalog, no stand-in payment or checkout.
**Status rule:** Implemented source, executed pure test, integrated tested, accepted/blocked are separate states.
**DB:** forward-only reviewed migrations 046+; mutation testing only on a backed-up `miljor_test_db`, never on `miljor_db`.

## Core mode and commercial invariant

Eight combinations retained: single/collective buyer × one/many products × one-time/weekly-monthly. N completes collective recurring. B4 Regular and B5 Flash remain distinct modes sharing inventory only through the proven B4/B5/G–M allocation ledger. Supplier-owned immutable physical SKU/grade/pack and family/category remain the only real quote identity. No mixing unlike units or grade, client-side invented savings, unauthorized automatic payments, exposed buyer PII or bypassed supplier delivery constraints.

## N — Collective Recurring Procurement / Demand-first

1. Buyer opts into an organizer-managed recurring cohort with an existing, ACTIVE **buyer-owned** recurring contract. Organizer owns own ACTIVE recurring contract; no buyer consent by proxy. Explicit invite only; each invitee joins with their own active contract and independently agrees to share only the required family, unit and request-spec demand. Preserve individual quantity, date, skip/pause status, consent and private address.
2. A cohort has one cadence (WEEKLY/MONTHLY), one compatible execution day/time zone, joining cutoff minutes, minimum distinct buyers ≥2, immutable version, and no stored payment credential. Late joins only affect future cycles.
3. The schedule worker creates a distinct **cycle proposal** for a cohort+local cycle_key exactly once under row locks; revalidates each member's schedule and skip/pause at the time of generation; rejects unqualified cohorts without stock/payment side effects. Keep a participant-specific immutable cycle snapshot rather than copying someone else's buyer demand.
4. Prepare one **collective one-time request** and linked private group via existing request+I APIs, not a new quoting/award engine. Copy only the organizer template product families into the new request; each participant's compatible subset is mapped family+unit+requirements+pack semantics and independently invited. Each buyer must explicitly join the specific cycle with their own quantities; automatic standing contract membership does NOT automatically create binding group consent.
5. Reuse J private supplier invitations and bids, K price approval/qualification and G/H individual paid settlement **only after G–M acceptance**. If a member skips or group minimum fails, mark cycle unqualified, no payment or stock reservation.
6. Demand-first: introduce a read-only compatibility/adaptation interface for existing `demand_pool_requests`; never mutate/rename legacy demand pools, silently transfer membership or create duplicate orders.
7. Acceptance: duplicate cycle processing, paused member, skipped occurrence, buyer withdrawal, incompatible SKU, under-minimum cohort, stale contract, expired quote and crash recovery; every buyer has own approval/payment state.

## O — Area grouping, delivery-day scheduling and fulfillment

1. Reuse existing Lahore supplier service zones and buyer-specific per-order authorized delivery destinations. Compute cluster candidates without sharing buyer PII between participants.
2. Use strict grouping key: supplier ID + normalized delivery zone/cluster + delivery date/window + actual temperature/handling needs + fulfillment source; no cross-supplier delivery promises.
3. Supplier-declared delivery fees, stop charges and verified per-km surcharge are the sole source of price; avoid guessed kilometers/ETA. Include optional pickup and optional fast delivery only where supplier explicitly enables both, with buyer acceptance of exact extra charge.
4. Persist immutable allocation snapshots and per-buyer leg status; supplier sees its **own** assigned buyer drops only; unrelated buyers/admin bypass prohibited. No changing accepted order totals because of later grouping.
5. Lifecycle: PROPOSED → CONFIRMED → DISPATCHED → DELIVERED / FAILED, explicit evidence and dispute linkage; delivery failure raises buyer-specific resolution, not blind auto-refund.
6. Acceptance: mixed zone must not cluster, no duplicate fees, stop limits, privacy, grouped delivery date conflict, fee changes require reapproval, pickup fallback explicit.

## P — Conditional supplier production/pre-orders

PRE-ORDER is **DEFERRED BY POLICY** until explicit written agreement on supplier production lead time, physical batch minimum, customer deposit/funding, risk ownership, supplier failure, late/partial production, refunds/food safety, cancellations and legal/regulatory requirements. Implement only a non-chargeable capability flag/policy interface that returns `PREORDER_POLICY_NOT_APPROVED` for any attempt to create payable/ready-stock reservations. No misleading live UI or paid status.

## Q — One unified procurement experience and final gate

1. Extend original `RfqPage.jsx`, existing countdown parser/component and current styling; progressive mode choices rather than creating duplicate pages, preserve English/Urdu catalog where already agreed elsewhere.
2. Role-specific eligible actions: request, matching, comparison, independent buyer approval, group/recurring controls, delivery grouping and tracking; all disabled states and backend errors are accurate.
3. UTC server-owned countdowns: RFQ, quote, join, recurring due/cutoff and optionally production start; no negative timers or timezone-less MySQL treated as browser local.
4. Notification outbox for quotes/revisions, joined/cycle due/failed, order payment cutoff, shipping status: immutable event dedupe keys, buyer-scoped recipient authorization, retries, never expose addresses or direct supplier contact in external payload. Only dispatch supported channels where configured.
5. Regression: A–M latest accepted report, B4/B5 concurrent allocation, signed Safepay sandbox, collective cycle opt-in, supplier delivery, front-end production build, P deferral and protected DB zero writes. Record actual SHA, test commands, assertion counts and blockers.

## Explicit phase gates

- N: no implicit participant consent, no automatic payment, idempotent cycle proposals, J/K reuse.
- O: real cost only, buyer privacy, supplier-owned routes, immutable accepted delivery fee.
- P: marked DEFERRED unless signed policy exists.
- Q: all mandatory N/O/Q plus accepted G–M and A–F full real DB/API/browser gates PASS. Until then status remains BLOCKED/NOT VERIFIED.

## Implementation steps inside one batch

1. Create N cohort/cycle schema, scheduling policy, consent-gated service and tests.
2. Create O grouped delivery policy, supplier-controlled grouping/read models and tests.
3. Add P policy fail-closed guard without financial writes.
4. Connect Q events/read models and buyer/supplier existing frontend; execute source-level tests.
5. After separate G–M QA report arrives, reconcile latest G–M fixes on isolated Phase 2 branch and run serial `miljor_test_db` migrations/HTTP/financial/frontend/browser acceptance. Do not modify parent branch until reconciliation is authorized and checked.
