-- 055 Flash UCP delivery terms: immutable financial/fulfillment snapshot.
-- Applies only after canonical migrations 049 and 054. No data backfill or
-- modification to historical orders. Existing Flash orders keep their earlier
-- delivery contract in orders; new orders receive a typed snapshot.
CREATE TABLE IF NOT EXISTS flash_order_delivery_terms (
  order_id INT NOT NULL PRIMARY KEY,
  flash_pool_id INT NOT NULL,
  buyer_id INT NOT NULL,
  supplier_id INT NOT NULL,
  mode ENUM('STANDARD_CLUSTERED','PICKUP','EXPRESS') NOT NULL,
  delivery_address_id BIGINT NULL,
  cluster_id INT NOT NULL,
  pickup_point_id INT NULL,
  pickup_point_name VARCHAR(150) NULL,
  pickup_point_address TEXT NULL,
  delivery_fee_pkr DECIMAL(12,2) NOT NULL,
  supplier_config_version INT NOT NULL,
  rate_or_point_version INT NOT NULL,
  snapshot_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_flash_delivery_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_flash_delivery_pool FOREIGN KEY (flash_pool_id) REFERENCES flash_pools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_flash_delivery_buyer FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_flash_delivery_supplier FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_flash_delivery_fee CHECK (delivery_fee_pkr >= 0),
  CONSTRAINT chk_flash_delivery_mode_fields CHECK (
    (mode='PICKUP' AND pickup_point_id IS NOT NULL AND delivery_address_id IS NULL)
    OR (mode IN ('STANDARD_CLUSTERED','EXPRESS') AND pickup_point_id IS NULL AND delivery_address_id IS NOT NULL)
  ),
  KEY idx_flash_delivery_supplier (supplier_id,mode,created_at),
  KEY idx_flash_delivery_buyer (buyer_id,created_at),
  KEY idx_flash_delivery_cluster (cluster_id,mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
