-- B6-L/M: standing procurement schedules and idempotent recurring cycle keys.
-- Apply to backed-up miljor_test_db only, after migration 041.
-- Scheduling creates NO payable order, Safepay attempt or payment authorization.
CREATE TABLE IF NOT EXISTS procurement_recurring_contracts (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  contract_code VARCHAR(60) NOT NULL,
  buyer_id INT NOT NULL,
  template_request_id BIGINT NOT NULL,
  cadence ENUM('WEEKLY','MONTHLY') NOT NULL,
  weekday_number TINYINT UNSIGNED NULL,
  month_day TINYINT UNSIGNED NULL,
  month_end_policy ENUM('LAST_DAY','SKIP_MONTH') NOT NULL DEFAULT 'LAST_DAY',
  local_run_time TIME NOT NULL,
  timezone_name VARCHAR(60) NOT NULL DEFAULT 'Asia/Karachi',
  starts_on DATE NOT NULL,
  ends_on DATE NULL,
  payment_policy ENUM('EXPLICIT_PER_CYCLE') NOT NULL DEFAULT 'EXPLICIT_PER_CYCLE',
  pricing_policy ENUM('REQUOTE_EACH_CYCLE') NOT NULL DEFAULT 'REQUOTE_EACH_CYCLE',
  status ENUM('DRAFT','ACTIVE','PAUSED','CANCELLED','EXPIRED') NOT NULL DEFAULT 'DRAFT',
  created_idempotency_key VARCHAR(120) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  original_response_snapshot JSON NULL,
  version_number INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_proc_recurring_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
  CONSTRAINT fk_proc_recurring_template FOREIGN KEY (template_request_id) REFERENCES procurement_requests(id),
  CONSTRAINT uq_proc_recurring_code UNIQUE (contract_code),
  CONSTRAINT uq_proc_recurring_buyer_key UNIQUE (buyer_id,created_idempotency_key),
  CONSTRAINT chk_proc_recurring_monthday CHECK (month_day IS NULL OR (month_day>=1 AND month_day<=31)),
  CONSTRAINT chk_proc_recurring_weekday CHECK (weekday_number IS NULL OR weekday_number<=6),
  CONSTRAINT chk_proc_recurring_date_range CHECK (ends_on IS NULL OR ends_on>=starts_on),
  KEY idx_proc_recurring_due (status,starts_on,ends_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_recurring_cycles (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  contract_id BIGINT NOT NULL,
  buyer_id INT NOT NULL,
  cycle_key CHAR(10) NOT NULL,
  due_at_utc DATETIME NOT NULL,
  status ENUM('SCHEDULED','PREPARING','AWAITING_BUYER_APPROVAL','SKIPPED','FAILED','AWARDED','PAYMENT_PENDING','PAID','FULFILLING','COMPLETED') NOT NULL DEFAULT 'SCHEDULED',
  contract_version INT NOT NULL,
  contract_snapshot JSON NOT NULL,
  failure_code VARCHAR(100) NULL,
  last_attempt_at TIMESTAMP NULL DEFAULT NULL,
  retry_after_utc DATETIME NULL,
  attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_proc_cycle_contract FOREIGN KEY (contract_id) REFERENCES procurement_recurring_contracts(id),
  CONSTRAINT fk_proc_cycle_buyer FOREIGN KEY (buyer_id) REFERENCES users(id),
  CONSTRAINT uq_proc_recurring_cycle UNIQUE (contract_id,cycle_key),
  KEY idx_proc_recurring_cycle_due (status,due_at_utc),
  KEY idx_proc_recurring_cycle_buyer (buyer_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS procurement_recurring_cycle_events (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cycle_id BIGINT NOT NULL,
  event_key VARCHAR(120) NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  event_snapshot JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_proc_cycle_event_cycle FOREIGN KEY (cycle_id) REFERENCES procurement_recurring_cycles(id),
  CONSTRAINT uq_proc_cycle_event_key UNIQUE (cycle_id,event_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
