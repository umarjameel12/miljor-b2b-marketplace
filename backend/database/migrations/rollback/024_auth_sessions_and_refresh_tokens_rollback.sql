-- =============================================================================
-- Migration 024 Rollback: Secure Authentication Sessions & Refresh Tokens
-- MilJor Phase 6C
-- =============================================================================

DROP TABLE IF EXISTS `user_refresh_tokens`;
DROP TABLE IF EXISTS `user_sessions`;
