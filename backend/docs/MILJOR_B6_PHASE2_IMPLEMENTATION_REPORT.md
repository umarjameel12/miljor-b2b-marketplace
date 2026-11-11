# MilJor — B6 Combined Phase 2 (N–Q) Implementation Checkpoint

**Scope:** Approved fixed plan `backend/docs/MILJOR_B6_COMBINED_PHASE2_IMPLEMENTATION_PLAN.md`. No scope additions or changes.  
**Isolated branch:** `feature/b6-phase2-nq`, forked from B6-G–M commit `0504d65c7567486483594be23c39d16ebe0cb60e`.  
**Parallel work:** G–M Antigravity acceptance and auto-repair remains on `feature/b6-private-rfq`; that branch and B4/B5/main are not altered.  
**Verdict:** **IMPLEMENTED SOURCE / FINANCIAL AND REAL INTEGRATION ACCEPTANCE BLOCKED**. Not production-ready.

## N — Collective recurring procurement, independent buyer cycle consent

- Migration `046_recurring_collective_cycles.sql`: buyer-owned private cohort, independently consented recurring membership, immutable cycle proposal + per-cycle retry ledger, with uniqueness on cohort/cycle and contract ownership FKs.
- `procurementCollectiveRecurringPolicy.js`: verifies active and compatible weekly/monthly schedules, Karachi timezone, approved payment/requote rules, distinct eligible verified buyers, exact product family/unit/requirements/grade matching, indivisible pack quantities and exact decimal aggregation.
- `procurementCollectiveRecurringService.js`: verified private cohort creation with explicit organizer opt-in, private invitations, individual active schedule linking, minimum-buyer activation, leave/pause/resume/cancel for future cycles, idempotent creation of a **NEW** unpaid ONE_TIME collective request, actual I participation invitations, J supplier bidding and K per-buyer consent handoff. Creates no order, payment, stock allocation or standing card authorization.
- Every linked buyer must have their own active schedule AND due `SCHEDULED` cycle; paused, skipped, changed-contract and ineligible buyers are excluded. Each cycle preserves **private buyer-specific fixed planned quantities**; join validates own frozen items/quantities and never commits an entire cohort on behalf of an individual buyer. Generic one-time group joins remain flexible.
- `runDueCollectiveBatch`: opt-in 5-minute scheduler, bounded persistent retries/backoff (5/15/60/240 minutes, failed after fifth or terminal error). `closeExpiredUnderMinimum`: at join cutoff, groups below independently JOINED minimum are failed, their unpaid draft cancelled and each buyer receives a private notice. Groups above minimum remain available to the existing J supplier bidding transition. Zero stock/payment effects; query filters under-minimum candidates to prevent batch starvation.
- Source branch's normal individual recurring worker excludes contracts with an ACTIVE collective cohort, avoiding parallel individual auto-generated drafts; users can still leave or pause the cohort without changing paid history.
- `procurementDemandFirstAdapter.js`: read-only, owner-scoped compatibility preview of legacy `demand_pool_requests`; preserves Request-a-Pool state and routes; does **not** silently convert into a new payable order.

## O — Authorized grouped Lahore delivery and fulfillment

- Migration `047_procurement_delivery_runs.sql`: buyer-approved paid-order delivery choices, supplier-specific route headers and immutable per-buyer stops with one-order-one-run uniqueness, supplier/buyer FKs and separate lifecycle statuses.
- `procurementDeliveryGroupPolicy.js`: only PAID pre-dispatch orders; same supplier, Lahore cluster, date, time window, handling and declared delivery mode can group. Exact original delivery fees summed; no price change, distance/ETA invention or extra payment. Pickup is not silently turned into doorstep delivery.
- `procurementDeliveryGroupingService.js`: buyer can preview their own **existing paid-order delivery fee**, approve matching confirmed original delivery destination and same exact amount, with idempotent acceptance. No unrelated address substitution, no unbound express quote; Express/Pickup mode switching is intentionally disabled within post-payment grouping (existing dedicated fulfillment paths retained).
- Verified supplier proposes only own eligible paid order runs under transactional order row locks and unique per-order stop constraints; buyer-specific status is sourced from the existing paid fulfillment engine, never directly fabricated. Supplier run listing contains only supplier-owned runs; buyer sees only own order delivery status. Notifications are per buyer, without addresses/phones.
- Existing supplier route configuration/cluster rate eligibility and buyer address revisions checked. Grouping creates zero payments/refunds, and cannot change accepted order total. Any more sophisticated per-km pricing/route ETA requires authoritative supplier configuration and real routing evidence, not fabricated values.

