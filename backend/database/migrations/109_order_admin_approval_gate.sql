-- Forward-only migration 109: Mandatory Admin Approval Gate for every Pool & Smart Hub order.
-- No supplier may view as actionable or fulfill any order until an authenticated Admin approves it.
-- Approval is strictly separate from payment capture and supplier payout authorization.
ALTER TABLE orders
  ADD COLUMN admin_approval_status ENUM('PENDING_ADMIN_APPROVAL','ADMIN_APPROVED','ADMIN_REJECTED')
    NOT NULL DEFAULT 'PENDING_ADMIN_APPROVAL' AFTER fulfillment_status,
  ADD COLUMN admin_approved_at DATETIME NULL AFTER admin_approval_status,
  ADD COLUMN admin_approved_by INT NULL AFTER admin_approved_at,
  ADD COLUMN admin_rejected_at DATETIME NULL AFTER admin_approved_by,
  ADD COLUMN admin_rejected_by INT NULL AFTER admin_rejected_at,
  ADD COLUMN admin_rejection_reason VARCHAR(500) NULL AFTER admin_rejected_by,
  ADD KEY idx_orders_admin_approval (admin_approval_status, order_status),
  ADD CONSTRAINT fk_orders_admin_approved_by FOREIGN KEY (admin_approved_by) REFERENCES users(id),
  ADD CONSTRAINT fk_orders_admin_rejected_by FOREIGN KEY (admin_rejected_by) REFERENCES users(id);

CREATE TABLE IF NOT EXISTS order_admin_approval_audit (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  admin_id INT NOT NULL,
  admin_role VARCHAR(40) NOT NULL,
  decision ENUM('APPROVED','REJECTED') NOT NULL,
  reason VARCHAR(500) NULL,
  previous_status VARCHAR(40) NOT NULL,
  new_status VARCHAR(40) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_order_admin_audit_order (order_id, created_at),
  CONSTRAINT fk_oaaa_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_oaaa_admin FOREIGN KEY (admin_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
