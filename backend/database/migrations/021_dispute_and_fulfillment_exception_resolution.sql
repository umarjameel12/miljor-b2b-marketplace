-- =============================================================================
-- Migration 021: Buyer Protection, Dispute & Fulfillment Exception Resolution Foundation
-- Phase: MilJor Part 4E.5
-- Purpose:
-- 1. Extend order_disputes table with Part 4E.5 domain columns:
--    - supplier_id (with foreign key and index)
--    - dispute_category, reporting_actor_role
--    - expected_quantity, reported_quantity, disputed_quantity, claimed_amount, currency
--    - evidence_metadata (structured JSON)
--    - supplier_response, supplier_response_at
--    - remediation_proposal, remediation_details, remediation_status
--    - remediation_dispatched_at, remediation_delivered_at, buyer_remediation_confirmed_at, remediation_notes
--    - admin_decision, decision_reason, decision_recorded_at, decision_by
--    - closure_reason, closed_at, idempotency_key
--    - expanded status ENUM covering the documented lifecycle
-- 2. Create order_dispute_events table for immutable milestone tracking and audit trails
-- =============================================================================

ALTER TABLE order_disputes
  ADD COLUMN supplier_id INT NULL AFTER buyer_id,
  ADD COLUMN dispute_category VARCHAR(64) NOT NULL DEFAULT 'SHORT_QUANTITY' AFTER reason,
  ADD COLUMN reporting_actor_role ENUM('BUYER', 'SUPPLIER', 'ADMIN', 'SYSTEM') NOT NULL DEFAULT 'BUYER' AFTER dispute_category,
  ADD COLUMN expected_quantity DECIMAL(12,4) NULL AFTER description,
  ADD COLUMN reported_quantity DECIMAL(12,4) NULL AFTER expected_quantity,
  ADD COLUMN disputed_quantity DECIMAL(12,4) NULL AFTER reported_quantity,
  ADD COLUMN claimed_amount DECIMAL(12,2) NULL AFTER disputed_quantity,
  ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'PKR' AFTER claimed_amount,
  ADD COLUMN evidence_metadata JSON NULL AFTER evidence_image_url,
  ADD COLUMN supplier_response TEXT NULL AFTER status,
  ADD COLUMN supplier_response_at TIMESTAMP NULL AFTER supplier_response,
  ADD COLUMN remediation_proposal ENUM(
    'NONE',
    'DELIVER_MISSING_QUANTITY',
    'REPLACE_DAMAGED_GOODS',
    'CORRECT_WRONG_ITEM',
    'EXPLANATION_CONTEST',
    'ESCALATE_FOR_ADMIN_REVIEW'
  ) NOT NULL DEFAULT 'NONE' AFTER supplier_response_at,
  ADD COLUMN remediation_details TEXT NULL AFTER remediation_proposal,
  ADD COLUMN remediation_status ENUM(
    'NOT_APPLICABLE',
    'PROPOSED',
    'IN_PROGRESS',
    'COMPLETED',
    'REJECTED'
  ) NOT NULL DEFAULT 'NOT_APPLICABLE' AFTER remediation_details,
  ADD COLUMN remediation_dispatched_at TIMESTAMP NULL AFTER remediation_status,
  ADD COLUMN remediation_delivered_at TIMESTAMP NULL AFTER remediation_dispatched_at,
  ADD COLUMN buyer_remediation_confirmed_at TIMESTAMP NULL AFTER remediation_delivered_at,
  ADD COLUMN remediation_notes TEXT NULL AFTER buyer_remediation_confirmed_at,
  ADD COLUMN admin_decision ENUM(
    'NONE',
    'BUYER_CLAIM_ACCEPTED',
    'BUYER_CLAIM_REJECTED',
    'PARTIAL_CLAIM_ACCEPTED',
    'SUPPLIER_REMEDIATION_REQUIRED',
    'FINANCIAL_REVIEW_REQUIRED'
  ) NOT NULL DEFAULT 'NONE' AFTER remediation_notes,
  ADD COLUMN decision_reason TEXT NULL AFTER admin_decision,
  ADD COLUMN decision_recorded_at TIMESTAMP NULL AFTER decision_reason,
  ADD COLUMN decision_by INT NULL AFTER decision_recorded_at,
  ADD COLUMN closure_reason VARCHAR(255) NULL AFTER admin_notes,
  ADD COLUMN closed_at TIMESTAMP NULL AFTER closure_reason,
  ADD COLUMN idempotency_key VARCHAR(100) NULL AFTER closed_at,
  MODIFY COLUMN status ENUM(
    'OPEN',
    'AWAITING_SUPPLIER_RESPONSE',
    'UNDER_ADMIN_REVIEW',
    'EVIDENCE_REQUESTED',
    'SUPPLIER_REMEDIATION_PROPOSED',
    'SUPPLIER_REMEDIATION_IN_PROGRESS',
    'SUPPLIER_REMEDIATION_COMPLETED',
    'RESOLUTION_RECORDED',
    'ESCALATED_FINANCIAL_REVIEW',
    'CLOSED',
    -- Legacy compatibility values
    'SUPPLIER_RESPONSE',
    'BUYER_RESPONSE',
    'UNDER_REVIEW',
    'RESOLVED_REFUND',
    'RESOLVED_PARTIAL_REFUND',
    'RESOLVED_REJECTED',
    'ESCALATED'
  ) NOT NULL DEFAULT 'OPEN',
  ADD INDEX idx_disputes_supplier (supplier_id),
  ADD INDEX idx_disputes_order_status (order_id, status),
  ADD INDEX idx_disputes_idempotency (idempotency_key),
  ADD CONSTRAINT fk_disputes_supplier FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_disputes_decision_by FOREIGN KEY (decision_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS order_dispute_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dispute_id INT NOT NULL,
  event_code VARCHAR(64) UNIQUE NOT NULL COMMENT 'Unique deterministic event code, e.g. DE-DSP-123-...',
  from_status VARCHAR(64) NOT NULL,
  to_status VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  actor_id INT NOT NULL,
  actor_role ENUM('BUYER', 'SUPPLIER', 'ADMIN', 'SYSTEM') NOT NULL,
  notes TEXT NULL,
  metadata JSON NULL,
  idempotency_key VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_dispute_events_dispute FOREIGN KEY (dispute_id) REFERENCES order_disputes(id) ON DELETE RESTRICT,
  CONSTRAINT fk_dispute_events_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_dispute_events_dispute_time (dispute_id, created_at),
  INDEX idx_dispute_events_idempotency (idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
