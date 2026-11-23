-- Extend the original, committed Smart Hub preferences without replacing history.
ALTER TABLE procurement_notifications MODIFY COLUMN status ENUM('PENDING','SENT','FAILED','SUPPRESSED') NOT NULL DEFAULT 'PENDING';
ALTER TABLE procurement_notifications ADD COLUMN projected_locale ENUM('en','ur') NULL;
ALTER TABLE procurement_notifications MODIFY COLUMN recipient_role ENUM('BUYER','SUPPLIER','ADMIN','SUPER_ADMIN','FINANCE_ADMIN','OPERATIONS_ADMIN','VERIFICATION_ADMIN','SUPPORT_ADMIN') NOT NULL;
ALTER TABLE platform_notifications MODIFY COLUMN role ENUM('BUYER','SUPPLIER','ADMIN','SUPER_ADMIN','FINANCE_ADMIN','OPERATIONS_ADMIN','VERIFICATION_ADMIN','SUPPORT_ADMIN') NOT NULL;

ALTER TABLE notification_preferences
 ADD COLUMN muted_info TINYINT(1) NOT NULL DEFAULT 0,
 ADD COLUMN quiet_start TIME NULL,
 ADD COLUMN quiet_end TIME NULL,
 ADD COLUMN timezone_offset_minutes SMALLINT NOT NULL DEFAULT 300;

-- Visibility expiry never deletes an immutable business event or money record.
ALTER TABLE platform_notifications ADD COLUMN visible_until DATETIME NULL,
 ADD KEY idx_notification_visibility (user_id,visible_until,is_read);

CREATE TABLE notification_digest_events (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 notice_id BIGINT NOT NULL,
 recipient_id INT NOT NULL,
 ready_at DATETIME NOT NULL,
 status ENUM('PENDING','QUEUED','SUPPRESSED','FAILED') NOT NULL DEFAULT 'PENDING',
 processed_at DATETIME NULL,
 last_error_code VARCHAR(80) NULL,
 UNIQUE KEY uq_notification_digest_notice(notice_id,recipient_id),
 KEY idx_notification_digest_due(status,ready_at,recipient_id),
 CONSTRAINT fk_notification_digest_notice FOREIGN KEY(notice_id) REFERENCES procurement_notifications(id),
 CONSTRAINT fk_notification_digest_recipient FOREIGN KEY(recipient_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_email_budgets (
 user_id INT NOT NULL,
 hour_start DATETIME NOT NULL,
 used SMALLINT UNSIGNED NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,hour_start),
 CONSTRAINT fk_notification_email_budget_user FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notification_admin_events (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 actor_id INT NOT NULL,
 notice_id BIGINT NULL,
 email_id INT NULL,
 action VARCHAR(40) NOT NULL,
 previous_attempt_count SMALLINT UNSIGNED NOT NULL,
 previous_email_attempt_count SMALLINT UNSIGNED NULL,
 reason VARCHAR(500) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_notice_admin_actor FOREIGN KEY(actor_id) REFERENCES users(id),
 CONSTRAINT fk_notice_admin_notice FOREIGN KEY(notice_id) REFERENCES procurement_notifications(id),
 CONSTRAINT fk_notice_admin_email FOREIGN KEY(email_id) REFERENCES transactional_email_outbox(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
