-- Durable email worker leases. Apply before deploying the updated retry worker.
-- No historical payload/status rewrites; immediate OTP API remains compatible.
ALTER TABLE transactional_email_outbox
  MODIFY COLUMN status ENUM('QUEUED', 'PROVIDER_ACCEPTED', 'DELIVERED_WHEN_CONFIRMED', 'FAILED', 'SENDING') NOT NULL DEFAULT 'QUEUED',
  ADD COLUMN claim_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD COLUMN claim_expires_at DATETIME DEFAULT NULL,
  ADD COLUMN next_attempt_at DATETIME DEFAULT NULL,
  ADD KEY idx_email_outbox_retry (status, next_attempt_at, attempt_count, id),
  ADD KEY idx_email_outbox_lease (status, claim_expires_at, attempt_count, id);