## P — Conditional production / preorder

- `procurementPreorderPolicy.js` exposes `DEFERRED` only and always rejects prepaid/preorder activation with `PREORDER_POLICY_NOT_APPROVED`.
- Neither deposit nor production batch nor ready-stock purchase/reservation is enabled. Explicit legal/food-safety/lead-time/cancellation/batch-failure/refund/funding and individual approval rules must be agreed first. P is deliberately not claimed to be implemented as a live commerce mode.

## Q — Single existing procurement UI and private notices

- Migration `048_procurement_notification_outbox.sql` and `procurementNotificationService.js`: durable idempotent recipient/event key, strict role/owner-scoped inbox, limited typed event schema, allowlisted scalar payload fields, no buyer contact/address/payment secrets.
- Quote submissions and revisions, private collective joins, standalone recurring due drafts, collective cohort invitations/cycle ready or unqualified, delivery acceptance/plan and synced fulfillment milestones enqueue notifications **inside the associated transaction**. External SMS/email dispatch remains subject to configured consent and adapters; no false sent claim.
- `frontend/src/components/procurement/ProcurementAdvancedControls.jsx` is mounted inside existing `RfqPage.jsx`. One screen supports future recurring group invitations/activation/leave, due-cycle proposals, buyer-paid order fee preview/confirmation, supplier-paid delivery runs, private notices and truthful DEFERRED pre-order status. Existing common CountdownTimer is reused; no cloned RFQ app.
- Generic collective invitations for recurring cycles show **only the authenticated buyer's own scheduled item/quantity**. Buyer explicitly confirms on each cycle; new pricing still requires separate supplier/buyer quotation acceptance.

## Exact source tests executed in isolated JavaScript mock adapters

| Gate | Actual result |
|---|---:|
| `b6_collective_recurring_policy_gate.js` | **14/14 PASS** |
| `b6_delivery_group_policy_gate.js` | **16/16 PASS** |
| `b6_collective_recurring_worker_gate.js` | **8/8 PASS** |
| `b6_preorder_notification_policy_gate.js` | **12/12 PASS** |
| `b6_collective_cycle_join_gate.js` | **11/11 PASS** |
| `b6_collective_join_cutoff_gate.js` | **9/9 PASS** |
| `b6_paid_delivery_acceptance_gate.js` | **11/11 PASS** |
| **Total isolated assertions** | **81/81 PASS** |

- All 13 inspected affected backend .js services/controllers/routes passed JavaScript source parsing.
- **No live MySQL migration/execution, real Express HTTP, signed Safepay sandbox, browser/Vite production build or B4/B5 full regression executed in this GitHub-only implementation session.** These remain mandatory and must not be replaced by isolated PASS.
- Existing `miljor_db` was not contacted by this session, but its unchanged state still needs an independent test-environment baseline audit before full acceptance.

## Mandatory remaining full integration QA and reconciliation

1. Compare actual most recent accepted G–M QA report/fixes to this isolated branch; reconcile conflicts **only after comparison**, no overwrite/force-push, especially `procurementRecurringService`, `procurementCollectiveService`, `procurementQuoteService`, `procurementController`, `procurementRoutes` and `RfqPage`.
2. In isolated backed-up `miljor_test_db`, verify and apply migrations 046–048 only after accepted G–M migration 036–045. Inspect SQL/DDL constraints, MySQL DATE UTC handling, idempotent retries, FK and enum compatibility, and avoid production DB mutations.
3. Execute actual positive/negative N/O/P/Q HTTP tests with verified business buyers/suppliers; test cycle join and deadline races; concurrent worker retry, crash recovery, PII rejection, supplier route one-order-one-run uniqueness, quote and delivery amount immutability, and notification outbox rollback.
4. Run G/H/K signed Safepay, B4/B5/B6 shared last-stock concurrency, individual collective funding/refunds, legal tax and settlement and failure-state tests. **Do not enable financial gates when those rules remain unverified.**
5. Run actual frontend production Vite build and buyer/supplier browser walkthrough, then B0–B5/B6-A–M regressions.
6. Record real SQL row-count and protected production `miljor_db` zero-write evidence, exit codes, warnings and exact SHA. Update phase log PASS/FAIL/BLOCKED only after actual integration.

**Conclusion:** N/O/Q source paths are advanced with privacy and payment guards. P is intentionally DEFERRED. Full B6 acceptance remains **BLOCKED until real integrated QA and G–M reconciliation**.
