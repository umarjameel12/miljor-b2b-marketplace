# MILJOR — DATABASE DICTIONARY & MIGRATION LEDGER (MIGRATIONS 001–034)
**Document ID:** `MILJOR-DOC-DB-034`  
**Engine:** MySQL 8.0 (`InnoDB`, `utf8mb4_0900_ai_ci`)  
**Active Schema Version:** `034` (`034_supplier_owned_products_skus_and_immutable_pools.sql`)

---

## 1. Database Environments

| Database Name | Purpose | Current Schema Version | Governance Policy |
|---|---|---|---|
| **`miljor_db`** | Active Local Development Database | **`034`** | Activated only after external `mysqldump` backup + `miljor_recovery_verify_db` parity check. Zero test-fixture writes permitted. |
| **`miljor_test_db`** | Isolated Automated Test Gate Database | **`034`** | Target of all automated test suites (`NODE_ENV=test`). Fixtures are cleaned up after every gate run. |
| **`miljor_sandbox_db`** | Protected Sandbox Database | Untouched | Never modified by development or test runs. |

---

## 2. Core Table Dictionary (52 Tables at Migration 034)

### 2.1 Identity, Onboarding & Geography
- `users`: Primary account table (`id`, `full_name`, `email`, `phone`, `password_hash`, `role`, `verification_status`, `buyer_trust_status`, `base_cluster_id`, `password_changed_at`).
- `supplier_profiles`: Supplier legal/business profile (`supplier_id`, `business_name`, `business_type`, `ntn`, `strn`, `bank_name`, `bank_account_title`, `bank_iban` [AES-256-GCM `v1:`], `verification_status`, `verification_level`, `subscription_plan`, `max_active_listings`).
- `lahore_clusters`: Canonical Lahore geographic logistics clusters (`id`, `code`, `name`, `zone`, `is_active`).
- `buyer_delivery_addresses`: Buyer street addresses linked to `cluster_id` (`ON DELETE RESTRICT`).
- `email_verifications` & `transactional_email_outbox`: Cryptographic OTP challenges, cooldown tracking, and email delivery audit outbox.

### 2.2 Canonical Catalog, Supplier Products & Physical SKUs (Migrations 033 & 034)
- `catalog_categories`: 8 Admin-governed top-level B2B categories (`id`, `name`, `slug`, `display_order`, `is_active`).
- `catalog_product_families`: 13+ Admin-governed canonical commodity families (`id`, `category_id`, `name`, `slug`, `measurement_dimension` `MASS|VOLUME|COUNT`, `allowed_units_json`, `is_active`).
- `supplier_products`: Supplier-owned product definitions (`id`, `supplier_id`, `category_id`, `family_id`, `base_product_id`, `title`, `brand` [nullable], `is_unbranded`, `variety`, `quality_grade` [nullable], `processing_method` [nullable], `status` `DRAFT|PUBLISHED|ARCHIVED`, `published_at`, `archived_at`).
- `supplier_skus`: Supplier-owned physical packaging SKUs (`id`, `supplier_id`, `supplier_product_id`, `sku_code`, `packaging_type`, `pack_size`, `pack_unit`, `purchasing_unit`, `net_measure_value`, `net_measure_unit`, `is_indivisible_unit`, `canonical_hash`, `status` `DRAFT|PUBLISHED|ARCHIVED`, `published_at`, `archived_at`).
- `product_specifications`: Canonical specification & compatibility bridge table (`id`, `product_id`, `category_id`, `family_id`, `supplier_sku_id`, `brand`, `is_unbranded`, `variety`, `grade`, `packaging_type`, `pack_size`, `pack_unit`, `canonical_hash`, `approval_status`).
- `catalog_addition_requests`: Supplier requests (`NEW_FAMILY`, `NEW_VARIANT`) with admin review workflow (`status`, `reviewed_by`, `rejection_reason`, `approved_family_id`, `approved_spec_id`).

### 2.3 Commercial Listings, Regular Pools & Fulfillment
- `supplier_listings`: Commercial offers by verified suppliers (`id`, `supplier_id`, `product_id`, `product_spec_id`, `unit_price`, `min_order_qty`, `available_stock`, `lead_time_days`, `status`).
- `listing_price_history`: Immutable audit trail of supplier listing price updates.
- `pools`: Regular Pools (`id`, `pool_code`, `product_id`, `product_spec_id`, `supplier_sku_id`, `listing_id`, `supplier_id`, `title`, `unit`, `base_unit_price`, `moq`, `buyer_min_qty`, `current_qty`, `max_capacity`, `status`, `expires_at`, `scheduled_close_at`, `promised_delivery_at`, `delivery_lead_days`, `published_at`, `published_by`, `is_terms_locked`, `terms_locked_at`, `published_terms_snapshot`, `coverage_policy`, `pickup_available`, `pickup_location_note`).
- `pool_price_tiers`: Volume discount tiers per pool (`pool_id`, `tier_number`, `min_qty`, `max_qty`, `price_per_unit`, `discount_pct`, `delivery_subsidy_pct`).
- `pool_delivery_clusters`: Explicit Lahore clusters covered by a pool (`pool_id`, `cluster_id`).
- `supplier_inventory_allocations`: Stock reservations held for active pools (`pool_id`, `listing_id`, `allocated_qty`, `status`).
- `reservations`, `delivery_quotes`, `orders`, `payments`, `escrow_ledger_entries`, `system_audit_logs`.

---

## 3. Recent Schema Migration Ledger (`029`–`034`)

| Version | Migration Filename | Summary of Schema Changes |
|---|---|---|
| `029` | `029_buyer_onboarding_and_pool_delivery_clusters.sql` | Added `users.base_cluster_id`, `buyer_delivery_addresses`, and `pool_delivery_clusters`. |
| `030` | `030_pool_coverage_reconciliation_and_destination_identity.sql` | Added `pools.coverage_policy`, `pickup_available`, `pickup_location_note`, and quote address snapshots. |
| `031` | `031_auth_password_reset_cooldown.sql` | Added OTP cooldown, attempt counters, and password reset security columns. |
| `032` | `032_supplier_profile_onboarding_and_verification.sql` | Expanded `supplier_profiles` for onboarding, verification workflow, encrypted `bank_iban`, and plan caps. |
| `033` | `033_canonical_catalog_and_moderation.sql` | Created `catalog_categories` (8), `catalog_product_families` (13), `catalog_addition_requests`, and mapped all 11 products & 16 specifications. |
| **`034`** | **`034_supplier_owned_products_skus_and_immutable_pools.sql`** | Created `supplier_products` & `supplier_skus`, made `grade` optional with `is_unbranded` support, linked `product_specifications.supplier_sku_id`, and added `promised_delivery_at`, `published_at`, `published_by`, `is_terms_locked`, `terms_locked_at`, `published_terms_snapshot` to `pools`. |
