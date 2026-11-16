# Smart Hub delivery, receipts and reporting execution — 2026-11-16

## Scope and source reconciliation

Continues PR #53 on `feature/smart-procurement-hub-unified-entry`; parent implementation c4232e011b1fc4aaf7571467db35b1f51ba300ae. Fetch on this pass confirmed local HEAD equals the approved remote feature branch. Existing main 9fb07cf and historical B/UCP changes remain reconciled; no original-source checkout, user auth edits or protected database was overwritten. R2 exact c4232e0 PR workflows were verified 9/9 SUCCESS, including P0 and actual Chromium. Historical acceptance evidence is retained, not relabelled as acceptance of this delta.

The user explicitly authorized continuous remaining implementation and confirmed: commission on accepted merchandise at the immutable order commission rate; disputed delivery/processing fees held for admin review. This policy is versioned `R4_ACCEPTED_MERCHANDISE_V1`, requires buyer consent and never overwrites original order/invoice prices.

## Implemented

- Supplier-owned configured vehicle capacity, exact mass/volume measurement from immutable award lines, compatible supplier/cluster/day/handling/windows, independent express/individual run constraints, overlapping vehicle booking exclusion, conservative physical rounding and deterministic planned-cost shares. Supplier declared cost is not provider expenditure or buyer savings. Locked buyer fees remain unchanged.
- Buyer-owned destination/window choice with revisioned consent history; current address/accepted destination and commercial delivery-mode locks. Supplier proposes/confirms routes; dispatch/delivery must already exist in canonical order fulfillment. Predispatch cancellation releases current assignments while preserving history. Changed address revisions and expired windows reject confirmation.
- Private run context, ETA/delay events, actual dispatched failed-attempt evidence composed transactionally through canonical fulfillment, explicit revised-slot/fee proposal and owning-buyer consent. Approved zero-fee recovery requires no disputes/holds/receipts and an exception-closed old run. Extra-fee dispatch remains safely blocked without a supplemental verified payment contract. Recovery preserves old stop/events and constrains the new window to the approved slot.
- Actual PNG/JPEG/PDF proof bytes in private storage, 1 MiB/file and five/order limits, signature/hash validation, owner-only metadata/download, attachment/CSP/nosniff/no-store headers, stable upload key and atomic outbox. No remote URL fetch or fabricated upload success.
- Final per-award-line received/accepted/disputed quantities and exact bounded monetary residuals, immutable receipt replay, whole-package/increment validation, authoritative stored payment-attempt/event requirements. A bare PAID string is insufficient. Canonical buyer confirmation now requires undisputed acceptance of every procurement award line.
- Linked existing disputes, refund obligations and financial holds for partial receipts; accepted-merchandise supplier payable/commission, append-only prior-payable/allocation evidence, captured-value conservation and held original fees. Full undisputed receipts retain canonical settlement without creating partial-policy holds. Legacy aggregate approval/release cannot consume these line-linked funds. External execution remains DISABLED.
- Supplier/buyer UI for delivery operations, reattempt approvals, proof upload/private download and final product receipts; supplier vehicle/route workspace and owned reliability reporting. No restyling of the existing dashboard.
- Read-only reliability: one owned supplier order per denominator, supplier-confirmed compatible window, partial/missed/exception/unpaid/cancelled distinctions, preserved confirmation history, no line/event/invoice multiplication. Savings explicitly UNAVAILABLE without comparable recorded baseline.
- Existing notification outbox reused for window requests, route assignment/schedule/cancellation, ETA/delay, failure/proof/rescheduling and partial/dispute events. English/Urdu templates added where needed; repeated intents do not duplicate notifications. No completed provider payment/refund/settlement is fabricated.

## Actual local verification

