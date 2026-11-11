-- B6-Q: private user-scoped procurement notification outbox.
-- Safe event projection only, no addresses, phone, email or payment credentials.
-- Apply after 047 only to backed-up miljor_test_db.
CREATE TABLE IF NOT EXISTS procurement_notifications (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 recipient_id INT NOT NULL,
 recipient_role ENUM('BUYER','SUPPLIER') NOT NULL,
 event_key VARCHAR(120) NOT NULL,
 event_type ENUM('COHORT_INVITED','COHORT_CYCLE_READY','COHORT_CYCLE_UNQUALIFIED',
   'DELIVERY_CHOICE_RECORDED','DELIVERY_RUN_PLANNED',
   'NEW_QUOTE','QUOTE_REVISED','GROUP_JOINED','PAYMENT_DEADLINE',
   'RECURRING_CYCLE_DUE','DELIVERY_STATUS_CHANGED') NOT NULL,
 payload JSON NOT NULL,
 status ENUM('PENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
 is_read TINYINT(1) NOT NULL DEFAULT 0,
 attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
 next_attempt_at DATETIME NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 delivered_at TIMESTAMP NULL DEFAULT NULL,
 CONSTRAINT fk_proc_q_notice_recipient FOREIGN KEY (recipient_id) REFERENCES users(id),
 UNIQUE KEY uq_proc_q_notice_event (recipient_id,event_key),
 KEY idx_proc_q_notice_inbox (recipient_id,is_read,created_at),
 KEY idx_proc_q_notice_retry (status,next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
