# MilJor PR #61 — B2B Payment, Group Delivery, Refund and Settlement Release Acceptance

**Scope:** Buyer Smart Procurement Hub (single and grouped), Unified Pools (Regular + Flash), RFQ award, Recurring/Collective Quote, supplier clustered delivery, buyer receipt, Safepay Sandbox and internal finance. **All work on Draft PR #61; never mutate main or production miljor_db.**

## Canonical business lifecycle

1. Supplier verification approved by Admin → supplier publishes versioned SKUs; active orders retain immutable SKU/price.
2. Buyer independently confirms a Regular/Flash Pool, awarded RFQ or grouped/recurring procurement order. Each buyer has **their own order, payment attempt, invoice and refund entitlement**, even when one supplier dispatches a grouped route.
3. Buyer initiates **server-owned** Safepay Sandbox checkout. Verify exact PKR amount and currency; never treat browser redirect or synthetic transaction ID as proof of capture.
4. Provider-origin signed callback/reconciliation → exactly one PAID payment + held escrow + atomic inventory commitment; buyer/supplier notifications. Duplicate callbacks and canceled/failed/unverified payments cannot double-book stock.
5. Supplier accepts delivery. Grouped dispatch requires every affected buyer's payment and route/window consent. Clustered stops are supplier-owned and buyer addresses remain tenant-private.
6. On delivery buyer confirms received SKU quantities. Example buyer ordered 100 kg, received 80 kg; only the actual buyer can register their **20 kg** shortage and itemized dispute. Other grouped buyers remain independent.
7. Buyer/admin assesses exact partial refund obligation; admin approves internal amount and financial hold. **Assessment ≠ approval ≠ actual provider refund**.
8. New admin-only endpoint `GET /api/v1/settlements/refunds/:id/provider-readiness` and frontend `/admin/finance` display **read-only** capture ownership, PKR exact ceiling, all pending/approved obligations reserved against captured funds, first-24-hour reversal review, documented 90-day card window and **minor-unit refund preview**. No provider HTTP call, no refund or payout is executed. Supplier's separate settlement instruction remains non-executable.
9. Any genuine external refund must use the supported merchant Sandbox API/SDK, reconcile its actual provider-origin status against refund obligation and payment. Refund initiation is still `REFUND_PENDING_GATEWAY`. Never claim supplier payout or buyer credit from a synthetic event.

## High-priority webhook hardening

The canonical event ID in `safepayCheckoutService.processWebhookEvent` now comes from the **HMAC-authenticated JSON** `token`/`id`, or a deterministic SHA-256 of the authenticated raw bytes if the provider did not supply an event ID. HTTP `X-SFPY-EVENT-ID` is unsigned and **cannot** override this identity. A failed event and a paid event with the same caller-supplied header remain independent; replaying the same authenticated body with any header cannot duplicate a financial mutation. This does not replace real provider callbacks.

## Authoritative provider references

- [Safepay Express Checkout](https://safepay.alihamas.pk/docs/payments/get-started/express-checkout): v3 payment setup `POST /order/payments/v3/`, PKR minor units, hosted checkout, `GET /reporter/api/v1/payments/{tracker}` and provider-origin callback.
- [Safepay Refund](https://safepay.alihamas.pk/docs/payments/modify-payments/refund): `@sfpy/node-core` `order.payments.refund`, full and partial refund, 24h reversal suggestion and card refund window up to 90 days.
- [Webhook types](https://safepay.alihamas.pk/docs/developers/webhooks/webhook-types): `payment.succeeded`, `payment.failed`, `payment.refunded`, `authorization.reversed`.
- [Webhook overview](https://safepay.alihamas.pk/docs/developers/webhooks/overview): HTTPS, authenticity, deduplication and retries.

### Payments v3 Sandbox checkout, signed webhook and supplier subscription (implemented; Sandbox-only opt-in)
- `backend/src/services/safepayV3ContractService.js`: exact PKR-to-minor-unit conversion, strict tracker/reporter response validation, signed `payment.succeeded` envelope validation, exact order amount and merchant identity checks, and non-executable refund preview.
- `backend/src/services/safepayV3SandboxClient.js`: authenticated tracker creation, short-lived Passport token, hosted Express Checkout URL, read-only reporter GET and allowlisted redirect origins. All calls are fixed to the Safepay Sandbox host and require an isolated test/sandbox DB plus explicit `SAFEPAY_V3_SANDBOX_ENABLED=true`.
- Buyer checkout now has an explicit `SAFEPAY_TRACKER_CONTRACT=payments-v3-minor` path. Each `payment_attempts.provider_contract` is pinned by migration 104; webhook amount interpretation comes only from that stored contract. V3 capture requires a cryptographically verified Safepay `payment.succeeded` event, `TRACKER_ENDED`, matching merchant key, tracker, PKR amount in minor units and locked order reference before the normal transactional PAID/escrow transition. Legacy attempts retain their major-unit path.
- Supplier subscription checkout also supports v3 tracker + hosted checkout and authenticated reporter reconciliation, with its own independent `provider_contract` journal column (migration 105). It never reuses buyer order escrow. Subscription activation still requires exact provider status, merchant, order and amount match.
- The real MySQL signed HTTP test now includes synthetic v3 webhook scenarios: 114500 minor units -> PKR 1145.00; wrong amount, wrong state and wrong merchant all reject. These are synthetic HMAC fixtures, **not Safepay-origin callbacks**.
- Neither Sandbox v3 path is auto-enabled; operator must explicitly select contract and configure Sandbox merchant credentials. No production host, production key, production DB or external money movement is permitted by these clients.
- Existing active subscription upgrades/downgrades remain governed by the current period-end/free-tier rules; no proration or automatic recurring debit has been invented.

