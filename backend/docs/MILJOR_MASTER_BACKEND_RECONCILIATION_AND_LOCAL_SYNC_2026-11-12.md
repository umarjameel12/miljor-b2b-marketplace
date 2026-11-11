# MILJOR — MASTER BACKEND RECONCILIATION, INTEGRATION, ACCEPTANCE & LOCAL SYNC
**Agent execution runbook | 2026-11-12 | Repository:** `umarjameel12/miljor-b2b-marketplace`

> **Primary command for Antigravity / coding agent:** Perform a complete, auditable reconciliation of all *already-built* MilJor backend capabilities, independently validate competing branches, integrate only compatible and tested changes into one canonical integration PR, and synchronize the final approved tree into the owner's local workspace. This runbook is an execution specification, **not** proof that the work has been executed. Do not falsely report passing tests or local sync.

## 0. Non-negotiable controls
1. Start read-only. Snapshot HEAD/remote refs/status, PR SHA, CI checks, migrations and all local uncommitted changes before modifications. Never discard local changes, reset/force-push a shared branch, auto-merge an unverified PR, or overwrite user-authored local files.
2. Do **not** mutate protected `miljor_db` or `miljor_sandbox_db`; inspect only with explicit read-only permission. All migrations, data mutation, seed and destructive tests run on isolated disposable `miljor_test_db` or uniquely named temporary databases. Back up and checksum before any approved real-environment migration.
3. Do not copy live credentials, payment secrets, tokens, customer information or `.env` into commits/logs. No production money movements. Synthetic payment tests cannot substitute for provider-origin Safepay callback evidence.
4. No blind merge or wholesale cherry-pick. Comparison must be per commit/per file/per feature with ownership, behavior, dependency, migration, verification and rollback rationale. Branches with the same feature can contain incompatible partial implementations.
5. One canonical persisted state machine per business operation; do not create parallel order/payment/stock ledgers. Preserve existing B4 Regular and B5 Flash business-specific authoritative transaction rules while exposing unified UCP interfaces. The owner's desired unified-only pool UX is a separate explicit acceptance objective, not license to delete required Regular/Flash semantics.
6. Report status per gate as **PASS, FAIL or BLOCKED**, with exact test command, exit code, SHA, workflow URL and artifact proof. Never label merely copied code as COMPLETE.
7. Do not push straight to `main`. Use a dedicated integration branch and DRAFT PR; promote to merge only after gate approval. GitHub-hosted work alone **does not update the user's laptop**.

## 1. Verify real repository state before decisions
Run:
```bash
git status --short --branch
git remote -v
git fetch --all --prune
git branch -avv
git log --graph --decorate --oneline --all -80
gh pr list --state all --limit 100
gh run list --limit 30
```
Record time, HEAD, base, tree hash, branch divergence, untracked and uncommitted files. Save `git diff` and `git diff --cached` to an **ignored local backup folder**, never silently stash/drop. List workflows and inspect actual individual job conclusions for each exact SHA. Check that the target repository is `umarjameel12/miljor-b2b-marketplace`, rather than accidentally operating on a clone/fork. If CLI auth or repo access missing: BLOCKED, do not guess.

### Baselines to verify, not blindly assume
- PR #13: `integration/ucp-verified-main-handoff-20261112` -> `main`; handoff at `backend/docs/MILJOR_UCP_MAIN_INTEGRATION_HANDOFF_2026-11-12.md`.
- Historical source candidate `fix/p0-morning-demo-canonical-gates`; report cites SHA `2030fb7359f596d08bdbea8a5399f466008cec60`, and historical successful action runs `43093840197` and `43093830834`. These prove only the reported *candidate SHA*, not any new merge commit.
- PR chain #9 -> #10 -> #12; compare PRs #5, #6, #7, #8 and #11 to avoid reapplying already absorbed patches.
- Additional source branches (verify presence and exact HEADs): `feature/unified-pool-only-workflow`, `feature/b7-postpurchase-acceptance-isolated`, `feature/b7-fulfillment-gap-audit-20261111`, `fix/p0-financial-f1-f5-closure-isolated`, `fix/p0-financial-settlement-hardening-isolated`, `fix/p0-order-commission-snapshot-isolated`, `fix/p0-safepay-refund-evidence-isolated`, `fix/p0-provider-browser-stock-finance-acceptance`, `fix/independent-backend-integrity`, `feature/b6-nq-complete-reconciliation`, `feature/b6-phase2-reconciliation`, `feature/b6-private-rfq`, `feature/ucp-canonical-reconciliation-release`, `feature/ucp-3-5-integrated`, `integration/p0-b6-finance-migrations-046-052`, plus any new branches and all open PRs.
- Also inspect files/reports on branches `docs/miljor-master-fix-runbook-20261112` and `docs/antigravity-non-ci-remaining-master-20261112`; deduplicate or supersede their tasks without deleting historical evidence.
- Inspect `package.json`, `backend/package.json`, `frontend/package.json`, `.github/workflows`, actual migrations directory and migration runner before choosing commands.

