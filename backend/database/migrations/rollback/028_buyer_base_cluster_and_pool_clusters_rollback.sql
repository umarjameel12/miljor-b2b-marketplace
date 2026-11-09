-- =============================================================================
-- Rollback 028: Buyer Base Cluster & Pool-Specific Multi-Cluster Associations
-- =============================================================================

DROP TABLE IF EXISTS pool_delivery_clusters;

ALTER TABLE users
  DROP FOREIGN KEY fk_users_base_cluster;

ALTER TABLE users
  DROP COLUMN base_cluster_id;
