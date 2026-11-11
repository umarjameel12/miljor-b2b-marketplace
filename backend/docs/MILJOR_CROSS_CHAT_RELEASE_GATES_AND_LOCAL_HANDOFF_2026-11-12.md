# MilJor — Cross-chat reconciliation, acceptance and local handoff
Date: 2026-11-12 | Repo: `umarjameel12/miljor-b2b-marketplace`

## Scope and authoritative ownership
This is a **coordination plan / evidence ledger**, not a claim that queued CI, live Safepay callbacks or full B7 browser workflows passed. Avoid direct changes to other chats' source branches. Main remains demo-safe baseline pending gates.

| Workstream | Source of truth for current integration work | Reviewer/checklist |
| --- | --- | --- |
| UCP supplier eligibility, supplier-owned SKU, 2/10/50/100 inventory stress | PR #17 -> consolidated PR #25 | Preserve canonical B4/B5 financial engines and inventory locks; only add revocation security |
| E3 fifth-family quota, unpublished SKU/legacy global spec negative cases | PR #21 -> PR #25 | Dedicated disposable MySQL 8 E3 workflow; never call source checks runtime PASS |
| Orders list/detail including valid B6 and Flash `pool_id=NULL`, role isolation | PR #22 -> PR #25 | Test actual HTTP GET and forbidden POST checkout, no provider money movement |
| Unified Pool buyer/supplier frontend, F4 read-only finance integrity, B7 source boundary | PR #20 -> PR #23 | Do not replace PR #20's safer finance/role checks; retain single buyer-facing pool marketplace |
| Main-based combined PR #19/#20/#21/#18, preflight | PR #23 | Treat as competing integration candidate, **not** tested source of PR #25's new order fix |
| B7 RFQ award -> fulfillment, partial delivery, dispute, invoice | `feature/b7-fulfillment-gap-audit-20261111` and `feature/b7-postpurchase-acceptance-isolated` | Source work exists but full MySQL+browser post-purchase acceptance is still unverified |
| Signed provider-refund callback, immutable supplier settlement | `fix/p0-safepay-refund-evidence-isolated` and finance-owned isolated branches | No copy/merge without canonical schema / idempotency / external evidence check |
| Local demo safe preflight | PR #24, based on main | GET-only smoke is not full purchase E2E |
| Actual vendor-originated Safepay callback | Authorized sandbox-only separate test | **BLOCKED** without provider credentials, network-reachable webhook, signature/provenance and test account |

