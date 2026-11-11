-- Integration version 052. FORWARD-ONLY additive snapshot, no data backfill.
-- SAFETY: only apply after 046-051 reconciled, verified isolated backup,
-- and proof from schema_migrations + schema_migration_attempts on miljor_test_db.
-- Current supplier_profiles fees are mutable and MUST NOT be used to backfill
-- historic orders lacking a proven accepted order-time commission.
ALTER TABLE orders
  ADD COLUMN supplier_commission_percent DECIMAL(5,2) NULL
  COMMENT 'Accepted supplier commission at order creation; immutable historical rate';
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_supplier_commission_snapshot
  CHECK (
    supplier_commission_percent IS NULL OR
    (supplier_commission_percent >= 0 AND supplier_commission_percent <= 100)
  );
-- All new order creators must persist a non-NULL commission snapshot.
-- Historical orders remain NULL and their settlement is intentionally blocked
-- until separately authenticated historical terms have been reconciled.
