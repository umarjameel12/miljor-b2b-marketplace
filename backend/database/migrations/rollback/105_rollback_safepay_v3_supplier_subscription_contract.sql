-- Run only after all supplier subscription v3 attempts are reconciled/archived.
ALTER TABLE supplier_subscription_checkout_attempts
  DROP COLUMN provider_contract;
