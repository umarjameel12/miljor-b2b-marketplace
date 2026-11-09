-- =============================================================================
-- Migration Rollback 032: Revert Supplier Profile Onboarding & Verification Fields
-- =============================================================================

ALTER TABLE supplier_profiles
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS submitted_at,
  DROP COLUMN IF EXISTS rejection_reason,
  DROP COLUMN IF EXISTS bank_iban,
  DROP COLUMN IF EXISTS bank_account_title,
  DROP COLUMN IF EXISTS bank_name,
  DROP COLUMN IF EXISTS lahore_service_area,
  DROP COLUMN IF EXISTS warehouse_address,
  DROP COLUMN IF EXISTS contact_person_phone,
  DROP COLUMN IF EXISTS contact_person_name,
  DROP COLUMN IF EXISTS business_description,
  DROP COLUMN IF EXISTS food_license_type,
  DROP COLUMN IF EXISTS business_type;

DELETE FROM schema_migrations WHERE version = '032';
