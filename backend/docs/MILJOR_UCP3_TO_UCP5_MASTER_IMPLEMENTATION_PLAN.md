# MILJOR — UCP-3 + UCP-4 + UCP-5 Integrated Implementation Contract
Date: 2026-11-11 | Parent: feature/ucp-unified-supplier-pools
Owner scope: supplier-created B4 Regular and B5 Flash Pools ONLY.
Status: APPROVED IMPLEMENTATION TARGET; FINAL ACCEPTANCE PENDING.

## 0. Non-negotiable invariants
- B4 Regular uses supplier-defined tier pricing, minimum/target/max, closing deadline, supplier decision, buyer commitment, 15-minute order-payment initiation hold (migration 053), delivery SLA +24–72h.
- B5 Flash uses ready-stock, fixed supplier-approved discount, whole-lot/multi-buyer purchase increments, supplier-selected duration starting at publication, 15-minute buyer checkout hold, best-before transparency, provider-reconciled payments.
- B6 buyer-created RFQ / collective groups / recurring contracts, quote/award/payment engines and schemas are not changed or merged into any pool response.
- Supplier owns physical product/SKU and published listing; admin owns 8 canonical categories / 25 approved families. Old 16 centrally authored variants and Urdu text must not appear in the new UI.
- Safepay and financial ledger stay authoritative; UI timers and alerts can never change money or allocations. Supplier delivery owns last-mile, platform computes/verifies eligibility. Never invent market rates, stock, delivery ETA or savings.
- Historical transaction rows and immutable published pool snapshots retained. No production DB migration/deployment/merge until PASS.

## 1. UCP-3 Delivery, clusters and authoritative inventory visibility
**Backend read models (no new financial mutations):**
- GET /api/v1/supplier/pools/operations: SUPPLIER-only, portfolio inventory and operational counts by own supplier listings; live stock from supplier_listings and SUM(PENDING/COMMITTED supplier_inventory_allocations), filtered by listing unit. Mixed units fail closed (unavailable/null) rather than adding apples and oranges. Time clocks in UTC. No cross-supplier rows.
- GET /api/v1/supplier/pools/delivery-context: SUPPLIER-only, reuses supplierDeliveryService.getSupplierSettings and Lahori clusters; excludes other suppliers' pickup points/rates. Field names match existing G2 supplier logistics configuration.
**Frontend:**
- On Create Pool form, show own delivery configuration and eligibility preview. Regular delivery cluster selection can call existing PUT /pools/:id/clusters on draft (only if endpoint permits; no uncontrolled stock writes); pickup requires enabled active pickup point, explicit supplier-area commitment remains server-validated.
- Flash shows actual supplier delivery settings and fixed configured delivery fee, cannot pretend to offer a guaranteed cluster-specific quote because B5 flow does not yet persist an accepted G2 quote. Actual buyer delivery quote computed at checkout where implemented.
- Shared inventory panel shows listed, committed, pending, available, per-SKU unit and unknown/reconciliation states. Never allow total stock to be inferred solely from UI, publish re-checks original B4/B5 transactional locks.
**Gate:** ownership, supplier isolation, mixed-unit, negative stock, concurrent B4/B5 allocation, pickup and service-area controls.

## 2. UCP-4 Buyer Explore Pools
- GET /api/v1/pool-discovery?type=ALL|REGULAR|FLASH&category_id=&family_id=&cluster_id=&search=&limit=&cursor=.
- A read-only facade calls B4's existing verified discovery + B5's existing verified public getActive. Do not bypass either eligibility predicate. Buyer can filter type, exact family/category, non-sensitive search; preserve supplier-defined physical SKUs and price units. Filters on a single portal must mean the same thing across two modes; invalid/unknown filters fail with 400, never silently broaden.
- Regular cards: supplier title and real published SKU, participation cutoff, current/target/minimum, current tier estimate vs next tier only if authoritative, allowed delivery modes and published commitments. Never display a fabricated final saving.
- Flash cards: actual SKU, real original listing comparison and fixed supplier flash price, remaining stock, remaining expiry, best-before/condition/reason, whole lot vs multiple buyers. Never imply Flash reservation and B4 reservation are the same.
- Countdown timers anchored to server UTC; server owns actual availability.
- Legacy /flash-pools page may redirect to /pools?type=FLASH; preserve B5 checkout endpoints and existing buyer purchase path. No auto-order or auto-payment.
- Deep link, empty/error/loading states, mobile cards, accessibility and no Urdu UI; no B6 entities.

## 3. UCP-5 Supplier analytics and status alerts
- GET /api/v1/supplier/pools/insights: SUPPLIER-only, observational grouped counts and quantity totals per pool type; only comparable units are aggregated; all monetary sums use DECIMAL SQL (returned as strings), never JS binary floats. If fulfillment/net payout facts cannot be verified, return null / not available rather than constructed revenue or "savings".
- GET /api/v1/supplier/pools/alerts: SUPPLIER-only deterministic READ-ONLY alert list from existing pool, hold, orders and allocation statuses, e.g., DRAFT_AWAITING_PUBLISH, REGULAR_CLOSING_SOON, FLASH_EXPIRING_SOON, STOCK_ALLOCATION_NEAR_CAP, PAYMENT_PENDING_VERIFICATION (only verified own orders). Alert dedup by type/entity. No synthetic persistent notification delivery/SMS/email claims. Escrow and merchant settlement untouched.
- Supplier dashboard displays real counts and per-type summaries; status filters and analytics scopes B4/B5 only.

## 4. Build order
1. Safe separate feature branch and this versioned spec.
2. Implement UCP-3 read services, supplier-guarded endpoints, and supplier delivery/inventory UI.
3. Implement UCP-4 public read facade, accurate buyer listing cards and filters, deep links.
4. Implement UCP-5 read analytics and alerts with precise source provenance, render supplier dashboard.
5. Document endpoint examples, null/unknown policies, edge cases; prepare source/integration gates without running full tests.
6. Final later: disposable `miljor_test_db` migrate through 048, full B4/B5/B6 regression + Safepay hold/ledger + frontend Vite build + concurrency + data checks. If any FAIL, repair on branch; preserve `miljor_db` and `miljor_sandbox_db`.

## 5. Security + correctness acceptance
- Foreign supplier cannot list any inventory, cluster config, pickup, alert, revenue or order.
- Public response has no buyer email, buyer ID, address, private RFQ, internal supplier margin or payment tracker.
- Cluster and family filter use exact IDs; authoritative pool service determines eligibility, no client-only availability assumption.
- Regular vs Flash separate routes for purchase; no shared ambiguous `POST /checkout`.
- Time and price remain consistent across currency/unit, UTC clocks and Lahore UI presentation.
- Expired/hidden/legacy offers not in public discovery. No double allocation even in parallel publish.
- Retry/idempotency, cancellation, paid and in-flight provider reconciliation remain untouched.
- The plan cannot be called production COMPLETE until end-to-end release gate is green.

## 6. Known constraints
- G2 cluster delivery pricing already exists for Regular pools and supplier portal; B5's stock offer stores its own `delivery_fee` and does not automatically become a G2 delivery quote.
- No extant persistent notification sender is promised: UCP-5 first delivers server-derived in-app status alerts only.
- More advanced marketplace savings and verified delivery ROI need measured baselines and should remain unavailable until sourced.
