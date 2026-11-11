# MilJor Backend — Agent Engineering Instructions

**Project:** MilJor — Lahore-first B2B Collective Food Procurement Marketplace.  
**Priority Hierarchy:** Correctness > Data Safety > Security > Financial Integrity > Maintainability > Execution Efficiency.  
**Inherited Core Instructions:** Root [`../AGENTS.md`](../AGENTS.md) governs shared Core Operating Rules (Section 1), Installed Agent Skills Inventory & Policies (Section 2), and Protocol Precedence (Section 2.3).  
**Authoritative Protocol Reference:** [`docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md`](docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md)  
**Authoritative Business Invariants:** [`docs/MILJOR_BUSINESS_INVARIANTS.md`](docs/MILJOR_BUSINESS_INVARIANTS.md)

---

## 1. Backend Execution Context & Working Directory

1. **Working Directory Mandate:** All backend commands, migrations, server executions, and test suites must run with the working directory set to `backend/` (e.g. `cd backend; node ...`) to ensure correct `.env` loading and dependency resolution.
2. **Database Isolation:** All backend tests, fixtures, and failure simulations execute strictly against `miljor_test_db`. Production/business database `miljor_db` must remain pristine.
3. **Core Operating Flow:** Strictly follow the root protocol: `UNDERSTAND → INSPECT ONCE → IMPLEMENT COMPLETELY → TEST RELEVANTLY → VERIFY → REPORT → STOP`.

---

## 2. Lean Senior Engineering Mode (Backend Invariants)

- **Minimal Necessary Code:** Prefer **no change** when the requirement is already satisfied. Otherwise reuse existing MilJor backend services (`tierPricingService`, `poolProgressService`, `commercialLifecycleService`, `feeService`, `paymentProviderService`, `safepayCheckoutService`, `subscriptionEntitlementService`, `idempotencyGuard`) before adding code. No speculative frameworks, wrappers, configs, or future-phase functionality.
- **Caller Inspection:** Before modifying shared code, inspect its affected callers, routes, exports, fixtures, and tests once. Fix the root cause at the authoritative layer; preserve validation, errors, compatibility, and useful diagnostics.
- **Consolidated End-of-Phase Verification:** Finish the approved phase's scoped implementation before running the relevant integration/regression gate once. Avoid repeated suites after each edit; use focused diagnostic checks only when necessary to isolate a failure or protect immediate data safety. The final phase gate must cover affected behavior and essential authorization, rollback, idempotency and concurrency cases. The master runner runs at most once when the phase requires it. Save actual final commands, results, connected test DB, changed files, blockers and Git SHA in a dedicated `backend/docs/` phase report and update `backend/docs/MILJOR_PHASE_LOG.md`; commit/push the evidence with the verified changes.
- **Non-Simplifiable Backend Invariants:** Never simplify away tenant-scoped authorization, supplier verification, DB transaction/lock order, exact decimal monetary calculations, durable idempotency, post-lock DB deadline validation, immutable historical evidence, inventory allocation, privacy, or safe forward migrations. Do not delete historical business records or applied migrations for convenience.
- **Baselines vs Deadlines:** Treat test time targets as **diagnostic baselines**, not deadlines. If a command is abnormally slow, inspect its PID, last completed step, database locks, pending handles, and exit status before attempting a retry. Never launch duplicate tests, backups, or migrations while an earlier task may still be active.
- **Reporting:** Every completed task reports changed paths, reason, caller/data impact, actual verification results and runtimes, preserved invariants, safe recovery where applicable, and deliberately deferred scope. For major phases follow the more detailed phase-specific report. Output `CAN START NEXT PHASE: NO` and stop cleanly.
- **Precedence:** The engineering protocol and business invariants override every lean-code preference. Do not weaken tests or security to shorten execution.
- **Workspace Policy Freshness Gate:** At the start of every development phase, read the current on-disk `backend/AGENTS.md`, `backend/docs/MILJOR_ENGINEERING_EXECUTION_PROTOCOL.md`, and `backend/docs/MILJOR_BUSINESS_INVARIANTS.md` using paths relative to the project workspace. Verify all three files exist and are readable. Treat current disk contents as authoritative over cached summaries, previous task context, or earlier copies. Do not repeat these reads during the same phase unless the files change. If a required file is missing, unreadable, or materially contradictory, report the exact issue before making affected code changes. Do not recreate policy files, silently substitute cached content, or launch redundant audits.
