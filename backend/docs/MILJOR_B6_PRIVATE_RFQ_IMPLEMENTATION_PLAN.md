# MILJOR — B6 SMART PROCUREMENT HUB
## Unified Multi-Product RFQ + Collective Demand + Recurring Procurement — Implementation Master Plan

**Version:** 2.0 — consolidated business-scope plan, 2026-11-10
**Branch:** `feature/b6-private-rfq` (preserve existing branch name for Git continuity; buyer-facing name is **Smart Procurement Hub / Get Best Quotes**).
**Base:** B4 accepted `5689c377ffe80b1c94c37ddaa84d57bf569e9ea0`.
**B5 parallel:** `feature/b5-flash-pools` is separately tested/repaired; B5 code must not be merged blindly.
**Gate now:** PLAN APPROVED IN CONVERSATION / SOURCE IMPLEMENTATION NOT STARTED FOR THE EXPANDED B6 SCOPE. Previously created Regular Pool CountdownTimer/PoolCard source exists in this branch but is not runtime verified. Do not call B6 PASS before full gate.
**Strict rule:** one buyer-facing experience; separate domain state machines, database ledgers and per-buyer orders. No duplicate procurement engines, repository clones or secondary implementation files.

## 0. Product definition and boundaries

**Buyer-facing title:** Get Best Quotes
**Internal module:** Smart Procurement Hub (B6)
**Default UX:** one simple shopping-list form; hide complexity under optional Advanced Options.
**Target market:** verified Lahore B2B businesses, no household shopping.
**Buyer chooses three orthogonal options:**
1. **Demand ownership:** SINGLE_BUYER or COLLECTIVE (multiple independently authenticated verified businesses).
2. **Schedule:** ONE_TIME or RECURRING (WEEKLY, MONTHLY; daily/custom future additions only after rules/test approval).
3. **Shopping list:** SINGLE_ITEM or MULTI_ITEM (one or several supplier-spec requirements).
Additional independent choices: full-basket vs allowed split award, requested delivery address per buyer, doorstep/pickup, delivery windows, area clustering, priority lowest total landed price/fastest/best value. These determine behavior; do not multiply copy-pasted engines for each combination.

**Mode matrix:**
- SINGLE + ONE_TIME: Personalized RFQ, with one or many items.
- SINGLE + RECURRING: Recurring RFQ/contract with one or many items.
- COLLECTIVE + ONE_TIME: Collective Quote, same or complementary item demand; each buyer's commitment independent.
- COLLECTIVE + RECURRING: Collective Recurring Procurement with independently approved schedules/renewals.
**Related engines that remain separate:** B4 Regular Pool (supplier-led quantity threshold/tier pricing), B5 Flash Pool (ready-stock clearance). Hub may recommend eligible pool offers but must never silently convert an RFQ into a Regular/Flash Pool or double-reserve stock.

## 1. End-to-end buyer journey

**Step 1 — Build shopping list:** Search category/family; choose desired physical grade, brand preference (optional), pack size, purchasing unit, quantity, quality requirements, permitted substitutions (default NO), delivery date/window. Free-text allowed for request description; actual supplier quote must reference their own approved published physical SKU/listing. Add as many items as needed within configured limits.

**Step 2 — Choose request type:** Buy once or repeat weekly/monthly; alone or invite other verified businesses; complete basket from one seller vs allow multi-supplier split. For collective, show join cutoff, minimum aggregate demand/qualification, maximum buyer quantity where appropriate, opt-in individual commitments, payment responsibility, exit policy, and transparent what happens if minimum not met. Each buyer has own item quantities and drop-off address.

**Step 3 — Match suppliers:** Show eligible verified suppliers with service area, approved physical products, stock/availability, lead time, delivery terms and entitlements. Allow buyer invitations or automated matching. Never expose direct buyer contact info to unrelated suppliers, public users or other buyers.

