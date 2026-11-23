-- =============================================================================
-- Migration 111: Supplier Subscription Final Monthly Pricing Correction
-- Authoritative monthly prices: STARTER=0.00, GROWTH=2999.00, BUSINESS=5499.00
-- Preserves family limits (4/13/25), transaction fees (3.00%/2.00%/1.50%),
-- annual billing disabled status, and all historical subscription/payment rows.
-- =============================================================================

UPDATE subscription_plans
SET monthly_price_pkr = 0.00,
    updated_at = NOW()
WHERE plan_code = 'STARTER';

UPDATE subscription_plans
SET monthly_price_pkr = 2999.00,
    updated_at = NOW()
WHERE plan_code = 'GROWTH';

UPDATE subscription_plans
SET monthly_price_pkr = 5499.00,
    updated_at = NOW()
WHERE plan_code = 'BUSINESS';
