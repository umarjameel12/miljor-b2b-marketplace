-- ================================================================================
-- MILJOR MIGRATION 033 ROLLBACK: CANONICAL CATALOG HIERARCHY & MODERATION WORKFLOW
-- ================================================================================

DROP TABLE IF EXISTS catalog_moderation_logs;
DROP TABLE IF EXISTS catalog_requests;

-- Remove FK & columns added to product_specifications
SET @fk_spec_cat = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'product_specifications' AND CONSTRAINT_NAME = 'fk_product_specs_category'
);
SET @sql_drop_spec_fk = IF(@fk_spec_cat > 0,
  'ALTER TABLE product_specifications
    DROP FOREIGN KEY fk_product_specs_category,
    DROP FOREIGN KEY fk_product_specs_family,
    DROP FOREIGN KEY fk_product_specs_approved_by,
    DROP COLUMN category_id,
    DROP COLUMN family_id,
    DROP COLUMN variant_title,
    DROP COLUMN approval_status,
    DROP COLUMN created_by,
    DROP COLUMN approved_by,
    DROP COLUMN approved_at',
  'SELECT 1'
);
PREPARE stmt_drop_spec FROM @sql_drop_spec_fk;
EXECUTE stmt_drop_spec;
DEALLOCATE PREPARE stmt_drop_spec;

-- Remove FK & columns added to products
SET @fk_prod_cat = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND CONSTRAINT_NAME = 'fk_products_catalog_category'
);
SET @sql_drop_prod_fk = IF(@fk_prod_cat > 0,
  'ALTER TABLE products
    DROP FOREIGN KEY fk_products_catalog_category,
    DROP FOREIGN KEY fk_products_catalog_family,
    DROP COLUMN category_id,
    DROP COLUMN family_id,
    DROP COLUMN canonical_slug,
    DROP COLUMN approval_status,
    DROP COLUMN mapping_status',
  'SELECT 1'
);
PREPARE stmt_drop_prod FROM @sql_drop_prod_fk;
EXECUTE stmt_drop_prod;
DEALLOCATE PREPARE stmt_drop_prod;

DROP TABLE IF EXISTS catalog_product_families;
DROP TABLE IF EXISTS catalog_categories;
