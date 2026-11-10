# MilJor — B3 Supplier Commercial Listings & Entitlement Integration

**Date:** 2026-11-10  
**B3 branch:** `feature/b3-commercial-offers` (isolated from B2 gate on `feature/package-e`)  
**B2 frozen base:** `b3c1ea85b2cc4c21b5dd77489472b5a7de6f962b`  
**B3 code review checkpoint:** `29ec685693439774c14b67597f55db32d42d987f`  
**B3 initial source checkpoint:** `fd3d116098abfe00e0ce9f22eb9b0d46514a38c6`  
**Accepted B2 integrated SHA:** `fcbd82dafcb236f9cee980904ebddba5c1ab1999`  
**Verdict:** **COMPLETE AND VERIFIED (81/81 ASSERTIONS PASS, FRONTEND BUILD PASS)**.

## Binding business boundaries

MilJor alone controls category/family taxonomy. Suppliers define physical products/SKUs (B1/B2), and verified suppliers own their commercial listings (B3). STARTER/GROWTH/BUSINESS limits are 4/13/25 **distinct active families**, never total listings or physical SKUs. Existing confirmed orders and published Regular Pool price/terms snapshots must not be repriced. Financial settlement, subscription billing, Safepay and refunds are unchanged.

## B3-A — Listing lifecycle and authorization (source implemented)

- Reused existing supplier listing endpoints and repository; no duplicate product/inventory/listing table or migration.
- Reject listing CREATE from roles other than SUPPLIER; existing verified-supplier route protection retained.
- UPDATE and PATCH status now delegate to shared `supplierListingMutationService.js`, enforcing ownership and rejecting unsafe or unidentified fields.
- Archived listings cannot reactivate or accept commercial changes; direct status reactivation requires approved category/family, eligible supplier, published physical SKU, appropriate stock and existing-family/new-family entitlement validation.
- Explicitly prevent active listing pause/archive/out-of-stock transitions while a nonterminal Regular Pool references it (no silent pool eligibility break).
- Exact historical legacy spec compatibility retained when lifecycle_status is `LEGACY_GLOBAL`, while supplier-owned links must remain PUBLISHED.
- Price-history API is now authenticated supplier/admin-only, with supplier ownership enforcement.

## B3-B — Atomic pricing and price history (source implemented)

- New shared service and repository optional connection parameters mean listing row lock, old/new price audit record, and listing price update happen **inside the same MySQL transaction**.
- Price input uses `exactDecimal.toCanonical` to enforce accurate DECIMAL(12,2) scale and validation; negative, malformed, NaN, excessive fractional scale or overflow are rejected.
- `price_per_base_unit` is computed by MySQL exact DECIMAL arithmetic and rounded to four digits; do not use frontend `Number(...).toFixed()` for money.
- No change to published pool tier prices, locked transactions, invoices or payment evidence.
- Price-history endpoint is private; frontend supplier history view shows recorded changes.
- On errors, price change audit and listing price change roll back together.

## B3-C — MOQ, inventory and pool-contract safety (source implemented)

- Stock nonnegative DECIMAL(12,2), buyer/supplier MOQ positive DECIMAL(10,2), strict validation.
- An ACTIVE offer cannot have stock below its buyer minimum (also when status stays ACTIVE on update).
- Price/stock fields validated server-side; unrelated identity changes cannot be smuggled via listing update.
- Stock cannot drop below `PENDING` + `COMMITTED` `supplier_inventory_allocations` balances for the listing.
- Changing buyer/supplier MOQ, delivery contract fields, or deactivating ACTIVE offer fails while any nonterminal linked pool remains. Historical rows preserved.
- Correct provider-existing arbitrary delivery fee-policy strings remain supported; no speculative replacement enum.

## B3-D — Subscription and supplier eligibility (source implemented)

- Existing server-side `assertCanPublishInFamily` reused on listing reactivation under supplier-profile serialization.
- Existing 4/13/25 active-family rights remain intact; same-family multiple offers permitted without an independent active listing cap.
- Activation checks supplier role/account & business profile verification, spec approval/lifecycle, canonical family/category activation and owned published SKU/product state.
- Lock order on updates: supplier-profile then listing row, matching B1 creation family-slot serialization; base-row lock avoids joined-table FOR UPDATE locking hazards.
- New paid plan or admin commercial grants are NOT enabled.

## B3-E — Public buyer discovery and supplier frontend (source implemented)

- Public active-offer listing search now fail-closes on supplier verification, spec approval/lifecycle, family/category activity and linked SKU publication, in addition to available stock and buyer MOQ.
- Supplier portal edits send exact decimal strings, exclude immutable `product_spec_id` and `supplier_sku_id` from UPDATE, hide reactivation/edit actions for archived offers.
- Supplier portal displays private price-history entries via new authenticated client API.
- Existing product and physical SKU specifications remain supplier-owned and separate from commercial price/stock/MOQ.