**Step 4 — Receive item-wise/basket quotes:** Supplier can quote whole basket or explicitly selected lines, with exact SKU/spec version, line quantity, pack unit, line price, validity, lead time, minimum qualified aggregate demand, delivery fees by cluster/stop, surcharge if configured, tax/processing charge breakdown. Supplier can decline unavailable lines. Record immutable versioned offers. Discounts must be genuine and source-qualified.

**Step 5 — Compare:** 3 buyer-friendly views: Lowest total delivered cost, Fastest eligible delivery, Best overall value. Explain when quotes have different grades, substitutes, quantities, delivery routes or partial coverage. Support buyer-initiated Request Better Offer/counterquote with immutable version history. Never aggregate non-equivalent physical SKUs as identical. Do not assume a single supplier wins all items.

**Step 6 — Select and confirm:** Buyer explicitly approves winning complete quote OR permitted item-wise combination. For collective requests show individual buyer totals, delivery fee per address, group qualification and confirmation deadline. Before transaction lock, revalidate listing status, stock, quote version/expiry, exact units, entitlements and buyer authorizations. Every independently buying business accepts its own obligation; one organizer cannot spend another buyer's money. Server creates idempotent immutable order/order lines and allocation holds, not fake paid orders.

**Step 7 — Safepay and fulfillment:** Charge per actual buyer order using server-verified Safepay only. Hold/release/refund with authoritative provider reconciliation. Supplier handles accepted committed items. Delivery clustering assigns authorized addresses only to responsible suppliers/carriers; per-buyer order tracking, receipts, disputes, refunds and fulfilled quantity recorded independently. Never mark paid from client response.

**Step 8 — Optional repeat:** Buyer can duplicate a completed list into a fresh one-time RFQ without creating a contract. Recurring is an explicit opt-in contract with cadence, cutoffs, validity/price mechanism, buyer reauthorization where terms change, pause/resume, missed-cycle rules, and termination.

## 2. Architectural invariants (mandatory)

**Canonical taxonomy / supplier ownership:** MilJor owns categories and families; each supplier owns physical SKU, grade, brand, pack and description under an approved product specification. Published specs are immutable; replacements create new SKU/version as governed by existing lifecycle. Comparison is specification-aware.

**Precision:** use existing exactDecimal utilities (DECIMAL for money/quantities, applicable 4-decimal source precision and purchasing unit/increment contracts; currency rounding only at correct monetary boundary). Never use JS float to decide acceptance, allocation or ledger amounts.

**Inventory:** each SKU/listing has one authoritative allocatable quantity. Regular Pool, Flash Pool and Hub commitments serialize through `supplier_inventory_allocations`/same listing lock contract; pending RFQs/quotes do NOT automatically reserve stock until the defined award/checkout hold boundary. Do not hold a seller's entire quoted inventory for days without explicit limited commitment. Group minimums and all-or-nothing awards release safely when unmet.

**Orders:** parent procurement request may contain multiple suppliers and multiple buyers, but payment/invoice/order ownership remains per buyer and supplier obligation. Split awards yield separate supplier fulfillment/order obligations and corresponding per-buyer payable totals. Never create one shared financial liability across buyers. Handle partial supplier failure with line-level status, explicit buyer decisions and authorized refunds.

**Quote acceptance:** version-locked snapshot; no auto-accept if price/spec/delivery changes. One active chosen award per eligible line, conditional group award if needed. Durable idempotency, deterministic lock order, compensating rollback only if legally/financially safe.

**Time:** authoritative UTC deadlines and API server_time for buyer-visible countdown on requests, collective joins, quotes, order holds and recurring cutoffs. Countdown is display only; server rejects operations after expiry. Existing Regular/Flash timer code must remain compatible. No timezone-less date interpretations.

**Delivery:** area and delivery-day grouping are *optimization rules*, not independent marketplaces. Validate capacity, costs, minimum drops, route-area constraints; allow pickup fallback and fast delivery only when actual carrier/supplier conditions permit. Do not invent guaranteed savings.

