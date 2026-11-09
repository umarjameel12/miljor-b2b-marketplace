-- =============================================================================
-- Migration 029: Pool Coverage Hardening, Strict RESTRICT Foreign Keys & Quote Safety
-- MilJor Phase 6D.3.2: Defect Resolution, Coverage Policy & Destination Snapshotting
-- =============================================================================

-- 1. Add coverage_policy to pools table to distinguish explicit cluster authorization from legacy states
ALTER TABLE pools
  ADD COLUMN coverage_policy ENUM('EXPLICIT_CLUSTERS', 'PICKUP_ONLY', 'LEGACY_KNOWN', 'LEGACY_REVIEW_REQUIRED')
  NOT NULL DEFAULT 'EXPLICIT_CLUSTERS'
  AFTER delivery_type;

-- 2. Backfill existing legacy pools in pools table
-- Legacy pools with missing specs/listings and null delivery_zones are flagged as LEGACY_REVIEW_REQUIRED
UPDATE pools
SET coverage_policy = CASE
  WHEN (product_spec_id IS NULL OR supplier_listing_id IS NULL) AND (delivery_zones IS NULL OR JSON_LENGTH(delivery_zones) = 0)
    THEN 'LEGACY_REVIEW_REQUIRED'
  WHEN (product_spec_id IS NULL OR supplier_listing_id IS NULL) AND delivery_zones IS NOT NULL AND JSON_LENGTH(delivery_zones) > 0
    THEN 'LEGACY_KNOWN'
  WHEN delivery_type = 'SUPPLIER_PICKUP'
    THEN 'PICKUP_ONLY'
  ELSE 'EXPLICIT_CLUSTERS'
END;

-- 3. Add destination_address_snapshot to delivery_quotes to protect against post-quote address mutation
ALTER TABLE delivery_quotes
  ADD COLUMN destination_address_snapshot JSON NULL
  AFTER address_id;

-- 4. Enforce strict ON DELETE RESTRICT on pool_delivery_clusters.cluster_id
-- Prevents accidental deletion of referenced operational clusters and eliminates silent fallback risk
ALTER TABLE pool_delivery_clusters
  DROP FOREIGN KEY fk_pdc_cluster;

ALTER TABLE pool_delivery_clusters
  ADD CONSTRAINT fk_pdc_cluster
  FOREIGN KEY (cluster_id) REFERENCES geographic_clusters(id)
  ON DELETE RESTRICT;