1. Focused command from `backend`: `node --test tests/procurement_delivery_run_policy_gate.js tests/procurement_delivery_evidence.test.js tests/procurement_line_receipt_policy.test.js tests/procurement_line_receipt_transactions.test.js tests/procurement_line_receipt_api.test.js tests/procurement_line_receipt_financial.test.js tests/procurement_reporting_service_gate.js tests/procurement_reporting_routes_gate.js tests/notification_projection_gate.js tests/fulfillment_notification_hooks.test.js tests/financial_notification_action_gate.js` — **132/132 PASS**, exit 0, 3885.5886 ms. Policy/transaction doubles are labelled as such; local HTTP tests exercise real Express with boundary doubles.
2. Real SQL: secure original environment loaded without exposing/copying credentials; `NODE_ENV=test DB_NAME=miljor_test_db TEST_DB_NAME=miljor_test_db MILJOR_TEST_ONLY_MIGRATIONS=1 ALLOW_EXTERNAL_MONEY_MOVEMENT=false TRANSACTIONAL_EMAIL_MODE=mock SMART_HUB_OPERATIONS_GATE=1 node tests/collective_commitment_mysql_gate.js` — **17/17 labelled scenarios PASS**, exit 0, including cleanup. New extension uses actual MySQL SQL/FKs/outbox, parent rollback with per-API savepoints, actual independent-session NOWAIT exclusion, capacity/consent/privacy, proof/receipt notification failure rollback, exact linked finance, unchanged original order money and full-undisputed path. Synthetic payment rows/attempts/events are rollback-only SQL evidence; NOT genuine provider evidence. No persistent paid fixtures or provider calls.
3. `node tests/canonical_migration_manifest_gate.js` — **12/12 PASS**. `npm run test:ucp` — **PASS**, source safeguards, not full UCP E2E. No master runner was used.
4. `cd frontend; npm run build` — **PASS**, 2,236 modules; subsequent final UI cancellation control is covered by CI build. Focused oxlint exit 0: new components clean, ten existing page/fulfillment import/effect warnings remain; this is not a warning-free global lint claim.
5. Real SQL found incompatible existing payment-token collations; byte-exact comparison fixed without weakening identity. Reporting initially omitted new line receipts and intersected/exception-closed confirmed windows; corrected SQL and assertion contracts, then real SQL and focused tests passed. No assertions were weakened to mask these issues.

## Database evidence

Before 096/097: ignored backup `backend/database/backups/miljor_test_db_delivery_receipts_1794843042012.sql`, 3,507,414 bytes, SHA256 `6a959c4a105976a1a8116b7ee1e623b4dbb20f5a5fee63c812e5ff7cb4d09e4e`.
Canonical runner applied only 096 and 097 to `miljor_test_db`. Read-only audit after verification: `VERIFIED_HISTORY`, **62 applied / 62 planned**. Historical SQL bytes/checksums were not rewritten. Protected read-only counts: `miljor_db` orders=0/payments=0; `miljor_sandbox_db` orders=0/payments=0, matching prior observations. Owned collective fixture users remaining=0. Counts are limited evidence, not a full database checksum claim.

## Acceptance matrix and unresolved release blockers

| Gate | Status | Evidence / limit |
|---|---|---|
| Owned route/choice/capacity, proof and zero-fee reattempt SQL | PASS | Real MySQL combined gate; browser paid journey still pending |
| Receipt quantities, accepted commission, internal refund/fee holds | PASS | Policy/HTTP doubles + actual SQL; external execution disabled |
| Partial release/admin fee adjudication and settlement validator | BLOCKED | Explicit line-aware release validator/reconciliation workflow is still required; legacy actions fail closed |
| Additional reattempt fee collection | BLOCKED | No supplemental buyer-approved verified-payment contract; no dispatch bypass |
| Distinct pre-checkout individual-delivery pricing | NOT_IMPLEMENTED | Run policy supports singleton mode; existing accepted quote path still supports clustered/express/pickup only. A new supplier rate/quote contract remains required |
| Complete paid buyer/supplier route/POD/reattempt browser journey | NOT_TESTED | Added real-browser workspace/report acceptance; do not equate it with paid provider journey |
| Savings percentage | BLOCKED | Comparable baseline absent; truthful unavailable result implemented |
| In-app event targeting/duplicate/rollback and EN/Urdu projections | PASS | Focused tests and actual SQL events; not every event/channel matrix is complete |
| Genuine configured email/SMS delivery, Safepay-origin payment/refund/settlement | BLOCKED | No genuine provider evidence on this pass. Queuing/synthetic callbacks are not delivery/completion proof |
| Implementation-head CI / actual Chromium | PASS | All 10 PR workflows SUCCESS at 9602bd1bb5773920abfb39a6a438ad8d1753445c; genuine paid provider browser journey still untested |
| Main merge | BLOCKED | PR #53 remains draft until all required critical business/provider/browser gates pass |

