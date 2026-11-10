-- B6 Smart Procurement Hub: buyer-owned, multi-item draft/publish foundation.
-- Additive only. Apply ONCE after schema review and verified backup against miljor_test_db.
-- No stock reservation, payments, supplier quotes or recurring obligations here.
CREATE TABLE IF NOT EXISTS procurement_requests (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  buyer_id INT NOT NULL,
  request_code VARCHAR(48) NOT NULL,
  ownership ENUM('SINGLE_BUYER','COLLECTIVE') NOT NULL DEFAULT 'SINGLE_BUYER',
  frequency ENUM('ONE_TIME','WEEKLY','MONTHLY') NOT NULL DEFAULT 'ONE_TIME',
  award_policy ENUM('FULL_BASKET','SPLIT_ALLOWED') NOT NULL DEFAULT 'SPLIT_ALLOWED',
  priority ENUM('LOWEST_DELIVERED_COST','FASTEST_DELIVERY','BEST_VALUE') NOT NULL DEFAULT 'BEST_VALUE',
  status ENUM('DRAFT','OPEN','EXPIRED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  delivery_area VARCHAR(255) NOT NULL,
  notes VARCHAR(2000) NULL,
  quote_deadline DATETIME NULL,
  join_deadline DATETIME NULL,
  published_at DATETIME NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  version_number INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_procurement_request_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
  UNIQUE KEY uq_procurement_request_code (request_code),
  UNIQUE KEY uq_procurement_request_idem (buyer_id,idempotency_key),
  KEY idx_procurement_request_buyer (buyer_id,status,created_at),
  KEY idx_procurement_request_expiry (status,quote_deadline)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_request_items (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT NOT NULL,
  line_number SMALLINT UNSIGNED NOT NULL,
  family_id INT NOT NULL,
  quantity DECIMAL(12,4) NOT NULL,
  unit ENUM('kg','g','l','ml','bag','tin','carton','sack','bundle','pack') NOT NULL,
  requirements VARCHAR(2000) NULL,
  allow_substitutions TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_procurement_item_request FOREIGN KEY (request_id)
    REFERENCES procurement_requests(id) ON DELETE RESTRICT,
  CONSTRAINT fk_procurement_item_family FOREIGN KEY (family_id)
    REFERENCES catalog_product_families(id),
  CONSTRAINT chk_procurement_item_qty CHECK (quantity > 0),
  UNIQUE KEY uq_procurement_item_line (request_id,line_number),
  KEY idx_procurement_item_family (family_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
