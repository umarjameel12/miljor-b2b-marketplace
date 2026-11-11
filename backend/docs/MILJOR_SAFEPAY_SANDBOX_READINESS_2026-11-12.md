# MilJor — Safepay Sandbox-only Readiness and Certification Boundary
Date: 2026-11-12. Scope: non-destructive preflight for sandbox; no live funds, no credentials in repository, no protected DB calls.

## Grounded observations
- MilJor has `safepayAdapter.createTracker`, `createPassportToken`, checkout URL construction and HMAC-SHA512 webhook verification, but existing CI E2E uses a synthetic signed callback; real provider-origin checkout/webhook has NOT been established.
- `paymentProviderService.initiateRefund` returns `REFUND_PENDING_GATEWAY` rather than executing a Safepay refund. Provider refund is NOT implemented/certified.
- `financialSettlementService` intentionally disables external refunds and supplier payouts. Internal PREPARED disbursement != provider bank payout.
- Safepay sandbox API host: `https://sandbox.api.getsafepay.com`. Safepay docs support sandbox test cards and partial/full refunds. A supported supplier **bank payout** sandbox contract has not been verified; do not invent an endpoint or use a real IBAN.
- No merchant sandbox keys were inspected or copied; GitHub source cannot certify credentials installed only in the owner's local `.env`.

## Safe execution
1. In an isolated local/CI environment, set `SAFEPAY_ENV=sandbox`, `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`, `DB_NAME=miljor_test_db` (or isolated `miljor_sandbox_db`), and real sandbox-only `SAFEPAY_PUBLIC_KEY`, `SAFEPAY_SECRET_KEY`, `SAFEPAY_WEBHOOK_SECRET` in private environment/secrets manager. NEVER commit keys, bank records or provider response bodies containing PII.
2. Run `node --test backend/tests/safepay_sandbox_readiness_gate.test.js` then `node backend/scripts/safepaySandboxPreflight.js --require-provider-ready`. A clear BLOCKED report is expected when secrets are not present; this is not a green provider certification.
3. Provider-origin **checkout acceptance** requires actual tracker response, hosted checkout with official sandbox test card, successful/declined/cancelled 3DS, webhook authenticity/replay/amount/currency checks and reconciling exact order & dashboard payment IDs.
4. Provider-origin **refund acceptance** requires a separate approved sandbox adapter and isolated ledger: approved refund, provider request with idempotency, partial/full result, provider-origin refund webhook or authoritative lookup, refunded total conservation, no double refund; no status `REFUNDED` on mere request or redirect.
5. **Bank payout sandbox** is BLOCKED until Safepay supplies/validates an accessible payout endpoint, entitlement and response/webhook contract. Do not use any production banking data or send any live transfer.
6. Never switch `ALLOW_EXTERNAL_MONEY_MOVEMENT` on just to make tests pass. An opt-in sandbox-only provider execution must use a separate explicitly verified sandbox adapter, restricted host, approved merchant account and disposable DB. This preflight itself makes ZERO network requests and ZERO database connections.

## Test evidence status
- Static config/negative-safety CI: eligible to PASS after workflow runs.
- Merchant-issued sandbox tracker + test card: BLOCKED — requires credentials and authorized connected environment.
- Provider-origin signed webhook: BLOCKED — synthetic-only existing evidence.
- Provider refund: BLOCKED — existing gateway method is stub.
- Supplier sandbox bank payout: BLOCKED — no verified provider contract.
- Production/live money movement: NOT AUTHORIZED.

Official references:
- https://apidocs.getsafepay.com/
- https://safepay.pk/signup
- https://safepay.alihamas.pk/docs/payments/get-started/express-checkout
- https://safepay.alihamas.pk/docs/payments/modify-payments/refund
