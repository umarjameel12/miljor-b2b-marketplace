# MILJOR — API CONTRACT & ERROR CODE REFERENCE (`/api/v1`)
**Document ID:** `MILJOR-DOC-API-034`  
**Base URL:** `http://localhost:5000/api/v1`  
**Active Migration:** `034_supplier_owned_products_skus_and_immutable_pools.sql`

---

## 1. Supplier Onboarding & Admin Verification Endpoints (Package E1)

| Method | Endpoint | Auth / Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/supplier/profile` | `SUPPLIER` | Retrieve authenticated supplier's profile with `bank_iban_masked` |
| `PUT` | `/api/v1/supplier/profile` | `SUPPLIER` | Save draft or update supplier business profile (validates PK phone, NTN, ISO-13616 IBAN checksum; encrypts IBAN with AES-256-GCM) |
| `POST` | `/api/v1/supplier/profile/submit-verification` | `SUPPLIER` | Submit complete profile for admin verification (`PENDING_REVIEW`) |
| `GET` | `/api/v1/admin/suppliers/pending` | `ADMIN` | List pending supplier profiles using explicit `SUPPLIER_ADMIN_ALLOWLIST` |
| `POST` | `/api/v1/admin/suppliers/:id/verify` | `ADMIN` | Approve (`VERIFIED`, enforcing `STARTER=4`, `GROWTH=13`, `BUSINESS=25`) or reject (`REJECTED` with mandatory reason) |

---

## 2. Canonical Catalog, Supplier Products & Physical SKUs Endpoints (Package E2)

| Method | Endpoint | Auth / Role | Description |
|---|---|---|---|
| `GET` | `/api/v1/catalog/categories` | Public | List all 8 active canonical categories |
| `GET` | `/api/v1/catalog/families` | Public | List active canonical product families (filterable by `category_id`) |
| `GET` | `/api/v1/catalog/variants` | Public | List approved specifications/SKUs with full hierarchy metadata |
| `GET` | `/api/v1/catalog/variants/:id` | Public | Get single specification/SKU with category & family metadata |
| `POST` | `/api/v1/catalog/supplier-products` | `SUPPLIER` | Create a supplier-owned product in `DRAFT` (`is_unbranded: true/false`, optional `brand`, `variety`, optional `quality_grade`, optional `processing_method`) |
| `GET` | `/api/v1/catalog/supplier-products/mine` | `SUPPLIER` | List authenticated supplier's products with nested SKUs |
| `PUT` | `/api/v1/catalog/supplier-products/:id` | `SUPPLIER` (Owner) | Update a `DRAFT` supplier-owned product (`422 SUPPLIER_PRODUCT_IMMUTABLE` if already `PUBLISHED`) |
| `POST` | `/api/v1/catalog/supplier-skus` | `SUPPLIER` (Owner) | Create a physical packaging SKU (`packaging_type`, `pack_size`, `pack_unit`, `purchasing_unit`) in `DRAFT`; enforces mass vs volume family rules |
| `GET` | `/api/v1/catalog/supplier-skus/mine` | `SUPPLIER` | List authenticated supplier's physical SKUs |
| `PUT` | `/api/v1/catalog/supplier-skus/:id` | `SUPPLIER` (Owner) | Edit a `DRAFT` SKU (`422 SKU_IMMUTABLE_AFTER_PUBLISH` if `PUBLISHED` or `ARCHIVED`) |
| `POST` | `/api/v1/catalog/supplier-skus/:id/publish` | `SUPPLIER` (Owner) | Publish a SKU (`status = 'PUBLISHED'`), lock parent product, and link `product_specifications` bridge row |
| `POST` | `/api/v1/catalog/supplier-skus/:id/archive` | `SUPPLIER` (Owner) | Archive a SKU (`status = 'ARCHIVED'`) |
| `POST` | `/api/v1/catalog/requests` | `SUPPLIER` | Submit a missing canonical family (`NEW_FAMILY`) or variant request |
| `POST` | `/api/v1/admin/catalog/requests/:id/approve` | `ADMIN` | Approve a catalog request and atomically create canonical family/variant |
| `POST` | `/api/v1/admin/catalog/requests/:id/reject` | `ADMIN` | Reject a catalog request with mandatory `rejection_reason` |

---

## 3. Commercial Listings & Regular Pool Endpoints

| Method | Endpoint | Auth / Role | Description |
|---|---|---|---|
| `POST` | `/api/v1/listings` | `SUPPLIER` (`VERIFIED`) | Create commercial listing from `supplier_sku_id` or `product_spec_id` |
| `PUT` | `/api/v1/listings/:id` | `SUPPLIER` (Owner) | Update listing price, MOQ, stock, or status |
| `POST` | `/api/v1/pools` | `SUPPLIER` (`VERIFIED`) | Create Regular Pool in `DRAFT` (`ADMIN` blocked with `403 SUPPLIER_CONSENT_REQUIRED`). Validates optional or provided `promised_delivery_at` in `[+24h, +72h]` |
| `PUT` | `/api/v1/pools/:id` | `SUPPLIER` (Owner) | Edit `DRAFT` pool terms & `promised_delivery_at`. Permanently blocked once published (`422 POOL_TERMS_IMMUTABLE`, even with 0 reservations) |
| `PUT` | `/api/v1/pools/:id/clusters` | `SUPPLIER` (Owner) | Configure pool delivery clusters in `DRAFT`. Permanently blocked once published (`422 POOL_TERMS_IMMUTABLE`) |
| `POST` | `/api/v1/pools/:id/publish` | `SUPPLIER` (Owner) | Publish pool (`status = 'ACTIVE'`, `is_terms_locked = 1`, saves `published_terms_snapshot`). Requires `promised_delivery_at` in `[scheduled_close_at + 24h, scheduled_close_at + 72h]` |
| `GET` | `/api/v1/pools` | Public | List active pools with cluster filtering (`?cluster_id=X&include_pickup=true`), tier table, and `promised_delivery_at` |
| `POST` | `/api/v1/pools/:id/join` | `BUYER` | Reserve quantity in an `ACTIVE` or `THRESHOLD_MET` pool |

---

## 4. Deterministic Error Code Reference

| HTTP Status | Error Code | Subcode | Condition |
|---|---|---|---|
| `400` | `BRAND_REQUIRED_UNLESS_UNBRANDED` | — | `is_unbranded` is false and `brand` is empty |
| `400` | `INCOMPATIBLE_FAMILY_UNIT` | — | Mass unit (`kg`/`g`) used on liquid family (`Cooking Oil`) or volume unit (`L`/`mL`) used on solid family (`Rice`) |
| `403` | `DIRECT_CATALOG_CREATION_PROHIBITED` | — | Supplier attempted direct `POST /api/v1/products` or `/specifications` |
| `403` | `SUPPLIER_NOT_VERIFIED` | — | Unverified supplier attempted to create listing or pool |
| `403` | `FORBIDDEN` | `SUPPLIER_CONSENT_REQUIRED` | Admin attempted to create, edit, or publish a supplier's Regular Pool |
| `422` | `SUPPLIER_PRODUCT_IMMUTABLE` | — | Attempted to edit identity fields of a `PUBLISHED` or `ARCHIVED` supplier product |
| `422` | `SKU_IMMUTABLE_AFTER_PUBLISH` | — | Attempted to edit packaging/size/unit of a `PUBLISHED` or `ARCHIVED` physical SKU |
| `422` | `PROMISED_DELIVERY_REQUIRED` | `MISSING_DELIVERY_SLA` | Attempted to publish a pool without `promised_delivery_at` |
| `422` | `DELIVERY_SLA_OUT_OF_RANGE` | `DELIVERY_BEFORE_POOL_CLOSE` | `promised_delivery_at <= scheduled_close_at` |
| `422` | `DELIVERY_SLA_OUT_OF_RANGE` | `DELIVERY_SLA_TOO_EARLY` | `promised_delivery_at < scheduled_close_at + 24 hours` |
| `422` | `DELIVERY_SLA_OUT_OF_RANGE` | `DELIVERY_SLA_TOO_LATE` | `promised_delivery_at > scheduled_close_at + 72 hours` |
| `422` | `POOL_TERMS_IMMUTABLE` | `PUBLISHED_POOL_LOCKED` | Attempted to edit pool commercial terms or delivery clusters after publish (even at 0 reservations) |
