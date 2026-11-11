# MilJor — P0 Safepay Signed Refund Evidence Integration
Date: 2026-11-11
Branch: `fix/p0-safepay-refund-evidence-isolated`
Parent: `fix/p0-financial-settlement-hardening-isolated`

## Execution plan and ownership
1. Verify Safepay's actual signed refund webhook shape; do not invent a refund-status API or unlock an external refund execution path.
2. Verify HMAC-SHA512 on **untouched raw bytes** and signed `payment.refunded` event type. Never trust a merchant-admin supplied reference.
3. In a DB transaction, match unique completed Safepay tracker, locked order, captured Safepay payment, approved refund obligation, PKR amount and cumulative captured ceiling. Ambiguous evidence remains blocked.
4. Record the signed event ID as the external proof and update refund and payment status **atomically** with an immutable audit event. Preserve duplicate idempotency.
5. Keep live money movement disabled. Require explicit merchant-specific confirmation of Safepay refund amount units before activating the verifier.
6. Run isolated mock-based negatives; real Safepay sandbox webhook delivery and InnoDB concurrency tests are separate release gates.

## Implementation
- `src/services/safepayRefundWebhookService.js`: separate signed refund listener and reconciler; uses existing schema, no DDL.
- `src/controllers/paymentController.js`: dispatches signed-payload `payment.refunded` events on the existing webhook path; payment success processing continues in the original checkout service. Refund processing needs original raw bytes, not JSON reserialization.
- `tests/p0_safepay_signed_refund_evidence_gate.js`: offline module-level tests using real refund reconciler and exactDecimal source.
- `financialSettlementService.recordManualConfirmedRefund` remains **DISABLED / 409** when an admin types a reference.
- No changes to pool logic, timer settings, RFQ, recurring, delivery, or B6 source. No code from concurrent development branches was merged.

## Fail-closed policy
- Signed provider event ID, tracker, order code (if signed metadata present), currency, full/partial tracker state, and individual refund amount must be valid.
- The event has to identify **exactly one** approved refund amount on the correct captured payment; two equal-size approved obligations are ambiguous and intentionally blocked.
- The original captured payment and cumulative confirmed refund amounts cannot be over-refunded.
- Full refund tracker state and cumulative full amount must agree.
- Existing event IDs are replay-safe only if they already have matching successful refund reconciliation state.
- Refund amount conversion uses integer **paisa-to-PKR** only when `MILJOR_SAFEPAY_REFUND_UNIT_VERIFIED=PAISA`.
- **Default without the exact verified flag: 409 REFUND_AMOUNT_UNIT_UNVERIFIED; no DB connection and no refund status mutation.** Before enabling the flag, a Safepay sandbox merchant must prove the amount unit matches the payment capture/checkout contract, using real representative payment+refund events. This configuration is not a recommendation to enable blindly.
- Safepay refunds are not invoked automatically; the signed webhook is evidence about a separately performed provider refund.
- All external supplier payouts remain disabled. Internal `HELD_IN_ESCROW` labels do not establish actual gateway escrow custody.

## Documentation sources consulted
Safepay Refund API and states:
https://safepay.alihamas.pk/docs/payments/modify-payments/refund
https://safepay.alihamas.pk/docs/payments/concepts/tracker-states
Safepay signed `payment.refunded` event examples:
https://safepay.alihamas.pk/docs/developers/webhooks/webhook-types
Safepay merchant refund terms:
https://safepay.pk/legal/content/services-agreement

## Isolated acceptance evidence
Latest V8 harness executed committed refund service and exactDecimal source using mocked DB and signature verification (not native project Node runtime):
**15 of 15 isolated scenarios PASS.**
Scenarios: valid signed partial refund, invalid signature, unverified tracker, order mismatch, missing/ambiguous obligation, captured ceiling, conflicting replay event ID, incorrect tracker state, fractional minor units, wrong currency, idempotent already-processed event, valid full refund, missing unit policy, exact fractional PKR conversion.

## Release blockers (must remain explicit)
1. **Do not deploy or merge** without actual `node tests/p0_safepay_signed_refund_evidence_gate.js` and the existing Safepay checkout/payment/refund regression suites.
2. Verify the web server body parser stores untouched `req.rawBody` for the canonical Safepay webhook path.
3. Validate the actual Safepay sandbox `refund_amount` unit, HMAC secret, signed metadata, tracker state semantics, settlement/refund completion timing, and payment/refund event delivery order.
4. Run disposable `miljor_test_db` E2E with duplicate and simultaneous refund webhooks, affectedRows assertions, MySQL row-lock behavior, duplicate event uniqueness, rollback, cumulative partial refunds and order/payment state.
5. Confirm merchant fees/taxes and platform-funded refund allocation policies; Safepay fees may remain payable on refunded original transactions, and the full buyer refund must not imply refund of the processing fee by Safepay.
6. The existing `payment_webhook_events` table was reused. An already-ignored refund event recorded under the previous capture handler cannot be promoted to PROCESSED by this new listener; requires controlled manual reconciliation.
7. Payment amounts from the existing Safepay checkout service and refund webhook amounts use different code paths. They must be reconciled to the same business PKR unit before release.
8. Preserve isolated commission-snapshot and B4/B6 migration work as separate chat responsibilities; nothing here merges them.

**Gate:** SOURCE INTEGRATION COMMITTED / OFFLINE TEST 15 PASS / NATIVE NODE + DB E2E BLOCKED / CAN DEPLOY: NO.
