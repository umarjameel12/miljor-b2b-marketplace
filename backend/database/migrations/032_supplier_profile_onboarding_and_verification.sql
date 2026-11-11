-- =============================================================================
-- Migration 032: Supplier Profile Onboarding & Verification Enhancements
-- MilJor Package E1: Supplier Marketplace Profile, Verification & Banking
-- Preserves all existing supplier_profiles rows (1, 2, 3, 13) and foreign keys
-- =============================================================================

ALTER TABLE supplier_profiles
  ADD COLUMN business_type VARCHAR(50) NULL AFTER supplier_id,
  ADD COLUMN food_license_type VARCHAR(50) NULL DEFAULT 'PUNJAB_FOOD_AUTHORITY' AFTER food_license_no,
  ADD COLUMN business_description TEXT NULL AFTER food_license_type,
  ADD COLUMN contact_person_name VARCHAR(100) NULL AFTER business_description,
  ADD COLUMN contact_person_phone VARCHAR(20) NULL AFTER contact_person_name,
  ADD COLUMN warehouse_address TEXT NULL AFTER contact_person_phone,
  ADD COLUMN lahore_service_area VARCHAR(100) NULL AFTER warehouse_address,
  ADD COLUMN bank_name VARCHAR(100) NULL AFTER lahore_service_area,
  ADD COLUMN bank_account_title VARCHAR(150) NULL AFTER bank_name,
  ADD COLUMN bank_iban VARCHAR(150) NULL AFTER bank_account_title,
  ADD COLUMN rejection_reason TEXT NULL AFTER bank_iban,
  ADD COLUMN submitted_at TIMESTAMP NULL AFTER rejection_reason,
  ADD COLUMN verified_at TIMESTAMP NULL AFTER submitted_at,
  ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER verified_at;
