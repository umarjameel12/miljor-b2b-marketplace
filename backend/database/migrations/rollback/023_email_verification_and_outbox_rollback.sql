-- =============================================================================
-- Migration 023 Rollback: Email Verification and Transactional Outbox
-- MilJor Part 4E.10
-- =============================================================================

DROP TABLE IF EXISTS `transactional_email_outbox`;
DROP TABLE IF EXISTS `email_verifications`;
