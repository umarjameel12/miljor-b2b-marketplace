---
trigger: always_on
description: Workspace-specific fast-execution and command conventions for MilJor B2B marketplace
---

# MilJor Fast-Execution Rules

These instructions optimize agent execution velocity, eliminate redundant tool calls, and maintain strict engineering and domain invariants across the MilJor codebase.

## 1. Command Execution & Search Efficiency
- **Working Directory Discipline:** Always run commands in the correct directory:
  - Backend commands, tests, and migrations: `cd backend; <command>` (ensures `.env` and `node_modules` resolve on the first attempt).
  - Frontend commands: `cd frontend; <command>` or `npm --prefix frontend <command>`.
- **Targeted Lookups:** Target exact paths (`backend/src/services/`, `frontend/src/pages/`). Never use unbounded recursive scans (`**/*` or un-scoped grep) that choke on `node_modules`.
- **Exclude Dependencies & Artifacts:** Exclude `node_modules`, `dist`, `build`, `coverage`, and `database/backups` from routine searches.
- **Synchronous Command Timeouts:** For tests and builds expected to complete within 2–10 seconds, set `WaitMsBeforeAsync` within supported tool limits (5,000 to 10,000 ms; maximum is 10,000 ms) to avoid unnecessary backgrounding and polling.
- **Background Execution:** Use background tasks (`WaitMsBeforeAsync: 500`) only for long-running processes (e.g. dev servers). Avoid repetitive polling; the environment wakes up reactively on task completion.

## 2. Implementation Efficiency
- **Single-Pass Discovery:** Inspect relevant code and documentation once per task. Avoid repeated searches or reopening unchanged files.
- **Reuse Existing Core Engines:** Re-use existing services (`tierPricingService`, `poolProgressService`, `commercialLifecycleService`, `feeService`, `paymentProviderService`, `safepayCheckoutService`, `subscriptionEntitlementService`, `idempotencyGuard`). Never build duplicate engines.
- **Minimal Surgical Edits:** Use precise `edit_file` patches. Avoid large rewrites or altering unrelated lines.
- **Concise Reporting:** Provide standard 10–20 line structured summaries (`TASK`, `IMPLEMENTED`, `FILES`, `TESTS`, `EVIDENCE`, `DATABASE`, `UNRESOLVED`, `RESULT`). Output `CAN START NEXT PHASE: NO` and stop cleanly.

## 3. Testing & Verification Safety
- **One Final Phase Test Gate:** During an approved phase, implement all scoped changes first. Do not repeatedly run integration, regression, frontend build, or master suites after each edit. At the end of the phase, run one consolidated, relevant integration/regression gate against the isolated test database; targeted checks are allowed only when needed to diagnose failures or protect critical transaction/data safety. If the final gate fails, fix the root cause and rerun only affected failures, then verify the final gate once after stabilization. Never claim PASS on unexecuted tests.
- **Persistent Phase Evidence:** After the final test gate, save the exact executed commands, PASS/FAIL/BLOCKED evidence, database isolation verification, changed files, final git SHA, unresolved issues, and phase decision to a dedicated report in `backend/docs/` and update `backend/docs/MILJOR_PHASE_LOG.md`. Commit/push the report with verified phase changes. Never replace failed evidence with a false PASS.
- **Database Isolation:** All automated tests run strictly against `miljor_test_db`. `miljor_db` must remain pristine.
- **Zero Live Transactions:** Payment provider is Safepay sandbox only. Client-sent `PAID` statuses and mock payment references are strictly rejected.
- **Phase Gate Integrity:** Never advance across milestone or phase boundaries without explicit authorization.
- **Git Authorization Policy:** Explicit user approval to implement a named phase also authorizes committing and pushing that phase's verified changes to its approved feature branch. No separate commit/push confirmation is required. A new phase, force-push, merge to main, destructive database action, unrelated change or external money movement still requires its own authorization. If verification fails, do not label the phase complete. Never reset uncommitted user work.
