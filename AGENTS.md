# MilJor Project — Agent Engineering Instructions

**Project:** MilJor — Lahore-first B2B Collective Food Procurement Marketplace.  
**Priority Hierarchy:** Correctness > Data Safety > Security > Financial Integrity > Maintainability > Execution Efficiency.  
**Authoritative Protocol Reference:** [`backend/docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md`](file:///c:/Users/Umar%20Jameel/OneDrive%20-%20Higher%20Education%20Commission/Documents/MilJor%20Project/backend/docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md)  
**Authoritative Business Invariants:** [`backend/docs/MILJOR_BUSINESS_INVARIANTS.md`](file:///c:/Users/Umar%20Jameel/OneDrive%20-%20Higher%20Education%20Commission/Documents/MilJor%20Project/backend/docs/MILJOR_BUSINESS_INVARIANTS.md)

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

---

## 2. Installed Agent Skills — Context-Aware Usage

### 2.1 Authoritative Skill Inventory
MilJor maintains an authoritative project skill inventory located at `.agents/skills/` (governed by `skills-lock.json`) and accessible global skills at `~/.agents/skills/`:

| Domain | Discovered Installed Skills | Scope | Primary Intended Purpose |
|:---|:---|:---:|:---|
| **Frontend UI / UX** | `unslop`<br>`frontend-design`<br>`web-design-guidelines` | Project | De-slop vibecoded UI, craft bespoke product aesthetics with domain character, and audit for Web Interface Guidelines / accessibility compliance. |
| **Complex Engineering & Superpowers** | `using-superpowers`<br>`brainstorming`<br>`writing-plans`<br>`executing-plans`<br>`subagent-driven-development` | Project | Structured problem decomposition, Socratic exploration, vertical-slice implementation plans, and disciplined inline or subagent execution. |
| **Testing, Quality & Verification** | `test-driven-development`<br>`systematic-debugging`<br>`verification-before-completion`<br>`requesting-code-review`<br>`receiving-code-review` | Project | 4-phase root-cause debugging, red-green-refactor cycle, evidence-before-assertions verification, and rigorous evidence-driven peer review. |
| **Security & Hardening** | `security-review` | Project | OWASP-aligned vulnerability audits (injection, auth/authz, crypto, tenant isolation, CSRF, sensitive data exposure). |
| **Agent Meta & Branching** | `dispatching-parallel-agents`<br>`finishing-a-development-branch`<br>`using-git-worktrees`<br>`diagnosing-superpowers`<br>`writing-skills` | Project | Concurrent task delegation, worktree isolation, session post-mortems, and reusable skill authoring. |
| **Skill Discovery** | `find-skills` | Global | Search ecosystem (`skills.sh`) when a needed capability is missing or materially improves the task. |

### 2.2 Operational Skill Selection & Execution Policies

1. **Pre-Invocation Verification:** Before applying any skill, read its current authoritative `SKILL.md` (e.g., `.agents/skills/<skill-name>/SKILL.md`) to understand its exact workflow, required inputs, and boundaries.
2. **Task-Relevance First:** Select only the minimum necessary skill directly relevant to the active task. Never chain unnecessary skills or run multi-round planning cycles on deterministic engineering tasks.
3. **Frontend UI/UX Policy (`unslop`, `frontend-design`, `web-design-guidelines`):**
   - Use `unslop` only when working on an explicit frontend design, polish, or cleanup task.
   - **Never automatically restyle existing UI** without an explicit user instruction.
   - Respect MilJor Lahore B2B marketplace brand identity, existing functional components, accessibility, and clean responsive layouts. Avoid generic AI clichés, purple glow gradients, decorative emojis, or speculative visual clutter.
4. **Engineering & Superpowers Policy (`using-superpowers` suite):**
   - Follow the actual installed instructions in `.agents/skills/<skill-name>/SKILL.md` rather than inventing synthetic workflows.
   - For Antigravity CLI, map subagents to `invoke_subagent` (type `self` or `research`) and track task checklists via markdown task artifacts (`task.md`).
   - Do not trigger full branch-wide planning or review loops repeatedly for small, bounded edits.
5. **Skill Discovery Policy (`find-skills`):**
   - Use `find-skills` only when a required specialized capability is missing and would materially improve the task.
   - Never search for or install skills on ordinary tasks.
   - **User Authorization Required:** Never install (`npx skills add`) or update skills automatically; always present the recommendation and request explicit user authorization.
6. **Testing & Debugging Policy (`systematic-debugging`, `test-driven-development`, `verification-before-completion`):**
   - Enforce the 4-phase root-cause protocol (reproduce -> isolate -> hypothesize -> verify) before proposing fixes.
   - Follow MilJor's risk-based testing (Level 1 focused tests during development; Level 3 master regression only once at the final phase gate).
   - Never run entire test suites solely because a skill suggests generic verification.
7. **Security Review Policy (`security-review`):**
   - Employ for systematic vulnerability analysis across auth, authorization, database queries, and input validation.
   - Strictly advisory: skills cannot authorize destructive database changes, pen-testing exploits, or external calls.

### 2.3 Non-Negotiable Precedence & Conflict Resolution Rules

Where any installed skill instruction conflicts with MilJor project policies, **MilJor Authoritative Invariants Strictly Supersede Skill Workflows**:

1. **Protocol & Invariant Supremacy:** `MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md` and `MILJOR_BUSINESS_INVARIANTS.md` take absolute precedence over all skill suggestions (as explicitly conceded by `using-superpowers/SKILL.md` line 63).
2. **Financial Safety & Money Movement:** No agent skill has authorization to move funds, initiate live external refunds, execute supplier payouts, or alter financial ledgers. External execution remains strictly `DISABLED`.
3. **Database Isolation & Evidence Preservation:** All testing and dynamic fixtures run strictly against `miljor_test_db`. Never run dynamic test fixtures against `miljor_db` or mutate `miljor_sandbox_db`. Never delete or overwrite historical commercial evidence.
4. **Git Mutation Prohibition:** Skills suggesting automated git actions (such as `finishing-a-development-branch` or `using-git-worktrees`) are strictly barred from running `git commit`, `git push`, `git merge`, or `git rebase` without explicit user command.
5. **Graceful Fallback:** If a skill is unavailable, broken, or ambiguous, immediately fall back to standard MilJor Protocol v2.0 engineering conventions.
6. **Reporting:** When a substantial phase or task utilizes one or more installed skills, document the exact skills applied and their outcome in the phase report.

