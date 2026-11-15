# Smart Procurement Hub implementation and acceptance plan

Baseline: PR #53, f8a82037a83e6f8ccb59e8bb1ffd2c79354b634f. Scope recovered from Procurement Plan Summary and its attached Pasted text(1).txt on 2026-11-15. Each phase requires code, negative tests, durable evidence, and exact-commit acceptance before release. Existing report claims are historical evidence, not current acceptance.

**Mandatory cross-phase requirement:** Event-driven notifications are core business scope in every phase, not an optional follow-up. Implement the event/recipient/channel matrix and acceptance contract in [SMART_HUB_NOTIFICATION_ACCEPTANCE.md](SMART_HUB_NOTIFICATION_ACCEPTANCE.md). No phase passes until its business action and notification gates pass independently. Extend existing notification/outbox infrastructure; preserve UCP, protected databases, B6 checkout gates and Safepay sandbox restrictions.

## Remaining-work execution sequence — authorized 2026-11-16

Goal: complete the remaining scope as independently verified vertical slices on PR #53. Architecture: extend the existing procurement, delivery, fulfillment, finance and outbox services; each recurring occurrence and each group buyer retain independent commercial consent. Express/MySQL/React remain the stack. No alternative parallel engine, automatic debit or B6 gate bypass. Original protected checkout/configuration stays read-only. The present clean approved feature checkout is already separate from the original working project.

### R1 — Recurring controls and notification lifecycle (STARTED)

Files: procurementRecurringService.js; focused procurementRecurringCyclePolicy.js if pure normalization warrants it; procurementController.js/procurementRoutes.js; RfqPage.jsx and a focused cycle-control component; recurring contract/MySQL/notification tests and existing CI. Use existing recurring cycle_events for append-only quantity/delivery-preference revisions and stable mutation keys; no second schedule database.

- [ ] Pin regression for pause/resume version drift, post-cutoff edits, cross-buyer mutation, fractional packaging, concurrent revisions/retries and notification rollback.
- [ ] Reconcile only uncommitted scheduled cycles on pause/resume/cancel. Missed paused cutoffs remain skipped/missed, never silently prepared; generated/paid/history untouched. Preserve original biweekly anchor.
- [ ] Snapshot requested items when scheduling. Allow owner to change only that future cycle's quantities and nonbinding owned delivery preference under contract-first/cycle-second locks and expected revision. Generated draft copies this revision; supplier eligibility, stock, exact new delivery pricing and buyer payment require fresh approval via existing services.
- [ ] Expose cycle input/skip controls and backend-confirmed success in existing hub. Show delivery preference as requested, never as an approved fee.
- [ ] Add bounded idempotent upcoming-cutoff producer and verified draft-ready/missed notifications using existing outbox; paused/skipped cycles cannot emit new active reminders.
- [ ] Consolidated isolated MySQL/API/rollback/concurrency gate; relevant existing recurring/notification contracts; build and actual CI/browser controls. Record PASS/FAIL/BLOCKED by business event/channel. Commit verified phase and stop per project protocol.

### R2 — Individual collective commitment and capacity

Files: procurementCollectiveApprovalService.js, procurementCollectiveBidService.js, procurementAwardService.js and existing shared inventory/reservation services; collective routes/controller/UI; forward schema only if existing approval/order link is insufficient.

- [ ] Reconcile overlapping PR #28/#29 actual finance/fulfillment diffs before porting any source; retain accepted code and original migration checksums.
- [ ] Transform each buyer's separately approved current bid/spec/fee snapshot into only their own gated payable suborder, using shared stock locking/allocation. Organizer cannot consent/pay for peers.
- [ ] Preserve paid peers when unpaid/withdrawn quantity changes; any changed tier/fee requires fresh consent. No automatic repricing of locked orders. Stock reservation has durable expiry/release and no double allocation against Regular/Flash.
- [ ] Invitation/join/leave/minimum/cutoff/tier/consent/payment notifications use authorized recipients and immutable event identity.
- [ ] Test partial membership/payment, decline, stale bid, lost intent response, shared SKU races and exact per-buyer invoice/escrow on miljor_test_db, then real buyer/supplier browser journey.

