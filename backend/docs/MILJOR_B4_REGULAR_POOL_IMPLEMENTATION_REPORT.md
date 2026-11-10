# MILJOR — PHASE B4: REGULAR POOL INTEGRATION & LIFECYCLE HARDENING

**Date:** 2026-11-10  
**GitHub branch:** `feature/b4-regular-pools`  
**Starting Checkpoint SHA:** `6e4ccc18346cfd68d80e3b001e090b9e6df158f4`  
**Accepted upstream B2 SHA:** `fcbd82dafcb236f9cee980904ebddba5c1ab1999` — Antigravity 67/67 PASS  
**Accepted upstream B3 SHA:** `44f591d7fdd9c16f7a43c10d01de2b50bb637e7e` — Antigravity 81/81 PASS  
**B4 Ancestry:** Both B2 and B3 are verified Git ancestors of B4 (`git merge-base --is-ancestor` exit code 0).  
**CURRENT VERDICT:** **PASS — B4 COMPLETE ACCEPTANCE VERIFIED (266/266 Assertions PASS, Frontend Build 0 Errors, Protected DB 100% Pristine).**  
**NEXT PHASE:** B5 not authorized. Production release/merge-to-main not authorized.

---

## 1. Original Source Locations and Git/Local Parity

The repository code resides in original tracked `backend/src/controllers`, `backend/src/services`, `backend/src/repositories`, `backend/src/routes/v1`, `frontend/src/pages`, `frontend/src/api`, `backend/tests` and `backend/docs`.

Dedicated local worktree path: `C:\Users\Umar Jameel\OneDrive - Higher Education Commission\Documents\MilJor-B4` tracking `feature/b4-regular-pools`. Original B2 (`MilJor Project`) and B3 (`MilJor-B3`) worktrees remained intact.

---

## 2. B4 Subphase Acceptance Verification Matrix

| Subphase | Status | Verification & Evidence |
|---|---|---|
| **B4-A Pool identity/ownership** | **PASS** | SKU-only pool creation resolves legacy `products.id` from the published `product_specifications.product_id`, never from canonical `family_id`. Supplied product/SKU IDs cross-validated against listing/spec; mismatches return `POOL_PHYSICAL_IDENTITY_MISMATCH` (400). Verified in `package_e2_product_ownership_and_immutable_pools_gate.js` (assertions 11, B4-A). |
| **B4-B Draft quantities/schedules** | **PASS** | Exact DECIMAL(12,4) precision enforced via `exactDecimal.toCanonical`. Nonfinite, NaN, Infinity, and scale > 4 rejected with `INVALID_POOL_DECIMAL` (400). Positivity checks take precedence returning `INVALID_QUANTITY` (400) or `INVALID_CAPACITY` (400). Verified in `package_e2_product_ownership_and_immutable_pools_gate.js` and `part4b2_pool_creation_gate.js`. |
| **B4-C Inventory allocations/concurrency** | **PASS** | Publish atomically locks pool/listing rows and commits `supplier_inventory_allocations` in listing units. Units validated (`ALLOCATION_UNIT_MISMATCH` on mixed units). Row locking prevents concurrent over-allocation. Verified in `package_e2` and `part4b3_pool_publishing_gate.js`. |
| **B4-D Publish & immutable terms** | **PASS** | Publishing locks commercial terms, tier pricing, and 24–72h delivery SLA atomically. Published pools cannot be mutated or revert to DRAFT (`POOL_TERMS_IMMUTABLE` / `INVALID_POOL_STATE`). Verified in `part4b3_pool_publishing_gate.js` and `package_e2`. |
| **B4-E Price tier/progress** | **PASS** | Tier pricing validated by `tierPricingService`: non-monotonic pricing, tier gaps, and overlapping intervals rejected. Stepped intervals for discrete packs (`min_qty = prevMax + 1`) recognized as contiguous even with multi-unit increments. Verified in `b4_tier_decimal_contract_gate.js` (7/7 PASS). |
| **B4-F Closing/qualification/supplier decisions** | **PASS** | Qualification, supplier confirmation/rejection, and buyer commitment verified via authoritative `commercialLifecycleService`. Retired legacy confirm endpoint fails closed (`LEGACY_OPERATION_RETIRED`). Verified in `part4d2` (30/30 PASS), `part4d3` (28/28 PASS), and `part4d4` (21/21 PASS). |
| **B4-G Buyer reservations/units** | **PASS** | Buyer reservations enforce buyer MOQ, purchase increment, and indivisible custom packaging units (`bundle`, `bag`, `tin`). Conversion checks actual SKU purchasing unit. Capacity concurrency race safely serializes. Verified in `part4b4` (28/28 PASS), `part4c1` (50/50 PASS), and `b4_custom_pack_unit_gate.js` (4/4 PASS). |
| **B4-H Supplier/buyer UI** | **PASS** | Supplier catalog modal uses exact decimal strings, exposes purchase increment, restricts draft creation to ACTIVE listings, displays published SKU titles. Buyer pool progress reads supplier-owned physical SKU attributes. Frontend Vite build passed cleanly (2,216 modules, 0 errors). |
| **B4-I End-to-end acceptance** | **PASS** | All 11 relevant gate suites executed directly against `miljor_test_db`. Total 266/266 assertions passed with exit code 0. Protected database `miljor_db` verified 100% pristine. |

