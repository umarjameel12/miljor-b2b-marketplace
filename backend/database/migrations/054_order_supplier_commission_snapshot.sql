-- Canonical forward-only commission snapshot; never copy competing finance 052.
-- Historical orders intentionally remain NULL: no retrospective mutable-profile backfill.
-- Commission migrations must be applied only by guarded test/production migration runners
-- after canonical B6 046-048 and UCP 051-053 SHA/history validation.
ALTER TABLE orders
  ADD COLUMN supplier_commission_percent DECIMAL(5,2) NULL
  COMMENT 'Immutable contracted order-time commission percentage; NULL means unverified historical terms';
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_supplier_commission_snapshot
  CHECK (supplier_commission_percent IS NULL OR
         (supplier_commission_percent >= 0 AND supplier_commission_percent <= 100));
