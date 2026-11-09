-- =============================================================================
-- Migration Rollback 022: Rollback Financial Settlement & Reconciliation
-- Phase: MilJor Part 4E.6
-- Purpose:
-- Safely drop tables introduced by Migration 022 in reverse dependency order.
-- =============================================================================

DROP TABLE IF EXISTS financial_audit_events;
DROP TABLE IF EXISTS provider_settlement_batches;
DROP TABLE IF EXISTS supplier_disbursement_instructions;
DROP TABLE IF EXISTS refund_obligations;
DROP TABLE IF EXISTS financial_holds;
DROP TABLE IF EXISTS supplier_payables;
