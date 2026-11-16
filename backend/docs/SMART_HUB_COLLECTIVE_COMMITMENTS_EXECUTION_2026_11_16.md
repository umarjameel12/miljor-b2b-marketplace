# R2 collective commitments — 2026-11-16

TASK: Continue approved remaining Hub flow from R1. Connect qualified independent buyer approvals to shared capacity reservations and the existing gated B6 award engine. Full requested Hub remains incomplete until delivery/POD/provider/reporting/release gates pass.

## Implementation and boundaries

- Migration 095 adds buyer-owned collective commitments, exact links to existing MANUAL_HOLD allocations and a unique source commitment on derived requests. No second stock/payment engine and no modified historical SQL.
- All locked members must retain the same qualified bid consent. Before any reservation/order, every individual's buyer MOQ is checked separately from aggregate supplier demand. Full exact group capacity is reserved under ascending listing locks; concurrent groups cannot oversubscribe B4/B5/B6 shared stock.
- A buyer obtains only their own private one-time request and canonical quote copied from the supplier's frozen collective bid, with explicit provenance. It is a derivative of actual supplier-approved terms, not a newly invented supplier offer. Normalized quote line rows are persisted as well as the immutable snapshot. Supplier normal revise/withdraw APIs reject these frozen derivative quotes.
- Existing B6 accept still enforces environment/database/source/schema/financial gates, exact price/physical checks and stock. A commitment hook transfers only that buyer's reserved hold into canonical ORDER_DIRECT stock in the same award transaction; no double allocation. Quote supplier/price/physical/fee/source-consent changes fail closed. Group lock precedes absent-award probes to avoid an observed unique-index gap deadlock.
- Supplier fulfillment checks every qualified member's independently created order is verified PAID before group preparation can advance. An unfunded/withdrawn/expired member cannot automatically charge, refund or reprice peers. This can require explicit group financial resolution; automatic partial-group repricing/refund is not implemented or claimed here.
- Capacity expires at the earliest original quote/request validity or 30 minutes. Existing 10-minute expiry job releases only unconverted HELD allocations; ORDERED commitments require existing payment/refund resolution. Capacity expiry can conservatively remain allocated until that bounded job runs; expired awards still reject immediately.
- Hub adds individual group preparation, review of exact terms and a final buyer confirmation through the existing gated award endpoint. Payment remains separate on Orders. Buyer-owned award-by-request recovery avoids duplicate acceptance after a lost response/reload; no browser JWT persistence introduced.
- New capacity held/released notifications use the existing transaction outbox, generic EN/Urdu templates and own-recipient links. Existing TERMS_LOCKED/PAYMENT_PENDING continue through canonical award service.

## Source reconciliation

Baseline 88afe756296227c8c9deaef5dcfadc534e72a436 equals approved remote; latest main remains 9fb07cf9274509c1686b68b5bf8bdd91bd26718f. Original working-project files untouched.
Reviewed PR #28 (15b0399) and stacked #29 (0d2d832) metadata and fetched actual source read-only. Current deliveryQuantityPolicy.js matches #28 source; four legitimate pool/reservation legacy outbox guards from #29 remain present. Current P0 HTTP test extends #29 with notification acceptance/cleanup. Existing LINE_ITEM_RECEIPT_REQUIRED and LINE_ITEM_REFUND_ALLOCATION_REQUIRED remain fail-closed. No blind branch merge, duplicate 100/80/20 engine or provider completion claim.

## Test database and migration

Pre-audit VERIFIED_HISTORY 59 applied / 60 planned. Test-only backup `miljor_test_db_collective_1794772988921.sql`: 3,502,816 bytes, SHA256 `cad7ec0b808082f4b6c4c5ba022e55d81280669a4432470ffd40a2f6f972df95`. Canonical runner applied only migration 095. Post-audit VERIFIED_HISTORY 60/60. Backup ignored by Git; no credentials copied/printed. Protected read-only checks after tests: miljor_db orders=0/payments=0; miljor_sandbox_db orders=0/payments=0. All mutable tests in miljor_test_db. Final owned collective fixture users=0.

