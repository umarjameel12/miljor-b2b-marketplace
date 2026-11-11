# MilJor — UCP-1/UCP-2 Unified Supplier Pool Management

**Branch:** `feature/ucp-unified-supplier-pools` based on `feature/b4-regular-dual-timers` (inherits B6 hardening).  
**Gate:** SOURCE IMPLEMENTED; MySQL/API/Vite/financial concurrency tests intentionally deferred for final acceptance.  
**Do not merge/deploy before final PASS.**

## Exact scope

Supplier manages **B4 Regular Pools** and **B5 Flash Pools** from **one Pool Management** page and conditional Create Pool form. The B6 buyer RFQ, collective bidding and recurring procurement state machines are **not** merged, called, or altered.

- Supplier route `/supplier/pools`; source link from Dashboard, Catalog and authenticated account menu.
- Authenticated supplier-only overview `GET /api/v1/supplier/pools/overview`: combines **own** Regular and Flash data; normalized `type: REGULAR | FLASH`, `status`, item title, quantity, expiry, draft publish actions, source UTC clock. Read-only; does not create or close pools.
- Supplier listing dropdown only includes `ACTIVE` supplier-owned SKU-based listings; no 16 hardcoded staple variants, Urdu UI, synthetic SKU, price, stock or MOQ.
- Draft Regular `POST /api/v1/pools`, draft update `PUT /api/v1/pools/:id`, publish `POST /api/v1/pools/:id/publish` through existing B4 controller. Preserves minimum, target, capacity, per-buyer MOQ, quantity increment, one/two volume pricing tiers, 24–72h delivery promise, supplier stock allocation and terms-locking. Product identity resolved authoritatively from published SKU; never guess legacy `products.id`.
- Draft Flash `POST /api/v1/flash-pools`, draft update `PUT /api/v1/flash-pools/:id`, publish `POST /api/v1/flash-pools/:id/publish` through existing B5 service. Preserves fixed discounted price, comparison against actual listing base price, ready stock, whole-lot/multi-buyer mode, buyer limits, minute-based supplier duration starting **at publication**, clearance reason and optional best-before date.
- Publish and cancel require explicit modal confirmation and existing backend permissions/stock/financial rules. No direct `ACTIVE` API mutation from unified overview.
- Existing B4 expiry/payment-hold dual timers and B5 hold/checkouts are retained. Timer display is informational; supplier database timestamps are authoritative.
- Existing legacy Supplier Catalog Regular create/edit actions now redirect to unified manager. Prior modal component remains mounted in source but unreachable via those actions; safe cleanup may be performed only after full UI regression.
- Unified source gate: `backend/tests/ucp_unified_supplier_pools_source_gate.js` prepared, **not run**.

## Remaining implementation / release gates

1. **UCP-3:** Confirm UX and draft validation across every commodity quantity unit, listing price and fulfillment area; finalize cluster picker and broader delivery settings if needed.
2. **UCP-4:** Buyer `Explore Pools` all/Regular/Flash discovery, separate countdowns and actual supplier prices; no RFQ/Collective Groups on this board.
3. **UCP-5:** Shared inventory visibility, supplier operational summaries and notifications (not payment-state modifications).
4. **Final tests (deferred per owner):** Apply migrations through 053 to `miljor_test_db`, isolated branch reconciliation, 8 categories/25 families, actual supplier-owned SKU publication and Regular/Flash creation/update/publish/cancel, negative auth, duplicate submit, concurrency and stock overselling, Safepay holds, expiry/payment timers, browser build and E2E, and B6 procurement isolation. Check protected DB fingerprints. **Never run mutation tests against `miljor_db` or `miljor_sandbox_db`.**
5. P0 financial safeguards require independent verification; no existing pending Safepay/escrow/paid order may be auto cancelled during Pool UI transitions.

## Notes on test status

No command execution, MySQL migration or live browser testing has been performed for this PR in the GitHub-only editing workflow. The draft PR must stay unmerged until final test evidence is recorded. Source-file commits do not imply release completion.
