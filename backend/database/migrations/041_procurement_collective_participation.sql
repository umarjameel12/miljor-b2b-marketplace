-- B6-I/J/K: isolated collective participation and compatibility foundation.
-- Apply on miljor_test_db ONLY after migrations 037–040, schema backup and review.
-- No buyer is committed or charged by these records. Group awards/payment come later.
CREATE TABLE IF NOT EXISTS procurement_collective_groups (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT NOT NULL,
  organizer_buyer_id INT NOT NULL,
  visibility ENUM('PRIVATE_INVITE','CONTROLLED_DISCOVERY') NOT NULL DEFAULT 'PRIVATE_INVITE',
  qualification_policy ENUM('ALL_OR_NOTHING','EXPLICIT_PARTIAL') NOT NULL DEFAULT 'ALL_OR_NOTHING',
  status ENUM('DRAFT','FORMING','JOIN_CLOSED','QUOTING','QUALIFIED','CANCELLED','FAILED') NOT NULL DEFAULT 'DRAFT',
  minimum_buyers SMALLINT UNSIGNED NOT NULL DEFAULT 2,
  join_deadline DATETIME NOT NULL,
  qualification_snapshot JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_proc_collective_request FOREIGN KEY (request_id) REFERENCES procurement_requests(id),
  CONSTRAINT fk_proc_collective_organizer FOREIGN KEY (organizer_buyer_id) REFERENCES users(id),
  CONSTRAINT uq_proc_collective_request UNIQUE (request_id),
  CONSTRAINT chk_proc_collective_minimum CHECK (minimum_buyers>=2),
  KEY idx_proc_collective_state (status,join_deadline)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_collective_participants (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT NOT NULL,
  buyer_id INT NOT NULL,
  status ENUM('INVITED','JOINED','LEFT','LOCKED','EXPIRED') NOT NULL DEFAULT 'INVITED',
  join_idempotency_key VARCHAR(120) NULL,
  consent_snapshot JSON NULL,
  consent_at TIMESTAMP NULL DEFAULT NULL,
  left_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_proc_participant_group FOREIGN KEY (group_id) REFERENCES procurement_collective_groups(id),
  CONSTRAINT fk_proc_participant_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
  CONSTRAINT uq_proc_participant_buyer UNIQUE (group_id,buyer_id),
  KEY idx_proc_participant_buyer (buyer_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_collective_participant_lines (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  participant_id BIGINT NOT NULL,
  request_item_id BIGINT NOT NULL,
  quantity DECIMAL(12,4) NOT NULL,
  purchasing_unit VARCHAR(30) NOT NULL,
  requirement_snapshot JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_proc_participant_line_participant FOREIGN KEY (participant_id)
    REFERENCES procurement_collective_participants(id),
  CONSTRAINT fk_proc_participant_line_item FOREIGN KEY (request_item_id)
    REFERENCES procurement_request_items(id),
  CONSTRAINT uq_proc_participant_item UNIQUE (participant_id,request_item_id),
  CONSTRAINT chk_proc_participant_quantity CHECK (quantity>0),
  KEY idx_proc_participant_line_item (request_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
