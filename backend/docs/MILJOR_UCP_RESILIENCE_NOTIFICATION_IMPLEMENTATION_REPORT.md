# UCP resilience and transactional notifications — implementation evidence

Date: 2026-11-15 (Asia/Karachi). PR: #54. Branch: `plan/ucp-resilience-notification-coverage`.
Implementation commit: `188c989f09f974bc24cfa2a491508c063d3c5677`.
CI-qualified source/test commit: `62fd793a1d46cd2baf789ea35165b9976aec55a7`.
Starting approved branch SHA: `fb9cbc037bc40cbf7218e3a69617098ba278e8d5`.

**RESULT: PARTIAL. This implementation increment passed its affected gate; the complete master-plan release remains BLOCKED.**
The event catalog is not a claim that every catalog event is connected to a domain transaction.

## Implemented and tested

- Existing UCP transactional writer now queues critical emails through the existing `emailService` outbox on the domain transaction. No provider call occurs inside the transaction. Existing inbox/API and recipient/event unique keys remain the delivery surfaces.
- Persisted order ownership resolves buyer/supplier recipients. Generic receipts omit addresses, contact details, provider tokens and payout information. Reservation and Flash pool recipients are resolved from their own stored commitments; batches over 100 recipients are split without broad supplier broadcasts.
- Connected Regular reservation creation, quantity changes, cancellation, target/tier changes, qualification and commercial decisions; Regular order creation; Flash draft/publication/cancellation/expiry, hold creation/expiry; verified payment confirmation from webhook/reconciliation; fulfillment progression, buyer receipt, buyer shortage/discrepancy; dispute creation/response/closure; refund assessment/approval. These are connections at the existing transaction boundaries, not a replacement order/stock/finance engine.
- Webhook and reconciliation payment receipts share one event identity. Event identities hash structured inputs, avoid delimiter ambiguity and remain within database key limits.
- Email retries claim by attempt-count compare-and-swap plus a lease timestamp. Abandoned final claims become visible terminal failures after lease expiry. SMTP timeouts are bounded; unconfigured non-test transport cannot pretend to deliver. Email dispatch remains opt-in with `UCP_NOTIFICATION_EMAIL_WORKER_ENABLED=true` after transport acceptance.
- Flash scheduler delegates to existing atomic inventory/expiry methods with a database-scoped lease and persisted fair cursor. Internal expiry can run for a suspended supplier while supplier-facing actions still enforce verification. Unsettled held/paid stock remains allocated.
- Aged `INITIATED` provider attempts cannot be treated as failed merely because 15 minutes elapsed. Their stock/order remain pending authoritative reconciliation.
- The 50-buyer gate exposed connection-pool starvation: a transaction held the Flash parent lock while fee lookup requested another pooled connection. `feeService.calculateBuyerFee` now accepts the caller connection; Regular and Flash order creation pass it. Existing callers and exact-money response shape remain compatible.
- Added optional `DB_PORT` support to the application pool and disposable bootstrap/migration runner, enabling independent test instances without rewriting any shared schema.

## Actual final affected gate

Command, from `backend/`: `node tests/ucp_final_affected_gate.js`.
Environment: `NODE_ENV=test`, `DB_NAME=miljor_test_db`, `TEST_DB_NAME=miljor_test_db`, `MILJOR_TEST_ONLY_MIGRATIONS=1`, `DB_HOST=127.0.0.1`, `DB_PORT=33317`, `DB_USER=root`, empty isolated-test password, test-only JWT secret, mock email, `SAFEPAY_ENV=sandbox`, `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`.
Each financial child receives its own hard-coded synthetic test webhook secret. No real merchant credentials are used in this gate.

