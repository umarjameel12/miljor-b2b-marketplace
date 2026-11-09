-- =============================================================================
-- Rollback for Migration 021: Buyer Protection, Dispute & Fulfillment Exception Resolution Foundation
-- Phase: MilJor Part 4E.5
-- =============================================================================

DROP TABLE IF EXISTS order_dispute_events;

ALTER TABLE order_disputes
  DROP FOREIGN KEY fk_disputes_supplier,
  DROP FOREIGN KEY fk_disputes_decision_by,
  DROP INDEX idx_disputes_supplier,
  DROP INDEX idx_disputes_order_status,
  DROP INDEX idx_disputes_idempotency,
  DROP COLUMN supplier_id,
  DROP COLUMN dispute_category,
  DROP COLUMN reporting_actor_role,
  DROP COLUMN expected_quantity,
  DROP COLUMN reported_quantity,
  DROP COLUMN disputed_quantity,
  DROP COLUMN claimed_amount,
  DROP COLUMN currency,
  DROP COLUMN evidence_metadata,
  DROP COLUMN supplier_response,
  DROP COLUMN supplier_response_at,
  DROP COLUMN remediation_proposal,
  DROP COLUMN remediation_details,
  DROP COLUMN remediation_status,
  DROP COLUMN remediation_dispatched_at,
  DROP COLUMN remediation_delivered_at,
  DROP COLUMN buyer_remediation_confirmed_at,
  DROP COLUMN remediation_notes,
  DROP COLUMN admin_decision,
  DROP COLUMN decision_reason,
  DROP COLUMN decision_recorded_at,
  DROP COLUMN decision_by,
  DROP COLUMN closure_reason,
  DROP COLUMN closed_at,
  DROP COLUMN idempotency_key,
  MODIFY COLUMN status ENUM(
    'OPEN',
    'EVIDENCE_REQUESTED',
    'SUPPLIER_RESPONSE',
    'BUYER_RESPONSE',
    'UNDER_REVIEW',
    'RESOLVED_REFUND',
    'RESOLVED_PARTIAL_REFUND',
    'RESOLVED_REJECTED',
    'ESCALATED',
    'CLOSED'
  ) NOT NULL DEFAULT 'OPEN';
