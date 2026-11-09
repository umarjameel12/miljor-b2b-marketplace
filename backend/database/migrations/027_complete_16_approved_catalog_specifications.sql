-- =============================================================================
-- Migration 027: Complete 16 Approved Commercial Product Specifications
-- MilJor Phase 6D.2 Catalog Reconciliation
-- Strictly Additive: Completes the 16 approved commercial variants without
-- mutating existing specifications (IDs 1-8) or inventing supplier listings/stock.
-- =============================================================================

-- 1. Ensure representative base products exist for the 16 commercial specifications
INSERT INTO products (id, title, category, brand, variety, processing_type, grade, pack_size, unit, is_active)
VALUES
  (9, 'Banaspati Ghee', 'Oils & Fats', 'Dalda / Sufi', 'Banaspati Blend', 'Hydrogenated & Fractionated', 'Premium VTF', '16kg', 'kg', 1),
  (10, 'All-Purpose Maida Flour', 'Flour & Grain', 'Akbari Mills', 'Super White Maida', 'Roller Refined Bleached', 'Super White Grade', '84kg Bag', 'kg', 1),
  (11, 'Kabuli Chickpeas (White Chana)', 'Pulses & Legumes', 'National Pulses', 'Kabuli White 9mm', 'Mechanically Cleaned & Graded', 'Grade 1 Bold (9mm)', '25kg Bag', 'kg', 1)
ON DUPLICATE KEY UPDATE title = VALUES(title);

-- 2. Insert the missing 8 approved commercial specifications (IDs 9 to 16)
-- Hashes generated canonically via SpecificationService.computeSpecHash (SHA-256)
INSERT INTO product_specifications (
  id, product_id, spec_code, title, brand, variety, crop_year, processing_method,
  quality_grade, packaging_type, pack_size, pack_unit, purchasing_unit,
  storage_requirements, shelf_life_days, spec_attributes, spec_hash, is_active
) VALUES
  (
    9, 1, 'SPEC-RICE-KG-009', 'Kainat 1121 Sella Golden Commercial, 50kg',
    'Kainat Mills', '1121 Extra Long', 'Current Crop', 'Sella Golden (Parboiled)',
    'Commercial Grade', 'PP Bag', 50.00, 'kg', 'bag',
    'Dry warehouse away from pests', 730,
    '{"broken_percent": 2.0, "average_grain_length_mm": 8.1, "moisture_percent": 12.0, "purity_percent": 95.0}',
    '575f206639d59d9a00ecfdccd9dea0e07f5af98a3deead3ecaeefd9ffe0116a1', 1
  ),
  (
    10, 3, 'SPEC-OIL-RO-010', 'Refined Cooking Oil Dalda/Sufi Grade 1, 16L',
    'Dalda / Sufi', 'Pure Vegetable/Canola', NULL, 'Refined & Deodorized',
    'Grade 1 Premium', 'Tin', 16.00, 'L', 'tin',
    'Store at 15-25°C, avoid direct sunlight', 365,
    '{"free_fatty_acids_percent": 0.08, "peroxide_value": 1.0, "smoke_point_celsius": 225}',
    '60f8173e79a4a38c60280b21aeb18cb271ff9fabb30244879011110dd8303827', 1
  ),
  (
    11, 9, 'SPEC-GHEE-BG-011', 'Banaspati Ghee Premium VTF, 16kg Carton',
    'Dalda / Sufi', 'Banaspati Blend', NULL, 'Hydrogenated & Fractionated (VTF)',
    'Premium VTF', 'Carton (Bib/Pouch)', 16.00, 'kg', 'carton',
    'Store in cool dry place below 25°C', 365,
    '{"free_fatty_acids_percent": 0.10, "melting_point_celsius": 36.0, "vtf_compliant": true}',
    'fa235347255ec5cf2ca1223dcc43ad77d964b47df629c694c0966824292983a9', 1
  ),
  (
    12, 9, 'SPEC-GHEE-BC-012', 'Banaspati Ghee Commercial, 16kg Tin',
    'Commercial Blend', 'Banaspati Commercial', NULL, 'Hydrogenated',
    'Commercial Grade', 'Tin', 16.00, 'kg', 'tin',
    'Store in cool dry place away from heat', 365,
    '{"free_fatty_acids_percent": 0.15, "melting_point_celsius": 37.5, "vtf_compliant": false}',
    '43c1a4dc3f664be87531caf72cbfe347f8797111d5efa955572a06663298f1d9', 1
  ),
  (
    13, 2, 'SPEC-FLOUR-FA-013', 'Special Fine Atta (Flour), 20kg',
    'Akbari Mills', 'Fine Wheat', 'Current Season', 'Roller Milled Fine',
    'Special Fine', 'PP Bag', 20.00, 'kg', 'bag',
    'Dry well-aerated warehouse', 90,
    '{"ash_percent": 0.8, "extraction_rate_percent": 82.0, "gluten_percent": 10.5, "moisture_percent": 13.0}',
    'a4dc50523a6484a21a945afeb82e2fc302bc023a092570e10077cb608bc28ebe', 1
  ),
  (
    14, 10, 'SPEC-FLOUR-MD-014', 'Super White Maida Refined Flour, 84kg',
    'Akbari Mills', 'Refined Maida', 'Current Season', 'Patent Roller Milled & Sifted',
    'Super White', 'Jute/PP Bag', 84.00, 'kg', 'bag',
    'Elevated dry pallet storage, pest-controlled', 120,
    '{"ash_percent": 0.5, "dry_gluten_percent": 10.0, "extraction_rate_percent": 72.0, "gluten_percent": 11.5, "moisture_percent": 13.5}',
    '6408e512699ffcb1bf5a731c278e4c95a16a53dc096f216eada885896dca2c90', 1
  ),
  (
    15, 5, 'SPEC-PULSE-MD-015', 'Daal Masoor Imported (Red Lentil Split), 25kg',
    'National Brand', 'Crimson Red Lentil', 'Imported New Crop', 'Dehusked & Polished Split',
    'Imported Grade 1', 'PP Bag', 25.00, 'kg', 'bag',
    'Cool, dry, pest-free warehouse', 540,
    '{"damaged_percent": 0.5, "foreign_matter_percent": 0.05, "moisture_percent": 11.0, "origin": "Canada/Australia"}',
    '9d5e04bd3bd3a6fc209bd803fa16e37e3cc1ee80ada37490296ea8daf4e897ad', 1
  ),
  (
    16, 11, 'SPEC-PULSE-KC-016', 'Kabuli Chana 9mm Bold, Grade 1, 25kg',
    'National Pulses', 'Kabuli White Chickpea', 'Current Season', 'Machine Cleaned, Size Graded 9mm',
    'Grade 1 Bold 9mm', 'PP Bag', 25.00, 'kg', 'bag',
    'Moisture-free cool dry warehouse', 365,
    '{"count_per_ounce": 42, "foreign_matter_percent": 0.1, "grain_size_mm": 9.0, "moisture_percent": 10.5}',
    '9bd7469ec5c717910bf60b4b95452829a9b1585a80bd01615ea4720bff19e23e', 1
  )
ON DUPLICATE KEY UPDATE title = VALUES(title);