| Gate / actual command | Result | Exit | Duration |
|---|---|---:|---:|
| `node database/readOnlyMigrationAudit.js --test-only` | PASS, exact installed checksum journal | 0 | 679 ms |
| `npm run test:ucp` | PASS, existing source contracts and new behavioral gates | 0 | 6,882 ms |
| `node tests/ucp_notification_mysql_gate.js` | PASS, real InnoDB ownership, dedupe, rollback, no fabricated payment | 0 | 771 ms |
| `node tests/part5_flash_pool_gate.js` | PASS, 47/47 reported checks | 0 | 4,846 ms |
| `node tests/p0_payment_fulfillment_settlement_http_e2e.js` | PASS, real HTTP/MySQL with synthetic signed callback | 0 | 2,384 ms |
| `node tests/sandbox_payment_refund_stress_gate.js` | PASS, synthetic callback/refund concurrency | 0 | 2,668 ms |
| `node tests/p0_same_sku_publication_stress_gate.js` | PASS, real mixed Regular/Flash publication races | 0 | 14,610 ms |

Recorded results and sanitized log excerpts: [`evidence/ucp-resilience-2026-11-15.json`](evidence/ucp-resilience-2026-11-15.json). Full local logs remain under ignored `backend/logs/ucp-affected-gate/`.

Specific observed outcomes:
- Fifty distinct simultaneous Flash buyers: two successful four-unit holds, 48 stock conflicts; remaining/held/committed = `2 / 8 / 0`. No oversell or negative stock.
- Shared-SKU publication waves included 50 clients (40 successes, 10 rejections, allocated 200 of 200) and 100 clients (66 successes, 34 rejections, allocated 198 of 200).
- Synthetic payment stress: 30 concurrent signed callbacks yielded one payment/event/invoice; 50 retries did not duplicate money; 20 identical concurrent refund requests yielded one obligation. Payout preparation before buyer receipt was rejected; external execution stayed DISABLED.
- Standard, Pickup and Express Flash fees/address ownership and immutable snapshots passed the API/MySQL gate.
- Notification SQL test inserted isolated fixtures in one transaction, replayed the event, verified exactly two owner inbox rows and two queued emails, verified unrelated buyer isolation, then rolled back fixtures and both channels completely.
- Additional `node tests/demo_delivery_quantity_policy_gate.js`: 14/14 pure deterministic checks, including 100 ordered / 80 received / 20 short. This is not a partial-delivery browser or provider-settlement acceptance result.

The initial consolidated stock gate timed out after 180,044 ms. Its failure logs were retained; the fee connection root cause was fixed, the failed Flash gate passed in a targeted rerun, and the complete affected gate above then passed after stabilization. No assertions or buyer concurrency were reduced.

## Review and source reconciliation

One independent read-only reviewer found three P2 issues: recovery starvation by low IDs, expiry blocked by supplier suspension, and a final email claim stranded after crash. Each was reproduced by a failing test; `ucp_recovery_review_gate.js` then passed all three cases after the fixes. The fee-pool issue was independently reproduced by `ucp_fee_connection_gate.js` and the real 50-buyer gate.

The approved remote branch was refreshed before the stabilized gate and remained at the starting SHA. `origin/feature/package-e` is reachable from this branch. Recorded B0.2/B1 commits `d2dc72058aae49e81465da41564314668f6fc070`, `8dbcf8a9822ed8a3fa5ed24a8b8b3b54c619f5bc`, and `986b2737a22475da397bcbdab19319abb9ebb466` were checked with `git merge-base --is-ancestor`; all returned 0. Actual source still contains the Safepay-only provider guard, authorization-before-invoice generation/row locking, and paid subscription grant/payment guards. Historical accepted reports and their test outcomes were not edited or re-labelled as newly executed.

Source synchronization is ancestry/reachability plus preservation of the existing original files, not a claim of whole-tree byte equivalence with an older B-phase. The original Smart Hub checkout was not edited/reset/switched by this task. Its initially uncommitted work was preserved while this separate worktree was created; it independently became clean during the session.

## Database and migration evidence

