# R1 recurring controls — 2026-11-16

TASK: Begin the authorized remaining-work plan in SMART_HUB_IMPLEMENTATION_PLAN.md (R1–R6). This phase implements owner-controlled future cycle inputs, status reconciliation and recurring notifications; it does not certify collective payments, route capacity, per-line settlement or provider completion.

## Impact and implementation

| Component | Change | Risk / preserved rule |
| --- | --- | --- |
| Existing recurring service | Append-only per-cycle input revisions, expected revision and durable intent replay; scheduled item snapshots | High: exact packaging, own buyer, post-lock cutoff and no automatic order/payment |
| Pause/resume/cancel | Reconcile only SCHEDULED proposal versions; missed paused cutoff becomes SKIPPED with durable reason/event | High: never change generated/paid history or biweekly origin |
| Recurring worker | Bounded 24-hour reminders under existing two opt-in runtime gates; terminal preparation failure notifies owner | High: contract-before-cycle locks, idempotent outbox, paused/skipped suppression |
| Notification/email workers | Revalidate reminder at inbox projection and just before email transport | High: stale alerts become terminal FAILED with STALE_REMINDER_SUPPRESSED, never fabricated delivery; no new queue/schema |
| Existing hub | Quantity/preference review, save, reload and skip controls; backend-confirmed state | Medium: preference is not supplier mode/fee consent or stock reservation |

Items scheduled now are frozen into the existing contract_snapshot. A cycle's CYCLE_INPUTS_UPDATED event carries its own full items, requested delivery preference, revision and original request hash. Historical events are not overwritten. Existing pre-change cycles without an item snapshot retain their legacy template fallback until first revision; this legacy limitation is explicit and does not invent an old snapshot. Changing an occurrence never changes the standing template. Individual/collection-point modes and supplier pickup points are not invented before their R3 contract exists.

Delivery preferences accept existing STANDARD_CLUSTERED, EXPRESS or PICKUP only. Doorstep address must be the buyer's verified saved address in an active cluster, with server-recorded address revision. Every generated draft still requires fresh supplier/destination/stock/delivery-fee checks and explicit buyer commercial/payment approval through existing B6 gates. A preference alone has no financial or delivery approval authority.

Pause/resume are status-only contract revisions: only uncommitted scheduled proposals advance to the new version. On resume, cutoffs missed while paused are recorded missed/skipped without automatic catch-up. Generated/paid proposals remain historical records. New cutoff reminders are not enqueued for paused/skipped/stale versions. Pending reminder projection and queued email revalidate backend state; a message already handed to a provider cannot be recalled. Terminal suppression uses the existing failed/dead-letter convention with an explicit reason, rather than claiming successful dispatch.

## Verification evidence (local)

- `cd backend; node --test tests/recurring_cycle_inputs_policy_gate.js tests/notification_projection_gate.js tests/notification_request_action_gate.js tests/email_outbox_queue_gate.js tests/fulfillment_notification_hooks.test.js tests/financial_notification_action_gate.js`: **96/96 PASS**, exit 0. Includes exact/discrete quantities, field injection, EN/Urdu projection catalog, stale reminder inbox/email suppression, preference/financial rules, delivery ownership, duplicate/retry and rollback contracts.
- `cd backend; node tests/b6_recurring_worker_gate.js`: **9/9 PASS**. Terminal failure targets only its buyer; no order/payment; bounded worker/replay unchanged.
- `cd backend; node tests/canonical_migration_manifest_gate.js`: **12/12 PASS**. No migration added or historical SQL modified.
- `cd backend; node tests/recurring_cycle_controls_mysql_gate.js` with NODE_ENV=test, DB_NAME=TEST_DB_NAME=miljor_test_db, MILJOR_TEST_ONLY_MIGRATIONS=1, ALLOW_EXTERNAL_MONEY_MOVEMENT=false, TRANSACTIONAL_EMAIL_MODE=mock: **15/15 PASS**, exit 0. Owned fixtures only; candidate scans explicitly scoped to the owned test contract. Tests concurrent same intent and preparation, stale revision, cross-buyer/foreign-address denial, fractional packs, transactional outbox failure, pause/resume, missed cutoff, immutable items, real reminder suppression, skip replay and zero new orders/payments.
- The first real concurrent test reproduced a duplicate intent row: a consistent read established before waiting on the contract lock returned stale event state under REPEATABLE READ. Changed mutation/preparation event reads to locking current reads under contract/cycle serialization; targeted rerun passed. One reminder fixture assumed tomorrow exceeded 24 hours; made its exact timestamp independent of current clock. Assertions retained.
- `cd frontend; npm run build`: **PASS**, 2,232 modules, exit 0 before latest-main reconciliation. CI will verify actual merge state; no full runtime acceptance is inferred from build.
- Read-only migration audit: **VERIFIED_HISTORY 59/59**. No DDL applied. Credentials read from original project .env without printing/copying them.
- Protected read-only counts: miljor_db orders=0/payments=0; miljor_sandbox_db orders=0/payments=0. All mutable tests addressed miljor_test_db; remaining owned recurring fixture users=0.

