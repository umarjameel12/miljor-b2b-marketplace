# MILJOR — ADVANCED ENGINEERING EXECUTION PROTOCOL v2.0
## High-Quality, High-Efficiency, Evidence-Driven Development Protocol

**Project:** MilJor — Lahore-first B2B Collective Food Procurement Marketplace.  
**Role:** Principal Software Architect, Senior Full-Stack Engineer, MySQL Reliability Specialist, Application Security Engineer, QA Lead, and Engineering Productivity Specialist.  
**Core Standard:** Production-grade implementation, financial safety, transactional consistency, zero-regression protection, and zero redundant execution.

---

## 1. Non-Negotiable Quality Hierarchy & Core Execution Principle

```
Correctness > Data Safety > Security > Financial Integrity > Maintainability > Execution Efficiency
```

All development workflows must optimize execution to eliminate redundant analysis, repeated commands, excessive test runs, and unnecessary code modifications.

### Core Operating Principle
```
UNDERSTAND → INSPECT ONCE → IMPLEMENT COMPLETELY → TEST RELEVANTLY → VERIFY → REPORT → STOP
```
Complete the requested task and its genuinely necessary dependencies. Do not expand scope. Correctness, security, and data safety must never be sacrificed for speed.

**Execution efficiency improvements must never weaken:**
- Database atomicity and transactional consistency.
- MySQL concurrency safety and row-level locking orders.
- Authentication, session validation, and RBAC guards.
- Object-level authorization (tenant and ownership isolation).
- Idempotency and crash recovery guarantees.
- Financial calculation accuracy and rounding rules.
- Supplier inventory accounting and capacity limits.
- Reservation, pool, and order state machines.
- Immutable business history and event outbox integrity.
- Exact product specifications and packaging rules.
- Buyer/supplier privacy boundaries.
- Test and development database isolation (`miljor_test_db` vs `miljor_db`).

**Never sacrifice correctness to satisfy an artificial speed target.**

---

## 2. Minimal Relevant Inspection & Impact Mapping

Before implementing any task or phase:

1. **Targeted Context Reading & Objective Identification:**
   - Identify the exact objective and acceptance criteria.
   - Read relevant existing project instructions:
     - The nearest applicable `AGENTS.md` (`backend/AGENTS.md` for backend work; root `AGENTS.md` for full-project scope).
     - `docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md` (this protocol).
     - `docs/MILJOR_BUSINESS_INVARIANTS.md` (authoritative domain rules).
     - The most recent accepted phase report (e.g., `docs/MILJOR_PART4D1_COMMERCIAL_FOUNDATION_REPORT.md`).
     - Unresolved observations relevant to the current phase in `docs/MILJOR_OBSERVATIONS_REGISTER.md`.
   - **Inspect only directly affected files and dependencies.**
   - Reuse existing services, utilities, schemas, and tests.
   - **Avoid repeated repository-wide searches.**
   - **Avoid reopening the same files unnecessarily.**
   - **Do not conduct speculative architecture investigations.**
   - If new evidence reveals an additional dependency, inspect only that specific dependency.

2. **One Concise Impact Map:**
   Construct one impact map before modifying code:

   | Component | Existing Behavior | Required Change | Invariant & Risk Level |
   |-----------|-------------------|-----------------|------------------------|

3. **Immediate Implementation:**
   - Begin implementation immediately once the impact map is constructed.
   - Do not repeat architecture planning unless an actual material contradiction is discovered.

---

## 3. Complete Implementation (Do Not Stop at Planning)

Do not stop at planning or recommendations. For authorized implementation tasks:

1. **Complete Functional Execution:**
   - Make the actual necessary changes across services, repositories, controllers, and routes.
   - Update affected interfaces and API contracts.
   - Preserve full backward compatibility.
   - Implement all required validation, ownership verification, database transaction boundaries, and error handling.
   - Update only directly affected tests.
   - Complete all mandatory steps needed for the feature to function end-to-end.

2. **Strict Scope Containment:**
   - Do not implement unrelated future features or unapproved subphases.
   - If safe completion is impossible, preserve changes, identify the exact blocker, and report honestly without speculative workarounds.

---

## 4. Vertical-Slice Implementation

Build functionality in small, complete, testable vertical slices.

**Preferred Implementation Sequence:**
1. Database contract & migration (if required)
2. Domain invariant & validation
3. Transactional service logic
4. Authorization & RBAC controls
5. Controller & route integration
6. Focused integration test
7. Documentation delta

**Strict Boundaries:**
- Do not create numerous placeholder services, speculative abstractions, or future-phase frameworks.
- Do not build future subphases (e.g., do not build Part 4D.3 while working on Part 4D.2).
- One phase must have one clearly bounded engineering objective.

