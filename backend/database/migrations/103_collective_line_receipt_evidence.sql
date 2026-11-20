-- PR61 Part 2: buyer-owned receipt evidence per immutable SKU line.
-- Shortages become blocked disputes, NOT automatic refunds or supplier payouts.
CREATE TABLE procurement_collective_receipt_submissions (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 buyer_id INT NOT NULL,
 supplier_id INT NOT NULL,
 status ENUM('BUYER_CONFIRMED','EXCEPTION') NOT NULL,
 shortage_value DECIMAL(14,2) NOT NULL DEFAULT 0.00,
 idempotency_key VARCHAR(120) NOT NULL,
 request_hash CHAR(64) NOT NULL,
 immutable_summary JSON NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_pr61_receipt_order (order_id),
 UNIQUE KEY uq_pr61_receipt_buyer_key (buyer_id,idempotency_key),
 CONSTRAINT fk_pr61_receipt_order FOREIGN KEY(order_id) REFERENCES orders(id),
 CONSTRAINT fk_pr61_receipt_buyer FOREIGN KEY(buyer_id) REFERENCES users(id),
 CONSTRAINT fk_pr61_receipt_supplier FOREIGN KEY(supplier_id) REFERENCES users(id),
 CONSTRAINT chk_pr61_receipt_no_negative CHECK(shortage_value>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE procurement_collective_receipt_lines (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 receipt_id BIGINT NOT NULL,
 collective_order_line_id BIGINT NOT NULL,
 ordered_quantity DECIMAL(12,4) NOT NULL,
 received_quantity DECIMAL(12,4) NOT NULL,
 shortage_quantity DECIMAL(12,4) NOT NULL,
 unit VARCHAR(30) NOT NULL,
 locked_unit_price DECIMAL(12,2) NOT NULL,
 shortage_value DECIMAL(14,2) NOT NULL,
 immutable_snapshot JSON NOT NULL,
 UNIQUE KEY uq_pr61_receipt_line (receipt_id,collective_order_line_id),
 CONSTRAINT fk_pr61_receipt_line_parent FOREIGN KEY(receipt_id) REFERENCES procurement_collective_receipt_submissions(id),
 CONSTRAINT fk_pr61_receipt_line_contract FOREIGN KEY(collective_order_line_id) REFERENCES procurement_collective_order_lines(id),
 CONSTRAINT chk_pr61_receipt_qty CHECK(ordered_quantity>=received_quantity AND received_quantity>=0 AND shortage_quantity>=0),
 CONSTRAINT chk_pr61_receipt_value CHECK(shortage_value>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
