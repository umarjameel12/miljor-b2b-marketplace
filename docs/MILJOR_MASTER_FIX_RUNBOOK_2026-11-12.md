# MILJOR — MASTER FIX, RECONCILIATION & RELEASE ACCEPTANCE RUNBOOK
**Date:** 2026-11-12
**Target repository:** `umarjameel12/miljor-b2b-marketplace`
**Execution mode:** ONE bounded phase at a time; isolated implementation branch/worktree; explicit PASS/FAIL/BLOCKED gate.
**Authority:** Root `AGENTS.md`, `backend/AGENTS.md` where present, `backend/docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md`, `backend/docs/MILJOR_BUSINESS_INVARIANTS.md`. This document is an execution checklist, NOT permission to override those rules.

## 0. Scope and reality check
This file covers only previously identified MilJor gaps. It is not evidence that any task is finished, nor a claim that a different chat's agent is currently executing. At start of every phase inspect current GitHub PR/branch/check statuses and actual files; classify `PASS / FAIL / BLOCKED / ALREADY_RUNNING_ELSEWHERE / SUPERSEDED`. Never guess status. New commits may have appeared since 2026-11-12.

**Business scope:** Lahore B2B buyers (restaurants/caterers/kiryana/bakeries), verified suppliers, supplier-specific SKU/specifications (E2 Option B: material physical spec change requires NEW SKU), group procurement, unified pool-only flow (Regular and Flash must not coexist as independently active public workflows), Safepay sandbox, supplier fulfillment, dispute- and buyer-confirmation-gated settlement.

**Observed at time this runbook was commissioned:** Source gates and frontend production build succeeded; disposable MySQL 8.0 migration install FAILED; real Chromium buyer/supplier auth/retry/offline journey FAILED. No root cause or eventual fix is asserted. Previous chat reports contain other partial PASS claims that require independent evidence and current-SHA verification.

## 1. Absolute non-negotiables
1. **NO blind merge, no direct main commits.** No git commit/push/merge/rebase without user's explicit authorization for that specific git operation; creating this instructions file is not authorization for subsequent code pushes.
2. **Protect parallel work.** Identify open PRs, commits, CI, worktree changes, and owner of UCP3–5, B6, B7, P0 financial, E2, independent backend work before editing. Mark `ALREADY_RUNNING_ELSEWHERE`; do not reproduce or overwrite it. Review completed results for integration only after an owner hands them off. Never assume branches are ready because they exist.
3. **Strict DB boundaries.** Real `miljor_db` is read-only without separate explicit user approval. Only isolated disposable `miljor_test_db` may run migrations/seed/destructive test fixtures. Verify environment name before *every* migration or wipe. Back up and capture schema/version + table-count baselines; protect user data, audit logs, financial rows, history, and migration ledger.
4. **Financial safety.** Safepay SANDBOX ONLY. No live charges/refunds/payouts. No settled/paid state from client redirect. Server-side signature and provider verification mandatory; failure must be fail-closed. Ledger immutable and reconciled. Preserve historical price/fee/commission snapshots.
5. **Security & correctness.** Explicit RBAC, object ownership, no buyer PII leakage, idempotency keys, concurrent row locking, append-only audit events, verified supplier eligibility, exact quantities, proper rounding, deterministic UTC/storage vs Lahore display.
6. **Tests must be real.** No mocking away external verification in a claimed provider E2E; if real sandbox credentials inaccessible, mark BLOCKED, run separate hermetic contract tests and do not claim full PASS. No relaxed assertions, fake CI statuses, manual DB inserts into protected DB, force-green flags, or skipped failing tests.
7. **One actual execution phase per invocation.** This file is permission to plan/inspect, NOT automatic permission to begin every phase. After each phase output `CAN START NEXT PHASE: NO`; wait for a new instruction with phase ID. Independent read-only inventory can be grouped into one initial prompt.

## 2. Single-prompt maximum safe workload
A **single Antigravity prompt may safely handle**: read-only inventory + branch/PR/CI status comparison + impact map + a tightly coupled repair slice (e.g., disposable MySQL migration runner installation/ordering **or** Chromium retry/offline journey), focused tests + relevant integration tests + phase report. Do not attempt ALL UCP/B6/B7/finance/migration/browser fixes in a single uncontrolled edit; these share migrations, order state, money and PR overlap, inviting data loss and merge races. The maximum is defined by a verified ownership boundary and tests, NOT token count, arbitrary file count, or wall-clock time.

