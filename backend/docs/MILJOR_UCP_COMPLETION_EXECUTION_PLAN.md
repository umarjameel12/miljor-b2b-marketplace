# UCP remaining-work execution — 2026-11-16

Authorized scope: complete the remaining existing resilience/notification master plan on PR #54; preserve original source, data, financial evidence and all existing behavior. No main merge or real money movement.

## Audited source-integration proposal

- Current UCP starting SHA: `7df58aaccec63645c7fbdaf8bcc23db26d0402d7`.
- Existing committed Smart Hub source: `08a9d87809a1c3683074500d20f6a14fb5c41781`, branch `feature/smart-procurement-hub-unified-entry`.
- Existing main SHA inspected: `9fb07cf9274509c1686b68b5bf8bdd91bd26718f`.
- Smart Hub already supplies persistent notification projection/preferences, localized event templates, email claim/retry safety, delivery binding and action hooks. Reuse these instead of recreating the same engines.
- A read-only `git merge-tree --write-tree` preview found actual conflicts in `.gitattributes`, phase log, notification routes, dispute/email/financial/fulfillment/Safepay services, and two service-test adapters. No branch/worktree merge was executed.
- Its migrations090–094 collide by version with this unmerged PR's 092/093. Preserve already applied original-branch history. Proposed reconciliation: retain the original committed Smart Hub migrations exactly, move PR-only migrations to unused canonical versions with recorded provenance, and prove a fresh install plus repeat run on an isolated `miljor_test_db`. Do not rewrite any existing database journal or historical test evidence.
- Actual cross-branch integration requires the user's explicit merge authorization under AGENTS.md section 2.3.4. Main remains untouched. Uncommitted worker edits must be checkpointed/preserved before any integration.

## Concurrent implementation boundaries

1. Frontend: persistent role-independent inbox, real read/unread ownership, mobile/accessibility, preferences for locale/email/mute/quiet hours. Reuse the already committed Smart Hub implementation where applicable. No restyling.
2. Regular recovery: authoritative deadline processing and pending-payment protection, bounded leased worker, supplier timeout/admin exception recovery, explicit buyer consent, append-only audit. No forged actor decisions, replacement/charge/refund/payout without authorized evidence.
3. Integration/notifications/provider proof: reconcile source and migration history, reuse the existing projector/outbox, connect remaining supported domain actions, implement delivery/admin monitoring, validate provider capabilities and record actual runtime results separately from synthetic acceptance.

## Selected cost and consent policy — 2026-11-17

The user delegated selection of the most feasible approach. The following conservative policy is selected for Phase C/D implementation; it is a business decision, not evidence that those workflows are already implemented.

- **Locked original terms:** Preserve the original order, accepted quote, charges, physical SKU/specifications and history. No silent repricing or replacement.
- **Buyer-requested change:** Address, mode, timing or other buyer-requested changes require a fresh supplier quote showing the original amount, new amount, exact difference, delivery terms/ETA and expiry. An extra buyer charge requires explicit acceptance of that exact quote/version. Acceptance alone does not prove payment or authorize execution outside existing financial gates.
- **Supplier/carrier failure:** Do not add a compulsory buyer charge to remedy the failed original service. Attribute supplier/carrier costs only through existing accepted contracts or a separately authorized, recorded resolution; do not invent or automatically debit a supplier liability.
- **Platform/provider fault or disputed responsibility:** Do not automatically charge the buyer or grant a platform subsidy. Open an audited support resolution using existing exception/dispute paths; responsibility and any commercial concession must be explicitly recorded and authorized.
- **Cancellation:** Introduce no new automatic cancellation penalty. Any previously agreed non-recoverable cost requires the recorded prior terms, evidence and existing authorized financial-review path. Never silently pass through guessed provider fees or perform a live refund/payout.
- **Replacement:** A proposal or buyer consent record alone must not substitute suppliers. Require eligible replacement supplier terms, an immutable fresh quote and explicit owning-buyer acceptance of the exact SKU, charges and delivery conditions. Preserve the old contract/payment evidence and use the existing gated re-contracting/refund/new-order boundaries.
- **Decline, expiry or silence:** None is consent. Leave original terms unchanged where still fulfillable; otherwise route to the existing failure/dispute/refund-resolution path. Do not auto-charge, auto-substitute or erase the original obligation.
- **Acceptance evidence:** Persist quote/version/hash, initiating actor and reason, cost responsibility, old/new breakdown, buyer decision/time and idempotency identity. Notify only affected parties. Revalidate ownership, eligibility, quote expiry and consent after locks.