## 2. Build a full reconciliation matrix before coding
For every branch and changed file, capture: branch/SHA, feature, source file/function/route, endpoint and role, schema dependencies, tests, overlap/diff, desired authoritative implementation, action (adopt/adapt/reimplement/reject), risk and evidence. Use `git merge-base`, `git diff --name-status`, `git diff --find-renames`, `git log --left-right`, `git patch-id` and actual source inspections. Do not assume commit hash inequality implies a feature is absent.

Canonical subsystem ownership/checklist:
- **Identity/security:** business buyer/supplier/admin roles, JWT/HttpOnly refresh single-flight, permissions, CSRF/CORS/rate-limit, scoped queries and IDOR denial, secret hygiene.
- **E2 supplier catalog:** supplier-specific physical SKU specifications (Option B), immutability after publication (new SKU for changed physical specifications), canonical categories, moderation and inventory linkage. Published SKU's brand/grade/size must not silently change on existing pools/orders.
- **UCP marketplace:** shared buyer pool discovery and supplier pool management, Regular vs Flash eligibility; server-UTC pool countdown and separate order/payment hold countdown; filtered active offers; no mock UI success; supplier stock exact allocation. Reconcile unified-only frontend branch by preserving critical transactional paths.
- **B4 Regular:** draft/publish, tiers/MOQ, reservation, negotiation/commercial decision, confirmed order, idempotency/retry, expiration and payment hold, escrow.
- **B5 Flash:** expiry/best-before validation, ready inventory, full-lot/partial hold constraints as implemented, confirmed checkout, safe release and payment timer.
- **B6 A–Q:** private RFQ, supplier quotes, quote comparisons, award, recurring cycles, collective quotes, buyer/supplier tenant isolation and downstream order conversion.
- **B7 fulfillment:** awarded paid orders must appear to correct supplier; 100kg ordered/80kg delivered/20kg short produces exact outstanding qty and dispute; buyer confirmation before settlement; proof-of-delivery and retries; split supplier and multi-product invoices; delivery clustering/pickup/extra-km/fast delivery as approved.
- **Finance:** buyer fees, supplier immutable commission snapshot (including Flash/B6 writers), tax/rounding, order line snapshots, payments, ledger, held escrow, payable/release, refund/dispute reversal, double-entry/invariants and reconciliation.
- **Safepay:** checkout request idempotency, signature checking, event replay dedup, amount/currency/order ownership, delayed/out-of-order callback, provider reconciliation; treat synthetic fixtures separately from actual provider-issued sandbox callback.
- **Trust/notifications/analytics:** verification badges, reviews and disputes, accurate account-scoped analytics, in-app notification versus actual SMS/email, provider integration only where configured and authorized.
- **Frontend/API alignment:** React Vite Tailwind pages actually call canonical Express controllers with valid validation/errors/auth; no orphaned UI or dead routes. Distinguish deferred features from broken existing features.
For each, document what is source-complete, runtime-tested, missing, unsafe and demo-ready.

## 3. Canonical migration ledger: P0 STOP gate
1. Inventory all SQL files on each branch; extract filename/version, contents normalized only for comparison, SHA-256 of actual bytes, DDL objects, table/column dependencies, rollback policy and schema journal records.
2. Known collision: competing B6 migrations numbered `046–048` vs old UCP aliases; accepted UCP reconciliation is `051–053`, supplier commission snapshot intended as forward-only `054`. **Verify this against actual files and historical journal, never blindly rename migration entries or assume other finance 049–052 files can coexist.**
3. Reject duplicate numeric versions, changed historical hashes, ambiguous versions, overlapping DDL or abandoned finance aliases; reconcile by new forward-only corrective migrations assigned **next unused versions after inspecting current HEAD/journal**.
4. Produce migration dependency map, clean-install path and sanitized **historical upgrade** path; capture read-only hashes of protected DB schema/history without modifying it.
5. On disposable MySQL 8, run initial migration, rerun idempotency (as runner supports), upgrades from historical fixture, rollback rehearsal where support exists, and source+SQL integrity checks. Validate exact columns, indexes, FKs, constraints, decimals, timezone semantics, auth and tenant indexes.
6. Any mismatch => BLOCKED; stop code integration that relies on unverified schema. Never use `db:reset` against protected DB. Preserve historical NULL commission as unresolved rather than fabricate rates.

