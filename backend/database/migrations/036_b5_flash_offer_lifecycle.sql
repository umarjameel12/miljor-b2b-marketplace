-- B5 Flash Pools: forward-only additive migration.
-- Legacy ACTIVE rows are preserved; unverified/unlinked rows are NOT upgraded
-- into eligible supplier-owned published offers by default.
ALTER TABLE flash_pools
  MODIFY COLUMN status ENUM('DRAFT','ACTIVE','SOLD_OUT','EXPIRED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN selling_mode ENUM('MULTI_BUYER','WHOLE_LOT') NOT NULL DEFAULT 'MULTI_BUYER',
  ADD COLUMN supplier_sku_id BIGINT NULL,
  ADD COLUMN supplier_listing_id BIGINT NULL,
  ADD COLUMN product_spec_id BIGINT NULL,
  ADD COLUMN snapshot_json JSON NULL,
  ADD COLUMN configured_duration_minutes INT NULL,
  ADD COLUMN delivery_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN best_before_date DATE NULL,
  ADD COLUMN published_at DATETIME NULL,
  ADD COLUMN purchase_increment DECIMAL(12,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN held_stock DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN committed_stock DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN version_number INT NOT NULL DEFAULT 1,
  ADD INDEX idx_flash_supplier_listing (supplier_listing_id, status),
  ADD INDEX idx_flash_supplier_sku (supplier_sku_id),
  ADD CONSTRAINT chk_flash_sale_stock CHECK (total_stock >= 0 AND remaining_stock >= 0 AND held_stock >= 0 AND committed_stock >= 0),
  ADD CONSTRAINT chk_flash_stock_conservation CHECK (remaining_stock + held_stock + committed_stock <= total_stock);

-- Keep older rows historically readable; only new published supplier-owned
-- offers with a valid linked SKU/listing are eligible for B5 purchase flows.
CREATE TABLE IF NOT EXISTS flash_purchase_holds (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  flash_pool_id INT NOT NULL,
  buyer_id INT NOT NULL,
  quantity DECIMAL(12,2) NOT NULL,
  locked_unit_price DECIMAL(12,2) NOT NULL,
  status ENUM('HELD','PAYMENT_PENDING','PAID','RELEASED','EXPIRED','FAILED') NOT NULL DEFAULT 'HELD',
  expires_at DATETIME NOT NULL,
  order_id INT NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_flash_hold_idem (buyer_id, idempotency_key),
  UNIQUE KEY uq_flash_hold_order (order_id),
  INDEX idx_flash_hold_lifecycle (flash_pool_id, status, expires_at),
  CONSTRAINT fk_flash_hold_pool FOREIGN KEY (flash_pool_id) REFERENCES flash_pools(id),
  CONSTRAINT fk_flash_hold_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
  CONSTRAINT fk_flash_hold_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT chk_flash_hold_quantity CHECK (quantity > 0),
  CONSTRAINT chk_flash_hold_price CHECK (locked_unit_price > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
