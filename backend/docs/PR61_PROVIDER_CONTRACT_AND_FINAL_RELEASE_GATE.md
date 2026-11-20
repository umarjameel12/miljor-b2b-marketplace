# PR #61 — Safepay API Contract Audit, Secure Sandbox Handoff and Release Gate

**Status: code gates implemented; genuine Safepay Sandbox payment/refund/payout certification NOT performed.**
**Scope:** PR #61 Draft only, protected `main` and `miljor_db` untouched.

## Published contract mismatch discovered

The published Safepay API reference documents **`POST /order/payments/v3/`** for card payment trackers; the request `amount` is in the currency's **lowest denomination** (integer minor units). The published refund instructions also use `@sfpy/node-core` `order.payments.refund({tracker,payload:{currency,amount}})` and mention partial refunds and a card-refund window of up to 90 days.

The currently installed MilJor adapter uses **`POST /order/v1/init`** with **major PKR units**, sends `client` rather than the v3 `merchant_api_key` field and reads `GET /order/v1/:tracker`. Existing tests include synthetic responses compatible with this old adapter, NOT direct validation of merchant-specific live Safepay version or units.

**This is material potential money mismatch. DO NOT silently switch endpoints or multiply/divide provider amounts by 100 without confirming the configured merchant API contract, webhook units, return payload and hosted checkout.**

### Provider primary references
- Payment API reference: https://apidocs.getsafepay.com/
- Payment v3 request/response reference: https://safepay.alihamas.pk/docs/api-reference/payments/setup/payment
- Refund policy and documented SDK flow: https://safepay.alihamas.pk/docs/payments/modify-payments/refund
- Payment refunded event reference: https://safepay.alihamas.pk/docs/developers/webhooks/webhook-types
- Merchant legal refund policy: https://safepay.com.pk/legal/content/services-agreement

### Implemented fail-closed protection
- `backend/scripts/safepaySandboxPreflight.js` now reports `tracker_contract_review` and will **not** declare a Sandbox merchant test ready with credentials alone.
- For the currently implemented legacy adapter only, the merchant operator must supply `SAFEPAY_TRACKER_CONTRACT=legacy-v1-major` and `SAFEPAY_LEGACY_CONTRACT_VERIFIED=true` **after verifying** with the actual Sandbox merchant/provider documentation. This is an operational safety acknowledgement, **not** a provider-origin transaction or payment certification.
- The real outgoing `safepayAdapter.createTracker` method also fails before HTTPS if the contract is not confirmed. Injected test mocks remain available only for synthetic regression tests.
- `validateConfig()` no longer returns any secret/public key values to callers or possible logs.
- `backend/tests/pr61_provider_contract_gate.test.js` checks blocked unknown/v3 contracts, verified legacy readiness *without* certifying money movement, no-outbound request behavior, secret response hygiene.

### Exact workflow to finish genuine Sandbox certification
1. Merchant confirms which contract and endpoints their Sandbox credentials support, including tracker amount units, webhook amount units, currency, capture status and hosted checkout URL. If **v3**, implement a fully separate v3 adapter/checkout and reconciliation with integer-minor units, tested against provider. The legacy adapter must remain blocked for v3.
2. Safepay Sandbox merchant keys and webhook secret must be provided **privately as environment secrets** on the isolated test runtime. Do not paste secrets into chats, GitHub comments, code, tests, or artifacts.
3. Validate local or staging endpoint is publicly reachable by real Safepay and HMAC verification accepts only the provider's signed raw payload, not an operator-generated HMAC.
4. Run a genuine low-value Sandbox order, record redacted tracker + transaction identifiers and provider dashboard success; reconcile one immutable order/payment record and inventory allocation against authoritative provider status. Repeat failed/duplicate/tampered/split-buyer scenarios.
5. For refund, first confirm actual merchant permissions and API version; follow Safepay's approved Refund API/dashboards, determine minor-unit semantics and whether `payment.refunded` confirms the credited amount. Implement provider-side refund state transition and idempotent booking **only after** receiving verifiable provider evidence, with support for partial cumulative amounts and no over-refund.
6. Bank payouts are not implied by card payment capture or refund APIs. A separately validated payout/disbursement capability and provider evidence are mandatory; no payout execution is available in MilJor.
7. Independently verify malware/CDR workflow on verification documents, full production RBAC/secrets/CSRF/rate-limiting/backup/rollback/logging, and production deployment approval.

### Release decision
The CI tests exercise **synthetic HMAC and disposable MySQL**. They cannot make the merchant account genuinely ready, cannot prove funds moved and cannot prove a refund or payout succeeded. Maintain PR #61 in Draft and keep external payment execution disabled until all outside evidence is acquired. Do not merge or announce a production release prematurely.
