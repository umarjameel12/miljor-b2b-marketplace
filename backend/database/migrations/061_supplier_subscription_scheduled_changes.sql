-- Forward-only migration. Subscription changes are scheduled; historical rows remain immutable except cancellation flags.
ALTER TABLE supplier_subscriptions
  ADD COLUMN pending_plan_code VARCHAR(32) NULL AFTER auto_renew,
  ADD INDEX idx_supplier_subscription_pending (pending_plan_code, current_period_end);

-- Paid plan checkout/renewal integration is deliberately NOT enabled here.
-- Existing 035 enum states and payment gates remain authoritative.
