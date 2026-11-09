# MILJOR — PAYMENTS, ESCROW & TWO-STAGE SETTLEMENT SPECIFICATION
**Document ID:** `MILJOR-DOC-ESCROW-034`  
**Active Migration:** `034_supplier_owned_products_skus_and_immutable_pools.sql`  
**Status:** Production Baseline

---

## 1. Two-Stage 20% / 80% Collective Procurement Payment Model

MilJor protects both buyers and suppliers in wholesale collective procurement using an escrow-backed two-stage payment model:

1. **Stage 1 — 20% Commitment Deposit (`COMMITMENT_20`):**
   - Triggered when a Regular Pool meets its `supplier_min_qty` (`THRESHOLD_MET`) and the supplier confirms fulfillment (`CONFIRMED`).
   - Each participating buyer pays 20% of their locked tier subtotal + delivery fee before `buyer_commitment_deadline`.
   - Funds are credited to the platform escrow hold account (`ESCROW_HOLD`).
2. **Stage 2 — 80% Final Settlement (`SETTLEMENT_80`):**
   - Paid prior to goods handover/dispatch within the pool's `promised_delivery_at` (24–72h post-close) window.
   - Held in `ESCROW_HOLD` until delivery confirmation or inspection window completion.

---

## 2. Retroactive Volume Discount Reconciliation

- Because a buyer's unit price drops as total pool volume (`current_qty`) crosses higher volume discount tiers (`pool_price_tiers`), the final locked unit price at pool cutoff (`scheduled_close_at`) is always less than or equal to the initial tier price when the buyer joined.
- All 20% commitment and 80% settlement calculations use the pool's locked unit price at cutoff (`locked_unit_price`), ensuring every buyer receives the full collective discount.

---

## 3. Double-Entry Escrow Ledger Invariants

- Every financial movement records balanced debit and credit entries in the escrow ledger (`escrow_ledger_entries`) with idempotency keys (`idempotency_key`).
- **Supported Payment Rails:** `JAZZCASH`, `EASYPAISA`, `BANK_TRANSFER`, `RAST_QR`.
- **Automated Refunds:** If a pool expires below `supplier_min_qty` (`EXPIRED`) or is cancelled before fulfillment (`CANCELLED`), any held buyer funds are refunded in full from `ESCROW_HOLD` to the buyer.
- **Supplier Payout Release:** Upon confirmed delivery (`COMPLETED`) and absence of an active quality/shortage dispute hold, net supplier proceeds (after platform commission) are released to the verified supplier's encrypted Pakistani IBAN on file.
