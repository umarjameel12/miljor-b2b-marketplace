-- NON-EXECUTABLE PROPOSAL: intentionally kept OUTSIDE database/migrations.
-- Do not execute, rename to a numbered migration, or apply to miljor_db.
-- Integration requires independent B6 046/047/048 reconciliation, checksums,
-- schema history verification on miljor_test_db and an approved migration number.
--
-- This column represents the supplier COMMISSION PERCENT accepted when an
-- order is CREATED. It is not the buyer fee and not a settlement-time rate.
--
-- Proposed forward-only DDL:
ALTER TABLE orders
  ADD COLUMN supplier_commission_percent DECIMAL(5,2) NULL
  COMMENT 'Order-time immutable supplier commission percentage (0.00 through 100.00)';
--
-- NULL is deliberate for existing historic orders: there is NO trustworthy
-- assumption that today's supplier_profiles rate was the historical rate.
-- Do not auto-backfill from the mutable supplier profile, current subscriptions
-- or an invented 2.50 percent fallback.
-- For rows with NULL, supplier payable accrual MUST remain blocked until a
-- separately verified historic rate is proven and reconciled.
--
-- Before executing in isolated test DB, confirm existing column absence with
-- INFORMATION_SCHEMA, prove schema history, rehearse backup restore, and add
-- an approved check constraint (0 <= rate <= 100) supported by target MySQL.
-- Use a named migration number only after B6 046-048 and catalog 046-047
-- collision have been formally reconciled. Avoid non-atomic DDL replay.
