# MILJOR — PACKAGE E2: CANONICAL CATALOG ARCHITECTURE & MODERATION SPECIFICATION

> **B1 ARCHITECTURE UPDATE — historical E2 reference only.** This document records the original migration-033 four-level platform-approved-variant workflow for compatibility. **It is no longer authoritative for newly created supplier physical products.** The active six-level supplier-owned architecture is documented in `MILJOR_PRODUCT_CATALOG_AND_SKU_ARCHITECTURE.md` and the B1 implementation report. Existing `product_specifications` records remain as a compatibility bridge. Admin controls categories/families; suppliers define their own products, brands, grades, packaging and any valid pack quantity. Historic `NEW_VARIANT` endpoints are retained for backward compatibility and must not be presented as a required supplier onboarding step.


**Document Version:** 1.0 (Package E2 Authoritative Reference)  
**Date:** 2026-11-10  
**Branch:** `feature/package-e`  
**Migration:** `033_canonical_catalog_and_moderation.sql`

---

## 1. Canonical Four-Level Catalog Hierarchy

MilJor enforces a strict four-level canonical catalog hierarchy so that buyers can compare multiple verified suppliers side-by-side on identical physical specifications, and Package E3 can enforce subscription entitlements on distinct active Product Families:

```
LEVEL 1: CANONICAL CATEGORY (catalog_categories)
   └── LEVEL 2: CANONICAL PRODUCT FAMILY (catalog_product_families)
          └── LEVEL 3: APPROVED PHYSICAL VARIANT / SPECIFICATION (product_specifications)
                 └── LEVEL 4: SUPPLIER COMMERCIAL OFFER / LISTING (supplier_listings)
```

### Level Responsibilities
1. **Level 1 — Canonical Category (`catalog_categories`):**
   - Platform-governed top-level food & beverage procurement categories (8 initial categories: `Grains & Rice`, `Cooking Oils & Ghee`, `Flour & Milling Products`, `Pulses & Legumes`, `Sugar & Sweeteners`, `Spices & Seasonings`, `Tea & Beverages`, `Bakery Ingredients`).
2. **Level 2 — Canonical Product Family (`catalog_product_families`):**
   - Represents the core commodity family (e.g., `Rice`, `Cooking Oil`, `Banaspati Ghee`, `Chakki Atta`, `Maida`, `Besan`, `Daal Chana`, `Daal Masoor`, `Daal Moong`, `Daal Mash`, `Kabuli Chana`, `Sugar`, `Gur / Jaggery`).
   - Defines `allowed_pack_units`, `allowed_purchasing_units`, and `required_attributes`.
   - **Package E3 Entitlement Unit:** Supplier subscription slot caps (`STARTER = 4`, `GROWTH = 13`, `BUSINESS = 25`) count `COUNT(DISTINCT family_id)` across a supplier's active offers, while allowing unlimited physical variants under each counted family.
3. **Level 3 — Approved Physical Variant (`product_specifications`):**
   - Defines an exact, deduplicated physical SKU (`brand`, `variety`, `crop_year`, `processing_method`, `quality_grade`, `packaging_type`, `pack_size`, `pack_unit`, `purchasing_unit`, `spec_attributes`, `spec_hash`).
   - Linked via foreign keys to `category_id`, `family_id`, and `product_id`.
4. **Level 4 — Supplier Commercial Offer (`supplier_listings`):**
   - Links a verified supplier (`supplier_id`) to an `APPROVED` physical variant (`product_spec_id`) with commercial terms (`base_unit_price`, `available_stock`, `buyer_min_qty`, `supplier_min_qty`, `delivery_fee_policy`, `fulfilment_lead_time_days`).

---

## 2. Legacy Reconciliation & Zero-Breakage Mapping

All 11 historical rows in `products` and all 16 historical rows in `product_specifications` are preserved without altering their primary keys, `spec_hash` values, or legacy `products.category` strings:

| Historical `products.id` | Historical Title | Canonical Category (`category_id`) | Canonical Family (`family_id`) | Mapping Status |
| :--- | :--- | :--- | :--- | :--- |
| `1` | Basmati Rice Premium | `1` (`Grains & Rice`) | `1` (`Rice`) | `MAPPED_CANONICAL` |
| `6` | Non-Basmati Rice | `1` (`Grains & Rice`) | `1` (`Rice`) | `CONSOLIDATED_INTO_FAMILY` |
| `3` | Canola Cooking Oil | `2` (`Cooking Oils & Ghee`) | `2` (`Cooking Oil`) | `MAPPED_CANONICAL` |
| `7` | Commercial Cooking Oil | `2` (`Cooking Oils & Ghee`) | `2` (`Cooking Oil`) | `CONSOLIDATED_INTO_FAMILY` |
| `9` | Banaspati Ghee | `2` (`Cooking Oils & Ghee`) | `3` (`Banaspati Ghee`) | `MAPPED_CANONICAL` |
| `2` | Chakki Atta Wheat Flour | `3` (`Flour & Milling Products`) | `4` (`Chakki Atta`) | `MAPPED_CANONICAL` |
| `10` | All-Purpose Maida Flour | `3` (`Flour & Milling Products`) | `5` (`Maida`) | `MAPPED_CANONICAL` |
| `8` | Chana Dal | `4` (`Pulses & Legumes`) | `7` (`Daal Chana`) | `MAPPED_CANONICAL` |
| `5` | Masoor Dal Red Lentil | `4` (`Pulses & Legumes`) | `8` (`Daal Masoor`) | `MAPPED_CANONICAL` |
| `11` | Kabuli Chickpeas (White Chana) | `4` (`Pulses & Legumes`) | `11` (`Kabuli Chana`) | `MAPPED_CANONICAL` |
| `4` | Refined White Sugar | `5` (`Sugar & Sweeteners`) | `12` (`Sugar`) | `MAPPED_CANONICAL` |

Additionally, `Besan` (`family_id = 6`), `Daal Moong` (`family_id = 9`), `Daal Mash` (`family_id = 10`), and `Gur / Jaggery` (`family_id = 13`) are seeded as distinct canonical families. **Sugar (`family_id = 12`) and Gur / Jaggery (`family_id = 13`) are strictly separate product families.**

---

## 3. Moderated Catalog Governance & State Machine

- Direct supplier creation on `POST /api/v1/products` and `POST /api/v1/specifications` is blocked with `403 DIRECT_CATALOG_CREATION_PROHIBITED`.
- Suppliers submit `NEW_FAMILY` or `NEW_VARIANT` requests via `POST /api/v1/catalog/requests`.
- Requests transition through:
  - `DRAFT` → `SUBMITTED` → `UNDER_REVIEW` → `APPROVED` or `REJECTED`
  - `REJECTED` → `SUBMITTED` (when edited and resubmitted by the owning supplier via `PUT /api/v1/catalog/requests/:id`).
- Every transition is durably recorded in `catalog_moderation_logs`.
