-- =============================================================================
-- Migration 023: Email Verification and Transactional Outbox
-- MilJor Part 4E.10: Advanced Security, Google Identity & Transactional Email
-- =============================================================================

CREATE TABLE IF NOT EXISTS `email_verifications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `email` VARCHAR(100) NOT NULL,
  `otp_hash` VARCHAR(255) NOT NULL,
  `purpose` ENUM('REGISTRATION_VERIFY', 'PASSWORD_RESET', 'SECURITY_CHALLENGE') NOT NULL DEFAULT 'REGISTRATION_VERIFY',
  `expires_at` TIMESTAMP NOT NULL,
  `attempts_count` INT NOT NULL DEFAULT 0,
  `consumed_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_email_verif_user` (`user_id`),
  KEY `idx_email_verif_email` (`email`),
  KEY `idx_email_verif_expires` (`expires_at`),
  CONSTRAINT `fk_email_verif_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `transactional_email_outbox` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `recipient_email` VARCHAR(100) NOT NULL,
  `recipient_user_id` INT DEFAULT NULL,
  `template_name` VARCHAR(64) NOT NULL,
  `subject` VARCHAR(255) NOT NULL,
  `payload_json` JSON NOT NULL,
  `status` ENUM('QUEUED', 'PROVIDER_ACCEPTED', 'DELIVERED_WHEN_CONFIRMED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
  `provider_message_id` VARCHAR(255) DEFAULT NULL,
  `attempt_count` INT NOT NULL DEFAULT 0,
  `last_error` TEXT DEFAULT NULL,
  `last_attempted_at` TIMESTAMP NULL DEFAULT NULL,
  `sent_at` TIMESTAMP NULL DEFAULT NULL,
  `idempotency_key` VARCHAR(100) UNIQUE DEFAULT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_email_outbox_status` (`status`),
  KEY `idx_email_outbox_recipient` (`recipient_email`),
  KEY `idx_email_outbox_created` (`created_at`),
  CONSTRAINT `fk_email_outbox_user` FOREIGN KEY (`recipient_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
