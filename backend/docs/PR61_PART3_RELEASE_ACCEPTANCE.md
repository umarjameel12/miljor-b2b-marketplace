# PR #61 — Part 3 Release Hardening and External Safepay Acceptance

**Environment:** Safepay **Sandbox only**. **Current status:** Code gates and synthetic acceptance must be checked against the current PR commit. **External provider-origin transaction/refund and payout certification remain BLOCKED until independently evidenced.**

## Scope and safety boundaries

- Branch: `feature/pr60-canonical-release-hardening`, PR #61 Draft. Do not merge to main until final sign-off.
- Protected `miljor_db` must never be accessed by tests; only disposable `miljor_test_db` or isolated sandbox DB.
- `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`; no production payment, bank transfer or live payout.
- Real Sandbox test requires independently configured `SAFEPAY_ENV=sandbox`, `SAFEPAY_PUBLIC_KEY`, `SAFEPAY_SECRET_KEY`, `SAFEPAY_WEBHOOK_SECRET` and a real sandbox account/HTTPS webhook. Never print, commit, or put key values into a CI artifact.
- `node backend/scripts/safepaySandboxPreflight.js --require-provider-ready` is a **read-only** diagnostic; passing it **never** confirms a charge.
- A locally generated HMAC using a test-only secret exercises validation but **is not a webhook delivered by Safepay**. Tests `p0_safepay_signed_http_acceptance.js` and `safepay_sandbox_live_payment_acceptance.test.js` must not be counted as genuine provider callback evidence.
- Refund initiation in `paymentProviderService` currently returns `REFUND_PENDING_GATEWAY`; approved `refund_obligations` are **internal, non-executable**. Disbursement instructions explicitly mark `external_execution_status='DISABLED'`.

## Implemented and automated release checks

1. **Raw webhook integrity:** verify HMAC-SHA512 on the untouched raw body; unsigned HTTP event-type header must equal event type in the signed body. A signed failed event cannot be promoted into `payment.succeeded` by changing the header. Replay/double-payment blocked.
2. **Provider capture checks:** `TRACKER_ENDED` alone is insufficient: nested transaction state must positively confirm `SUCCESS/SUCCEEDED/PAID/CAPTURED/COMPLETED`. Non-captured, negative, unknown, mismatched amount or currency cannot mark an order paid.
3. **Subscription:** buyer/supplier role isolation, verified supplier only, STARTER to paid plan requires confirmed payment, matching tracker, exact amount, positive transaction status and stable transaction ID. Active paid upgrades/downgrades without a proration policy stay blocked. Automatic renewal remains off. End-of-period entitlement rules are separately tested.
4. **Transactional notifications:** group buyer/supplier `PAYMENT_VERIFIED`; supplier `SUBSCRIPTION_ACTIVATED`; group buyer/supplier `REFUND_ASSESSED` and `REFUND_APPROVED`, with clearly distinct semantics; existing route/dispatch/receipt/dispute outbox. Recipient IDs come exclusively from persisted orders, not client input. Queue/email is independent from financial execution and uses retry/idempotency.
5. **Group financial isolation:** independent buyer orders, immutable SKU prices, amount validation, quote consent, stock locks; isolated shortage claims, hold accounting, admin refund approval, and buyer-specific settlement eligibility. Other buyers' valid orders are not automatically blocked.
6. **Security/CI:** PR61 Part 3 dedicated fail-closed source tests, disposable MySQL sandbox HTTP/ledger tests, subscription tests, notification tests, and the existing canonical UCP 3-job, P0 settlement and Part1 workflows.

## Genuine Safepay Sandbox test procedure — NOT yet attested

**Preconditions**: test-only buyer and supplier profiles, confirmed published supplier SKU, test-only MySQL, sandbox merchant keys configured privately, public reachable sandbox webhook endpoint with verified HMAC, Safepay Sandbox dashboard access. Do not substitute an operator-signed fabricated event for provider-origin evidence.

For an approved disposable buyer order:

1. Create checkout using MilJor's authenticated order route with idempotency key; record opaque order ID/tracker ID and exact PKR amount (not credentials).
2. Open Safepay Sandbox hosted checkout and complete a **sandbox test-card** payment using the provider's current published sandbox instructions. Record provider-dashboard transaction ID, status and timestamp.
3. Capture an **actual provider-delivered** `payment.succeeded` webhook. Verify the HMAC against the raw body and map tracker, amount and currency exactly to that order. Preserve redacted event id, HTTP status and verification outcome, not secrets or card data.
4. Deliver the same provider event twice to test idempotency; verify one payment row, one stock commit and no second supplier entitlement. Test a mismatched or invalid HMAC and header/body event-type mismatch (fail closed).
5. Query Safepay directly from the server to reconcile and compare provider dashboard state, order/escrow, invoice, stock and delivery fulfillment.
6. Complete the buyer/supplier browser flow: supplier dispatch after all grouped buyers have separately approved the route; buyer receipt and SKU-specific shortage; no early settlement.
7. Request partial refund **assessment** for recorded shortage. Verify accounting/hold under real payment. **Do not assert a completed external refund** without a verified, supported Safepay Sandbox refund API or dashboard execution plus authoritative `payment.refunded` event and amount.
8. If a supported Sandbox refund operation is explicitly confirmed and configured, verify end-to-end order/refund state, retries, reversal protection and exact ledger reconciliation with redacted provider-origin records. Otherwise preserve **BLOCKED_EXTERNAL_REFUND** and stop. Do not invent bank payout behavior.
9. Verify supplier subscription checkout with a separate provider transaction and correct billing/entitlement; test failed/unknown status and duplicate transaction. Real recurring billing/downgrade proration is out of scope until policy approved.

## Release sign-off matrix

| Gate | Evidence required | Claim permitted |
| --- | --- | --- |
| CI source, syntax, security & synthetic webhook | Exact head green GitHub run | Internal acceptance only |
| Disposable MySQL group and finance E2E | Exact head green GitHub run | Internal acceptance only |
| Production frontend + buyer/supplier Chromium | Exact head green GitHub run | Browser acceptance only |
| Safepay **provider-origin** payment | Provider dashboard + actual signed inbound event + reconciled ledger | Genuine sandbox payment acceptance |
| Safepay real sandbox refund | Confirmed supported gateway mechanism, actual provider refund and signed completion | Genuine sandbox refund acceptance |
| Bank payout | Explicit verified sandbox payout contract and independent external evidence | Payout acceptance |
| Security release | RBAC, concurrency, replay, database isolation, upload scanning/limits, secret handling, regression gates and review | Release approval after all blockers cleared |

**A 10/10 CI result or higher never replaces external provider-origin proof.** PR61 remains DRAFT and is not merged by this acceptance process.