## 4. Create safe implementation integration branch
Use latest verified integration candidate as starting point, not an arbitrary feature branch; first ensure its CI actually passes on its exact SHA and compare with current main. Proposed new branch: `integration/miljor-complete-reconciliation-20261112`. Create a DRAFT PR early for auditability.
Apply **small ordered changes**: (A) migrations/compatibility; (B) auth/catalog/stock/UCP interface; (C) B6 conversions and B7 fulfillment; (D) commission/payment/ledger/refunds; (E) delivery disputes/invoices/notifications; (F) frontend wiring; (G) docs/tests. Cherry-pick only changes verified safe; otherwise port relevant hunks and refactor intentionally. Keep commits logical and independently testable. For each commit record source SHA/file, decision, impacted migrations/APIs, regression results.
When conflict: never choose `ours` or `theirs` wholesale. Read both sides, preserve invariants, add regression that fails on loser behavior, resolve and explain. Special scrutiny for `RegularReservationWorkflow.jsx`, auth refresh handling, pool publication, B6 order creators, finance services and overlapping migrations.

## 5. Implement cross-module business invariants
1. Supplier-owned published SKU + physical inventory identity across Regular and Flash. Concurrent stock updates protected by DB transactions/row locking or proven equivalent. Never allocate more than physical quantity or create duplicate pool stock claims.
2. Two state machines may differ internally while one UCP frontend/API provides consistent discover/manage/purchase UX. No standalone conflicting dashboard navigation, but **no deletion of B4 tier reservation/B5 hold rules**.
3. RFQ award -> uniquely identified confirmed order -> authoritative payment -> seller fulfillment queue -> delivery -> buyer acceptance/partial dispute -> eligible escrow settlement/refund. Exactly-once transitions with stable idempotency keys; explicit pending/uncertain response after transport failure.
4. Partial deliveries: quantity, unit, accepted/rejected/undelivered, quality defects, evidence, delivery timestamps, actor, resolution and immutable audit. Settlement only against explicitly eligible accepted quantities; pending 20kg never silently counted delivered.
5. Invoices: immutable per-order lines (SKU specification snapshot, supplier, unit, quantity, unit price, fee breakdown, delivery allocation, discounts, taxes when applicable), sum of subtotals/fees equals total at agreed currency precision; multi-supplier payouts properly attributed.
6. Rate and fees snapshotted at contract/order time for all B4/B5/B6/recurring writers. Never use today's supplier profile to silently rewrite historical transactions; fail closed for unresolved nulls.
7. Disputes, payment reversals, stock releases and settlement are race-safe and append-only/auditable. Prevent seller self-confirming buyer receipt or tenant viewing another buyer's orders.

## 6. Verification gates (execute, do not just write tests)
**G0 Source/repository:** clean source provenance, static checks, lint, node syntax, npm audit as applicable; review changes against roadmap.
**G1 Database:** disposable MySQL 8 fresh install and historical upgrades; repeatable ledger/DDL integrity; protected DB unchanged.
**G2 Unit/contracts:** source tests covering B4/B5/B6/B7, permissions, idempotency, fees, supplier SKU contract, countdown timestamps, errors.
**G3 HTTP integration:** use real Express + MySQL transactions, buyer/supplier cross-tenant denial, retries, all major positive and negative API flows.
**G4 Concurrency:** same supplier/SKU B4+B5 stock waves at 2,10,50,100 clients; optimistic/deadlock/rollback and aggregate invariant evidence. Do not mark conflict 409 as elimination of contention.
**G5 Payments:** signed synthetic Safepay HTTP callback (tampering, replay, tracker, amount, currency, out-of-order) plus **separately** true provider-origin sandbox callback with sanctioned sandbox credentials and HTTPS endpoint. If external access unavailable, G5-provider = BLOCKED, not PASS.
**G6 Buyer/supplier/admin Chromium:** Playwright actual UI login/refresh/offline/re-login, supplier SKU -> published UCP pool -> buyer reservation/hold -> payment -> B6 award -> seller fulfillment -> buyer acceptance/partial dispute -> invoice. Capture redacted traces and screenshots; no mocked network paths for integration PASS.
**G7 Finance/B7:** split supplier invoices, exact cents, commission snapshots, held escrow, partial fulfillment, refund/settlement, duplicate webhook, replay and malicious tenant tests.
**G8 Build/CI:** frontend production build; backend test suite; GitHub Actions exact integration SHA, status checks and migration job. Different SHA => rerun.
**G9 Demo readiness:** seed isolated demo database with genuine demo fixtures and separate supplier/buyer credentials; start both servers, show a real end-to-end scenario. Document any external provider gate still blocked. No 'production-ready' claim when G5 provider is BLOCKED.
For every gate create PASS/FAIL/BLOCKED row with command, timestamp, SHA, fixture, exit code, proof URL, remediation and owner. Failed tests are not optional; fix then rerun impacted and full regression.