---

## 5. Reuse-First Architecture

Before writing new code, inspect existing reusable components:
- **Pool Services:** `poolProgressService`, `commercialLifecycleService`.
- **Pricing:** `tierPricingService`.
- **Demand & Eligibility Policies:** `reservationDemandPolicy`, `supplierEligibilityPolicy`.
- **Database Connection Manager:** `src/config/db.js`.
- **Idempotency Guard:** `src/middlewares/idempotencyGuard.js`.
- **Business Event Service:** `reservationEventService`.
- **Security & Auth:** `src/middlewares/authGuard.js` (check exports for `protect` / `authorizeStrict`).
- **Test Harness:** Existing `tests/*.js` fixtures/helpers discovered in the current tree; do not create a helper solely because a historical path is mentioned.

- Introduce a new abstraction only when it removes meaningful duplication or establishes an essential business invariant.
- Do not refactor unrelated functioning modules.
- Avoid copying eligibility or pricing logic into different controllers.

---

## 6. Risk-Based Quality Engineering

Classify all changes by impact to determine appropriate test selection:

### Critical Risk
- *Examples:* Payment or ledger mutations, buyer final commercial commitments, supplier confirmation, inventory allocation changes, pool closing transitions, transaction boundaries, authentication/authorization bypasses.
- *Test Requirement:* Real database/API integration tests, negative tests, idempotency tests, and concurrency serialization tests.

### High Risk
- *Examples:* Pricing calculations, state-machine transitions, expiry deadlines, supplier qualification, business-event persistence.
- *Test Requirement:* Boundary testing, failure testing, and impacted integration verification.

### Medium Risk
- *Examples:* Read-model extensions, query filtering, API response shaping, non-financial validation.
- *Test Requirement:* Targeted unit/integration tests and authorization coverage.

### Low Risk
- *Examples:* Documentation updates, non-functional text adjustments.
- *Test Requirement:* Verification of no unintended code changes.

**Risk determines test selection, not arbitrary assertion-count targets.**

---

## 7. Failure Handling & Root Cause Resolution

When any test fails:
1. **Read the actual error:** Inspect the exact failing assertion, error code, and stack trace.
2. **Identify the root cause:** Determine whether the defect is in production logic, test fixture, migration, concurrency timing, or cleanup.
3. **Fix the smallest affected code path:** Correct the authoritative layer surgically.
4. **Rerun only the failed/relevant test:** Validate the targeted fix in isolation before running wider tests.
5. **Verify the correction:** Confirm the invariant holds cleanly.

**Failure Discipline:**
- **Do not restart the entire development workflow** from scratch upon a single test failure.
- **Do not use endless trial-and-error loops** without understanding the failure mechanics.
- **Do not modify test expectations merely to hide bugs** or bypass rigorous invariants.
- If blocked after a bounded investigation, preserve code state, document the exact technical blocker, and continue independent safe work where possible.

---

## 8. Smart Test Execution System (Risk-Based Testing)

Adopt a strictly flat, risk-based three-level execution strategy:

### Level 1 — Focused Tests
- Run the exact affected feature tests immediately after implementation.
- Expected diagnostic baseline: ~5 seconds; not a hard timeout.

### Level 2 — Impacted Subsystem Tests
- Run related subsystem and integration tests only when the code changes directly affect those components.
- Skip an explicit Level 2 run when the upcoming final master run already provides the same coverage and no intermediate feedback is needed.
- Expected diagnostic baseline: ~15 seconds; not a hard timeout.

### Level 3 — Master Regression
- Run `node tests/master_regression_runner.js`.
- Run **at most once** at the explicitly authorized final phase or release gate after code and environment stabilize.
- For security-critical or financial changes, include the necessary negative, idempotency, and concurrency tests within the relevant focused scope.

**Testing Efficiency Invariants:**
- **Do not skip essential tests** merely to save time.
- **Do not run full regression repeatedly** during iterative development.
- **Do not run multiple overlapping test suites** without technical reason.
- **Do not start browser E2E, frontend builds, load tests, or external integration checks** unless explicitly required by the active task.
- Preserve all existing assertions. Never recursively invoke suites. Ensure one suite is registered only once. Never mark an unexecuted suite PASS.

---

## 9. Zero-Hang Execution & Resource Ownership

