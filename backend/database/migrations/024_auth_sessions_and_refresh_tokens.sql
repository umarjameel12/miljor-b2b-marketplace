-- =============================================================================
-- Migration 024: Secure Authentication Sessions, Persistent Refresh Tokens & Revocation
-- MilJor Phase 6C: Enterprise Session Architecture & Remember This Device
-- =============================================================================

CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `session_id` VARCHAR(36) NOT NULL UNIQUE,
  `user_id` INT NOT NULL,
  `session_family_id` VARCHAR(36) NOT NULL,
  `is_persistent` BOOLEAN NOT NULL DEFAULT FALSE,
  `idle_expires_at` DATETIME NOT NULL,
  `absolute_expires_at` DATETIME NOT NULL,
  `revoked_at` DATETIME NULL DEFAULT NULL,
  `revocation_reason` VARCHAR(100) NULL DEFAULT NULL,
  `user_agent` VARCHAR(255) NULL DEFAULT NULL,
  `ip_address` VARCHAR(45) NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_user_sessions_user` (`user_id`),
  KEY `idx_user_sessions_family` (`session_family_id`),
  KEY `idx_user_sessions_lookup` (`session_id`, `revoked_at`, `absolute_expires_at`),
  CONSTRAINT `fk_user_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `user_refresh_tokens` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `session_id` VARCHAR(36) NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL UNIQUE,
  `expires_at` DATETIME NOT NULL,
  `consumed_at` DATETIME NULL DEFAULT NULL,
  `revoked_at` DATETIME NULL DEFAULT NULL,
  `replacement_token_id` BIGINT NULL DEFAULT NULL,
  `issued_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_refresh_tokens_session` (`session_id`),
  KEY `idx_refresh_tokens_hash` (`token_hash`),
  CONSTRAINT `fk_refresh_tokens_session` FOREIGN KEY (`session_id`) REFERENCES `user_sessions` (`session_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
