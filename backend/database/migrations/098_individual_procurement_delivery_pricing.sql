-- Forward-only. Do not backfill rates or alter accepted delivery evidence.
ALTER TABLE supplier_delivery_configurations
  ADD COLUMN individual_delivery_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE supplier_delivery_cluster_rates
  MODIFY mode ENUM('STANDARD_CLUSTERED','EXPRESS','INDIVIDUAL') NOT NULL;
ALTER TABLE delivery_quotes
  MODIFY mode ENUM('STANDARD_CLUSTERED','PICKUP','EXPRESS','INDIVIDUAL') NOT NULL,
  ADD COLUMN supplier_rate_version INT NULL;
-- No rollback is safe once INDIVIDUAL quotes exist; disable future offers via
-- supplier configuration instead. Main must validate this DDL on miljor_test_db.
