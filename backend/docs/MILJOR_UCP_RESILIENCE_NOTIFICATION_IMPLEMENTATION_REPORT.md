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

### First remote CI and targeted correction

Qualified implementation commit00987fc79a1bae8e0f6f1af7a0ae42c704fef3dd was pushed. PR54 is draft and now conflicts with newer main; no main merge was attempted. Workflow-only commitf0bb9a3545d1200ee6d217692e5f7600b1113b90 enables the existing canonical acceptance workflow directly on this approved branch because conflicted pull requests do not produce usable PR-triggered verification. Run43788333296: source/production build PASS; real Chromium buyer/supplier auth/retry/offline PASS; disposable-MySQL job FAIL. This failed run remains recorded in evidence/ucp-ci-initial-2026-11-16.json.

Actual CI root causes were repaired: E2/E3 legacy fixture teardown omitted transactional notification dependents; a strict test-only owned-user cleanup helper now checks database/port identity and removes dependent fixture rows before users, without FK disabling or global deletion. E2 now reports cleanup errors as test failures. Checkout now validates persisted ownership before provider configuration, retaining configuration checks before any inventory claim or provider call.

Targeted observed verification on isolated33321: E2 product ownership/immutable pools33/33 PASS; E3 entitlements18/18 PASS; checkout safety33/33 PASS; actual Express order-ownership gate PASS including foreign-buyer denial without provider credentials and zero payment mutations. These are corrections to the failed CI cases, not a retrospective PASS for the failed run. New remote CI must still be observed; protected-data attribution and the full-release blockers above remain unresolved.

### Final observed CI qualification

Corrected source/test commit **b264cc62cc4df42c46b39fc43891e1b9ae982f50** passed the complete canonical workflow: [run43957629752](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43957629752), conclusion SUCCESS. All3 jobs completed successfully: source gates/production frontend build; disposable MySQL migrations and B4/B5/B6/financial/ownership/admin acceptance; real Chromium buyer/supplier authentication/retry/offline journey. The MySQL job now passes the earlier E2/E3 cleanup and foreign-buyer checkout failures. Machine-readable job/step evidence: evidence/ucp-ci-final-2026-11-16.json. The earlier failed run remains preserved.

This upgrades exact-source remote CI to PASS for these named checks. It does not close the unrecognized protected users update, full event metadata/recipient matrix, complete geographic cluster/rerouting/cost/re-contracting implementation, actual completed provider payment/refund/fees, real mail receipt or all master-plan/mobile/browser acceptance. PR54 remains DRAFT/UNMERGED and conflicts with current main0f108fec64e5611e79a2766427073bcea085fbd1; no blind main merge was performed. Overall **PARTIAL / RELEASE BLOCKED** remains unchanged.

The final evidence-only commit records this qualification without changing application/tests/workflows from b264cc6 and uses a CI-skip marker to avoid repeating the same full workflow only to save its result.

## 2026-11-16 (Phase A/B Continuation) — Requirements-to-Code Matrix & Prospective Metadata

### Requirements-to-Code Matrix

