-- PR61 Part 1: bind idempotency key to exact correction payload, not only revision.
-- Apply forward-only after 098; do not rewrite applied migration history.
ALTER TABLE supplier_profiles
  ADD COLUMN last_correction_hash CHAR(64) NULL;
