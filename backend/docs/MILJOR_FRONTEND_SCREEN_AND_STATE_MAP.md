# MILJOR — FRONTEND SCREEN, ROUTE & STATE MAP
**Document ID:** `MILJOR-DOC-FE-034`  
**Stack:** React 19 + Vite + React Router (`http://localhost:3000`)  
**Status:** Production Baseline (`npm run build` verified with 0 errors)

---

## 1. Frontend Route Topology

| Route Path | Component | Access Guard | Key Functional Responsibilities |
|---|---|---|---|
| `/login`, `/register`, `/forgot-password` | Auth V2 Pages | Public / Guest | Cluster-first buyer registration, supplier registration, 6-digit OTP verification, and enumeration-safe password recovery with 60s cooldown timer |
| `/` / `/marketplace` | `MarketplacePage.jsx` | Public / Buyer | Location-aware pool discovery (`?cluster_id=X`), category & family filters, `PoolCard` with volume tier progress, participation cutoff, and promised delivery SLA badge |
| `/pools/:id` | `PoolDetailPage.jsx` | Public / Buyer | Full pool tier table, supplier verification badge, Lahore delivery clusters, promised delivery window, delivery quote calculator, and reservation checkout |
| `/supplier/onboarding` | `SupplierOnboardingPage.jsx` | `SUPPLIER` | Business profile editor, Pakistani NTN/phone/IBAN validation, masked IBAN status display, and verification submission |
| `/supplier/catalog` | `SupplierCatalogPage.jsx` | `SUPPLIER` | **Supplier Catalog & Product Studio:** Browse canonical categories/families, create Branded or Unbranded Supplier Products (optional grade), create/edit/publish/archive distinct `25kg`/`50kg` Physical SKUs, create Commercial Listings, and request missing Product Families |
| `/admin/catalog` | `AdminCatalogModerationPage.jsx` | `ADMIN` | Review pending supplier catalog requests (`NEW_FAMILY` / `NEW_VARIANT`), mark `UNDER_REVIEW`, approve into canonical catalog, or reject with mandatory reason |

---

## 2. Supplier Product & SKU Studio State Flow (`SupplierCatalogPage.jsx`)

1. **Tab 1 — Canonical Families & Approved Catalog:**
   - Filter by the 8 canonical categories and 13+ canonical product families.
   - Inspect measurement dimension (`MASS: kg, g` vs `VOLUME: L, mL`).
2. **Tab 2 — My Supplier Products & Physical SKUs:**
   - **Step A (Create Supplier Product):** Select Category & Family, toggle **Unbranded Wholesale Commodity** (`is_unbranded = true`, hiding brand input) or enter Brand name, enter Variety/Type, and optionally enter Quality Grade and Processing Method.
   - **Step B (Add Physical Packaging SKUs):** Attach one or more pack sizes (`25 kg PP Woven Bag`, `50 kg PP Woven Bag`, `16 L Tin`) with units dynamically restricted to the parent family's allowed units.
   - **Step C (Publish SKU & Create Listing):** Publish `DRAFT` SKUs (`PUBLISHED — Locked`) and launch commercial offers (`unit_price`, `min_order_qty`, `available_stock`, `lead_time_days`).
3. **Tab 3 — Request Missing Product Family:**
   - Focused governance form for submitting `NEW_FAMILY` requests when a canonical commodity family does not yet exist.

---

## 3. Pool Card & Delivery SLA Display (`PoolCard.jsx`)

- Displays product brand (`Unbranded` when `is_unbranded = 1`), variety, optional grade, and exact pack size (`25 kg`, `50 kg`, `16 L`).
- Displays participation cutoff (`scheduled_close_at` / `expires_at`) and, whenever `promised_delivery_at` is present, renders the **Promised Delivery SLA Badge** showing the exact supplier-committed delivery date and lead days (`1–3d SLA`).