## Local verification

- `cd backend; node tests/collective_commitment_mysql_gate.js` with NODE_ENV=test, DB_NAME=TEST_DB_NAME=miljor_test_db, MILJOR_TEST_ONLY_MIGRATIONS=1, external money movement=false, transactional email=mock: **12/12 PASS**, exit 0. Actual independently approved competing groups, own supplier product/SKU/spec/listing fixtures, all-member individual MOQ preflight, scoped outbox rollback, frozen supplier quote APIs, concurrent capacity race, default B6 denial, foreign/tampered award rejection, buyer-owned recovery, canonical individual orders/stock transfer and expiry preserving other orders.
- Paid funding policy checks use temporary SQL test states inside a transaction and roll back. They prove the funding guard only, not a captured payment, provider signature, custody or settlement. No persistent PAID fixture/provider calls. Test-only B6 flags are enabled solely for canonical award acceptance inside this isolated gate; default false denial is asserted first and original environment restored.
- Initial integration reproduced a private-request SQL placeholder error and real InnoDB gap-lock cycles. Fixed placeholder count; reservation uses READ COMMITTED with authoritative row locks; group serialization now precedes absent-award unique-index probes. Tests rerun only after root cause inspection. An initial failure cleanup raced a still-running peer; changed test coordination to allSettled and fixture cleanup derives the complete uniquely owned graph. It refuses captured payments/provider attempts instead of deleting financial evidence. Failed fixture remainder was explicitly removed using these ownership checks; final zero fixture users verified.
- `cd backend; node --test tests/collective_commitment_policy_gate.js tests/fulfillment_notification_hooks.test.js tests/notification_projection_gate.js tests/notification_request_action_gate.js tests/financial_notification_action_gate.js`: **76/76 PASS**. Exact units/quantities, group funding, action/outbox rollback, mandatory financial projection and no fabricated completed funds.
- `node tests/canonical_migration_manifest_gate.js`: **12/12 PASS**, raw canonical history intact.
- `npm run test:ucp`: **PASS**, source checks only; actual broader regression pending remote CI.
- `cd frontend; npm run build`: **PASS**, 2,233 modules.
- Browser seed/journey expanded with an actual qualified group, capacity preparation, private physical/fee review and explicit default B6 denial. Real Chromium result pending CI; this does not yet certify all-paid collective delivery.

## Review

Independent static review found: (1) individual MOQ stranding risk, resolved by validating every member before any reservation/payable order. The suggested aggregate bypass was not used because the authoritative invariant requires separate buyer MOQ. (2) Mutable derived quotes, resolved at supplier revise/withdraw source. (3) transient UI retry state, resolved by buyer-owned server award recovery before retry and after ambiguous response. Added real MySQL regression evidence for all three. Reviewer did not edit or access DB.

## Files / acceptance

Migration: 095_collective_individual_commitments.sql. Backend: procurementCollectiveCommitmentService/Policy, procurementAwardService, procurementQuoteService, fulfillmentService, schedulerService, notificationEventPolicy, procurementRoutes. Frontend: RfqPage.jsx. Tests: collective_commitment_policy_gate, collective_commitment_mysql_gate, owned fixture cleanup, p0_browser_fixture_seed and p0_real_browser_journey. CI: smart-hub-notifications and p0-payment-fulfillment-settlement-e2e. Docs: this report, implementation plan and phase log.

Software capacity/individual award tests PASS locally. Genuine multi-buyer provider payment/refund and full group fulfillment browser journey BLOCKED/NOT_TESTED; remaining R3–R6 route/POD/reattempt/reporting/business gates open. PR #53 stays draft, no main merge. Exact commit/CI evidence follows after push. Skills used: executing-plans, test-driven-development, systematic-debugging, requesting-code-review; current protocol/invariants read at phase start. Full Hub RESULT: PARTIAL.
