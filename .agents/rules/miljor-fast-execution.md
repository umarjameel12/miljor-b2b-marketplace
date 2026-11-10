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
- **Risk-Based Testing:** Run Level 1 focused tests (<5s) immediately after editing. Do not rerun unchanged successful tests without reason.
- **Rerun Only Failed Tests:** On test failure, isolate the root cause, apply the minimal fix, and rerun only the failed test before confirming the suite.
- **Database Isolation:** All automated tests run strictly against `miljor_test_db`. `miljor_db` must remain pristine.
- **Zero Live Transactions:** Payment provider is Safepay sandbox only. Client-sent `PAID` statuses and mock payment references are strictly rejected.
- **Phase Gate Integrity:** Never advance across milestone or phase boundaries without explicit authorization.
- **Git Authorization Policy:** Explicit user approval to implement a named phase also authorizes committing and pushing that phase's verified changes to its approved feature branch. No separate commit/push confirmation is required. A new phase, force-push, merge to main, destructive database action, unrelated change or external money movement still requires its own authorization. If verification fails, do not label the phase complete. Never reset uncommitted user work.
