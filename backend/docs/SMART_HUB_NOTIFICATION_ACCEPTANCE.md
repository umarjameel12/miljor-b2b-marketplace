# Mandatory notification implementation and acceptance contract

Goal: every critical Smart Hub business transition produces a reliable, private, localized notification derived from committed backend state. This contract is part of every implementation phase and is a release requirement.

## Existing infrastructure and confirmed gaps

Reuse `src/services/notificationService.js`, authenticated `src/routes/v1/notificationRoutes.js`, `platform_notifications` (migration 049), `procurement_notifications` (048), `src/services/emailService.js` and `transactional_email_outbox` (023). Preserve existing consumers and historical migration checksums. Extend with forward migrations only. Do not introduce a second inbox or parallel event delivery engine. Procurement events must project into the existing platform inbox with a shared event identity, rather than independently notifying twice.

Source inspection confirms platform inbox recipient/event uniqueness and user-scoped reads, procurement retry columns and an email retry processor. This does not establish complete transactional producer coverage. Existing `createNotification` uses the global pool, so atomic capture with business transactions requires explicit connection-aware enqueue integration. Existing event ENUMs cover only subsets of required events. `notificationRoutes.js` calls `markAsRead(notificationId,userId)` while the service signature is `markAsRead(userId,notificationId)`; fix and prove own-versus-other recipient behavior before inbox acceptance. Inspect AppShell's existing alert loader/local read state and wire durable backend unread/read behavior rather than adding another center.

`tests/notification_events_verification.test.js` directly creates nine notifications with fixed user IDs; it is not proof that corresponding business actions enqueue them. Replace broad user-level fixture deletion with run-scoped cleanup and verified fixtures. Extend it with action-driven coverage below. Current event/channel delivery, Urdu, preferences, SMS and realtime completeness are NOT VERIFIED.

## Transaction and delivery contract

- [ ] Capture event identity, aggregate ID/version, event type, occurred-at UTC, safe recipient projection and template version on the same database connection/transaction as the business mutation. Capture failure rolls back the transition; rollback publishes nothing. Provider calls occur only after commit through workers.
- [ ] Use a stable identity from the durable business transition, independent of HTTP retry keys. Deduplicate by event + recipient + channel; two distinct revisions remain distinct. Preserve existing `(recipient,event_key)` uniqueness. Use deterministic reminder keys including cycle/deadline version.
- [ ] Workers claim due deliveries atomically with leases, bounded batches, attempt count, next-attempt timestamp, redacted failure code and final failure state. Test concurrent workers, crash recovery, exponential backoff with jitter, bounded attempts and authorized audited replay. One broken channel cannot suppress another channel.
- [ ] Reuse email queue/processor. Add missing channel attempt metadata to existing infrastructure through forward migrations. SMS runs only with a configured provider, verified destination and an approved urgent-event mapping. No configured provider means visible UNAVAILABLE/BLOCKED status; never simulated SENT. Provider throttling and temporary failure retry; permanent invalid destinations terminate with an actionable reason.
- [ ] Delivery attempts are at-least-once. Use provider idempotency keys where supported and reconcile ambiguous timeouts; do not promise exactly-once external delivery when a provider cannot guarantee it. An inbox entry is inserted once; queueing, provider acceptance, delivered confirmation and failure remain distinct.
- [ ] Persist safe, versioned English/Urdu templates and locale choice with English fallback; escape interpolation/HTML, support Urdu RTL, exact quantities/currency and Asia/Karachi times. Validate all required placeholders. Do not embed credentials, payment tokens, raw provider bodies or another buyer's personal/financial data.
- [ ] Authenticated identity and persisted relationships determine recipients/roles; never accept caller-selected recipients. Resolve group member and supplier scope from verified backend state. Security details go only to explicitly authorized security administrators. Revalidate authorization when following deep links or subscribing to updates.
- [ ] All critical events produce in-app entries. Important events use email according to the matrix; noncritical preferences may suppress optional email/SMS, never mandatory financial/security alerts. Preferences are user-owned and auditable. Invalid/missing contact information records channel failure without losing in-app visibility.
- [ ] Reuse the existing notification center and API for unread count, paginated history, read-one/read-all and safe relative deep links. Reject external/script links. Read mutations are recipient-scoped and idempotent. Clear cached data on logout/account switch. Realtime is an optimization only; authenticated polling with a cursor, bounded backoff and reconnect catch-up provides reliable fallback. Never generate optimistic success alerts.

