-- PR61: append-only signed Safepay v3 supplier-plan capture evidence.
-- Does not transfer funds or enable recurring card charges.
CREATE TABLE IF NOT EXISTS supplier_subscription_capture_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(90) NOT NULL,
  checkout_attempt_id BIGINT NOT NULL,
  supplier_id BIGINT NOT NULL,
  tracker_token VARCHAR(200) NOT NULL,
  amount_pkr DECIMAL(18,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'PKR',
  event_type VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_supplier_capture_event_id (event_id),
  UNIQUE KEY uq_supplier_capture_attempt (checkout_attempt_id),
  KEY idx_supplier_capture_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
