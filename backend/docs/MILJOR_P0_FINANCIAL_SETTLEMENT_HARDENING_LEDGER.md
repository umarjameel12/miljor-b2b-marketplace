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