**Privacy/security:** verified B2B role-based access at route + service + DB filters; organizer cannot view other buyers' full addresses, wallets or private quotes beyond explicit disclosure; supplier sees only assigned delivery addresses after award. In-platform communications and moderation controls. Audit every acceptance, cancel, deadline, payment, retry and reconciliation.

**Status and release:** each subphase gets source/functional/DB/API/auth/errors/test evidence. PASS only with actual execution; implement gates separately from mere source code presence.

## 3. Proposed relational design (audit current migrations before creating anything)

Extend the existing legacy `rfqs`, `rfq_quotes`, `recurring_contracts`, `demand_pool_requests`, `orders` and allocations through **additive forward-only migrations** where compatible. Decide whether these tables can safely represent normalized new structures; never overwrite or repurpose historical records by assuming equivalence.

Logical entities (names illustrative, finalize after SQL audit):
- `procurement_requests`: creator buyer, mode SINGLE/COLLECTIVE, cadence, split_award policy, priority, status, quote/join deadlines, delivery group, version.
- `procurement_request_items`: canonical family/category, buyer's target specs, quantity + purchasing unit + increment, brand/grade preferences, allowed substitution policy, needed date.
- `procurement_participants`: buyer, invite/join/confirm status, join cutoff, acceptance snapshot, independent buyer consent.
- `procurement_participant_items`: buyer-specific quantities per requested line, accepted spec constraints, target pricing and effective delivery destination ID.
- `procurement_delivery_destinations`: scoped buyer address and service area; PII encrypted/redacted per existing platform policy, access controlled.
- `procurement_supplier_invitations`: eligibility/matching and invited/declined flags.
- `procurement_quotes` + `procurement_quote_versions`: supplier, coverage ALL/PARTIAL, deadline, overall terms; append-only versions.
- `procurement_quote_lines`: linked request item, owned approved SKU/listing, quoted quantity, unit price, fee, delivery/lead-time, immutable spec snapshot.
- `procurement_awards` + `procurement_award_lines`: winning supplier/quote version per line and buyer, exact terms, idempotency and qualification/hold state.
- `procurement_schedule_contracts` + `procurement_schedule_cycles`: recurring cadence, cutoff, cycle idempotency, price version, pause/resume, failed-cycle state, next run; each cycle generates separately authorized obligations.
- `procurement_delivery_groups` / `procurement_delivery_stops` only if existing clustered-delivery schema cannot support it.
- Existing `orders`, `payments`, `payment_attempts`, `supplier_inventory_allocations`, `ledger`, `refunds`, `notifications` are authoritative where compatible, not duplicated.
Unique constraints for (participant/request), (quote/version), (supplier/listing/award identity), (schedule/cycle), idempotency and buyer owned order. Enforce FKs, indexing, status constraints and per-buyer privacy.

Migration acceptance: backup verified `miljor_test_db`; apply there ONLY, inspect data preservation + rollback strategy. Never write to protected `miljor_db`.

## 4. Build phases and gates — approved sequence

**B6-A — Baseline, contracts & migration design**
Inspect root/backend AGENTS, business invariants, legacy RFQ/recurring/demand services and routes, catalog/SKU/stock/fee/payment/fulfillment contracts, B4/B5 branches. Record existing tests/schema and incompatibilities. Design exact API/state/DB, stable deadline and units conventions. **Gate A:** reviewed ERD, migration plan, role matrix, B4/B5 inventory lock agreement; NO implementation accepted on assumptions.

**B6-B — Shared buyer procurement request foundation**
Add/extend request + items model, exact validation, ownership, DRAFT/OPEN/EXPIRED/CANCELLED state machine and idempotent publish; never create a payable order from a draft. Add read/write endpoints and browser-free service tests. **Gate B:** buyer owns and can edit only own drafts, immutable published requirements except explicitly versioned changes, multiple distinct items preserved.

**B6-C — Buyer-first shopping list UI**
Refactor existing `frontend/src/pages/RfqPage.jsx` instead of creating a competing page; product search, add/remove/reorder lines, categories/families, exact pack units, price optional, area/address and delivery window, save draft, concise validation, mobile-first, accessible. Default single/one-time. **Gate C:** buyer completes multi-item draft without supplier terminology; error messages and UI/API contracts consistent.

