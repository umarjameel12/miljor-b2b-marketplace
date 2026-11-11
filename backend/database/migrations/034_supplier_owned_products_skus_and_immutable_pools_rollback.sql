-- =============================================================================
-- Rollback Migration 034: Supplier-Owned Products, Physical SKUs & Immutable Pools
-- =============================================================================

SET @pool_col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pools' AND COLUMN_NAME = 'promised_delivery_at'
);
SET @pool_sql := IF(@pool_col_exists > 0,
  'ALTER TABLE pools
     DROP INDEX idx_pools_promised_delivery,
     DROP INDEX idx_pools_supplier_sku,
     DROP COLUMN published_terms_snapshot,
     DROP COLUMN is_terms_locked,
     DROP COLUMN published_at,
     DROP COLUMN delivery_delay_reason,
     DROP COLUMN actual_delivered_at,
     DROP COLUMN actual_dispatched_at,
     DROP COLUMN promised_delivery_at,
     DROP COLUMN actual_closed_at,
     DROP COLUMN scheduled_close_at,
     DROP COLUMN participation_opens_at,
     DROP COLUMN supplier_sku_id,
     DROP COLUMN supplier_product_id',
  'SELECT 1'
);
PREPARE stmt FROM @pool_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sl_col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_listings' AND COLUMN_NAME = 'supplier_sku_id'
);
SET @sl_sql := IF(@sl_col_exists > 0,
  'ALTER TABLE supplier_listings
     DROP INDEX idx_sl_supplier_sku_id,
     DROP COLUMN supplier_sku_id,
     DROP COLUMN supplier_product_id',
  'SELECT 1'
);
PREPARE stmt FROM @sl_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @cr_col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'catalog_requests' AND COLUMN_NAME = 'is_unbranded'
);
SET @cr_sql := IF(@cr_col_exists > 0,
  'ALTER TABLE catalog_requests
     DROP COLUMN origin,
     DROP COLUMN is_unbranded',
  'SELECT 1'
);
PREPARE stmt FROM @cr_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ps_col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_specifications' AND COLUMN_NAME = 'supplier_sku_id'
);
SET @ps_sql := IF(@ps_col_exists > 0,
  'ALTER TABLE product_specifications
     DROP INDEX idx_ps_supplier_id,
     DROP INDEX idx_ps_supplier_sku_id,
     DROP COLUMN lifecycle_status,
     DROP COLUMN origin,
     DROP COLUMN is_unbranded,
     DROP COLUMN supplier_sku_id,
     DROP COLUMN supplier_product_id,
     DROP COLUMN supplier_id',
  'SELECT 1'
);
PREPARE stmt FROM @ps_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS supplier_skus;
DROP TABLE IF EXISTS supplier_products;
