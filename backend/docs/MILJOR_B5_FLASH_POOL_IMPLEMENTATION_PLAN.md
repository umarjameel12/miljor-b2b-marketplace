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

## Approved supplier-controlled Flash offer rules (2026-11-10)

These requirements supersede earlier draft text implying a mandatory 12-hour sale, mandatory minimum quantity field or mandatory multi-buyer purchase.

1. **Sale duration is supplier-configured:** Supplier sets a specific future expiry/deadline or positive duration for each deal. Do not hard-code 12h as the required duration. Back-end validates future UTC timestamp, nonzero valid duration, allowed safety/config bounds, no timezone ambiguity, and enforces expiry server-side. Any default displayed is a convenience only and never overrides supplier choice.
2. **Explicit selling mode:** `MULTI_BUYER` or `WHOLE_LOT`. Do not confuse the modes or infer whole-lot from a coincidental numeric minimum.
3. **MULTI_BUYER:** Supplier may specify per-buyer minimum and optional maximum within available allocated stock, with valid whole-pack increments and no over-selling. If the supplier leaves the minimum blank, the effective purchase floor is **one valid purchasable unit/increment**, not zero or a forced supplier-selected value. Show the effective minimum transparently. Supplier may specify stricter per-buyer minimum.
4. **WHOLE_LOT:** A single buyer must purchase the **entire remaining offered lot as one commercial transaction**. Hide/disable the per-buyer minimum and maximum controls; enforce the exact whole-lot quantity server-side. Reject partial reservations, partial orders and multi-buyer split purchase. If a lot is repriced or stock altered before publishing, update the authoritative draft, not after terms lock.
5. **Concurrency and timeout:** One active whole-lot checkout hold at a time, protected with row locking and durable idempotency. Two simultaneous buyers cannot each acquire the lot. Failed/expired unpaid holds are released safely; only a server-verified completed payment creates a paid commitment. Already-paid orders never auto-cancel on flash expiry.
6. **Buyer UI:** Clearly distinguish “Buy from N units” for MULTI_BUYER from “Buy entire lot — N units” for WHOLE_LOT. Always show exact condition, SKU, quantity, delivery charges, supplier, full price, countdown and terms before purchase.
7. **Plan/schema contract:** Extend existing flash records with `selling_mode` and appropriate nullable min/max settings via one reviewed forward migration only if current schema requires it. Preserve historical flash rows, map existing records safely to `MULTI_BUYER`, and do not migrate them silently to WHOLE_LOT. Expose consistent fields in API, validation, tests and UI.

## B5 implementation subphases

**B5-A: Source/schema and integration contracts.** Inspect existing flash_pools DDL, procurement API, supplier SKU/listing/stock, Safepay order-payment service and frontend. Identify needed migration if and only if required; maintain existing IDs. Define flash-specific domain states and precise write/API contracts. Explicitly document what flash stock unit means (SKU purchasing packs vs mass/volume) and how to avoid double-promising across regular/flash commitments. No rewrite of B4 controllers.

**B5-B: Supplier-owned flash offers.** Verified owning supplier creates a DRAFT flash offer only from eligible published SKU and owned ACTIVE listing, with exact physical specification snapshot. Supplier-entered stock, clearance reason, condition, truthful best-before/expiry metadata if applicable; optional discount must reflect actual comparable price, no fabricated crossed-out price. Sale duration is explicitly chosen by the supplier; 12h may be a convenience UI preset but never a mandatory or overriding rule. Validate future expiry/timezone and applicable bounds. No expired/unsafe food marketed as safe.

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
