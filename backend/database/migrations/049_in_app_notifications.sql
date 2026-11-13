-- =============================================================================
-- Migration 049: Platform In-App Notifications
-- Recipient-isolated, deduplicated, persistent notification inbox.
-- Strictly for miljor_test_db / production safe migration journal.
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_notifications (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  role ENUM('BUYER', 'SUPPLIER', 'ADMIN', 'SUPER_ADMIN') NOT NULL,
  event_type ENUM(
    'PAYMENT_CONFIRMED',
    'ORDER_CREATED',
    'RFQ_SUBMITTED',
    'QUOTE_AWARDED',
    'SUPPLIER_VERIFIED',
    'ORDER_DISPATCHED',
    'ORDER_DELIVERED',
    'DISPUTE_RAISED',
    'REFUND_INITIATED'
  ) NOT NULL,
  event_key VARCHAR(120) NOT NULL,
  title VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  payload JSON NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_platform_notif_user FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uq_user_event_key (user_id, event_key),
  KEY idx_user_unread (user_id, is_read, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
