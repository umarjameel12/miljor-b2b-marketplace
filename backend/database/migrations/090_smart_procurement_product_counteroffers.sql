-- MilJor Smart Procurement Hub: product-wise numeric negotiations.
-- Apply only via reviewed migration runner, never directly on protected miljor_db.
-- Non-binding proposals; no orders, payments, stock holds or quote modifications.
CREATE TABLE IF NOT EXISTS procurement_product_counteroffers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  quote_id BIGINT UNSIGNED NOT NULL,
  quote_version INT NOT NULL,
  buyer_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NOT NULL,
  request_item_id BIGINT UNSIGNED NOT NULL,
  buyer_proposed_unit_price DECIMAL(14,2) NOT NULL,
  quoted_unit_price DECIMAL(14,2) NOT NULL,
  supplier_proposed_unit_price DECIMAL(14,2) DEFAULT NULL,
  decision ENUM('OPEN','ACCEPT','REJECT','COUNTER_AGAIN') NOT NULL DEFAULT 'OPEN',
  idempotency_key VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_counteroffer_item_version (quote_id,quote_version,request_item_id),
  UNIQUE KEY uq_counteroffer_idempotency_item (buyer_id,idempotency_key,request_item_id),
  KEY idx_counteroffer_buyer (buyer_id,request_id,id),
  KEY idx_counteroffer_supplier (supplier_id,decision,id),
  CONSTRAINT ck_counteroffer_positive CHECK (
    quoted_unit_price > 0 AND buyer_proposed_unit_price > 0 AND
    (supplier_proposed_unit_price IS NULL OR supplier_proposed_unit_price > 0)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
