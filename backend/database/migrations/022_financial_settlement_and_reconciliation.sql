-- =============================================================================
-- Migration 022: Financial Settlement, Refund, Supplier Payout & Reconciliation Foundation
-- Phase: MilJor Part 4E.6
-- Purpose:
-- 1. Create supplier_payables table for immutable tracking of supplier earnings,
--    platform commissions, delivery allocations, refund deductions, and balances.
-- 2. Create financial_holds table for freezing funds on active disputes, shortages,
--    and fulfillment exceptions.
-- 3. Create refund_obligations table for tracking buyer refund assessments,
--    administrative approvals, and external execution boundaries.
-- 4. Create supplier_disbursement_instructions table for internal payout preparation
--    and approval tracking with external execution disabled.
-- 5. Create provider_settlement_batches table for Safepay batch settlement tracking
--    and reconciliation.
-- 6. Create financial_audit_events table for immutable chronological audit trails.
-- =============================================================================

CREATE TABLE IF NOT EXISTS supplier_payables (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  payable_code VARCHAR(36) UNIQUE NOT NULL COMMENT 'Internal payable code, e.g. SPAY-ORD-123-...',
  order_id INT NOT NULL,
  supplier_id INT NOT NULL,
  payment_id INT NOT NULL,
  gross_amount DECIMAL(12,2) NOT NULL COMMENT 'Order subtotal portion payable',
  delivery_fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Delivery fee allocated to supplier',
  commission_rate_percent DECIMAL(5,2) NOT NULL DEFAULT 2.50 COMMENT 'Platform commission percentage',
  commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Platform fee deducted from gross',
  net_payable_amount DECIMAL(12,2) NOT NULL COMMENT 'Calculated entitlement: gross + delivery_fee - commission',
  refund_deduction_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Cumulative deductions from approved refunds',
  held_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Amount currently frozen under active financial holds',
  available_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Eligible available balance for disbursement',
  disbursed_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Confirmed disbursed amount',
  currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  status ENUM(
    'ACCRUED',
    'ON_HOLD',
    'PARTIALLY_HELD',
    'ELIGIBLE_FOR_DISBURSEMENT',
    'DISBURSEMENT_PREPARED',
    'FULLY_DISBURSED',
    'CANCELLED'
  ) NOT NULL DEFAULT 'ACCRUED',
  policy_status ENUM('APPROVED', 'POLICY_PENDING', 'MANUAL_REVIEW_REQUIRED') NOT NULL DEFAULT 'APPROVED',
  policy_notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_supplier_payables_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_payables_supplier FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_payables_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  INDEX idx_supplier_payables_lookup (supplier_id, status),
  INDEX idx_supplier_payables_order (order_id),
  INDEX idx_supplier_payables_payment (payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_holds (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  hold_code VARCHAR(36) UNIQUE NOT NULL COMMENT 'Internal hold code, e.g. HOLD-...',
  order_id INT NOT NULL,
  supplier_payable_id BIGINT NULL,
  dispute_id INT NULL,
  hold_amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  reason ENUM(
    'ACTIVE_DISPUTE',
    'SUPPLIER_SHORTAGE',
    'FULFILLMENT_EXCEPTION',
    'ADMINISTRATIVE_INVESTIGATION',
    'POLICY_VERIFICATION'
  ) NOT NULL,
  status ENUM('ACTIVE', 'RELEASED', 'FORFEITED_TO_REFUND', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  placed_by_role ENUM('SYSTEM', 'ADMIN') NOT NULL DEFAULT 'SYSTEM',
  placed_by_id INT NOT NULL,
  released_by_id INT NULL,
  released_at TIMESTAMP NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_financial_holds_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_financial_holds_payable FOREIGN KEY (supplier_payable_id) REFERENCES supplier_payables(id) ON DELETE SET NULL,
  CONSTRAINT fk_financial_holds_dispute FOREIGN KEY (dispute_id) REFERENCES order_disputes(id) ON DELETE SET NULL,
  INDEX idx_financial_holds_order (order_id, status),
  INDEX idx_financial_holds_dispute (dispute_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS refund_obligations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  refund_code VARCHAR(36) UNIQUE NOT NULL COMMENT 'Internal refund code, e.g. RFND-...',
  order_id INT NOT NULL,
  payment_id INT NOT NULL,
  buyer_id INT NOT NULL,
  dispute_id INT NULL,
  disputed_quantity DECIMAL(12,4) NULL,
  assessed_refund_amount DECIMAL(12,2) NOT NULL,
  fee_refund_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_refund_amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  refund_type ENUM('FULL', 'PARTIAL') NOT NULL,
  status ENUM(
    'REQUESTED',
    'UNDER_REVIEW',
    'APPROVED',
    'AWAITING_EXTERNAL_EXECUTION',
    'EXTERNAL_PROCESSING',
    'CONFIRMED',
    'FAILED',
    'RECONCILIATION_REQUIRED',
    'REJECTED'
  ) NOT NULL DEFAULT 'REQUESTED',
  external_execution_status ENUM('DISABLED', 'PENDING_AUTHORIZATION', 'SIMULATED') NOT NULL DEFAULT 'DISABLED',
  idempotency_key VARCHAR(100) UNIQUE NULL,
  approved_by INT NULL,
  approved_at TIMESTAMP NULL,
  confirmed_at TIMESTAMP NULL,
  external_reference VARCHAR(128) NULL,
  rejection_reason TEXT NULL,
  audit_notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_refund_obligations_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_obligations_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_obligations_buyer FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_refund_obligations_dispute FOREIGN KEY (dispute_id) REFERENCES order_disputes(id) ON DELETE SET NULL,
  INDEX idx_refund_obligations_order (order_id, status),
  INDEX idx_refund_obligations_buyer (buyer_id, status),
  INDEX idx_refund_obligations_payment (payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_disbursement_instructions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  disbursement_code VARCHAR(36) UNIQUE NOT NULL COMMENT 'Internal disbursement instruction code, e.g. DISB-...',
  supplier_id INT NOT NULL,
  supplier_payable_id BIGINT NOT NULL,
  order_id INT NOT NULL,
  beneficiary_title VARCHAR(128) NOT NULL,
  beneficiary_iban VARCHAR(34) NOT NULL,
  beneficiary_bank_code VARCHAR(32) NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  status ENUM(
    'PREPARED',
    'APPROVED',
    'AWAITING_EXTERNAL_EXECUTION',
    'PROCESSING',
    'CONFIRMED',
    'FAILED',
    'RECONCILIATION_REQUIRED',
    'CANCELLED'
  ) NOT NULL DEFAULT 'PREPARED',
  external_execution_status ENUM('DISABLED', 'PENDING_AUTHORIZATION') NOT NULL DEFAULT 'DISABLED',
  idempotency_key VARCHAR(100) UNIQUE NULL,
  prepared_by INT NOT NULL,
  approved_by INT NULL,
  approved_at TIMESTAMP NULL,
  confirmed_at TIMESTAMP NULL,
  external_transfer_ref VARCHAR(128) NULL,
  audit_notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_disbursement_supplier FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_disbursement_payable FOREIGN KEY (supplier_payable_id) REFERENCES supplier_payables(id) ON DELETE RESTRICT,
  CONSTRAINT fk_disbursement_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT,
  CONSTRAINT fk_disbursement_prepared_by FOREIGN KEY (prepared_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_disbursement_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_disbursement_supplier (supplier_id, status),
  INDEX idx_disbursement_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS provider_settlement_batches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_reference VARCHAR(64) UNIQUE NOT NULL COMMENT 'Safepay settlement batch reference, e.g. sb_... or SETTLE-...',
  provider VARCHAR(32) NOT NULL DEFAULT 'SAFEPAY',
  gross_amount DECIMAL(12,2) NOT NULL,
  provider_fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  net_settled_amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  status ENUM('PENDING', 'SETTLED', 'RECONCILED', 'MISMATCH_DETECTED') NOT NULL DEFAULT 'PENDING',
  settlement_date TIMESTAMP NOT NULL,
  raw_metadata JSON NULL,
  reconciled_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_settlement_provider_date (provider, settlement_date),
  INDEX idx_settlement_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS financial_audit_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  event_code VARCHAR(64) UNIQUE NOT NULL COMMENT 'Unique audit code, e.g. FIN-EVT-...',
  order_id INT NULL,
  payment_id INT NULL,
  entity_type VARCHAR(48) NOT NULL COMMENT 'SUPPLIER_PAYABLE, REFUND_OBLIGATION, FINANCIAL_HOLD, DISBURSEMENT, SETTLEMENT',
  entity_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  actor_role ENUM('BUYER', 'SUPPLIER', 'ADMIN', 'SYSTEM') NOT NULL,
  actor_id INT NOT NULL,
  from_status VARCHAR(48) NULL,
  to_status VARCHAR(48) NOT NULL,
  amount_delta DECIMAL(12,2) NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'PKR',
  notes TEXT NULL,
  metadata JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_financial_audit_entity (entity_type, entity_id),
  INDEX idx_financial_audit_order_time (order_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
