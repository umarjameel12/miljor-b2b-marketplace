-- Integration sequence 050 (original catalog 046); Migration 050: canonical family expansion (13 -> 25); no destructive legacy changes.
-- Apply only after 033 and 034; all physical brands, grades, packaging and quantities belong to supplier SKUs.
-- The 12 additional families were previously documented as proposed in the B1 catalog report.
-- Corn Starch is intentionally distinct from cornmeal / milled corn flour; Wheat Grain distinct from Chakki Atta.
-- Urdu names and aliases are optional discovery metadata, NEVER a second product identity.
-- Idempotent: existing canonical records are preserved without rewriting merchant/admin edits.
INSERT INTO catalog_product_families
 (family_code, slug, name, urdu_name, category_id, description, allowed_pack_units,
  allowed_purchasing_units, required_attributes, aliases, approval_status, is_active, display_order)
VALUES
('FAM-TEA', 'tea', 'Tea', 'چائے', 7, 'Commercial tea leaves, dust and blends; supplier determines grade and packaging', JSON_ARRAY('kg', 'g'), JSON_ARRAY('bag', 'carton', 'sack'), JSON_ARRAY('variety','quality_grade','packaging_type','pack_size','pack_unit'), JSON_ARRAY('Black Tea', 'Tea Dust'), 'APPROVED', 1, 100),
('FAM-SALT', 'salt', 'Salt', 'نمک', 6, 'Edible salt including refined and iodized types', JSON_ARRAY('kg', 'g'), JSON_ARRAY('bag', 'sack', 'carton'), JSON_ARRAY('variety','quality_grade','packaging_type','pack_size','pack_unit'), JSON_ARRAY('Iodized Salt', 'Refined Salt'), 'APPROVED', 1, 100),
('FAM-RED-CHILLI', 'red-chilli', 'Red Chilli', 'لال مرچ', 6, 'Whole and powdered red chilli', JSON_ARRAY('kg', 'g'), JSON_ARRAY('bag', 'sack', 'carton'), JSON_ARRAY('variety','quality_grade','packaging_type','pack_size','pack_unit'), JSON_ARRAY('Chilli Powder', 'Whole Red Chilli'), 'APPROVED', 1, 100),
('FAM-TURMERIC', 'turmeric', 'Turmeric', 'ہلدی', 6, 'Ground and whole turmeric for foodservice', JSON_ARRAY('kg', 'g'), JSON_ARRAY('bag', 'sack', 'carton'), JSON_ARRAY('variety','quality_grade','packaging_type','pack_size','pack_unit'), JSON_ARRAY('Haldi'), 'APPROVED', 1, 100),
('FAM-CORIANDER', 'coriander', 'Coriander', 'دھنیا', 6, 'Whole coriander seeds and coriander powder', JSON_ARRAY('kg', 'g'), JSON_ARRAY('bag', 'sack', 'carton'), JSON_ARRAY('variety','quality_grade','packaging_type','pack_size','pack_unit'), JSON_ARRAY('Dhania'), 'APPROVED', 1, 100),
('FAM-CUMIN', 'cumin', 'Cumin', 'زیرہ', 6, 'Whole and ground cumin seeds', JSON_ARRAY('kg', 'g'), JSON_ARRAY('bag', 'sack', 'carton'), JSON_ARRAY('variety','quality_grade','packaging_type','pack_size','pack_unit'), JSON_ARRAY('Zeera'), 'APPROVED', 1, 100),
('FAM-CORN-STARCH', 'corn-starch', 'Corn Starch', 'کارن اسٹارچ', 8, 'Food-grade maize starch; not wheat flour or cornmeal', JSON_ARRAY('kg', 'g'), JSON_ARRAY('bag', 'sack', 'carton'), JSON_ARRAY('variety','quality_grade','packaging_type','pack_size','pack_unit'), JSON_ARRAY('Corn Flour (Starch)', 'Maize Starch'), 'APPROVED', 1, 100),
('FAM-BAKING-POWDER', 'baking-powder', 'Baking Powder', 'بیکنگ پاؤڈر', 8, 'Food-grade chemical leavening powder', JSON_ARRAY('kg', 'g'), JSON_ARRAY('bag', 'carton', 'tin'), JSON_ARRAY('variety','quality_grade','packaging_type','pack_size','pack_unit'), JSON_ARRAY('Leavening Powder'), 'APPROVED', 1, 100),
('FAM-YEAST', 'yeast', 'Yeast', 'خمیر', 8, 'Food-grade dry and fresh bakery yeast, supplier declares shelf-life', JSON_ARRAY('kg', 'g'), JSON_ARRAY('bag', 'carton', 'pouch'), JSON_ARRAY('variety','quality_grade','packaging_type','pack_size','pack_unit'), JSON_ARRAY('Instant Yeast', 'Dry Yeast'), 'APPROVED', 1, 100),
('FAM-MILK-POWDER', 'milk-powder', 'Milk Powder', 'خشک دودھ', 8, 'Food-grade milk powder for beverage and bakery use', JSON_ARRAY('kg', 'g'), JSON_ARRAY('bag', 'sack', 'carton'), JSON_ARRAY('variety','quality_grade','packaging_type','pack_size','pack_unit'), JSON_ARRAY('Powdered Milk'), 'APPROVED', 1, 100),
('FAM-BLACK-PEPPER', 'black-pepper', 'Black Pepper', 'کالی مرچ', 6, 'Whole and ground black pepper', JSON_ARRAY('kg', 'g'), JSON_ARRAY('bag', 'sack', 'carton'), JSON_ARRAY('variety','quality_grade','packaging_type','pack_size','pack_unit'), JSON_ARRAY('Kali Mirch'), 'APPROVED', 1, 100),
('FAM-WHEAT-GRAIN', 'wheat-grain', 'Wheat Grain', 'گندم', 1, 'Bulk food-grade whole wheat grain; separate from milled atta', JSON_ARRAY('kg', 'g'), JSON_ARRAY('bag', 'sack'), JSON_ARRAY('variety','quality_grade','packaging_type','pack_size','pack_unit'), JSON_ARRAY('Whole Wheat Grain', 'Gandum'), 'APPROVED', 1, 100)
ON DUPLICATE KEY UPDATE id = id;
-- Deployment gate (read-only):
-- SELECT COUNT(*) AS approved_active_families FROM catalog_product_families
-- WHERE approval_status = 'APPROVED' AND is_active = 1;
-- Expect >=25 if preexisting 13 are still active, and validate every family_code above exists.
-- No products, product_specifications, supplier_listings, pools or orders are modified.
