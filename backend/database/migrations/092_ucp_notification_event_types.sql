-- UCP catalog events use DOMAIN.ACTION names. Preserve every historical value.
-- Additive compatibility widening only; never rewrite migration 049 or inbox rows.
-- Apply through the checksum-journal runner after a verified backup and
-- read-only history audit. Runtime proof is required on miljor_test_db first.
ALTER TABLE platform_notifications MODIFY COLUMN event_type VARCHAR(64) NOT NULL;
