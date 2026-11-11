# MILJOR — FINANCIAL F1–F5 ONE-FLOW IMPLEMENTATION & RELEASE GATE

**Date:** 2026-11-11  
**Repository:** umarjameel12/miljor-b2b-marketplace  
**Branch:** `fix/p0-financial-f1-f5-closure-isolated`  
**Parent:** `fix/p0-safepay-refund-evidence-isolated`  
**Audience:** Founder / Principal Architect / Finance Administrator / QA  
**Overall verdict:** SOURCE HARDENING IMPLEMENTED, ISOLATED TESTS PASS; **REAL MYSQL + SAFEPAY ACCEPTANCE BLOCKED**. No merge/deployment approval.

## 0. Non-negotiable project boundaries

This execution stays in the financial chat's code. No changes to B4/B5/B6, Regular/Flash/Unified pool implementations, timers, RFQ/recurring/collective, delivery, supplier specifications, frontend or numbered database migrations. No production `miljor_db` reads/writes, no Safepay network requests, no customer money movement and no external supplier transfers.

The active financial business contract is:
- Safepay is the sole authorized checkout payment gateway.
- Buyer price = *immutable merchandise subtotal + accepted supplier delivery fee + buyer processing fee*. Multiple supplier orders must each have independent captured-payment attribution.
- Supplier entitlement = *supplier merchandise subtotal + payable supplier delivery amount − locked supplier commission*. Buyer processing fee is NOT supplier revenue.
- Buyer-reported short delivery (example: 100 kg ordered, 80 kg accepted) is a dispute/refund claim for the unaccepted 20 kg. Any claim and supplier liability must reconcile before payout.
- Internal `HELD_IN_ESCROW` status is a ledger marker, NOT evidence Safepay holds funds in a legally verified escrow account.
- No buyer cancellation, disputed refund, hold release or forged provider notification may create extra supplier payout or return fictitious money.
- Each source order's accepted supplier fee must be frozen once, not copied from mutable `supplier_profiles` when settlement is accrued.

## F1 — Financial refund and concurrency acceptance

### Implemented and inspected
1. Financial payout preparation serializes on its supplier payable record; same-key identical replay reuses original instruction; a different key cannot create a second instruction for that payable.
2. Signed Safepay `payment.refunded` events are authenticated using existing HMAC-SHA512 raw-body verifier, and an event ID with different immutable monetary details is rejected.
3. Refund confirmation updates must affect **exactly one** approved refund obligation and **exactly one** captured payment row. Zero/incorrect affected rows trigger transaction rollback, not success.
4. `p0_safepay_refund_concurrency_gate.js` was repaired to use a deterministic fake transaction scheduler rather than a hanging lock mock; one duplicate-event attempt succeeds and the other is idempotently acknowledged; different event ID cannot re-confirm a settled obligation.
5. `p0_disbursement_integrity_gate.js` verifies simulated simultaneous payout attempts, exactly-one insert, duplicate rollback and replay.

### Remaining F1 release evidence
Real native Node and `miljor_test_db` (InnoDB) concurrent transactions, unique constraints and HTTP/webhook acceptance have **not** been run. Need concurrency at actual database isolation boundaries, crash-between-queries/commit simulation, duplicate event insert race and post-failure conservation. No production DB.

## F2 — Safepay refunds and provider settlement integrity

### Implemented
1. Signed refund events must match a unique completed payment tracker, locked order, captured Safepay payment and unique APPROVED refund obligation with exact PKR amount. Signed order code, full/partial tracker state and cumulative refund ceiling must match.
2. Actual refund confirmation is OFF unless a merchant has independently proven the `refund_amount` unit: `MILJOR_SAFEPAY_REFUND_UNIT_VERIFIED=PAISA`. This flag **must not** be enabled from sample documentation alone.
3. Admin-entered confirmation references remain rejected with `PROVIDER_REFUND_VERIFICATION_REQUIRED`. There is no automatic refund execution.
4. `reconcileProviderSettlementBatch` now fails with `PROVIDER_SETTLEMENT_EVIDENCE_REQUIRED`, rather than calling admin-entered arithmetic and token counts verified funds.
5. Refund approval cannot be completed without exactly one accrued/funded supplier payable or while a supplier payout instruction already exists. A platform-funded exception requires a separately reviewed liability treatment, never a guessed supplier deduction.

### Remaining F2 release evidence
Merchant-authenticated provider refund event samples, refund amount unit, provider refund completion timing, verified settlement statements or authenticated provider API, bank custody, taxes/provider fees and platform-funded refund policy. Historical ignored refund events require an audited replay/reconciliation procedure. No provider evidence was generated here.

## F3 — Supplier payout lifecycle and separation of duties

### Implemented
1. Preparation and approval restricted to `ADMIN`, `SUPER_ADMIN` and `FINANCE_ADMIN`; operations/support/verification roles may not authorize supplier money.
2. Every new supplier payout instruction requires an independent **completed Safepay payment_attempt** matching the actual captured payment row and order, not just an internal `PAID` status.
3. Duplicate instruction, mismatched idempotency payload, open refunds, active financial holds, inconsistent available balances, previous disbursement, unconfirmed buyer receipt or unverified supplier cause denial.
4. Approval re-checks supplier verification, confirmed delivery receipt, refund claims, holds, exact ledger balances, external transfer disabled state and matching completed Safepay payment.
5. A second authorized administrator must approve an instruction. Missing legacy preparer identity or self-approval fails closed.
6. Refund-specific financial holds `HOLD-RFND-*` can never be freed by the generic hold-release endpoint. Holds and payables acquire locks in the same order; release checks payout-instruction existence and exact balance conservation.
7. A legitimate normal hold release sets `ELIGIBLE_FOR_DISBURSEMENT` when buyer receipt is confirmed; the preparation state machine now recognizes that status.
8. External transfers **remain DISABLED**; prepared/approved instructions are not bank transfers.

