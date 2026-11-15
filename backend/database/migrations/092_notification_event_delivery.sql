ALTER TABLE procurement_notifications
  MODIFY COLUMN recipient_role ENUM('BUYER','SUPPLIER','ADMIN','SUPER_ADMIN') NOT NULL,
  MODIFY COLUMN event_type VARCHAR(80) NOT NULL,
  ADD COLUMN last_error_code VARCHAR(80) NULL;

ALTER TABLE platform_notifications MODIFY COLUMN event_type VARCHAR(80) NOT NULL;

CREATE TABLE notification_preferences (
  user_id INT NOT NULL PRIMARY KEY,
  locale ENUM('en','ur') NOT NULL DEFAULT 'en',
  optional_email TINYINT(1) NOT NULL DEFAULT 1,
  optional_sms TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_preferences_user FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
