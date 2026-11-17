-- Independent subscription checkout journal; never reuse buyer order payment_attempts.
-- Only verified provider reconciliation can activate paid supplier entitlements.
CREATE TABLE IF NOT EXISTS supplier_subscription_checkout_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  plan_code VARCHAR(32) NOT NULL,
  billing_cycle ENUM('MONTHLY') NOT NULL DEFAULT 'MONTHLY',
  amount_pkr DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'PKR',
  idempotency_key VARCHAR(120) NOT NULL,
  tracker_token VARCHAR(200) NULL,
  checkout_url TEXT NULL,
  status ENUM('INITIATING','INITIATED','PAID','FAILED','UNKNOWN') NOT NULL DEFAULT 'INITIATING',
  paid_subscription_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_supplier_subscription_idempotency (supplier_id,idempotency_key),
  UNIQUE KEY uq_supplier_subscription_tracker (tracker_token),
  KEY idx_supplier_subscription_attempts (supplier_id,status,created_at),
  KEY idx_subscription_checkout_paid (paid_subscription_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
