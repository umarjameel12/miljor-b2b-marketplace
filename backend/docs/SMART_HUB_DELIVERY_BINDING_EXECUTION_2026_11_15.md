# Procurement delivery binding execution — 2026-11-15

Baseline: 802ba83c4a852493747cde049beac71b82d9783f on feature/smart-procurement-hub-unified-entry / draft PR #53.

## Delivered slice

Buyer-owned delivery choices now reuse the existing delivery_quotes ledger and authoritative eligibility/pricing service. The new scoped POST delivery-choice endpoint derives the supplier from the buyer's active quotation, validates the buyer and verified saved destination, records a durable intent key/hash, and emits a same-transaction supplier notification. Replays serialize on the buyer row and return the original choice; conflicting intent reuse fails. A new choice supersedes older unpaid choices for that procurement quotation only.

Supplier-owned delivery-choices GET returns scoped terms without buyer ID or private address text. The supplier publishes delivery_quote_code in a revised immutable product quote; the backend verifies request/quote/buyer/supplier ownership, live validity, exact fee, current supplier configuration and pickup location. Once a buyer has requested specific delivery terms, revisions cannot silently omit the binding. A supplier quote cannot outlive its delivery terms.

Buyer award selection must acknowledge the delivery terms hash. Award acceptance preserves all existing B6 flags, environment/database identity, stock, fee and physical-specification gates. It rechecks request/quote deadlines after stock locks, revalidates destination/pickup/configuration under locks, consumes the delivery quote in the award transaction, derives the order delivery type instead of forcing DOORSTEP, and freezes the terms and destination in orders and invoice snapshots. Direct public delivery acceptance cannot consume procurement-linked choices; client-supplied clock/award context is ignored.

The Hub UI supports saved-address mode requests, supplier loading/confirmation of buyer choices, the exact delivery fee and pickup location display, and hash-bearing buyer preview consent. Changed accounts clear address/choice state and ignore stale responses. Notifications reuse the existing outbox and the new DELIVERY_CHOICE_RECORDED template. No duplicate delivery engine or notification system was created.

## Verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Binding policy | PASS | Exact fee/hash, private field exclusion, missing/stale consent, invalid mode/destination and award preview propagation |
| Real MySQL binding | PASS | Actual eligibility and pickup/clustered fees, foreign buyer/supplier isolation, two concurrent same-intent requests, conflict, changed pickup/address rejection, two distinct notifications; owned fixtures cleaned |
| Legacy B6 HTTP/MySQL award/payment/invoice | PASS | 7/7; backward compatibility for unbound historical quotes |
| Bound pickup B6 HTTP/MySQL award/payment/invoice | PASS | 10/10; supplier revised quote, no silent binding omission, rejected public/spoofed-context acceptance, stale consent rollback, immutable fee/location, exact award replay, synthetic paid callback, matching invoice terms |
| Existing award policy | PASS | 14/14 |
| Notification/email/financial/fulfillment regressions | PASS | 89/89 mocked contract tests |
| Existing delivery discovery | PASS | Read-only scope contract retained |
| Canonical migration gate | PASS | 12/12 |
| UCP source regression | PASS | npm run test:ucp, exit 0 |
| Frontend | PASS | Existing 24 assertions, inbox/preferences contracts, production build |
| Full clustered/express/recurring browser journeys | BLOCKED | Not yet executed; pickup HTTP acceptance does not establish those journeys |
| Exact-head remote CI | BLOCKED until observed | CI workflows now include binding policy, isolated MySQL binding and both legacy/bound B6 paths |

Key commands (backend working directory): node tests/procurement_delivery_binding_policy_gate.js; node tests/procurement_delivery_binding_mysql_gate.js; node tests/demo_real_b6_award_paid_fulfillment_mysql_gate.js (with B6_TEST_BOUND_DELIVERY false and true); node tests/b6_procurement_award_policy_gate.js; the existing 89-test notification contract command; npm run test:ucp. Mutable runs explicitly used NODE_ENV=test and miljor_test_db. Synthetic callbacks are not genuine Safepay provider evidence. No email/SMS/provider dispatch or external money movement occurred.

