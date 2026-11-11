-- =============================================================================
-- Migration 035 Rollback: Package E3–E6 Complete Marketplace Schema Rollback
-- =============================================================================

DROP TABLE IF EXISTS sponsored_campaigns;
DROP TABLE IF EXISTS in_app_messages;
DROP TABLE IF EXISTS in_app_conversations;
DROP TABLE IF EXISTS order_reviews;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS demand_pool_requests;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_profiles' AND COLUMN_NAME = 'subscription_status');
SET @sqlstmt := IF(@exist > 0, 'ALTER TABLE supplier_profiles DROP COLUMN subscription_status', 'SELECT 1');
PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS supplier_subscriptions;
DROP TABLE IF EXISTS subscription_plans;