**B6-D — Supplier eligibility, discovery & invitations**
Verified supplier + ACTIVE listing + APPROVED/PUBLISHED own SKU + physical compatibility + service area/lead time/entitlement. Supplier invitation/inbox, opt-in/decline, anti-bypass, no buyer address leak. **Gate D:** negative ownership/inactive listing/incompatible SKU/cross-tenant privacy tests.

**B6-E — Exact quote engine, partial baskets & versioning**
Suppliers quote ALL or selected items, show explicit unquoted items. Exact quantity, SKU physical spec, stock availability warning, fulfillment and delivery terms, quote expiry; append-only revisions, withdrawal, no fake discounts. **Gate E:** quoted line coverage, versions immutable, supplier-only edits, money exact, quote expiration enforced.

**B6-F — Smart comparison & negotiation**
Buyer sees whole-basket supplier A vs split A+B, total payable including multiple delivery charges, item-wise variance, lead time/verification and incompatible alternatives clearly tagged. Request Better Offer and supplier counterquote keep immutable history; calculate outcomes server-side. **Gate F:** cheapest total vs fastest vs best-value explanations auditable; mixed-SKU substitution never automatic.

**B6-G — One-time single-buyer award & Safepay**
Single buyer explicitly accepts exact quote/version and specified lines. Lock listing rows, reserve inventory atomically, allocate order lines, calculate fees once, persist AWAITING_PAYMENT before checkout, verify Safepay server-side, handle timeout, replay, partial refunds and payment reconciliation. **Gate G:** duplicate acceptance produces one order, races cannot oversell, ledger exactly once, no phantom PAID status.

**B6-H — One-time multi-product split supplier award**
Buyer may select one supplier per compatible line or full-basket supplier; independent supplier orders with linked procurement parent, combined buyer summary and per-supplier totals/fulfillment. Partial failure/reprice triggers explicit buyer reapproval, not silent fallback. **Gate H:** each line allocated once, correct multiple delivery fees, coherent one-buyer multi-order tracking.

**B6-I — Collective requests and buyer invitations**
Buyer organizer can invite verified businesses or use controlled discoverable request; join deadline/countdown, per-buyer specs, quantities, consent, min group demand, withdrawal/cancel rules. Separate buyer liabilities; no organizer impersonation. **Gate I:** only authorized participants commit and see own PII; no accidental obligation on pending joiners.

**B6-J — Collective supplier bidding and qualification**
Aggregate *compatible* item demand only (same accepted SKU/spec requirement/units), group price breaks and region deliveries; quotes may require aggregate minimum, and must define partial qualification, single/multi supplier, per-buyer fee allocation and delivery conditions. No cross-SKU quantity mixing. **Gate J:** 100kg rice + 100kg sugar never treated as 200kg of one product; expiry/unqualified group handled without charging buyers.

**B6-K — Collective awards, buyer confirmation & separate checkout**
Supplier award contingent on collective terms, freeze buyer participation before award; each buyer confirms/pay own amount in cutoff. Atomically qualify under agreed policy (all-or-nothing vs explicitly supported partial qualification); fallouts/cancellations/shortfalls handled by refund/void and requalification policy, never silently charge remaining buyers more. **Gate K:** multi-buyer races, unpaid dropout, paid preservation, escrow/reconciliation and shortfall invariant.

**B6-L — Recurring contract setup (single-buyer)**
Buyer explicitly opts into weekly/monthly schedule per approved item/quote; choose start/end, cutoff, address, payment approval policy, price-fix or per-cycle requote, skip/pause/resume/cancel. Only create payable orders at actual cycle and explicit authorization, never store raw payment credentials. **Gate L:** cadence/timezone correctness, immutable paid cycles, price change reapproval, safe cancellation.

