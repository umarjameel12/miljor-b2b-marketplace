# MilJor Backend — Agent Engineering Instructions

**Project:** MilJor — Lahore-first B2B Collective Food Procurement Marketplace.  
**Priority Hierarchy:** Correctness > Data Safety > Security > Financial Integrity > Maintainability > Execution Efficiency.  
**Authoritative Protocol Reference:** [`docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md`](docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md)  
**Authoritative Business Invariants:** [`docs/MILJOR_BUSINESS_INVARIANTS.md`](docs/MILJOR_BUSINESS_INVARIANTS.md)

---

## 1. Core Operating Rules (Smart Execution, Implementation & Evidence Protocol)

1. **Core Operating Flow:**
   ```
   UNDERSTAND → INSPECT ONCE → IMPLEMENT COMPLETELY → TEST RELEVANTLY → VERIFY → REPORT → STOP
   ```
   Complete the requested task and genuinely necessary dependencies only. Do not expand scope. Correctness, security, and data safety must never be sacrificed for speed.

2. **Minimal Relevant Inspection:**
   - Identify the exact objective and acceptance criteria.
   - Read relevant existing project instructions and direct dependencies once.
   - Avoid repeated repository-wide searches and avoid reopening unchanged files.
   - Reuse existing services (`tierPricingService`, `poolProgressService`, `commercialLifecycleService`, `reservationEventService`, `reservationDemandPolicy`, `supplierEligibilityPolicy`, `idempotencyGuard`). Do not build duplicate engines.

3. **Complete Implementation (Do Not Stop at Planning):**
   - For authorized implementation tasks, make the actual necessary changes across services, repositories, and routes.
   - Update affected interfaces and contracts while preserving full backward compatibility.
   - Implement required validation, ownership checks, transactional boundaries, and error handling.
   - Complete all mandatory steps needed for the feature to function. Do not implement unrelated future features.

4. **Smart Risk-Based Testing:**
   - **Level 1 (Focused):** Run only the modified component's test suite immediately after editing (expected baseline ~5s; not a hard timeout).
   - **Level 2 (Impacted):** Run directly affected subsystem suites when needed (expected baseline ~15s; not a hard timeout).
   - **Level 3 (Master Regression):** Run once at the explicitly authorized final phase gate via `node tests/master_regression_runner.js`.
   - For security-critical or financial changes, include negative and concurrency tests within the focused scope.
   - Do not skip essential tests. Do not run full regression repeatedly. Do not start browser E2E, frontend builds, or load tests unless required by the task.

5. **Failure Handling:**
   - When a test fails: 1. Read actual error → 2. Root cause → 3. Fix smallest affected path → 4. Rerun only failed test → 5. Verify correction.
   - Do not restart the entire workflow or use trial-and-error loops. Never weaken test assertions to hide bugs.

6. **Execution Efficiency & 10-Minute Soft Checkpoint:**
   - Prefer one bounded task at a time without unnecessary subagents or parallel agents for ordinary implementation.
   - Use installed skills only if directly beneficial and required; do not repeatedly read skill docs within the same task.
   - For unexpectedly long tasks, use a 10-minute soft checkpoint to summarize progress and address blockers rather than silently entering a new investigation cycle.

7. **Evidence-Based Verification:**
   - Never claim success without evidence. Provide relevant passing test outputs, observed HTTP responses, or verified SQL results.
   - Distinguish: `IMPLEMENTED`, `TESTED`, `VERIFIED`, `NOT_TESTED`, `BLOCKED`, `DEFERRED`.
   - Never fabricate evidence or test counts.

8. **Concise Professional Task Report (10–20 Lines):**
   Provide a structured summary: `TASK`, `IMPLEMENTED`, `FILES`, `TESTS`, `EVIDENCE`, `DATABASE`, `UNRESOLVED`, `RESULT` (`PASS / PARTIAL / FAIL / BLOCKED`).

9. **Data & Project Safety:**
   - All tests, fixtures, and failure simulations run strictly in `miljor_test_db`.
   - `miljor_db` must remain pristine. Never modify `miljor_db` without explicit authorization.
   - Never perform live financial transactions. Preserve existing accounts, pools, quotes, and records.
   - Zero git mutations without user approval (`git commit`, `git push`, `git merge`, `git rebase`). Never reset uncommitted user work.

