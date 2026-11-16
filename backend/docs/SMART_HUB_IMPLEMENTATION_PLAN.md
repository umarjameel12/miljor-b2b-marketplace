# Smart Procurement Hub implementation and acceptance plan

Baseline: PR #53, f8a82037a83e6f8ccb59e8bb1ffd2c79354b634f. Scope recovered from Procurement Plan Summary and its attached Pasted text(1).txt on 2026-11-15. Each phase requires code, negative tests, durable evidence, and exact-commit acceptance before release. Existing report claims are historical evidence, not current acceptance.

**Mandatory cross-phase requirement:** Event-driven notifications are core business scope in every phase, not an optional follow-up. Implement the event/recipient/channel matrix and acceptance contract in [SMART_HUB_NOTIFICATION_ACCEPTANCE.md](SMART_HUB_NOTIFICATION_ACCEPTANCE.md). No phase passes until its business action and notification gates pass independently. Extend existing notification/outbox infrastructure; preserve UCP, protected databases, B6 checkout gates and Safepay sandbox restrictions.

## Impact map

| Component | Current evidence | Required change | Risk |
| --- | --- | --- | --- |
| Unified hub and counteroffers | PR #53 implements unified UI, numeric negotiation and scoped delivery discovery | Preserve authorization, expiry and supplier decisions; verify real browser flow | High |
| Recurring | Weekly/monthly policy, per-cycle drafts, pause/resume/skip services exist | Biweekly cadence; connect approved delivery terms and independent cycle lifecycle | High |
| Delivery/award | Discovery read-only; PR explicitly records missing immutable mode binding | Supplier-approved mode, exact charges, address/collection point, window and version bound into award | Critical |
| Collective | Participation/approval services exist | Verify individual consent, tier shortfall handling and separate supplier batches | Critical |
| Fulfillment/finance | PRs #28/#29 contain overlapping safety and acceptance work | Reconcile per-line partial receipt, disputes, exact refunds and settlement eligibility | Critical |

## Phase 1: baseline and history reconciliation

Notification gate N1: inventory existing producers, inbox/outboxes, workers, channel configuration and frontend consumers; map missing events without duplicate systems. Reconcile migrations 023/048/049, fix recipient/read authorization defects, and establish transactional enqueue, event identities, channel retries and financial/security mandatory policy before downstream event wiring. Verify with isolated rollback/concurrency and recipient isolation tests.

Review #53 and overlapping #28/#29 source diffs; compare common service paths before porting any patch. #28 remains draft/conflicting against main; #29 is stacked on #28 and its synthetic signed callback is not provider-originated sandbox proof. Do not blindly merge either. Audit canonical manifest, pinned migration blobs, applied ledger names and journal checksums. Preserve historical migrations 046–048 and UCP 051–053. New migrations are forward-only; never renumber applied history. Gate: clean canonical manifest and VERIFIED_HISTORY on isolated test schema; incompatible journal stops DDL.

## Phase 2: request, quote and immutable commercial terms

Notification gate N2: transaction-backed request creation/publication, supplier matching, quote/counteroffer and supplier decision events, revision, verified expiry and final commercial lock. Authorize recipients separately for each quote; test stale/failed/rolled-back operations emit no success notification.

Reuse request, product counteroffer, quote and award services. Validate selected numeric lines, exact decimals, quote/version expiry after locks, buyer/supplier ownership, and supplier decisions. Freeze SKU/specification/quality/pack, quantity, unit price, validity, all delivery terms, fee/tax breakdown and currency in an immutable accepted snapshot. Supplier acceptance alone cannot create buyer payment or order consent. Gate: actual MySQL/HTTP expiry boundary, stale revision, concurrent acceptance, duplicate intent, unauthorized actors and rollback tests; browser checks exact displayed versus invoice totals.

## Phase 3: individual group commitments and capacity

Notification gate N3: invitations, joined/left membership, minimum reached, cutoff, changed price tier, individual consent and payment pending/failed. Each buyer sees only their own terms/payment details; organizer receives permitted aggregate status only. Duplicate threshold checks cannot resend an unchanged transition.

Aggregate only compatible specifications. Organizer may invite but cannot approve/pay for members. Every member approves an individual snapshot and supplier-specific suborder. Reevaluate unpaid/withdrawn members at cutoff; changed tiers require fresh approval without repricing locked peers. Reserve confirmed stock transactionally using existing inventory accounting; forecasts remain separate. Gate: competing reservations cannot oversubscribe; retries allocate once; rejected/cancelled intents release only their own allocation; unrelated members continue independently.

## Phase 4: recurring procurement and delivery

Notification gate N4: cycle generated, upcoming cutoff, quantity modified, skipped/paused/resumed, per-cycle payment approval required, next delivery reminder and missed cycle. Reminder jobs revalidate current versions/status before enqueueing; pause/skip invalidate obsolete reminders without erasing historical evidence. Calendar generation never implies paid status or delivery confirmation.

Weekly, biweekly and monthly calendars use Asia/Karachi. Biweekly parity remains anchored to first matching weekday on/after contract start, including after pause/resume. Generate one independent draft/order/payment/invoice per cycle; never authorize automatic debit. Skip/pause affect future unlocked cycles only. Requote on expired or changed terms and require explicit per-cycle approval. Preserve delivery preference but revalidate supplier stock, approved price, address and window each cycle. Gate: calendar boundaries/month end, overlapping workers, repeated generation, skip/pause/resume, changed schedule versions and locked-cycle cancellation tests on miljor_test_db.

