# MilJor — B7 Post-Purchase Gap Map and Isolated Acceptance Plan

Date: 2026-11-11
Branch: `feature/b7-postpurchase-acceptance-isolated`
Base: B6 accepted `6ef03de061c75854c9e042a99a05404c4bd64929`.
This branch must NOT merge automatically.

## Workstream ownership

**UCP is exclusively owned by another chat.** This branch makes ZERO modifications to UCP, Regular Pool, Flash Pool, supplier pool creation, discovery, their frontend, shared inventory implementation or migration ownership. The earlier experimental `feature/unified-pool-only-workflow` branch is not a release candidate; do not merge/deploy it. User's new unified-pool-only business decision must be implemented and accepted by the UCP owner, not silently adopted by B7.

B6-A–Q smart procurement remains separate; no duplicate RFQ, supplier matching, collective, recurring or grouped delivery engine.

## Verified existing coverage in B6 baseline

| Business need | Source owner | Assessment |
| --- | --- | --- |
| Supplier accepts/prepares/dispatches paid orders | `fulfillmentRoutes.js`, `fulfillmentService.js` | Existing API and sequential milestones; re-test with integrated B6/UCP orders |
| Supplier delivery exception | `/fulfillment/supplier/orders/:id/exception` | Existing; verify failure recovery |
| Buyer independent receipt confirmation | `/fulfillment/buyer/orders/:id/confirm-receipt` | Existing; verify entitlement/amount |
| Buyer delivery discrepancy | `/fulfillment/buyer/orders/:id/report-discrepancy` | Existing; verify partial quantity |
| Formal disputes and remediation | `disputeRoutes.js`, `disputeService.js` | Existing; no duplicate dispute workflow |
| Invoice read/generation | `invoiceService.js`, `marketplaceOperationsRoutes.js` | Existing authorization and invoice snapshots; confirm support for multi-SKU B6 orders |
| Buyer-specific grouped delivery | `procurementDeliveryGroupingService.js` | B6-O already accepted isolated |
| Supplier geo/cluster quotes | G2 existing supplier delivery | Cross-mode compatibility test needed |

### Real gaps/risks to verify, not assumed missing implementations
1. Existing fulfillment read models join orders to `pools` and `products` (legacy pool-oriented joins). They may not correctly render B6 RFQ multi-item or new supplier unified pool orders. Verify actual row structure and B6 order relation before adapting any read model.
2. Supplier delivery-run states and order fulfillment events may have two separate delivery timelines; verify event handoff and buyer receipt only once, without duplicate delivery state machines.
3. Invoice generator uses existing single-order totals and supplier profile; verify real B6 multi-item/split-award order structures and accepted exact per-supplier terms. Never invent a new commission/settlement policy.
4. Supplier-delivered is never buyer-confirmed; disputed/short quantities must block full settlement eligibility.
5. Global migration version collisions 046–052 and financial P0 are external blockers, not B7-owned fixes.
6. Existing `part_g2_delivery_integration_gate.js` bulk-deletes `delivery_quotes`, `buyer_delivery_addresses`, supplier pickup/config/rate tables in the selected test database at startup. **DO NOT run on a shared or non-disposable `miljor_test_db`**. Only a disposable isolated clone with snapshot/backup and explicit approval can use this gate.
7. Fulfillment/dispute existing tests write/delete fixtures in `miljor_test_db`; require disposable clone or verified independent fixture isolation before executing.
8. Do not claim escrow means externally held funds; settlement payouts/refunds are blocked by financial workstream.

## Implementation completed on this branch
- Read-only test `backend/tests/b7_postpurchase_readonly_contract_gate.js` checks 12 existing source boundaries and detects destructive G2 fixture test. It does NOT connect to any database or run a payment.

## Business acceptance scenarios and gates

### Gate 0: safety (read-only)
- `cd backend && node tests/b7_postpurchase_readonly_contract_gate.js`
- Review source object relationships and order origin for B6/Regular/Flash (read-only). Identify possible missing event bridge.
- Verify actual schema_migrations/version identities before any attempt at mutable integration.

### Gate 1: buyer/supplier paid fulfillment on disposable DB
- Supplier can see only own paid order, acknowledges, prepares, ready, dispatches, and reports delivery.
- Buyer sees own order; confirms receipt separately, after supplier delivered.
- Duplicate milestone requests idempotent; concurrent transitions serialized.
- Unpaid order cannot enter supplier fulfillment.
- Multi-item B6 order and per-supplier split awards render correct product lines/quantity/fees.
- No duplicate notifications, money movement, stock release or receipt.

### Gate 2: exception and dispute
- 100kg rice ordered, 80kg received; buyer reports exact 20kg shortfall.
- Supplier can respond/remediate; buyer independently confirms actual replacement.
- No incorrect full delivery, supplier settlement eligibility, automatic refund, or cross-tenant privacy leakage.
- A buyer cannot claim more units or dispute unrelated orders.

### Gate 3: invoice and financial compatibility
- Buyer/supplier/admin scoped invoices; one immutable invoice per actual order contract.
- Exact decimal totals for multiple SKU/fees and stable identity on retry.
- Historical invoice not recalculated from current listing price/grade.
- If the required financial snapshot missing, FAIL/BLOCKED and handoff owner; do not patch financial P0 here.

### Gate 4: integrations with other workstreams (read-only comparisons; tests after their owners accept)
- UCP unified-only pool presentation and lifecycle (other chat).
- B6 406-assertion accepted regression (this branch inherits source but do not reuse old logs as fresh pass).
- G2 cluster, supplier rates, delivery state transitions (disposable clone only).
- Latest B4/B5 financial/stock release semantics after their owner updates.
- Browser buyer/supplier delivery and invoices, mobile, expiry and error states.

## Release gate
- SOURCE GAP MAP: COMPLETE.
- SOURCE TEST ADDED: NOT EXECUTED IN THIS GITHUB SESSION.
- DATABASE / API / BROWSER / PAYMENT INTEGRATION: BLOCKED pending cloned test DB, migration reconciliation, upstream integration and environment.
- B7 functional completion: NOT CLAIMED.
- UCP unified-only completion: OTHER CHAT'S WORK; NOT CLAIMED.

Record all actual test commands, error traces, SHAs, and PASS/FAIL/BLOCKED in separate test report after running. No production migrations or payment actions without distinct approvals.
