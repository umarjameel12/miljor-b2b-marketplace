# PR61 Phase 4 — Sandbox Certification and Release Decision

**Status as of 2026-11-16: Internal security and disposable-MySQL tests under CI verification. External provider certification: BLOCKED until actual evidence exists.** This document is a release gate; it must not be interpreted as evidence of a live transaction.

## Environment, ownership and irreversible-action safety
- PR: `#61`, branch `feature/pr60-canonical-release-hardening`. Keep PR **Draft**; do not merge main.
- Testing: `miljor_test_db` only. Never mutate or drop protected `miljor_db`. CI credentials use disposable MySQL; `ALLOW_EXTERNAL_MONEY_MOVEMENT=false`.
- Provider: Safepay **Sandbox** only. Do not use production card data, bank funds, live payment credentials or real payouts.
- Do not log or commit `SAFEPAY_PUBLIC_KEY`, `SAFEPAY_SECRET_KEY`, `SAFEPAY_WEBHOOK_SECRET`, raw card details or full signed webhook payloads with secrets. Preserve only redacted IDs, statuses and screenshot evidence.
- **Negative tests with locally generated HMAC are synthetic.** A locally signed webhook cannot certify provider-origin delivery, processing or captured funds.

## Phase 4A — Genuine Safepay Sandbox
**Automated boundaries implemented and testable:** provider-hosted tracker generation, raw-body HMAC-SHA512 validation, header/signed-event-type consistency, captured nested transaction status required, exact locked PKR amount/currency, server reconciliation, idempotent financial ledger/stock and invoice. Tracker tokens now restricted to opaque HTTP path segments.

**External acceptance: PENDING.** Required non-sensitive evidence for *each* actual provider test:
1. Real Safepay Sandbox merchant credentials configured privately in the test environment. A reachable provider webhook route.
2. Merchant-initiated order with opaque tracker and order IDs, exact amount and currency, timestamp. Sandbox dashboard shows actual captured transaction with provider-owned transaction token.
3. **Provider-delivered** callback with signature verified against exact raw bytes on the server, event id, HTTP response, zero secret leakage.
4. Provider reconciliation confirms same tracker, currency, amount and positive capture state. Exactly one PAID row and stock allocation after duplicate callbacks and retry. Failed/cancelled/mismatched/signature-tampered events cannot pay the order.
5. Actual buyer/supplier Chrome UI lifecycle checkout → delivery consent → fulfillment → receipt; buyer does not unlock settlement prematurely.

The above requires a real Safepay Sandbox merchant and reachable endpoint. No provider-origin charge was conducted by the automated CI.

## Phase 4B — Refunds, disputes and supplier settlement
- SKU-specific receipt shortages and immutable dispute lines support internal exact refund assessment/approval, financial holds, independent buyer entitlement and accounting integrity.
- **External refunds NOT implemented** in `paymentProviderService.initiateRefund`; current response: `REFUND_PENDING_GATEWAY`. This is intentional fail-closed behavior, not a paid refund.
- Do not create a generic, speculative refund API request without current Safepay authorization, endpoints, payload schema and response semantics. Provider sandbox refund must be implemented **only after** the documented refund mechanism and merchant permissions are verified. Verify authoritative provider-origin completion and idempotent ledger updates; never set `REFUNDED` on an admin claim or simulated callback.
- Bank payout integration remains **DISABLED** until verified sandbox disbursement contract and accounting. Prepared payout instructions are internal/non-executable.
- **Release acceptance: BLOCKED for real refund/payout**. No refund or bank payout executed.

## Phase 4C — Security and concurrency
- Raw webhook body HMAC; request limits, provider-specific limiter, authentication/session RBAC, tenant-scoped orders and refunds, exact decimal amounts, idempotency, inventory stock locks and financial conservation are covered by existing regression workflows.
- This phase adds strict Safepay opaque tracker token validation (never interpolate arbitrary path characters in a merchant-secret HTTPS request), and supplier-upload security: verified MIME/magic/filename suffix, 1 MiB byte cap, rejection of incomplete PDFs, PDF script/launch/embedded/encrypted markers, and malformed PNG containers.
- **Limitations:** lightweight structural checks are not a full antivirus or content-disarm-and-reconstruction pipeline. Mandatory human verification and, before production intake, a vetted malware scanning/CDR workflow and storage/serving headers review are still required.

## Phase 4D — Browser, financial and release CI
The **exact PR commit SHA** must pass all current core workflows plus the new `.github/workflows/pr61-part4-release-certification.yml`, including:
- Production frontend bundle, real Chromium buyer/supplier/admin journeys (as covered by the existing acceptance suite).
- Disposable MySQL canonical migrations, refund and finance integrity, supplier entitlement and notifications.
- New Phase 4 negative security tests, document MySQL regression, synthetic signed HTTP callback/escrow tests.
- Updated PR acceptance comment must cite exact SHA and its complete CI conclusions.

## Strict release sign-off (all mandatory for production claim)
| Gate | Expected evidence | Current eligible claim |
| --- | --- | --- |
| Phase 4 security source and negative tests | Exact-head GitHub run PASS | Internal security acceptance |
| Real disposable MySQL and Chromium | Exact-head GitHub run PASS | Internal lifecycle acceptance |
| Genuine Safepay Sandbox captured payment | Real provider dashboard, delivered signed webhook, reconciliation, exact ledger | **BLOCKED pending proof** |
| Genuine Safepay Sandbox refund | Authorized refund mechanism, actual provider refund and immutable reconciliation | **BLOCKED** |
| Bank payout | Verified supported provider contract and sandbox disbursement evidence | **BLOCKED** |
| Full malware scanning/CDR + production deploy audit | Independently validated controls and security sign-off | **PENDING** |

**No merge, no production-readiness claim, and no external money movement until required external release gates have actual verifiable evidence.**
