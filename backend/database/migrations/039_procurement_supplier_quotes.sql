-- MilJor B6-E supplier quotation lifecycle. Additive, no stock or financial allocation.
-- Apply after reviewed migrations 037 and 038 to backed-up miljor_test_db ONLY.
CREATE TABLE IF NOT EXISTS procurement_quotes (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT NOT NULL,
  supplier_id INT NOT NULL,
  invitation_id BIGINT NOT NULL,
  status ENUM('ACTIVE','WITHDRAWN') NOT NULL DEFAULT 'ACTIVE',
  current_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_proc_quote_request FOREIGN KEY (request_id) REFERENCES procurement_requests(id),
  CONSTRAINT fk_proc_quote_supplier FOREIGN KEY (supplier_id) REFERENCES users(id),
  CONSTRAINT fk_proc_quote_invitation FOREIGN KEY (invitation_id) REFERENCES procurement_supplier_invitations(id),
  UNIQUE KEY uq_proc_quote_supplier_request (request_id,supplier_id),
  UNIQUE KEY uq_proc_quote_id_request (id,request_id),
  KEY idx_proc_quotes_supplier (supplier_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_quote_versions (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  quote_id BIGINT NOT NULL,
  version_number INT NOT NULL,
  coverage ENUM('FULL_BASKET','PARTIAL') NOT NULL,
  valid_until DATETIME NOT NULL,
  delivery_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  delivery_lead_days INT UNSIGNED NOT NULL,
  supplier_notes VARCHAR(2000) NULL,
  items_total DECIMAL(14,2) NOT NULL,
  quoted_total DECIMAL(14,2) NOT NULL,
  immutable_snapshot JSON NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_proc_quote_ver_quote FOREIGN KEY (quote_id) REFERENCES procurement_quotes(id),
  UNIQUE KEY uq_proc_quote_version (quote_id,version_number),
  UNIQUE KEY uq_proc_quote_version_idem (quote_id,idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_quote_lines (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  quote_version_id BIGINT NOT NULL,
  request_item_id BIGINT NOT NULL,
  supplier_listing_id INT NOT NULL,
  supplier_sku_id INT NOT NULL,
  quantity DECIMAL(12,4) NOT NULL,
  purchasing_unit VARCHAR(30) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  subtotal DECIMAL(14,2) NOT NULL,
  supplier_sku_snapshot JSON NOT NULL,
  CONSTRAINT fk_proc_quote_line_version FOREIGN KEY (quote_version_id) REFERENCES procurement_quote_versions(id),
  CONSTRAINT fk_proc_quote_line_item FOREIGN KEY (request_item_id) REFERENCES procurement_request_items(id),
  CONSTRAINT fk_proc_quote_line_listing FOREIGN KEY (supplier_listing_id) REFERENCES supplier_listings(id),
  CONSTRAINT fk_proc_quote_line_sku FOREIGN KEY (supplier_sku_id) REFERENCES supplier_skus(id),
  UNIQUE KEY uq_proc_quote_version_item (quote_version_id,request_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
