-- ================================================================================
-- MILJOR MIGRATION 033: CANONICAL CATALOG HIERARCHY & MODERATION WORKFLOW (PACKAGE E2)
-- ================================================================================
-- Architecture:
--   Level 1: catalog_categories (Platform-managed food & beverage categories)
--   Level 2: catalog_product_families (Canonical commodity product families)
--   Level 3: product_specifications (Approved physical variants / specifications)
--   Level 4: supplier_listings (Supplier commercial offers against approved specs)
--
-- Compatibility Guarantees:
--   - Preserves all 11 historical products rows (IDs 1..11) and their legacy category strings
--   - Preserves all 16 historical product_specifications rows (IDs 1..16) and their spec_hash
--   - Deterministically maps all 11 products and 16 specifications to canonical categories & families
--   - Adds durable catalog_requests & catalog_moderation_logs for moderated catalog governance
-- ================================================================================

-- 1. Create catalog_categories table
CREATE TABLE IF NOT EXISTS catalog_categories (
  id INT NOT NULL AUTO_INCREMENT,
  category_code VARCHAR(50) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(120) NOT NULL,
  urdu_name VARCHAR(120) DEFAULT NULL,
  description VARCHAR(500) DEFAULT NULL,
  display_order INT NOT NULL DEFAULT 100,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  approval_status ENUM('APPROVED', 'INACTIVE') NOT NULL DEFAULT 'APPROVED',
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_catalog_categories_code (category_code),
  UNIQUE KEY uq_catalog_categories_slug (slug),
  UNIQUE KEY uq_catalog_categories_name (name),
  KEY idx_catalog_categories_active_order (is_active, display_order),
  CONSTRAINT fk_catalog_categories_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2. Seed initial 8 canonical categories (Idempotent)
INSERT INTO catalog_categories (id, category_code, slug, name, urdu_name, description, display_order, is_active, approval_status)
VALUES
  (1, 'CAT-GRAINS-RICE', 'grains-rice', 'Grains & Rice', 'اناج اور چاول', 'Basmati, Non-Basmati, Sella, Steam, and broken rice varieties and bulk food grains.', 1, 1, 'APPROVED'),
  (2, 'CAT-OILS-GHEE', 'cooking-oils-ghee', 'Cooking Oils & Ghee', 'خوردنی تیل اور گھی', 'Commercial cooking oils, palm olein, canola, soybean oil, and Banaspati ghee in pouches, tins, and jerrycans.', 2, 1, 'APPROVED'),
  (3, 'CAT-FLOUR-MILLING', 'flour-milling-products', 'Flour & Milling Products', 'آٹا اور ملنگ مصنوعات', 'Whole wheat Chakki Atta, refined Maida, Besan (gram flour), fine atta, and suji.', 3, 1, 'APPROVED'),
  (4, 'CAT-PULSES-LEGUMES', 'pulses-legumes', 'Pulses & Legumes', 'دالیں اور چنے', 'Daal Chana, Daal Masoor, Daal Moong, Daal Mash, Kabuli Chana, and black chickpeas.', 4, 1, 'APPROVED'),
  (5, 'CAT-SUGAR-SWEETENERS', 'sugar-sweeteners', 'Sugar & Sweeteners', 'چینی اور گڑ', 'Refined white crystal sugar, brown sugar, and traditional Gur / Jaggery.', 5, 1, 'APPROVED'),
  (6, 'CAT-SPICES-SEASONINGS', 'spices-seasonings', 'Spices & Seasonings', 'مصالحہ جات', 'Whole and ground culinary spices, red chilli, turmeric, coriander, cumin, and commercial masala blends.', 6, 1, 'APPROVED'),
  (7, 'CAT-TEA-BEVERAGES', 'tea-beverages', 'Tea & Beverages', 'چائے اور مشروبات', 'Commercial black tea dust, danedar tea leaf, green tea, and foodservice beverage bases.', 7, 1, 'APPROVED'),
  (8, 'CAT-BAKERY-INGREDIENTS', 'bakery-ingredients', 'Bakery Ingredients', 'بیکری اجزاء', 'Commercial yeast, baking powder, cocoa powder, shortening, and specialty bakery supplies.', 8, 1, 'APPROVED')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  urdu_name = VALUES(urdu_name),
  description = VALUES(description),
  display_order = VALUES(display_order),
  is_active = VALUES(is_active),
  approval_status = VALUES(approval_status);

-- 3. Create catalog_product_families table
CREATE TABLE IF NOT EXISTS catalog_product_families (
  id INT NOT NULL AUTO_INCREMENT,
  category_id INT NOT NULL,
  family_code VARCHAR(50) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  name VARCHAR(120) NOT NULL,
  urdu_name VARCHAR(120) DEFAULT NULL,
  description VARCHAR(500) DEFAULT NULL,
  default_product_id INT DEFAULT NULL,
  allowed_pack_units JSON NOT NULL,
  allowed_purchasing_units JSON NOT NULL,
  required_attributes JSON DEFAULT NULL,
  aliases JSON DEFAULT NULL,
  approval_status ENUM('APPROVED', 'ARCHIVED') NOT NULL DEFAULT 'APPROVED',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 100,
  created_by INT DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_catalog_family_code (family_code),
  UNIQUE KEY uq_catalog_family_slug (slug),
  UNIQUE KEY uq_catalog_category_family_name (category_id, name),
  KEY idx_catalog_family_category (category_id, is_active, display_order),
  KEY idx_catalog_family_default_product (default_product_id),
  CONSTRAINT fk_catalog_family_category FOREIGN KEY (category_id) REFERENCES catalog_categories(id) ON DELETE RESTRICT,
  CONSTRAINT fk_catalog_family_default_product FOREIGN KEY (default_product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT fk_catalog_family_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 4. Seed initial 13 canonical product families (Idempotent)
-- Note: Both Basmati Rice (product 1) and Non-Basmati Rice PK-386 (product 6) map to FAM-RICE.
-- Both Cooking Oil (product 3) and Cooking Oil (Tin/Can) (product 7) map to FAM-COOKING-OIL.
-- Sugar (FAM-SUGAR) and Gur / Jaggery (FAM-GUR-JAGGERY) are strictly distinct product families.
INSERT INTO catalog_product_families (
  id, category_id, family_code, slug, name, urdu_name, description, default_product_id,
  allowed_pack_units, allowed_purchasing_units, required_attributes, aliases, approval_status, is_active, display_order
)
VALUES
  (
    1, 1, 'FAM-RICE', 'rice', 'Rice', 'چاول',
    'All commercial rice varieties including 1121 Kainat, Super Kernel Basmati, PK-386, Sella, Steam, and White rice.',
    1,
    JSON_ARRAY('kg', 'g'),
    JSON_ARRAY('bag', 'sack', 'carton'),
    JSON_ARRAY('brand', 'variety', 'processing_method', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'),
    JSON_ARRAY('Basmati Rice', 'Non-Basmati Rice (PK-386)', 'Sella Rice', 'Steam Rice', 'Kainat 1121', 'Super Kernel'),
    'APPROVED', 1, 1
  ),
  (
    2, 2, 'FAM-COOKING-OIL', 'cooking-oil', 'Cooking Oil', 'خوردنی تیل',
    'Liquid cooking and frying oils (Palm Olein, Canola, Soybean, Sunflower, Blended) across pouch cartons, tins, and jerrycans.',
    3,
    JSON_ARRAY('L', 'mL'),
    JSON_ARRAY('carton', 'tin', 'jerrycan', 'drum'),
    JSON_ARRAY('brand', 'variety', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'),
    JSON_ARRAY('Cooking Oil (Pouch/Carton)', 'Cooking Oil (Tin/Can)', 'Frying Oil', 'Palm Olein', 'Canola Oil'),
    'APPROVED', 1, 1
  ),
  (
    3, 2, 'FAM-BANASPATI-GHEE', 'banaspati-ghee', 'Banaspati Ghee', 'بناسپتی گھی',
    'Hydrogenated vegetable Banaspati ghee in commercial tins, cartons, and buckets.',
    9,
    JSON_ARRAY('kg', 'g'),
    JSON_ARRAY('tin', 'carton', 'bucket'),
    JSON_ARRAY('brand', 'variety', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'),
    JSON_ARRAY('Vegetable Ghee', 'Vanaspati Ghee', 'Banaspati'),
    'APPROVED', 1, 2
  ),
  (
    4, 3, 'FAM-CHAKKI-ATTA', 'chakki-atta', 'Chakki Atta', 'چکی آٹا',
    'Whole wheat stone-ground Chakki Atta and commercial wheat flour.',
    2,
    JSON_ARRAY('kg', 'g'),
    JSON_ARRAY('bag', 'sack'),
    JSON_ARRAY('brand', 'variety', 'processing_method', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'),
    JSON_ARRAY('Wheat Flour (Chakki Atta)', 'Whole Wheat Flour', 'Lal Atta', 'Finest Atta'),
    'APPROVED', 1, 1
  ),
  (
    5, 3, 'FAM-MAIDA', 'maida', 'Maida', 'میدہ',
    'Super fine refined wheat flour (Maida) for parathas, naan, and bakery applications.',
    10,
    JSON_ARRAY('kg', 'g'),
    JSON_ARRAY('bag', 'sack'),
    JSON_ARRAY('brand', 'variety', 'processing_method', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'),
    JSON_ARRAY('Fine Flour (Maida)', 'All Purpose Flour', 'Super Fine Maida'),
    'APPROVED', 1, 2
  ),
  (
    6, 3, 'FAM-BESAN', 'besan', 'Besan', 'بیسن',
    'Pure chana daal gram flour (Besan) for pakoras, snacks, and traditional gravies.',
    NULL,
    JSON_ARRAY('kg', 'g'),
    JSON_ARRAY('bag', 'sack'),
    JSON_ARRAY('brand', 'variety', 'processing_method', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'),
    JSON_ARRAY('Gram Flour', 'Chickpea Flour', 'Chana Besan'),
    'APPROVED', 1, 3
  ),
  (
    7, 4, 'FAM-DAAL-CHANA', 'daal-chana', 'Daal Chana', 'دال چنا',
    'Split yellow Bengal gram (Daal Chana) in bold and medium commercial grades.',
    8,
    JSON_ARRAY('kg', 'g'),
    JSON_ARRAY('bag', 'sack'),
    JSON_ARRAY('brand', 'variety', 'processing_method', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'),
    JSON_ARRAY('Chana Daal', 'Split Chickpea', 'Yellow Gram Lentil'),
    'APPROVED', 1, 1
  ),
  (
    8, 4, 'FAM-DAAL-MASOOR', 'daal-masoor', 'Daal Masoor', 'دال مسور',
    'Red and brown lentils (Washed Malka Masoor and Whole Sabut Masoor).',
    5,
    JSON_ARRAY('kg', 'g'),
    JSON_ARRAY('bag', 'sack'),
    JSON_ARRAY('brand', 'variety', 'processing_method', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'),
    JSON_ARRAY('Masoor Daal (Red Lentils)', 'Red Lentils', 'Malka Masoor', 'Sabut Masoor'),
    'APPROVED', 1, 2
  ),
  (
    9, 4, 'FAM-DAAL-MOONG', 'daal-moong', 'Daal Moong', 'دال مونگ',
    'Split washed yellow and green gram lentils (Daal Moong Dhuli and Chilka).',
    NULL,
    JSON_ARRAY('kg', 'g'),
    JSON_ARRAY('bag', 'sack'),
    JSON_ARRAY('brand', 'variety', 'processing_method', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'),
    JSON_ARRAY('Moong Lentils', 'Mung Dal', 'Yellow Moong'),
    'APPROVED', 1, 3
  ),
  (
    10, 4, 'FAM-DAAL-MASH', 'daal-mash', 'Daal Mash', 'دال ماش',
    'White urad lentils (Daal Mash Dhuli and Chilka) for restaurant fry daal.',
    NULL,
    JSON_ARRAY('kg', 'g'),
    JSON_ARRAY('bag', 'sack'),
    JSON_ARRAY('brand', 'variety', 'processing_method', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'),
    JSON_ARRAY('Urad Dal', 'White Lentils', 'Mash Dhuli'),
    'APPROVED', 1, 4
  ),
  (
    11, 4, 'FAM-KABULI-CHANA', 'kabuli-chana', 'Kabuli Chana', 'کابلی چنا',
    'Whole white chickpeas (Kabuli Chana / Safaid Chana) graded by millimeter caliber (8mm, 9mm, 10mm, 12mm).',
    11,
    JSON_ARRAY('kg', 'g'),
    JSON_ARRAY('bag', 'sack'),
    JSON_ARRAY('brand', 'variety', 'processing_method', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'),
    JSON_ARRAY('White Chickpeas', 'Safaid Chana', 'Garbanzo Beans'),
    'APPROVED', 1, 5
  ),
  (
    12, 5, 'FAM-SUGAR', 'sugar', 'Sugar', 'چینی',
    'Refined white crystalline cane sugar (S-30, M-30, ICUMSA-45) in commercial PP bags.',
    4,
    JSON_ARRAY('kg', 'g'),
    JSON_ARRAY('bag', 'sack'),
    JSON_ARRAY('brand', 'variety', 'processing_method', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'),
    JSON_ARRAY('Refined Sugar', 'White Sugar', 'Chini', 'Crystal Sugar'),
    'APPROVED', 1, 1
  ),
  (
    13, 5, 'FAM-GUR-JAGGERY', 'gur-jaggery', 'Gur / Jaggery', 'گڑ / شکر',
    'Unrefined traditional sugarcane Gur (Peshawari Gur, Shakkar, Jaggery blocks and cones).',
    NULL,
    JSON_ARRAY('kg', 'g'),
    JSON_ARRAY('bag', 'carton', 'sack'),
    JSON_ARRAY('brand', 'variety', 'processing_method', 'quality_grade', 'packaging_type', 'pack_size', 'pack_unit'),
    JSON_ARRAY('Gur', 'Jaggery', 'Shakkar', 'Desi Gur'),
    'APPROVED', 1, 2
  )
ON DUPLICATE KEY UPDATE
  category_id = VALUES(category_id),
  name = VALUES(name),
  urdu_name = VALUES(urdu_name),
  description = VALUES(description),
  default_product_id = VALUES(default_product_id),
  allowed_pack_units = VALUES(allowed_pack_units),
  allowed_purchasing_units = VALUES(allowed_purchasing_units),
  required_attributes = VALUES(required_attributes),
  aliases = VALUES(aliases),
  approval_status = VALUES(approval_status),
  is_active = VALUES(is_active),
  display_order = VALUES(display_order);

-- 5. Add canonical linkage columns to products (Idempotent via IF NOT EXISTS check)
SET @col_exists_prod_cat = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'category_id'
);
SET @sql_prod_cat = IF(@col_exists_prod_cat = 0,
  'ALTER TABLE products
    ADD COLUMN category_id INT DEFAULT NULL AFTER category,
    ADD COLUMN family_id INT DEFAULT NULL AFTER category_id,
    ADD COLUMN canonical_slug VARCHAR(100) DEFAULT NULL AFTER family_id,
    ADD COLUMN approval_status ENUM(''APPROVED'', ''PENDING'', ''REJECTED'', ''ARCHIVED'') NOT NULL DEFAULT ''APPROVED'' AFTER is_active,
    ADD COLUMN mapping_status VARCHAR(50) NOT NULL DEFAULT ''MAPPED_CANONICAL'' AFTER approval_status,
    ADD KEY idx_products_category_id (category_id),
    ADD KEY idx_products_family_id (family_id),
    ADD CONSTRAINT fk_products_catalog_category FOREIGN KEY (category_id) REFERENCES catalog_categories(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_products_catalog_family FOREIGN KEY (family_id) REFERENCES catalog_product_families(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_prod_cat FROM @sql_prod_cat;
EXECUTE stmt_prod_cat;
DEALLOCATE PREPARE stmt_prod_cat;

-- 6. Deterministically map all 11 historical products to canonical categories & families
-- Product 1 (Basmati Rice) & Product 6 (Non-Basmati Rice PK-386) -> Category 1 (Grains & Rice), Family 1 (Rice)
UPDATE products SET category_id = 1, family_id = 1, canonical_slug = 'basmati-rice', approval_status = 'APPROVED', mapping_status = 'MAPPED_CANONICAL' WHERE id = 1;
UPDATE products SET category_id = 1, family_id = 1, canonical_slug = 'non-basmati-rice-pk-386', approval_status = 'APPROVED', mapping_status = 'CONSOLIDATED_INTO_FAMILY' WHERE id = 6;

-- Product 3 (Cooking Oil) & Product 7 (Cooking Oil Tin/Can) -> Category 2 (Cooking Oils & Ghee), Family 2 (Cooking Oil)
UPDATE products SET category_id = 2, family_id = 2, canonical_slug = 'cooking-oil', approval_status = 'APPROVED', mapping_status = 'MAPPED_CANONICAL' WHERE id = 3;
UPDATE products SET category_id = 2, family_id = 2, canonical_slug = 'cooking-oil-tin-can', approval_status = 'APPROVED', mapping_status = 'CONSOLIDATED_INTO_FAMILY' WHERE id = 7;

-- Product 9 (Banaspati Ghee) -> Category 2 (Cooking Oils & Ghee), Family 3 (Banaspati Ghee)
UPDATE products SET category_id = 2, family_id = 3, canonical_slug = 'banaspati-ghee', approval_status = 'APPROVED', mapping_status = 'MAPPED_CANONICAL' WHERE id = 9;

-- Product 2 (Wheat Flour Chakki Atta) -> Category 3 (Flour & Milling Products), Family 4 (Chakki Atta)
UPDATE products SET category_id = 3, family_id = 4, canonical_slug = 'chakki-atta', approval_status = 'APPROVED', mapping_status = 'MAPPED_CANONICAL' WHERE id = 2;

-- Product 10 (Fine Flour Maida) -> Category 3 (Flour & Milling Products), Family 5 (Maida)
UPDATE products SET category_id = 3, family_id = 5, canonical_slug = 'maida', approval_status = 'APPROVED', mapping_status = 'MAPPED_CANONICAL' WHERE id = 10;

-- Product 8 (Daal Chana) -> Category 4 (Pulses & Legumes), Family 7 (Daal Chana)
UPDATE products SET category_id = 4, family_id = 7, canonical_slug = 'daal-chana', approval_status = 'APPROVED', mapping_status = 'MAPPED_CANONICAL' WHERE id = 8;

-- Product 5 (Masoor Daal Red Lentils) -> Category 4 (Pulses & Legumes), Family 8 (Daal Masoor)
UPDATE products SET category_id = 4, family_id = 8, canonical_slug = 'daal-masoor', approval_status = 'APPROVED', mapping_status = 'MAPPED_CANONICAL' WHERE id = 5;

-- Product 11 (Kabuli Chana) -> Category 4 (Pulses & Legumes), Family 11 (Kabuli Chana)
UPDATE products SET category_id = 4, family_id = 11, canonical_slug = 'kabuli-chana', approval_status = 'APPROVED', mapping_status = 'MAPPED_CANONICAL' WHERE id = 11;

-- Product 4 (Refined Sugar) -> Category 5 (Sugar & Sweeteners), Family 12 (Sugar)
UPDATE products SET category_id = 5, family_id = 12, canonical_slug = 'sugar', approval_status = 'APPROVED', mapping_status = 'MAPPED_CANONICAL' WHERE id = 4;

-- 7. Add canonical linkage & moderation columns to product_specifications
SET @col_exists_spec_cat = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_specifications' AND COLUMN_NAME = 'category_id'
);
SET @sql_spec_cat = IF(@col_exists_spec_cat = 0,
  'ALTER TABLE product_specifications
    ADD COLUMN category_id INT DEFAULT NULL AFTER product_id,
    ADD COLUMN family_id INT DEFAULT NULL AFTER category_id,
    ADD COLUMN variant_title VARCHAR(255) DEFAULT NULL AFTER family_id,
    ADD COLUMN approval_status ENUM(''APPROVED'', ''PENDING'', ''REJECTED'', ''ARCHIVED'') NOT NULL DEFAULT ''APPROVED'' AFTER is_active,
    ADD COLUMN created_by INT DEFAULT NULL AFTER approval_status,
    ADD COLUMN approved_by INT DEFAULT NULL AFTER created_by,
    ADD COLUMN approved_at TIMESTAMP NULL DEFAULT NULL AFTER approved_by,
    ADD KEY idx_product_specs_category_id (category_id),
    ADD KEY idx_product_specs_family_id (family_id, approval_status, is_active),
    ADD CONSTRAINT fk_product_specs_category FOREIGN KEY (category_id) REFERENCES catalog_categories(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_product_specs_family FOREIGN KEY (family_id) REFERENCES catalog_product_families(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_product_specs_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL',
  'SELECT 1'
);
PREPARE stmt_spec_cat FROM @sql_spec_cat;
EXECUTE stmt_spec_cat;
DEALLOCATE PREPARE stmt_spec_cat;

-- 8. Deterministically backfill all existing product_specifications from their mapped product_id
UPDATE product_specifications ps
JOIN products p ON ps.product_id = p.id
SET
  ps.category_id = p.category_id,
  ps.family_id = p.family_id,
  ps.approval_status = 'APPROVED',
  ps.approved_at = COALESCE(ps.approved_at, ps.created_at),
  ps.variant_title = CONCAT(
    ps.brand, ' — ', ps.variety,
    IF(ps.quality_grade IS NOT NULL AND ps.quality_grade != 'N/A', CONCAT(' (', ps.quality_grade, ')'), ''),
    ' — ', TRIM(TRAILING '.00' FROM CAST(ps.pack_size AS CHAR)), ps.pack_unit, ' ', ps.packaging_type
  )
WHERE ps.family_id IS NULL OR ps.category_id IS NULL;

-- 9. Create catalog_requests table for supplier-submitted family & variant requests
CREATE TABLE IF NOT EXISTS catalog_requests (
  id INT NOT NULL AUTO_INCREMENT,
  request_code VARCHAR(40) NOT NULL,
  supplier_id INT NOT NULL,
  request_type ENUM('NEW_FAMILY', 'NEW_VARIANT') NOT NULL,
  category_id INT NOT NULL,
  family_id INT DEFAULT NULL,
  proposed_family_name VARCHAR(120) DEFAULT NULL,
  proposed_family_slug VARCHAR(120) DEFAULT NULL,
  proposed_variant_title VARCHAR(255) DEFAULT NULL,
  brand VARCHAR(100) DEFAULT NULL,
  variety VARCHAR(100) DEFAULT NULL,
  crop_year VARCHAR(20) DEFAULT 'N/A',
  processing_method VARCHAR(50) DEFAULT 'N/A',
  quality_grade VARCHAR(50) DEFAULT 'Standard',
  packaging_type VARCHAR(50) DEFAULT NULL,
  pack_size DECIMAL(10, 2) DEFAULT NULL,
  pack_unit VARCHAR(20) DEFAULT NULL,
  purchasing_unit VARCHAR(30) DEFAULT NULL,
  spec_attributes JSON DEFAULT NULL,
  normalized_payload JSON NOT NULL,
  supporting_notes TEXT DEFAULT NULL,
  dedup_hash VARCHAR(64) NOT NULL,
  status ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'SUBMITTED',
  rejection_reason TEXT DEFAULT NULL,
  review_notes TEXT DEFAULT NULL,
  reviewed_by INT DEFAULT NULL,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  approved_family_id INT DEFAULT NULL,
  approved_spec_id INT DEFAULT NULL,
  submitted_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_catalog_requests_code (request_code),
  KEY idx_catalog_requests_supplier (supplier_id, status),
  KEY idx_catalog_requests_status_type (status, request_type),
  KEY idx_catalog_requests_dedup_hash (dedup_hash, status),
  KEY idx_catalog_requests_category (category_id),
  KEY idx_catalog_requests_family (family_id),
  CONSTRAINT fk_catalog_requests_supplier FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_catalog_requests_category FOREIGN KEY (category_id) REFERENCES catalog_categories(id) ON DELETE RESTRICT,
  CONSTRAINT fk_catalog_requests_family FOREIGN KEY (family_id) REFERENCES catalog_product_families(id) ON DELETE SET NULL,
  CONSTRAINT fk_catalog_requests_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_catalog_requests_approved_family FOREIGN KEY (approved_family_id) REFERENCES catalog_product_families(id) ON DELETE SET NULL,
  CONSTRAINT fk_catalog_requests_approved_spec FOREIGN KEY (approved_spec_id) REFERENCES product_specifications(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 10. Create catalog_moderation_logs table for immutable audit trail of catalog requests & admin actions
CREATE TABLE IF NOT EXISTS catalog_moderation_logs (
  id INT NOT NULL AUTO_INCREMENT,
  request_id INT DEFAULT NULL,
  entity_type ENUM('CATEGORY', 'FAMILY', 'VARIANT', 'CATALOG_REQUEST') NOT NULL DEFAULT 'CATALOG_REQUEST',
  entity_id INT NOT NULL,
  actor_id INT NOT NULL,
  actor_role VARCHAR(40) NOT NULL,
  from_status VARCHAR(40) DEFAULT NULL,
  to_status VARCHAR(40) NOT NULL,
  action VARCHAR(60) NOT NULL,
  reason TEXT DEFAULT NULL,
  metadata JSON DEFAULT NULL,
  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_catalog_mod_logs_request (request_id),
  KEY idx_catalog_mod_logs_entity (entity_type, entity_id),
  KEY idx_catalog_mod_logs_actor (actor_id),
  CONSTRAINT fk_catalog_mod_logs_request FOREIGN KEY (request_id) REFERENCES catalog_requests(id) ON DELETE SET NULL,
  CONSTRAINT fk_catalog_mod_logs_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
