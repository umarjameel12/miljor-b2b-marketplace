-- =============================================================================
-- Migration 034: Supplier-Owned Products, Physical SKUs & Immutable Regular Pools
-- Package E2 Final Corrections + Regular Pool Immutability & 1-3 Day Delivery SLA
-- Additive, non-destructive migration preserving all historical records
-- =============================================================================

-- 1. Create supplier_products table (Level 3: Supplier-Owned Product under Approved Canonical Family)
CREATE TABLE IF NOT EXISTS supplier_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_code VARCHAR(40) NOT NULL UNIQUE,
  supplier_id INT NOT NULL,
  category_id INT NOT NULL,
  family_id INT NOT NULL,
  legacy_product_id INT NULL DEFAULT NULL,
  title VARCHAR(200) NOT NULL,
  brand VARCHAR(100) NULL DEFAULT NULL,
  is_unbranded TINYINT(1) NOT NULL DEFAULT 0,
  variety VARCHAR(100) NOT NULL,
  processing_method VARCHAR(100) NULL DEFAULT NULL,
  quality_grade VARCHAR(100) NULL DEFAULT NULL,
  origin VARCHAR(120) NULL DEFAULT NULL,
  crop_year VARCHAR(30) NULL DEFAULT NULL,
  commodity_attributes JSON NULL DEFAULT NULL,
  description TEXT NULL DEFAULT NULL,
  product_identity_hash VARCHAR(64) NOT NULL,
  status ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  published_at TIMESTAMP NULL DEFAULT NULL,
  archived_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_supplier_product_identity (supplier_id, product_identity_hash),
  INDEX idx_sp_prod_supplier_status (supplier_id, status),
  INDEX idx_sp_prod_family_status (family_id, status),
  INDEX idx_sp_prod_category (category_id),
  CONSTRAINT fk_supplier_products_supplier FOREIGN KEY (supplier_id) REFERENCES users(id),
  CONSTRAINT fk_supplier_products_category FOREIGN KEY (category_id) REFERENCES catalog_categories(id),
  CONSTRAINT fk_supplier_products_family FOREIGN KEY (family_id) REFERENCES catalog_product_families(id),
  CONSTRAINT fk_supplier_products_legacy_product FOREIGN KEY (legacy_product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Create supplier_skus table (Level 4: Supplier-Owned Physical SKU / Sellable Pack)
CREATE TABLE IF NOT EXISTS supplier_skus (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sku_code VARCHAR(40) NOT NULL UNIQUE,
  supplier_id INT NOT NULL,
  supplier_product_id INT NOT NULL,
  category_id INT NOT NULL,
  family_id INT NOT NULL,
  linked_spec_id INT NULL DEFAULT NULL,
  packaging_type VARCHAR(100) NOT NULL,
  pack_size DECIMAL(10,2) NOT NULL,
  pack_unit VARCHAR(20) NOT NULL,
  purchasing_unit VARCHAR(30) NOT NULL DEFAULT 'bag',
  pack_specification VARCHAR(200) NULL DEFAULT NULL,
  storage_requirements VARCHAR(255) NULL DEFAULT NULL,
  shelf_life_days INT NULL DEFAULT NULL,
  sku_attributes JSON NULL DEFAULT NULL,
  sku_hash VARCHAR(64) NOT NULL,
  status ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  published_at TIMESTAMP NULL DEFAULT NULL,
  archived_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_supplier_sku_hash (supplier_id, sku_hash),
  INDEX idx_sp_sku_supplier_status (supplier_id, status),
  INDEX idx_sp_sku_product (supplier_product_id),
  INDEX idx_sp_sku_family_status (family_id, status),
  INDEX idx_sp_sku_linked_spec (linked_spec_id),
  CONSTRAINT fk_supplier_skus_supplier FOREIGN KEY (supplier_id) REFERENCES users(id),
  CONSTRAINT fk_supplier_skus_product FOREIGN KEY (supplier_product_id) REFERENCES supplier_products(id),
  CONSTRAINT fk_supplier_skus_category FOREIGN KEY (category_id) REFERENCES catalog_categories(id),
  CONSTRAINT fk_supplier_skus_family FOREIGN KEY (family_id) REFERENCES catalog_product_families(id),
  CONSTRAINT fk_supplier_skus_linked_spec FOREIGN KEY (linked_spec_id) REFERENCES product_specifications(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Make brand, processing_method, quality_grade optional (nullable) in product_specifications
--    and add supplier-ownership & lifecycle bridge columns while keeping existing 16 rows intact
ALTER TABLE product_specifications
  MODIFY COLUMN brand VARCHAR(100) NULL DEFAULT NULL,
  MODIFY COLUMN processing_method VARCHAR(100) NULL DEFAULT NULL,
  MODIFY COLUMN quality_grade VARCHAR(100) NULL DEFAULT NULL;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_specifications' AND COLUMN_NAME = 'supplier_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE product_specifications
     ADD COLUMN supplier_id INT NULL DEFAULT NULL AFTER family_id,
     ADD COLUMN supplier_product_id INT NULL DEFAULT NULL AFTER supplier_id,
     ADD COLUMN supplier_sku_id INT NULL DEFAULT NULL AFTER supplier_product_id,
     ADD COLUMN is_unbranded TINYINT(1) NOT NULL DEFAULT 0 AFTER brand,
     ADD COLUMN origin VARCHAR(120) NULL DEFAULT NULL AFTER quality_grade,
     ADD COLUMN lifecycle_status ENUM(''LEGACY_GLOBAL'', ''DRAFT'', ''PUBLISHED'', ''ARCHIVED'') NOT NULL DEFAULT ''LEGACY_GLOBAL'' AFTER approval_status,
     ADD INDEX idx_ps_supplier_id (supplier_id),
     ADD INDEX idx_ps_supplier_sku_id (supplier_sku_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Update catalog_requests to support optional brand & optional quality_grade + origin
ALTER TABLE catalog_requests
  MODIFY COLUMN brand VARCHAR(100) NULL DEFAULT NULL,
  MODIFY COLUMN processing_method VARCHAR(100) NULL DEFAULT NULL,
  MODIFY COLUMN quality_grade VARCHAR(100) NULL DEFAULT NULL;

SET @cr_col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'catalog_requests' AND COLUMN_NAME = 'is_unbranded'
);
SET @cr_sql := IF(@cr_col_exists = 0,
  'ALTER TABLE catalog_requests
     ADD COLUMN is_unbranded TINYINT(1) NOT NULL DEFAULT 0 AFTER brand,
     ADD COLUMN origin VARCHAR(120) NULL DEFAULT NULL AFTER quality_grade',
  'SELECT 1'
);
PREPARE stmt FROM @cr_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 5. Add supplier_product_id and supplier_sku_id to supplier_listings
SET @sl_col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_listings' AND COLUMN_NAME = 'supplier_sku_id'
);
SET @sl_sql := IF(@sl_col_exists = 0,
  'ALTER TABLE supplier_listings
     ADD COLUMN supplier_product_id INT NULL DEFAULT NULL AFTER product_spec_id,
     ADD COLUMN supplier_sku_id INT NULL DEFAULT NULL AFTER supplier_product_id,
     ADD INDEX idx_sl_supplier_sku_id (supplier_sku_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sl_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 6. Add Immutable Pool & 1-3 Day Delivery SLA columns to pools
SET @pool_col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools' AND COLUMN_NAME = 'promised_delivery_at'
);
SET @pool_sql := IF(@pool_col_exists = 0,
  'ALTER TABLE pools
     ADD COLUMN supplier_product_id INT NULL DEFAULT NULL AFTER product_spec_id,
     ADD COLUMN supplier_sku_id INT NULL DEFAULT NULL AFTER supplier_product_id,
     ADD COLUMN participation_opens_at TIMESTAMP NULL DEFAULT NULL AFTER status,
     ADD COLUMN scheduled_close_at TIMESTAMP NULL DEFAULT NULL AFTER expires_at,
     ADD COLUMN actual_closed_at TIMESTAMP NULL DEFAULT NULL AFTER closed_at,
     ADD COLUMN promised_delivery_at TIMESTAMP NULL DEFAULT NULL AFTER actual_closed_at,
     ADD COLUMN actual_dispatched_at TIMESTAMP NULL DEFAULT NULL AFTER promised_delivery_at,
     ADD COLUMN actual_delivered_at TIMESTAMP NULL DEFAULT NULL AFTER actual_dispatched_at,
     ADD COLUMN delivery_delay_reason TEXT NULL DEFAULT NULL AFTER actual_delivered_at,
     ADD COLUMN published_at TIMESTAMP NULL DEFAULT NULL AFTER delivery_delay_reason,
     ADD COLUMN is_terms_locked TINYINT(1) NOT NULL DEFAULT 0 AFTER published_at,
     ADD COLUMN published_terms_snapshot JSON NULL DEFAULT NULL AFTER is_terms_locked,
     ADD INDEX idx_pools_promised_delivery (promised_delivery_at),
     ADD INDEX idx_pools_supplier_sku (supplier_sku_id)',
  'SELECT 1'
);
PREPARE stmt FROM @pool_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Backfill scheduled_close_at = expires_at and is_terms_locked = 1 for historical non-DRAFT pools
UPDATE pools
SET scheduled_close_at = COALESCE(scheduled_close_at, expires_at),
    is_terms_locked = CASE WHEN status != 'DRAFT' THEN 1 ELSE 0 END
WHERE scheduled_close_at IS NULL;
