# MilJor — Phase B2 Supplier Product/SKU Lifecycle Implementation & Parallel B3 Handoff

**Date:** 2026-11-10  
**Repository:** `umarjameel12/miljor-b2b-marketplace`  
**Implementation branch:** `feature/package-e`  
**B1 accepted base SHA:** `db936848753f9dde0014ac968d0e500e6648edc6`  
**B1 evidence:** 73/73 relevant assertions PASS; `miljor_test_db` isolation and unmodified `miljor_db` reported by Antigravity.  
**B2 source checkpoint (before documentation):** `3aa62690db61d03aa6e126cb8ce02567aa09b83a`  
**Current B2 state:** **CORE IMPLEMENTATION COMMITTED; LOCAL DB/API/FRONTEND ACCEPTANCE PENDING.**  
**B2 final gate:** NOT RUN. **Do not claim COMPLETE AND VERIFIED.**  
**B3:** Implementation may proceed **in parallel with B2 acceptance only in an isolated branch**, without treating unverified B2 behavior as accepted. No B3 release/merge until dependent B2 tests pass.

## 1. Business scope: B2-Core versus B2-Media

B2-Core completes and hardens the **existing** E2/B1 supplier-owned product and physical SKU lifecycle, without inventing a second product engine or editing existing customer orders/pool terms. MilJor owns only categories and families; supplier owns varieties, optional brand/grade, crop/origin, description, pack format/size/units and optional storage/shelf-life. The subscription cap continues to count **distinct active families (4/13/25)**, not SKUs or listings.

**B2-Media (separate dependency-gated workstream, not implemented/verified):** Authenticated product image uploads and durable safe storage have no existing provider or upload middleware in the audited Express backend (`backend/package.json` does not include a multipart image library). Do **not** silently accept unsafe external URLs, write unvalidated files to public webroot, or pretend image uploads are implemented. Before activation, choose a supported durable storage backend and implement file signature/MIME validation, size limits, ownership, malware/image safety review where necessary, private-to-public publish policy, safe retrieval, deletion/orphan cleanup and lifecycle tests. This is separately tracked and **not evidence of B2-Core acceptance**. B3 commercial offer work can proceed independently because it does not require new image infrastructure.

## 2. Concrete B2-Core code changes committed

- `backend/src/services/catalogService.js`:
  - Reject DRAFT parent-family change with any existing child SKU (`409 PRODUCT_FAMILY_HAS_SKUS`), rather than corrupt the SKU's independently stored family/category IDs.
  - Validate target category approval and update the family-specific legacy base-product FK when a SKU-less draft product is reclassified.
  - Wrap SKU creation in a transaction and lock the parent supplier product `FOR UPDATE` so SKU creation cannot race product reclassification or archival; preserve duplicate hash/unit validations.
  - Validate supplier-defined purchasing unit (required, max 30 characters) and optional shelf-life (positive integer, 1–36500 days; `400 INVALID_SHELF_LIFE` otherwise); do not manufacture shelf-life defaults.
  - Refuse supplier product/SKU archival while a related non-terminal Regular Pool exists (`409 ACTIVE_POOL_ARCHIVE_BLOCKED`), checking pool connections both through supplier listing and specification bridge. Normal pool lifecycle must resolve obligations first.
  - On parent archive, archive child SKUs, mark their supplier-owned `product_specifications` bridges `ARCHIVED`, and archive applicable active supplier listings. Preserve all historical rows and committed pool/order snapshots.
  - On SKU archive, scope listing deactivation to the owning supplier and retire that physical SKU's bridge. Never touch other suppliers' listings.
- `frontend/src/pages/SupplierCatalogPage.jsx`:
  - Expose editable optional supplier crop year, origin and product description. Supplier SKU form now sends actual packaging specification, storage requirements and optional shelf-life to existing supported backend fields.
  - Add explicit product/SKU archive confirmation with clear guidance that open pools block archiving.
  - Correct previously blank product and SKU titles: repository returns `title`, `product_title` and physical SKU pack fields, not synthetic `display_title` or `sku_title`.
  - Preserve existing supplier-defined brand/grade, variable pack quantities/units, publish & lock flow, active family quota UI and price/stock delegation to commercial listings.
