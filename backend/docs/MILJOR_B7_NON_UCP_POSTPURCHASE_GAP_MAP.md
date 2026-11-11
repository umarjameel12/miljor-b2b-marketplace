# MilJor — Non-UCP Post-Purchase Gap Mapping and B7 Isolation Plan
Date: 2026-11-11
Working branch: `feature/b7-fulfillment-gap-audit-20261111`
Base: B6 accepted `6ef03de061c75854c9e042a99a05404c4bd64929`.

## User scope / ownership
UCP and all Regular/Flash pool consolidation is owned in ANOTHER CHAT. This branch must never change unified pool source, supplier/buyer pool pages, Regular/Flash engines, payments, global migrations, E2 supplier catalog, or active parallel B7 branches. An earlier scratch branch `feature/unified-pool-only-workflow` was modified before the ownership clarification; DO NOT MERGE OR CONTINUE IT. It is not this branch's integration baseline.

## Business requirement
A Lahore restaurant, caterer, kiryana or bakery must be able to track an existing, verified-paid order through supplier acknowledgement, preparation, dispatch, buyer-confirmed receipt, exception/dispute, and accurate invoice. Never create a new order/settlement/refund lifecycle, invent ETA or rewrite approved pricing.

## Actual repository mapping (B6 accepted baseline)
| Concern | Existing authoritative component | Finding |
|---|---|---|
| Paid-order supplier processing | `fulfillmentService.js`, `fulfillmentController.js`, `fulfillmentRoutes.js` | IMPLEMENTED: supplier-owned paid orders; acknowledge, prepare, ready, dispatch, delivered |
| Buyer receipt | Same fulfillment stack | IMPLEMENTED: only buyer may confirm receipt; supplier delivery alone not acceptance |
| Buyer quantity/condition discrepancy | Fulfillment + `disputeService.js`, `disputeRoutes.js` | IMPLEMENTED: discrepancy and dispute pathways, immutable evidence/idempotency |
| Dispute remediation | `disputeService.js` | IMPLEMENTED: buyer/supplier/admin role separation, no automatic money movement |
| Invoice/receipt authorization | `invoiceService.js`, `marketplaceOperationsRoutes.js` | IMPLEMENTED: authorized invoice issuance and immutable-order monetary snapshot |
| Supplier-specific delivery context | `supplierDeliveryService.js` | EXISTS: configuration, service areas and pickup |
| B6 grouped delivery proposal | `procurementDeliveryGroupingService.js` | IMPLEMENTED on B6: paid-only clusters and buyer-authorized existing delivery fee |
| Regular/Flash pool discovery/creation | Separate UCP chat | EXCLUDED, DO NOT EDIT |
| Provider settlement/refund/payout | Separate financial-integrity chat | EXTERNAL BLOCKER, DO NOT EDIT |

## Real gaps, rather than duplicate modules
1. **Cross-service acceptance evidence:** existing Part 4E.4 and 4E.5 integration tests are independent; a combined serial run on one exact tested Git SHA with consistent DB migration history has NOT been executed in this chat.
2. **Grouped-delivery-to-fulfillment seam:** verify real grouping/dispatch transitions never bypass the existing fulfillment state machine; supplier-delivered is NOT buyer-confirmed. This requires HTTP + schema-backed test on a reconciled integration snapshot.
3. **Order invoice consistency across workflows:** invoice service selects legacy order-level fields, not an independently verified multiple-item source projection. Verify exact itemized B6 split/multi-item order source before asserting invoices correctly represent complex procurement; do not invent schema.
4. **Fulfillment and disputes for non-B4 source orders:** existing fulfillment listing LEFT JOINs `pools` and `products`. They must be tested against B6 awards and Flash orders before anyone claims generic coverage, and new unified-pool orders must be tested by their owner.
5. **Financial lifecycle:** verified paid order may be buyer-confirmed while external settlement and commission snapshot are not fully certified. Never claim payout-ready based only on status.
6. **UX / actual browser journeys:** B6 acceptance includes unit tests and production build, not exhaustive real browser role-and-screen receipt/dispute/invoice walkthroughs.
7. **Schema/global release gate:** migration 046–052 numbering/history collision is external; no global integrated DB gate currently available in this chat.

## Implemented in this workstream
- Added `backend/tests/b7_postpurchase_isolated_acceptance_gate.js` to run existing fulfillment and dispute HTTP/MySQL suites serially, **unchanged**, only after explicit `B7_ALLOW_ISOLATED_POSTPURCHASE_TESTS=YES`, `NODE_ENV=test`, `TEST_DB_NAME=miljor_test_db`, test-only credentials and a read-only connection/schema preflight. It never applies migrations or modifies protected databases. The existing child suites themselves write only on the disposable test DB, after their own database guard.
- No B4/B5/UCP, financial, invoice, fulfillment or dispute logic changed; no duplicate endpoints.
- No tests executed by this GitHub-only environment. This file is a runnable acceptance entry point, NOT an executed PASS report.

## Required execution / gate
1. On an isolated machine with a backed-up disposable `miljor_test_db`, confirm actual migration history and fixture ownership. If mismatched, report BLOCKED.
2. Explicitly export `NODE_ENV=test`, `TEST_DB_NAME=miljor_test_db`, `B7_ALLOW_ISOLATED_POSTPURCHASE_TESTS=YES`, test credentials. Do not carry DB_NAME=miljor_db.
3. Run `cd backend && node tests/b7_postpurchase_isolated_acceptance_gate.js`.
4. Capture actual exit codes and per-suite assertions, test fixture cleanup, before/after protected DB read-only fingerprints.
5. Add isolated HTTP business contract tests for cross-source paid B6 order, authorized supplier milestones, single buyer receipt, partial quantity discrepancy, supplier remediation, admin arbitration, invoice line/fees, unauthorized user, failed/double webhook, and concurrent receipt/dispute. DO NOT change other workstreams; if blocked, document exact files/dependencies.
6. Run frontend real browser walkthrough and stock/payment regressions on a globally reconciled **integration** snapshot supplied by each workstream owner.
7. Only accept PASS with actual tests and no unresolved P0 gap; otherwise PARTIAL/BLOCKED. No production merge or deployment before global migrations/financial correctness.

**Status: SOURCE GATE ADDED; RELEASE INTEGRATION NOT VERIFIED; UCP OWNED ELSEWHERE.**
