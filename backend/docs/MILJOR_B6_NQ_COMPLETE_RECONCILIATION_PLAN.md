# MilJor — B6 N–Q Complete Reconciliation (Business Contract + Execution)

Date: 2026-11-11
Isolated branch: `feature/b6-nq-complete-reconciliation`
Base: `feature/b6-phase2-nq` @ `9c0206bbfe215eef4d98115109d01a98337133e1`
Scope: **B6 ONLY**. Do not edit B4/B5/UCP/E2, backend-integrity or financial branches; do not touch production `miljor_db` or `miljor_sandbox_db`.

## Business invariants retained
- B6 remains buyer-initiated Smart RFQ, private collective procurement and buyer-owned recurring purchase cycles; it is NOT the B4 Regular or B5 Flash supplier Create Pool engine.
- Each participating business buyer keeps its own schedule, SKU/family/grade/pack requirements, exact planned quantities, consent, approval and payment state. An organizer cannot commit or pay for another buyer.
- At a cohort's cycle cutoff, under-minimum participants fail without stock reservation/payment; qualified cohorts go through existing private supplier bids and explicit individual approvals.
- Supplier-owned published physical SKUs and packaging govern quote comparability. No cross-grade or mixed-unit aggregation.
- Grouped Lahore delivery requires actual supplier zones, paid orders and an unchanged authorized buyer destination. Never invent distance, delivery charge, ETA or paid status; pickup/express cannot be promoted without their authorized original-order pathways.
- Source-owned UTC deadlines control all countdowns. Notifications are buyer/supplier scoped with no address/phone leakage. Preorder remains `PREORDER_POLICY_NOT_APPROVED`; no external refunds or payouts authorized by this work.
- Safepay verified payment/webhook and B4/B5 shared stock rules are external dependencies to re-test, never duplicate.

## Why this branch
The previous accepted `feature/b6-phase2-reconciliation` branch @ `6731ee0` was created from an earlier B6 source checkpoint. Its acceptance report documents 252/252 assertions and an essential SQL syntax repair, but it omits 15 later original-branch commits, including:
1. Buyer-owned recurring-cycle join restrictions and private quantity projection.
2. Under-minimum deadline closure, persistent retry-safe lifecycle and scheduler integration.
3. Paid delivery destination/address equality and express/pickup fail-closed guards.
4. The three associated regression test files (11+9+11 assertions).
5. Connected buyer UI compatibility updates.

Rebuild on latest original B6 base rather than overwrite the accepted or parallel branches. Copy only the accepted `047_procurement_delivery_runs.sql` UNIQUE-key syntax correction (verified byte-for-byte except the known one-line difference). Never copy the stale services from the accepted branch over newer implementations.

## Implementation performed on this isolated branch
1. Branch created from latest original B6 source, retaining the later safety logic and all seven N–Q suites.
2. Corrected `UNIQUE KEY uq_proc_o_stop_order UNIQUE (order_id)` to `UNIQUE KEY uq_proc_o_stop_order (order_id)` using the exact previously tested accepted SQL.
3. Added `backend/tests/b6_nq_complete_source_gate.js` as a serial gate for 7 pre-existing suites, including the three previously omitted suites.
4. No database access, financial action, Git merge, or test execution performed by the GitHub-only editor. Any acceptance count from older branches is historical only.

## Mandatory next acceptance (do not label complete until executed)
1. On checked-out isolated branch: `cd backend && node tests/b6_nq_complete_source_gate.js`. Expect seven exit-zero suites; their underlying pre-existing assertions historically total 81. Record ACTUAL output/exit codes.
2. Run JavaScript syntax checks on modified B6 source; run B6-F concurrency, B6 G–M connected gates and B5 shared stock regressions.
3. FIRST reconcile globally conflicting migration versions 046/047/048 against the actual test database migration journal before any further migration. Do not simply renumber or edit already applied migration records, and do not bypass the integrity branch's fail-closed collision guard.
4. On an isolated, backed-up disposable `miljor_test_db`, run SQL schema checks and real authenticated buyer/supplier HTTP lifecycle tests: concurrent cycle creation, cycle join/retry/cutoff races, individual quantity lock, late participant, expired quotes, PII, paid-order delivery address changes, dispatch, notifications rollback and duplicate fees.
5. Test signed Safepay sandbox and order/payment/refund/shared B4/B5 inventory compatibility without moving real funds.
6. Run frontend production build plus buyer/supplier browser walkthrough of same RFQ screen, private notices and UTC countdowns; verify unchanged other modes.
7. Independently capture protected DB read-only fingerprints and update phase log with final SHA, actual commands, counts and PASS/FAIL/BLOCKED verdict.

## Gates
- Source reconciliation: changes committed to isolated B6 branch; NOT YET EXECUTED.
- Runtime integration: BLOCKED pending environment and cross-branch migration identity resolution.
- B6 final acceptance / B7 authorization: BLOCKED until genuine all-system regression and explicit owner authorization.

Do not modify any other chat's workstream or merge automatically.
