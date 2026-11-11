# MilJor B6 — Backend Hardening and Canonical Catalog Repair

**Date:** 2026-11-11  
**Branch:** `fix/b6-backend-hardening` (derived from `fix/b6-canonical-family-discovery`; original `feature/b6-private-rfq` unchanged)  
**Gate:** **SOURCE IMPLEMENTATION IN PROGRESS; INTEGRATION NOT VERIFIED; NO MERGE OR PRODUCTION DEPLOYMENT**.

## Business authority

MilJor governs 8 canonical food categories and 25 planned commercial families (13 initial IDs retained, 12 additive families in migration 046). Suppliers own their products, brand/quality/processing, physical SKUs, arbitrary valid packaging sizes, prices, stock and commercial offers. No centrally approved physical variant is required for ordinary new supplier SKUs. Buyer family discovery is English-only. Existing historical products/specifications, pool/order/payment references and financial snapshots must not be deleted. Family subscription slots count distinct active families, not SKU/listing counts.

## Implemented source repairs

1. **Catalog and listing authority** — Retired administrative direct physical-product/specification creation. New legacy NEW_VARIANT submissions, editing and approval are blocked, while historical records remain readable. Commercial listing creation and buyer ACTIVE discovery require actual published supplier-owned SKU/product and approved taxonomy; legacy global specs cannot be newly offered/reactivated. Admin cannot change a referenced family’s physical dimension/category identity.
2. **Buyer discovery** — Legacy "16 Staple Specifications" UI replaced with canonical categories/families; fake brand/grade/pack/MOQ removed. Urdu category/family display removed from buyer/supplier/admin catalog screens; multilingual historical metadata remains stored but is not displayed as separate commodities.
3. **Legacy procurement** — Old unverified RFQ quote/accept, recurring creation, and public simplistic supplier matching endpoints now return `410 LEGACY_PROCUREMENT_ENDPOINT_RETIRED`. New private B6 smart RFQ/matching/quote/recurring/award routes remain authoritative.
4. **Demand request identity/privacy** — Public board returns only anonymized OPEN demand summaries. Requester is verified BUYER or SUPPLIER, family unit and positive exact-decimal quantity validated; migration 047 preserves historical `buyer_id` FK and adds `requester_role`. Legacy buyer_id should be understood as requester foreign key for compatibility.
5. **Messaging** — Verified role/participant and real order-or-active-pool context checks at conversation creation. Contact-sharing messages rejected rather than merely warned. Pre-purchase inquiries on ACTIVE supplier pools allowed. UUID conversation codes are bounded by VARCHAR(40).
6. **Promotions** — Only verified supplier may request a campaign on their own ACTIVE listing/pool with valid dates and positive daily budget. Requests become `PENDING_REVIEW`; public promotions are fail-closed until an audited payment-backed activation path exists. **This is a deliberately disabled paid feature, not a completed billing implementation.**
7. **Ratings** — Strict integer ratings including subratings, real PAID/DELIVERED orders only, database duplicate conflicts mapped to 409, no fabricated 5-star averages when review count is zero.
8. **Invoices** — B6 smart-award invoices reconstruct immutable accepted SKU lines and verify exact sum against order subtotal before issuance. Legacy single-item invoices retain their historical representation; earlier issued snapshots are never rewritten.
9. **Fees** — Legacy buyer and supplier fee callers now delegate to the shared exact-decimal calculator while keeping the historical response shape.
10. **Migration safety** — Serialized runner with GET_LOCK and SHA-256 attempt journal; a failed or interrupted DDL migration blocks retries pending manual inspection. MySQL DDL is not claimed to be transactionally reversible.

## Files to inspect

`backend/src/services/{messagingService,promotionService,reviewService,invoiceService,feeService,procurementService,catalogService}.js`,
`backend/src/controllers/{catalogController,supplierListingController,productController,productSpecificationController}.js`,
`backend/src/repositories/supplierListingRepo.js`,
`backend/src/services/supplierListingMutationService.js`,
`backend/src/routes/v1/procurementRoutes.js`,
`backend/database/runMigrations.js`,
`backend/database/migrations/{046_expand_canonical_product_families,047_demand_requester_role}.sql`,
`frontend/src/pages/{PoolsPage,SupplierCatalogPage,AdminCatalogPage}.jsx`.

## Required release acceptance (NOT EXECUTED FROM CHATGPT)

1. Freeze this branch plus latest B6 changes, and inspect merge base/resolve any divergent upstream commit. Back up `miljor_test_db`, and record read-only fingerprints of protected `miljor_db` and `miljor_sandbox_db`.
2. Apply pending migrations ONLY to `miljor_test_db` by an explicit DB-qualified run. Verify `SELECT DATABASE() = 'miljor_test_db'`, migrations 033–047, 8 active categories and 25 canonical active families (unless additional approved admin families exist).
3. Run `npm run test:hardening`, `npm run test:b6`, and `npm test` from `backend/` after fixture review. `npm run test:release` additionally invokes the frontend Vite build. Any old tests asserting centrally approved physical variants must be migrated to supplier-owned SKU rules; do not omit or greenwash failures.
4. Add/execute negative HTTP tests for unauthorized messaging, unrelated buyers/suppliers, invalid direct contact, legacy route 410, cross-supplier SKU, inactive family, unpaid review, unowned promotions, quote manipulation, duplicate requests, and concurrent pool/inventory/payment transitions.
5. Verify migration idempotency and failed-DDL recovery on a disposable clone; never experiment with partial-DDL failures on `miljor_db`.
6. Perform actual buyer/supplier/admin UI walkthrough in English, with no visible 16-staple/Urdu catalog, supplier-owned SKU listing and real price/stock/MOQ, plus no synthetic data.
7. Reconcile invoices/ledger/escrow/refund snapshots for multi-item and multi-supplier awards, supplier delivery clusters, recurring draft workers, flash holds, expired quotes and dispute flows.
8. Compare protected database fingerprints before and after. Only record PASS if all relevant gates, build, API and data integrity checks succeed.

## Explicit limitations / blockers

- No MySQL, running Express API, Vite build, Safepay sandbox or external settlement credentials were available to this GitHub-only editing pass. **No integration test PASS is claimed.**
- Subscription GROWTH/BUSINESS billing still requires an approved Safepay payment-backed activation workflow. The existing code intentionally blocks unpaid upgrades/admin grants. This must not be bypassed merely to make subscription UI appear functional.
- Sponsored campaign billing/approval/activation is deliberately fail-closed; real paid promotions cannot yet go ACTIVE.
- Existing legacy `/products` and `/specifications` public reads remain as historical compatibility APIs, although the refreshed buyer catalog does not call them. Complete API retirement needs dependency audits of older B4 tests and clients.
- Existing master regression suite includes historical E2/part3 tests which assumed centrally authored variants. The E2 moderation gate has been adapted; broader legacy tests must be reconciled before release PASS.
- The production recurring worker requires explicit runtime flags. Correct job concurrency, schedule, retry and safe preview must be verified on test DB.
- Existing historic transactions must remain queryable even if old global listings are hidden from new buyer discovery.

**Final release gate: BLOCKED pending real isolated database/API/frontend and payment/ads acceptance. Do not merge automatically.**