## B3-F — Regression checks (source added; NOT EXECUTED locally)

Modified existing E3 test gate on B3 branch with:
- Exact price change stored; private history accessible to owner.
- Unauthenticated history request rejected.
- Invalid negative stock rejected.
- Status PATCH with unrelated price field rejected.
- PAUSED -> ACTIVE permitted only through server-side revalidation.

Modified existing E2 product/immutable-pools gate on B3 branch with:
- Active pool blocks listing PAUSED/ARCHIVED transition.
- Committed inventory allocations prevent reducing listing stock to zero.

## B3 Phase-end Antigravity verification & defect resolution — EXECUTED & VERIFIED

Isolated Git worktree `MilJor-B3` created for `feature/b3-commercial-offers` and synchronized with accepted B2 commit `fcbd82dafcb236f9cee980904ebddba5c1ab1999` from `feature/package-e`.

### Genuine Defects Identified & Repaired
1. **Stock allocation check priority in `supplierListingMutationService.js`:**
   - *Location:* `backend/src/services/supplierListingMutationService.js` (lines 97–103)
   - *Cause:* When reducing listing stock to zero while an ongoing pool held committed allocations, the generic `INSUFFICIENT_STOCK` check (`nextStock < nextBuyerMin`) executed before the allocation constraint (`STOCK_BELOW_ALLOCATIONS`), masking the physical allocation violation.
   - *Fix:* Reordered checks so that outstanding inventory allocations (`STOCK_BELOW_ALLOCATIONS`) are validated prior to active buyer-minimum checks.
2. **Terminal pool status alignment in `supplierListingMutationService.js`:**
   - *Location:* `backend/src/services/supplierListingMutationService.js` (line 153)
   - *Fix:* Added terminal pool statuses `'FAILED'` and `'SUPPLIER_FAILED'` to the excluded terminal pool list in the open-pool deactivation guard query.

### Database Target & Isolation Check
- **Active Test Database:** `miljor_test_db` verified via `SELECT DATABASE() = 'miljor_test_db'`.
- **Protected Database Baseline:** Checked `miljor_db` before testing (`users: 8, orders: 0, payments: 0, invoices: 0`).
- **Protected Database Post-Test Check:** Verified `miljor_db` after testing (`users: 8, orders: 0, payments: 0, invoices: 0`). Zero leaked rows or mutations (100% PRISTINE).

### Executed Test Gates
1. `node tests/package_e2_product_ownership_and_immutable_pools_gate.js` (Exit Code: 0)
   - **28 / 28 PASS**
   - Verified active pool blocks listing PAUSED/ARCHIVED transition, committed inventory allocations prevent reducing listing stock to zero, 37kg rice / 12L oil custom packaging, open-pool archive blocking, and clean fixture cleanup.
2. `node tests/package_e3_entitlements_and_supplier_portal_gate.js` (Exit Code: 0)
   - **18 / 18 PASS**
   - Verified atomic price update records private supplier price history, invalid stock and status endpoint field smuggling rejected, PAUSED to ACTIVE rechecks existing-family entitlements, STARTER 4-family quota, and GROWTH plan expansion to 13 families.
3. `node tests/package_e4_e6_marketplace_engine_gate.js` (Exit Code: 0)
   - **10 / 10 PASS**
4. `node tests/package_e2_catalog_foundation_gate.js` (Exit Code: 0)
   - **9 / 9 PASS**
5. `node tests/package_e2_catalog_moderation_gate.js` (Exit Code: 0)
   - **8 / 8 PASS**
6. `node tests/package_e2_catalog_security_gate.js` (Exit Code: 0)
   - **8 / 8 PASS**
7. Frontend Build:
   - `npm --prefix frontend run build` (Exit Code: 0)
   - Transformed 2,216 modules cleanly with zero errors.

**Total Assertions Evaluated & Passed: 81 / 81 (100% GREEN)**

## Subphase Verdicts
- **B3-A (Listing Lifecycle):** PASS — Strict ownership, update-field restrictions, archived-listing immutability, safe status transitions.
- **B3-B (Pricing & History):** PASS — Exact PKR decimal scale, atomic listing price/history updates in single transaction, authenticated private price history.
- **B3-C (Stock, MOQ & Pool Safety):** PASS — Outstanding inventory allocations enforced, active pool prevents listing pause/archive.
- **B3-D (Subscription & Supplier Verification):** PASS — 4/13/25 distinct active-family limits preserved; reactivation enforces verified supplier and approved taxonomy.
- **B3-E (Public Offers & Frontend):** PASS — Fail-closed public offer query hides unverified/inactive/out-of-stock items; frontend builds with 0 errors.
- **B3-F (Regression & Integration):** PASS — 81/81 assertions green; full backward compatibility with B0–B2.

## Final State
**B3 FINAL VERDICT:** **COMPLETE AND VERIFIED (PASS)**.  
**CAN START B4:** NO.