This resolves the previously pending fresh-quote/buyer-acceptance policy choice. Phase C/D implementation and verification, provider capability and other release gates remain outstanding. No Phase C execution, main merge, original database change or external money movement is performed by this documentation update.

## Acceptance and evidence

### Antigravity immediate handoff — Completion Phase 1 closeout, 2026-11-17

User requests a detailed handoff to the existing **Miljor PR 54 Phase C Delivery Reliability** Antigravity conversation. Scope is closing Completion Phase1; do not start Completion Phase2/3 automatically. The three-phase roadmap remains unchanged.

1. Work only in the approved UCP worktree/branch for PR54. Read the current root/backend policies and inspect actual HEAD/status. Last inspected HEAD is `bf4155b`; migration100, replacement services/routes/UI/CI and browser-runner fixes are uncommitted. Preserve all existing work. Do not use the unrelated Safepay/marketplace handoff conversation or another checkout.
2. Reconcile the latest report with actual evidence before reporting PASS. The phase log now reports isolated SQL/API, replacement gate, Chromium, build and protected-data checks; those are Antigravity-reported results. The latest shared browser log contains `ALL PHASE 1 REAL CHROMIUM BROWSER JOURNEYS PASSED`. Confirm its process exit0, command/environment, source version and cleanup; the marker alone is insufficient for full-phase acceptance. Do not rerun successfully completed unaffected gates solely to generate more output.
3. Preserve Codex's runner corrections in `tests/ucp_phase1_delivery_browser_gate.js`, `tests/helpers/phase1BrowserServerGuard.js`, and `tests/phase1_browser_server_guard.test.js`: strict preflight, explicit owned frontend/API ports and proxy, direct Vite child (no npm-shell orphan), child-start/exit checks, persistent progress and awaited cleanup. Focused guard tests PASS3/3 including an actual Vite port collision; syntax check exit0. Ensure the helper files are included in the final source commit/CI.
4. Historical failures were real: Vite silently moved3000->3002 while the browser used3000, causing a wrong-server login401; replacement UI renders `accepted` rather than `buyer_accepted`; an ambiguous `/Admin/` locator matched three elements. Keep exact accepted state/ownership assertions; never weaken them to achieve PASS. Verify fixes against the correct isolated backend. Do not remove auth or bypass login.
5. Host-process visibility requires appropriate access: restricted enumeration incorrectly appeared empty. Three old gate roots and their UCP Vite leftovers were stopped; original app servers and MySQL were preserved. Before launching any gate, check actual relevant PIDs/listeners. Never kill all node/chrome/mysqld processes. Avoid starting a second33322 daemon over its live datadir. Do not reinitialize/delete/repair an existing datadir merely because a duplicate launch reports `ibdata1 must be writable`.
6. Give each run unique log/artifact paths and explicit start/end/status/exit evidence so concurrent runs cannot overwrite `api.log`, `vite.log`, `gate.log`, screenshots or trace. Persist stdout/stderr from startup through cleanup, with sanitized errors and step progress. Avoid duplicate log lines. Record actual browser executable/version. Close only owned resources naturally, preserving nonzero failure codes.
7. Complete an independent source review of migration100, supplierReplacementService, deliveryRunService/routes and UI before claiming full Phase1 acceptance. Check existing order/stock/payment/fulfilment endpoints cannot bypass new guards; validate ownership, lock ordering, fresh post-lock expiry, immutable quotes/snapshots, exact monetary arithmetic, idempotent replay and transaction/outbox rollback.
8. Specifically prove replacement **supplier-authorized fresh quote**, actual eligible replacement SKU/listing/inventory identity and agreed service area/SLA. An admin-entered price or `EXACT_SKU` string alone is not supplier consent or physical-SKU equivalence. Preserve the published SKU/specification/version and require explicit buyer acceptance of any material difference. No fabricated supplier consent/publication.
9. Prove replacement after partial delivery covers only the eligible outstanding obligation. The100/80/20 case must not create a second100-unit obligation after80 accepted, erase the20 disputed, double-reserve stock, double-charge or settle the original twice. Preserve original invoice/payment/history and link the replacement order. Verify old funds/obligations remain correctly gated; new order creation/consent is not completed replacement payment or fulfilment.
10. Apply the selected cost policy consistently: no compulsory extra buyer charge for supplier/carrier fault; buyer-requested extra cost requires exact version/hash acceptance; no silent repricing, liability debit, subsidy, cancellation penalty, provider success, refund or payout. External money movement stays disabled. Supported execution must use existing financial gates; unsupported execution must fail closed and be reported.
11. Verify actual final tests cover wrong role/owner, expired/stale/declined/wrong-version consent, concurrent quote acceptance/execution/expiry, insufficient replacement stock, repeat execution, rollback and notification recipient privacy. Ensure delivery fail/reattempt/reroute, all supported modes and cutoff behavior are covered by actual appropriate API/browser tests; six Chromium success lines are not proof of every master-plan requirement. Record any missing acceptance as NOT_TESTED/BLOCKED and complete safe gaps.
12. Use only verified isolated `miljor_test_db` for mutable tests. Last observed identity was127.0.0.1:33322; the phase log subsequently reports shutdown, so inspect current state before use. Never mutate `miljor_db`/`miljor_sandbox_db`. Fresh/replay/restore/rollback evidence must match actual migration100 history; do not rewrite canonical096–099 or journals. Protected comparisons remain separate from unresolved historical user-drift attribution; do not publish private identifiers/secrets.
13. Review `.github/workflows/ucp-canonical-acceptance.yml`: mandatory Phase C, replacement, real browser and server-guard gates must execute with installed dependencies, deterministic owned ports, isolated DB guards and no silent skips. Browser installation in a developer's untracked node_modules is not reproducible CI setup. Preserve accepted existing gates and avoid repeated full suites.
14. Run only missing/affected checks after fixes stabilize, with one sufficient final consolidated phase gate. Preserve successful unchanged evidence and exact commands/durations/exit codes. Update the existing implementation report and phase log, reconcile provisional PASS text with remaining gaps and preserve prior failures as historical evidence. Maintain the original-requirement/code/test matrix.
15. Commit verified Phase1 source, tests, migrations, runner helper, workflow and evidence together on `plan/ucp-resilience-notification-coverage`. Check staged files for secrets/unrelated changes, fetch/inspect approved remote divergence without clobbering work, push normally and verify the remote SHA. Do not force-push or merge main. Obtain relevant CI result at the exact implementation SHA; resolve affected failures rather than claim old CI qualifies new code.
16. Report TASK / IMPLEMENTED / FILES / TESTS / EVIDENCE / DATABASE / UNRESOLVED / RESULT. Distinguish local PASS from exact-source CI, actual browser from synthetic callbacks, and proposal/consent from replacement execution. If no verified push/CI yet, Phase1 closeout remains PARTIAL. Completion Phase2 provider/finance/email/full UI and Phase3 source/migration/final readiness remain open. End `CAN START NEXT PHASE: NO` and stop.

