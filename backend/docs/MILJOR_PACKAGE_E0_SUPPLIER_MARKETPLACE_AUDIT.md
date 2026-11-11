# MILJOR — PACKAGE E0: SUPPLIER MARKETPLACE FOUNDATION AUDIT
## Comprehensive Architectural, Database, API, and Frontend Audit for the MilJor B2B Supplier Experience

**Project:** MilJor — Lahore-first B2B Collective Food Procurement Marketplace  
**Authority:** Principal Software Architect, Senior Full-Stack Engineer, MySQL Database Architect, Security Engineer, QA Lead  
**Package:** Package E0 — Audit & Implementation Readiness  
**Target Market:** Lahore District Only  
**Protected Database:** `miljor_db` (`localhost:3306`) — Migration 031 ACTIVE — **100% READ-ONLY (0 Mutations)**  
**Isolated Test Target:** `miljor_test_db` — Read-only verification  
**Date:** November 10, 2026  
**Status:** **AUDIT COMPLETE (GATE: PASS)**

---

## 1. Executive Summary

Package E marks the transition to a fully functional, production-ready Supplier Marketplace for MilJor in Lahore District. Before implementing Package E1, this Package E0 Foundation Audit establishes a complete, evidence-based inventory of existing supplier-related backend services, database schemas, frontend components, and dependencies.

### Key Audit Findings:
1. **Solid Backend Engine Already Exists:** Substantial supplier-related backend infrastructure was successfully implemented in earlier phases (Parts 3, 4B, 4D.3, 4E.4, 4E.6, G2.2). This includes specification normalization, decoupled supplier offers, atomic pool creation/publishing, commercial decisions (ACCEPT/REJECT), fulfillment milestone transitions, supplier payables, and cluster-based delivery rate configurations.
2. **Major Frontend Void:** Despite working backend APIs, the frontend currently has **zero** dedicated supplier pages or workflows. `App.jsx` mounts only buyer-facing views (`/`, `/pools`, `/orders`, `/profile`, auth pages). Suppliers can log in, but are redirected to buyer views with only a single delivery settings tab on `ProfilePage.jsx`.
3. **Product Family vs. Variant Hierarchy is Structurally Sound:** The database schema already accurately separates Product Families (`products`) from Physical Specifications/Variants (`product_specifications`) and Commercial Offers (`supplier_listings`). However, product-family level entitlement enforcement (Free 4, Growth 13, Pro 25) is currently absent in the controller layer.
4. **Supplier Profile & Document Verification Gaps:** Currently, suppliers can only register with initial default values or have admins manually update them via `adminController.verifySupplier`. There are no supplier-facing endpoints to update business profiles, upload trade/food licenses, enter bank/settlement details, or monitor verification progress.
5. **Database Baseline:** `miljor_db` contains 50 tables, 31 migrations applied, 11 products, 16 specifications, 3 active listings, and 4 supplier profiles. Zero database modifications were performed during this audit.

---

## 2. Feature Matrix: Implemented vs. Partial vs. Missing

