-- PR61 Part 1: revision-specific supplier verification decisions and field-scoped corrections.
-- Forward-only; reviewed against migration journal before applying to disposable MySQL.
ALTER TABLE supplier_profiles
  ADD COLUMN submitted_revision INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN correction_fields JSON NULL,
  ADD COLUMN correction_notes JSON NULL,
  ADD COLUMN correction_requested_revision INT UNSIGNED NULL,
  ADD COLUMN correction_requested_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS supplier_verification_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  revision INT UNSIGNED NOT NULL,
  submitted_snapshot JSON NOT NULL,
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  review_action ENUM('PENDING','APPROVED','REQUEST_INFO','REJECTED') NOT NULL DEFAULT 'PENDING',
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  review_reason TEXT NULL,
  UNIQUE KEY uq_supplier_review_revision (supplier_id, revision),
  KEY idx_supplier_review_latest (supplier_id,submitted_at),
  CONSTRAINT fk_supplier_review_supplier FOREIGN KEY (supplier_id) REFERENCES users(id),
  CONSTRAINT fk_supplier_review_admin FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
