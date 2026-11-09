-- =============================================================================
-- Migration 031: Atomic Cross-Worker Password Reset Cooldown Reservations
-- MilJor Security Hardening: Cross-Worker Concurrency Throttling & Anti-Abuse
-- Enforces atomic, distributed 60-second cooldown per keyed identity hash
-- =============================================================================

CREATE TABLE IF NOT EXISTS auth_cooldown_reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  identity_hash VARCHAR(64) NOT NULL,
  purpose VARCHAR(32) NOT NULL DEFAULT 'PASSWORD_RESET',
  cooldown_until TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_identity_purpose (identity_hash, purpose),
  INDEX idx_cooldown_expiry (cooldown_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