- Existing MySQL instance remains on port 3306. Its shared `miljor_test_db` contains migration `090_smart_procurement_product_counteroffers.sql`, absent from this PR branch. Its release-history audit remains BLOCKED; no missing migration was copied, reset or applied there.
- Windows CRLF checkout bytes initially disagreed with historical LF checksums. All recorded rows matched after restoring original LF bytes. Git blob comparison confirmed historical migration content unchanged; `.gitattributes` now preserves SQL LF. No journal checksum was rewritten or verification relaxed.
- A separate MySQL 8.0.45 instance was initialized under ignored `backend/database/backups/ucp-isolated-mysql`, bound to localhost port 33317, with only a synthetic `miljor_test_db`. Disposable bootstrap succeeded; 56 canonical migrations, including new 092 and 093, installed successfully. Exact journal audit then passed. The instance was shut down after testing; its files remain available locally for diagnosis.
- New 092 widens notification event names to `VARCHAR(64)`, preserving historical values. New 093 stores only recovery cursor metadata. Neither migration was applied to `miljor_db`, the shared test schema, or `miljor_sandbox_db`.
- Before testing, a complete shared-test backup was saved locally: 3,443,236 bytes, 101 base-table definitions; SHA-256 `9d875f87a00ac0c8d8f76e9bd4109a774d1ec74d3f68c1135b4ed4a9ce590bca`. Backup creation/completeness was checked; **backup restoration/replay was NOT_TESTED**. No database dump is committed.
- Protected `miljor_db` checksums for `users`, `pools`, `reservations`, `orders`, `payments`, `platform_ledger` matched before/after all work. See [`evidence/ucp-protected-database-2026-11-15.json`](evidence/ucp-protected-database-2026-11-15.json). This is six explicit table checks, not an invented whole-database verification count.
- No live financial transaction, outbound provider test payment, refund or payout occurred. Sandbox keys are configured in the original environment, but key presence is not provider payment proof.

## Master-plan status and remaining acceptance

### CI follow-up at evidence commit `80d0ca1`

GitHub Actions independently passed the production frontend build, real Chromium buyer/supplier auth/retry/offline journey, P0 payment/fulfillment/settlement workflow, Buyer B6 Auth, Admin Supplier Approval, and Branded OTP Email workflow. These are the named CI journeys, not full master-plan browser/provider acceptance.

Two CI failures were investigated from actual job logs:
- Demo delivery's in-memory VM adapter rejected the newly added notification dependency. Its allowlist now records the notification boundary, checks the same connection and pre-commit ordering, and includes a notification-storage failure rollback test. Targeted local results: fulfillment 5/5, dispute/refund 11/11, B6 fulfillment/invoice source 9/9, B6 paid fulfillment 4/4, invoice exactness 3/3; all exit 0. Production notification behavior was not disabled to satisfy the adapter.
- Canonical MySQL's clean historical B6 fixture saw six rice variants instead of five because this increment had inserted an extra Flash acceptance invocation before the historical suite. The existing later Flash acceptance already runs the strengthened 50-buyer test. The duplicate early invocation was removed, preserving the strict five-variant assertion and the existing later Flash gate. No business data or migration was rewritten to force that test through. The corrected run at `62fd793` passed.

### Final observed GitHub Actions results at `62fd793`

All six workflows completed successfully: [canonical UCP](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43725438891), [P0 payment/fulfillment/settlement](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43725438825), [demo delivery](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43725439046), [buyer auth/frontend](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43725438818), [admin approval](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43725438838), [OTP quality](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43725438952).

The canonical workflow's production build, disposable MySQL and real Chromium jobs all passed. Its actual SQL/API checks include B4/B5/B6 regression, migration second-run idempotency, shared-SKU concurrency, paid supplier delivery to 100/80/20 buyer dispute/refund hold/invoice, B6 paid fulfillment/invoice, and admin denial/audit. This upgrades those named checks from pending to observed PASS, while provider settlement and the remaining master-plan features remain unverified/incomplete. Machine-readable snapshot: [`evidence/ucp-ci-2026-11-15.json`](evidence/ucp-ci-2026-11-15.json).

The final evidence-only commit records these results without changing application code, tests or workflows. Its CI-skip marker avoids another full build/regression solely to record already-observed evidence; the tested source/test commit above is the verification identity.

