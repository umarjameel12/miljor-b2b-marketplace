# MilJor — B3 Supplier Commercial Listings & Entitlement Integration

**Date:** 2026-11-10  
**B3 branch:** `feature/b3-commercial-offers` (isolated from B2 gate on `feature/package-e`)  
**B2 frozen base:** `b3c1ea85b2cc4c21b5dd77489472b5a7de6f962b`  
**B3 code review checkpoint:** `29ec685693439774c14b67597f55db32d42d987f`  
**Verdict:** **SOURCE IMPLEMENTED — ANTIGRAVITY INTEGRATION/BUILD GATE PENDING**. No claim of zero defects or runtime PASS.

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

**B3 final Antigravity gate (only on isolated B3 code after B2 corrections are integrated):**
1. Safely sync B3 branch in a **separate worktree**, never switch the active B2 test worktree in place.
2. Ensure accepted B2 changes from `feature/package-e` are cherry-picked/rebased **only after B2 PASS**, resolving conflicts and preserving original report provenance.
3. Verify actual test database = `miljor_test_db` before running any mutable tests; protected `miljor_db` baseline counts before/after.
4. Run `node tests/package_e3_entitlements_and_supplier_portal_gate.js`, `node tests/package_e2_product_ownership_and_immutable_pools_gate.js`, and directly affected marketplace/price/stock tests only as required. Run frontend build **once**.
5. Add focused negative tests if failing behavior or missing coverage discovered (cross-supplier history, concurrent pricing edits, stock allocation, archived SKU reactivation, public listing of unverified or archived items).
6. Use targeted diagnostic reruns on failures; no repeated full master/B0 suite unless a demonstrated dependency requires it.
7. Record **actual commands, exit codes, assertions, tested SHA, defects/fixes, DB preservation and final PASS/FAIL/BLOCKED** below and in `MILJOR_PHASE_LOG.md`; commit/push truthful evidence.
8. Never merge to main or deploy while B2 dependent gate fails.

## Git and concurrency policy

- B2 tests and fixes: `feature/package-e` only, local worktree A.
- B3 feature code and B3 test updates: `feature/b3-commercial-offers` only, separate worktree B.
- Both branches may coexist but MUST NOT execute mutable tests concurrently against the same `miljor_test_db`. Serialize DB test windows or provide independently provisioned databases with strict identity guards.
- Any accepted B2 defect fix should be deliberately integrated into B3, not silently overwritten or assumed present.
- Preserve original B0–B2 source and reports and record actual synchronized SHAs. B3 report is not B2 signoff.

## Open/conditional items

- B2-CORE report not yet supplied as PASS in this conversation. B3 branch is separate and cannot be accepted without B2 compatibility checks.
- No local MySQL integration/build was run from GitHub-only implementation. All new/updated source has only JS syntax parsing and code review evidence; JSX needs Antigravity build.
- Product/media upload remains B2-Media and is not B3 scope.
- Runtime regression issues, if discovered, must be fixed and recorded; no assumption that source changes are flawless.

**B3-A through B3-E:** source modifications committed.  
**B3-F:** regression assertions authored, final runtime gate pending.  
**B3 FINAL VERDICT:** NOT YET COMPLETE AND VERIFIED.  
**CAN START B4:** NO.
