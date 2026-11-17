# PR #61 — Stage 1 external-finance acceptance handoff (2026-11-17)

**Decision: BLOCKED — internal checkout/callback safeguards have CI evidence, but genuine Safepay-origin checkout, refund and payout have NOT been executed or certified.** Do not represent synthetic HMAC or a CI success as provider-origin payment evidence.

## Immutable scope and isolation
- PR #61 Draft; branch `feature/pr60-canonical-release-hardening`. No merge to `main`.
- Only disposable `miljor_test_db` or isolated `miljor_sandbox_db`. Never modify `miljor_db`.
- `SAFEPAY_ENV=sandbox`, `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`, `SAFEPAY_TRACKER_CONTRACT=payments-v3-minor`, `SAFEPAY_V3_SANDBOX_ENABLED=true`; merchant keys and webhook secret set privately, never in GitHub/chat/logs.
- Published contract and actual merchant privileges must be separately verified. Provider-hosted checkout needs a reachable HTTPS webhook; callback must be signed by Safepay itself.

## Exact tested baseline
At commit `38f98be90f1ec83fed1f36f3518a443e043b06de`, 13/13 GitHub PR workflows completed successfully (2026-11-17 inspection). In particular: PR61 Part 3, PR61 Part 4, Safepay Sandbox Readiness (No Provider Traffic), P0 Payment Fulfillment Settlement Combined E2E, and UCP Canonical Reconciliation. These are **internal/synthetic** acceptance only. Documentation-only commits after this baseline require a fresh exact-head verification before any new qualified SHA statement.

## Gate A: merchant-approved checkout and provider-origin callback
1. Operator verifies that this merchant is enabled for Payments v3 in Sandbox, including PKR *minor* units, webhook schema/algorithm, hosted-checkout URL, reporter semantics and refund permissions.
2. Use `backend/scripts/safepaySandboxPreflight.js --require-provider-ready` with secrets configured in the private isolated runtime. This script does not make a provider request.
3. Run **one actual Sandbox checkout** with the server-created tracker, never fabricated IDs. Save redacted order ref, tracker suffix, PKR amount and currency, provider-dashboard capture state and timestamp.
4. Capture **Safepay-delivered** webhook over reachable HTTPS; server must verify exact raw-byte signature, matching tracker, merchant, exact minor-unit amount, event type and reporter state. Duplicate replay must yield one paid order, one escrow credit, one stock allocation. Failed/mismatched/tampered/split-buyer events must remain unpaid.
5. Collect independent redacted DB/ledger/order assertions, not just a browser return URL. Reconcile capture against authoritative provider reporter. If provider origin cannot be proven, mark BLOCKED.

## Gate B: refund
- Current `paymentProviderService.initiateRefund` intentionally returns `REFUND_PENDING_GATEWAY`. Existing readiness endpoint is read-only; admin approval is not provider refund.
- Obtain **approved merchant-specific Safepay Sandbox refund contract and permissions** before changing this path. Verify partial refunds, cumulative amount ceiling, original tracker ownership, provider callback/reporting, retries, and financial journal idempotency with a real Sandbox refund.
- Save redacted provider refund ID, approved/requested/captured/settled minor units, actual provider-confirmed status and financial assertions. Never book `REFUNDED` from a synthetic callback or manual claim.

## Gate C: payout
- Bank disbursement is **not** part of the card-payment/refund contract. External supplier payouts remain disabled until Safepay (or separately approved disbursement provider) confirms a real Sandbox payout contract and merchant permissions.
- Once approved, certify beneficiary ownership, per-supplier settlement balance after refunds/holds, payout idempotency, reconciliation and a genuine provider-origin Sandbox completion. Until then **BLOCKED — no bank payout executed**.

## Evidence checklist for external certification
| Gate | Internal CI | Provider-origin evidence | Decision |
| --- | --- | --- | --- |
| Payment tracker/checkout/callback/escrow | PASS at baseline | NOT SUPPLIED | BLOCKED |
| Duplicate/forged callback protection | Synthetic tests PASS | Safepay-origin retries NOT SUPPLIED | BLOCKED |
| Refund | Readiness-only | API privilege/real refund NOT SUPPLIED | BLOCKED |
| Supplier bank payout | Internal non-executable accounting | Disbursement contract/transfer NOT SUPPLIED | BLOCKED |

## Security and review conditions
Do not paste credential values, raw authenticated webhook payloads, card data, bank details or unmasked customer information into PR comments/artifacts. Do not activate production callbacks, enable real external money movement, or merge this PR to resolve the external-evidence gap. When the merchant evidence becomes available, update this record with redacted IDs, timestamped observed results, exact commit SHA, CI workflow URLs and independent reviewer decision.

## Referenced source-of-truth documents
- `backend/docs/PR61_PROVIDER_CONTRACT_AND_FINAL_RELEASE_GATE.md`
- `backend/docs/PR61_PART4_RELEASE_DECISION.md`
- `backend/docs/PR61_B2B_PAYMENT_REFUND_RELEASE_ACCEPTANCE.md`
- `backend/scripts/safepaySandboxPreflight.js`
