-- =============================================================================
-- Migration 030 Rollback: Pool Coverage Policy Reconciliation & Destination Identity Binding
-- MilJor Phase 6D.3.3
-- =============================================================================

ALTER TABLE delivery_quotes
  DROP COLUMN destination_fingerprint;

ALTER TABLE buyer_delivery_addresses
  DROP COLUMN revision;