| Master-plan area | Current status / remaining work |
|---|---|
| 0 Snapshot/gap audit | PARTIAL: source/history/backup/protected checks recorded; shared migration090 integration and restore/replay remain unresolved. |
| 1 State/inventory | PARTIAL: shared inventory and 50-buyer/100-publication races passed; not a certification of every state/acceptance path. |
| 2 Timers/recovery | PARTIAL: Flash lease/cursor/expiry hardened; Regular automated closure remains contained; all timer thresholds and crash/restart journeys are not implemented/proven. |
| 3 Notifications | PARTIAL: connected paths listed above; remaining catalog/identity/admin actions, full recipient matrix, normal-email preferences, localization, quiet hours/digests, retention/rate controls, missing-address escalation and admin delivery-failure alerts remain unfinished. Terminal email failures are persisted, not a complete support/DLQ console. |
| 4 Finance | PARTIAL: synthetic HTTP/SQL conservation/idempotency passed. Actual independently verified Safepay sandbox checkout/reconciliation/refund and provider fee evidence remain NOT_TESTED. External payouts remain DISABLED. |
| 5 Delivery | PARTIAL: Standard/Pickup/Express API/snapshots and CI SQL/API 100/80/20 dispute/refund-hold/invoice passed; geographic cluster cutoff/manifests/re-routing and full partial delivery provider-settlement/browser acceptance remain incomplete. |
| 6 Supplier failure/admin | NOT_COMPLETE: automatic failure SLA, buyer-consented replacement, support/escalation and authorized recovery matrix remain unfinished. |
| 7 Frontend/release | PARTIAL: no UI changes; production build and named real Chromium buyer/supplier auth/retry/offline journeys passed in CI at `62fd793`. Inbox/settings/payment-return full master-plan acceptance remains pending. |

Do not deploy this increment into the shared schema until migration history and remaining release requirements are reconciled. Worker rollout must follow migrations and accepted email transport configuration. Rollback should disable the new worker and revert application changes while preserving inbox/outbox/history; do not narrow the event column after new event values exist or delete commercial evidence.

## Changed files

`.gitattributes`; `.github/workflows/ucp-canonical-acceptance.yml`; `backend/package.json`; `backend/src/config/db.js`; `backend/database/bootstrapDisposableMigrationTest.js`; `backend/database/runMigrations.js`; migrations `092_ucp_notification_event_types.sql`, `093_ucp_recovery_cursor.sql`.

Services under `backend/src/services/`: `ucpTransactionalNotifications.js`, `ucpNotificationEventCatalog.js`, `ucpRecoveryService.js`, `reservationEventService.js`, `orderService.js`, `flashPoolService.js`, `safepayCheckoutService.js`, `fulfillmentService.js`, `disputeService.js`, `financialSettlementService.js`, `emailService.js`, `feeService.js`, `schedulerService.js`.

Tests under `backend/tests/`: `part5_flash_pool_gate.js`, `ucp_notification_catalog_gate.js`, `ucp_domain_notifications_gate.js`, `ucp_email_claim_gate.js`, `ucp_fee_connection_gate.js`, `ucp_final_affected_gate.js`, `ucp_flash_recovery_gate.js`, `ucp_notification_mysql_gate.js`, `ucp_payment_expiry_race_gate.js`, `ucp_recovery_review_gate.js`, `ucp_runtime_preflight.js`, `demo_fulfillment_discrepancy_service_gate.js`, `demo_dispute_refund_safety_gate.js`. The demo delivery workflow's case label was updated to five.

Documentation: this report, `MILJOR_PHASE_LOG.md`, `evidence/ucp-resilience-2026-11-15.json`, `evidence/ucp-protected-database-2026-11-15.json`, `evidence/ucp-ci-2026-11-15.json`.

Skills applied: `using-superpowers` (instruction selection), `using-git-worktrees` (isolated native checkout), `executing-plans` (existing approved plan), `test-driven-development` (failure reproduction), `systematic-debugging` (line endings, payment expiry, pool starvation), `verification-before-completion` (actual gates/checksums), `requesting-code-review` (one independent review), `receiving-code-review` (three verified corrections). Project consolidated testing and database safety rules took precedence over generic skill suggestions.

