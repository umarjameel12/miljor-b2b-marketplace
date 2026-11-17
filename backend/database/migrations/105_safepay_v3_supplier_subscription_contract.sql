-- Pin the amount denomination for every independent supplier subscription attempt.
-- Existing legacy Safepay attempts remain major-unit; v3 attempts use integer minor units.
ALTER TABLE supplier_subscription_checkout_attempts
  ADD COLUMN provider_contract ENUM('legacy-v1-major','payments-v3-minor')
    NOT NULL DEFAULT 'legacy-v1-major'
    AFTER currency;