Dispatch status: saved locally; submission to Antigravity not yet confirmed. Broad Antigravity window inspection was rejected by automatic review because unrelated private financial content was also open. A narrow relevant-conversation handoff approval is pending; do not claim this file was submitted or executed.

### Phase C Antigravity implementation handoff — 2026-11-17

User request: explain the next simple flow, then have Antigravity implement it completely. This authorizes the Phase C delivery increment on PR #54's existing branch, including verified commit/push. It does not authorize a main merge, protected-database changes, external money movement, or automatic progression into another phase.

**Simple flow:** eligibility -> accepted delivery mode -> compatible cluster and SQL cutoff -> supplier manifest -> individual buyer stops -> dispatch/ETA -> buyer receipt or partial claim -> failure/reattempt/reroute with the selected quote/consent policy.

**Execution location and baseline**

- Work only in `C:\Users\Umar Jameel\.codex\worktrees\ucp-resilience\MilJor`, branch `plan/ucp-resilience-notification-coverage`, repository `umarjameel12/miljor-b2b-marketplace`, PR #54. Do not use another active MilJor checkout.
- Handoff baseline: HEAD `5ba4116`; qualified implementation `1e3bc6c54b38112730da8e1e5e014d4b22683477`, accepted CI run `43973636310`; later documentation does not replace that source qualification. Verify actual HEAD/status before editing.
- Read current root/backend AGENTS, engineering protocol, business invariants, master plan, this plan, latest implementation report/phase log and relevant observations once. Preserve historical evidence and uncommitted work. Fetch the approved branch and inspect divergence; do not reset, force-push, merge main or pull a different feature branch.
- Inspect the actual delivery/fulfilment/quote/receipt/notification services, routes, callers, migrations (including 047/094) and affected UI once. Build a requirements-to-code-to-test matrix in the existing implementation report. Reuse existing engines; preserve distinctions between Regular/Flash and B6 RFQ/collective/recurring.

