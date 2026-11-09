-- =============================================================================
-- Migration Rollback 029: Pool Coverage Hardening, Strict RESTRICT Foreign Keys & Quote Safety
-- =============================================================================

-- 1. Revert FK constraint on pool_delivery_clusters
ALTER TABLE pool_delivery_clusters
  DROP FOREIGN KEY fk_pdc_cluster;

ALTER TABLE pool_delivery_clusters
  ADD CONSTRAINT fk_pdc_cluster
  FOREIGN KEY (cluster_id) REFERENCES geographic_clusters(id);

-- 2. Drop destination_address_snapshot from delivery_quotes
ALTER TABLE delivery_quotes
  DROP COLUMN destination_address_snapshot;

-- 3. Drop coverage_policy from pools
ALTER TABLE pools
  DROP COLUMN coverage_policy;
