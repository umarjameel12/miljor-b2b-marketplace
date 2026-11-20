-- Forward-only operational delivery records; never reprice an accepted order.
ALTER TABLE procurement_order_delivery_choices
 MODIFY delivery_address_id BIGINT NULL,
 MODIFY mode ENUM('STANDARD_CLUSTERED','INDIVIDUAL','EXPRESS','PICKUP') NOT NULL,
 ADD COLUMN terms_snapshot JSON NULL,
 ADD COLUMN choice_revision INT NOT NULL DEFAULT 1;
CREATE TABLE procurement_delivery_choice_events (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 choice_id BIGINT NOT NULL,
 buyer_id INT NOT NULL,
 revision INT NOT NULL,
 event_key VARCHAR(120) NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 response_snapshot JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_delivery_choice_intent(buyer_id,event_key),
 UNIQUE KEY uq_delivery_choice_revision(choice_id,revision),
 FOREIGN KEY(choice_id) REFERENCES procurement_order_delivery_choices(id),
 FOREIGN KEY(buyer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE procurement_delivery_vehicles (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 supplier_id INT NOT NULL,
 vehicle_reference VARCHAR(100) NOT NULL,
 max_weight_kg DECIMAL(12,4) NOT NULL,
 max_volume_l DECIMAL(12,4) NOT NULL,
 handling_class ENUM('AMBIENT','CHILLED','FROZEN') NOT NULL,
 version_number INT NOT NULL DEFAULT 1,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_delivery_vehicle_supplier(supplier_id,vehicle_reference),
 FOREIGN KEY(supplier_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE procurement_delivery_runs MODIFY mode ENUM('STANDARD_CLUSTERED','INDIVIDUAL','EXPRESS') NOT NULL,
 ADD COLUMN vehicle_id INT NULL,
 ADD KEY idx_run_vehicle_window(vehicle_id,delivery_day,status),
 ADD CONSTRAINT fk_run_vehicle FOREIGN KEY(vehicle_id) REFERENCES procurement_delivery_vehicles(id);
ALTER TABLE procurement_delivery_stops DROP INDEX uq_proc_o_stop_order,
 ADD COLUMN is_current TINYINT(1) NOT NULL DEFAULT 1,
 ADD COLUMN current_order_key INT GENERATED ALWAYS AS (CASE WHEN is_current=1 THEN order_id ELSE NULL END) STORED,
 ADD UNIQUE KEY uq_delivery_current_stop(current_order_key),
 ADD KEY idx_delivery_stop_history(order_id,id);
CREATE TABLE procurement_delivery_run_events (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 run_id BIGINT NOT NULL,
 order_id INT NULL,
 actor_id INT NOT NULL,
 event_type VARCHAR(50) NOT NULL,
 event_key VARCHAR(120) NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 event_snapshot JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_delivery_run_event(run_id,event_key),
 FOREIGN KEY(run_id) REFERENCES procurement_delivery_runs(id),
 FOREIGN KEY(order_id) REFERENCES orders(id),
 FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE procurement_delivery_evidence (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 uploader_id INT NOT NULL,
 proof_code VARCHAR(40) NOT NULL,
 mime_type VARCHAR(40) NOT NULL,
 byte_length INT UNSIGNED NOT NULL,
 content_sha256 CHAR(64) NOT NULL,
 content_bytes MEDIUMBLOB NOT NULL,
 idempotency_key VARCHAR(120) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_delivery_proof_code(proof_code),
 UNIQUE KEY uq_delivery_proof_intent(uploader_id,idempotency_key),
 FOREIGN KEY(order_id) REFERENCES orders(id),
 FOREIGN KEY(uploader_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE procurement_delivery_attempts (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 attempt_code VARCHAR(40) NOT NULL,
 failure_reason VARCHAR(60) NOT NULL,
 failure_description VARCHAR(2000) NOT NULL,
 status ENUM('FAILED','PROPOSED','APPROVED','APPROVED_PAYMENT_REQUIRED','RESUMED','CANCELLED') NOT NULL DEFAULT 'FAILED',
 proposed_start_utc DATETIME NULL,
 proposed_end_utc DATETIME NULL,
 extra_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
 supplier_key VARCHAR(120) NOT NULL,
 failure_hash CHAR(64) NOT NULL,
 proposal_version INT NOT NULL DEFAULT 0,
 proposal_snapshot JSON NULL,
 buyer_consent_snapshot JSON NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_delivery_attempt_code(attempt_code),
 UNIQUE KEY uq_delivery_attempt_intent(order_id,supplier_key),
 FOREIGN KEY(order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE procurement_delivery_attempt_events (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 attempt_id BIGINT NOT NULL,
 actor_id INT NOT NULL,
 event_type VARCHAR(50) NOT NULL,
 event_key VARCHAR(120) NOT NULL,
 payload_hash CHAR(64) NOT NULL,
 event_snapshot JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_delivery_attempt_event(attempt_id,event_key),
 FOREIGN KEY(attempt_id) REFERENCES procurement_delivery_attempts(id),
 FOREIGN KEY(actor_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
