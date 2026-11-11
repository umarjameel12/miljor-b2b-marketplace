# MilJor P0 — Signed Safepay Refund Atomicity and Replay Hardening
Date: 2026-11-11
Branch: `fix/p0-safepay-refund-evidence-isolated`
Scope: financial refund reconciler, isolated financial regression tests and phase documentation only.

## Approved implementation plan
1. Keep default refund confirmation **fail-closed** until the merchant-specific Safepay amount-unit policy has been proven (`MILJOR_SAFEPAY_REFUND_UNIT_VERIFIED=PAISA` is NOT approved for production based on examples alone).
2. Authenticate the webhook with the existing raw-body HMAC-SHA512 verifier. Allow a processed event ID to be replayed only when it matches the previously authenticated *immutable refund identity* (event token, type, tracker, currency, refund state, refund amount and signed order ID). Ignore retry delivery metadata, which may legitimately change.
3. Hold existing tracker/order/payment row locks through the refund transition. Fail closed if the approved obligation conditional update or captured payment conditional update affects anything other than exactly one row. The audit event and signed event insert must be in the same DB transaction.
4. Verify unknown/reforged events, wrong currency, changed signed amount, stale approval, payment update conflict, full vs partial refund and captured monetary ceiling.
5. Verify simultaneous deliveries on disposable MySQL/InnoDB in a later dedicated acceptance gate. Do not infer DB concurrency safety from V8 mocks.

## Implemented
- `src/services/safepayRefundWebhookService.js`:
  - Validated duplicates using immutable signed financial evidence, not only an event ID + tracker.
  - Handles JSON values loaded from a MySQL JSON column and TEXT values loaded as strings.
  - Retries with changed `delivery_attempts`/next retry timestamp continue to be idempotent if monetary identity is unchanged.
  - Added conditional refund update including payment ID, approved status, amount and PKR currency; requires affectedRows=1.
  - Added conditional payment update including id, order, tracker, captured-status and affectedRows=1.
  - Both updates, the signed event and the financial audit remain transactional. A mismatch throws before commit and must trigger rollback.
- `tests/p0_safepay_signed_refund_evidence_gate.js`: extended offline acceptance from 15 to 20 scenarios.
- `tests/p0_safepay_refund_concurrency_gate.js`: proposed two-simultaneous-delivery exactly-once simulator with a timeout and explicit failure. **Not marked PASS**: a preliminary isolated V8 execution did not complete; actual native Node and MySQL execution remains required.
- No automatic Safepay refund request or supplier payout was enabled. Admin reference confirmation remains blocked.

## Observed verification evidence
- **20/20 isolated regression scenarios PASS**, executing committed test source and real fetched refund service + exactDecimal module in a V8 environment with Node-builtin shims and mocked DB.
- New cases: event ID collision with changed signed amount, refund conditional UPDATE 0 rows, payment conditional UPDATE 0 rows, retry evidence stored as JSON object, retry delivery metadata changed with same monetary identity.
- **Concurrency gate NOT VERIFIED**: a V8 shim attempt hung and must be reviewed under real Node before any acceptance claim. Bounded timeout added to ensure native CI cannot hang indefinitely.
- No actual `node` execution, Safepay sandbox request, SQL query, migration or database mutation performed in this session.

## Release blockers
- Establish actual HMAC/raw-body server wiring and merchant-specific webhook format from Safepay sandbox; vendor documentation alone is not a successful integration test.
- Verify refund unit conversion against a genuine sandbox payment+refund pair before enabling confirmation in an environment.
- Run `node tests/p0_safepay_signed_refund_evidence_gate.js` and `node tests/p0_safepay_refund_concurrency_gate.js` in a clean isolated Node checkout. Debug/fix any failure.
- Rehearse actual concurrent duplicate and distinct-ID webhooks in `miljor_test_db` with transaction isolation, unique constraints, rollback, and cumulative partial refunds. Test event replay after a fully refunded payment.
- Validate `payment_webhook_events.raw_payload` serialization and storage type.
- Full Phase 3/4 and Safepay hosted-checkout regression suite remains required.
- Historic ledger/migration integration remains separate; do not merge this financial branch with B4/B5/B6.
- **Gate status:** financial source patch IMPLEMENTED, isolated refund assertions 20 PASS, real Node/MySQL and concurrency BLOCKED. CAN MERGE/DEPLOY: **NO**.

## Vendor reference (not equivalent to merchant sandbox confirmation)
- https://safepay.alihamas.pk/docs/developers/webhooks/webhook-types
- https://safepay.alihamas.pk/docs/payments/concepts/tracker-states