| Package Module | Current State | Implementation File Evidence | Status | Reusability / Notes |
| :--- | :--- | :--- | :--- | :--- |
| **E1: Profile & Verification** | **PARTIAL** | Backend: `authController.register` (lines 448-465), `authController.applyForSupplier` (lines 700-750), `adminController.verifySupplier` (lines 43-110).<br>Frontend: Zero dedicated screens; single delivery tab on `ProfilePage.jsx`. | **PARTIAL** | **High.** Reuse `supplier_profiles` table and `adminController` verification workflow. Needs dedicated supplier profile endpoints & UI. |
| **E2: Catalog Architecture** | **IMPLEMENTED (Backend)**<br>**MISSING (Requests)** | Backend: `products` table (11 seeded products), `product_specifications` table (16 seeded specs), `productController.js`, `specificationService.js`, `productSpecificationRepo.js`.<br>Frontend: `productsApi` client exists; no supplier selection UI. | **PARTIAL** | **High.** Category → Family → Variant taxonomy already works. Needs admin-controlled product request table/API (`catalog_requests`). |
| **E3: Product Entitlements (4, 13, 25)** | **MISSING** | Backend: `supplier_profiles.subscription_plan` exists as enum(`STARTER`,`GROWTH`,`BUSINESS`) with `max_active_listings` (5, 25, 75).<br>Zero enforcement of distinct family counts in `supplierListingController.js`. | **MISSING** | **High.** Requires middleware/service to count distinct `ps.product_id` across active listings and block 5th/14th/26th families. |
| **E4: Listing Management** | **IMPLEMENTED (Backend)**<br>**MISSING (Frontend)** | Backend: `supplierListingController.js`, `supplierListingRepo.js`, `listingRoutes.js` (create, update, pause, stock, MOQ, price history).<br>Frontend: `productsApi.js` exists; zero UI pages. | **PARTIAL** | **High.** Backend CRUD is tested (Part 3 Gate: 15/15 PASS). Needs frontend supplier listing management UI and product image support. |
| **E5: Supplier Dashboard** | **MISSING** | Backend: No consolidated dashboard route (`GET /api/v1/supplier/dashboard`).<br>Frontend: No supplier dashboard page. | **MISSING** | **Medium.** Can aggregate from `supplier_listings`, `pools`, `orders`, and `supplier_payables`. |
| **E6: Regular Pool Workflow** | **IMPLEMENTED (Backend)**<br>**MISSING (Frontend)** | Backend: `poolController.js`, `poolRoutes.js`, `tierPricingService.js`, `commercialLifecycleService.js`, `part4d3_supplier_decision_gate.js` (22/22 PASS).<br>Frontend: No supplier pool creation or confirmation UI. | **PARTIAL** | **High.** Full backend commercial state machine is production-grade. Needs dedicated supplier management UI. |
| **E7: Supplier Promotions** | **MISSING** | Zero tables, zero routes, zero UI. | **MISSING** | **None.** New capability scheduled for Phase E7. |
| **E8: Reviews & Ratings** | **MISSING** | Zero tables, zero routes, zero UI. | **MISSING** | **None.** New capability scheduled for Phase E8. |
| **E9: Orders & Settlement** | **IMPLEMENTED (Backend)**<br>**MISSING (Frontend)** | Backend: `fulfillmentController.js`, `fulfillmentService.js`, `financialSettlementController.js`, `supplierDeliveryController.js`, `part_g2_delivery_integration_gate.js`.<br>Frontend: No supplier order management UI. | **PARTIAL** | **High.** Post-payment fulfillment and supplier payables already exist and pass regression. Needs supplier order views. |
| **E10: Integration & E2E** | **NOT STARTED** | Final regression and multi-viewport browser acceptance. | **DEFERRED** | Scheduled for Package E10. |

---

## 3. Database Compatibility Map

### Existing Applied Tables (Migration 001–031 Active)
- `users`: Core identity table with `role = 'SUPPLIER'`, `is_verified`, `verification_status`.
- `supplier_profiles`: Anchored by `supplier_id` (1:1 with `users.id`). Columns: `verification_level`, `verification_status`, `subscription_plan`, `max_active_listings`, `transaction_fee_percent`, `tax_ntn`, `food_license_no`.
- `products`: Product Family level (`id`, `title`, `category`, `brand`, `variety`, `processing_type`, `grade`, `pack_size`, `unit`, `is_active`).
- `product_specifications`: Physical Variant level (`id`, `product_id`, `spec_code`, `title`, `spec_hash`, `is_active`, packaging, pack size).
- `supplier_listings`: Commercial Offer level (`id`, `listing_code`, `supplier_id`, `product_spec_id`, `available_stock`, `base_unit_price`, `supplier_min_qty`, `buyer_min_qty`, `status`).
- `supplier_listing_price_history`: Immutable price change audit trail.
- `supplier_delivery_configurations`: Standard delivery, express cutoff, and pickup toggles per supplier.
- `supplier_delivery_cluster_rates`: Clustered delivery fee matrix per supplier across Lahore's 12 geographic clusters.
- `supplier_pickup_points`: Verified warehouse and physical pickup points.
- `supplier_payables`: Authoritative settlement payables and disbursement readiness.

