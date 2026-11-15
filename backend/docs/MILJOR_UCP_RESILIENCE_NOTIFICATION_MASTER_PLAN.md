# MilJor UCP — Resilience, Delivery, Finance & Notification Coverage Plan
Status: IMPLEMENTATION IN PROGRESS / RELEASE BLOCKED until runtime proof
Scope: Unified Pool (Regular + Flash), shared order/payment/delivery lifecycle, buyer/supplier/admin notifications.
Branch: `plan/ucp-resilience-notification-coverage`. Never deploy sandbox payment assumptions to production.

## Non-negotiable architecture
- One UCP discovery/create surface and shared order, stock, financial, fulfilment primitives; Regular vs Flash only policy differences. Do not collapse B6 RFQ/recurring/collective into the pool entity.
- Buyer-paid funds are not legally escrowed merely because internal ledger says HELD; provider capability/compliance must be confirmed separately.
- Preserve committed SKU versions, agreed charges, order snapshots, transaction history and previous migrations.
- Avoid blind PR merges and migration prefix reuse; readonly migration audit before any DDL.
- No fake test PASS: report source gate, mock API, real MySQL, signed Safepay Sandbox, browser E2E separately.

## Phase gates (each requires evidence, PASS / FAIL / BLOCKED)
0. **Snapshot and gap audit**: main SHA, open PR/diff inventory, manifest/migration history, 15 safeguards, existing source gates, current UI API matrix; protect database with verified backup. Gate: no destructive mutation.
1. **State invariants and inventory**: canonical UCP mode policy, allowed transitions, atomic SQL inventory reservation across Regular/Flash, idempotency keys, immutable SKU/commercial snapshots, tier-price acceptance and consistent expiration decisions. Gate: ≥50 simultaneous last-stock buyers; zero negative stock or double-confirm.
2. **Timers and retry recovery**: server-enforced hold/expiry, recovery sweeper with lease, transactional outbox, bounded retry/backoff/dead-letter, response to browser close/crash, expiry vs payment race. Gate: clock-controlled tests, worker crash/replay.
3. **Notifications (all meaningful committed actions)**: use existing `notificationService` and `emailService`, add event registry, role-based recipient resolver, transactional event outbox, preference/mute controls, critical override, read/unread and per-event delivery receipts, email fallback, template localization, quiet hours/digest for low-severity events, rate limits, 7-day/24-hour retention policies as configured. Gate: every event in catalog mapped to actual transaction boundaries and recipient tests; duplicate webhook yields one notification; no cross-user leakage.
4. **Financial safety**: Safepay signed callbacks AND independent provider reconciliation; uniqueness and refund idempotency; finance conservation ledger; provider fee accounting, refund exception queue; no settlement on supplier-only delivery mark; partial accepted quantity settlement rules; sandbox payouts only if supported. Gate: provider Sandbox E2E, callback replay, timeout, refund and accounting proofs; block on missing provider credentials.
5. **Delivery**: eligibility pre-check (address, SLA, SKU, area), standard/express/pickup, cluster cutoff/geographic grouping, delivery manifest and per-buyer delivery fees, individual receipt and partial quantity claims, re-routing and cancellation cost rules. Gate: multi-buyer clustered browser/API journeys; 100/80/20 partial.
6. **Supplier failure, fraud and support**: failure SLA, admin escalation, replacement only with buyer consent, dispute/refund paths, authorized intervention audit, negative stock and stuck funds monitoring. Gate: breach/compensation/recovery role tests.
7. **Frontend and full release gate**: mobile buyer/supplier/admin UCP UX, accurate timers and progress, notif bell/inbox, notification settings, payment-return recovery, accessibility, error boundaries, no invented order states. Gate: production build + actual browser journeys + DB/API + security + signed Sandbox all pass; only then mark VERIFIED.

## Notification contract
Source of truth = durable domain event emitted in the SAME DB transaction as business mutation; no side effect on rollback. Unique event_id, aggregate_id/version, actor_id, occurred_at, causation_id and schema_version. Outbox dispatcher at-least-once; every channel uses unique (recipient_id, channel, event_id), and store send attempts/status. Notification failures must never undo already committed order/payment operations, but must surface in retry queue and alert admins on critical delivery failure. Never include OTP, access tokens, full addresses, payout account, or sensitive documents in payload/email. Cross-role isolation mandatory.

### Default delivery policy
- All meaningful committed actions -> in-app notification to *affected* party; not every click, page view, keystroke, heartbeat or countdown tick.
- Financial/security/critical disruption -> in-app + transactional email, independent of marketing opt-out.
- Normal order/delivery progress -> in-app; optional email by user preference; make batching available.
- Routine edits -> in-app or digest only where other party is actually affected.
- Timers -> threshold notifications at 24h / 1h / 15m only when applicable, deduplicated per threshold and commitment; no per-second notifications.
- Actor receives confirmation receipt only when useful; never alert unrelated users or broadcast customer IDs to all suppliers.
- Recipient mapping: Buyer (own pool commitments, money, delivery), Supplier (own SKU/pooled demand, payment eligibility, dispatch), Admin (approval, escalation, failures); super-admin for severe financial/security anomalies only.

### Required event coverage
Identity: signup, verification submitted/approved/request-info/rejected, OTP/security sign-in warning, account lock/unlock.
Supplier catalog: SKU submitted/published/rejected/paused, material spec-change request/approval, stock threshold/shortage, service area changes affecting commitments.
UCP: created/published, joined/reserved, hold created/expiring/expired, confirmation required/confirmed, payment hold, payment initiated/succeeded/failed/reconciled, progress milestone (batched), tier achieved, lock, target reached, pool closing/closed, expired/cancelled/failure, Flash availability/expired, stock allocation failure, request-to-pool accepted/rejected.
Financial: invoice issued, refund requested/approved/rejected/initiated/succeeded/failed, dispute hold, settlement eligible/initiated/succeeded/failed, reconciliation exception.
Fulfilment: supplier order assignment/accepted/rejected, packing, ready-for-pickup, pickup code issued/claimed, dispatched, cluster formed/cutoff/re-routed, delivery ETA meaningful change, attempted/failed, delivered-by-supplier, buyer confirmation requested/accepted, partial delivery, shortage/dispute created/responded/resolved, SLA breach.
Support/admin: appeal, verification decision, fraud/security hold, evidence request, manual reconciliation attempt/result, outage/resolution where impacted.

## Release-blocker matrix
- No double-spend / oversell, even when Regular and Flash share SKU.
- No duplicate charges/refunds/payouts; failed callbacks reconciled safely.
- Invalid state transitions denied and audited.
- No premature settlement or hidden loss of disputed quantities.
- All money and charge formulas reconcile to integer minor units.
- All notifications have owner isolation, retries, eventual delivery evidence and non-spam semantics.
- Migration restore/replay proven on isolated database; main data untouched.
- Observe: job backlog, old active pools, stuck holds, pending refunds, negative stock, webhook signature reject rate and notification DLQ.

## Verification artifact requirements
For each sub-phase record code SHA, migration files, MySQL schema + history, command, test timestamp, fixture, assertions, screenshot/log references, PASS/FAIL/BLOCKED, remediation and rollback.
Do NOT assume source-gate PASS means runtime provider PASS.
