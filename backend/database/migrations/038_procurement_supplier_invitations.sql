-- B6-D: Supplier discovery and invitation records for existing buyer procurement requests.
-- Additive migration. Review and apply only to backed-up miljor_test_db during final gate.
-- No payments, stock allocations, buyer addresses or direct contact details are stored.
CREATE TABLE IF NOT EXISTS procurement_supplier_invitations (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT NOT NULL,
  supplier_id INT NOT NULL,
  status ENUM('INVITED','INTERESTED','DECLINED','WITHDRAWN') NOT NULL DEFAULT 'INVITED',
  eligible_line_ids JSON NOT NULL,
  invited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP NULL DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_procurement_invitation_request FOREIGN KEY (request_id)
    REFERENCES procurement_requests(id) ON DELETE RESTRICT,
  CONSTRAINT fk_procurement_invitation_supplier FOREIGN KEY (supplier_id)
    REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_procurement_invitation_supplier (request_id,supplier_id),
  KEY idx_procurement_invitation_inbox (supplier_id,status,invited_at),
  KEY idx_procurement_invitation_request (request_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
