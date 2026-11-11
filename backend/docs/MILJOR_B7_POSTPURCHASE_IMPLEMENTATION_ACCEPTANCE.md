# MilJor B7 — Business-Aligned Post-Purchase Implementation & Acceptance Contract

**Date:** 2026-11-11
**Branch:** `feature/b7-fulfillment-gap-audit-20261111`
**Base:** accepted B6 `6ef03de061c75854c9e042a99a05404c4bd64929`
**Status:** SOURCE IMPLEMENTED / REAL HTTP + DB + BROWSER ACCEPTANCE PENDING.
**Ownership:** B7 post-purchase ONLY. UCP/Regular/Flash consolidation is explicitly owned by a different chat; do not edit or merge `feature/unified-pool-only-workflow`. Financial P0, settlement, payment provider, catalog and global migrations also belong to other workstreams.

## Business contract
Lahore B2B buyer (restaurant, caterer, bakery, kiryana) orders actual supplier-owned physical SKUs through B6 RFQ, collective or recurring procurement. Once provider-verified PAID, **that individual supplier order** appears to the assigned supplier and owning buyer. Supplier stages preparation and delivery; only buyer affirmatively confirms complete receipt. Physical shortages are recorded at **immutable SKU-line level**. Invoice reflects exact award-line descriptions, units, quantities, prices and accepted per-supplier delivery/processing fees. No additional automatic payment, financial settlement, refund or payout is permitted.

## Audited existing modules — reuse
- `fulfillmentService.js` with supplier-owned PAID order list/detail, sequential milestones, buyer receipt, events and authorization.
- `disputeService.js` buyer disputes, supplier response/remediation, admin decisions; financial mutations remain forbidden.
- `invoiceService.js` authorized on-demand invoice issuance.
- `procurementAwardService.js` one `orders` row per awarded supplier plus immutable `procurement_award_lines`.
- `procurementDeliveryGroupingService.js` B6-O paid-order route planning; no second delivery engine.
- Existing `/api/v1/fulfillment`, `/api/v1/disputes` and `/api/v1/invoices` routes; no duplicate commercial APIs.

## Confirmed gaps and implementation
### 1. B6 award -> fulfillment
B6 uses `orders.total_qty=1` as **basket marker** and `notes='SMART_PROCUREMENT_BASKET'`. The generic fulfillment listing already selects every assigned PAID order irrespective of `pool_id`, but its detail previously showed only generic pool product data. Buyer/supplier paid order detail now returns a restricted `award_lines` array **after tenant ownership and PAID checks** (physical SKU ID, immutable award_line_id, quantity, purchasing unit, unit price and subtotal). No extra permissions to public/supplier-before-award screens.

### 2. Short / partial delivery
New `b7LineDeliveryPolicy.js` computes exact 4-decimal missing quantity and 2-decimal claim amount from the immutable award line. Buyer `POST /api/v1/disputes` with category `SHORT_QUANTITY` and `evidence_metadata:{award_line_id,received_quantity}`:
- Under locked parent order row, checks owning buyer, provider-PAID state, dispatch-eligible status, line ownership and original quantities.
- Computes `ordered - received` and `missing × locked unit price` server-side, never from `orders.total_qty=1`.
- Checks active overlapping claims **for the same award line**, persists server-derived evidence, exact claimed amount and order EXCEPTION atomically. Distinct SKU lines remain distinct; older basket-wide evidence fails closed for overlap.
- Same key/different line or quantity returns 409; deterministic dispute code avoids timestamp collisions.
- Does NOT process refund or settle any balance.

**Example:** 100.0000 kg ordered, 80.0000 kg delivered, at PKR 80.00/kg -> **20.0000 kg disputed**, **PKR 1,600.00 assessed operational claim**. This amount is NOT automatically payable/refundable.

Legacy single-product claims retain existing order-level behavior. Supplier-originated B6 shortage without a physical-line authorization contract and buyer generic `QUANTITY_MISMATCH` on synthetic basket quantity explicitly fail closed.

### 3. Exact multi-item and split-supplier invoices
`b7AwardInvoiceProjection.js` reads immutable `procurement_award_lines` tied to the exact supplier `order_id`, preserving different products, quantities and units. It rejects:
- Missing/duplicate lines
- Invalid physical quantities or snapshots
- Item sum unequal to order supplier subtotal
- Locked supplier total unequal to subtotal + accepted delivery + buyer platform fee