---

## 3. Defects Identified and Repaired During Acceptance

1. **Defect 1 — Quantity Validation Precedence in Pool Controller:**
   - *Symptom:* `part4b2_pool_creation_gate.js` assertion 12 failed with `INVALID_POOL_DECIMAL` instead of `INVALID_QUANTITY` when submitting zero or negative quantities (`target_qty: -10`).
   - *Root Cause:* In `poolController.js`, `exactDecimal.toCanonical` was throwing an out-of-range error on `<= 0` values before the standard `INVALID_QUANTITY` business validations executed.
   - *Fix:* Reordered validations in both `createPool` and `updateDraftPool` so that positivity checks (`parsedTarget <= 0`, `parsedSuppMin <= 0`, `parsedBuyerMin <= 0` -> `INVALID_QUANTITY`; `parsedMaxCap <= 0` -> `INVALID_CAPACITY`; `parsedIncrement <= 0` -> `INVALID_INCREMENT`) execute prior to `exactDecimal` scale/overflow checks.
   - *Result:* `part4b2_pool_creation_gate.js` passed 22/22 (100%).

2. **Defect 2 — Discrete Stepped Tier Continuity in Tier Pricing Engine:**
   - *Symptom:* `part4b4_buyer_reservation_gate.js` assertion 9 failed with `TIER_GAP_DETECTED` for discrete packaging (`bag`) with `purchase_increment = 5`, where Tier 1 max was 49 and Tier 2 min was 50.
   - *Root Cause:* In `tierPricingService.js`, B4 had replaced `isDiscrete ? prevMax + 1 : prevMax + increment` with `prevMax + increment`. For discrete units, stepping by 1 unit (`prevMax + 1`) is the standard discrete boundary regardless of the buyer purchase increment.
   - *Fix:* Allowed both `prevMax + increment` and `expectedContiguousMinC = isDiscrete ? prevMax + 1 : null` as valid contiguous intervals. Added regression assertion 7 in `b4_tier_decimal_contract_gate.js`.
   - *Result:* Both `part4b4_buyer_reservation_gate.js` (28/28 PASS) and `b4_tier_decimal_contract_gate.js` (7/7 PASS) passed completely.

3. **Defect 3 — Qualification Gate Helper Delivery SLA Compatibility:**
   - *Symptom:* `part4d2_pool_qualification_gate.js` failed to publish test pools because `promised_delivery_at` was missing from the test helper.
   - *Root Cause:* Package E2 introduced mandatory Rule P6/P7 (24-72h `promised_delivery_at` SLA required before publishing). `part4d2_pool_qualification_gate.js` test helper had not been updated with `promised_delivery_at`.
   - *Fix:* Added `promised_delivery_at: overrides.promised_delivery_at || new Date(new Date(expiresAt).getTime() + 48 * 3600 * 1000).toISOString()` to the test helper in `part4d2_pool_qualification_gate.js`.
   - *Result:* `part4d2_pool_qualification_gate.js` passed 30/30 (100%).

