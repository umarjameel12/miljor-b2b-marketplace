-- =============================================================================
-- Migration 028: Buyer Base Cluster & Pool-Specific Multi-Cluster Associations
-- MilJor Phase 6D.3: Location-Aware Marketplace Discovery & Coverage Alignment
-- =============================================================================

-- 1. Add base_cluster_id to users table (default discovery cluster for buyers, base location for suppliers)
ALTER TABLE users
  ADD COLUMN base_cluster_id INT NULL AFTER city;

-- 2. Foreign key linking to authoritative geographic_clusters
ALTER TABLE users
  ADD CONSTRAINT fk_users_base_cluster
  FOREIGN KEY (base_cluster_id) REFERENCES geographic_clusters(id)
  ON DELETE SET NULL;

-- 3. Deterministic backfill of base_cluster_id for existing users
-- For existing buyers who already have a default saved delivery address, use its cluster_id
UPDATE users u
JOIN buyer_delivery_addresses a ON a.user_id = u.id AND a.is_default = 1
SET u.base_cluster_id = a.cluster_id
WHERE u.base_cluster_id IS NULL;

-- For any remaining users with a saved address, use their first address
UPDATE users u
JOIN buyer_delivery_addresses a ON a.user_id = u.id
SET u.base_cluster_id = a.cluster_id
WHERE u.base_cluster_id IS NULL;

-- 4. Create normalized pool-to-cluster association table for multi-cluster pool authorization
CREATE TABLE IF NOT EXISTS pool_delivery_clusters (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pool_id INT NOT NULL,
  cluster_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pdc_pool FOREIGN KEY (pool_id) REFERENCES pools(id) ON DELETE CASCADE,
  CONSTRAINT fk_pdc_cluster FOREIGN KEY (cluster_id) REFERENCES geographic_clusters(id),
  UNIQUE KEY uq_pool_cluster (pool_id, cluster_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
