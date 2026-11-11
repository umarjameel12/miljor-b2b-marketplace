# MilJor UCP-3 → UCP-5 Combined Implementation Contract

Status: SOURCE IMPLEMENTATION IN PROGRESS; final integration acceptance DEFERRED until owner's complete release gate.
Parent: feature/ucp-unified-supplier-pools. This package is isolated from B6 RFQ, collective bids, and recurring buyer procurement.

## A. Non-negotiable invariants
1. Supplier creates Regular/Flash offers from their own published, approved physical SKU and ACTIVE listing. Family/SKU physical identity is immutable after publish.
2. One supplier dashboard and marketplace, but B4 Regular and B5 Flash remain independent authoritative transaction/state machines; never translate reservations to Flash holds or vice versa.
3. Regular demand tier pricing, supplier minimum/target/capacity, promised delivery 24–72h after pool close, cluster locks and two independent timers remain unchanged.
4. Flash ready stock, supplier-approved verified discount, WHOLE_LOT/MULTI_BUYER, short/long supplier-set duration, 15-minute purchase hold, provider-driven payment verification, and safe best-before constraints remain unchanged.
5. Both engines share the existing supplier_inventory_allocations ledger. Do NOT add parallel inventory balances or independently update quantities in this batch.
6. Existing Safepay, escrow, refunds, physical fulfillment, financial settlement, invoices and outbox are authoritative; no price-based pseudo savings, auto payment, auto refund or automatic B6 demand-to-pool conversions.
7. Never infer seller's service areas or delivery charges; missing validated delivery information means 'verify at checkout', not 'free' or 'all Lahore'. Never reveal other buyers' identities in supplier metrics.
8. All buyer read models must use existing published/verified supplier and category/family eligibility filters. Supplier-only inventory and analytics endpoints are tenant-scoped.
9. Retain B4/B5 route compatibility. New endpoints are additive/read-only. Never apply migrations to miljor_db or miljor_sandbox_db. Never merge until final executed tests PASS.

## B. UCP-3 — Fulfillment & shared stock

### Supplier Create/Edit:
- Fetch verified supplier delivery modes, cluster rates, pickup points, and active Lahore clusters from existing G1/G2 services; show rates only if configured.
- Regular draft: select explicit authorized delivery clusters from supplier's eligible STANDARD_CLUSTERED rates; draft save then PUT /pools/:id/clusters; only publish if original B4 validation accepts fulfillment configuration and immutable SLA. Do not silently mutate existing published coverage.
- Flash draft: keep existing B5 fixed supplier-specified delivery fee and existing payment snapshot; show pickup/standard eligibility only as supplier account info, not invent a cluster-based flash checkout contract where B5 has none.
- Supplier inventory: read exact listing stock, existing COMMITTED allocation quantities from source of truth; present available estimated free inventory in physical listing unit. Warn only; B4/B5 transactional publish remains sole availability gate.
- Use exact supplier listing + SKU and version rather than hard-coded staple variants.

### Backend:
- Authenticated supplier-only GET /supplier/pools/stock?listing_id=id. Validate listing ownership; derive available, committed and free quantities from existing supplier_inventory_allocations, never second mutable stock.
- Supplier-only GET /supplier/pools/fulfillment: return existing supplier delivery config + active eligible Lahore clusters; no new mutation.
- Endpoint errors fail closed for incomplete DB configuration, incorrect units, or foreign IDs.

## C. UCP-4 — Buyer unified discovery
- Keep /pools buyer marketplace and separate /flash-pools backward-compatible links.
- One buyer board: All/Regular/Flash filters; fetch live B4 public GET /pools and B5 public GET /flash-pools independently. Separate type, status, countdowns, units and pricing semantics; never represent Flash sold-stock as Regular demand tiers.
- Regular card keeps existing authoritative poolProgress read model and delivery eligibility gates; no duplicate frontend tier math as a payment guarantee.
- Flash card shows actual supplier SKU, price, verified comparison listing price, remaining stock, cutoff, whole-lot vs multi-buyer, clearance details and best-before.
- Flash buyer action: authenticated BUYER, quantity validation and idempotency key, POST /flash-pools/:id/hold, then obtain verified order status and canonical /orders/:id/checkout. Do not mark paid before provider verification.
- For invalid/expired stock, refresh authoritative data and display exact backend error, no optimistic reservation.
- Search/filter does not disclose supplier email/buyer details. Do not merge B6 collective procurement products into this board.

## D. UCP-5 — Supplier performance & operational alerts
- Supplier-only server-side analytics: pool counts, statuses, B4 committed/eligible volume from source reservation statuses, Flash stock sold and pending holdings distinguished from fulfilled paid orders, paid-value only from authoritative PAID order status. B4/B5 amounts computed from existing order rows with exact aggregation in SQL; never multiply price by reservation estimates and call revenue.
- Per-pool actionable alerts from persisted lifecycle facts: close approaching, low stock, draft pending review, payment pending, committed orders awaiting fulfillment. Read-only event signal; not a sent SMS/email. Reuse existing outbox for actual external delivery in subsequent controlled workflow.
- Unified dashboard displays real counts and analytics; NO fabricated sales, savings, delivery times or buyer contacts.

## E. Integration steps and acceptance criteria
1. Commit this plan and preserve separate scope branch.
2. Implement UCP-3 read-only supplier inventory/delivery endpoints; wire draft cluster assignment; no new migration.
3. Implement UCP-4 buyer combined board, Flash buy/hold checkout, independent status/countdown; keep existing Regular card.
4. Implement UCP-5 server-side tenant-scoped analytics/alerts; UI status and metrics, no fake notification delivery.
5. Prepare edge-case/source contract tests for final executable gate. Do not run full DB, Vite, provider or E2E tests now, per owner's instruction.
6. Final future gate on miljor_test_db only: migrations/backups; 8 categories/25 families; B4 and B5 create/update/publish/cancel; active stock=listing - all ledger commitments, unit mismatch, concurrent competing stock allocations, buyer authorization and payment retries, expiry boundary, B4 payment hold and B5 purchase hold independence, provider webhook reconciliation, delivery eligibility, time zone UTC and Asia/Karachi, B6 RFQ/collective/recurring isolation, browser UI E2E and full regression.
7. Do not mark COMPLETE AND VERIFIED until database, backend, API, auth, validation, error handling and tests pass together.

## Known constraints
- Existing flash order delivery fee is fixed in the B5 snapshot and does not yet expose the B4 G2 cluster quotation contract; UI must not promise clustered Flash delivery unless that backend workflow is added separately and verified.
- Analytics/alerts in this package are informational read models, **not** a messaging/notification delivery service.
- The release remains BLOCKED until final acceptance; this source batch is not a production deployment.