## Current branch topology and conflict resolution
- As inspected 2026-11-12: `integration/p0-demo-consolidated-acceptance-20261112` (PR #25) and `integration/demo-all-heads-acceptance-20261112` (PR #23) have **diverged**.
- Comparison PR #23 -> PR #25: PR #25 +11 / -28 commits; PR #25 -> PR #23: PR #23 +28 / -11 commits. These counts are ancestry not source-level functional equivalence.
- **Overlaps to review by exact hunk, never file-copy:** `.github/workflows/ucp-canonical-acceptance.yml`, `backend/src/repositories/poolRepo.js`, `backend/tests/p0_same_sku_publication_stress_gate.js`, `backend/tests/ucp_3_to_5_source_gate.js`, `backend/tests/package_e3_entitlements_and_supplier_portal_gate.js`.
- **Distinct changes from PR #25 to preserve:** `backend/src/services/orderService.js` LEFT JOIN for order origins, `backend/tests/p0_order_ownership_http_gate.js`, `backend/tests/p0_all_order_origins_source_gate.js`.
- **Distinct changes from PR #23 to preserve:** finance read-only service + fail-closed refund/settlement, frontend UCP read models, GET-only preflight, B7 read-only boundary; do not replace with incomplete older branch services.
- Recommended merge *into a NEW disposable integration branch from current main*, not into PR #23 or #25 directly. Copy selective diffs with hunk audit and keep all old PRs DRAFT until release gate. Source modules and workflows only; **never copy migration 046–054 historical variants**.
- Before any cherry-pick, compare `git diff --name-status origin/main...origin/<branch>`, `git log --left-right`, and per-file `git diff --no-index` or review PR patches. Treat changed SQL, DB migration history, financial conservation and authentication as STOP gates.

## Exact executable release gates: dependencies and PASS evidence

### Gate A: source, migrations, inventory, E3
1. Clean disposable MySQL 8.0 `miljor_test_db`; env `NODE_ENV=test`, `DB_NAME=miljor_test_db`, `TEST_DB_NAME=miljor_test_db`, `MILJOR_TEST_ONLY_MIGRATIONS=1`, `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`, `SAFEPAY_ENV=sandbox`. Protected `miljor_db` and `miljor_sandbox_db` must NOT be used.
2. Canonical manifest 046–048, 051–054 plus 054 historical before/after fingerprint and idempotent second migration.
3. B4/B5/E2/B6 exact fixture-sensitive tests in correct pre-seed order. E3 fifth-family test runs on separate disposable DB if existing fixture order would contaminate historical E2 expectations.
4. 2/10/50/100 simultaneous same-SKU Regular/Flash publications: no 500, allocated <= stock, cancellation releases stock; distinct buyer discovery test verifies suspended supplier/unpublished SKU hidden.
5. Frontend production build; source contract gates. Capture exact HEAD SHA, job links, pass counts and sanitized logs.

### Gate B: buyer/supplier actual UI and orders
1. Seed buyer, supplier, listings, active UCP pools, separate browser contexts. Chromium login, auth refresh, offline recovery, role isolation, supplier create/publish, buyer discovery + tier/minimum and countdown.
2. Buyer reserve / hold and confirm in UI -> *genuine test order*. Verify idempotency and stock. Verify Flash/B6 valid orders with no `pool_id` appear under buyer and assigned supplier using actual Express HTTP.
3. Sandbox-only checkout: test initiated attempt; webhook can only promote PAID after valid **authorized** synthetic test event, marked synthetic. Unknown, tampered, duplicate, currency/amount mismatch remain fail closed. Do not fake a provider-originated callback.
4. Browser test must verify reload/retry/no cross-tenant leakage; preserve trace, screenshot/redacted logs. Existing Chromium auth suite alone is NOT buyer-to-settlement acceptance.

### Gate C: post-purchase fulfillment, partial delivery, invoices and financial conservation
1. B6 award -> exact order lines -> supplier fulfillment list. Supplier cannot see a different supplier's order/line.
2. 100 kg ordered, 80 kg buyer-accepted, 20 kg short: persist ordered/delivered/accepted/disputed quantities per line, timestamps/actors, no phantom fulfilled quantity, no premature buyer confirmation or supplier payout.
3. Multi-product and split-supplier invoice: verify line sum, delivery/processing/tax/commission snapshots, currency/rounding and immutable historical invoice. No unrelated supplier data leaks.
4. Dispute/refund decision: idempotency/replay, refund <= captured and <= unrefunded remaining, ledger balanced; duplicate/concurrent decision cannot refund twice. No release of escrow before buyer acceptance or authorized dispute resolution.
5. Admin read-only integrity must reconcile orders/payment captures/confirmed refunds/payout entitlements; if missing real provider evidence then `PROVIDER_REFUND_VERIFICATION_REQUIRED` or `PROVIDER_SETTLEMENT_EVIDENCE_REQUIRED` blocks action. Zero live money movement.

### Gate D: real Safepay provider-originated SANDBOX callback
Requires legitimate Safepay sandbox credentials, webhook signing secret, registered reachable callback URL, redacted delivery evidence and verification against server-side payment attempt/amount/currency/order. Synthetic HMAC is useful for negative tests but **not** a substitute. Duplicate/replayed/mismatched event must fail closed. If unavailable, record `BLOCKED: EXTERNAL_SANDBOX_EVIDENCE`, do not disable protections to get a PASS.

### Gate E: final Git/main/local handoff
- Merge to main **only** after every applicable gate on exact combined HEAD PASS and explicit merge approval; do not promise automatic release.
- User's actual laptop/Antigravity local directory cannot be accessed through GitHub API. Before sync: capture `git status --short`, `git remote -v`, `git fetch origin --prune`, `git rev-parse HEAD`, `git log --left-right --oneline origin/main...HEAD`. Dirty tree => STOP, preserve changes (reviewed commit/worktree) first. No `reset --hard`, `clean -fd`, force push or blind `git pull`.
- For demo use separate clean Git worktree at exact approved SHA; run Node 22 `npm ci`, `npm run build`, backend safe preflight, isolated DB and UI smoke. Record final `git rev-parse HEAD` in both machine and GitHub; do not assert local sync without this evidence.
- Protect DB: independent local encrypted/permission-restricted `mysqldump --single-transaction` and restore/verification to a **different disposable name** before any local migration. DB dump never stored in repo/log or claimed remotely.
- Evidence matrix columns: `gate | exact commit | environment | command/test | actual result | log/run link | PASS/FAIL/BLOCKED | reason`. Any missing evidence = BLOCKED, not green.

## Immediate operator sequence
1. Inspect PR #25's canonical workflow and E3 workflow results (currently QUEUED as checked); if jobs never start, identify GitHub Actions runner/queue/approval/concurrency configuration. Do not change application code to fix CI queue.
2. Review PR #23's exact-head runs separately; do not transfer pass status from main or PR #12.
3. Create new cross-branch integration **only after** snapshotting exact heads. Resolve five overlapping paths using test behavior, not latest timestamp.
4. Execute Gate A then Gate B then Gate C. Stop money-flow release if Gate D blocked; prepare demo to last tested stage.
5. Hand off exact Git commit, local clean worktree commands, runbook, and accepted demo script.

Release status at authorship: **PLAN + BRANCH MAPPING COMPLETE; exact-head combined runtime CI, full fulfillment/finance browser and external Safepay provider acceptance NOT YET VERIFIED.**