## Phase 5: delivery terms, routes and fair pricing

2026-11-15 execution: supplier-approved delivery-choice binding implemented for the existing pickup/clustered/express quotation modes, with pickup-to-paid-order/invoice real HTTP acceptance 10/10 and actual pickup/clustered price/destination tests. See SMART_HUB_DELIVERY_BINDING_EXECUTION_2026_11_15.md. Route compatibility/optimization, additional individual/collection-point contracts and full recurring/browser integration remain open; this does not mark all of Phase 5 complete.

Notification gate N5: cluster created, route assigned, dispatch scheduled, out for delivery, ETA changed and delay. Supplier/authorized dispatcher sees assigned operational scope; each buyer sees only their own delivery stop and applicable charges. No other buyer's address/contact or full route is exposed in buyer notifications.

Support clustered doorstep, individual doorstep, supplier pickup, agreed collection point and supplier-confirmed express independently from group membership. Route compatibility requires same supplier dispatch, verified addresses, intersecting dates/windows, product safety, weight/volume capacity and cheaper comparable route cost. Reuse authoritative delivery eligibility and fee services. Allocate exact base-drop/weight/distance charges with deterministic rounding; supplier must approve terms before buyer accepts. Gate: incompatible windows/products/capacity and unverified addresses rejected; fee sum equals route total; regrouping cannot silently alter locked amounts; browser mode choice matches immutable order and invoice. Existing B6 checkout remains gated until implemented and verified.

## Phase 6: fulfillment, partial POD and reattempts

Notification gate N6: supplier-reported delivered, buyer-confirmed receipt, partial delivery, failed attempt, rescheduling and proof uploaded. Distinguish supplier delivery claim from buyer acceptance and settlement eligibility. Evidence links require fresh order authorization; a failed attempt cannot imply a newly agreed fee or slot.

Capture stop-level evidence and per-award-line ordered/delivered/accepted/disputed quantities. Reject overreceipt, wrong units and disputed quantities beyond remaining entitlement. A 100/80/20 receipt holds the corresponding 20 portion without blocking unrelated buyers. Failed delivery records responsibility, attempt history and proposed slot/fee; buyer must explicitly approve any extra fee. Gate: MySQL/HTTP concurrent partial receipts/disputes/refunds, duplicate POD, unauthorized upload/confirmation, reattempt consent and exact escrow remainder.

## Phase 7: invoices, Safepay and reporting

Notification gate N7: payment initiated/verified/failed, refund initiated/completed, dispute opened/resolved, settlement pending/completed. Financial/security alerts are mandatory. Only authoritative authenticated financial transitions may assert completion; prepared internal settlement remains pending while external execution is disabled. Include supplier verification/approval/rejection, suspicious activity and critical financial inconsistency notifications to scoped administrators/security recipients and affected accounts where appropriate.

Reuse exact-decimal finance services and immutable invoice snapshots. Display merchandise, base delivery, distance/express, processing fees, tax basis/rate/amount and final total before consent. Execute sandbox buyer payment through authenticated provider-originated callback, fulfillment and buyer receipt; disputed/unaccepted value stays held. External bank execution remains disabled. Synthetic callback tests prove handler behavior only. Savings require recorded comparable baseline, same quantity/spec/time/cost scope; missing baseline displays unavailable. Reliability reports define denominator, on-time window and missed/partial/cancelled handling. Gate: exact accounting identities, invalid/replayed signatures, wrong amount/currency, buyer-only receipt, no pre-receipt settlement, disputed-value hold, genuine sandbox evidence and reporting fixtures.

## Phase 8: combined release gate

Supplier-dashboard continuation (2026-11-16): preserve the existing dashboard design and latest main auth shell; expose verified supplier-owned live RFQ/collective/counteroffer/delivery-choice/expiry and paid-fulfillment counts. Link into existing hub actions. Replace supplier generic unpaid order checkout cards with the existing paid fulfillment lifecycle, stable retry keys, authoritative detail refresh, exceptions, timeline and invoice. Preserve delivery binding at dispatch. Acceptance: own/foreign/revoked supplier, expired requests, unpaid exclusion, transition/notification rollback and replay, pickup compatibility, account-scoped intents, frontend build, UCP source regression and real Chromium dashboard/deep-link/unpaid denial. Browser/CI remains pending until actual runs pass. No new financial engine or live payout is introduced.

Notification gate N8: execute the complete event matrix through real backend actions on miljor_test_db, concurrent/replayed operations and worker failures, English/Urdu templates, email and configured urgent SMS, preferences, inbox/unread/read ownership, realtime reconnect or polling fallback, authorized deep links and privacy checks. Record each event and each channel as PASS/FAIL/BLOCKED with exact-head evidence. A missing required provider or unexecuted integration gate is BLOCKED, never PASS. Notifications must not publish provider delivery success from mere queueing or provider acceptance. All required notification gates must pass before main merge.

Run isolated MySQL migration audit and relevant HTTP/concurrency gates, frontend build, existing B6/UCP regression and buyer/supplier browser E2E. CI must succeed on the exact proposed head. Trace one-time, collective, recurring, partial/dispute and failed delivery scenarios across buyer consent through internal settlement. Capture screenshots, HTTP responses, SQL identity and durable record counts. Critical gates must all PASS before main merge; otherwise keep #53 draft and enumerate blockers. Never substitute historical CI or mocked provider events for current end-to-end evidence.
