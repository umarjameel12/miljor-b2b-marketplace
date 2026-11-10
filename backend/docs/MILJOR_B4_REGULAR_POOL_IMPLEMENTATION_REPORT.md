# MILJOR — PHASE B4: REGULAR POOL INTEGRATION & LIFECYCLE HARDENING

**Date:** 2026-11-10  
**GitHub branch:** `feature/b4-regular-pools`  
**Accepted upstream B2 SHA:** `fcbd82dafcb236f9cee980904ebddba5c1ab1999` — Antigravity 67/67 PASS  
**Accepted upstream B3 SHA:** `44f591d7fdd9c16f7a43c10d01de2b50bb637e7e` — Antigravity 81/81 PASS  
**B4 two-parent reconciliation merge:** `9f2e057fc3fd2d3bf7ebc0e614079e7ad8b89ea1` — B3 is a verified Git ancestor of B4 and the original pool-specific source tree is preserved.  
**CURRENT VERDICT:** **B4 SOURCE HARDENING IN PLACE, B4 FINAL MYSQL/API/FRONTEND ACCEPTANCE NOT YET RUN.**  
**NEXT PHASE:** B5 not authorized. Production release/merge-to-main not authorized.

## 1. Original source locations and Git/local parity

The repository has no `secretary` directory. `.agents/skills/subagent-driven-development/scripts/task-brief` is an installed agent skill, not application source. Existing MilJor code remains in original tracked `backend/src/controllers`, `backend/src/services`, `backend/src/repositories`, `backend/src/routes/v1`, `frontend/src/pages`, `frontend/src/api`, `backend/tests` and `backend/docs`. See `MILJOR_SOURCE_PATH_AND_GIT_PARITY_POLICY.md`.

Accepted B2/B3 original `catalogService.js`, `supplierListingMutationService.js` and historical reports were explicitly reconciled into the B4 original paths, then a proper **two-parent merge commit** recorded B3 ancestry. No duplicate backend, artificial source folder, destructive database migration or alternate MilJor project was created. GitHub commits do NOT by themselves prove Antigravity's local B4 worktree is up to date; it must safely fetch/sync and check local/remote SHA parity. Do not overwrite B3 worktree.

## 2. B4 subphase source implementation/audit matrix

| Subphase | Source status | Implementation/evidence |
|---|---|---|
| **B4-A Pool identity/ownership** | **Fixed in original source; test assertions committed** | SKU-only pool creation resolves legacy `products.id` from the immutable published `product_specifications.product_id`, never from canonical `family_id`. Supplied supplier-product and SKU IDs are cross-validated against the owning listing and specification; incorrect mappings return `POOL_PHYSICAL_IDENTITY_MISMATCH`. Historical specification-only commercial listings also resolve their true legacy product FK from `product_specifications`. Existing supplier-only pool creation and matching spec/listing authorization preserved. |
| **B4-B Draft quantities/schedules** | **Fixed in original source; test assertions committed** | Create and update both reject malformed/nonfinite/excess-precision DECIMAL(12,4) quantities via `INVALID_POOL_DECIMAL`. Existing target/MOQ/capacity, whole-pack, time window and mandatory 24–72h SLA rules preserved. |
| **B4-C Inventory allocations/concurrency** | **Fixed in original source; test assertion committed** | Publish already serializes pool/listing rows and commits `supplier_inventory_allocations` within the same transaction. New safeguards compare on-hand + outstanding promises via exact decimal math; allocate canonical 4dp quantity; reject rows with incompatible allocation units (`ALLOCATION_UNIT_MISMATCH`). Existing duplicate-publish/idempotency handling preserved. |
| **B4-D Publish & immutable terms** | **Fixed in original source; existing regression reused** | At final publication verify listing supplier and exact physical spec, and that supplier-owned product and SKU are still PUBLISHED; reject `POOL_SKU_NOT_ELIGIBLE` or `POOL_LISTING_IDENTITY_MISMATCH`. Existing atomic allocation, locked commercial snapshot, tier and delivery term immutability retained. |
| **B4-E Price tier/progress** | **Fixed validation; existing progress read model reused** | `tierPricingService` rejects excess precision, NaN, Infinity, invalid range and overlapping discrete boundaries before Number conversion; continuity uses actual purchase increment. A new fast pure tier contract gate covers positive/negative cases. Existing `poolProgressService` authoritative eligible-demand read model reused rather than rewritten. |
| **B4-F Closing/qualification/supplier decisions** | **Existing implementation audited/reused** | Existing `commercialLifecycleService`, pool qualification, authoritative supplier-decision and buyer-commitment APIs remain in service. Retired `confirm` route stays fail-closed and now points callers to the existing qualification/decision APIs (not an obsolete future placeholder). Historical reservation/qualification/status tests retained. |
| **B4-G Buyer reservations/units** | **Fixed custom physical-unit gap; core reservation flow reused** | Supplier-defined purchasing pack units (e.g. `bundle`) now treated as indivisible by shared unit semantics; conversion checks actual SKU purchasing unit and preserves the historical global standard-pack bridge. Existing reservation capacity, increment, identity, payment isolation, authorization and expiry behavior reused. New pure custom-unit gate added. |
| **B4-H Supplier/buyer UI** | **Supplier draft UI corrected; existing buyer read model reused** | Supplier portal sends exact decimal string quantities and tier prices, exposes purchase increment, calculates tier boundary from defined increment, restricts new draft CTA to ACTIVE listing, shows actual product title and retains immutable publish confirmation. Client decimal regex escape error corrected. Buyer `poolProgressService` reads the actual supplier-owned physical SKU title/brand/pack, not the fake generic FK anchor, while legacy global spec display stays compatible. An E2 API assertion checks the published supplier SKU title. |
| **B4-I End-to-end acceptance** | **Test source prepared; executable MySQL/API/React gate PENDING** | Updated existing E2 immutable-pool test with FK/identity, draft precision and committed allocation assertions; new fast pure tier/custom-unit tests. Antigravity must run affected pool, reservation, lifecycle, E2/E3 compatibility suites and frontend build on `miljor_test_db`, with protected DB before/after evidence. |