- `backend/tests/package_e2_product_ownership_and_immutable_pools_gate.js`:
  - Added assertions that parent family cannot change once child SKUs exist; SKU/product archive is blocked for an open Regular Pool; negative SKU shelf-life/unit validation; published no-pool SKU archive retires its legacy specification bridge.
  - This gate's new cases are **committed source, not yet locally executed**.

## 3. Existing functionality intentionally reused

`catalog_categories`, `catalog_product_families`, `supplier_products`, `supplier_skus`, `product_specifications` historical bridge, `supplier_listings`, E3 family quotas, publisher verification, published identity immutability, legacy pool snapshots, product comparability, and authorization checks. No new DB migration and no existing IDs/data rewritten by GitHub-only work.

## 4. Remaining verification / acceptance instructions (Antigravity, one fast phase-end gate)

1. Safely sync the exact approved `feature/package-e` HEAD into **original local files** (B0–B1 accepted historical code as well as B2 edits). Preserve dirty work; no force reset.
2. Verify DB identity `SELECT DATABASE() = 'miljor_test_db'` before test mutations; protected `miljor_db` before/after row-count baseline.
3. Run a **single relevant set**, starting `node tests/package_e2_product_ownership_and_immutable_pools_gate.js`; add `node tests/package_e3_entitlements_and_supplier_portal_gate.js` for quota regression and directly impacted listing/pool tests only as necessary. Frontend build once. Avoid full B0 reruns or redundant master suites.
4. Verify negative cases: no family change after SKUs, no fake attributes, draft edits, published identity lock, duplicate SKU rejection, arbitrary supplier sizes, invalid shelf-life/purchasing unit, archive blocked by open pools, unused published SKU archive retires linked specification, cross-supplier ownership, checkout/pool historical integrity and no cross-supplier listing mutations.
5. Investigate any SQL deadlock/lock-order conflict through **targeted tests**; no false PASS or duplicate broad suites.
6. Record exact commands, exit codes, assertion counts, before/after DB counts, tested SHA, source paths, outstanding issues and gate outcome here and in `backend/docs/MILJOR_PHASE_LOG.md`; commit/push factual evidence to the approved branch.

**B2-Core acceptance:** PASS/FAIL/BLOCKED based only on actual execution. Product media remains an explicitly separate B2-Media workstream; do not claim it has been tested.

## 5. Parallel B2 test + B3 implementation contract (user-authorized)

- **Frozen B2 acceptance input:** commit/branch SHA saved in this report and phase log. Antigravity checks/tests **B2 code on `feature/package-e`**; it must not inadvertently test uncommitted B3 changes.
- **B3 working branch:** `feature/b3-commercial-offers`, created from frozen B2 implementation source, with B3's independent commercial listing/offer and entitlement work only. Do not directly modify `feature/package-e` from B3 work while B2 tests run.
- **If B2 requires a correction:** apply and test the correction on B2 branch, then deliberately cherry-pick/rebase the accepted fix into B3 after B2 PASS, checking conflicts and API contracts. Never silently overwrite either worktree.
- **Verification gates:** B2 PASS is prerequisite for integrating/deploying dependent B3 changes; B3 implementation alone is not B3 acceptance. No force push, main merge, protected DB changes or B4 start.
- **Separate evidence:** Each branch keeps its own phase report and phase log updates; merge/reconcile documentation intentionally after verification, not by blind overwrite.

## 6. Final state

**B1: COMPLETE AND VERIFIED (reported 73/73 PASS).**  
**B2-CORE: IMPLEMENTED IN SOURCE — PENDING ANTIGRAVITY ACCEPTANCE.**  
**B2-MEDIA: NOT IMPLEMENTED — STORAGE DECISION/SAFE UPLOAD WORK REQUIRED.**  
**B3: SEPARATE FUTURE IMPLEMENTATION BRANCH; NO IMPLEMENTATION YET.**  
**CAN DECLARE B2 FULLY COMPLETE: NO.**  
**CAN START B3 ON AN ISOLATED BRANCH WHEN USER CONTINUES: YES, implementation-only by explicit user authorization; no merge/release until applicable B2 gate PASS.**
