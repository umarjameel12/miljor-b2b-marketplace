-- Forward-only collective commitments. Reuses existing shared stock ledger.
-- Apply through the canonical runner only to backed-up miljor_test_db.
CREATE TABLE procurement_collective_commitments (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 group_id BIGINT NOT NULL,
 approval_id BIGINT NOT NULL,
 buyer_id INT NOT NULL,
 bid_version_id BIGINT NOT NULL,
 request_id BIGINT NULL,
 award_id BIGINT NULL,
 status ENUM('HELD','ORDERED','RELEASED') NOT NULL DEFAULT 'HELD',
 expires_at DATETIME NOT NULL,
 consent_snapshot JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_collective_commitment_approval(approval_id),
 UNIQUE KEY uq_collective_commitment_request(request_id),
 UNIQUE KEY uq_collective_commitment_award(award_id),
 KEY idx_collective_commitment_expiry(status,expires_at),
 FOREIGN KEY(group_id) REFERENCES procurement_collective_groups(id),
 FOREIGN KEY(approval_id) REFERENCES procurement_collective_buyer_approvals(id),
 FOREIGN KEY(buyer_id) REFERENCES users(id),
 FOREIGN KEY(bid_version_id) REFERENCES procurement_collective_bid_versions(id),
 FOREIGN KEY(request_id) REFERENCES procurement_requests(id),
 FOREIGN KEY(award_id) REFERENCES procurement_awards(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE procurement_collective_capacity (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 commitment_id INT NOT NULL,
 supplier_listing_id INT NOT NULL,
 allocation_id INT NOT NULL,
 quantity DECIMAL(12,4) NOT NULL,
 unit VARCHAR(30) NOT NULL,
 UNIQUE KEY uq_collective_capacity_listing(commitment_id,supplier_listing_id),
 UNIQUE KEY uq_collective_capacity_allocation(allocation_id),
 FOREIGN KEY(commitment_id) REFERENCES procurement_collective_commitments(id),
 FOREIGN KEY(supplier_listing_id) REFERENCES supplier_listings(id),
 FOREIGN KEY(allocation_id) REFERENCES supplier_inventory_allocations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE procurement_requests ADD COLUMN collective_commitment_id INT NULL,
 ADD UNIQUE KEY uq_request_collective_commitment(collective_commitment_id),
 ADD CONSTRAINT fk_request_collective_commitment FOREIGN KEY(collective_commitment_id) REFERENCES procurement_collective_commitments(id);
