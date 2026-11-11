-- B6-O: buyer-authorized destinations and supplier-operated delivery runs.
-- Apply only after 046 and verified backup in miljor_test_db.
-- Immutable accepted order money; grouped runs never charge or pay the buyer.
CREATE TABLE IF NOT EXISTS procurement_order_delivery_choices (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 buyer_id INT NOT NULL,
 supplier_id INT NOT NULL,
 delivery_address_id BIGINT NOT NULL,
 cluster_id INT NOT NULL,
 delivery_day DATE NOT NULL,
 delivery_window VARCHAR(60) NOT NULL,
 mode ENUM('STANDARD_CLUSTERED','EXPRESS','PICKUP') NOT NULL,
 handling_class VARCHAR(32) NOT NULL DEFAULT 'AMBIENT',
 locked_delivery_fee DECIMAL(12,2) NOT NULL,
 address_version INT NOT NULL,
 supplier_config_version INT NOT NULL,
 acceptance_key VARCHAR(120) NOT NULL,
 acceptance_hash CHAR(64) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_proc_o_choice_order FOREIGN KEY (order_id) REFERENCES orders(id),
 CONSTRAINT fk_proc_o_choice_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
 CONSTRAINT fk_proc_o_choice_supplier FOREIGN KEY (supplier_id) REFERENCES users(id),
 CONSTRAINT fk_proc_o_choice_address FOREIGN KEY (delivery_address_id) REFERENCES buyer_delivery_addresses(id),
 CONSTRAINT fk_proc_o_choice_cluster FOREIGN KEY (cluster_id) REFERENCES geographic_clusters(id),
 CONSTRAINT uq_proc_o_choice_order UNIQUE (order_id),
 CONSTRAINT uq_proc_o_choice_idem UNIQUE (buyer_id,acceptance_key),
 CONSTRAINT chk_proc_o_choice_fee CHECK (locked_delivery_fee>=0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_delivery_runs (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 supplier_id INT NOT NULL,
 cluster_id INT NOT NULL,
 delivery_day DATE NOT NULL,
 delivery_window VARCHAR(60) NOT NULL,
 mode ENUM('STANDARD_CLUSTERED','EXPRESS') NOT NULL,
 handling_class VARCHAR(32) NOT NULL,
 status ENUM('PROPOSED','CONFIRMED','DISPATCHED','DELIVERED','EXCEPTION','CANCELLED') NOT NULL DEFAULT 'PROPOSED',
 locked_delivery_fee_total DECIMAL(14,2) NOT NULL,
 planned_stops SMALLINT UNSIGNED NOT NULL,
 idempotency_key VARCHAR(120) NOT NULL,
 request_hash CHAR(64) NOT NULL,
 snapshot JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT fk_proc_o_run_supplier FOREIGN KEY (supplier_id) REFERENCES users(id),
 CONSTRAINT fk_proc_o_run_cluster FOREIGN KEY (cluster_id) REFERENCES geographic_clusters(id),
 UNIQUE KEY uq_proc_o_run_idempotency (supplier_id,idempotency_key),
 KEY idx_proc_o_run_status (supplier_id,status,delivery_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_delivery_stops (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 run_id BIGINT NOT NULL,
 order_id INT NOT NULL,
 buyer_id INT NOT NULL,
 address_id BIGINT NOT NULL,
 locked_delivery_fee DECIMAL(12,2) NOT NULL,
 status ENUM('ASSIGNED','DISPATCHED','SUPPLIER_DELIVERED','BUYER_CONFIRMED','EXCEPTION') NOT NULL DEFAULT 'ASSIGNED',
 snapshot JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT fk_proc_o_stop_run FOREIGN KEY (run_id) REFERENCES procurement_delivery_runs(id),
 CONSTRAINT fk_proc_o_stop_order FOREIGN KEY (order_id) REFERENCES orders(id),
 CONSTRAINT fk_proc_o_stop_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
 CONSTRAINT fk_proc_o_stop_address FOREIGN KEY (address_id) REFERENCES buyer_delivery_addresses(id),
 UNIQUE KEY uq_proc_o_stop_order UNIQUE (order_id),
 KEY idx_proc_o_stop_run (run_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