CAN START NEXT PHASE: NO

## 2026-11-16 — approved integration and remaining-work increment

TASK: Resume PR #54 on `plan/ucp-resilience-notification-coverage`. User explicitly approved integration of committed Smart Hub notification/email work. Integration parent: `08a9d87809a1c3683074500d20f6a14fb5c41781`; UCP starting HEAD: `7df58aaccec63645c7fbdaf8bcc23db26d0402d7`. Worker WIP is preserved in stash `33322b2cffe91286d12e13189e3f4041c51f54c9`. No main merge, force push, or original database migration was performed.

IMPLEMENTED: Canonical UCP domain events now feed the existing transactional event outbox/projector instead of duplicating inbox/email engines. Added persisted preferences, English/Urdu projections, routine mute, quiet hours, digest grouping, optional hourly budgets, visibility retention, mandatory overrides, locale snapshots, generic critical-failure alerts, private operations health, reason-bearing audited EVENT/EMAIL retries, and role-aware inbox/settings/operations UI. Expanded actual identity/verification/security, catalog moderation/publication/archive, profile/service-area, invoice and supplier-preparation hooks. A refund obligation receipt says requested, not that a provider refund was executed.

Regular recovery now uses parent locks, fresh SQL clocks, a bounded database lease/fair cursor, authoritative supplier/buyer deadline expiration, 24h/1h/15m reminders when applicable, payment-hold reminders, SLA escalation, audited admin recovery, replacement proposals and immutable owning-buyer consent. Replacement is not executed without fresh re-contracting. Both INITIATED and RECONCILIATION_REQUIRED attempts protect inventory regardless of age or tracker availability. Checkout reserves a durable unresolved attempt before provider traffic, serializes different keys under the order lock, makes no provider request under SQL locks, preserves PAID, and permits independent reconciliation of tracker-bearing unknown outcomes. Actor/order/route-bound idempotency recovery prevents cross-owner session replay.

Four independent-review findings were fixed: poison digest isolation and independent scheduler steps; confirmed/paid recipient inclusion via the existing reservation demand policy; stale OTP retirement/latest-challenge validation; and actual-dispatch quiet-hour checks. Legacy critical UCP email remains exempt. No email acceptance claim is made for an unconfigured transport.

TESTED: Final local affected gate **13/13 groups PASS** on separate MySQL 8.0.45 `miljor_test_db`, port33319. Includes source gates; completion tests (30 email, 5 projection, 298 combined service/authorization checks, plus standalone controls/routes/OTP); 3 review regressions; native financial/fulfillment/request/invoice actions; actual SQL domain rollback/projection/ownership, controls/digest poison isolation/audited retries; checkout initiation (9 scenario checks, including 50 keys); Regular recovery (9 scenario groups); Flash 47/47 with 50 distinct buyers (2 successes/48 stock conflicts); signed synthetic payment/fulfillment/settlement and refund races; shared-SKU publication races. Counts refer to named gates, not every master-plan case. Exact output tails and log hashes: `evidence/ucp-completion-2026-11-16.json`.

Failed VM adapter allowlists for the new pure notification policy and the canonical refund-approval writer were corrected without disabling production hooks or relaxing transaction/ownership assertions. Failed tests were rerun narrowly; unaffected successful groups were reused through the bounded runner's explicit resume point. Additional service compatibility checks: demo B6 paid fulfillment 13/13, discrepancy 5/5, fulfillment/invoice source 9/9. Ordinary frontend `npm ci --no-audit --no-fund --registry=https://registry.npmjs.org` and `npm run build` passed using the unchanged lockfile; notification and supplier-fulfillment tests passed. Build provenance preserves earlier missing-dependency/nonstandard-build observations separately.

