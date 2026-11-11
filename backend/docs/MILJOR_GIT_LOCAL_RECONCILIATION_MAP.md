# MilJor Git ↔ Local File Reconciliation Map

Date: 2026-11-12. Main repository: `umarjameel12/miljor-b2b-marketplace`.

## Baseline / ownership

- `main`: accepted integration via merged PR #13. Keep as demo-safe baseline until new tests PASS.
- `fix/p0-main-discovery-reconciliation` (PR #17): targeted, UNMERGED supplier/SKU eligibility and real disposable MySQL regression.
- `fix/p0-morning-demo-canonical-gates` (PR #12): accepted CI-proven ancestor of main, **not** a separate source of truth for new work.
- `fix/ucp-3-5-integration-hardening-local` (PR #8): divergent; never blind merge or replace canonical services.
- `fix/ucp-ci-auth-refresh-singleflight` (PR #11): its single-flight auth fix is incorporated into main lineage; alternative lock-timeout response semantics are not automatically accepted.
- `fix/e3-fifth-family-test-contract-1f64051` (PR #14): separate E3 entitlement fixture correction, pending independent verification; do not mix into P0 discovery branch without its tests.

## Exact PR #17 files and why

| Repository file (same relative local path) | Purpose | Class |
| --- | --- | --- |
| `backend/src/repositories/poolRepo.js` | Hide regular pools if supplier, listing, SKU, supplier-owned product or catalog is no longer eligible | Production query |
| `backend/tests/ucp_3_to_5_source_gate.js` | Fail source acceptance if eligibility predicates are missing | Source test |
| `backend/tests/p0_same_sku_publication_stress_gate.js` | Actual disposable MySQL visibility revoke/restore + existing 2/10/50/100-client allocation safety | Real DB test |

No migrations, real payment secrets, new service modules, or frontend replacements are required by PR #17. The prior PR #7/#8 inventory/analytics/fulfillment read models already have different and often safer canonical implementations in `backend/src/services/poolOperationsService.js`, `backend/src/services/unifiedSupplierPoolsService.js`, and `backend/src/services/flashPoolService.js`. Their contracts are not interchangeable.

## Safe local mapping (VS Code terminal, PowerShell or Bash)

Run inside the **existing** repository directory; commands deliberately do not discard local changes:

```bash
git status --short
git remote -v
git fetch origin --prune
git branch --show-current
git log -1 --format="%h %s"
git diff --name-status origin/main...origin/fix/p0-main-discovery-reconciliation
git log --oneline --left-right origin/main...origin/fix/p0-main-discovery-reconciliation
```

If `git status --short` has output, **STOP**, preserve the changes in a separate commit or branch (or a reviewed stash), and do not pull/checkout blindly. When the working tree is clean and the remote tracking refs exist:

```bash
git switch --create demo-p0-reconcile --track origin/fix/p0-main-discovery-reconciliation
git status --short
git rev-parse HEAD
cd backend
npm ci
npm run test:ucp
npm run test:ucp:reconciliation
node tests/ucp_3_to_5_source_gate.js
```

For a frontend-only smoke build, from repository root:

```bash
npm --prefix frontend ci
npm --prefix frontend run build
```

These commands do not prove real MySQL or Chromium acceptance locally. Only run the disposable MySQL tests after creating and verifying **`miljor_test_db`** with `NODE_ENV=test`, `DB_NAME=miljor_test_db`, `TEST_DB_NAME=miljor_test_db`, `MILJOR_TEST_ONLY_MIGRATIONS=1`, and the test-only secrets required by the workflow. Never run migration/stress scripts against `miljor_db`, `miljor_sandbox_db` or any shared data.

## Acceptance ledger / what to claim

- PR #12 run #101 and PR #13 integration: isolated MySQL, existing concurrency, synthetic signed Safepay, real Chromium auth/offline and Vite build PASS. This does **not** prove provider-originated Safepay callbacks or order-to-fulfillment E2E.
- PR #17: pending current workflow run; treat new live visibility regression as **UNVERIFIED** until PASS.
- No merge into main before PR #17 passes all existing and new gates, and a diff + approval review.
- Main checkout and user laptop files cannot be read or mutated through the GitHub connector; verification of local sync requires the user to run these commands and inspect the output.

## Next business-critical E2E not covered by the existing Chromium gate

Buyer pool discovery → reservation/hold → verified checkout → order → supplier fulfillment → buyer-confirmed delivery → dispute/refund if partial → settlement → itemized invoice. Run only with isolated fixtures and authorized sandbox callbacks, never synthetic events labeled as provider-originated.