For an **execution phase**, the agent must:
A. Reconfirm current SHA/PR/test ownership, read the relevant authoritative invariants, print short impact map.
B. Classify `ALREADY_RUNNING_ELSEWHERE` and skip overlapping writes; wait for owner handoff or work on a truly independent failing slice.
C. Reproduce issue on clean test environment. Log exact command, failing assertion/stack trace, and root cause; no speculative fix.
D. Implement the complete vertical slice: DB contract/migration if needed -> domain logic -> auth -> API -> UI when relevant -> recovery/error handling -> focused tests/docs.
E. Run targeted tests, integration/negative tests, and concurrency/browser tests when risk requires; verify fresh exits, no open handles.
F. Write phase report with before/after and remaining blockers, stop. Do not auto-advance.

## 3. Source of truth and handoff files
Existing: `AGENTS.md`, `backend/AGENTS.md` (if exists), `backend/docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md`, `backend/docs/MILJOR_BUSINESS_INVARIANTS.md`, `backend/docs/MILJOR_OBSERVATIONS_REGISTER.md` (if exists), existing migrations/test harness/workflow YAML.
Write/maintain on permitted working branch:
- `backend/docs/MILJOR_MASTER_FIX_PHASE_LOG.md` — table: phase, start SHA, owned paths, exact command, result, evidence, new SHA if permitted, pending blockers, next action. Append and preserve audit trail.
- `backend/docs/MILJOR_MASTER_FIX_CONFLICT_MATRIX.md` — for every relevant branch/PR: SHA, owner, paths/migration numbers, conflict, canonical implementation, acceptance evidence, decision, handoff.
- `backend/docs/MILJOR_MASTER_FIX_RELEASE_REPORT.md` only at final gate, with results linked to CI/artifacts.
Do not invent absent files or claim reports existed if they do not. Do not duplicate older reports; cross-reference when possible.

## 4. Ordered phases and exact acceptance gates

### P0 — READ-ONLY reality check, ownership & dependency map (FIRST)
**Inspect:** main HEAD, open PRs/branches for UCP3–5 (including `feature/ucp-canonical-reconciliation-release`, `feature/unified-pool-only-workflow`), B6 (`feature/b6-*`), B7 fulfillment, P0 finance (`fix/p0-*`, `integration/p0-b6-finance-migrations-046-052`), independent integrity, E2, CI/workflow logs; worktree cleanliness; existing applied migration metadata **read-only**.
**Map:** changed-file collision matrix, migration 046–052 names/checksums/order, overlapping services, historical schema upgrade path, timing/owner of concurrent tasks. Distinguish `FAIL` from `UNKNOWN`. Do not alter branches or DB. **PASS:** explicit ownership table, exact SHAs and source CI run URLs, failing test identification, prioritized owned repair slices, no writes. If PR/tool access incomplete mark BLOCKED and cite missing item.

### P1 — Disposable MySQL 8.0 CI installer & runner repair
**Owner:** CI/database test harness only; do not alter domain migrations unless handed off from their owner. Reproduce the exact failed workflow from its current commit in a disposable MySQL 8.0 with explicit `miljor_test_db`. Check service readiness, authentication/grants, env secret mapping, DB name enforcement, charset/collation, runner resource cleanup, migration discovery/order and first failing SQL. Compare fresh install vs upgrade separately. Correct actual failure; do not silence SQL errors or bypass migrations. Test zero production mutation and repeatable clean install. **PASS:** same clean MySQL workflow job green on relevant SHA; migration ledger complete without duplicates/gaps; repeat install/rollback behavior documented; no fixture leak. If migration-number conflicts belong to UCP/finance active owner, mark dependency BLOCKED instead of secretly renumbering.

### P2 — Chromium real browser auth, retry, refresh, offline journey
**Owner:** browser runner/fixtures and safe non-overlapping auth/UI fixes. Reproduce the failed CI job with real Chromium and inspect traces/screenshots/network logs. Test buyer and supplier login/logout, correct role routing, refresh token/session behavior, offline/reconnect, API 401/403, failed/pending requests, idempotent retry of mutations, no repeated payment, no persistent stale success UI, deterministic teardown (browser/server/MySQL). Fix *root cause* (race, timeouts, invalid fixture, endpoint, browser dependencies); no blindly enlarged timeout or removed assertions. **PASS:** real Chromium job green at tested SHA, reproducible locally/CI, zero real-payment traffic, both roles validated on same origin/API version.

