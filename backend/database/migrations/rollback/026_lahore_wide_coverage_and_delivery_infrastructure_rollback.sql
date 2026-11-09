-- =============================================================================
-- Migration Rollback 026: Lahore-Wide Cluster Coverage, Smart Location Lite & Delivery Pricing
-- =============================================================================

DROP TABLE IF EXISTS `delivery_quotes`;
DROP TABLE IF EXISTS `supplier_pickup_points`;
DROP TABLE IF EXISTS `supplier_delivery_cluster_rates`;
DROP TABLE IF EXISTS `supplier_delivery_configurations`;
DROP TABLE IF EXISTS `buyer_delivery_addresses`;

DELETE FROM `geographic_localities` WHERE `locality_code` IN (
  'LOC-LHR-SUNDAR-IND', 'LOC-LHR-WAGAH', 'LOC-LHR-BATAPUR', 'LOC-LHR-JALLO',
  'LOC-LHR-DHA-PH7', 'LOC-LHR-DHA-PH8', 'LOC-LHR-BEDIAN-RD'
);

UPDATE `geographic_localities` SET `cluster_id` = 2 WHERE `locality_code` = 'LOC-LHR-DAROGHAWALA';
UPDATE `geographic_localities` SET `cluster_id` = 3 WHERE `locality_code` = 'LOC-LHR-DHA-PH6';
UPDATE `geographic_localities` SET `cluster_id` = 8 WHERE `locality_code` IN ('LOC-LHR-RAIWIND-CITY', 'LOC-LHR-MANGAMANDI', 'LOC-LHR-SUE-E-ASAL', 'LOC-LHR-KAHNA-NAU');

DELETE FROM `geographic_clusters` WHERE `id` IN (9, 10, 11, 12);

ALTER TABLE `geographic_clusters` DROP COLUMN `covered_areas_summary`;
ALTER TABLE `geographic_clusters` DROP COLUMN `cluster_version`;