| Area / Requirement | Existing Implementation & Transaction Boundary | Recipient / Authorization Policy | Actual Tests | Missing Implementation | External Dependency / Business Decision | Status |
|---|---|---|---|---|---|---|
| **Phase A: Notification Contract & Coverage** | `notificationService.js`, `ucpTransactionalNotifications.js`, `ucpNotificationEventCatalog.js`, `notificationDeliveryPolicy.js`, `notificationOperationsService.js`. Same-TX outbox before commit; `schemaVersion: 2` prospective metadata (`eventId`, `aggregateId`, `aggregateVersion`, `actorId`, `actorRole`, `occurredAt`, `causationId`, `correlationId`) added compatibly alongside `schemaVersion: 1`. | Persisted SQL ownership (`orders`, `pools`, `reservations`, `flash_purchase_holds`, `users.role`); no client-supplied recipients; no OTP/tokens/full addresses/bank details in payloads; admin ops strictly `ADMIN`/`SUPER_ADMIN`. | `ucp_final_affected_gate.js` (`source`, `completion`, `review-regressions`, `native-notification-actions`, `notification-mysql`, `notification-controls-mysql`), `ucp_phase_ab_contract_gate.js` PASS. | Dynamic/unreferenced catalog entries (`CATALOG.SKU_SUBMITTED/REJECTED/PAUSED/SPEC_CHANGE_*`, `FULFILLMENT.CLUSTER_*`, `DISPUTE.EVIDENCE_REQUESTED`, `ADMIN.SERVICE_*`) where underlying operations do not yet exist or are Phase C/D. | None for implemented hooks; Phase C/D operations govern remaining domain events. | **PARTIAL (PASS for implemented increment)** |
| **Phase B: Timers & Recovery** | `ucpRecoveryService.js` (Flash lease/cursor + SQL-clock `UCP.POOL_CLOSING`/`UCP.HOLD_EXPIRING` threshold reminders), `ucpRegularRecoveryService.js` (parent lock, SQL clock, lease/cursor, 24h/1h/15m reminders, hold reminders, SLA breach), `regularPoolPaymentHoldService.js`. | System lease (`GET_LOCK`), `ADMIN`/`SUPER_ADMIN` recovery, owning `BUYER` consent only. | `ucp_regular_recovery_mysql_gate.js`, `ucp_flash_recovery_gate.js`, `ucp_payment_expiry_race_gate.js`, `ucp_phase_ab_contract_gate.js` (Flash timer reminder SQL-clock & dedupe). | Isolated Flash-pool DB fixture run for `recordFlashTimerReminders` (skipped in `ucp_phase_ab_contract_gate.js` when no `flash_pools` row pre-exists on fresh 33321), full worker crash/restart browser E2E. | None. | **PARTIAL** |
| **Phase C: Shared Delivery Workflows** | `deliveryEligibilityService.js`, `deliveryQuantityPolicy.js`, `fulfillmentService.js`, `supplierDeliveryService.js`, `geographicService.js`. | Verified supplier & owning buyer only; no silent repricing or address substitution. | `part5_flash_pool_gate.js`, `p0_payment_fulfillment_settlement_http_e2e.js`, `demo_delivery_quantity_policy_gate.js` (14/14). | Clustered delivery manifests/cutoffs/rerouting, meaningful ETA-change workflows, delivery attempt/reattempt multi-stop flows. | Geographic/operational clustering rules. | **PARTIAL** |
| **Phase D: Supplier Failure & Replacement** | `ucpRegularRecoveryService.js` (`SUPPLIER_FAILED` escalation, `PROPOSE_REPLACEMENT`, immutable owning-buyer `consent` -> `CONSENT_RECORDED_RECONTRACT_REQUIRED`). | `ADMIN`/`SUPER_ADMIN` proposal; owning `BUYER` consent only; verified replacement eligibility check. | `ucp_regular_recovery_mysql_gate.js` (proposal + buyer consent + ownership). | Actual replacement re-contracting execution (new quote/order/stock/compensation). | **Business decision pending:** fresh supplier quote + buyer acceptance rules for changed delivery costs / cancellation / compensation. | **BLOCKED (awaiting business rule)** |
| **Phase E: Safepay Sandbox & Financial Proof** | `safepayAdapter.js`, `safepayCheckoutService.js`, `financialConservationService.js`, `financialSettlementService.js`. `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`. | Buyer checkout ownership before config; signed HMAC-SHA512 webhook; non-success webhook cannot downgrade `PAID`. | `checkout_initiation_isolated_mysql_gate.js`, `p0_payment_fulfillment_settlement_http_e2e.js`, `sandbox_payment_refund_stress_gate.js`, `ucp_phase_ab_contract_gate.js` PASS 3. | Actual completed Safepay sandbox card payment, genuine provider callback/reconciliation of `TRACKER_ENDED`, provider-fee & refund/payout capability proof. | PCI-sandboxed checkout iframe requires owner card entry; Safepay standard sandbox lacks self-serve REST refund API. | **BLOCKED (provider/manual sandbox payment)** |
| **Phase F: Email Receipt & Full UI Acceptance** | `emailService.js`, `notificationService.js`, frontend inbox/settings/operations/checkout/return UI. | User-owned inbox/preferences; `ADMIN`/`SUPER_ADMIN` ops console. | Remote CI Chromium auth/retry/offline (`43957629752`), `vite build` PASS. | Actual SMTP inbox receipt proof, mobile keyboard/focus & Urdu RTL browser journeys, clustered/partial-delivery/recovery browser journeys. | Approved test mailbox / sandbox email capture transport. | **NOT_TESTED / PARTIAL** |
| **Phase G: Integration & Release Assessment** | `plan/ucp-resilience-notification-coverage` (PR #54, draft, conflicts with `origin/main` `9fb07cf`). | Branch-only commits; no main merge or `miljor_db` mutation. | `ucp_final_affected_gate.js` 13/13 PASS on isolated MySQL 8.0.45 (`127.0.0.1:33321`). | Merge/migration reconciliation with `origin/main` & newer Smart Hub `095`. | Explicit user merge authorization; resolution of protected `miljor_db.users` drift attribution. | **BLOCKED** |

### Phase A/B Continuation Evidence (2026-11-16)

- **Protected DB read-only check (`miljor_db` on port 3306):** `users: 567617374`, `pools: 2265355547`, `reservations: 0`, `orders: 0`, `payments: 0`, `platform_ledger: 0`. No baseline reset, session revocation, or account mutation performed; protected-user drift attribution remains **UNRESOLVED**.
- **Isolated MySQL 8.0.45 (`127.0.0.1:33321`, datadir `backend/database/backups/ucp-final-canonical-2026-11-16`):**
  - `node tests/ucp_phase_ab_contract_gate.js`: **PASS** (prospective `schemaVersion: 2` metadata, `processPending` projection, `PAID` non-downgrade on `payment.failed` webhook; Flash timer SQL-clock test skipped due to absent `flash_pools` row in fresh schema).
  - `node tests/ucp_final_affected_gate.js`: **13/13 groups PASS** (`migration-audit`, `source`, `completion`, `review-regressions`, `native-notification-actions`, `notification-mysql`, `notification-controls-mysql`, `checkout-initiation-mysql`, `regular-recovery-mysql`, `flash-delivery-stock-50`, `payment-fulfillment-settlement`, `payment-refund-concurrency`, `regular-flash-shared-stock`).

CAN START NEXT PHASE: NO

## 2026-11-16 — Phase A/B hardening and completion of skipped Flash acceptance

TASK: Verify the actual c570a7b continuation, replace the skipped Flash check with independent owned fixtures, repair reproduced metadata/timer defects, and qualify the exact corrected source. Approved branch and PR54 retained; starting local/FETCH_HEAD SHA:c570a7b6f4263306f3fe95c88c2e54f5a7860b11. No branch merge, new migration or unrelated phase was started.

IMPLEMENTED: Prospective v2 metadata now rejects malformed/truncated/coerced identities, missing actor/role, mismatched persisted actor roles, invalid aggregate versions, incomplete causation/correlation IDs and invalid/rolled-over timestamps. Default occurrence time comes from SQL and is shared across recipients. V1 callers retain their payload/processing contract. V2 eventId matches the canonical event key; duplicate delivery preserves first-written evidence rather than rewriting it with a changed actor/time. Business authorization remains in the existing domain services/guards; recording actor metadata is not a new authorization mechanism.

Flash reminders now re-evaluate SQL clocks after the parent lock is acquired, include exact15-minute windows, and preserve the existing Flash parent→holds→orders→attempts lock order. Hold warnings target eligible unpaid HELD owners only, exclude both unresolved attempt states regardless of age, and check order/payment state plus a fresh clock after locks. Batches cap100 holds and skip already recorded reminders before the limit so later commitments remain reachable. Pool events carry the persisted offer version. Notification/audit writes remain in the same transaction; no stock/financial mutation or external transport was added.

TESTS: Exact pre-fix c570a7b code reproduced both defects in real InnoDB:15-minute boundary returned0 instead of1; observed lock-wait/deadline crossing returned1 instead of0. These expected failing diagnostics are preserved. An initial new callback fixture used invalid payment_attempts statusPAID; corrected to the actual COMPLETED enum and reran that scenario successfully without weakening the PAID-order assertion.

Final consolidated affected gate: **14/14 groups PASS** on isolated127.0.0.1:33321 `miljor_test_db`. The dedicated phase gate includes **56/56 metadata tests,0 failures,0 skips**, and **10/10 mandatory SQL scenario groups,0 skips**: persisted user/system metadata and SQL time; v1/v2 projection; exact24h/1h/15m boundaries/replay/owner isolation; short/expired/inactive windows; unpaid hold protection;10 concurrent reminder transactions;100+2 fair batches; actual observed InnoDB lock wait; outbox-failure rollback/retry; real peer/crashed-holder lease behavior; signed synthetic failed callback receipt/replay/PAID immutability and invalid-signature rejection. Every group creates and cleans only its owned users/products/offers/orders/holds/attempts/events. The gate no longer selects or mutates an arbitrary pre-existing Flash offer, and cannot report a full PASS when the Flash table is empty or scenarios are skipped. It terminates naturally after closing its pool.

Commands and output tails/hashes: `evidence/ucp-phase-ab-hardening-2026-11-16.json`. Final command from backend: NODE_ENV=test DB_NAME=miljor_test_db TEST_DB_NAME=miljor_test_db DB_HOST=127.0.0.1 DB_PORT=33321 DB_USER=root DB_PASSWORD='' MILJOR_TEST_ONLY_MIGRATIONS=1 ALLOW_EXTERNAL_MONEY_MOVEMENT=false node tests/ucp_final_affected_gate.js. Focused script: npm run test:ucp:phaseab. Baseline diagnostics used the ignored baseline-reminders.cjs hook to load exact historical source; they are not final acceptance runs.

DATABASE: Six protected-table checksums captured read-only before and after this phase match, with no changed tables. Raw values and operational configuration remain private in ignored logs. This contemporaneous PASS does not reset or resolve prior historical drift attribution. No mutable test, migration or fixture targeted miljor_db/miljor_sandbox_db. No provider or email transport call occurred; synthetic PAID-state fixtures and signed test callbacks are not real Safepay payment evidence.

CI: Canonical workflow now runs the metadata negative gate and the mandatory self-owned SQL contract gate on a fresh disposable MySQL schema. Exact corrected source/run qualification is recorded in the final CI addendum; do not infer it from the older skipped test or previous13-group report.

FILES: notificationService.js; ucpTransactionalNotifications.js; ucpRecoveryService.js; ucp_notification_metadata.test.js; ucp_phase_ab_contract_gate.js; ucp_final_affected_gate.js; backend/package.json; .github/workflows/ucp-canonical-acceptance.yml; this report; phase log; dated hardening evidence. Reused existing outbox, lease, demand/ownership and financial services; no duplicate engine or applied migration changes.

Skills/outcomes: using-superpowers/executing-plans for the existing phase; systematic-debugging for exact baseline reproductions and enum diagnosis; test-driven-development for regression scenarios; dispatching-parallel-agents for independent metadata and Flash scopes; requesting-code-review for bounded source review; verification-before-completion for fresh evidence. Project consolidated/risk-based testing rules took precedence over generic repeated full suites.

RESULT: Phase A prospective-contract / Phase B Flash reminder-generation scope locally PASS with no skipped acceptance. Full event/caller migration and complete master-plan delivery/re-contracting/provider/email/UI/release integration remain outside this correction and PARTIAL/BLOCKED. Prior historical database attribution remains unresolved. No automatic Phase C start or main merge authorized here.

CAN START NEXT PHASE: NO

### 2026-11-17 — exact-source Phase A/B CI qualification

Qualified application/test/workflow SHA: **1e3bc6c54b38112730da8e1e5e014d4b22683477**. Canonical [run43973636310](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43973636310) completed SUCCESS: **3/3 jobs PASS** (disposable MySQL acceptance; source gates and production frontend build; real Chromium buyer/supplier auth/retry/offline). The dedicated fresh-schema owned Flash SQL-clock contract step completed successfully, rather than being inferred from unrelated regression groups. Exact job/step evidence: `evidence/ucp-phase-ab-ci-2026-11-17.json`.

Final scope verdict: **PASS for the prospective-metadata and no-skip Flash reminder correction**, with56 metadata tests and10 mandatory owned SQL scenario groups, plus the14-group local affected gate. Historical expected-red reproductions and the earlier skipped test report remain preserved. No new migration, main merge, protected-record mutation, actual provider payment/refund or email dispatch was introduced.

This does not certify all catalog/caller metadata adoption, complete delayed-channel/frontend behavior or PhasesC–G. Historical drift attribution and the remaining delivery/re-contracting/provider/mail/full-browser/release-integration gates remain open; full master-plan status is still **PARTIAL / RELEASE BLOCKED**. This evidence-only commit changes no tested application, tests or workflow files from1e3bc6c and uses [skip ci] to avoid repeating successful CI just to record its outcome.

CAN START NEXT PHASE: NO

## 2026-11-17 — Phase C Delivery Reliability Implementation & Gate Evidence

TASK: Implement remaining Phase C delivery reliability on PR #54 (`plan/ucp-resilience-notification-coverage`) from baseline `5ba4116` (preserving uncommitted `MILJOR_UCP_COMPLETION_EXECUTION_PLAN.md`). No main merge, protected-DB mutation, or external money movement.

### Phase C Requirements-to-Code-to-Test Matrix

| Requirement | Existing implementation | Actual gap | Changed paths | Acceptance evidence | Status |
|---|---|---|---|---|---|
| Eligibility, supported Standard/Express/Pickup modes & immutable snapshots | `deliveryEligibilityService.js`, `supplierDeliveryService.js`, `flashPoolService.js` (`055`), `orderService.js`, `procurementDeliveryBindingService.js` (`094`) | Shared run/stop assignment lacked mode/cluster/handling/capacity validation and `delivery_method = 'EXPRESS'` bridge for non-Flash orders | `backend/src/services/deliveryRunService.js`, `backend/database/migrations/099_ucp_phase_c_delivery_reliability.sql` | `ucp_phase_c_delivery_gate.js` (PASS), `part5_flash_pool_gate.js` (47/47 PASS) | **PASS** |
| Compatible cluster grouping, SQL cutoff & concurrent stop uniqueness | `geographicService.js`, `047_procurement_delivery_runs.sql` (unused B6-only schema) | No shared UCP `delivery_runs` / `delivery_run_stops`, no post-lock SQL clock cutoff check, no active-stop unique constraint | `099_ucp_phase_c_delivery_reliability.sql`, `deliveryRunService.js`, `deliveryRunRoutes.js` | `ucp_phase_c_delivery_gate.js`: concurrent run creation (1x201, 1x409), real InnoDB lock-wait cross-cutoff (`CLUSTER_CUTOFF_PASSED`), incompatible mode/capacity rejections | **PASS** |
| Owning-supplier manifest, buyer stop privacy & RBAC | `fulfillmentService.js`, `fulfillmentRoutes.js` | No supplier manifest/stop endpoints or buyer-isolated stop view | `deliveryRunService.js`, `deliveryRunRoutes.js`, `backend/server.js` | `ucp_phase_c_delivery_gate.js`: wrong-supplier 403, peer-buyer 403, zero peer buyer data in response | **PASS** |
| Dispatch, meaningful ETA updates, pickup claim & separate buyer receipt | `fulfillmentService.js`, `encryptionService.js` | No run dispatch, ETA versioning (>=15m), encrypted/hashed pickup claim code, or stop-level receipt | `deliveryRunService.js`, `deliveryRunRoutes.js` | `ucp_phase_c_delivery_gate.js`: dispatch, ETA v2, pickup code non-leakage in `procurement_notifications`, wrong code 403, valid claim, premature settlement blocked | **PASS** |
| Partial delivery (100/80/20), shortage & dispute preservation | `deliveryQuantityPolicy.js`, `disputeService.js`, `financialSettlementService.js` | No stop-level `accepted_qty`/`missing_qty`/`rejected_qty`/`disputed_qty` linked to `order_disputes` & `EXCEPTION` settlement hold | `099_ucp_phase_c_delivery_reliability.sql`, `deliveryRunService.js` | `ucp_phase_c_delivery_gate.js` (100 ordered / 80 accepted / 20 disputed, `orders.total_qty` preserved, settlement blocked), `demo_delivery_quantity_policy_gate.js` (14/14 PASS) | **PASS** |
| Failed attempts, bounded reattempt, reroute & 2026-11-17 cost/consent policy | `ucpRegularRecoveryService.js` (pool-level consent pattern) | No `delivery_attempts` or append-only versioned `delivery_amendments` enforcing buyer-requested vs supplier/carrier/platform cost rules | `099_ucp_phase_c_delivery_reliability.sql`, `deliveryRunService.js`, `deliveryRunRoutes.js` | `ucp_phase_c_delivery_gate.js`: `SUPPLIER_CARRIER_FAILURE` extra fee rejected 422, `PLATFORM_PROVIDER_FAULT` non-zero rejected 422, wrong-owner/version/concurrent quote decision (200/409), admin recovery | **PASS** |
| Transactional UCP notifications (v2 metadata, rollback, dedupe) | `ucpNotificationEventCatalog.js`, `ucpTransactionalNotifications.js`, `notificationService.js` | Phase C run/stop/attempt/amendment events not wired to `ucpTransactionalNotifications` | `deliveryRunService.js` | `ucp_phase_c_delivery_gate.js` (same-TX outbox, rollback emits 0 rows, pickup code absent), `npm run test:ucp:phaseab` (PASS) | **PASS** |
| Existing UI integration & production build | `OrdersPage.jsx`, `SupplierFulfillmentPanel.jsx`, `AdminDashboardPage.jsx` | Missing buyer stop/partial-receipt/amendment UI, supplier manifest UI, admin delivery recovery UI | `frontend/src/api/deliveryRuns.js`, `BuyerDeliveryStopPanel.jsx`, `SupplierDeliveryManifestPanel.jsx`, `AdminDeliveryRecoveryPanel.jsx`, `OrdersPage.jsx`, `SupplierFulfillmentPanel.jsx`, `AdminDashboardPage.jsx` | `npm --prefix frontend run build` PASS (Vite v8.3.4, 2,237 modules, 0 errors, 3.70s). Local browser E2E `NOT_TESTED` (Playwright not installed locally) | **PARTIAL (Build PASS; Browser NOT_TESTED locally)** |

### Consolidated Verification Evidence (2026-11-17)

- **Isolated MySQL 8.0.45 (`127.0.0.1:33322`, `miljor_test_db`, datadir `backend/database/backups/ucp-phase-c-2026-11-17`):**
  - `node database/migrationManifest.js`: PASS (63 migrations).
  - `node database/bootstrapDisposableMigrationTest.js` + `node database/runMigrations.js` (1st run: applied 63; 2nd run: applied 0) + `node database/readOnlyMigrationAudit.js --test-only`: PASS.
  - `099_ucp_phase_c_delivery_reliability_rollback.sql` + `node database/runMigrations.js` (applied 1) + `node database/readOnlyMigrationAudit.js --test-only`: PASS (exit 0).
  - `node tests/ucp_phase_c_delivery_gate.js`: PASS (exit 0; natural teardown).
  - `npm run test:ucp`: PASS (exit 0; includes `ucp_independent_audit_source_gate` 80 PASS, `b4_regular_dual_timer_source_gate` 16/16, `ucp_3_to_5_source_gate` 46 PASS, `ucp_notification_catalog_gate` 94 events).
  - `npm run test:ucp:phaseab`: PASS (exit 0; 56 metadata + 10 SQL groups).
  - `node tests/demo_delivery_quantity_policy_gate.js`: PASS (14/14, exit 0).
  - `node tests/p0_payment_fulfillment_settlement_http_e2e.js`: PASS (exit 0).
  - `node tests/part5_flash_pool_gate.js`: PASS (47/47, exit 0).
  - `npm --prefix frontend run build`: PASS (exit 0, 2,237 modules, 3.70s).
- **Protected DB (`miljor_db`, port 3306, read-only):** Before and after checksums identical: `{"users":2302417835,"pools":2265355547,"reservations":0,"orders":0,"payments":0,"platform_ledger":0}`. (Historical `users` drift attribution from prior session remains unresolved.)
- **Skills applied:** `systematic-debugging` (local-TZ vs UTC cutoff parsing & `exactDecimal` / `order_disputes` schema alignment), `verification-before-completion` (isolated 33322 MySQL, rollback/re-apply, consolidated affected gates, protected DB checks).
- **Remaining boundaries:** Phase D (supplier replacement re-contracting execution), Phase E (actual completed Safepay sandbox payment/refund/fee proof), Phase F (actual SMTP inbox receipt & mobile/Urdu RTL + clustered browser E2E), Phase G (main merge & `090`/`095` migration reconciliation).

CAN START NEXT PHASE: NO