### R3 — Recurring/group delivery coordination and pricing

Files: deliveryEligibilityService.js, procurementDeliveryBindingService.js/policy, existing supplier delivery configuration/rates, order delivery snapshots, delivery routes/UI. A forward route/stop migration may be needed; inspect existing logistics tables before defining it.

- [ ] Independent clustered/individual/pickup/express choices with exact fees; reuse authoritative eligibility. Carry R1 preferences but revalidate each cycle/address/version/window.
- [ ] Route compatibility checks same supplier dispatch, verified stops, overlapping window, product handling and vehicle weight/volume; reserve capacity transactionally. Allocate exact charges with deterministic residual rounding.
- [ ] Lock supplier-confirmed route/mode/cost into buyer consent and order/invoice; changed grouping cannot change a locked price. Buyer sees only own stop.
- [ ] Cluster/route/dispatch/ETA/delay/reminder events; test incompatible route, oversubscription, fee sum, private addresses and changed destination with MySQL/concurrency/browser evidence.

### R4 — Per-line POD, disputes and failed-delivery reattempt

Files: fulfillmentService.js, deliveryQuantityPolicy.js, existing dispute/refund/financial settlement services, invoiceService.js, fulfillment routes and buyer/supplier controls. Inspect merged 100/80/20 work first; never clone it.

- [ ] Record ordered/delivered/accepted/disputed quantities per award line, unit-correct bounded quantities and authorized evidence; preserve append-only attempt history.
- [ ] Allocate accepted/disputed value exactly; held amounts cannot settle/refund twice and unrelated buyers continue.
- [ ] Supplier reports failed attempt with responsibility; buyer approves proposed new slot and explicit extra fee before a reattempt. No new debit or fake delivered state.
- [ ] Proof/partial/dispute/failed/rescheduled notifications and ownership, concurrency, duplicate POD, 100/80/20 per-line ledger/refund identity tests plus browser evidence.

### R5 — Financial/provider acceptance, remaining notifications and reporting

Files: existing Safepay checkout/payment/refund/settlement, invoice services, email outbox workers and configured SMS adapter, notification producers/policy, existing analytics read models/UI; new report policy only when needed for defensible comparable baselines.

- [ ] Display all merchandise/delivery/processing/tax basis/rate/amount/currency before consent and reproduce invoice totals exactly.
- [ ] Genuine Safepay sandbox buyer consent/payment/fulfillment/receipt and provider refund/settlement evidence. Keep external bank execution disabled; missing credentials/provider capability is BLOCKED, not synthetic PASS.
- [ ] Complete reminder/admin/security event matrix, EN/Urdu, mandatory financial/security alerts, scoped deep links, durable retries/failed delivery and configured urgent SMS/email. Reuse inbox/outbox; real delivery channels distinct from mock/acceptance.
- [ ] Savings require a recorded matching spec/quantity/time/cost baseline; otherwise unavailable. Reliability defines on-time denominator and failed/partial/missed/cancelled handling. Test factual source rows and boundaries.

### R6 — Release reconciliation

- [ ] Canonical test-only backup/migrations/history; B6/UCP/security/financial/concurrency and buyer/supplier browser journeys for one-time, collective, recurring, partial/dispute and failed attempts.
- [ ] Complete required event/channel matrix and overlapping PR source reconciliation; record exact tested SHA and all blockers in existing reports/phase log.
- [ ] Merge only if every required critical business/provider gate is PASS on proposed code and authorization remains valid; otherwise keep PR #53 draft. Existing nine green CI workflows certify only the scope they actually exercise.

Review focus across phases: pause straddles cutoff; configuration/address changes after consent; unpaid peer exits before dispatch; concurrent stock/receipt/refund retries; missing or delayed provider events. Each belongs to its owning phase's negative/concurrency gate. Approval to start this sequence is already explicit; no repeated design permission is required. Local phase completion does not authorize silently starting another phase under the project strict stop rule.

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