### Migration Requirements for Package E:
To support Package E without breaking existing data or constraints:
1. **Migration 032 (Recommended for E1):**
   - Enhance `supplier_profiles` with operational fields:
     - `business_registration_no` (varchar(100), NULL)
     - `bank_name` (varchar(100), NULL)
     - `bank_account_title` (varchar(150), NULL)
     - `bank_iban` (varchar(50), NULL)
     - `warehouse_address` (text, NULL)
     - `contact_person_name` (varchar(100), NULL)
     - `contact_person_phone` (varchar(20), NULL)
     - `rejection_reason` (text, NULL)
     - `submitted_at` (timestamp, NULL)
     - `verified_at` (timestamp, NULL)
   - Preserve existing records (`supplier_profiles` rows 1, 2, 3, 13) with zero data loss.
2. **Migration 033 (Recommended for E2/E3):**
   - Add `catalog_requests` table for supplier-requested product families / custom variants.
   - Align `subscription_plan` enum to include `FREE_4`, `GROWTH_13`, `PRO_25` while maintaining aliases for `STARTER`, `GROWTH`, `BUSINESS`.

---

## 4. Subscription & Catalog Model Analysis (Free 4, Growth 13, Pro 25)

### A. Four-Tier Catalog Hierarchy
```
Category (e.g., Grains & Rice)
   └── Product Family (products.id, e.g., Basmati Rice Premium)
         └── Product Specification / Variant (product_specifications.id, e.g., SPEC-RICE-SB-001)
               └── Supplier Listing / Offer (supplier_listings.id, e.g., LST-2026-1042)
```

### B. Entitlement Formula
The business rule states that subscriptions limit **Active Product Families**, not individual variants or total offers:
$$\text{Active Family Count} = \text{COUNT}(\text{DISTINCT } ps.product\_id) \text{ WHERE } sl.supplier\_id = ? \text{ AND } sl.status = 'ACTIVE'$$

| Package | Active Product Families | Maximum Variants per Family | Transaction Fee | Safe Defaults |
| :--- | :---: | :---: | :---: | :--- |
| **Free** | 4 | Unlimited (or capped at 10) | 2.50% | Default for all new registered suppliers |
| **Growth** | 13 | Unlimited (or capped at 15) | 1.50% | Verified mid-scale wholesale distributors |
| **Pro** | 25 | Unlimited (or capped at 25) | 1.00% | Enterprise millers and high-volume suppliers |

### C. Edge Case & Concurrency Analysis
1. **Simultaneous Requests Race Condition:**
   - *Problem:* A Free tier supplier with 3 active families sends two simultaneous requests to create listings in Family 4 and Family 5. If both read `count = 3` before inserting, both commit, yielding 5 active families (exceeding entitlement).
   - *Solution:* Execute listing creation/activation inside a database transaction with an exclusive lock on the supplier profile:
     `SELECT subscription_plan FROM supplier_profiles WHERE supplier_id = ? FOR UPDATE`.
     Compute the distinct active product family count under this lock before admitting the new listing.
2. **Subscription Downgrades:**
   - *Problem:* Supplier downgrades from Pro (25) to Free (4).
   - *Safe Rule:* Existing listings are **never deleted or automatically unlisted**. Existing active listings continue operating, but the supplier is strictly blocked from creating new listings or activating paused listings until their active count is $\le 4$.