### Remaining F3 release evidence
Actual Safepay payment capture DB provenance across checkout paths, MySQL row-lock behavior with concurrent hold/refund/payout approval, correct DB enum status compatibility, and complete transaction audit. A genuine payout transfer integration is explicitly outside this deployment and not silently assumed.

## F4 — Immutable financial ledger and business accounting

### Implemented
`src/services/financialConservationService.js` creates a **read-only, consistent-snapshot internal financial audit** for one order. It checks:
- Buyer total = merchandise + delivery + buyer processing fee.
- Paid order has one captured payment matching accepted total.
- Confirmed refunds never exceed captured payment.
- Payment PAID / PARTIALLY_REFUNDED / REFUNDED state reflects the sum of confirmed refunds.
- Refund obligations link to the correct payment; each refund equals its items + fees.
- Supplier commission percent used on payable equals **immutable order-time snapshot**, never today's profile rate.
- Supplier commission amount is exact-decimal calculated from original gross merchandise.
- Supplier net entitlement = gross + supplier delivery − supplier commission.
- Available payable = net entitlement − approved refund deductions − active hold balance − recorded disbursement.
- Active hold rows back the held amount, deductions equal approved/confirmed supplier merchandise refund deductions.
- No multiple payable or payout instructions for a single order; no payout has enabled external execution.
- Report returns `PASS` or `RECONCILIATION_REQUIRED`, and never mutates financial state.

New restricted read-only endpoint: `GET /api/v1/settlements/admin/orders/:id/integrity` (under the existing route mount). Controller and service independently authorize finance roles; response contains summarized checks rather than raw payment/IBAN details.

### Remaining F4 release evidence
The separately developed additive `orders.supplier_commission_percent` migration is **NOT applied/merged here**; accrual now reads only that immutable order field and safely rejects its absence. Its migration must be reconciled with other branches before any real order accrual is permitted. Broader subscriptions and multi-supplier basket-level books are separate integration owners; this endpoint audits one authoritative order and does not fabricate a cross-order consolidated ledger.

## F5 — Security regression, authorization, and production readiness

### Implemented
- Finance-only controls around payout and refund liability; support/operations cannot approve money.
- Two-person payout approval, immutable provider evidence, admin-entered settlement fail-closed, and no alternate real gateway.
- Unverifiable historical order commission and untrusted provider custody cause explicit reconciliation blockers.
- Offline tests exercise buyer fee tampering, supplier commission tampering, missing snapshot, over-refund, hold underfunding, disallowed external payout, unfunded refund, expired receipt, duplicate payout and wrong-role access.

### Mandatory release gate
- Native Node tests from a clean checkout: `node tests/p0_disbursement_integrity_gate.js`, `node tests/p0_safepay_signed_refund_evidence_gate.js`, `node tests/p0_safepay_refund_concurrency_gate.js`, `node tests/p0_financial_f1_f5_offline_gate.js`.
- Existing financial entitlement, refund, Safepay sandbox checkout, provider replay/authorization and invoice suites run without regression.
- Disposable `miljor_test_db` schema checked against exact migration history and MySQL enum constraints; production untouched.
- Browser/API buyer→payment→partial delivery dispute→refund claim→buyer confirmation→supplier settlement, with concurrent requests and event replay.
- Authenticated merchant sandbox refund units/captured-amount proof, provider settlement data and custody/legal model.
- Traceability: source branch SHAs, test logs, rollback evidence, real provider sandbox event IDs (redacted), DB checksums and signed release verdict.
- No merge into default branch before cross-branch conflict review; no switch enabling real payouts by default.

## Execution evidence collected IN THIS CHAT

The following source tests were executed by evaluating the committed test/source code in an isolated V8 runner with Node built-in shims, the **real** exactDecimal source and simulated/fake MySQL connections. These are genuine isolated unit/simulation observations, **NOT native Node.js, Safepay sandbox or actual MySQL acceptance**.

| Gate | Observed |
| --- | --- |
| `p0_safepay_signed_refund_evidence_gate.js` | 20 / 20 PASS |
| `p0_safepay_refund_concurrency_gate.js` | 3 / 3 PASS (serialized fake transactions) |
| `p0_disbursement_integrity_gate.js` | 14 / 14 PASS |
| `p0_financial_f1_f5_offline_gate.js` | 18 / 18 PASS |
| **TOTAL** | **55 / 55 isolated PASS** |

Earlier incorrect result-collector matching caused the first concurrency harness check to time out despite successful internal simulation; a tracing evaluation and corrected result collector verified 3/3 and the deterministic scheduler was committed. This is not evidence of InnoDB behavior.

**Final internal gate:** Source staged + isolated regression **PASS**; real-DB/provider/production **BLOCKED**. Other chats' implementation files remain untouched.
