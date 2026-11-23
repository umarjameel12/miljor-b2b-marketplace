-- Forward-only migration 108 (from PR #61 104_safepay_v3_payment_contract.sql):
-- Pin the Safepay amount denomination to each durable payment attempt.
-- Legacy v1 stores PKR major units; Payments v3 stores provider webhook amounts
-- in integer minor units. The contract is immutable once an attempt is created.
ALTER TABLE payment_attempts
  ADD COLUMN provider_contract ENUM('legacy-v1-major','payments-v3-minor')
    NOT NULL DEFAULT 'legacy-v1-major'
    AFTER environment;
