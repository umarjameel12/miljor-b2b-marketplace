-- =============================================================================
-- Migration 110: Supplier Subscription Lifecycle, Safepay v3 Checkout,
-- Admin Approval Gate, Scheduled Downgrades & Audit Trail
-- =============================================================================

-- 1. Extend supplier_subscriptions idempotently with lifecycle & admin review columns
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_subscriptions' AND COLUMN_NAME = 'pending_plan_code');
SET @sql := IF(@col = 0, 'ALTER TABLE supplier_subscriptions ADD COLUMN pending_plan_code VARCHAR(32) NULL AFTER auto_renew', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_subscriptions' AND COLUMN_NAME = 'cancel_at_period_end');
SET @sql := IF(@col = 0, 'ALTER TABLE supplier_subscriptions ADD COLUMN cancel_at_period_end TINYINT(1) NOT NULL DEFAULT 0 AFTER pending_plan_code', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_subscriptions' AND COLUMN_NAME = 'cancellation_requested_at');
SET @sql := IF(@col = 0, 'ALTER TABLE supplier_subscriptions ADD COLUMN cancellation_requested_at DATETIME NULL AFTER cancel_at_period_end', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_subscriptions' AND COLUMN_NAME = 'grace_period_end');
SET @sql := IF(@col = 0, 'ALTER TABLE supplier_subscriptions ADD COLUMN grace_period_end DATETIME NULL AFTER cancellation_requested_at', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_subscriptions' AND COLUMN_NAME = 'admin_approval_status');
SET @sql := IF(@col = 0, "ALTER TABLE supplier_subscriptions ADD COLUMN admin_approval_status ENUM('NOT_REQUIRED','PENDING_ADMIN_APPROVAL','APPROVED','REJECTED') NOT NULL DEFAULT 'NOT_REQUIRED' AFTER grace_period_end", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_subscriptions' AND COLUMN_NAME = 'admin_reviewed_by');
SET @sql := IF(@col = 0, 'ALTER TABLE supplier_subscriptions ADD COLUMN admin_reviewed_by INT NULL AFTER admin_approval_status', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_subscriptions' AND COLUMN_NAME = 'admin_reviewed_at');
SET @sql := IF(@col = 0, 'ALTER TABLE supplier_subscriptions ADD COLUMN admin_reviewed_at DATETIME NULL AFTER admin_reviewed_by', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_subscriptions' AND COLUMN_NAME = 'admin_review_notes');
SET @sql := IF(@col = 0, 'ALTER TABLE supplier_subscriptions ADD COLUMN admin_review_notes VARCHAR(500) NULL AFTER admin_reviewed_at', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_subscriptions' AND COLUMN_NAME = 'last_payment_attempt_id');
SET @sql := IF(@col = 0, 'ALTER TABLE supplier_subscriptions ADD COLUMN last_payment_attempt_id BIGINT UNSIGNED NULL AFTER admin_review_notes', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_subscriptions' AND INDEX_NAME = 'idx_supplier_sub_pending');
SET @sql := IF(@idx = 0, 'ALTER TABLE supplier_subscriptions ADD INDEX idx_supplier_sub_pending (pending_plan_code, current_period_end)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_subscriptions' AND INDEX_NAME = 'idx_supplier_sub_admin_queue');
SET @sql := IF(@idx = 0, 'ALTER TABLE supplier_subscriptions ADD INDEX idx_supplier_sub_admin_queue (admin_approval_status, status, created_at)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. Independent supplier subscription Safepay checkout journal
CREATE TABLE IF NOT EXISTS supplier_subscription_checkout_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  target_plan_code VARCHAR(32) NOT NULL,
  change_type ENUM('NEW','UPGRADE','RENEWAL') NOT NULL DEFAULT 'NEW',
  billing_cycle ENUM('MONTHLY') NOT NULL DEFAULT 'MONTHLY',
  amount_pkr DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'PKR',
  provider_contract ENUM('legacy-v1-major','payments-v3-minor') NOT NULL DEFAULT 'payments-v3-minor',
  idempotency_key VARCHAR(120) NOT NULL,
  tracker_token VARCHAR(200) NULL,
  checkout_url TEXT NULL,
  status ENUM('INITIATING','INITIATED','PAID','FAILED','CANCELLED','UNKNOWN') NOT NULL DEFAULT 'INITIATING',
  failure_reason VARCHAR(500) NULL,
  provider_verified_at DATETIME NULL,
  paid_subscription_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_supplier_sub_idempotency (supplier_id, idempotency_key),
  UNIQUE KEY uq_supplier_sub_tracker (tracker_token),
  KEY idx_supplier_sub_attempts (supplier_id, status, created_at),
  KEY idx_supplier_sub_paid (paid_subscription_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Append-only signed Safepay capture/reconciliation evidence for subscriptions
CREATE TABLE IF NOT EXISTS supplier_subscription_capture_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(120) NOT NULL,
  checkout_attempt_id BIGINT UNSIGNED NOT NULL,
  supplier_id INT NOT NULL,
  tracker_token VARCHAR(200) NOT NULL,
  amount_pkr DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'PKR',
  event_type VARCHAR(64) NOT NULL,
  verification_source ENUM('SAFEPAY_WEBHOOK','SAFEPAY_REPORTER') NOT NULL DEFAULT 'SAFEPAY_WEBHOOK',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sub_capture_event_id (event_id),
  UNIQUE KEY uq_sub_capture_attempt (checkout_attempt_id),
  KEY idx_sub_capture_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Subscription lifecycle & admin decision audit trail
CREATE TABLE IF NOT EXISTS supplier_subscription_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  subscription_id INT NULL,
  checkout_attempt_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(64) NOT NULL,
  from_plan VARCHAR(32) NULL,
  to_plan VARCHAR(32) NULL,
  from_status VARCHAR(32) NULL,
  to_status VARCHAR(32) NULL,
  actor_id INT NULL,
  actor_role VARCHAR(32) NOT NULL DEFAULT 'SYSTEM',
  metadata_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sub_audit_supplier (supplier_id, created_at),
  KEY idx_sub_audit_sub (subscription_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