3. **Paused vs. Out of Stock vs. Archived:**
   - `PAUSED`: Does NOT consume an active family slot if all listings in that family are paused. This allows seasonal rotation.
   - `OUT_OF_STOCK`: Consumes a slot if `status = 'ACTIVE'` with stock = 0, but if marked `OUT_OF_STOCK`, policy should treat it as non-active.
   - `ARCHIVED`: Soft-deleted; never consumes an entitlement slot.
4. **Undecided Business Rules Marked for Product Sign-Off:**
   - *Question 1:* Should there be a hard cap on variants per product family (e.g. max 10 variants), or completely unlimited?
   - *Question 2:* Does an active Regular Pool keep a product family "locked" as active even if the underlying listing is paused? (Recommended: YES, to protect ongoing buyer reservations).

---

## 5. Frontend-Backend Integration Map

```
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│     EXISTING BACKEND APIS       │                 │     EXISTING FRONTEND STATE     │
├─────────────────────────────────┤                 ├─────────────────────────────────┤
│ POST /auth/register (SUPPLIER)  │  ◄────────────  │ RegisterPage.jsx (Role dropdown)│
│ GET  /auth/me (Returns profile) │  ◄────────────  │ ProfilePage.jsx (Delivery tab)  │
│ GET  /listings/me               │      [GAP]      │ No Listing Management Page      │
│ POST /listings                  │      [GAP]      │ No Listing Creation Form        │
│ PUT  /listings/:id              │      [GAP]      │ No Listing Edit Form            │
│ PATCH /listings/:id/status      │      [GAP]      │ No Listing Status Toggle UI     │
│ GET  /pools/supplier/my         │      [GAP]      │ No Supplier Pools Dashboard     │
│ POST /pools/:id/supplier-decision│     [GAP]      │ No Supplier Pool Acceptance UI  │
│ GET  /fulfillment/supplier/orders│     [GAP]      │ No Supplier Orders Page         │
│ GET  /settlements/payables/sup..│      [GAP]      │ No Supplier Earnings UI         │
│ GET  /supplier/delivery-settings│  ◄────────────  │ SupplierDeliverySettingsForm.jsx│
└─────────────────────────────────┘                 └─────────────────────────────────┘
```

---

## 6. Critical Technical & Security Risks

1. **Self-Verification & Role Escalation:**
   - *Finding:* `adminController.verifySupplier` prevents self-verification (`adminId === supplierId`).
   - *Requirement:* Ensure supplier profile update endpoints in E1 strictly prevent modifying `verification_status` or `subscription_plan` from client payloads. Only administrative routes may alter those fields.
2. **Catalog Integrity & Unapproved Products:**
   - *Finding:* Suppliers must not inject unapproved commodities into existing product families.
   - *Requirement:* Listing creation must only reference validated, active `product_spec_id` rows verified by `productSpecificationRepo.findById`.
3. **Price and Inventory Immutability:**
   - *Finding:* Updating listing price in `supplierListingController.updateListing` records history in `supplier_listing_price_history`.
   - *Requirement:* When a Regular Pool is active (`status = 'ACTIVE'`), listing price changes must **not** disrupt active pool tier price schedules or locked buyer prices.
4. **Tenant Data Isolation:**
   - *Finding:* Suppliers must never see other suppliers' payables, warehouse notes, or unlisted pricing.
   - *Requirement:* All supplier queries must be scoped to `req.user.id` at the database query layer.

---

## 7. Package E Dependency Order Verification

The approved Package E sequence was audited for architectural soundness:
- **E0 (Audit):** Prerequisite to all phases. **[ACTIVE]**
- **E1 (Profile & Verification):** Must precede listing creation because unverified suppliers cannot publish (`requireVerifiedSupplier`).
- **E2 (Catalog Architecture):** Must precede listing creation to establish category, family, and variant relationships.
- **E3 (Entitlements):** Must precede listing management so listing creation enforces Free 4, Growth 13, and Pro 25 caps.
- **E4 (Listing Management):** Prerequisite to dashboard, pools, and fulfillment.
- **E5 (Dashboard):** Aggregates data from E1, E3, and E4.
- **E6 (Regular Pool Workflow):** Uses listings created in E4 and profiles from E1.
- **E7 (Promotions) & E8 (Reviews):** Value-add modules building upon active listings and completed pools.
- **E9 (Orders & Settlement):** Connects orders to supplier payables and fulfillment.
- **E10 (Final E2E & Closure):** Final comprehensive acceptance.

