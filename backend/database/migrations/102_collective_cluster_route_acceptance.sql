-- PR61 Part 2: supplier-proposed group route, independently approved by each buyer.
-- Stops reference existing paid order IDs; this schema never moves funds.
CREATE TABLE procurement_collective_delivery_routes (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 group_id BIGINT NOT NULL,
 run_id BIGINT NOT NULL,
 supplier_id INT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_pr61_group_route (group_id),
 UNIQUE KEY uq_pr61_run_reference (run_id),
 CONSTRAINT fk_pr61_route_group FOREIGN KEY (group_id) REFERENCES procurement_collective_groups(id),
 CONSTRAINT fk_pr61_route_run FOREIGN KEY (run_id) REFERENCES procurement_delivery_runs(id),
 CONSTRAINT fk_pr61_route_supplier FOREIGN KEY (supplier_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE procurement_collective_route_acceptances (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 route_id BIGINT NOT NULL,
 stop_id BIGINT NOT NULL,
 buyer_id INT NOT NULL,
 status ENUM('PENDING','ACCEPTED','REJECTED') NOT NULL DEFAULT 'PENDING',
 accepted_snapshot JSON NULL,
 accepted_at DATETIME NULL,
 rejection_reason VARCHAR(500) NULL,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_pr61_route_stop (stop_id),
 UNIQUE KEY uq_pr61_route_buyer (route_id,buyer_id),
 CONSTRAINT fk_pr61_route_consent_route FOREIGN KEY (route_id) REFERENCES procurement_collective_delivery_routes(id),
 CONSTRAINT fk_pr61_route_consent_stop FOREIGN KEY (stop_id) REFERENCES procurement_delivery_stops(id),
 CONSTRAINT fk_pr61_route_consent_buyer FOREIGN KEY (buyer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