## 7. Artifacts required inside Git repository
- `backend/docs/MILJOR_CANONICAL_RECONCILIATION_MATRIX.md`: branch/PR/file-level dispositions with SHA.
- `backend/docs/MILJOR_CANONICAL_MIGRATION_LEDGER.md`: exact version+hash, dependencies, journal preflight and historical upgrade.
- `backend/docs/MILJOR_RELEASE_ACCEPTANCE_EVIDENCE.md`: gates G0–G9 and actual evidence.
- `backend/docs/MILJOR_FINANCE_B7_E2E_RECONCILIATION.md`: workflow mapping, invariant decisions, unresolved issues.
- `backend/docs/MILJOR_LOCAL_SYNC_AND_DEMO.md`: exact verified commands for current environment and feature demo script.
- `backend/docs/MILJOR_RECONCILIATION_PHASE_LOG.md`: what changed, what did not, phase PASS/FAIL/BLOCKED.
Update `AGENTS.md` only after inspecting existing instructions; preserve user setup/installed skills. Update README only after matching source behavior. Ensure generated docs use **actual** command paths discovered from repo.

## 8. Github review, final commit and release boundaries
Keep PR DRAFT during failures or blocked critical gates; run exact-head CI; attach logs/artifacts/test summaries, reviewer notes and migration matrix. Verify branch protection, approvals, security checks and final tree. Never force merge or bypass protection. If all internal gates PASS but real Safepay provider evidence is unavailable, mark **internal/demo candidate only**, provider/production release BLOCKED. Main merge requires the user's authorization and actual accepted release policy; do not equate merge with deployment.

## 9. Mandatory local files synchronization (owner's own computer)
The coding agent must execute this **on the owner's workstation/Antigravity workspace**, not claim the GitHub connector can write laptop files.

First inspect:
```bash
pwd
git rev-parse --show-toplevel
git status --porcelain=v1
git branch --show-current
git remote -v
git fetch origin --prune
```
If local edits exist, save a timestamped external copy and `git diff --binary`; ask for resolution if changes conflict, **never** force-reset/drop/overwrite. If repo not cloned, choose user-authorized folder and `git clone https://github.com/umarjameel12/miljor-b2b-marketplace.git`. If already cloned and clean, `git switch <verified-integration-branch>` and `git pull --ff-only origin <verified-integration-branch>`; if main is explicitly approved/merged, `git switch main && git pull --ff-only origin main`. Verify `git rev-parse HEAD` exactly equals reviewed GitHub commit. Lockfiles tracked, install using package-manager lock (`npm ci` where applicable). Never copy old `node_modules`, `.env`, DB files or caches from another branch; provide `.env.example` only, keep real secrets local. Run migration/test/build on user's separate **test** database and start frontend/backend per verified package scripts. Record local file paths and final SHA only after actual laptop commands pass. If agent is cloud-only and cannot access laptop, report **LOCAL SYNC BLOCKED** and provide commands; do not claim files were saved locally.

## 10. Completion report required from agent
Return concise but complete:
- exact GitHub repo, base/head SHA, DRAFT PR URL, and integrated/declined branches;
- each module status: source present, integrated, runtime verified, deferred;
- migration ledger proof, no-touch protected DB check, PASS/FAIL/BLOCKED matrix with logs;
- complete buyer/supplier demo execution steps and proof;
- exact owner laptop path and `git rev-parse HEAD` (or BLOCKED);
- outstanding blockers and minimal next safe action.
**Definition of DONE:** all intended integrated code committed to canonical branch, actual tests verified, evidence published, explicit merge/release boundary respected, and local checkout verified against the same SHA. Anything less is IN PROGRESS / BLOCKED, never misleadingly 'all complete'.
