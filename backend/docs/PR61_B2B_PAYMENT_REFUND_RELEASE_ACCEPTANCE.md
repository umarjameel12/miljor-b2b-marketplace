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

### Payments v3 sandbox contract and isolated client (implemented; NOT active buyer checkout)
- `backend/src/services/safepayV3ContractService.js` prepares exact PKR integer minor-unit payment tracker requests for `POST /order/payments/v3/`, checks documented `data.tracker` shape, sandbox identity, locked order metadata and immutable quoted amount, and produces a **non-executable** v3 refund preview.
- `backend/src/services/safepayV3SandboxClient.js` sends that request only from an isolated **disposable MySQL configuration** when `SAFEPAY_V3_SANDBOX_ENABLED=true` and all sandbox secrets are privately configured. It does not write to a DB, mark any order paid, confirm a refund or execute payouts. Its HTTP contract is verified through injected no-network fixtures in CI.
- Existing real buyer/supplier checkout and settlement still use their legacy compatibility boundary; **there is no v3 webhook/reporter-to-ledger integration yet**. Do not enable v3 buyer payment until actual provider-origin signed callbacks and reconciliation have been mapped and externally tested.
- Provider version, amount denomination, merchant permission and webhooks must be validated in actual Safepay Sandbox; credentials must never appear in git or PR comments.

**Important mismatch:** MilJor's current operational adapter uses legacy `/order/v1/init` and major PKR amounts, not published Payments v3. The existing adapter intentionally **fails closed** until `SAFEPAY_TRACKER_CONTRACT=legacy-v1-major` and `SAFEPAY_LEGACY_CONTRACT_VERIFIED=true` have been confirmed with the merchant; for a v3 merchant, a separate versioned adapter and end-to-end provider verification are still required. Do not blindly convert amounts 100x in existing code.

## Genuine external Sandbox acceptance — still requires merchant-side access

1. Confirm merchant contract, API version, authorization and money-unit semantics. Configure `SAFEPAY_PUBLIC_KEY`, `SAFEPAY_SECRET_KEY`, `SAFEPAY_WEBHOOK_SECRET` **privately** in isolated Sandbox runtime; never commit or share the values in a chat.
2. Real hosted checkout Sandbox capture → actual provider-delivered signed webhook → authoritative status fetch → exactly-once MySQL payment and stock reconciliation. Capture redacted provider dashboard transaction and delivery ID.
3. Test failed, canceled, duplicated and mismatched signed callbacks; verify no PAID state or duplicate stock allocation.
4. Test buyer and supplier Chromium journeys through grouped delivery, partial receipt and dispute. Confirm no supplier settlement before buyer acceptance.
5. Test authorized real Sandbox refund using the *provider-supported* card refund/reversal method. Confirm provider-origin completion, amount, event id, retry handling, ledger and notification once.
6. For bank disbursement, acquire a documented Sandbox payout contract and permitted environment. **Do not** assume payment/refund APIs enable bank payout.
7. Supplier verification documents now require a **fail-closed ClamAV INSTREAM scan in production** (blocked if `CLAMAV_HOST` is absent or scanner reports malware/failure). Deploy and independently verify a trusted internal ClamAV server; separately commission full CDR/content-sanitization review, security review, rollback and backup rehearsals before production release.

## Release labels

- **PASS (internal):** GitHub source/HTTP/Chromium and disposable MySQL acceptance only, after exact PR-head CI results are green.
- **BLOCKED (external):** genuine Safepay capture, actual provider refund and payout, plus production malware/security sign-off, until independently evidenced.
- **PR #61 remains Draft.** Internal acceptance never certifies external money movement.
