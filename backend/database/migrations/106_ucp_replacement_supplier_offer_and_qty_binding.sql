-- 101 Completion Phase 1 Hardening: Supplier Authorized Acceptance & Hash on Replacement Quotes
-- Forward-only migration; preserves 100 and all prior migrations.

ALTER TABLE supplier_replacement_quotes
  ADD COLUMN supplier_offer_status ENUM('PENDING_SUPPLIER_ACCEPTANCE', 'SUPPLIER_ACCEPTED', 'SUPPLIER_DECLINED') NOT NULL DEFAULT 'PENDING_SUPPLIER_ACCEPTANCE' AFTER status,
  ADD COLUMN supplier_accepted_by INT NULL AFTER supplier_offer_status,
  ADD COLUMN supplier_accepted_at DATETIME NULL AFTER supplier_accepted_by,
  ADD COLUMN supplier_offer_hash CHAR(64) NULL AFTER supplier_accepted_at,
  ADD COLUMN supplier_offer_idempotency_key VARCHAR(120) NULL AFTER supplier_offer_hash,
  ADD CONSTRAINT fk_repl_sup_acceptor FOREIGN KEY (supplier_accepted_by) REFERENCES users(id) ON DELETE SET NULL;
