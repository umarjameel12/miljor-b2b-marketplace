-- Canonical forward-only integration of PR #53 notification schema expansion and PR #54 UCP event compatibility.
-- Do not rename an already-applied 092/093 in any database. Always check migration journal before deployment.
ALTER TABLE platform_notifications MODIFY COLUMN event_type VARCHAR(80) NOT NULL;
ALTER TABLE procurement_notifications
  MODIFY COLUMN recipient_role ENUM('BUYER','SUPPLIER','ADMIN','SUPER_ADMIN') NOT NULL,
  MODIFY COLUMN event_type VARCHAR(80) NOT NULL,
  ADD COLUMN last_error_code VARCHAR(80) NULL;
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INT NOT NULL PRIMARY KEY,
  locale ENUM('en','ur') NOT NULL DEFAULT 'en',
  optional_email TINYINT(1) NOT NULL DEFAULT 1,
  optional_sms TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_preferences_user FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
