# MilJor — P0 Financial Settlement Hardening: Plan & Implementation Ledger
Date: 2026-11-11
Branch: `fix/p0-financial-settlement-hardening-isolated`
Parent: `fix/independent-backend-integrity`

## Scope isolation
**Only** the financial settlement service, financial tests and financial docs are in scope. B4/B5/B6 pools, countdowns, RFQ, recurring, delivery, frontend, migrations, payment checkout and other agents' branches remain unchanged. No live transfers or DB mutations have been performed during this GitHub-only work.

## Accepted execution plan
1. **P0 duplicate payout preparation**: serialize per-payable, reject duplicate instructions even with a different idempotency key; same-key replay succeeds only if identical beneficiary and amount.
2. **P0 financial holds and refunds**: block preparation when any unsettled refund obligation exists; require exact payable conservation and zero previous disbursement.
3. **P0 approval safety**: lock the parent payable first and recheck live refund claims, active holds, remaining available amount and status before approval.
4. **P1 provider evidence**: retain manual Safepay refund confirmation as fail-closed; design authenticated provider evidence and settlement reconciliation separately, not an invented success event.
5. **P1 acceptance**: unit scenarios and MySQL-backed concurrency/HTTP acceptance against `miljor_test_db` only. No success claims without execution.

## Implemented in this branch
- `src/services/financialSettlementService.js`
  - Strict administrator eligibility and mandatory valid idempotency key when preparing supplier payouts.
  - Locks supplier payable and looks up existing payout instructions and global idempotency replays with `FOR UPDATE`.
  - Same-key, same-payable, same beneficiary and same amount returns the original instruction; conflicting or multiple instructions fail with 409.
  - Pending refunds in REQUESTED, UNDER_REVIEW, APPROVED, AWAITING_EXTERNAL_EXECUTION or EXTERNAL_PROCESSING block preparation.
  - Net payable minus refund deductions minus held amount must exactly equal available amount; disbursed amount must be zero.
  - Only allowable pre-disbursement payable statuses proceed.
  - Before approval: first lock payable, then payout instruction; recheck active holds, refund obligations, remaining available amount and prepared status.
- `tests/p0_disbursement_integrity_gate.js`: 7 isolated negative/replay test scenarios using mocked connections (not executed).

## Known remaining blockers
- The new test uses the existing database config module; ensure `NODE_ENV=test` and `TEST_DB_NAME=miljor_test_db`; close pool cleanly in test harness after execution to prevent hanging open handles.
- Full SQL-schema constraint review and concurrent HTTP tests pending. Application row locks provide serialization only if every competing payout path locks the same payable row; inspect all other finance routes before release.
- Existing partial/approved payout instructions should not be recreated by switching idempotency keys. There is no automatic external payout.
- The system still lacks independently authenticated Safepay refund-completion ingestion; internal refund confirmation remains disabled.
- Order commission snapshots are staged in a separate isolated branch, not merged into this branch. Settlement continues fail-closed on missing rates; do not silently set rates from current profiles.
- The migration 046/047/048 collision and B4/B6 integrated branch are outside this task; no migration runner edits were made.

## Acceptance gate
**SOURCE IMPLEMENTED / TESTS NOT RUN / DATABASE NOT MODIFIED / RELEASE BLOCKED.**
Follow-up: run isolated gate and Phase 4 suite, then real MySQL concurrency on `miljor_test_db` with rollbacks and financial conservation checks. Do not deploy or merge this branch until PASS.

## Execution update — Steps 1–3 (2026-11-11)

### Step 1 — Focused financial regression: PASS (isolated)
Executed the ACTUAL fetched `prepareSupplierDisbursement`, `approveSupplierDisbursement`, and `_logAuditEvent` source methods using a V8 isolated environment. The committed `tests/p0_disbursement_integrity_gate.js` was also evaluated with Node built-in shims, mock DB connections and the real exactDecimal source. Last observed test gate: **14 / 14 assertions PASS**; this is NOT a real Node.js, MySQL or HTTP test run.

### Step 2 — Fix issues: committed
- Replaced floating-point payable held/available threshold checks with exactDecimal helpers.
- Require a valid authorized actor when approving a prepared supplier payout.
- Before approval, read current supplier verified state and buyer receipt fulfillment; reject revocation, incompatible fulfillment or external execution other than DISABLED.
- Recheck that net payable minus refund deductions minus held amount equals available amount before approval.
- Preserve existing prevention of duplicate payout instructions, conflicting keys, pending refund preparation and active holds.
- Financial audit event amountDelta now uses canonical exact decimal instead of Number(value).toFixed(2).

### Step 3 — Concurrency and accounting: PASS (simulated), DB gate pending
The concurrency test simulates two asynchronous requests, a payable-row lock queue, transactional commit and rollback. Result: **one payout instruction inserted, one request committed, one duplicate rejected and rolled back**. A repeat with the successful request key returns the existing instruction; no second insert. Exact accounting and policy-negative tests pass under mocked DB responses.

### Tests run and claims
- Committed regression source under `backend/tests/p0_disbursement_integrity_gate.js`: 14/14 isolated V8-backed assertions PASS as executed against fetched service and real exactDecimal module.
- No MySQL SQL migration, Safepay live call, DB mutation, external money transfer or project checkout performed.
- Real `node tests/p0_disbursement_integrity_gate.js` under the repository's Node environment is **NOT EXECUTED** here.
- Real MySQL InnoDB concurrent transaction test and full Phase 3/4/Safepay HTTP regression suite are **NOT EXECUTED** here.
- Do not conflate isolated test green with production financial readiness.
- No files from other chat-owned pool/B4/B5/B6/recurring/delivery implementation were changed.

### Remaining P0 acceptance
1. Clean dedicated worktree checkout of this branch and Node execution of `node tests/p0_disbursement_integrity_gate.js` (does not connect DB).
2. Run existing financial/refund/payment regression suites against `miljor_test_db` ONLY.
3. Verify real InnoDB concurrent preparation and approval, with rollback and unique DB constraints, using disposable fixtures; compare ledger totals before/after.
4. Validate database schema and instruction uniqueness against migrations; confirm no old paid/approved instruction bypass path.
5. Never allow real payouts while external payout execution is DISABLED.
6. Status: **STEPS 1–3 ISOLATED IMPLEMENTATION AND SIMULATED TESTING COMPLETE; DATABASE E2E BLOCKED, NOT PRODUCTION READY**.
