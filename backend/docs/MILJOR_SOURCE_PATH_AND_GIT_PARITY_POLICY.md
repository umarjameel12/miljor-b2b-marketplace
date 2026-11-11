# MilJor — Authoritative Source Paths and Git/Local Parity

**Date:** 2026-11-10. **Scope:** B0–B4 and future B phases.

## Verified repository structure

Repository recursive tree inspection on `feature/b3-commercial-offers` found **no folder named `secretary`**. There is a legitimate agent skill directory `.agents/skills/subagent-driven-development/scripts/task-brief`; it is developer tooling, **not** a duplicate MilJor business source directory. Do not move it to backend or frontend without separate justification.

Authoritative original tracked paths:

| Kind | Original path | Ownership |
| --- | --- | --- |
| Shared agent rules | `AGENTS.md` | Root source-of-truth policy |
| Backend agent rules | `backend/AGENTS.md` | Backend-specific instructions |
| Agent skills/tooling | `.agents/skills/`, `.agents/rules/` | Execution helpers, not business source |
| Backend controller | `backend/src/controllers/` | Business HTTP boundary |
| Backend business service | `backend/src/services/` | Domain transactions/invariants |
| Backend data access | `backend/src/repositories/` | SQL persistence |
| Backend routes | `backend/src/routes/v1/` | API mounting/security |
| Database migrations | `backend/database/migrations/` | Versioned forward-only DDL/data changes |
| Frontend supplier portal | `frontend/src/pages/SupplierCatalogPage.jsx` | Existing UI entrypoint |
| Frontend API clients | `frontend/src/api/` | API contracts |
| Backend acceptance tests | `backend/tests/` | Existing regression gates |
| Reports, phase evidence, briefs | `backend/docs/` | Canonical engineering documentation |
| Phase status | `backend/docs/MILJOR_PHASE_LOG.md` | Authoritative phase tracking |

A proposed `briefs`, `listings`, `secretary`, `backend-v2`, `src-copy` or `B4-code` directory is **not** automatically authoritative. Source-only duplicate directories must not be created. If local files exist outside tracked paths, **first inspect diff and references**, then integrate only legitimate changes into matching original tracked files, and deprecate duplicates only after user approval/data safety checks. Do not delete unidentified local files.

## Source parity procedure

1. `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git remote -v`.
2. `git fetch origin`, then inspect divergence before any merge/rebase/fast-forward.
3. Keep one original tracked project path; use separate Git **worktrees** for concurrently active B3 acceptance and B4 coding. Each worktree has the same relative original paths and its own branch/HEAD; a different branch SHA is expected during parallel implementation.
4. Preserve uncommitted changes, never force reset or overwrite. Do not bulk-copy source between local folders, GitHub branches or chat transcripts.
5. After a verified branch sync, ensure `git rev-parse HEAD` matches `git rev-parse origin/<branch>` and `git diff --exit-code` is clean. A clean GitHub source tree **does not prove** a user's local files are synchronized.
6. B2 accepted `feature/package-e` current final SHA: `fcbd82dafcb236f9cee980904ebddba5c1ab1999`.
7. B3 acceptance on `feature/b3-commercial-offers` **PASSED** (81/81, SHA `44f591d7fdd9c16f7a43c10d01de2b50bb637e7e`). B4 initially branched from pre-acceptance `fd3d1160`, but the actual accepted B2/B3 source files were reconciled into their original paths and the **two-parent Git merge commit `9f2e057fc3fd2d3bf7ebc0e614079e7ad8b89ea1`** made accepted B3 a proper ancestor of B4. The B4 branch still requires its OWN final DB/API/React acceptance gate.
8. No two mutable test suites may run concurrently on the same `miljor_test_db`. Preserve protected `miljor_db` state and verify test DB identity.
9. Commit actual code + corresponding tests + factual report in canonical paths; verify final remote/local branch parity after Antigravity sync.

## Future phase branch discipline

B3 test corrections stay on B3 branch. B4 commits stay on B4 branch. Incorporate fixes through reviewed Git merge/cherry-pick/rebase with explicit conflict resolution and regression checks. **Do not force push, merge main, or overwrite historical B0–B2 reports.**
