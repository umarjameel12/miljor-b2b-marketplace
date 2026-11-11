# MilJor B6-E — Supplier Quotation Implementation Report

**Branch:** `feature/b6-private-rfq`
**Subphase:** B6-E (Smart Procurement Hub, supplier quotations)
**Status:** SOURCE IMPLEMENTED; final MySQL/Express/frontend acceptance DEFERRED per user instruction.
**Dependencies:** Reviewed B6-B request source, B6-D supplier matching, migrations 037–038. B4/B5/main not modified.

## Contract implemented

- Only SUPPLIER account may POST a Smart Procurement quotation; existing strict route guard, affirmative verified supplier and profile checks inside service.
- Only OPEN, unexpired procurement requests with the supplier's own INTERESTED invitation can receive new quotes.
- Each quoted request line is linked to supplier-owned ACTIVE PKR listing, PUBLISHED physical SKU/product, APPROVED/PUBLISHED linked specification and active approved catalog family/category. Physical purchasing unit and buyer-requested quantity must match; a supplied listing must remain eligible in the specified delivery zone. Discrete packs are indivisible.
- Full-basket or subset-of-items quote permitted; **not** partial quantity on a single request line. Immutable SKU snapshot is presented to buyer for grade/brand/pack comparison.
- Supplier-entered unit price and delivery fee use exact two-decimal validation and BigInt-derived line totals. Buyers see supplier-quoted cost; later MilJor buyer processing fees/taxes require separate calculation at B6-G acceptance. No fabricated competitor discount.
- Append-only quotation versions with `(quote_id,version_number)` uniqueness, keyed durable replay, full JSON snapshot and one record per quoted line. A new quote revision never edits old versions.
- Supplier notes reject common off-platform email/phone contact patterns. Buyer contact/address is never sent to supplier.
- Buyer may view ONLY quotes belonging to owned procurement request; supplier may view ONLY own quote history's latest version.
- No checkout, inventory reservation, refund, supplier payment or buyer order created by this stage. Quote is not accepted until B6-G buyer confirmation and transaction lock.

## Files in original MilJor paths
- `backend/database/migrations/039_procurement_supplier_quotes.sql` (3 additive InnoDB tables: procurement_quotes, procurement_quote_versions, procurement_quote_lines; preserve 037/038)
- `backend/src/services/procurementQuoteService.js` (quote submission, immutable revision + replay, owned reads)
- `backend/src/services/procurementMatchingService.js` (supplier inbox now delivers only eligible supplier SKU choices for each requested line)
- `backend/src/controllers/procurementController.js` (new quote endpoints)
- `backend/src/routes/v1/procurementRoutes.js` (strict role-scoped quote endpoints)
- `frontend/src/pages/RfqPage.jsx` (buyer quotation view; supplier line-by-line SKU selection, price and delivery terms)
- `backend/tests/b6_supplier_quote_gate.js` (test-DB-only executable lifecycle gate)
- Existing `backend/tests/b6_supplier_matching_gate.js` extended to assert physical SKU choices in supplier inbox

## API contracts
- SUPPLIER POST `/api/v1/procurement/supplier/requests/:id/quotes`
  Headers: `Authorization: Bearer <supplier JWT>`, `X-Idempotency-Key` unique 12–120 char key.
  Body: `{"lines":[{"request_item_id":51,"supplier_listing_id":12,"quantity":"1","unit_price":"250.00"}],"delivery_fee":"500.00","delivery_lead_days":2,"valid_until":"2027-12-01T00:00:00Z","supplier_notes":"Commercial terms"}`.
- BUYER GET `/api/v1/procurement/requests/:id/quotes` (request-owner only).
- SUPPLIER GET `/api/v1/procurement/supplier/quotes` (supplier's own only).

## Checks actually executed
- Source read and static JavaScript parsing for quote service, matching service, route, controller and D/E test files.
- 9/9 passing **mocked** source-level quote flow: initial version, replay, revised exact total, old version immutable, conflicting idempotency, foreign listing rejection, direct contact rejection, buyer read and other-buyer denial.
- These are **not** database, Express HTTP, real concurrent transaction, frontend build or full financial regression results. No new database migration executed.

## Required B6-D and B6-E final verification
1. Verify test DB identity exactly `miljor_test_db` and create backup. Review/apply migrations 037 → 038 → 039 there ONLY.
2. Execute `cd backend && node tests/b6_procurement_request_lifecycle_gate.js && node tests/b6_supplier_matching_gate.js && node tests/b6_supplier_quote_gate.js` with test DB env.
3. Exercise strict BUYER, SUPPLIER and unauthorized ADMIN/outsider HTTP endpoints; test invalid/expired status, spoofed supplier listing, owner privacy and duplicate mutation.
4. Verify published physical SKU requirements, pack divisibility, status/verification, area matching, currency and supplier stock screening. No stock is reserved by quoting.
5. Verify quote version history, exact subtotal + delivery, stale price/stock, replay after deadline, cross-tenant isolation and no orders/ledger/payment rows created.
6. Run `npm --prefix frontend run build` and buyer/supplier browser smoke; review source-facing errors.
7. Reconcile B5 accepted Flash checkout / shared inventory before B6-G award. Re-run B0–B5 affected regression at final phase gate serially against test DB. Confirm protected `miljor_db` zero writes.
8. Record actual assertion totals and commit SHA only after execution. Fail closed if a prerequisite or fixture cannot be verified.

**Verdict:** B6-E SOURCE IMPLEMENTED; full runtime acceptance NOT YET VERIFIED. **CAN START NEXT PHASE: NO** without next explicit instruction (or until final gate policy permits).


## Additional lifecycle completion — withdrawal, history and MOQ
- Updated Migration 039 quote header with `withdrawal_key` and `withdrawn_at`. This remains an unapplied proposed migration for the controlled final test DB gate.
- Quote service now supports `withdraw(supplierId,quoteId,idempotencyKey)` with parent-request-before-quote row locks, supplier-only ownership, immutable historical versions and durable same-key replay. Different withdrawal keys on already withdrawn quotes fail closed; withdrawn quotes cannot be revised. Future B6-G acceptance must check quote `ACTIVE` under the same transaction before award.
- Buyer can request immutable quote version history via `GET /api/v1/procurement/requests/:id/quotes/:quoteId/versions`; supplier withdraw via `POST /api/v1/procurement/supplier/quotes/:quoteId/withdraw` with `X-Idempotency-Key`.
- The original `RfqPage.jsx` now displays buyer quotation history and supplier's own quote list with Withdraw action.
- Supplier listing `buyer_min_qty` is enforced in both matching and quote submission; D/E fixtures use an eligible listing with minimum <=1 for the fixed quantity test. Supplier quote direct-contact patterns rejected.
- D/E integration gate scripts extended to cover SKU listings in inbox, request owner privacy, immutable version history, quote withdrawal + replay + conflict, key reuse with changed quote, uninvited supplier, and no orders/payments created. Assertions are authored but still NOT EXECUTED against MySQL/Express.
- Previously observed 9/9 mocked quote-source checks were executed before the latest withdrawal/MOQ additions; do not imply those checks independently prove the new code. All subsequent final tests must use the **latest remote B6 branch head**.
- **B6-E status remains SOURCE IMPLEMENTED / FULL ACCEPTANCE DEFERRED**. No production DB writes or B4/B5 branch changes.