**B6-M — Recurring execution, cycle processing & failures**
Durable idempotent scheduler/worker generates cycle RFQ/award/order through same engines, handles retries, skipped cycles, insufficient stock, expired agreement, supplier failure, notifications, provider reconciliation and billing authorization. **Gate M:** no duplicate Monday orders, no unauthorized charge, no change to historical paid cycles.

**B6-N — Collective recurring + demand-first**
Participants join each recurring cycle under separate consent/cutoff; aggregate qualifying item demand, invite suppliers, bid/accept as agreed, route through B6-J/K and B6-L/M. Demand-first supplier bids reuse request matching, not a separate demand exchange; integrate existing `demand_pool_requests` by adapter/migration preserving legacy routes. **Gate N:** buyer dropout and group-min shortfall never produce phantom stock or payment.

**B6-O — Area, delivery-day grouping & fulfillment**
Integrate existing Lahore clusters, assigned buyer addresses, supplier service areas and per-km surcharge policy; optimize compatible delivery runs, pickup fallback, grouped delivery days, buyer-specific status, SLA/cost allocation, refund/dispute proof. Avoid route-cost promises without actual supplier configuration. **Gate O:** no cross-buyer address leak, charged delivery sum matches terms, fast delivery optional only when available.

**B6-P — Pre-order/production batch option (separate conditional submode)**
Optional future production/advance-order flow only if supplier lead time, batch minimum, production risk, payment/deposit/refund/shortfall protections and regulator/food-safety status are explicitly specified. Distinct physical stock status (not ready stock), no selling promised ready inventory twice, never irreversible charge without approval. **Gate P:** if commercial policy not yet approved mark **DEFERRED**, do not simulate implemented deposits or acceptance.

**B6-Q — Buyer UX completion, countdown, notifications & FULL acceptance**
Unify `RfqPage` and buyer/supplier screens; show single/collective + one-time/recurring + multi-item as progressive choices, not dozens of separate modules. Accurate deadline countdown for RFQ, quote, group join, recurring cutoff; reuse `frontend/src/components/ui/CountdownTimer.jsx`, preserve existing Regular Pool countdown and B5 compatibility. Notifications on quote, revision, price change, joining, payment deadline, schedule next-cycle. Comprehensive frontend/API/security tests, B0–B4 regression, reconciled B5 shared stock regression, mutable tests only `miljor_test_db`, frontend build and protected DB zero-write evidence. Create final `backend/docs/MILJOR_B6_IMPLEMENTATION_REPORT.md`, update `backend/docs/MILJOR_PHASE_LOG.md`, commit/push verified changes only to B6 branch. **Gate Q:** all mandatory implemented B6 features PASS with actual assertion totals, hashes, schema and financial evidence; P may be transparently DEFERRED if separately approved.

## 5. API contract (proposed — align with existing routes)

Buyer: POST/GET/PATCH `/api/v1/procurement/requests`, `/:id/items`, `/:id/publish`, `/:id/participants`, `/:id/quotes/compare`, `/:id/award`, `/:id/orders`.
Supplier: `/api/v1/procurement/supplier/requests`, `/:id/quotes`, `/:id/quotes/:quoteId/revise`, `/:id/decline`.
Recurring: `/api/v1/procurement/schedules`, `/:id/pause`, `/:id/resume`, `/:id/cancel`, `/:id/cycles`.
All handlers apply authentication, role, ownership, validation and idempotency before domain mutations; minimize changed public routes and add compatibility adapters for old RFQ/recurring endpoints if safe. Do not expose admin impersonation from legacy routes.

## 6. State transitions (proposals subject to existing data audit)

Request: DRAFT → OPEN → QUOTING → AWARD_PENDING → AWARDED → FULFILLING → COMPLETED; alternatives EXPIRED/CANCELLED/FAILED only via authorized guards.
Item: REQUESTED → QUOTED → AWARDED → ORDERED → FULFILLED; cancellation, return/refund tracked line-wise.
Participant: INVITED → JOINED → CONFIRMED → PAYMENT_PENDING → PAID; may DECLINE/LEAVE/EXPIRE before cutoff; already paid never automatically voided.
Quote version: SUBMITTED → SUPERSEDED/WITHDRAWN/EXPIRED/ACCEPTED; immutable historical versions.
Cycle: SCHEDULED → CUTOFF → QUALIFYING → ORDER_PENDING → PAYMENT_PENDING → PAID → FULFILLING → COMPLETED, with PAUSED/SKIPPED/FAILED safe transitions.
Do not conflate quote accepted with money paid or supplier fulfillment with payment settled.