**Mandatory implementation checklist**

1. Validate address/service area, physical SKU, stock/payment/fulfilment eligibility and promised SLA on the server. Offer only supported Standard/Express/Pickup modes. Preserve accepted mode, fee and terms snapshots; no invented fees or addresses.
2. Group only compatible geography, handling constraints, supplier, time windows and capacity. Enforce cutoff with a fresh database clock after required locks. Define deterministic run/stop membership and prevent duplicate allocation under concurrent workers. Published pool delivery clusters and commercial snapshots remain immutable.
3. Implement owning-supplier manifests and per-order stops through existing delivery primitives. Expose only information authorized by current privacy rules; do not widen access to buyer identities/addresses without an authoritative rule. Buyers see only their own stop. Reject wrong supplier/buyer/admin mutations.
4. Integrate legal run/stop transitions, dispatch, meaningful ETA changes and individual receipt. Require existing payment/fulfilment gates. Pickup verification must use the existing secure claim mechanism without leaking codes in events/email.
5. Record accepted, missing/rejected and disputed quantities without overwriting ordered quantities or historical evidence. Prove the 100 ordered / 80 accepted / 20 disputed case. Supplier-only delivery marks cannot authorize settlement. Use existing financial policy for accepted quantities; any unsupported fee/tax/settlement rule must fail closed and be reported, not guessed.
6. Implement failed attempt, reason/evidence, bounded reattempt and reroute workflows with legal state checks. Use append-only versioned amendments rather than editing locked pool/order terms. Apply the selected cost/consent policy above: buyer-requested extra cost requires exact fresh quote/version acceptance; supplier/carrier failure adds no compulsory buyer charge. Decline, expiry or silence is never consent. No automatic subsidy, liability debit, cancellation penalty or external charge/refund/payout.
7. Bind every amendment to owning buyer/order/supplier, SKU, old/new exact amounts, reason/responsibility, ETA, expiry, quote version/hash and idempotency identity. Revalidate ownership, eligibility, expiry and exact consent after locks. Consent alone does not prove payment or permit a second allocation. Full supplier replacement execution remains Phase D.
8. Emit meaningful committed delivery actions through the existing transactional UCP notification adapter/outbox: cluster formation/cutoff, dispatch, ETA change, attempted/failed, receipt confirmation, partial/shortage/dispute, reattempt/reroute proposal/decision/execution and SLA breach where implemented. Map affected recipients and v2 metadata, verify rollback emits nothing and replay emits once. Follow critical in-app/email overrides and optional routine-email preferences. No per-tick spam or sensitive payloads.
9. Connect existing buyer/supplier/admin screens and APIs for this flow, including unavailable/expired/declined/stale states and recovery after reload. Preserve existing visual design and backward compatibility. Admin recovery must be authorized and audited; it cannot fabricate buyer consent or supplier publication.
10. Add forward-only migration/rollback only if needed, inspect current prefixes/journals first, preserve legacy rows and nulls. Prove fresh install, replay and restored-schema upgrade in isolated `miljor_test_db` when migrations change. Never rewrite historical migrations or journals. Preserve canonical UCP 096/097/098 and do not blindly integrate concurrent Smart Hub work.

**One consolidated phase acceptance gate**