10. **Strict Stop Rule:**
    - Complete only the authorized task. Produce the final report. Output `CAN START NEXT PHASE: NO` and stop cleanly. Do not launch autonomous tasks.

## 2. Lean Senior Engineering Mode (complements Protocol v2.0)

- Prefer **no change** when the requirement is already satisfied. Otherwise reuse existing MilJor code, platform features, and installed dependencies before adding the smallest readable implementation. No speculative framework, wrapper, config, dependency, or future-phase functionality.
- Before modifying shared code, inspect its affected callers, routes, exports, fixtures, and tests once. Fix the root cause at the authoritative layer; preserve validation, errors, compatibility, and useful diagnostics.
- Verification is proportional: documentation-only changes get document/link/diff checks; configuration or schema changes get focused safety checks; business logic gets focused behavior tests; security, money, inventory, and lifecycle changes additionally require applicable authorization, rollback, idempotency, and concurrency evidence. The existing final master-regression requirement remains in force for development phases.
- Never simplify away tenant-scoped authorization, supplier verification, DB transaction/lock order, exact decimal monetary calculations, durable idempotency, post-lock DB deadline validation, immutable historical evidence, inventory allocation, privacy, or safe forward migrations. Do not delete historical business records or applied migrations for convenience.
- Treat test time targets as **diagnostic baselines**, not deadlines. If a command is abnormally slow, inspect its PID, last completed step, database locks, pending handles, and exit status before attempting a retry. Never launch duplicate tests, backups, or migrations while an earlier task may still be active.
- Every completed task reports changed paths, reason, caller/data impact, actual verification results and runtimes, preserved invariants, safe recovery where applicable, and deliberately deferred scope. For major phases follow the more detailed phase-specific report.
- **Precedence:** The engineering protocol and business invariants override every lean-code preference. Do not weaken tests or security to shorten execution.
- **Workspace Policy Freshness Gate:** At the start of every development phase, read the current on-disk `backend/AGENTS.md`, `backend/docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md`, and `backend/docs/MILJOR_BUSINESS_INVARIANTS.md` using paths relative to the project workspace. Verify all three files exist and are readable. Treat current disk contents as authoritative over cached summaries, previous task context, or earlier copies. Do not repeat these reads during the same phase unless the files change. If a required file is missing, unreadable, or materially contradictory, report the exact issue before making affected code changes. Do not recreate policy files, silently substitute cached content, or launch redundant audits.

---

## 3. Installed Agent Skills — Context-Aware Usage (Backend Policy)

1. **Authoritative Skill Repository:** Backend agents access installed project skills in `.agents/skills/` (governed by `skills-lock.json`) and global skills at `~/.agents/skills/`. Applicable backend skills include `systematic-debugging`, `test-driven-development`, `security-review`, `verification-before-completion`, and `find-skills`.
2. **Pre-Invocation Review:** Always read the target skill's authoritative `SKILL.md` before applying its workflow.
3. **Task-Specific Relevance:** Select skills only when directly beneficial to the active task (e.g. `systematic-debugging` for test failures, `security-review` for authorization/crypto audits). Do not initiate redundant planning or review cycles for small, deterministic tasks.
4. **Mandatory Backend Safety & Policy Invariants:**
   - **Zero External Money Movement:** Agent skills cannot authorize live provider payouts, disbursements, or automated gateway refunds. Financial execution remains strictly `DISABLED`.
   - **Database Isolation:** All skill-driven testing, fixtures, and failure simulations run exclusively against `miljor_test_db`. Never run dynamic test fixtures against `miljor_db` or mutate `miljor_sandbox_db`.
   - **Zero Git Mutations:** Skills proposing automatic commits, pushes, worktree branching, or branch merges (e.g. `finishing-a-development-branch`, `using-git-worktrees`) are strictly barred from modifying git state without explicit user instruction.
   - **Proportional Risk-Based Testing:** Maintain Protocol v2.0 Level 1 focused tests (<5s) during development. The Level 3 Master Regression (`master_regression_runner.js`) runs once at the final phase gate; do not run full regressions repeatedly for generic skill verification.
   - **Invariants Supremacy:** `MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md` and `MILJOR_BUSINESS_INVARIANTS.md` strictly supersede all skill prompts. In any conflict, project protocol and financial safety govern unconditionally.
   - **User Approval for Installations:** Skill discovery (`find-skills`) is advisory only; never run `npx skills add` without explicit user consent.