## Changed paths

Migrations: 096_delivery_operations_and_evidence.sql; 097_procurement_line_receipts.sql.
Backend services: procurementDeliveryRunPolicy/Service, procurementDeliveryAttemptService, procurementDeliveryEvidenceService, procurementLineReceiptPolicy/Service, procurementReportingService; existing fulfillmentService, disputeService, financialSettlementService, notificationEventPolicy.
Routes: procurementDeliveryRoutes, procurementDeliveryEvidenceRoutes, procurementLineReceiptRoutes, procurementReportingRoutes; mounted in existing server.js.
Frontend: ProcurementOrderOperations, SupplierDeliveryRuns, ProcurementReliabilityReport; OrdersPage, SupplierDashboardPage, SupplierFulfillmentPanel.
Tests: procurement_delivery_run_policy_gate, procurement_delivery_evidence, procurement_line_receipt_policy/transactions/api/financial, procurement_reporting_service/routes, procurement_operations_mysql_extension; existing collective_commitment_mysql_gate and p0_real_browser_journey. Workflows: smart-hub-notifications, p0-payment-fulfillment-settlement-e2e. Existing plan and phase log updated.

Skills applied: executing-plans (continued authorized phases), test-driven-development (relevant policy/transaction checks with consolidated project gates), systematic-debugging (actual SQL/collation/reporting failures), verification-before-completion (fresh evidence), requesting-code-review (bounded source review), dispatching-parallel-agents/subagent-driven-development (independent receipt/reporting/proof scopes from earlier session; no shared finance edits while workers owned them). Worker mocks are not mislabelled MySQL or provider verification.

## Remote verification at implementation commit

Commit **9602bd1bb5773920abfb39a6a438ad8d1753445c**, 40 changed project files, pushed to the approved feature branch. All **10/10 PR workflows SUCCESS**, including the newly surfaced Buyer OTP MySQL workflow. [Canonical installation/build/Chromium run](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43899921535), [P0 combined MySQL/payment handler run](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43899921392), [Notification and new contracts/build](https://github.com/umarjameel12/miljor-b2b-marketplace/actions/runs/43899921070).

Inspected P0 job133413431228 logs: combined extension **17/17 PASS**, including actual SQL private proof/outbox rollback, consented zero-fee recovery, additional-fee block, linked receipt money and independent-session lock exclusion. Inspected actual Chromium job133413432014 logs: supplier delivery workspace and scoped report read actual backend state with unavailable savings; supplier counters/deep link/paid-only queue; buyer cycle change/reload/skip; group capacity/private terms with default B6 denial; unpaid poolless order/reload; interrupted request/offline reauthentication and role/session isolation all PASS. This browser fixture deliberately contains no fake paid provider order, so complete paid route/POD/reattempt UI acceptance is still NOT_TESTED.

PR #53 metadata updated to current delivered scope and explicit remaining blockers; confirmed OPEN/DRAFT and merged=false. Evidence-only follow-up does not change runtime code. No global clean-lint claim, genuine provider delivery claim or full-Hub completion claim is made.

RESULT: **PARTIAL**. Complete Hub release is not certified. No main merge, protected-database mutation or external money movement. CAN START NEXT PHASE: NO.