- Before mutations assert actual connected database is `miljor_test_db` on the owned isolated instance; never use `miljor_db` or `miljor_sandbox_db` for tests. Capture protected-DB read-only before/after comparison privately; do not publish account/incident identifiers or credentials.
- Cover actual multi-buyer API/SQL journeys for all supported modes, compatible/incompatible grouping, exact cutoff and lock-wait crossing, per-stop fees and privacy, dispatch/ETA, individual/partial receipts, failure/reattempt/reroute and admin recovery.
- Include wrong-role/owner, malformed quantities/money, illegal transitions, stale/expired/declined/wrong-quote consent, duplicate and concurrent run creation/dispatch/receipt/amendment, stock allocation races, transaction/outbox rollback and worker crash/replay. Assert no oversell, double fee/settlement, peer data leakage or false payment confirmation.
- Run affected existing stock/payment/fulfilment/notification regressions and the stable Phase A/B contract where shared dependencies changed. Select the fastest sufficient consolidated gate; do not repeatedly run the full master suite. Mandatory fixtures cannot silently skip.
- For changed UI run the relevant production build and an actual multi-buyer clustered browser journey, including partial receipt and reload/error recovery. Mock/browser-unavailable checks are not browser PASS. Actual SMTP inbox and live Safepay proof remain separately labelled NOT_TESTED/BLOCKED until observed.
- Close owned pools/servers/timers naturally; clean only owned test fixtures. Record exact commands, durations, exit codes, DB identity, assertions and artifacts. On failure fix the root cause, rerun affected checks, then reverify the consolidated gate after stabilization.
- Update the existing `MILJOR_UCP_RESILIENCE_NOTIFICATION_IMPLEMENTATION_REPORT.md` and `MILJOR_PHASE_LOG.md` with changed files, implementation/test matrix, exact source SHA, migration evidence, protected-data comparison and all remaining blockers. Record applied skills and outcomes. Commit/push verified changes only to the approved branch; confirm remote SHA and relevant exact-source CI results. Do not claim full release readiness from a Phase C pass.
- Final report: TASK / IMPLEMENTED / FILES / TESTS / EVIDENCE / DATABASE / UNRESOLVED / RESULT (PASS, PARTIAL, FAIL or BLOCKED). Retain separate Phase D replacement, E provider, F actual inbox/mobile/RTL and G main/migration-integration blockers. End `CAN START NEXT PHASE: NO` and stop.

**Handoff status:** Prepared, not dispatched. Antigravity was found running, but opening its window returned `Computer Use app approval timed out`; no task was submitted and no Phase C implementation/test result is claimed. This section is an executable handoff checklist, not completion evidence.

- All mutable tests only on isolated `miljor_test_db`; protected original database read-only checksums before/after.
- One consolidated affected gate after stabilization; targeted reruns for actual failures only. Preserve the prior accepted evidence separately.
- Replay/ownership/negative/concurrent stock and financial checks, real migration install/idempotent replay/backup restore, real provider sandbox/email evidence where available, production frontend build and browser journeys.
- Update the existing implementation report and phase log, then commit/push verified changes on the approved branch. Report PASS/FAIL/BLOCKED honestly; catalog presence and mock callback success are not actual provider acceptance.

Status: Smart Hub integration explicitly approved by the user ("Approve integration into PR #54"). Source integration and the implemented reliability/notification increment have passed the local affected gate. Full master-plan release remains PARTIAL/BLOCKED; see the current dated section in the existing implementation report. No main merge or shared database migration authorized. CAN START NEXT PHASE: NO.

## Completion Phase 3 — Source/Migration Reconciliation & Integration Proposal (2026-11-17)

- **Inspected SHAs (read-only `git fetch` & `git merge-tree --write-tree`, zero working-tree merge executed):**
  - PR #54 `HEAD`: `fb16b649111ce7ce0702f3daf50c3e5908e7cea3` (`plan/ucp-resilience-notification-coverage`, CI run `44123502063` **SUCCESS**).
  - Current `origin/main`: `9c0a81979b852198c04c00de42ba763a1aa09c2f` (1 content conflict in `backend/src/services/emailService.js`; zero `090`–`101` migrations on `main`).
  - Current `origin/feature/smart-procurement-hub-unified-entry`: `b92a6889029cd721a13ae581fe14dd031f27aad6` (9 content conflicts + `096`–`100` migration prefix overlap).
