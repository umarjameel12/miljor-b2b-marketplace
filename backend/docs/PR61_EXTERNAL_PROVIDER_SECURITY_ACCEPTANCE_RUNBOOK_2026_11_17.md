# PR #61 external finance & security acceptance — operator execution contract (2026-11-17)

**RELEASE STATUS: BLOCKED.** Code-only CI and locally HMAC-signed test callbacks are *not* Safepay-origin payments. This document does not enable a payment, refund, subscription renewal, bank transfer, or production release.

## 1. Safepay Sandbox charge and signed callback evidence
- Credential owner configures legitimate Sandbox merchant PUBLIC/SECRET/WEBHOOK keys **in a private runtime**, never in source or PR comments.
- Use isolated `miljor_sandbox_db` or disposable `miljor_test_db`, `SAFEPAY_ENV=sandbox`, and `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`. Never target protected `miljor_db`.
- Verify merchant is authorized for the exact selected Payments v3 contract, PKR *minor* units, hosted checkout and real callback. `backend/scripts/safepaySandboxPreflight.js --require-provider-ready` is a **read-only heuristic**; green output is not provider attestation.
- Execute a genuinely provider-created Sandbox tracker and completed checkout for a fixed amount/order, then receive the **Safepay-delivered** signed raw-body callback. Confirm persisted attempt order/buyer/tracker/merchant/currency/amount; verify one payment, one held escrow, supplier fulfillment only after paid, replay idempotency. Confirm reporter and dashboard agree. Record *redacted* tracker suffix, order code, timestamps, state, event hash and DB assertion summary.
- Reject missing/invalid signature, wrong merchant/order, failed state, wrong minor units, retries and cross-buyer attempts. Browser redirect alone is not capture.

## 2. Partial refund / reversal contract and acceptance
Safepay's published refund documentation supports full and partial refunds, recommends reversal within 24 hours, states a 90-day card-refund window, and shows a Sandbox SDK example calling `order.payments.refund({tracker,payload:{currency:'PKR',amount:<minor_units>}})`: https://safepay.alihamas.pk/docs/payments/modify-payments/refund

**Do not infer a raw REST endpoint or merchant permission from this SDK example.** Obtain current merchant-enabled refund API/SDK credentials, webhook schema, partial-refund reference and financial state contract from Safepay first. Then:
1. Check admin-approved, same buyer/order, captured payment, exact refundable remaining PKR minor units, and provider-mandated 24h reversal versus refund action.
2. Execute a genuine *Sandbox* partial refund using the merchant-authorized API; capture redacted provider refund/transaction identity and returned status.
3. Verify the independently provider-delivered signed `payment.refunded` (or merchant-confirmed equivalent) event; do not declare settled based on the local request response or admin approval.
4. Prove duplicates/retries never exceed captured total across multiple refund obligations; keep buyer-specific grouped refunds independent and supplier settlement on hold as required.
5. Reconcile payment, refund obligation, ledger and available supplier payable after full/partial refunds. **Until this exists the current `REFUND_PENDING_GATEWAY` and read-only readiness path must remain disabled for execution.**

Official provider API reference: https://apidocs.getsafepay.com/ and documentation on refunds at URL above.

## 3. Supplier bank payouts
Payment collection/refund is not evidence that a marketplace has an outbound supplier disbursement contract. Obtain the exact separate supported provider, merchant permissions, payout endpoint and receiver settlement terms; validate bank beneficiary ownership/masking, supplier-only ledger balances, refund/dispute holds, one-time instruction idempotency, provider callback, failed/returned transfer handling and immutable reconciliation. **Do not enable external payout execution until approved contract + genuine provider-origin Sandbox evidence.**

## 4. Supplier paid subscription v3
The v3 reporter's `TRACKER_ENDED` state is not verified capture evidence. The supplier subscription v3 activation path is deliberately blocked pending a persisted signed capture journal, matching supplier/attempt/plan/price and exactly-once entitlement activation. Never automatically renew or upgrade without explicit contractual consent, proration, verified payment and separately tested retry/cancellation behavior.

## 5. Production security acceptance
- Rotate historically exposed development/staging/production secrets; scan repos/workflows/logs/artifacts for credential leaks. No secret values in reports.
- Deploy private ClamAV/approved scanning for supplier documents, demonstrate malware and scanner-outage fail-closed behavior, validate storage ACLs, MIME handling, audit and appropriate serving headers. Lightweight PDF magic checks are not equivalent to AV/CDR.
- Conduct independent security review of webhook authentication, replay, finance RBAC, tenant boundaries, network configuration, rate limits, session handling, backups/staging restore, migration history and SMTP/SMS handling.
- Run full exact-head CI, disposable MySQL + Chromium journeys across Regular/Flash/RFQ/Recurring, grouped delivery/POD, 100/80/20 dispute/refund, outbox notifications and finance reconciliation. Cite concrete run links and reviewer approval.

## Release decision and evidence provenance

| Mandatory gate | Current external evidence | Decision |
| --- | --- | --- |
| Safepay-origin Sandbox charge / signed webhook | Not furnished in this PR | BLOCKED |
| Genuine Sandbox partial refund / provider confirmation | Not furnished; external refund adapter intentionally disabled | BLOCKED |
| Bank payout / disbursement contract and test | Not furnished; payout intentionally disabled | BLOCKED |
| Signed v3 subscription capture / paid activation | Not implemented for activation; reporter-only is blocked | BLOCKED |
| Independent production security sign-off / secret rotation | Not furnished | BLOCKED |

**Do not merge PR #61, enable live money movement, or call the system production-ready based solely on internal green CI.** Only explicitly identified redacted external evidence, exact code SHA and independent reviewer sign-off may change these decisions.
