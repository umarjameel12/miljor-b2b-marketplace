-- Forward-only immutable financial review and separately consented delivery fee.
CREATE TABLE procurement_settlement_reviews (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 assessment_id BIGINT NOT NULL,
 supplier_payable_id BIGINT NOT NULL,
 reviewer_id INT NOT NULL,
 intent_key VARCHAR(120) NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 allocation_snapshot JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_procurement_review_order(order_id),
 UNIQUE KEY uq_procurement_review_intent(reviewer_id,intent_key),
 FOREIGN KEY(order_id) REFERENCES orders(id),
 FOREIGN KEY(assessment_id) REFERENCES procurement_receipt_financial_assessments(id),
 FOREIGN KEY(supplier_payable_id) REFERENCES supplier_payables(id),
 FOREIGN KEY(reviewer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE procurement_delivery_payment_contracts (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 contract_code VARCHAR(40) NOT NULL,
 order_id INT NOT NULL,
 delivery_attempt_id BIGINT NOT NULL,
 proposal_version INT NOT NULL,
 buyer_id INT NOT NULL,
 supplier_id INT NOT NULL,
 amount DECIMAL(12,2) NOT NULL,
 currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
 consent_snapshot JSON NOT NULL,
 status ENUM('APPROVED','INITIALIZING','PAYMENT_PENDING','PAID','RECONCILIATION_REQUIRED','REVIEWED') NOT NULL DEFAULT 'APPROVED',
 payment_id INT NULL,
 financial_hold_id BIGINT NULL,
 reviewed_by INT NULL,
 review_snapshot JSON NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_delivery_payment_code(contract_code),
 UNIQUE KEY uq_delivery_payment_proposal(delivery_attempt_id,proposal_version),
 FOREIGN KEY(order_id) REFERENCES orders(id),
 FOREIGN KEY(delivery_attempt_id) REFERENCES procurement_delivery_attempts(id),
 FOREIGN KEY(buyer_id) REFERENCES users(id),
 FOREIGN KEY(supplier_id) REFERENCES users(id),
 FOREIGN KEY(payment_id) REFERENCES payments(id),
 FOREIGN KEY(financial_hold_id) REFERENCES financial_holds(id),
 FOREIGN KEY(reviewed_by) REFERENCES users(id),
 CONSTRAINT ck_delivery_payment_positive CHECK(amount>0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE payment_attempts ADD COLUMN procurement_delivery_contract_id BIGINT NULL,
 ADD CONSTRAINT fk_attempt_delivery_contract FOREIGN KEY(procurement_delivery_contract_id) REFERENCES procurement_delivery_payment_contracts(id),
 ADD UNIQUE KEY uq_delivery_contract_attempt(procurement_delivery_contract_id);
ALTER TABLE payments ADD COLUMN procurement_delivery_contract_id BIGINT NULL,
 ADD CONSTRAINT fk_payment_delivery_contract FOREIGN KEY(procurement_delivery_contract_id) REFERENCES procurement_delivery_payment_contracts(id),
 ADD UNIQUE KEY uq_delivery_contract_payment(procurement_delivery_contract_id);
ALTER TABLE supplier_payables ADD COLUMN procurement_settlement_review_id BIGINT NULL,
 ADD CONSTRAINT fk_payable_procurement_review FOREIGN KEY(procurement_settlement_review_id) REFERENCES procurement_settlement_reviews(id);
ALTER TABLE refund_obligations ADD COLUMN procurement_settlement_review_id BIGINT NULL,
 ADD COLUMN procurement_delivery_contract_id BIGINT NULL,
 ADD UNIQUE KEY uq_delivery_contract_refund(procurement_delivery_contract_id),
 ADD CONSTRAINT fk_refund_procurement_review FOREIGN KEY(procurement_settlement_review_id) REFERENCES procurement_settlement_reviews(id),
 ADD CONSTRAINT fk_refund_delivery_contract FOREIGN KEY(procurement_delivery_contract_id) REFERENCES procurement_delivery_payment_contracts(id);
ALTER TABLE supplier_disbursement_instructions ADD COLUMN procurement_settlement_review_id BIGINT NULL,
 ADD CONSTRAINT fk_disbursement_procurement_review FOREIGN KEY(procurement_settlement_review_id) REFERENCES procurement_settlement_reviews(id);
