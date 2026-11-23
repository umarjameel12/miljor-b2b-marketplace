-- Rollback for 101_ucp_replacement_supplier_offer_and_qty_binding.sql (isolated test verification only)
ALTER TABLE supplier_replacement_quotes
  DROP FOREIGN KEY fk_repl_sup_acceptor,
  DROP COLUMN supplier_offer_idempotency_key,
  DROP COLUMN supplier_offer_hash,
  DROP COLUMN supplier_accepted_at,
  DROP COLUMN supplier_accepted_by,
  DROP COLUMN supplier_offer_status;