## 7. Implementation order and parallel execution

- **B6-A through B6-G:** secure one-time single buyer + multi-item foundations.
- **B6-H:** split supplier selection, multi-order/line settlement.
- **B6-I through B6-K:** collective mode (multiple independent buyers).
- **B6-L through B6-N:** recurring + recurring collective + demand-first.
- **B6-O:** area/delivery-day consolidation, when relevant shared delivery contracts stable.
- **B6-P:** deferred unless pre-order policy authorized.
- **B6-Q:** complete UX and end-to-end gate.
Never skip gates or jump directly to collective recurring before single-buyer financial safety is proven. Module can be developed on B6 while Clarity tests B5, but never run B5 and B6 mutable tests simultaneously in `miljor_test_db`. Reconcile accepted B5 interfaces at Q, before final PASS.

At every phase: `UNDERSTAND → INSPECT ONCE → IMPLEMENT COMPLETELY → TEST RELEVANTLY → VERIFY → REPORT → STOP`. Keep phase status in log with actual Git SHA, changed existing paths, executed tests, DB evidence, PASS/FAIL/BLOCKED and stop. Approval to implement B6 does not authorize automatic B7, main merge, force push or production migration.

## 8. QA acceptance scenario matrix (minimum; extend for each phase)

1. 1 buyer, 1 product, 1 supplier — RFQ → quote → order → verified pay.
2. 1 buyer, 4 products, 1 full basket supplier.
3. 1 buyer, 4 products, 2 suppliers, partial quotes, correct split delivery fee.
4. 3 buyers, 2 items, distinct quantities/addresses, one combined quote, 3 independent payments.
5. 3 buyers recurring every Monday; one skips next cycle, others unaffected if group minimum still qualifies.
6. Supplier physical SKU conflict: different grades or pack units not silently merged.
7. Existing B4 Regular Pool + B5 Flash offer + B6 award compete for same listing inventory: never oversell.
8. Two buyers accept same depleted stock concurrently; safe deterministic outcome.
9. Duplicate webhook, retries, provider outage: no double charge, ledger duplication or premature stock release.
10. Buyer cancel/leave before cutoff vs paid/after cutoff: policy-compliant state and financial effects.
11. Price quote expires while buyer views comparison: acceptance rejected server-side.
12. Timer refresh, tab background, Pakistan time zone, 24h / multi-day rollover, zero expiry.
13. Unauthorized admin impersonation, outsider RFQ/quote/participant read, exposed addresses rejected.
14. Recurring cycle replay, cadence change, paused cycle, expired supplier quote and payment reauthorization.
15. All affected B0–B4 tests, accepted B5 shared stock checks, full frontend build, protected `miljor_db` pristine.

## 9. Definitions of DONE and explicit non-goals

A subphase is **COMPLETE AND VERIFIED** only after actual database, backend, API, RBAC, validation, error handling, UI (where in scope), security, concurrency, money and tests work together with evidence. GitHub source pushes alone mean SOURCE IMPLEMENTED, not TESTED.

**Non-goals:** direct customer households, mandatory 12-hour limits, fake market discounts, supplier-admin impersonation, automated unapproved recurring charges, forced buyer contact sharing, entirely new payment gateway, independent delivery-day marketplace, mixed-unit artificial aggregate quantities, duplicate inventory or financial ledgers, automatic B7 start.

**CURRENT B6 STATUS:** MASTER PLAN UPDATED — source work for expanded scope and runtime acceptance pending. **CAN START NEXT PHASE: NO** without an explicit implementation go-ahead.
