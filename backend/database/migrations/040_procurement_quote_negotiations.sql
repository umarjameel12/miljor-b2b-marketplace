-- B6-F: Buyer-initiated, immutable quote improvement requests.
-- Additive after 037-039. Quotes/versions remain authoritative and append-only.
CREATE TABLE IF NOT EXISTS procurement_quote_negotiations (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT NOT NULL,
  quote_id BIGINT NOT NULL,
  buyer_id INT NOT NULL,
  supplier_id INT NOT NULL,
  requested_version INT NOT NULL,
  status ENUM('OPEN','RESPONDED','CLOSED') NOT NULL DEFAULT 'OPEN',
  buyer_message VARCHAR(1000) NOT NULL,
  buyer_target_total DECIMAL(14,2) NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  response_snapshot JSON NULL,
  responded_version INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP NULL,
  CONSTRAINT fk_proc_neg_request FOREIGN KEY (request_id) REFERENCES procurement_requests(id),
  CONSTRAINT fk_proc_neg_quote_request FOREIGN KEY (quote_id,request_id)
    REFERENCES procurement_quotes(id,request_id),
  CONSTRAINT fk_proc_neg_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
  CONSTRAINT fk_proc_neg_supplier FOREIGN KEY (supplier_id) REFERENCES users(id),
  UNIQUE KEY uq_proc_neg_buyer_key (buyer_id,idempotency_key),
  UNIQUE KEY uq_proc_neg_quote_version (quote_id,requested_version),
  KEY idx_proc_neg_supplier (supplier_id,status,created_at),
  KEY idx_proc_neg_request (request_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