### P3 — Canonical schema/migration 046–052 reconciliation (WHEN owners hand off)
**Preconditions:** UCP/B6/finance owners report completed PR SHAs and safe handoff. Compare all migration DDL, indexes, constraints, stored procedures, backfill and ledger checksums; produce a canonical **non-destructive forward-only** ordering. Never rewrite migrations already applied to historical DBs without explicit upgrade compatibility strategy; where safe use a new monotonic migration with idempotent guards, re-entrant safety, historical upgrade tests. Preserve all rows and fee snapshots, reconcile supplier SKU versioning. **PASS:** fresh DB + representative historical upgrade fixtures both pass; actual migration checksums recorded; repeatable on disposable DB; no duplicate number/collision and no accidental downgrade; protected DB untouched.

### P4 — Canonical UCP 3–5 unified-pool acceptance (OWNER-HANDOFF ONLY)
**Do NOT independently build while another UCP chat owns it.** On handoff, validate that Regular and Flash are *modes of one canonical unified pool*, not separate public active workflows; legacy entry points are safely redirected/deprecated with audit/migration compatibility. Test publication, supplier inventory ceiling, verified supplier, buyer MOQ vs supplier MOQ, tier pricing, immutable order price lock, reservation/confirmation, both countdowns (pool participation expiry; buyer payment hold), shorter Flash time, target/time close semantics, cancellation, out-of-stock races, expiration, quote/order emission, Lahore UI timezone and safe background jobs. Test parallel B4+B5 same SKU no oversell. **PASS:** API/DB/browser/negative/race tests on canonical flow; no independently callable legacy bypass; no double fulfillment or double payment.

### P5 — Finance + Safepay sandbox reconciliation and commercial safety
**Preconditions:** canonical schema and UCP contracts stable. Cover order-before-payment, signed provider callbacks, server verification, malformed/wrong signature, duplicate/out-of-order/replayed events, failed/late callbacks, concurrent buyer confirmation, timeout/retry, payment pending/hold, escrow-like internal ledger state (not an unlicensed escrow claim), refund obligations, no payment without eligible order, no balance release on supplier-only completion. Reconcile historical fee/commission snapshot, supplier subscription, listing/verified/promotion billing rules only where existing scope already agreed. For real sandbox end-to-end require actual configured sandbox verification; otherwise BLOCKED + hermetic tests separately. **PASS:** money invariant SQL assertions, no duplicate ledger/refund/order, callback proof and transaction logs redacted, rollback and recovery verified.

### P6 — B6 RFQ award to fulfillment
**Do NOT duplicate B6 owner code.** Once handed off verify private RFQ/quotes, supplier eligibility, award authorization, quote immutability after acceptance, order linkage, payment status, order visibility in correct supplier fulfillment inbox, split supplier ownership and exact itemization. Unauthorized buyer/supplier access must fail closed. Concurrent award/retry cannot double-award or double-charge. **PASS:** DB/API/role/browser flows on actual code; same RFQ award and resulting order IDs trace across layers.

### P7 — B7 postpurchase, partial delivery, invoices, disputes, settlement sync
**Do NOT duplicate B7 owner work.** For 100kg ordered/80kg delivered, persist exact 20kg shortage with unit/grade, responsible supplier, resolution state and financial hold/refund/replace decision. Multi-product and split-supplier invoices must show correct line-item unit, tax/fees only if applicable, delivery per buyer/supplier, rounding and totals. Supplier delivered != buyer confirmed; no premature settlement. Support disputed, partially accepted, rejected, expired-response and reconciliation states; prevent fabricated buyer confirmations; track proof and audit logs. Real buyer/supplier postpurchase browser journey required. **PASS:** deterministic sum invariants and no premature payouts, robust negative tests.

