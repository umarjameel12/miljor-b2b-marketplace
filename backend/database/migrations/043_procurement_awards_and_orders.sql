-- B6-G/H authoritative buyer award, exact per-supplier real order linkage
-- and immutable item snapshot. Apply ONLY to backed-up miljor_test_db after 042.
-- Does not touch protected miljor_db. No payment is created by this migration.
ALTER TABLE procurement_requests
  MODIFY COLUMN status ENUM(
    'DRAFT','OPEN','AWARD_PENDING','AWARDED','EXPIRED','CANCELLED'
  ) NOT NULL DEFAULT 'DRAFT';

CREATE TABLE IF NOT EXISTS procurement_awards (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT NOT NULL,
  buyer_id INT NOT NULL,
  status ENUM('AWAITING_PAYMENT','PARTIALLY_PAID','PAID','FAILED','CANCELLED')
    NOT NULL DEFAULT 'AWAITING_PAYMENT',
  item_subtotal DECIMAL(14,2) NOT NULL,
  supplier_delivery_total DECIMAL(14,2) NOT NULL,
  buyer_platform_fee_total DECIMAL(14,2) NOT NULL,
  accepted_total_payable DECIMAL(14,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'PKR',
  idempotency_key VARCHAR(120) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  buyer_consent_snapshot JSON NOT NULL,
  original_response_snapshot JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_proc_award_request FOREIGN KEY (request_id) REFERENCES procurement_requests(id),
  CONSTRAINT fk_proc_award_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
  CONSTRAINT uq_proc_award_request UNIQUE (request_id),
  CONSTRAINT uq_proc_award_buyer_key UNIQUE (buyer_id,idempotency_key),
  CONSTRAINT chk_proc_award_total CHECK (accepted_total_payable>0),
  KEY idx_proc_award_buyer (buyer_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_award_orders (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  award_id BIGINT NOT NULL,
  order_id INT NOT NULL,
  supplier_id INT NOT NULL,
  item_subtotal DECIMAL(14,2) NOT NULL,
  delivery_fee DECIMAL(14,2) NOT NULL,
  buyer_platform_fee DECIMAL(14,2) NOT NULL,
  supplier_transaction_fee DECIMAL(14,2) NOT NULL,
  supplier_net_payout DECIMAL(14,2) NOT NULL,
  total_amount DECIMAL(14,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_proc_award_order_parent FOREIGN KEY (award_id) REFERENCES procurement_awards(id),
  CONSTRAINT fk_proc_award_order_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_proc_award_order_supplier FOREIGN KEY (supplier_id) REFERENCES users(id),
  CONSTRAINT uq_proc_award_order UNIQUE (order_id),
  CONSTRAINT uq_proc_award_supplier UNIQUE (award_id,supplier_id),
  KEY idx_proc_award_order_parent (award_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_award_lines (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  award_id BIGINT NOT NULL,
  award_order_id BIGINT NOT NULL,
  request_item_id BIGINT NOT NULL,
  quote_id BIGINT NOT NULL,
  quote_version INT NOT NULL,
  supplier_listing_id INT NOT NULL,
  supplier_sku_id INT NOT NULL,
  product_spec_id INT NOT NULL,
  quantity DECIMAL(12,4) NOT NULL,
  purchasing_unit VARCHAR(30) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  subtotal DECIMAL(14,2) NOT NULL,
  immutable_sku_snapshot JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_proc_award_line_parent FOREIGN KEY (award_id) REFERENCES procurement_awards(id),
  CONSTRAINT fk_proc_award_line_order FOREIGN KEY (award_order_id) REFERENCES procurement_award_orders(id),
  CONSTRAINT fk_proc_award_line_item FOREIGN KEY (request_item_id) REFERENCES procurement_request_items(id),
  CONSTRAINT fk_proc_award_line_quote FOREIGN KEY (quote_id) REFERENCES procurement_quotes(id),
  CONSTRAINT fk_proc_award_line_listing FOREIGN KEY (supplier_listing_id) REFERENCES supplier_listings(id),
  CONSTRAINT fk_proc_award_line_sku FOREIGN KEY (supplier_sku_id) REFERENCES supplier_skus(id),
  CONSTRAINT fk_proc_award_line_spec FOREIGN KEY (product_spec_id) REFERENCES product_specifications(id),
  CONSTRAINT uq_proc_award_request_item UNIQUE (award_id,request_item_id),
  CONSTRAINT chk_proc_award_line_qty CHECK (quantity>0),
  KEY idx_proc_award_listing (supplier_listing_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