## Database and files

Before migration 094, read-only history verified 58 applied / 59 planned. Test-only backup database/backups/miljor_test_db_delivery_1794753150957.dump: 3,438,940 bytes; SHA256 ec8413c7d81144b1e040a503cf1106b2550b7bd04ab1d94ba8e1d412f4fca4d5. Canonical runner applied only 094; subsequent audit VERIFIED_HISTORY 59/59. Historical SQL and journal checksums unchanged. Protected miljor_db and miljor_sandbox_db were not mutated.

The standalone binding test creates and cleans its own users, requests, pickup settings and rates. The existing B6 test retains synthetic financial evidence; its bound variant temporarily enables pickup for the existing test supplier and restores the prior pickup flag/config version in finally, removes its own pickup point and queued notifications, and keeps immutable historical snapshots intact.

Changed paths: migration 094; procurementDeliveryBindingPolicy/Service; procurement quote/award policy/services; procurement controller/routes; deliveryQuotationController/deliveryEligibilityService; invoiceService; notificationEventPolicy; frontend RfqPage; binding policy/MySQL tests and expanded real B6 acceptance; three CI workflows; this report, plan and phase log.

## Remaining scope and release status

This is a verified delivery-binding slice, not completion of all plan phases. Legacy quotes with no buyer delivery choice retain the old gated default path; changing those requires a separate compatibility rollout. Actual route optimization/compatibility, individual/collection-point mode contracts, recurring delivery preference/cycle coordination, individually paid collective orders, per-award-line partial dispute/refund settlement, failed-delivery reattempt consent, reminders/remaining event producers, savings/reliability reporting and genuine provider-originated Safepay/SMS acceptance remain outstanding. Full browser acceptance and overlapping PR source reconciliation remain required. Main merge is not authorized by this report; PR #53 stays draft until all critical gates pass.

Initial delivery-binding commit 0b098f56115095e8eccd79503aeab0e507394520 passed eight workflow runs; canonical CI also passed its real MySQL migration/B6/legacy+bound award paths and Chromium job, but its source job found a stale commission parameter-layout assertion. The regression assertion now requires the unchanged commission snapshot followed by the derived delivery type and bound address, and explicitly checks pickup mapping. Financial assertions were retained. Final follow-up CI must be observed separately.

## Final code-head CI and upstream blocker

At code commit 9429cefb272090f7a7a66dff5cbc65d15259e599, the commission assertion and all preceding canonical source checks pass. Canonical run 43726787588 also passes its complete real MySQL migration/B6/stock/partial-delivery/legacy+bound award job and its real Chromium auth job. P0 combined E2E run 43726787472, isolated MySQL counteroffers 43726787480, delivery quantity safety 43726787547 and branded OTP quality 43726787535 pass.

Overall PR-merge CI is FAIL/BLOCKED: 4 workflows succeeded and 5 frontend-build-dependent workflows failed. Their merge checkout is 7e7f289f3b7bed8e7a43b3eac9adcd336328b93e, combining this code head with concurrently updated main 63f41e31cb06521e4ac68830f6064b514d524545. Main's frontend/src/pages/ForgotPasswordPage.jsx:402 contains an unescaped apostrophe in a single-quoted JSX expression (`'We'll email you a reset code.'`), causing Vite's "Expected } but found Identifier" compile error. That file was not changed by this feature branch; the branch's own version compiles and its local build passes. The latest main was fetched read-only and the source difference confirmed. No unrelated auth-page edits, blind base merge, force push or main merge were performed.

Result remains PARTIAL: delivery binding slice implemented with genuine backend/MySQL acceptance; release is blocked by the upstream auth build regression and the remaining business/provider/browser scope above. Documentation-only follow-up records this evidence; it does not claim new runtime verification or green current merge CI. Migration 094 must be applied before deploying the updated APIs.
