-- B6-N: recurring collective cohorts and cycle snapshots.
-- Apply AFTER 045 only on an independently backed-up miljor_test_db.
-- No charge, order or allocation is created by these relations.
CREATE TABLE IF NOT EXISTS procurement_recurring_collectives (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 organizer_buyer_id INT NOT NULL,
 organizer_contract_id BIGINT NOT NULL,
 status ENUM('FORMING','ACTIVE','PAUSED','CANCELLED') NOT NULL DEFAULT 'FORMING',
 minimum_buyers SMALLINT UNSIGNED NOT NULL,
 join_cutoff_minutes INT UNSIGNED NOT NULL DEFAULT 60,
 quote_window_minutes INT UNSIGNED NOT NULL DEFAULT 1440,
 consent_version INT NOT NULL DEFAULT 1,
 create_idempotency_key VARCHAR(120) NOT NULL,
 create_payload_hash CHAR(64) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT fk_rec_cohort_owner FOREIGN KEY (organizer_buyer_id) REFERENCES users(id),
 CONSTRAINT fk_rec_cohort_contract FOREIGN KEY (organizer_contract_id) REFERENCES procurement_recurring_contracts(id),
 UNIQUE KEY uq_rec_cohort_idem (organizer_buyer_id,create_idempotency_key),
 KEY idx_rec_cohort_status (status,organizer_contract_id),
 CONSTRAINT chk_rec_cohort_buyers CHECK (minimum_buyers >= 2),
 CONSTRAINT chk_rec_cohort_cutoff CHECK (join_cutoff_minutes BETWEEN 5 AND 10080)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_recurring_collective_members (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 cohort_id BIGINT NOT NULL,
 buyer_id INT NOT NULL,
 recurring_contract_id BIGINT NULL,
 status ENUM('INVITED','CONSENTED','LEFT') NOT NULL DEFAULT 'INVITED',
 consent_key VARCHAR(120) NULL,
 consent_hash CHAR(64) NULL,
 consent_snapshot JSON NULL,
 consent_at TIMESTAMP NULL DEFAULT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT fk_rec_cohort_member FOREIGN KEY (cohort_id) REFERENCES procurement_recurring_collectives(id),
 CONSTRAINT fk_rec_cohort_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
 CONSTRAINT fk_rec_cohort_member_contract FOREIGN KEY (recurring_contract_id) REFERENCES procurement_recurring_contracts(id),
 UNIQUE KEY uq_rec_cohort_buyer (cohort_id,buyer_id),
 KEY idx_rec_cohort_member_status (buyer_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_recurring_collective_cycles (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 cohort_id BIGINT NOT NULL,
 organizer_cycle_id BIGINT NOT NULL,
 cycle_key CHAR(10) NOT NULL,
 status ENUM('PREPARING','INVITING','UNQUALIFIED','FAILED','CANCELLED') NOT NULL,
 request_id BIGINT NULL,
 group_id BIGINT NULL,
 qualifying_buyer_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
 qualification_snapshot JSON NOT NULL,
 failure_code VARCHAR(100) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT fk_rec_collective_cycle_cohort FOREIGN KEY (cohort_id) REFERENCES procurement_recurring_collectives(id),
 CONSTRAINT fk_rec_collective_cycle_key FOREIGN KEY (organizer_cycle_id) REFERENCES procurement_recurring_cycles(id),
 CONSTRAINT fk_rec_collective_cycle_request FOREIGN KEY (request_id) REFERENCES procurement_requests(id),
 CONSTRAINT fk_rec_collective_cycle_group FOREIGN KEY (group_id) REFERENCES procurement_collective_groups(id),
 UNIQUE KEY uq_rec_collective_cycle (cohort_id,cycle_key),
 UNIQUE KEY uq_rec_collective_organizer_cycle (cohort_id,organizer_cycle_id),
 UNIQUE KEY uq_rec_collective_group (group_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
