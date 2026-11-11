-- B4 Regular Pool: payment hold deadline is independent of the pool participation cutoff.
-- Historical orders and B5 flash holds are preserved. No automatic refund/stock release.
CREATE TABLE IF NOT EXISTS regular_pool_payment_holds (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  reservation_id INT NOT NULL,
  pool_id INT NOT NULL,
  buyer_id INT NOT NULL,
  status ENUM('HELD','PAYMENT_PENDING','PAID','EXPIRED','RECONCILIATION_REQUIRED') NOT NULL DEFAULT 'HELD',
  expires_at DATETIME NOT NULL,
  checkout_started_at DATETIME NULL,
  paid_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_regular_hold_order (order_id),
  KEY idx_regular_hold_expiry (status, expires_at),
  KEY idx_regular_hold_buyer (buyer_id, status),
  CONSTRAINT fk_regular_hold_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_regular_hold_reservation FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  CONSTRAINT fk_regular_hold_pool FOREIGN KEY (pool_id) REFERENCES pools(id),
  CONSTRAINT fk_regular_hold_buyer FOREIGN KEY (buyer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