## Required event and recipient/channel matrix

I = durable in-app for every row. E = important email; U = urgent SMS only when configured. O = optional email controlled by preferences. Financial/security E alerts are mandatory regardless of preferences. Each named event in a row is a separate test case. Business owners must explicitly approve any urgency expansion; all other events default to no SMS.

| Phase | Events | Authorized recipients | Channels / truth condition |
| --- | --- | --- | --- |
| N2 | Request created; published | Request owner; invited/matched suppliers only after publication | I/O created; I/E published; durable draft versus published state explicit |
| N2 | Supplier matched | Request owner and individually matched verified supplier | I/O; persisted eligible match, safe request fields only |
| N2 | Quote received; revised quote | Owning buyer; submitting supplier acknowledgment | I/E; committed quote/version |
| N2 | Counteroffer submitted; supplier Accept; Reject; Counter Again | Negotiating buyer and relevant supplier only | I/E; decision/version committed; acceptance is not buyer approval/payment |
| N2 | Quote expiry; final price/specification lock | Affected buyer and quote supplier | I/E; locked deadline check or immutable accepted snapshot |
| N3 | Invitation; buyer joined; buyer left | Invitee for invitation; actor and authorized organizer/affected supplier for membership | I/E invitation, I/O membership; private individual quantities/prices excluded from organizer notice |
| N3 | Minimum quantity reached; group cutoff; price-tier change | Affected members and relevant supplier/coordinator | I/E; committed threshold/deadline/tier transition, no silent reprice |
| N3 | Individual consent required; payment pending; payment failed | Individual buyer; supplier receives only permitted own-order status | I/E; payment alerts mandatory, urgent cutoff U when configured |
| N4 | Cycle generated; upcoming cutoff; quantity modification | Cycle owner; supplier only when linked/authorized | I/O generation; I/E cutoff/modification; versioned committed cycle |
| N4 | Skip; Pause; Resume | Contract owner; supplier only for affected confirmed operational commitments | I/E; future schedule state distinguished from locked orders |
| N4 | Payment approval required; next delivery reminder; missed cycle | Individual cycle buyer; assigned supplier for delivery/missed obligation | I/E; payment mandatory; imminent approved delivery reminder U; no auto-debit |
| N5 | Cluster created; route assigned; dispatch scheduled | Assigned supplier/dispatcher; each participating buyer gets own stop only | I/E; approved operational assignment |
| N5 | Out for delivery; ETA changes; delay | Affected buyer and assigned supplier/dispatcher | I/E/U; confirmed dispatch or recorded ETA update, never fabricated location |
| N6 | Delivered; partial delivery; proof uploaded | Own-order buyer and responsible supplier | I/E; distinguish supplier claim, uploaded evidence and buyer receipt |
| N6 | Failed attempt; rescheduling | Affected buyer and assigned supplier/dispatcher | I/E/U; failed attempt evidence; proposed slot/fee versus consented slot/fee |
| N7 | Payment initiated; verified; failed | Paying buyer; supplier only its relevant paid/failed order status | I/E mandatory; verified only from trusted backend financial transition |
| N7 | Refund initiated; completed | Entitled buyer; scoped supplier/admin if involved | I/E mandatory; obligation versus confirmed provider completion distinct |
| N7 | Dispute opened; resolved | Affected buyer, supplier and assigned dispute administrators | I/E mandatory; safe individual claim projection |
| N7 | Supplier settlement pending; completed | Entitled supplier and authorized finance administrators | I/E mandatory; internal preparation never external completion |
| N1–N8 | Supplier verification; approvals; rejections | Affected supplier/applicant and authorized reviewing administrators | I/E; committed decision, private review evidence excluded |
| N1–N8 | Suspicious activity; critical financial inconsistencies | Authorized security/finance administrators; affected account receives safe account-specific alert when appropriate | I/E mandatory, U urgent when configured; verified detector/reconciliation result, no raw secret/ledger dump |

