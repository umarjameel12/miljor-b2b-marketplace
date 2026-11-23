-- UCP catalog events use DOMAIN.ACTION names. Preserve every historical value.
-- Additive compatibility widening only; never rewrite migration 049 or inbox rows.
-- Apply through the checksum-journal runner after a verified backup and
-- read-only history audit. Runtime proof is required on miljor_test_db first.
-- Renumbered from the unmerged UCP PR's 092 to preserve original Smart Hub 092.
-- Retain that migration's wider contract; never narrow existing event values.
ALTER TABLE platform_notifications MODIFY COLUMN event_type VARCHAR(80) NOT NULL;
