# MILJOR — B5 FLASH POOLS / READY-STOCK CLEARANCE — IMPLEMENTATION PLAN (NOT STARTED)

**Created:** 2026-11-10  
**Branch:** `feature/b5-flash-pools`  
**Frozen accepted base:** B3 `44f591d7fdd9c16f7a43c10d01de2b50bb637e7e` (81/81 PASS, based on B2 67/67 PASS).  
**Parallel test branch:** B4 `feature/b4-regular-pools` at its own evolving HEAD; B4 regression NOT YET ACCEPTED.  
**B5 status:** PLAN ONLY — no code, database migration, or runtime test executed.  
**Separation:** B5 Flash Pools use existing `procurementService.js`, `procurementController.js`, `procurementRoutes.js`, `FlashPoolsPage.jsx` and `flash_pools` data structures, **not** Regular Pool engine source files in B4.

## Existing verified source baseline / audit findings

- `backend/src/services/procurementService.js` currently creates an ACTIVE flash-pool record directly from caller-supplied `product_id`, stock and prices; current code does not establish supplier-owned published SKU/listing eligibility, catalog taxonomy, expiry/clearance evidence or durable inventory reservation at creation.
- `backend/src/routes/v1/procurementRoutes.js` exposes GET/POST `/flash-pools`, allows supplier/admin POST, and has no flash-specific authenticated reserve/purchase endpoint. Reconcile strict supplier ownership; admin should not impersonate suppliers.
- `frontend/src/pages/FlashPoolsPage.jsx` reads `/api/v1/flash-pools` and renders clearance cards; it has no confirmed end-to-end buyer checkout/reservation workflow.
- `backend/tests/package_e4_e6_marketplace_engine_gate.js` checks only basic creation and discovery for Flash Pools. Its passing historical assertion does **not** prove supplier ownership, stock allocation, buyer checkout, price locking or financial integrity.
- The actual `flash_pools` schema/migration must be located and inspected **before editing**. Do not infer columns or create duplicate tables.
- B2-Media supplier image upload is separate; B5 cannot require an unimplemented storage infrastructure.

## B5 implementation subphases

**B5-A: Source/schema and integration contracts.** Inspect existing flash_pools DDL, procurement API, supplier SKU/listing/stock, Safepay order-payment service and frontend. Identify needed migration if and only if required; maintain existing IDs. Define flash-specific domain states and precise write/API contracts. Explicitly document what flash stock unit means (SKU purchasing packs vs mass/volume) and how to avoid double-promising across regular/flash commitments. No rewrite of B4 controllers.

**B5-B: Supplier-owned flash offers.** Verified owning supplier creates a DRAFT flash offer only from eligible published SKU and owned ACTIVE listing, with exact physical specification snapshot. Supplier-entered stock, clearance reason, condition, truthful best-before/expiry metadata if applicable; optional discount must reflect actual comparable price, no fabricated crossed-out price. 12h is the default flash sale duration, bounded/validated with authoritative timezone and UTC storage. No expired/unsafe food marketed as safe.

**B5-C: Publish, allocated stock and pricing.** Atomic publication validates remaining available inventory and confirmed SKU/listing, locks price and offer terms; consume/hold inventory through the existing authoritative allocation model or a clearly justified compatible flash-specific ledger with exact quantities and units. Concurrent publication with B4 Regular Pools must serialize by the owning listing/inventory lock contract even though the source modules remain separate. Idempotent repeated requests must not allocate twice.

**B5-D: Buyer intent, quantity and order boundaries.** Authenticated B2B buyer can request stock in the documented purchasing unit, obey min/per-buyer max/increments and expiry; concurrent buyers cannot oversell. Buyer confirmation must lock offered commercial terms. Explicitly decide on reservation vs immediate purchase contract and persist an order before payment; never claim confirmed purchase or release inventory on client callback. If B5 cannot safely complete the existing order/payment integration without B4 dependencies, isolate a documented B5 payment adapter or mark purchase as BLOCKED rather than implement fake success.

**B5-E: Safepay integration, cancellation and refunds.** Reuse B0-verified Safepay server-verified payment, ledger/refund/reconciliation functions; no new gateway or invoice bypass. Handle timeouts, abandoned payments, provider mismatch, order idempotency, expiry, capacity rollback, refund-only-after-verified-transaction and immutable historical order snapshots. Payment/financial schema changes require dedicated high-risk tests.

**B5-F: Listing/reading and expiry.** Buyer-facing GET displays only ACTIVE, unexpired, supplier-verified, physical SKU eligible, stock-positive offers. Discount, unit/pack, remaining quantity, condition, expiry information and dispatch timeframe must be truthful. Expiry and fulfillment transitions must be idempotent and release only valid unconsumed allocations; never cancel already paid orders by generic cleanup.

**B5-G: Supplier and buyer frontend.** Reuse `FlashPoolsPage.jsx` and existing supplier portal conventions; seller draft/preview/publish and stock visibility, buyer transparent pricing/condition/cart/confirmation, disabled expired/sold-out actions, accurate backend errors. Do not invent an image upload feature.

**B5-H: Final quick-but-sufficient acceptance.** Create `backend/tests/b5_flash_pool_lifecycle_gate.js` (or extend verified existing gate only if cleaner). Test ownership, draft/publish, real SKU/stock, expiry, simultaneous publication and purchase, discount truthfulness, full unit bounds, idempotency, checkout/payment provider provenance, rollback, cancellation/refund, buyer privacy, historical regular-pool isolation, cross-supplier access and frontend build. Mutable tests exclusively `miljor_test_db`, `miljor_db` pre/post pristine; focused B2/B3 and B4 integration checks when needed.

## Explicit B4/B5 parallel contract

- B4 Acceptance: `feature/b4-regular-pools` in isolated worktree A; owns `poolController.js`, `poolRepo.js`, `tierPricingService.js`, `unitConversionService.js`, `poolProgressService.js`, regular-pool/reservation tests.
- B5 Implementation: `feature/b5-flash-pools` in isolated worktree B; owns `procurementService.js` (flash section with minimal shared edits), `procurementController.js`, `procurementRoutes.js`, `FlashPoolsPage.jsx`, any justified flash-only helper/test/migration, this plan and B5 report.
- Shared touchpoints MUST be stable **interfaces**, not copied code: supplier/SKU ownership read, listing eligibility, inventory allocation/stock ledger, order/payment facade, exact decimal/unit contract. Changes to these interfaces require minimal interface contract tests on both branches, explicit versioning and conscious integration.
- DO NOT run mutable B4 and B5 tests simultaneously against `miljor_test_db`. Use separate independently named test DBs only if actually configured and verified; otherwise serialize integration test windows.
- B5 implementation may proceed independently while B4 gate runs. No B5 full PASS/release until B4 accepted changes affecting shared inventory/unit/commerce contracts are reconciled and tested. Never merge B5 to main, force-push or auto-start B6.
- Keep original local project paths in Git worktrees; push to matching branch; verify both remote and local SHA after the user's Antigravity sync.

## B5 gate outcomes

Each subphase requires truthful **SOURCE IMPLEMENTED / TESTED / FAIL / BLOCKED** status in its report. B5-H final may be PASS only after actual source, DB/API, ownership, concurrency, financial integrity and frontend tests have been executed, source SHA recorded, and test vs protected DB isolation proven.

**B5 CURRENT VERDICT: PLANNED ONLY.**
