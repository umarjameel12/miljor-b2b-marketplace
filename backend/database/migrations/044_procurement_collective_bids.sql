-- B6-J/K | supplier-owned collective bids and separate buyer approval snapshots.
-- Apply after reviewed migrations 037–043 ONLY to backed-up miljor_test_db.
-- No stock reservation, checkout, payment attempt or supplier payout is authorized here.
CREATE TABLE IF NOT EXISTS procurement_collective_bids (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT NOT NULL,
  supplier_id INT NOT NULL,
  status ENUM('ACTIVE','WITHDRAWN') NOT NULL DEFAULT 'ACTIVE',
  current_version INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_collective_bid_group FOREIGN KEY (group_id) REFERENCES procurement_collective_groups(id),
  CONSTRAINT fk_collective_bid_supplier FOREIGN KEY (supplier_id) REFERENCES users(id),
  UNIQUE KEY uq_collective_bid_supplier (group_id,supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_collective_bid_versions (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bid_id BIGINT NOT NULL,
  version_number INT NOT NULL,
  valid_until DATETIME NOT NULL,
  min_group_buyers SMALLINT UNSIGNED NOT NULL DEFAULT 2,
  delivery_fee_per_buyer DECIMAL(12,2) NOT NULL,
  item_subtotal DECIMAL(14,2) NOT NULL,
  full_snapshot JSON NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_collective_bid_version FOREIGN KEY (bid_id) REFERENCES procurement_collective_bids(id),
  CONSTRAINT uq_collective_bid_version UNIQUE (bid_id,version_number),
  CONSTRAINT uq_collective_bid_key UNIQUE (bid_id,idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_collective_bid_lines (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bid_version_id BIGINT NOT NULL,
  request_item_id BIGINT NOT NULL,
  supplier_listing_id INT NOT NULL,
  supplier_sku_id INT NOT NULL,
  product_spec_id INT NOT NULL,
  aggregate_quantity DECIMAL(12,4) NOT NULL,
  min_aggregate_quantity DECIMAL(12,4) NOT NULL,
  purchasing_unit VARCHAR(30) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  subtotal DECIMAL(14,2) NOT NULL,
  physical_snapshot JSON NOT NULL,
  CONSTRAINT fk_collective_line_version FOREIGN KEY (bid_version_id) REFERENCES procurement_collective_bid_versions(id),
  CONSTRAINT fk_collective_line_item FOREIGN KEY (request_item_id) REFERENCES procurement_request_items(id),
  CONSTRAINT fk_collective_line_listing FOREIGN KEY (supplier_listing_id) REFERENCES supplier_listings(id),
  CONSTRAINT fk_collective_line_sku FOREIGN KEY (supplier_sku_id) REFERENCES supplier_skus(id),
  CONSTRAINT fk_collective_line_spec FOREIGN KEY (product_spec_id) REFERENCES product_specifications(id),
  CONSTRAINT uq_collective_line_item UNIQUE (bid_version_id,request_item_id),
  CONSTRAINT chk_collective_aggregate_quantity CHECK (aggregate_quantity > 0),
  CONSTRAINT chk_collective_minimum_quantity CHECK (min_aggregate_quantity > 0),
  CONSTRAINT chk_collective_unit_price CHECK (unit_price > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_collective_buyer_approvals (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT NOT NULL,
  participant_id BIGINT NOT NULL,
  buyer_id INT NOT NULL,
  bid_version_id BIGINT NOT NULL,
  status ENUM('CONSENTED_NOT_PAYABLE','REVOKED') NOT NULL DEFAULT 'CONSENTED_NOT_PAYABLE',
  item_subtotal DECIMAL(14,2) NOT NULL,
  delivery_fee DECIMAL(12,2) NOT NULL,
  buyer_fee_preview DECIMAL(12,2) NOT NULL,
  total_preview DECIMAL(14,2) NOT NULL,
  consent_snapshot JSON NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  original_response_snapshot JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_collective_approval_group FOREIGN KEY (group_id) REFERENCES procurement_collective_groups(id),
  CONSTRAINT fk_collective_approval_participant FOREIGN KEY (participant_id) REFERENCES procurement_collective_participants(id),
  CONSTRAINT fk_collective_approval_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
  CONSTRAINT fk_collective_approval_bid_version FOREIGN KEY (bid_version_id) REFERENCES procurement_collective_bid_versions(id),
  UNIQUE KEY uq_collective_approval_participant (group_id,participant_id),
  UNIQUE KEY uq_collective_approval_idempotency (buyer_id,idempotency_key),
  KEY idx_collective_approval_bid (bid_version_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