## Acceptance test implementation tasks

Extend existing `tests/notification_events_verification.test.js`; add focused outbox/channel tests alongside existing backend tests and buyer/supplier browser scenarios alongside the established browser harness. Test filenames for new suites should follow existing harness conventions. Extend CI to run all affected gates on the exact proposed head. All mutable fixtures must first assert `SELECT DATABASE()` equals `miljor_test_db`; cleanup only records created by that run. Do not dispatch test alerts to real users or use live payment/provider accounts.

- [ ] For **every named event above**, execute its genuine backend action, assert committed aggregate/version and expected recipient IDs/roles, rendered English/Urdu content and placeholders, channels, safe payload and authorized deep link. Assert zero unrelated recipient rows and zero notification on denied/failed/rolled-back actions. Record per-event results rather than one aggregate success label.
- [ ] Replay the same action with same and different HTTP intent keys, redeliver the domain event and run two workers simultaneously: one inbox record per event/recipient, one logical channel intent, preserved distinct legitimate revisions. Inject failure before/after commit and before/after provider acceptance; verify restart recovery and ambiguous delivery reconciliation.
- [ ] Inject email/SMS timeout, 429, transient 5xx, invalid destination, unavailable provider and exhausted retry budget. Assert attempt/backoff/terminal state, independently successful other channels, no false delivered status and authorized manual replay without duplicate logical intent.
- [ ] Exercise read-one with mismatched notification/user IDs (including numerically colliding IDs), unauthenticated requests, other-user read/list/count/preferences and reconnect subscriptions. Assert no foreign mutation or data disclosure. Verify read/unread survives refresh and account switching; realtime disabled/disconnected polling catches every committed entry without duplicates.
- [ ] Disable all optional preferences: noncritical channels suppress correctly while mandatory financial/security entries and email remain required. Test missing contacts as explicit channel failures. Verify Urdu RTL, fallback locale, HTML injection, unsafe links and expired authorization after membership removal.
- [ ] Verify reminder cutoff/expiry races against a changed quote, skipped/paused cycle, cancellation and reschedule. Each reminder must reflect the current state/version; already-committed historical notices remain historical and cannot be rewritten as success.
- [ ] Run sandbox payment-to-receipt-to-settlement E2E and partial/disputed receipt scenarios. No forged callback, supplier delivery claim, pending refund or prepared payout may yield a payment/refund/settlement completed notification. Existing B6 gates and UCP regressions remain mandatory.

## Independent reporting and merge gate

| Gate | Current result | Evidence / condition |
| --- | --- | --- |
| Plan coverage | PASS | Required events, recipients, channels and all eight phases mapped in this contract |
| Existing infrastructure inspection | PASS | Source/schema paths above inspected; this is not runtime acceptance |
| Event producers and recipient/privacy integration | BLOCKED | Complete action-driven matrix not implemented/executed |
| Atomic outbox / concurrency / retries | BLOCKED | Current transactional producer coverage and channel recovery not verified |
| Inbox, authorization, preferences, EN/Urdu, realtime/polling | BLOCKED | Integration/browser coverage outstanding; known mark-as-read mismatch requires fix |
| Email and urgent configured SMS | BLOCKED | Provider/channel acceptance and failure tests outstanding |
| Sandbox financial notification truth | BLOCKED | Isolated DB credentials and end-to-end sandbox evidence outstanding |

Execution reports must use PASS, FAIL or BLOCKED independently for each phase's business gate, notification gate and channel. FAIL means an executed assertion failed; BLOCKED means required implementation/configuration/evidence is missing. Provider-unconfigured SMS must be reported explicitly; the conditional SMS requirement does not justify fabricating success. Main merge remains blocked until all required integration tests pass; keep PR #53 draft while these gates are outstanding.