MIGRATIONS: Preserve committed Smart Hub090–094 bytes. Original PR-only092/093 were first provisionally095/096 in isolated instances. Concurrent Smart Hub commit `c4232e011b1fc4aaf7571467db35b1f51ba300ae` subsequently introduced `095_collective_individual_commitments.sql`; it is NOT blindly merged here. Final UCP names are **096 cursor, 097 controls, 098 event widening**. The095-to098 move changed no SQL bytes; no existing journal was rewritten. Final-name fresh install at33321:62 applied, second run0, history audit PASS. Restored backup upgrade at33320:59→62, second run0, history audit PASS. All105 table DDLs match the runtime-tested33319 schema after excluding data-dependent AUTO_INCREMENT counters. Six restored commercial table checksums match the preserved backup. See `evidence/ucp-final-migrations-2026-11-16.json`.

DATABASE: Initial recorded backup SHA256 `91e3003e82e06f825ec977aef81bb3430f0fbd1d71f8ed32a746d28799403cfe`,101 tables; initial restore33318 matched101/101 current-source checksums. The same backup restored all101 tables at33320, but the concurrently mutable original test source later matched98/101; this changed-source result is retained, not relabeled PASS. Restored commercial records remain unchanged. Actual fixtures/migrations used only isolated `miljor_test_db`; original configuration was read privately and original databases were queried read-only.

PROTECTED CHECK **FAIL / investigation unresolved**: Earlier protected checks matched the historical baseline. Final users checksum changed3366696221→2879533563; pools2265355547 and reservations/orders/payments/platform_ledger0 remain unchanged. Audit records an existing SUPER_ADMIN account updating one supplier from MORE_INFORMATION_REQUIRED to VERIFIED at2026-11-16 01:06:47 UTC /06:06:47 Pakistan time. User did not recognize this update. The audit has no IP/user-agent and no matching recent session rows; person/process attribution remains undetermined. No rollback, account restriction, session revocation or baseline reset was performed. Sanitized findings are in `evidence/ucp-protected-drift-investigation-2026-11-16.json`; original identifiers are kept only in ignored local logs. Do not claim the protected-data check passed.

PROVIDERS: Actual Safepay sandbox checkout initiation and independent authenticated tracker readback PASS (TRACKER_STARTED); reconciliation correctly did not invent payment success. Actual completed payment, provider-signed callback/refund/provider-fee acceptance remain NOT_TESTED. External payouts/refunds remain disabled. SMTP authentication PASS with zero messages sent; real email receipt remains NOT_TESTED. Computer/browser tooling timed out during actual sandbox browser setup, so no full provider browser journey was proven.

UNRESOLVED: Full event/recipient/actor/version/causation matrix; catalog-only/unsupported operations are not proof of delivered events. `ucp_event_coverage_audit.js` is an explicitly qualified source-reference inventory, not a full coverage PASS. Full clustered manifests/cutoff/rerouting, cancellation/compensation cost policy, replacement re-contracting, all Flash threshold journeys, real email receipt, actual provider payment/refund/fee evidence, full mobile/browser acceptance and exact-new-head remote CI still require evidence. User clarification about fresh supplier quote plus buyer acceptance for changed costs remains pending. Concurrent newer Smart Hub changes require their own safe source/history integration; they were not overwritten.

FILES: The actual changed-file inventory and command/log evidence are in `evidence/ucp-completion-2026-11-16.json`; primary changes are the notification/delivery-policy/operations services, email/checkout/idempotency/Regular recovery, actual controller/catalog/fulfillment/invoice hooks, routes/server/scheduler, three PR migrations, inbox/settings/operations components, focused tests and existing report/phase log.

Skills applied: using-superpowers, executing-plans, using-git-worktrees, dispatching-parallel-agents, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, receiving-code-review; independent reviewer applied security-review. Outcomes: bounded isolated implementation, four concrete findings resolved, actual gates recorded, safety drift and remaining release requirements retained as failures/blockers. Project risk-based consolidated verification rules took precedence over generic repeated suites.

RESULT: **IMPLEMENTED increment tested locally; overall PARTIAL / RELEASE BLOCKED.** This is not an all-master-plan-complete or production-ready report. PR remains draft; no blind merge/deployment. Rollback means disable new workers/revert application changes while preserving domain, inbox, outbox, audit and migration evidence; never narrow event columns or rewrite journals.

CAN START NEXT PHASE: NO
