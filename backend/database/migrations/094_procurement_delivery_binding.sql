ALTER TABLE delivery_quotes
  ADD COLUMN procurement_request_id BIGINT NULL,
  ADD COLUMN procurement_quote_id BIGINT NULL,
  ADD COLUMN procurement_choice_key VARCHAR(120) NULL,
  ADD COLUMN procurement_choice_hash CHAR(64) NULL,
  ADD COLUMN procurement_pickup_snapshot JSON NULL,
  ADD CONSTRAINT fk_delivery_proc_request FOREIGN KEY(procurement_request_id) REFERENCES procurement_requests(id),
  ADD CONSTRAINT fk_delivery_proc_quote FOREIGN KEY(procurement_quote_id) REFERENCES procurement_quotes(id),
  ADD KEY idx_delivery_proc_scope(procurement_quote_id,buyer_id,status),
  ADD UNIQUE KEY uq_delivery_proc_intent(buyer_id,procurement_choice_key);

ALTER TABLE orders ADD COLUMN procurement_delivery_snapshot JSON NULL;
