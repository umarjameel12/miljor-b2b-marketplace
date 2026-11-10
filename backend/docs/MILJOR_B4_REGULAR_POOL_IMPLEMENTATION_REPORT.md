# MilJor — B4 Regular Pool Lifecycle & Integration Hardening

**Date:** 2026-11-10  
**Branch:** `feature/b4-regular-pools` (separate from B3 acceptance).  
**Base:** `fd3d116098abfe00e0ce9f22eb9b0d46514a38c6` — B3 source **before** final Antigravity acceptance.  
**B2 accepted head (to reconcile):** `fcbd82dafcb236f9cee980904ebddba5c1ab1999`.  
**Status:** **PARTIAL IMPLEMENTATION — B4-A/B STARTED, ALL RUNTIME INTEGRATION TESTS PENDING**. No assumption that unverified B3 fixes are accepted; no B4 PASS or B4 release claim.

## 1. Authoritative six-level business path

Canonical family (MilJor) -> supplier physical product -> supplier-owned physical SKU -> supplier listing -> Regular Pool -> buyer reservations. Published physical identity and published pool commercial terms must remain immutable.

All work must use original paths; see `MILJOR_SOURCE_PATH_AND_GIT_PARITY_POLICY.md`. Repo tree inspection found no `secretary` directory, and the `.agents/skills/.../task-brief` path is legitimate agent tooling, not a product source folder.

## 2. Planned B4 subphases and implementation states

| Subphase | Scope | State |
| --- | --- | --- |
| B4-A | Pool-to-SKU/listing/product identity & supplier ownership | **SOURCE CHANGES COMMITTED; TEST PENDING** |
| B4-B | Draft quantity/target/MOQ/delivery unit/time validation | **PARTIAL SOURCE CHANGES COMMITTED; TEST PENDING** |
| B4-C | Allocation ledger, concurrency, no overselling | **AUDIT/IMPLEMENTATION PENDING** |
| B4-D | Atomic publishing and immutable terms | **AUDIT/IMPLEMENTATION PENDING** |
| B4-E | Tier price boundaries, progression, quantity units | **AUDIT/IMPLEMENTATION PENDING** |
| B4-F | Time/target close, qualification, supplier decisions | **AUDIT/IMPLEMENTATION PENDING** |
| B4-G | Buyer reservation, capacity, eligibility | **AUDIT/IMPLEMENTATION PENDING** |
| B4-H | Supplier/buyer frontend and statuses | **AUDIT/IMPLEMENTATION PENDING** |
| B4-I | Consolidated Antigravity acceptance | **NOT EXECUTED** |

Do not create a second pool engine, new parallel tables, or duplicate services. Preserve existing `poolController.js`, `poolRepo.js`, `poolProgressService.js`, `tierPricingService.js`, inventory allocations, existing historical Regular Pools and B0 financial safeguards.

## 3. Confirmed B4-A defects addressed

**Incorrect legacy FK conversion:** Existing `poolController.createPool` set `product_id = sku.family_id` when supplier used `supplier_sku_id` without explicitly providing product ID. These are different ID domains. This could give `PRODUCT_NOT_FOUND` or wrong physical product linkage. Now fetch the SKU's **immutable published specification**, validate owning supplier and SKU link/lifecycle, and set legacy `product_id = publishedSpec.product_id` instead. New test checks `pools.product_id` and `product_spec_id` against the actual linked spec.

**Physical-ID mismatch:** Previously client-provided `supplier_product_id` and `supplier_sku_id` could override the linked listing/spec identity. Now check supplied IDs against the authoritative spec and listing and reject `400 POOL_PHYSICAL_IDENTITY_MISMATCH`; save only authoritative physical IDs. Added negative test using a wrong existing supplier product ID.

## 4. Confirmed B4-B partial correction

Pool draft positive quantity fields and optional purchase increment/maximum capacity now pass `exactDecimal.toCanonical(..., 4)` validation and reject negative, nonfinite, exponential/malformed, out-of-range or more-than-four nonzero fractional digits before SQL. Returns `400 INVALID_POOL_DECIMAL` rather than relying on JavaScript `Number()` and silent MySQL rounding. Added negative regression for target `40.00001`.

**Still pending B4-B:** Audit all draft update/publish/price tiers/units and expected whole-pack increment behavior. New decimal guard is only at create boundary; do not imply end-to-end exactness until all affected mutations are tested.

## 5. Parallel B3 acceptance and corrections

B3 tests are currently being executed by Antigravity in a separate branch/worktree. Do not touch or reset that worktree. B4 source branch is based on pre-acceptance B3; after verified B3 completion:
1. Compare accepted B3 final SHA and B2 accepted SHA with B4 ancestry.
2. Reconcile new B2 `catalogService.js` corrections and accepted B3 fixes into B4 with reviewed Git operations.
3. Preserve B4 changes to `poolController.js` and B4 test cases.
4. Fix conflicts in original paths, run focused regression, update this report with actual integrated SHAs.
5. Never run B3 and B4 mutable tests concurrently against `miljor_test_db`.

## 6. B4 final acceptance gate (not yet authorized as PASS)

Use the smallest sufficient existing Regular Pool tests for B4-A–I and directly impacted E2/E3/B3 tests, plus one frontend build. Include:
- Supplier SKU-only pool creation resolves published spec and true legacy product FK.
- Spoofed supplier/product/SKU IDs rejected.
- Strict pool quantity precision, MOQ/capacity, indivisible pack increments, quantity unit conversion.
- Supplier verification/ownership and cross-supplier pool attempts.
- Draft editing vs publish race and published snapshot immutability even with zero reservations.
- Atomic inventory allocation and no double allocation across concurrent pools.
- Tier boundaries/gaps and progress/qualified quantity correctness.
- Time/target close, qualification and supplier decision transitions.
- Buyer eligibility, reservations and remaining capacity.
- Protected `miljor_db` never changed; test DB identity verified.

One consolidated gate with targeted reruns on defects. Report exact commands, exit codes, assertion counts, tested SHA, failures/fixes and protected DB evidence. Update `MILJOR_PHASE_LOG.md`; commit/push truthful source and evidence.

**B4 VERDICT: SOURCE IMPLEMENTATION IN PROGRESS — NO INTEGRATION PASS.**  
**CAN RELEASE OR START B5: NO.**