**Important:** The implementation/audit status above does not equal verified runtime PASS. B4-A through H contain source changes and deliberate reuse of previously tested modules; integration defects may still be exposed by the required B4 gate.

## 3. Files modified in original locations

- `backend/src/controllers/poolController.js` — B4-A/B/C/D/F.
- `backend/src/services/tierPricingService.js` — B4-E.
- `backend/src/services/unitConversionService.js` — B4-G.
- `backend/src/services/poolProgressService.js` — B4-H buyer SKU presentation.
- `frontend/src/pages/SupplierCatalogPage.jsx` — B4-H.
- `backend/tests/package_e2_product_ownership_and_immutable_pools_gate.js` — B4-A/B/C/D compatibility assertions.
- `backend/tests/b4_tier_decimal_contract_gate.js` — B4-E pure unit regression.
- `backend/tests/b4_custom_pack_unit_gate.js` — B4-G pure unit regression.
- `backend/docs/MILJOR_SOURCE_PATH_AND_GIT_PARITY_POLICY.md` — canonical paths/source parity.
- `backend/docs/MILJOR_B4_REGULAR_POOL_IMPLEMENTATION_REPORT.md` — this source implementation/evidence handoff.
- `backend/docs/MILJOR_PHASE_LOG.md` — phase status.

No new database migration, payment state mutation, altered historic commercial snapshots or direct protected database change is part of this GitHub-only implementation.

## 4. Source-only verification

- JavaScript syntax may be statically parsed without MySQL.
- Pure tier/unit modules were executed in an isolated source evaluator: six selected checks PASS (custom packaging recognized, 37kg bundle conversion, unrelated-unit conversion rejected, valid tiers, overlapping tiers, excessive precision). **This is not execution of the committed Node suite and does not establish DB/API acceptance.**
- New committed `b4_tier_decimal_contract_gate.js` and `b4_custom_pack_unit_gate.js` still need Antigravity's actual Node execution.
- JSX must be verified with a real frontend build. No authenticated HTTP test or DB mutation was run by ChatGPT.

## 5. Fast, broad-enough final Antigravity integration gate (one consolidated window)

1. In a **separate B4 Git worktree**, fetch `feature/b4-regular-pools`. Inspect dirty files and preserve all local user changes; never force reset. Confirm B3 `44f591d7` is reachable in B4 ancestry and B2 `fcbd82da` through accepted B3.
2. Confirm `SELECT DATABASE() = 'miljor_test_db'` before any mutable test; record `miljor_db` protected counts before/after. Never run B3 and B4 mutable tests concurrently against the same `miljor_test_db`.
3. Quick pure checks: `node tests/b4_tier_decimal_contract_gate.js`; `node tests/b4_custom_pack_unit_gate.js`.
4. Most directly affected integrated flow: `node tests/package_e2_product_ownership_and_immutable_pools_gate.js`; `node tests/package_e3_entitlements_and_supplier_portal_gate.js`.
5. Pool publishing + pricing + reservation: `node tests/part4b3_pool_publishing_gate.js`; `node tests/part4b4_buyer_reservation_gate.js` and/or `node tests/part4c1_reservation_mutations_gate.js`, selecting the smallest set that checks current changed dependencies.
6. Closure/decision: `node tests/part4d2_pool_qualification_gate.js`; `node tests/part4d3_supplier_decision_gate.js`; `node tests/part4d4_buyer_commitment_gate.js` if not covered by a faster accepted consolidated gate. No unnecessary full B0 master suites.
7. If needed, targeted concurrent publish/draft edit, double allocation, buyer capacity, invalid units and historical B3 listing reactivation checks.
8. Run `npm --prefix frontend run build` once.
9. Diagnose failures, correct minimal original source, add focused tests and rerun only affected suites. Never weaken safety checks to obtain green.
10. Record exact commands, exit codes, per-suite assertions, DB identity/protection, source SHA and final PASS/FAIL/BLOCKED. Update this report and phase log, commit/push factual evidence and verify B4 local/remote HEAD parity.

## 6. Mandatory post-test outcomes

- No duplicate inventory allocation or leaked fixtures.
- No historical published-pool snapshot changed.
- No wrong canonical family/legacy product FK.
- No supplier identity spoofing or invalid multi-supplier cross-edit.
- No direct legacy supplier confirmation or unqualified buyer commitment bypass.
- No invalid precision, tier overlap or custom-pack fractional reservation bypass.
- No out-of-area/blocked supplier/new-buyer eligibility bypass.
- No protected `miljor_db` changes.

**B4 FINAL STATUS:** SOURCE IMPLEMENTATION/AUDIT READY FOR LOCAL ACCEPTANCE — NOT VERIFIED.  
**CAN START B5:** NO.  
**B2-MEDIA:** Remains a separate unimplemented workstream, not falsely included as B4 functionality.
