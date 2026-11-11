# MilJor — UCP-3/4/5 Combined Implementation Report

**Date:** 2026-11-11  
**Source branch:** `feature/ucp3-5-delivery-marketplace-ops`  
**Base:** `feature/ucp-unified-supplier-pools` (which inherits draft B4 dual timers and B6 hardening)  
**Release status:** SOURCE CHANGES COMMITTED; DATA / API / FRONTEND / PAYMENTS / SECURITY ACCEPTANCE **NOT RUN**. PR MUST REMAIN DRAFT.

The business contract and detailed frozen sequence are in `backend/docs/MILJOR_UCP3_TO_UCP5_MASTER_IMPLEMENTATION_PLAN.md`. This report records the concrete implementation against that contract and remaining release gates.

## UCP-3 — Supplier logistics, clusters, stock visibility

### Implemented

- `GET /api/v1/supplier/pools/delivery-context`: authenticated SUPPLIER-only; delegates to existing G2 `supplierDeliveryService.getSupplierSettings`. Returns own standard/express/pickup config, actual eligible cluster rates and pickup locations, plus active Lahore clusters.
- `GET /api/v1/supplier/pools/inventory`: authenticated SUPPLIER-only. Ledger view from existing `supplier_listings` and `supplier_inventory_allocations` where allocation status is PENDING or COMMITTED. Returns listed, pending, committed and unallocated, preserving pricing units. Unit mismatches / negative balances return null with RECONCILIATION_REQUIRED (not false available stock). DECIMAL(4) arithmetic uses shared exact decimal engine.
- `frontend/src/pages/SupplierPoolsPage.jsx`: Regular Pool form lets supplier select only authorized Lahore Standard delivery rate clusters; pickup-only selection requires active pickup configuration. Cluster IDs are passed into original B4 draft creation/update, never inventing area rates.
- Supplier Pool Operations panel displays own unit-specific inventory and configured delivery modes/rates/pickup points. Flash displays its B5 fixed delivery-fee policy, without suggesting G2 quotation or unimplemented pickup/express checkout.
- Flash buyer UCP flow requires a saved confirmed `buyer_delivery_addresses` row with geographic_match_status VERIFIED, city Lahore and no manual review. B5 `requestHold` checks owner, matching optional supplied delivery_cluster_id, active Lahore supplier Standard delivery rate and enabled configuration **inside the original transaction before creating any Flash hold/order**. Existing legacy B5 free-text clients remain accepted for backward compatibility; new unified UI always sends verified address IDs. Supplied `delivery_address_id` cannot impersonate another buyer's address.
- B4 and B5's existing supplier inventory locking and allocation/write state machines remain unchanged.

### No unsupported claims

- Buyer location string itself is not reverse-geocoded at payment; unified flow requires an already verified saved address.
- Old B5 free-text purchase callers remain a compatibility surface. Retirement requires a separately approved migration and adjusted B5 acceptance tests.
- Live delivery ETA and clustered last-mile route optimization are not fabricated or charged at the frontend.

## UCP-4 — Buyer marketplace and real buyer actions

### Implemented

- `GET /api/v1/pool-discovery`, public read-only, responds with `{pools,server_time,returned,has_more,next_cursor,requested_type}`. Supports `type=ALL|REGULAR|FLASH`, `category_id`, `family_id`, `cluster_id`, `fulfillment_mode`, `search`, limit 1–100, filter-bound pagination cursor. Invalid type, ID, cursor and limits produce controlled 400s.
- Existing B4 `poolRepo.findAllActive` and `poolProgressService.enrichPoolsList` remain the only Regular eligibility/tier engines. Secondary positive authorization checks verified supplier+listing, published supplier-owned SKU/product and approved canonical category/family; no legacy global physical specs or B6 groups.
- Existing B5 `flashPoolService.getActive` remains the Flash stock and offer-eligibility engine. New supplier cluster filters require actual Standard supplier rate; no imaginary Flash pickup or express mode.
- Regular cards show supplier's published physical SKU, current/target/minimum quantities, estimated tier, next-tier progress, server-synchronized expiry and verified existing fulfillment mode indicators. No fabricated final locked tier/savings. Buyer calls existing `POST /reservations` with X-Idempotency-Key. A final commercial commitment is **not** performed automatically.
- Flash cards show own supplier SKU, offer discount, original price **at publication**, real remaining stock, selling mode, min/max, clearance reason/best-before and server-synchronized expiry. Buyer chooses verified saved delivery address, calls original `POST /flash-pools/:id/hold` with a stable idempotency key, and expressly initiates existing `POST /orders/:id/checkout` with a stable retry key to receive a Safepay URL. Stock hold countdown is separate from pool expiry.
- Buyer recovery: `GET /api/v1/flash-pools/holds/mine` (buyer-only, order-linked, read only); `/orders` displays Flash holds plus separate Regular order/payment holds and real Regular reservations. Flash payment status can be reconciled through existing provider-safe order endpoint. Repeated network retry keys are preserved; no duplicate/order payment is assumed successful from browser redirect.
- `/flash-pools` legacy browse path redirects to `/pools?type=FLASH`. `/pools` has All/Regular/Flash, cluster, canonical categories, fulfillment, search, cursor-based load-more and supplier-owned real titles.
- Whole-lot Flash checkout modal persists after server hold causes sold-out; parent marketplace refresh occurs only when buyer closes/revisits, avoiding unmount mid-checkout.

## UCP-5 — Truthful supplier operations + alerts

### Implemented