**Verdict on Sequence:** The proposed sequence `E0 → E1 → E2 → E3 → E4 → E5 → E6 → E7 → E8 → E9 → E10` is **completely safe, logically sound, and optimal**. No reordering is necessary.

---

## 8. Detailed E1 Implementation Plan (Supplier Business Profile, Onboarding & Verification)

### A. Scope
Implement dedicated supplier business profile management, document upload metadata, onboarding status tracking, and verification workflows without altering existing buyer or admin logic.

### B. Files to Create / Modify
1. **Database Migration:**
   - `backend/database/migrations/032_supplier_profile_onboarding_and_verification.sql`:
     - Adds `bank_name`, `bank_account_title`, `bank_iban`, `warehouse_address`, `contact_person_name`, `contact_person_phone`, `submitted_at`, `verified_at` to `supplier_profiles`.
   - Corresponding rollback script: `032_rollback_supplier_profile_onboarding_and_verification.sql`.
2. **Backend Services & Repositories:**
   - Create `backend/src/repositories/supplierProfileRepository.js`:
     - `findBySupplierId(supplierId)`
     - `updateProfile(supplierId, profileData)`
     - `submitForVerification(supplierId)`
     - `getVerificationTimeline(supplierId)`
   - Create `backend/src/services/supplierProfileService.js`:
     - Business validation: Pakistani IBAN format (`PK...`), NTN format, phone format.
     - Verification lifecycle state machine transitions (`NOT_SUBMITTED` → `PENDING_REVIEW` → `VERIFIED` / `MORE_INFORMATION_REQUIRED`).
3. **Backend Controller & Routes:**
   - Create `backend/src/controllers/supplierProfileController.js`:
     - `getProfile`: Fetch profile with verification badge and onboarding completeness.
     - `updateProfile`: Update business, bank, warehouse, and contact details.
     - `submitVerification`: Submit business credentials for admin review.
     - `getVerificationStatus`: Real-time status for the onboarding banner.
   - Mount under `backend/src/routes/v1/supplierRoutes.js` (or extend `supplierDeliveryRoutes.js` to a unified `supplierRoutes.js`).
4. **Frontend Implementation:**
   - Create `frontend/src/api/supplier.js`: Client for supplier profile and verification APIs.
   - Create `frontend/src/pages/SupplierProfilePage.jsx` (or enhance `ProfilePage.jsx` with dedicated Supplier Business Profile tab).
   - Component: `SupplierVerificationBadge.jsx` (displays `NOT_SUBMITTED`, `PENDING_REVIEW`, `VERIFIED`, `REJECTED`).
   - Component: `SupplierOnboardingWizard.jsx` (clean multi-step or tabbed business profile editor).
   - Route registration in `frontend/src/App.jsx`.
5. **Testing Suite:**
   - Create `backend/tests/package_e1_supplier_profile_gate.js`:
     - Profile fetch with authorization.
     - Profile update with validation (NTN, IBAN, contact).
     - State transition to `PENDING_REVIEW`.
     - Prevention of self-verification.
     - Admin verification review and approval.
     - Development database isolation proof.

---

## 9. Definitive E0 Audit Gate Verdict

- **E0 Gate Status:** **PASS**
- **Existing System Audit:** Complete & Factually Documented.
- **Database Safety:** `miljor_db` remains 100% untouched.
- **Readiness for E1:** **YES — Ready to proceed with Package E1 upon user instruction.**
