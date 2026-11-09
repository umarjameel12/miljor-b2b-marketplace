-- =============================================================================
-- Rollback 027: Revert 16 Approved Commercial Product Specifications
-- Deletes ONLY the additive specifications (IDs 9-16) and additive products (IDs 9-11)
-- introduced in Migration 027, preserving pre-existing records (IDs 1-8).
-- =============================================================================

-- 1. Remove additive specifications
DELETE FROM product_specifications WHERE id IN (9, 10, 11, 12, 13, 14, 15, 16);

-- 2. Remove additive parent products
DELETE FROM products WHERE id IN (9, 10, 11);
