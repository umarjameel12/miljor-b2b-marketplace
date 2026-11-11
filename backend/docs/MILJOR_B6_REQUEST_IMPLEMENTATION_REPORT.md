# MilJor B6 — Buyer Shopping List Implementation Checkpoint

**Date:** 2026-11-10
**Branch:** `feature/b6-private-rfq`
**Scope:** B6-P1 / B6-B buyer-owned multi-product draft and publication, with B6-C buyer UI started.
**Status:** SOURCE IMPLEMENTED — RUNTIME ACCEPTANCE BLOCKED (migration 037 and MySQL/API/frontend integration pending).
**Preserved dependencies:** accepted B4 baseline, independently reported accepted B5 SHA `ecd7d2ee67d280dab9550e8ffc9497207106cbf6`.
**GitHub source of truth:** original tracked files; no duplicate backend/frontend trees, no existing file rename.

## Implemented components
1. `backend/database/migrations/037_smart_procurement_requests.sql`: additive InnoDB `procurement_requests`, `procurement_request_items`, `procurement_request_mutations` with buyer ownership, per-line units/qty, versioning, unique idempotency, immutable mutation response snapshots and foreign keys.
2. `backend/src/services/procurementRequestService.js`: verified active buyer only, canonical approved families and allowed units, exact positive quantity (from `procurementRequestPolicy`), create with idempotent replay, atomic item-line writes, owned read/list, optimistic draft edit with durable replay, authorized one-time publish with post-lock UTC deadline check and immutable published terms.
3. `backend/src/controllers/procurementController.js`: five new methods for buyer shopping requests, normalized errors; mutation APIs require X-Idempotency-Key.
4. `backend/src/routes/v1/procurementRoutes.js`: strict BUYER-only `/api/v1/procurement/requests` POST, GET, GET/:id, PATCH/:id, POST/:id/publish. No ADMIN/SUPER_ADMIN impersonation.
5. `frontend/src/pages/RfqPage.jsx`: mobile-first Get Best Quotes shopping list inside original page; multiple items, canonical catalog family dropdown and family-allowed unit dropdown, quantity/quality preferences, delivery area, quote closing time, draft create/edit, owned list and publish action. Legacy RFQ view preserved. No secondary page.
6. `backend/tests/b6_procurement_request_lifecycle_gate.js`: executable database integration gate (schema identity, InnoDB, verified buyer, two families, create/edit/replay, versions, family unit mismatch, ownership, publish immutability, no orders/payments, exception-safe cleanup).

## Current behavior and explicit exclusions
- Buyer can draft/update/publish **SINGLE_BUYER + ONE_TIME** requests only, including multiple item lines.
- COLLECTIVE and RECURRING can be described in the input policy but publish fails closed with `PROCUREMENT_MODE_NOT_READY`; no phantom shared commitments or recurring charges.
- Publishing NEVER charges buyer, reserves supplier inventory, creates an order or initiates Safepay.
- Supplier quote bidding, comparison integration, delivery assignment, request expiry worker, payment and fulfillment are subsequent B6 packages. Their absence must be shown in UI and not claimed as completed.
- Matching requires actual supplier-owned published SKU at quote stage; buyer request specifies compatible product family and preferred requirements, not a fictitious MilJor-owned physical SKU.
- Quote deadline is stored as UTC; frontend local timestamp converted to ISO offset-aware value; expiry revalidated after row lock.
- Source requires Migration 037 to be applied safely to the *test* DB first. Migration has NOT been applied from this GitHub-only environment.

## Verification actually performed
- JavaScript syntax parsed successfully for `procurementRequestService.js`, `procurementController.js`, `procurementRoutes.js`, and initial lifecycle test file in V8 Function parser.
- Migration reviewed against canonical migration 033: `catalog_product_families.id` is INT, and its JSON allowed pack/purchasing units are available. Static migration contains 3 InnoDB CREATE TABLE statements and 5 foreign keys.
- Existing B6 pure-domain check evidence: 15/15 request policy, 12/12 quote comparison and 14/14 UTC parser executed in isolated JS runtime previously. These are NOT DB/API/Vite verification for this new slice.
- **NOT EXECUTED:** migration 037, live Node/Express API, MySQL create/edit/publish tests, HTTP authorization tests, frontend Vite build, browser E2E. No fake PASS claim.
- **DATABASE:** no connection or writes to `miljor_db`; no migration execution on `miljor_test_db` via GitHub connector.

## Acceptance instructions for isolated local test worktree
1. Verify local/remote B6 SHAs and preserve uncommitted changes. Never blindly merge B5 into B6 or overwrite local files.
2. Run `SELECT DATABASE()` and assert `miljor_test_db`; back up test DB before migration. Audit physical schema/foreign keys/indexes and migration 036 dependency; apply migration 037 ONLY to `miljor_test_db`.
3. From backend: `NODE_ENV=test TEST_DB_NAME=miljor_test_db node tests/b6_procurement_request_lifecycle_gate.js` (PowerShell: `$env:NODE_ENV="test"; $env:TEST_DB_NAME="miljor_test_db"; node tests/b6_procurement_request_lifecycle_gate.js`).
4. Validate API route mount and POST/GET/PATCH/publish through real JWTs: verified buyer PASS; supplier/ADMIN/SUPER_ADMIN 403; other buyer request ID 404; malformed input 400; duplicate key same body replay vs conflict; edited/published version races.
5. Run `npm --prefix frontend run build` and buyer browser smoke for one/two item list, family units, deadline, draft editing and published request visibility. Check inaccessible legacy acceptance is not presented as validated Smart Procurement checkout.
6. Confirm no unexpected changes to protected `miljor_db` and no phantom `orders`/`payments`. Capture actual test counts, SQL identity, build exit code and final SHA.

## Acceptance gate
**B6-B SOURCE IMPLEMENTED / TEST NOT RUN / FULL GATE BLOCKED.**
B6-C source buyer form partially implemented, browser/API test pending.
Stop before B6-D or live award/checkout until the B6-B end-to-end gate is genuinely green and B5 shared inventory financial contracts are reconciled.
**CAN START NEXT PHASE: NO**.


## Code-level execution update (same checkpoint)
- Loaded the **current exact GitHub copies** of `exactDecimal.js`, `procurementRequestPolicy.js` and `procurementRequestService.js` into isolated JavaScript with a deterministic mocked database adapter.
- Executed **8/8 passing** simulated lifecycle assertions: create two item lines, create replay, edit/version increment, original create snapshot unchanged after edits, edit replay, publish, publish replay, and published immutability.
- This is a bounded **MOCKED DATABASE** exercise. It does not prove MySQL SQL syntax, row-lock behavior, constraints, transactions, HTTP route authorization or Vite build. The explicit live `b6_procurement_request_lifecycle_gate.js` remains unexecuted.
- Reconciled catalog migration 033: product family IDs are INT, parent category approval must also be ACTIVE/APPROVED, and the two JSON arrays list allowed physical/packaging units. New B6 service validates both category/family and requested unit; existing buyer UI filters purchasing unit choices.
- Fixed immutable original-create replay by adding `create_response_snapshot` JSON column to Migration 037 and persisting first response inside creation transaction.
- Legacy RFQ UI/route preserved for compatibility; new buyer UI foregrounds **Get Best Quotes** and does not represent supplier bidding/payment as live.
- No additional database or financial mutations occurred from this GitHub-only implementation.