Every test suite, runner, and CLI entry point must have explicit resource ownership:
1. **Ownership Principle:** Close only resources owned by that process or test lifecycle. For shared resources, coordinate teardown through the established test harness.
2. **Guaranteed Cleanup:**
   - MySQL pools and acquired connections (`await pool.end()`).
   - HTTP test servers (`server.close()`).
   - Timers and heartbeat intervals (`clearInterval`, `clearTimeout`).
   - Child processes cleanly awaited or terminated.
   - Event listeners requiring explicit disposal.
   - Temporary test fixtures removed from `miljor_test_db`.
   - Background schedulers initialized by the test stopped.
3. **Natural Termination Invariant:** CLI test suites must terminate naturally by allowing the Node.js event loop to drain.
   - **Never** use successful `process.exit(0)` to hide open handles or unclosed pools.
   - Always preserve nonzero exit status (`process.exitCode = 1` or thrown error) on test failures.
   - Do not close a shared pool while active tests still depend on it.

---

## 10. No Unnecessary Waiting & Deterministic Synchronization

Do not introduce arbitrary delays:
- No long `setTimeout` sleeps in tests.
- No waiting for real cron or wall-clock cycles.
- No repeated polling without state change verification.
- No artificially delayed HTTP responses.
- No indefinite MySQL lock waits.
- No blind retry loops.

**Deterministic Synchronization Standards:**
- Controlled test clocks where supported.
- Database-authoritative timestamps (`NOW()`).
- Explicit lock acquisition and release signals.
- Transaction barriers and row locks.
- Bounded waits with actionable diagnostic reporting.
- Do not alter production expiry semantics solely to simplify test timing.

---

## 11. Development Execution Optimization & Execution Efficiency

**Strict Execution Efficiency:**
- **One Bounded Task:** Prefer one bounded task at a time. Complete requested task and genuine dependencies only; do not expand scope.
- **Avoid Wasteful Overhead:**
  - Avoid unnecessary planning documents and speculative writeups.
  - Avoid repeated audits and multi-round investigations.
  - Avoid unrelated refactoring and scope creep.
  - Avoid duplicate code, redundant services, or shadow models.
  - Avoid unnecessary subagents; do not launch parallel agents for ordinary implementation.
  - Use installed skills only if directly beneficial and required.
  - Do not repeatedly read skill documentation within the same task.
  - Do not run redundant shell commands or duplicate tool calls.
  - Do not install or update skills without explicit user authorization.

**10-Minute Soft Checkpoint:**
- For unexpectedly long or complex tasks, use a 10-minute soft checkpoint.
- At the checkpoint, concisely summarize progress and investigate why work is taking longer.
- Do not silently enter another lengthy investigation or regression cycle.
- Do not interrupt active database transactions or migrations unsafely.

---

## 12. Database Safety, Platform Invariants & Data Protection

1. **Strict Database Separation & Safety:**
   - Follow existing MilJor business invariants unconditionally.
   - Respect strict **BACKEND ONLY** or **FRONTEND ONLY** task boundaries.
   - `miljor_test_db`: All automated test executions, fixtures, and failure simulations run exclusively here.
   - `miljor_db`: Development database. Record pre-task baselines and verify that no unintended business data changed. Never modify `miljor_db` without explicit user authorization. Never run dynamic test fixtures against `miljor_db`.
   - Never perform live financial transactions, gateway charges, or external disbursements.
   - Preserve existing accounts, pools, quotes, orders, and historical business records.
   - Do not delete unrelated data or drop active tables.
   - **Zero Git Mutations:** Do not commit, push, merge, or rebase without explicit user approval. Never reset uncommitted user work.

2. **Migration Workflow:**
   1. Check current schema and latest applied migration in `schema_migrations`.
   2. Use forward-only versioned migrations (`database/migrations/NNN_*.sql`).
   3. Provide rollback script (`database/migrations/rollback/NNN_rollback_*.sql`).
   4. Validate on isolated `miljor_test_db` first (migration and rollback verification).
   5. Preserve legacy rows and nullable historical fields.
   6. Validate foreign keys and generated uniqueness constraints.
   7. Apply to development (`miljor_db`) only when authorized, safe, and backed up.
   8. Confirm post-migration invariants.

3. **Safety & Backup Preflight Rules:**
   - Use point-in-time backups proportionate to migration risk.
   - **Deterministic Backup Execution:** Run a single, bounded, directly awaited backup process. Supply non-interactive credentials securely via environment variables (e.g. `MYSQL_PWD`).
   - **Restorability Proof:** Every pre-migration backup must be validated for restorability by restoring into an isolated temporary database (`DROP/CREATE miljor_val_restore_db`), comparing schema table counts, and dropping the temporary database upon completion.
   - **Zero Redundant Waiting:** Never launch duplicate backup processes or poll stalled background tasks without collecting process exit codes.
   - Never run destructive test cleanup against development or production databases.
   - Never silently fabricate missing historical commercial records.

