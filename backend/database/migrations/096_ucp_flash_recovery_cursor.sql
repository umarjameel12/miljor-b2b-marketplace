-- PR #54 Flash recovery fair cursor re-numbered into conflict-free forward migration.
-- No flash stock, payment or pool state mutation occurs during migration.
CREATE TABLE IF NOT EXISTS ucp_recovery_cursors (
  worker_name VARCHAR(64) NOT NULL PRIMARY KEY,
  last_flash_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