- `GET /api/v1/supplier/pools/insights`: supplier scoped, B4/B5 only; status counts, actual orders total/verified PAID/unpaid, split by REGULAR/FLASH. TARGET_REACHED/CONFIRMED are not mislabeled as completed sales.
- `GET /api/v1/supplier/pools/alerts`: supplier scoped, deterministic deduped on-screen status notices from actual pool and ledger/order rows only. Draft awaiting publish, closing soon, allocation mismatches/low available stock, outstanding order payment. No mail/SMS/push delivery or automatic financial state transition.
- Supplier Pool Operations frontend has inventory, delivery, insights and alerts tabs; unknown or unsourced revenue/settlement/savings are null/unavailable, never inferred from list price or displayed as paid money.
- Both the supplier and buyer UIs load server timestamps for countdowns; countdown ending only changes presentation, never settlement or stock locks.

## Files added

- `backend/src/services/poolOperationsService.js`
- `backend/src/services/unifiedPoolDiscoveryService.js`
- `backend/src/routes/v1/unifiedPoolRoutes.js`
- `frontend/src/components/supplier/SupplierPoolOperationsPanel.jsx`
- `frontend/src/components/pools/BuyerPoolCard.jsx`
- `frontend/src/components/pools/BuyerRegularReservationsPanel.jsx`
- `frontend/src/components/pools/FlashBuyerOrdersPanel.jsx`
- `backend/tests/ucp_3_to_5_source_gate.js`
- `backend/docs/MILJOR_UCP3_TO_UCP5_MASTER_IMPLEMENTATION_PLAN.md`

## Key files modified

- `backend/src/services/flashPoolService.js` — optional verified-address B5 hold safety + buyer-owned historical hold list.
- `backend/src/services/unifiedSupplierPoolsService.js` — normalized regular cluster context.
- `backend/src/routes/v1/supplierRoutes.js`, `backend/src/routes/v1/procurementRoutes.js`, `backend/src/controllers/procurementController.js`, `backend/server.js` — authorized read routes only.
- `frontend/src/pages/SupplierPoolsPage.jsx`, `frontend/src/pages/PoolsPage.jsx`, `frontend/src/pages/OrdersPage.jsx`, `frontend/src/pages/FlashPoolsPage.jsx`, `frontend/src/api/unifiedPools.js` — integrated screens.
- `backend/package.json` — prepared `test:ucp` and comprehensive `test:release` commands.

## Final acceptance checklist (NOT EXECUTED)

Run on disposable `miljor_test_db` with migrations through 053 only after all planned work concludes. Preserve read-only fingerprints of `miljor_db` and `miljor_sandbox_db`.

1. Isolated merge into up-to-date B6 hardening + dual-timers + original UCP. Resolve concurrent commits before rerunning.
2. Verify schema and seed: 8 categories / 25 canonical families, own published SKUs, supplier subscriptions, immutable historical orders.
3. Supplier auth: buyer/admin/supplier-other cannot GET another supplier's operations, inventory, rate, pickup, order count, alert.
4. Inventory: concurrent B4 + B5 publication against one supplier SKU, mixed unit fail-closed, exact 0.0001 allocations, stale/inactive listing, reserve/release, no overselling.
5. Delivery: valid/inactive/outside-Lahore cluster, unsupported supplier rate, disabled configuration, verified buyer address owner, manual review, wrong buyer cluster, shared pickup, Flash fixed fee and actual buyer total.
6. Buyer discovery: each type/all, canonical category/family, server search, cluster and exact mode semantics, cursor tampering, pagination, expired/sold-out/revoked SKU, no B6 rows or buyer private data.
7. B4: duplicate reserve requests, final commercial offer acceptance, original 15-minute order payment holds, supplier/buyer windows, delivery SLA 24–72h, refund/escrow invariants.
8. B5: whole lot vs multi buyer, price snapshot/discount, signed Safepay checkout, 15-minute stock hold, failed checkout, callback repeats, reconciliation after expiry, saved address eligibility; old B5 regression compatibility.
9. Buyer UI walkthrough on mobile and desktop, dark/light: categories/families/no Urdu/old 16 specs, actual current supplier offers, both types, return from Safepay, buyer reservations/Flash holds.
10. UCP-5: exact B4/B5 order status count, no unverified paid counts, false sold/completed classification, null settlement revenue, deduped alerts, no SMS/email claims.
11. Run `npm run test:release` from backend, all UCP gates, full B4/B5/B6 acceptance and security/concurrency checks; frontend Vite production build, source map warnings and critical accessibility.
12. Record explicit PASS/FAIL/BLOCKED in phase log and only merge on complete green acceptance.

## Explicit residual caveats

- **No MySQL/API/browser build/settlement testing was run in this GitHub-only work.** Added source checks are not integration PASS.
- Flash delivery uses existing B5 fixed delivery fee, not dynamically accepted G2 delivery quotes. It is disclosed as fixed.
- B4 final commitment and order conversion are pre-existing independent flows, not automated by UCP-4.
- In-app notifications are dynamic status-derived read models, not persistent email/SMS/push. Reliable outbox-based delivery would be a distinct scope.
- Legacy Flash free-text caller backwards compatibility remains until an explicit deprecation plan.
- Availability on a public read endpoint is indicative until original transactional B4/B5 checkout locks run; no UI promise of guaranteed inventory.
- Aggregated settlement revenue and savings are intentionally null pending true ledger/settlement comparisons.

**Final release gate: BLOCKED pending integration and full end-stage testing.**
