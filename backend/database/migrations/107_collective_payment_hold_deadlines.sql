-- Forward-only migration 107: bounded per-buyer payment holds for collective orders
-- linked to PR #53/#54 procurement_collective_commitments and orders.
CREATE TABLE IF NOT EXISTS collective_payment_holds (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  group_id BIGINT NOT NULL,
  commitment_id INT NOT NULL,
  buyer_id INT NOT NULL,
  payment_expires_at DATETIME NULL,
  payment_hold_status ENUM(
    'ACTIVE','PAYMENT_PENDING','RECONCILIATION_REQUIRED','COMMITTED','RELEASED'
  ) NOT NULL DEFAULT 'ACTIVE',
  checkout_started_at DATETIME NULL,
  payment_hold_released_at DATETIME NULL,
  payment_hold_release_reason VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_collective_payment_hold_order (order_id),
  UNIQUE KEY uq_collective_payment_hold_commitment (commitment_id),
  KEY idx_collective_payment_hold_expiry (payment_hold_status, payment_expires_at),
  KEY idx_collective_payment_hold_group (group_id, payment_hold_status),
  CONSTRAINT fk_cph_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_cph_group FOREIGN KEY (group_id) REFERENCES procurement_collective_groups(id),
  CONSTRAINT fk_cph_commitment FOREIGN KEY (commitment_id) REFERENCES procurement_collective_commitments(id),
  CONSTRAINT fk_cph_buyer FOREIGN KEY (buyer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
