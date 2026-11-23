-- =============================================================================
-- Migration 112: Auditable Supplier Subscription Renewal Price Consent
-- Records explicit, single-use, supplier-authenticated acceptance when
-- catalogue pricing differs from an existing subscriber's stored agreed price.
-- =============================================================================

CREATE TABLE IF NOT EXISTS supplier_subscription_renewal_consents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  subscription_id INT NOT NULL,
  plan_code VARCHAR(32) NOT NULL,
  billing_cycle ENUM('MONTHLY') NOT NULL DEFAULT 'MONTHLY',
  previous_agreed_price_pkr DECIMAL(12,2) NOT NULL,
  accepted_price_pkr DECIMAL(12,2) NOT NULL,
  consent_token VARCHAR(120) NOT NULL,
  accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_by_attempt_id BIGINT UNSIGNED NULL,
  consumed_at DATETIME NULL,
  UNIQUE KEY uq_sub_renewal_consent_token (consent_token),
  KEY idx_sub_renewal_consent_lookup (supplier_id, subscription_id, consumed_by_attempt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