`invoiceService.js` now issues final invoices **only on verified PAID orders** and uses the award-line projection for B6 orders; previous single-product invoice representation remains unchanged. A split-award creates a distinct invoice for **each supplier's order**, not a fake cross-supplier itemization.

### 4. Supplier-delivered vs buyer-confirmed vs dispute
Removed three paths that silently promoted orders to `BUYER_CONFIRMED`:
- Buyer acknowledgement of **remediation** items alone
- Admin dispute decision/rejection
- Admin closing final dispute

After all blocking disputes are resolved, an originally supplier-delivered order can return to `SUPPLIER_DELIVERED` (not buyer-confirmed). The buyer must separately authenticate and confirm the **complete order** through `/fulfillment/buyer/orders/:id/confirm-receipt`. Existing 4E.5 regression strengthened to verify separate buyer action. No admin can release escrow just by closing a dispute.

### Critical DB/FK seam — pool-less B6 award orders
Migration `012_reservation_business_events.sql` enforces `pool_id INT NOT NULL` and a FK to `pools(id)`. B6 accepted orders are created directly through RFQ award with **no B4 pool_id**, so legacy fulfillment and dispute outbox inserts using `pool_id||0` could rollback correct post-purchase operations.

New `b7PostpurchaseEventBridge.js` keeps every **real pooled order** on the existing reservation event outbox. Only `notes='SMART_PROCUREMENT_BASKET'` with no pool routes its post-purchase event via existing **B6-Q transactional `procurement_notifications`**, sending separate deduped buyer/supplier `DELIVERY_STATUS_CHANGED` notifications with allowlisted `order_id` and `status_code` only. It does not claim an external email/SMS was sent. Both target tables run under the caller's existing transaction: notification failure aborts the business update; no fake `pools.id=0` row is created.

Adapted all four fulfillment outbox emitters (supplier transitions, supplier exception, buyer receipt, buyer discrepancy) plus three dispute emitters (buyer claim, supplier shortage, supplier response). Other direct order sources, including UCP/Flash, are NOT migrated here; their owner must implement the proper outbox contract separately. Added `tests/b7_direct_order_event_bridge_gate.js` with eight explicit role/PII/FK-policy/failure-propagation assertions.

### 5. Functional buyer/supplier UI and real browser gate
New `/post-purchase` route and `PostPurchasePage.jsx`:
- Buyer sees own paid orders, stage timeline, actual SKU lines and final invoice.
- Supplier sees assigned paid orders, explicitly chooses delivery method, moves through authoritative milestones.
- Buyer reports a SKU shortage; supplier views the related dispute, responds and proposes an explicit remedy; buyer acknowledges remediation without silently confirming complete receipt.
- Handles empty/error/loading states and retry-stable idempotency keys.
- Existing pools/RFQ frontend and UCP workstreams are unchanged.
- Guarded Playwright read-only test `frontend/tests/b7_postpurchase_browser_e2e.mjs` checks login and role-specific order read models against localhost test backend. Browser **mutation** E2E still requires real disposable fixtures and a configured browser environment.

## Test artifacts / how to run
### Gate S — source, no DB
`cd backend && npm run test:b7:source`
Runs 12 exact shortage/invoice assertions plus 8 direct B6 outbox assertions (20 expected total). Checks 100/80 exact quantity, mixed rice/oil units, accepted subtotal, accepted order total, invalid evidence.
GitHub B7 CI additionally syntax-checks backend services and builds/tests frontend.

### Gate H — paid B6 order HTTP read-only
On backed-up, authorized disposable test DB, provide:
- `NODE_ENV=test`, `TEST_DB_NAME=miljor_test_db`
- `B7_ALLOW_READONLY_HTTP_TEST=YES`, `B7_TEST_PAID_B6_ORDER_ID=<existing PAID B6 award supplier order>`
- Test-only `JWT_SECRET`, test DB credentials; optional `B7_TEST_UNRELATED_BUYER_ID`

Run `cd backend && npm run test:b7:readonly-http`. This checks exact B6 award link, owner buyer/supplier GET, award SKU line identity, anonymous denial and optional cross-buyer rejection. If no real PAID fixture exists, BLOCKED; never create fake payment status to bypass.