## Event and channel acceptance

| Event / channel | Local result | Evidence / limit |
| --- | --- | --- |
| Cycle generated, pause/resume, skipped | PASS | Real recurring actions and deduplicated scoped outbox |
| Quantity modification | PASS | Own cycle revision, concurrent replay and rollback |
| Delivery preference modification / draft ready | IMPLEMENTED; draft ready PASS | Existing projection catalog, generated-draft event; browser preference mutation pending |
| Upcoming cutoff / missed cycle | PASS | Concurrent reminder producer, paused suppression, missed cutoff, terminal retry contract |
| In-app / email queue policy | PASS | Real outbox state plus projection/email retry/suppression contracts; actual provider delivery not claimed |
| Genuine email / urgent SMS / provider-origin financial completion | BLOCKED / NOT_TESTED | No live provider execution in this phase; remains R5 acceptance |
| Full recurring order/payment/delivery/settlement / routes/capacity | DEFERRED to owning phases | Proposal control is not payable recurring delivery certification |

## Files and source reconciliation

Backend: procurementRecurringService.js, procurementRecurringCyclePolicy.js, recurringReminderPolicy.js, notificationEventPolicy.js, notificationService.js, emailService.js, schedulerService.js, procurementController.js, procurementRoutes.js; recurring_cycle_inputs_policy_gate.js, recurring_cycle_controls_mysql_gate.js, b6_recurring_worker_gate.js, notification_projection_gate.js, email_outbox_queue_gate.js, p0_browser_fixture_seed.js, p0_real_browser_journey.js.
Frontend: components/procurement/RecurringCycleControls.jsx and pages/RfqPage.jsx. Existing visual design preserved.
CI: smart-hub-notifications.yml and p0-payment-fulfillment-settlement-e2e.yml. Docs: implementation plan, this report, MILJOR_PHASE_LOG.md.

Baseline approved feature HEAD 08a9d87809a1c3683074500d20f6a14fb5c41781 matched remote before edits. Fetch before final gate found newer main 9fb07cf9274509c1686b68b5bf8bdd91bd26718f (public landing/authenticated home/auth footer work), with no overlap in recurring files. Reconciliation and exact code SHA/remote browser evidence recorded below when observed; original project local work remains untouched.

Skills: using-superpowers, brainstorming (existing approved specification/reuse decisions), writing-plans (R1–R6 sequence), executing-plans (bounded inline implementation), using-git-worktrees (existing separate checkout retained), test-driven-development (pure input policy regression), systematic-debugging (actual concurrency/fixture errors), verification-before-completion (fresh evidence). Project data safety/consolidated test protocol took precedence over generic skill defaults. One read-only focused independent review requested while documentation/source reconciliation proceeds.

RESULT: local R1 controls PASS within described evidence; real browser/exact-head CI pending. Complete Hub PARTIAL. No main merge. CAN START NEXT PHASE: NO.

## Review and source reconciliation follow-up

Implementation commit `e4d92bd` followed by clean merge `b6926a541e41fd32f609d9a349b6f65c427b070b` brings main `9fb07cf9274509c1686b68b5bf8bdd91bd26718f` into the approved feature branch without conflicts. Post-merge frontend build PASS, 2,233 modules. No original working-project files changed.

Independent read-only review found three concrete issues, all corrected: eligibility now filters reminder candidates before LIMIT to prevent starvation; reminder email keeps shared lifecycle locks through dispatch recording so pause/skip commits first and suppresses, or waits for an already in-flight send; preparation replay reads its saved REQUEST_DRAFT_CREATED preference. No locks span ordinary non-reminder email delivery. Tradeoff: reminder pause/skip may wait for the existing bounded transport attempt; a provider-accepted message cannot be recalled.

Targeted real-MySQL gate after these corrections: **17/17 PASS**, including ineligible candidate exclusion, actual InnoDB skip-vs-controlled-mock-dispatch serialization and identical preference on concurrent preparation replay. No real provider invoked. Final affected 96-contract and 9-worker rerun PASS. Existing 15-check result above is superseded by 17 checks, not added to it. Reviewer made no source or DB changes. Applied receiving-code-review to verify findings before correction. Exact corrected-code CI/browser result pending push.

Acceptance completion: added positive own-verified-address preference event (server address revision, fresh-quote flag) and reminder enqueue-failure rollback/retry identity checks. Final local real MySQL gate **19/19 PASS**; this supersedes 17/17. CYCLE_DELIVERY_PREFERENCE_UPDATED now has actual action/outbox evidence, not only a template. Runtime correction SHA `cecae6b7c70fbad7a28f4f25a53efc35bee4f261`. Implementation at prior merge head b6926a5 had all nine CI workflows PASS including real Chromium; final corrected head still requires its own CI evidence.

Final no-op acceptance: saving already-current quantities/preference records a replayable INPUTS_CONFIRMED intent without incrementing the input revision or fabricating a changed notification. UI reports already-current state. Real MySQL gate now **20/20 PASS**, superseding the earlier count. No other business phase started.