- **Proposed Non-Destructive Integration Order (requires explicit user merge authorization before execution):**
  1. Reconcile `origin/main` (`9fb07cf9274509c1686b68b5bf8bdd91bd26718f`) into `plan/ucp-resilience-notification-coverage` (**0 conflicts** verified via `git merge-tree --write-tree HEAD origin/main` -> tree `a5651170630a80f618a14434e1268403faabf63c`, since merge-base `0f108fe` already incorporated `main`'s `emailService.js` and `origin/main` only updated 6 frontend landing/auth files).
  2. Integrate `origin/feature/smart-procurement-hub-unified-entry` (`a0b6ea3fdd8f0ab76d581977cca5ec6c16f12183`) only after explicit cross-branch merge authorization: resolve the 9 content conflicts behaviorally (without deleting either branch's invariants) and renumber Smart Hub's unapplied branch-only migrations (`095_collective_individual_commitments.sql`, `096`–`100`) to `102`–`107` (or vice-versa if Smart Hub merges to `main` first). Never rewrite applied `schema_migrations` journals.
  3. Complete external release blockers (completed Safepay sandbox card payment + fee/refund proof, authorized SMTP test-mailbox receipt) before removing `RELEASE BLOCKED`.

### Concrete Integration Approval Package (2026-11-17)

1. **Actual Branch & Ref SHAs (inspected via `git fetch origin --prune` & `git ls-remote`):**
   - `plan/ucp-resilience-notification-coverage` (`HEAD` / remote): `4860045dff2166ce62f1bc53495876746136927d` (last qualified app source: `fb16b649111ce7ce0702f3daf50c3e5908e7cea3`, CI run [`44123502063`](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/44123502063) `SUCCESS`).
   - `origin/main`: `9fb07cf9274509c1686b68b5bf8bdd91bd26718f` (merge-base with `HEAD`: `0f108fec64e5611e79a2766427073bcea085fbd1`).
   - `origin/feature/smart-procurement-hub-unified-entry`: `a0b6ea3fdd8f0ab76d581977cca5ec6c16f12183` (merge-base with `HEAD`: `08a9d87809a1c3683074500d20f6a14fb5c41781`).
2. **Exact Integration Order & Separate Authorizations:**
   - **Action A (Authorized separately):** `git merge --no-ff origin/main` into `plan/ucp-resilience-notification-coverage` (0 conflicts), run affected frontend build + UCP gates on `miljor_test_db`, push to `plan/ucp-resilience-notification-coverage`.
   - **Action B (Authorized separately):** Merge `origin/feature/smart-procurement-hub-unified-entry` (`a0b6ea3`) into `plan/ucp-resilience-notification-coverage` (or a dedicated integration branch), apply the 9 behavioral conflict resolutions + migration renumbering (`102+`), run full migration + application + browser gates on `miljor_test_db`.
   - **Action C (Authorized separately):** Merge PR #54 into `main` only after Actions A/B, exact-source CI, and release-gate sign-off.
3. **Resolved Source Conflict Proposals (Behavior-Preserving):**
   - **`origin/main` (`9fb07cf`):** `git merge-tree` produces 0 conflicts (`emailService.js` has 0 conflict hunks; `main` only touched 6 frontend landing/auth files since `0f108fe`).
   - **`origin/feature/smart-procurement-hub-unified-entry` (`a0b6ea3`) — 9 conflicts:**
     - `backend/src/services/notificationService.js`: Keep UCP v2 preference/quiet-hours/digest/inbox/dead-letter logic AND preserve Smart Hub `CYCLE_CUTOFF_UPCOMING` stale-reminder suppression (`recurringReminderPolicy.isCurrent`) + `reminderContext` forwarding.
     - `backend/src/services/safepayCheckoutService.js`: Keep UCP webhook secret/attempted-payment/idempotency hardening AND preserve Smart Hub `AND procurement_delivery_contract_id IS NULL` attempt scoping, `verifyWebhookSignatureScope`, `MISSING_WEBHOOK_EVENT_ID`, and `notification` envelope extraction.
     - `backend/src/services/schedulerService.js`: Keep UCP timer/recovery jobs AND preserve Smart Hub `procurementCollectiveCommitmentService.releaseExpiredBatch({limit:20})` + `procurementRecurringService.runReminderBatch({limit:20})`.
     - `backend/src/services/supplierDeliveryService.js`: Keep UCP delivery mode guards AND preserve Smart Hub `INDIVIDUAL` delivery mode, `individual_delivery_enabled`, `FOR UPDATE` config serialization, and exact decimal cluster fee validation.
     - `backend/tests/email_outbox_queue_gate.js`: Keep UCP outbox lease/backoff/claim-token assertions AND preserve Smart Hub `recurringReminderPolicy` mock + `STALE_REMINDER_SUPPRESSED` test case.
     - `frontend/src/pages/AdminDashboardPage.jsx`: Keep UCP admin cards AND preserve `AdminProcurementSettlementReview` for `ADMIN`/`SUPER_ADMIN`/`FINANCE_ADMIN`.
     - `frontend/src/pages/OrdersPage.jsx`: Keep UCP order/delivery/replacement UI AND preserve `SupplierDeliveryRuns`, `ProcurementReliabilityReport`, and `ProcurementOrderOperations` (`PAID` orders).
     - `frontend/vite.config.js`: Support both `PHASE2_BROWSER_API_PORT` / `PHASE1_BROWSER_API_PORT` and `MILJOR_TEST_API_PORT` when `NODE_ENV === 'test' && DB_NAME === 'miljor_test_db'`.
     - `backend/docs/MILJOR_PHASE_LOG.md`: Append chronologically; never erase historical entries.
4. **Frozen Exact Migration Mapping (`090`–`106`, ambiguity resolved):**
   - `095` is free on PR #54, so `095_collective_individual_commitments.sql` stays at `095`. PR #54's `096`–`101` stay immutable. Smart Hub's unapplied `096`–`100` renumber cleanly to `102`–`106`:

| Original branch/path | Semantic purpose | Applied-history evidence | Final path/version | Upgrade handling |
|---|---|---|---|---|
| `HEAD` & Smart Hub `090_smart_procurement_product_counteroffers.sql` .. `094_procurement_delivery_binding.sql` | B6 counteroffers, cadence, notification delivery, email claims, delivery binding | Byte-for-byte identical on both branches; unapplied on `miljor_db` (`054`) | `090`–`094` (unchanged) | Fresh + `054->106` apply sequentially |
| Smart Hub `095_collective_individual_commitments.sql` | Collective individual commitments | Unapplied on `miljor_db` (`054`) & absent on `HEAD` | `095_collective_individual_commitments.sql` | Fresh + `054->106` apply; PR #54 `101` upgrade bridge applies `095` if absent |
| `HEAD` `096_ucp_recovery_cursor.sql` .. `101_ucp_replacement_supplier_offer_and_qty_binding.sql` | UCP recovery, notification controls/events, Phase C delivery, replacement recontracting | Applied in `miljor_test_db` (`33322`); unapplied on `miljor_db` (`054`) | `096`–`101` (immutable) | Never renumbered; preserved in place |
| Smart Hub `096_delivery_operations_and_evidence.sql` | Delivery operations & evidence | Unapplied on `miljor_db` (`054`) | `102_delivery_operations_and_evidence.sql` | Renumbered pre-apply; Smart Hub-already-applied DBs require forward bridge, never journal rewrite |
| Smart Hub `097_procurement_line_receipts.sql` | Procurement line receipts | Unapplied on `miljor_db` (`054`) | `103_procurement_line_receipts.sql` | Same as `102` |
| Smart Hub `098_individual_procurement_delivery_pricing.sql` | Individual procurement delivery pricing | Unapplied on `miljor_db` (`054`) | `104_individual_procurement_delivery_pricing.sql` | Same as `102` |
| Smart Hub `099_procurement_financial_reviews_and_delivery_payments.sql` | Procurement financial reviews & delivery payments | Unapplied on `miljor_db` (`054`) | `105_procurement_financial_reviews_and_delivery_payments.sql` | Same as `102` |
| Smart Hub `100_delivery_payment_initialization_recovery.sql` | Delivery payment initialization recovery | Unapplied on `miljor_db` (`054`) | `106_delivery_payment_initialization_recovery.sql` | Same as `102` |

5. **Expected Resulting Behavior:** Unified Regular/Flash UCP resilience, delivery runs, partial receipts, replacement re-contracting, B6 RFQ/collective/recurring/individual procurement, and durable notifications with zero `DUPLICATE_MIGRATION_VERSION` errors.
6. **Verification Already Performed on Preview:**
   - Tested in detached temporary preview worktree merging `origin/main` (`9fb07cf`, 0 conflicts) + `origin/feature/smart-procurement-hub-unified-entry` (`a0b6ea3`, all 9 conflicts resolved + `102`–`106` renumbered):
     - `node database/migrationManifest.js`: **PASS** (`71` migrations).
     - `node -c` on all 5 resolved backend JS files: **PASS**.
     - `node tests/email_outbox_queue_gate.js`: **PASS** (`31/31`, `0` skipped, including `STALE_REMINDER_SUPPRESSED`).
   - Inspectable resolved patch saved at `backend/docs/patches/ucp_main_smarthub_integration_preview.patch`.
7. **Remaining Tests After Integration:** Fresh + replay + `054`-upgrade migration test on `miljor_test_db`, `ucp_final_affected_gate.js`, `ucp_phase1_delivery_browser_gate.js`, `ucp_phase1_replacement_gate.js`, `ucp_phase2_finance_integrity_gate.js`, `ucp_phase2_email_gate.js`, `ucp_phase2_full_ui_browser_gate.js`, frontend production build (`npm --prefix frontend run build`), and exact-source CI.
8. **Recovery Approach:** Pre-integration `git tag` / branch backup + `mysqldump` pre-flight backup before any schema upgrade; never `reset --hard` or rewrite `schema_migrations` journals.

### Combined Master-Plan Execution Checklist (2026-11-17)

| Item | Dependency | Existing evidence | Remaining action | Owner | Status |
|---|---|---|---|---|---|
| Main integration (`9fb07cf`) | User Approval A | `git merge-tree` `0` conflicts + detached preview clean merge | Execute `git merge --no-ff origin/main` after Approval A | User (approval) -> Agent | **PREVIEWED / BLOCKED ON APPROVAL A** |
| Smart Hub integration (`a0b6ea3`) | User Approval B | `ucp_main_smarthub_integration_preview.patch` + `email_outbox_queue_gate.js` `31/31` PASS | Execute merge + apply resolved patch + `102`–`106` after Approval B | User (approval) -> Agent | **PREVIEWED / BLOCKED ON APPROVAL B** |
| Exact migration mapping (`090`–`106`) | Smart Hub integration | `migrationManifest.js` PASS (`71` migrations) on preview; `miljor_db` at `054` | Apply after Approval B | Agent | **FROZEN / READY** |
| Fresh / replay / upgrade proof | Integrated source | `001`–`101` fresh install PASS (`65` applied on `33322`) | Run fresh + replay + `054->106` upgrade on `miljor_test_db` post-merge | Agent | **BLOCKED ON INTEGRATION** |
| Post-integration app/browser acceptance | Integrated source | `174e71b` Mobile/Urdu UI browser gate PASS; `fb16b64` CI `44123502063` PASS | Re-run consolidated gate + frontend build post-merge | Agent | **BLOCKED ON INTEGRATION** |
| Completed Safepay sandbox payment | Human PCI/3DS entry | Order `UCP-SBX-346827a7b8ed` (`PKR 100.00`) `TRACKER_STARTED` + checkout URL ready | User completes hosted sandbox card/3DS; Agent verifies `fetchTracker` & webhook | User (card/3DS) -> Agent | **PREPARED / BLOCKED ON HUMAN STEP** |
| Provider fee/refund capability | Completed sandbox payment | Synthetic refund/fee & `SUPPLIER_DELIVERED` guard PASS | Verify actual Safepay sandbox fee/refund API/dashboard capability post-payment | Agent (post-payment) | **BLOCKED ON SANDBOX PAYMENT** |
| Actual SMTP inbox receipt | Authorized test mailbox | `smtp.gmail.com:587` configured (`EMAIL_MODE=smtp`); capture gate PASS | User supplies 1 non-business test mailbox; send critical + optional EN/UR & verify | User (mailbox) -> Agent | **PREPARED / BLOCKED ON MAILBOX** |
| Notification/event coverage | None | `notificationService`, `notificationOperationsService`, `ucp_phase2_email_gate.js` PASS | Re-verify `CYCLE_CUTOFF_UPCOMING` post-Smart-Hub merge | Agent | **TESTED / PRE-MERGE PASS** |
| Exact-source CI | Final code commit | `174e71b` CI `44143100844` PASS; `fb16b64` CI `44123502063` PASS | Run & verify CI on integrated commit SHA | Agent / GitHub Actions | **PASS AT `174e71b` / PENDING POST-MERGE** |
| Historical `users`-drift attribution | Read-only forensics | `miljor_db.users` `id=52` (`2026-11-17T10:35:32Z`–`10:36:12Z`) observed; `orders/payments/ledger=0` | Non-blocking separate operational investigation | Operations | **UNRESOLVED (NON-BLOCKER)** |
| Final readiness | All above | `miljor_db` pristine; PR #54 unmerged | Complete integration, sandbox payment, and SMTP inbox proof | User + Agent | **PARTIAL / NOT RELEASE-READY** |

CAN START NEXT PHASE: NO