### Gate D — mutable existing fulfillment/dispute HTTP suites
Requires `B7_ALLOW_ISOLATED_POSTPURCHASE_TESTS=YES`, `NODE_ENV=test`, `TEST_DB_NAME=miljor_test_db`, test-only DB credentials, backed-up disposable fixtures. B6 046–048 migration names must exactly match the source branch. Run `cd backend && npm run test:b7:isolated`. Uses original Part 4E.4 and strengthened 4E.5 tests; does not run migration or touch protected DB.

### Gate U — actual browser
Set `B7_BROWSER_READONLY_ACCEPTANCE=YES`, `B7_BACKEND_TEST_DB_CONFIRMED=YES`, `B7_BROWSER_URL=http://localhost:5173`, dedicated buyer/supplier test credentials, and install Playwright in isolated environment. Run `cd frontend && npm run test:b7:browser:readonly`. This is read-only smoke, NOT full cross-role write E2E.

### Gate W — full buyer/supplier WRITE browser E2E on disposable fixtures
Script: `backend/tests/b7_postpurchase_browser_write_e2e.js`.
Command: `cd backend && npm run test:b7:browser:write`.

Requires explicit `B7_BROWSER_WRITE_ACCEPTANCE=YES`, `B7_BACKEND_TEST_DB_CONFIRMED=YES`, `NODE_ENV=test`, `TEST_DB_NAME=miljor_test_db`, `B7_BROWSER_URL=http://localhost:5173`, test DB credentials, dedicated B7 buyer/supplier accounts, local Playwright+Chromium, and TWO distinct real paid B6 order fixtures (`B7_BROWSER_COMPLETE_ORDER_CODE` and `B7_BROWSER_SHORTAGE_ORDER_CODE`). Both must begin `AWAITING_SUPPLIER_ACKNOWLEDGEMENT` and belong to those test identities; shortage order must have exactly one immutable 100.0000-unit award line.

The runner intentionally **mutates only the disposable test database**: supplier stages two orders, buyer confirms one + verifies an issued invoice matches the immutable lines, buyer claims a 20-unit short delivery on the second, supplier proposes/delivers the remedy, buyer confirms remedy and finally **separately confirms full original receipt**. It checks exact persisted quantities and unchanged payment escrow rows.

If fixtures/Playwright/browser are missing or financial/migration identity is unresolved, mark BLOCKED; NEVER manufacture paid status to satisfy the test. Use isolated personal/test customer identities only; protect screenshots and browser data.

### Gate X — final scenario E2E
With a globally reconciled disposable test DB and authorized payment sandbox:
1. Two B6-awarded suppliers: one supplier cannot see/mutate other's fulfillment or invoice.
2. Real authorized Safepay PAID supplier order appears on supplier/buyer screens; seller progresses stages without skipping.
3. Buyer reports 100kg vs 80kg; 20kg shortage assessed on correct SKU and no invented basket refund, under concurrency.
4. Supplier responds/remediates; admin closure cannot trigger BUYER_CONFIRMED; buyer explicitly confirms after resolution.
5. Multi-SKU + split-supplier invoice snapshots reconcile per order with financial ledger and no double-charge.
6. Browser runs full buyer/supplier write journey with test-only users and records logs/video if privacy controls permit.

## External blockers and release policy
- **Global migrations 046–052:** Other workstreams own resolution. This branch never overwrites migrations or rewrites history.
- **Financial commission/payout/refund:** Financial P0 owner must confirm immutable commission, partial refund line-contract compatibility, provider escrow vs accounting status, disbursement conditions. **Existing partial refund assessment uses `orders.total_qty` and `orders.unit_price`; unsafe for a B6 basket marker. This B7 work does NOT silently enable such refunds.**
- **UCP/Regular/Flash:** Other chat exclusively owns consolidation. Do not merge UCP feature work into this branch or duplicate pool engines.
- **Actual tests:** New source/business logic and acceptance scripts are committed. No code execution or DB/browser run was possible through this GitHub-only session. Historical B6 406/406 is not B7 verification.

**Gate verdict: SOURCE IMPLEMENTED; SOURCE TESTS NOT YET EXECUTED; REAL HTTP/DB AND WRITE BROWSER E2E BLOCKED/PENDING. CAN DEPLOY: NO. CAN MERGE: NO until gate evidence and cross-workstream reconciliation.**
