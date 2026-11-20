-- PR61 Part 1: private append-only supplier evidence (no public URLs).
-- Uploads are separate from profile draft fields; prior versions are never overwritten.
CREATE TABLE supplier_verification_documents (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  document_kind ENUM('BUSINESS_LICENSE','TAX_CERTIFICATE','WAREHOUSE_PROOF','BANK_PROOF') NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  review_revision INT UNSIGNED NOT NULL DEFAULT 0,
  original_name VARCHAR(120) NOT NULL,
  mime_type ENUM('application/pdf','image/png','image/jpeg') NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  contents MEDIUMBLOB NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_supplier_evidence_owner FOREIGN KEY(supplier_id) REFERENCES users(id),
  UNIQUE KEY uq_supplier_evidence_version(supplier_id,document_kind,version_number),
  UNIQUE KEY uq_supplier_evidence_idempotency(supplier_id,idempotency_key),
  KEY idx_supplier_evidence_latest(supplier_id,document_kind,version_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