---

## 4. Test Execution & Assertion Summary (miljor_test_db)

| Test Suite File | Type / Focus | Assertions | Exit Code | Result |
|---|---|---|---|---|
| `tests/b4_tier_decimal_contract_gate.js` | Pure Fast Tier Gate | 7 / 7 | 0 | **PASS** |
| `tests/b4_custom_pack_unit_gate.js` | Pure Custom Pack Units | 4 / 4 | 0 | **PASS** |
| `tests/package_e2_product_ownership_and_immutable_pools_gate.js` | E2 Identity, SKU & Pools | 33 / 33 | 0 | **PASS** |
| `tests/package_e3_entitlements_and_supplier_portal_gate.js` | E3 Entitlements & Portal | 18 / 18 | 0 | **PASS** |
| `tests/part4b2_pool_creation_gate.js` | Pool Draft Creation & Rules | 22 / 22 | 0 | **PASS** |
| `tests/part4b3_pool_publishing_gate.js` | Pool Publishing & Tier Terms | 25 / 25 | 0 | **PASS** |
| `tests/part4b4_buyer_reservation_gate.js` | Buyer Reservations & Capacity | 28 / 28 | 0 | **PASS** |
| `tests/part4c1_reservation_mutations_gate.js` | Reservation Mutations & Expiry | 50 / 50 | 0 | **PASS** |
| `tests/part4d2_pool_qualification_gate.js` | Pool Qualification & Closure | 30 / 30 | 0 | **PASS** |
| `tests/part4d3_supplier_decision_gate.js` | Supplier Confirmation/Decision | 28 / 28 | 0 | **PASS** |
| `tests/part4d4_buyer_commitment_gate.js` | Buyer Final Commitment | 21 / 21 | 0 | **PASS** |
| **Total Test Suite Assertions** | **Consolidated Gate** | **266 / 266** | **0** | **PASS (100%)** |

Frontend Build: `npm --prefix frontend run build` — 2,216 modules transformed, 0 errors, exit code 0 (**PASS**).

---

## 5. Database Isolation Evidence

- **Active Test Database:** `miljor_test_db` verified via `SELECT DATABASE()`.
- **Protected Database (`miljor_db`) Baseline & Post-Test Verification:**
  - `users`: 8 (pre: 8, post: 8 — delta: 0)
  - `orders`: 0 (pre: 0, post: 0 — delta: 0)
  - `payments`: 0 (pre: 0, post: 0 — delta: 0)
  - `invoices`: 0 (pre: 0, post: 0 — delta: 0)
  - `pools`: 2 (pre: 2, post: 2 — delta: 0)
  - `reservations`: 0 (pre: 0, post: 0 — delta: 0)
- **Verdict:** `miljor_db` remained 100% pristine with zero mutations, leaked rows, or external calls.

---

## 6. Files Modified

- `backend/src/controllers/poolController.js` — Reordered quantity validations before exact decimal checks in `createPool` and `updateDraftPool`.
- `backend/src/services/tierPricingService.js` — Supported 1-unit discrete stepping (`prevMax + 1`) alongside increment stepping.
- `backend/tests/b4_tier_decimal_contract_gate.js` — Added assertion 7 for discrete-pack stepping with non-unit increments.
- `backend/tests/part4d2_pool_qualification_gate.js` — Added mandatory E2 delivery SLA timestamp to test helper.
- `backend/docs/MILJOR_B4_REGULAR_POOL_IMPLEMENTATION_REPORT.md` — Updated with complete acceptance evidence.
- `backend/docs/MILJOR_PHASE_LOG.md` — Updated Phase B4 status to COMPLETE AND VERIFIED.

---

## 7. Final Verdict

- **B4 Acceptance Status:** **PASS (266/266 Assertions PASS, Frontend Build PASS)**
- **B5 Parallel Development:** `feature/b5-flash-pools` remained completely untouched.
- **Can Accept B4:** **YES**
- **Can Start B6:** **NO**