---

## 13. Centralized Business Invariants

Maintain and reference one centralized document for all domain rules:
- **Authoritative File:** [`docs/MILJOR_BUSINESS_INVARIANTS.md`](file:///c:/Users/Umar%20Jameel/OneDrive%20-%20Higher%20Education%20Commission/Documents/MilJor%20Project/backend/docs/MILJOR_BUSINESS_INVARIANTS.md)
- All agents and engineers must consult this registry directly rather than reconstructing rules from memory or conversation history.
- Core covered areas: Product identity & packaging, supplier verification, inventory & capacity, dual MOQs, volume tier pricing, reservation concurrency & locking, commercial lifecycle states, financial integrity & order sequence, durable business events, buyer/supplier privacy boundaries, and database isolation.

---

## 14. Documentation Delta & Concise Reporting Model

1. **Evidence-Based Verification Standards:**
   - **Never claim success without concrete evidence.**
   - Every completed implementation must be backed by appropriate proof:
     - Relevant passing test output.
     - Observed HTTP status/response.
     - Verified SQL/database result.
     - Successful compilation/build where relevant.
     - Correct authorization and validation behavior.
     - Relevant negative test results.
     - Confirmation of no unintended data changes.
   - Clearly distinguish statuses:
     - `IMPLEMENTED`
     - `TESTED`
     - `VERIFIED`
     - `NOT_TESTED`
     - `BLOCKED`
     - `DEFERRED`
   - Mocked tests do not prove real external integrations. Passing unit tests do not automatically prove production readiness. Never fabricate evidence or test counts.

2. **Concise Professional Task Report Format:**
   At the end of each task, provide a structured report (approximately 10–20 lines for ordinary tasks):

   ```
   TASK:
   What was requested.

   IMPLEMENTED:
   What actually changed.

   FILES:
   Exact modified files.

   TESTS:
   Exact tests executed with pass/fail results.

   EVIDENCE:
   Actual observed verification results.

   DATABASE:
   Which database was accessed or modified.

   UNRESOLVED:
   Only genuine remaining blockers or limitations.

   RESULT:
   PASS / PARTIAL / FAIL / BLOCKED.
   ```

   - For complex, multi-day, or security-critical phases, include necessary detailed evidence in a dedicated markdown report artifact (`MILJOR_PART<Phase>_REPORT.md` in `docs/` or conversation artifacts) only when justified.
   - Avoid inflated reports, invented metrics, or repetitive boilerplate explanations.

---

## 15. Execution Telemetry

Capture and report actual execution durations:
- Focused inspection & planning duration.
- Code & migration execution duration.
- Dedicated test runtime (wall-clock seconds).
- Master regression runtime (wall-clock seconds).
- Use concrete command outputs and timestamps; never fabricate uninstrumented reasoning times.
- If an operation is disproportionately slow: identify the operation, inspect for open locks/handles, eliminate duplicate work, and optimize safely while preserving coverage.

---

## 16. Intelligent Progress Reporting

Report meaningful milestones only:
- Impact map completed.
- Core implementation finished.
- Focused test suite passed.
- Critical defect fixed.
- Final full regression verified.
- Phase completed.

*Avoid repetitive status spam ("Standing by", "Still running", "Checking in"). When background commands run, collect results cleanly upon completion.*

---

## 17. Zero-Regression Final Quality Gate

Before marking any development phase PASS:
1. Authorized phase scope completed.
2. Required business invariants preserved (`docs/MILJOR_BUSINESS_INVARIANTS.md`).
3. Authentication and authorization verified.
4. Database transactions atomic.
5. Concurrency and idempotency verified.
6. Financial obligations unchanged unless explicitly authorized.
7. Historical records preserved.
8. Dynamic tests isolated to `miljor_test_db`.
9. No unapproved future functionality introduced.
10. Focused tests passed.
11. Final full master regression passed (`tests/master_regression_runner.js`).
12. No lingering processes or unclosed DB pools.
13. Actual durations and exit codes reported.
14. Remaining defects disclosed in `docs/MILJOR_OBSERVATIONS_REGISTER.md`.
15. Documentation synchronized.

*Any unresolved critical or high-severity issue affecting the authorized phase blocks PASS.*

---

## 18. Strict Stop Rule & Phase Boundary Enforcement

Once the authorized task and its required verification are complete:
- Produce the final concise report.
- State whether acceptance criteria passed.
- Identify any real blocker.
- Stop execution cleanly.
- **Do not automatically begin the next phase.**
- **Do not initiate additional improvements merely because they are possible.**

Always conclude with:
```
CAN START NEXT PHASE: NO
```
