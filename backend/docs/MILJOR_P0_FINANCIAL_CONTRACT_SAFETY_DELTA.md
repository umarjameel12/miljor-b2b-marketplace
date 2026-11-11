# MilJor — P0 Financial Contract Safety Delta (2026-11-11)

## Scope, branch and evidence
Branch: `fix/independent-backend-integrity`.
Source-only changes after Antigravity's previously reported 103/104 accepted assertions.
**The previously reported results DO NOT verify these new commits.**
No DB write, gateway request, real payout, migration or pool/timer change was performed.

## Preserved financial model
- Safepay is the only accepted payment gateway; current adapter is sandbox-only.
- Checkout is order-first and currently uses locked full `orders.total_amount`.
- HMAC-SHA512 webhook and trusted tracker reconciliation are responsible for PAID transitions.
- `payments.escrow_status = 'HELD_IN_ESCROW'` is an internal accounting state, not proof that Safepay itself legally or operationally escrows funds.
- External automatic refunds and supplier disbursements remain disabled.
- The proposed 20/80 collection model is **not implemented by this patch** and must not be claimed as operational without approved semantics and supported gateway integration.

## Implemented fail-closed changes
1. `financialSettlementService.accrueSupplierPayable` now rejects absent order-time `transaction_fee_percent` with `409 LOCKED_SUPPLIER_COMMISSION_REQUIRED` instead of silently assigning 2.50%.
2. The percentage-to-decimal conversion for supplier accrual uses BigInt exact basis points, including 0% and 100% boundary cases.
3. `feeService.calculateSupplierFeeExact` rejects missing supplier profile fee percentage with `409 SUPPLIER_COMMISSION_UNCONFIGURED` instead of the 2.50% fallback.
4. `financialSettlementService.assessRefundObligation` now accepts confirmed payments in PAID or PARTIALLY_REFUNDED states, so further *eligible* partial-refund assessments are not blocked solely by the first partial refund.
5. Refund assessment accepts only the owning BUYER or an authorized administrator. Unknown and supplier roles are rejected with 403.
6. `recordManualConfirmedRefund` no longer mutates money state based solely on a client/admin-supplied string. Returns `409 PROVIDER_REFUND_VERIFICATION_REQUIRED` for authorized admins until independently authenticated Safepay refund-completion evidence exists.
7. New deferred isolated gate `tests/financial_contract_fail_closed_gate.js` verifies these invariants. **NOT RUN in this task.**

## P0/P1 dependencies — explicitly blocked
- **Critical order schema gap:** `orderService.createOrderFromBuyerCommitment` currently inserts no `transaction_fee_percent` locked snapshot into orders. Therefore accrual intentionally fails closed until the commercial fee percentage is durably frozen as part of an accepted order schema, with existing-order/backfill handling. Do NOT default profile commission silently at settlement.
- Migration numbers 046/047 diverge between independent catalog fixes and B6 Phase 2. No schema changes are authorized until history checks and an agreed unique migration sequence. The proposed 049/050 sequence is conditional on verified target DB history and all concurrent migrations.
- Safepay-verified refund evidence ingestion, external refund state machine, payment cumulative refund reconciliation, two-party audit, and supplier payout release still require implementation and gateway contract validation.
- Distinguish actual provider fund custody/hold from internal escrow bookkeeping.
- Existing prior acceptance counts cannot be reused to assert PASS after these new finance changes.
- Existing B5/B6 Regular/Flash Pools, countdown timers, reservation commits, RFQ/recurring, delivery and notification source was not edited.

## Subsequent acceptance
- Antigravity: run `node tests/financial_contract_fail_closed_gate.js` from backend/ in a safe isolated environment first, then relevant existing Phase 3/4 tests and HTTP routes on `miljor_test_db`.
- Negative: default-rate bypass, invalid fee precision, missing snapshot, unknown refund role, other buyer, repeated partial refund, concurrent refund reservation, fake manual proof, stale provider reconciliation.
- Verify supplier payable accrual with an actual persisted immutable rate only **after** a separately reviewed DB/order-service integration patch.
- P0 Financial readiness remains BLOCKED and no real transfer/payout allowed.
