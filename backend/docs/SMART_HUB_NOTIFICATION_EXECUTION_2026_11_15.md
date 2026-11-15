# Smart Hub notification execution — 2026-11-15

Result: PARTIAL. Supported paths are implemented and tested below. Entire Smart Procurement Hub and notification event matrix are not release-complete. PR #53 must remain draft.

## Implemented

- Existing platform inbox now has transaction-aware procurement outbox capture, backend preference storage/API, English/Urdu event projections, private entity-only payloads, bounded projection retries and durable email enqueue. Legacy outbox payloads remain untouched by the new projector. Email enqueue failure preserves the independent inbox using a savepoint; channel failure is recorded for retry. Missing email does not hide an in-app entry.
- Existing email worker now uses atomic token leases, bounded retries/backoff, abandoned-attempt recovery and redacted failures. Late completion may persist only while its token remains owned. Ambiguous provider acceptance is reported separately; external delivery remains at-least-once, not guaranteed exactly-once. Generic email links use trusted server configuration; HTML is escaped and Urdu uses RTL.
- Existing header notification center now reads the real inbox for buyers/suppliers/admins, persists read-one/read-all, displays authoritative unread counts, paginates, polls with backoff and cancels stale account requests. Supplier UCP operational alerts remain separate. Mark-as-read argument inversion fixed. Backend locale/optional-channel preferences preserve mandatory financial/security rules.
- Genuine transactional producers cover request create/publish; authorized supplier match; received/revised quote; numeric counteroffer and supplier decisions; price/spec lock at award; order payment pending; group invitations/joins, qualification cutoff/minimum and bid consent; scheduled recurring cycle generation, skip/pause/resume; supported supplier dispatch/delivery/delay/logistics failure and buyer receipt/partial discrepancy; verified payment, dispute opening/resolution, refund obligation initiation and settlement preparation pending. Existing replay branches do not create another business event.
- Forward migrations 091/092/093 add biweekly support, notification/preferences schema and email leases. Historical SQL is unchanged. `.gitattributes` disables line-ending conversion for migration bytes; it must not normalize old CRLF migrations into LF because their journals pin exact historical bytes.
- CI contracts added/expanded for notification services, financial/fulfillment negative cases, frontend inbox, canonical migrations, isolated counteroffers and actual request/inbox acceptance.

## Executed evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Backend notification/email/financial/fulfillment contracts | PASS | 89/89 Node tests; mocked dependencies, actual service methods |
| Transaction connection / event allowlist / role / private-field / enqueue-failure gate | PASS | `notification_transaction_gate.js` |
| Route owner/notification argument regression | PASS | `notification_route_ownership_gate.js` |
| Canonical migration policy | PASS | 12/12; original pinned blobs retained |
| Actual test database history | PASS | VERIFIED_HISTORY, 58 applied / 58 planned |
| Real MySQL request-to-notification | PASS | Actual create/publish/replay, rollback, two concurrent projectors, Urdu, recipient isolation, durable unread/read, email QUEUED only; own fixtures cleaned |
| Existing nine-event persistent inbox verification | PASS | Reworked to create/clean its own users; no deletion of existing users' notifications |
| Real HTTP/MySQL financial/fulfillment path | PASS | G1–G9: unpaid denial, bad signature denial, one synthetic capture, exact payable, no early settlement, supplier milestones, buyer-only receipt, one prepared payout with external execution DISABLED, private notification recipients and no false completion |
| Recurring calendar / request policy | PASS | 20/20 and 16/16 respectively |
| Existing numeric counteroffer policy | PASS | Existing gate |
| Existing UCP source regression | PASS | `npm run test:ucp`, exit 0; source acceptance only |
| Frontend regression / inbox contracts / build | PASS | Existing 24 assertions, focused notification tests, production build; browser acceptance remains separate |
| Genuine provider-originated Safepay / SMS / SMTP delivery | BLOCKED | No provider delivery was executed; synthetic callback is handler evidence only |
| Full buyer/supplier browser acceptance | BLOCKED | Not executed for complete business scope |
| Full event matrix | BLOCKED | Remaining unsupported source transitions listed below |
| Remote exact-head CI | BLOCKED | Must be observed after feature branch push; local results do not substitute for CI |

Commands run from backend include `node --test tests/email_outbox_queue_gate.js tests/notification_projection_gate.js tests/notification_request_action_gate.js tests/fulfillment_notification_hooks.test.js tests/financial_notification_action_gate.js`, the two focused connection/route gates, `node tests/canonical_migration_manifest_gate.js`, `npm run test:ucp`, real request notification gate, nine-event inbox gate and `p0_payment_fulfillment_settlement_http_e2e.js`. Original project configuration was read without displaying credentials; every mutable connection targeted miljor_test_db. Frontend tests/build ran from frontend. Diff whitespace verification passed.

## Database evidence and recovery

Before DDL, a read-only audit verified 53 applied migrations. Test-only backup `database/backups/miljor_test_db_notifications_1794750971853.dump` contains 3,422,218 bytes; SHA256 `79219b5f05344ca9ef90f91654ee1ba43dd11fae31aa6c8d0563136f9a2c0195`. Backup is ignored by Git. Canonical runner applied only pending 055, 090, 091, 092, 093 to miljor_test_db; post-run read-only audit verified 58/58. No journal rewriting, checksum weakening or historical migration editing. No writes to miljor_db or miljor_sandbox_db. No external payout/refund/email dispatch. Real HTTP test retains its synthetic financial fixture as existing test evidence; its newly queued notifications were removed by its own new order ID to prevent later test-message delivery. New notification/inbox test-owned fixtures were cleaned.

The initial apparent migration mismatch was caused by checkout line-ending conversion. Exact repository SQL bytes were restored with Git archive using core.autocrlf=false, then both pinned and actual history gates passed. Recovery must use the test backup and migration journal; do not blindly reapply partially executed DDL. Migration 093 is required before deploying the updated email worker or immediate email API. Background notification projection and provider dispatch are separate explicit settings: NOTIFICATION_WORKER_ENABLED and NOTIFICATION_EMAIL_DELIVERY_ENABLED. Sandbox/test schedulers retain existing startup exclusions.

## Remaining critical scope

SMS adapter/provider acceptance, realtime transport (polling implemented), quote-expiry/cutoff/delivery reminder jobs, quantity modification, group leave/price-tier recalculation, route/cluster creation and ETA/reschedule/POD-upload events, supplier/admin approval/security detectors, and additional authoritative payment initiation/failure events require completion. Refund/settlement completion must remain silent until provider-confirmed source transitions exist. Catalog templates do not prove producer coverage. No fabricated provider-completion events were added.

Broader B6 blockers remain: supplier-approved immutable delivery mode/charge binding, full individually paid group and recurring delivery integration, per-award-line partial/dispute/refund settlement, reattempt consent, reporting reliability, full browser acceptance and genuine sandbox reconciliation. PRs #28/#29 metadata reviewed earlier; no blind merges. Backend dependency installation reported 8 audit vulnerabilities (7 moderate, 1 high); no unrelated dependency upgrades attempted.

Primary changed files: notificationService.js, notificationEventPolicy.js, notificationRoutes.js, emailService.js, schedulerService.js, procurement request/matching/quote/counteroffer/award/collective/recurring services, fulfillmentService.js, safepayCheckoutService.js, disputeService.js, financialSettlementService.js, migrations 091–093, frontend AppShell/RfqPage/notifications API, focused tests and workflow files. See Git changed-file list for exact paths. Commit SHA and remote CI outcome are recorded separately after committing; do not infer release PASS from this report.