### P8 — E2 supplier-specific specifications Option B and catalog integrity
**When E2 work is handed off:** supplier sets own brand/grade/variety/packaging subject to moderation; after publishing material physical specifications are immutable — require new SKU/listing for material changes. Price/stock edits follow existing permitted rules without rewriting historical commercial quotes/orders. Moderation, unpublish, uniqueness, buyer search, supplier ownership, invoice/spec snapshot and migration tests. **PASS:** no silent change of an existing order's purchased goods; new SKU behavior verified for API/UI/DB/history; malicious update rejected.

### P9 — Full system regression, release gate, merge plan (LAST, explicit authorization)
Run after all owned phase gates PASS and dependencies landed, on one clean integration SHA. Focused functional/role negative tests, MySQL fresh + historical upgrade, provider sandbox verification, concurrency (same-SKU, competing awards/stock, idempotent callbacks), real buyer/supplier Chromium auth/offline/postpurchase, delivery/disputes, invoice reconciliation, frontend production build, security regression. Execute `node tests/master_regression_runner.js` once only when explicitly authorized and env safe. Check logs for dangling open handles and unexplained skips. Produce canonical PR-by-PR conflict-free merge order; **do not actually merge/push without user approval**. **PASS:** all mandatory gates green at SAME commit with evidence; protected DB unchanged; critical blockers zero; rollback/recovery playbook and outstanding non-blocking limitations documented. Otherwise FAIL/BLOCKED.

## 5. Priority ordering and allowed parallelism
**Priority:** P0 -> P1 (CI database installation) and P2 (browser) can be implemented in separate isolated worktrees if their exact files do not overlap -> P3 after owner handoff -> P4/P5 after schema stability -> P6/P7 on stable commercial contracts -> P8 E2 (if not running elsewhere) -> P9. Actual owners may complete in a different chronological order; integrate according to dependencies not timestamps. Never run same-SKU migration writers or shared DB destructive fixtures concurrently. No dual writers to same service/file. Release blocker priority: (1) migration correctness; (2) payments/ledger security; (3) stock oversell / order ownership; (4) UI journey/operational correctness; (5) documentation polish.

## 6. Detailed acceptance matrix (minimum, augment based on real code)
| Area | Must prove |
|---|---|
| DB | MySQL8 fresh install, historical upgrade, migration checksums/uniqueness, isolation |
| Auth | Buyer/supplier roles, refresh, 401/403, access to only own orders, session expiry |
| UCP | one canonical workflow, tiers, precise time/expiry and payment hold, concurrency, no duplicate orders |
| Catalog | E2 new SKU on physical specification change, snapshots immutable |
| Inventory | same-SKU B4/B5 publication stress, serializable capacity, no oversell |
| Safepay | actual sandbox verified signature + authoritative status, webhook replay/late/failure, refund recovery |
| Finance | immutable fees/snapshots, balanced ledger, no premature settlement |
| RFQ | authorized private quotes/awards, payment -> fulfillment linkage, award retry safety |
| Delivery | partial shortages, buyer confirmation, disputed/undelivered nonsettlement, clustered routing/pickup when applicable |
| Invoice | split supplier/item exact arithmetic, statuses, no double fee |
| Browser | Chromium full purchase / auth / offline / refresh / recovery, buyer & supplier |
| Release | build and relevant CI at same SHA, no unowned production mutation, clean PR integration |

## 7. Deterministic per-phase operational procedure
1. Read this file and applicable policies. Inspect `git status --porcelain`, branch SHA, `git worktree list`, open PR owners and latest CI. **Never reset/stash another person's changes.**
2. Record `PHASE_ID`, `BASE_SHA`, `OWNER`, `FILES_ALLOWED`, `ALREADY_RUNNING_ELSEWHERE` and exact `ACCEPTANCE`; explain blocked dependencies.
3. Choose isolated worktree/branch with owner approval as required; prevent writes outside owned set. No automatic commit/push/merge/rebase.
4. Capture DB safety proof: exact connection/database name, no production credentials in tests, baseline/migration ledger.
5. Reproduce tests, map root cause, implement minimally but end-to-end, negative and retry tests, logging/evidence without secrets.
6. Run focused tests; impacted suites as needed. Do not run the final master regression before P9. On failure: fix smallest root cause, rerun failed suite, then impacted suite.
7. Update exact phase log and conflict matrix, include changed files, command, exit status, test count, migration checks, CI URL, comparison before/after. Only claim `PASS` for verified evidence.
8. Stop and print `CAN START NEXT PHASE: NO`. Request user to specify the next phase. Never silently launch another phase.

