-- Rollback 104. Run only after all payments-v3-minor attempts are reconciled
-- or archived and no active v3 payment attempt remains.
ALTER TABLE payment_attempts
  DROP COLUMN provider_contract;
