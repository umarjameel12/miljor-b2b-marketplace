-- =============================================================================
-- Migration 113: Renewal Consent Token Expiration
-- Enforces explicit expiration window on single-use renewal consent tokens.
-- =============================================================================

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_subscription_renewal_consents' AND COLUMN_NAME = 'expires_at');
SET @sql := IF(@col = 0, 'ALTER TABLE supplier_subscription_renewal_consents ADD COLUMN expires_at DATETIME NULL AFTER accepted_at', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_subscription_renewal_consents' AND INDEX_NAME = 'idx_sub_renewal_consent_expiry');
SET @sql := IF(@idx = 0, 'ALTER TABLE supplier_subscription_renewal_consents ADD INDEX idx_sub_renewal_consent_expiry (expires_at)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
