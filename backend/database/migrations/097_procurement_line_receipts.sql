-- R4: final buyer receipt evidence + allocations in the EXISTING financial ledger.
-- Review/apply through the canonical migration runner. No automatic application.
-- Never enables external execution or rewrites order/invoice snapshots.
CREATE TABLE procurement_line_receipt_submissions (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 buyer_id INT NOT NULL,
 payment_id INT NOT NULL,
 idempotency_key VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 fee_policy_version VARCHAR(64) NOT NULL,
 fee_policy_accepted TINYINT NOT NULL,
 response_snapshot JSON NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_line_receipt_key(order_id,buyer_id,idempotency_key),
 UNIQUE KEY uq_line_receipt_submission_order(id,order_id),
 FOREIGN KEY(order_id) REFERENCES orders(id),
 FOREIGN KEY(buyer_id) REFERENCES users(id),
 FOREIGN KEY(payment_id) REFERENCES payments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE procurement_line_receipts (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 submission_id BIGINT NOT NULL,
 order_id INT NOT NULL,
 award_line_id BIGINT NOT NULL,
 ordered_quantity DECIMAL(12,4) NOT NULL,
 received_quantity DECIMAL(12,4) NOT NULL,
 accepted_quantity DECIMAL(12,4) NOT NULL,
 disputed_quantity DECIMAL(12,4) NOT NULL,
 purchasing_unit VARCHAR(30) NOT NULL,
 unit_price DECIMAL(12,2) NOT NULL,
 subtotal DECIMAL(14,2) NOT NULL,
 refund_assessment_amount DECIMAL(14,2) NOT NULL,
 hold_assessment_amount DECIMAL(14,2) NOT NULL,
 reason VARCHAR(40) NULL,
 evidence_notes VARCHAR(2000) NULL,
 financial_status ENUM('BLOCKED') NOT NULL DEFAULT 'BLOCKED',
 financial_block_reason VARCHAR(80) NOT NULL DEFAULT 'SEE_APPEND_ONLY_FINANCIAL_ASSESSMENT',
 external_execution_status ENUM('DISABLED') NOT NULL DEFAULT 'DISABLED',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_final_award_line_receipt(award_line_id),
 UNIQUE KEY uq_line_receipt_identity_order(id,order_id),
 KEY idx_line_receipt_order(order_id,id),
 FOREIGN KEY(submission_id,order_id) REFERENCES procurement_line_receipt_submissions(id,order_id),
 FOREIGN KEY(order_id) REFERENCES orders(id),
 FOREIGN KEY(award_line_id) REFERENCES procurement_award_lines(id),
 CONSTRAINT ck_line_receipt_quantities CHECK (
   ordered_quantity>0 AND accepted_quantity>=0 AND received_quantity>=accepted_quantity
   AND received_quantity<=ordered_quantity AND disputed_quantity=ordered_quantity-accepted_quantity),
 CONSTRAINT ck_line_receipt_amount CHECK (
   refund_assessment_amount>=0 AND refund_assessment_amount<=subtotal
   AND hold_assessment_amount=refund_assessment_amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only allocation/evidence. Balances/obligations live in existing tables.
CREATE TABLE procurement_receipt_financial_assessments (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 payment_id INT NOT NULL,
 supplier_payable_id BIGINT NOT NULL,
 policy_version VARCHAR(64) NOT NULL,
 allocation_snapshot JSON NOT NULL,
 prior_payable_snapshot JSON NULL,
 buyer_consent_snapshot JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_receipt_financial_order(order_id),
 FOREIGN KEY(order_id) REFERENCES orders(id),
 FOREIGN KEY(payment_id) REFERENCES payments(id),
 FOREIGN KEY(supplier_payable_id) REFERENCES supplier_payables(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE supplier_payables ADD COLUMN receipt_policy_version VARCHAR(64) NULL;
ALTER TABLE order_disputes
 ADD COLUMN procurement_line_receipt_id BIGINT NULL,
 ADD UNIQUE KEY uq_dispute_line_receipt(procurement_line_receipt_id),
 ADD CONSTRAINT fk_dispute_line_receipt FOREIGN KEY(procurement_line_receipt_id,order_id)
   REFERENCES procurement_line_receipts(id,order_id);
ALTER TABLE refund_obligations
 ADD COLUMN procurement_line_receipt_id BIGINT NULL,
 ADD UNIQUE KEY uq_refund_line_receipt(procurement_line_receipt_id),
 ADD CONSTRAINT fk_refund_line_receipt FOREIGN KEY(procurement_line_receipt_id,order_id)
   REFERENCES procurement_line_receipts(id,order_id);
ALTER TABLE financial_holds
 ADD COLUMN procurement_line_receipt_id BIGINT NULL,
 ADD COLUMN receipt_policy_version VARCHAR(64) NULL,
 ADD COLUMN receipt_hold_component VARCHAR(40) NULL,
 ADD UNIQUE KEY uq_hold_line_receipt(procurement_line_receipt_id),
 ADD UNIQUE KEY uq_receipt_order_fee_hold(order_id,receipt_policy_version,receipt_hold_component),
 ADD CONSTRAINT fk_hold_line_receipt FOREIGN KEY(procurement_line_receipt_id,order_id)
   REFERENCES procurement_line_receipts(id,order_id);
-- Merchandise holds use a receipt ID and NULL receipt_hold_component; fee holds
-- use NULL receipt ID and DELIVERY/PROCESSING component. MySQL permits NULLs
-- in these unique keys; service writes enforce those two exclusive shapes.
