-- =============================================================================
-- Migration 030: Pool Coverage Policy Reconciliation & Destination Identity Binding
-- MilJor Phase 6D.3.3: Advanced Safety, Address Revision & Quote Fingerprinting
-- =============================================================================

-- 1. Forward-reconcile coverage_policy on pools table to prevent broad backfill clobbering
-- A: Explicitly configured modern pools with cluster associations
UPDATE pools p
JOIN pool_delivery_clusters pdc ON p.id = pdc.pool_id
SET p.coverage_policy = 'EXPLICIT_CLUSTERS'
WHERE p.delivery_type != 'SUPPLIER_PICKUP';

-- B: Pickup-only pools
UPDATE pools
SET coverage_policy = 'PICKUP_ONLY'
WHERE delivery_type = 'SUPPLIER_PICKUP';

-- C: Genuine legacy pools with valid non-empty delivery_zones and no explicit cluster table records
UPDATE pools p
LEFT JOIN pool_delivery_clusters pdc ON p.id = pdc.pool_id
SET p.coverage_policy = 'LEGACY_KNOWN'
WHERE pdc.pool_id IS NULL
  AND p.delivery_type != 'SUPPLIER_PICKUP'
  AND p.delivery_zones IS NOT NULL
  AND JSON_VALID(p.delivery_zones) = 1
  AND JSON_LENGTH(p.delivery_zones) > 0;

-- D: Historical legacy pools without known boundaries requiring manual review
UPDATE pools p
LEFT JOIN pool_delivery_clusters pdc ON p.id = pdc.pool_id
SET p.coverage_policy = 'LEGACY_REVIEW_REQUIRED'
WHERE pdc.pool_id IS NULL
  AND (p.product_spec_id IS NULL OR p.supplier_listing_id IS NULL)
  AND (p.delivery_zones IS NULL OR JSON_LENGTH(p.delivery_zones) = 0)
  AND p.delivery_type != 'SUPPLIER_PICKUP';

-- 2. Add revision column to buyer_delivery_addresses for optimistic concurrency & mutation tracking
ALTER TABLE buyer_delivery_addresses
  ADD COLUMN revision INT NOT NULL DEFAULT 1
  AFTER is_default;

-- 3. Add destination_fingerprint column to delivery_quotes for immutable destination binding
ALTER TABLE delivery_quotes
  ADD COLUMN destination_fingerprint VARCHAR(64) NULL
  AFTER destination_address_snapshot;