## 8. Agent response contract after EACH phase
```text
MILJOR MASTER FIX — PHASE P#
BASE_SHA:
CURRENT_SHA:
OWNER / WORKTREE:
FILES CHANGED:
REPRODUCTION / ROOT CAUSE:
IMPLEMENTATION:
TEST COMMANDS + PASS/FAIL COUNTS:
CI RUN / URL:
DATABASE NAME + ISOLATION EVIDENCE:
PROTECTED miljor_db MUTATIONS: ZERO / UNKNOWN (not fake ZERO):
CONFLICTS & ALREADY_RUNNING_ELSEWHERE:
PENDING DEPENDENCIES:
FINAL GATE: PASS | FAIL | BLOCKED
CAN START NEXT PHASE: NO
```

## 9. Exact Antigravity commands (paste as independent messages, one at a time)

**START — P0 only**
```text
Read docs/MILJOR_MASTER_FIX_RUNBOOK_2026-11-12.md in GitHub branch docs/miljor-master-fix-runbook-20261112 (or its checked-out local equivalent). Respect root/backend AGENTS.md and backend/docs engineering protocol/business invariants. Execute ONLY Phase P0 read-only: check actual PR/branch SHA owners, current CI failure logs, UCP/B6/B7/P0-finance/E2 overlap, migration 046–052 conflicts, protected DB read-only baseline, and create a factual conflict matrix plus prioritized ownership list. No source edits, no migrations, no git mutations. Show evidence and conclude CAN START NEXT PHASE: NO.
```

**NEXT — P1 only** (only after P0 shows P1 is not owned by other running agent)
```text
Execute only P1 of docs/MILJOR_MASTER_FIX_RUNBOOK_2026-11-12.md on an isolated permitted working branch. Diagnose and fix disposable MySQL 8.0 migration installation CI, verify miljor_test_db isolation and fresh + history upgrade where appropriate, run focused reproducible tests, provide exact error/root cause/commands/results and phase log. Do not touch active UCP/B6/finance owner files or production database. Do not git commit/push/merge without explicit approval. STOP after phase gate.
```

**NEXT — P2 only**
```text
Execute only P2 of docs/MILJOR_MASTER_FIX_RUNBOOK_2026-11-12.md: reproduce and repair actual Chromium buyer/supplier auth, refresh, retry and offline CI journey, including resource cleanup and negative cases. Stay in assigned isolated files, preserve all assertions, never fake browser evidence or payment confirmation. Focused E2E tests and report. STOP at gate.
```

**LATER — P3/P4/P5/P6/P7/P8 individually**
```text
Execute ONLY phase P# of docs/MILJOR_MASTER_FIX_RUNBOOK_2026-11-12.md. First verify ownership handoff and required earlier PASS gates at current SHA. If another chat/agent owns the code or prerequisite is not verified, mark ALREADY_RUNNING_ELSEWHERE or BLOCKED and do not mutate. Otherwise apply the complete vertical slice under MilJor safety protocol, run all specified focused/negative/integration tests, update phase report and STOP; CAN START NEXT PHASE: NO. Do not commit/push/merge without my separate explicit approval.
```

**FINAL — P9 only upon all prerequisites PASS and user explicitly authorizing master test**
```text
Execute P9 final release acceptance only, based on current reconciled integration SHA, after confirming all prior mandatory gates and test DB isolation. Run the final master regression once, full required critical/security/finance/browser acceptance, verify CI at same SHA, document failure honestly, and produce collision-free release/merge plan. Do NOT merge/push or touch miljor_db absent explicit permission. STOP and report gate.
```

## 10. Avoid these destructive shortcuts
Never: blind cherry-pick/merge PR #5/#6/#8; sequentially apply duplicate 046–048 migrations; simply rename applied migration filenames; switch test env to `miljor_db`; change status to PAID based on frontend success; allow supplier DELIVERED to auto-settle; make unit/packaging fractional; silently edit a published supplier SKU physical spec; delete failing browser tests; hardcode sandbox callbacks as real verification; claim "perfect" without cross-layer evidence; advance phases on red tests; run agents concurrently on the same SKU/financial transaction files.
