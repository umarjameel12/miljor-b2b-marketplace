-- Preserve failed attempts; serialize only the active attempt for each contract.
ALTER TABLE payment_attempts DROP INDEX uq_delivery_contract_attempt,
 ADD KEY idx_delivery_contract_attempt_history(procurement_delivery_contract_id,id),
 ADD COLUMN active_delivery_contract_id BIGINT GENERATED ALWAYS AS (
   CASE WHEN procurement_delivery_contract_id IS NOT NULL AND status='INITIATED'
   THEN procurement_delivery_contract_id ELSE NULL END) STORED,
 ADD UNIQUE KEY uq_active_delivery_contract_attempt(active_delivery_contract_id);
