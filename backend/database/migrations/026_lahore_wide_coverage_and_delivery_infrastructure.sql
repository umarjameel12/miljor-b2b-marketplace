-- =============================================================================
-- Migration 026: Lahore-Wide Cluster Coverage, Smart Location Lite & Delivery Pricing
-- MilJor Special Phase G2: Full-Stack Geographic & Supplier Delivery Infrastructure
-- =============================================================================

-- 1. Extend geographic_clusters with versioning and human-readable area summary
ALTER TABLE `geographic_clusters`
  ADD COLUMN `cluster_version` INT NOT NULL DEFAULT 1 AFTER `is_active`,
  ADD COLUMN `covered_areas_summary` TEXT NULL AFTER `cluster_version`;

-- Update existing 8 clusters with human-friendly descriptions
UPDATE `geographic_clusters` SET `covered_areas_summary` = 'Shahdara Town, Begum Kot, Wandala Dayal Shah, Ravi Toll Plaza & Northern Ring Road' WHERE `cluster_code` = 'LHR-NORTH-RVI';
UPDATE `geographic_clusters` SET `covered_areas_summary` = 'Androon Shehr (12 Gates), Railway Station, Data Darbar, Anarkali, Circular Road & Naulakha' WHERE `cluster_code` = 'LHR-CENTRAL-HIST';
UPDATE `geographic_clusters` SET `covered_areas_summary` = 'Lahore Cantt Saddar, RA Bazar, Cavalry Ground, DHA Phase 1, Phase 2, Phase 3 & Phase 4' WHERE `cluster_code` = 'LHR-EAST-CANTONMENT';
UPDATE `geographic_clusters` SET `covered_areas_summary` = 'Gulberg II, Gulberg III, Main Market, MM Alam Road, Liberty Market, Shadman & Jail Road' WHERE `cluster_code` = 'LHR-CORE-COMMERCIAL';
UPDATE `geographic_clusters` SET `covered_areas_summary` = 'Allama Iqbal Town (Moon Market), Samanabad, Ichhra, Wahdat Colony, Karim Block & Muslim Town' WHERE `cluster_code` = 'LHR-MIDWEST-URBAN';
UPDATE `geographic_clusters` SET `covered_areas_summary` = 'Model Town (Blocks A-M), New Garden Town, Faisal Town, Kot Lakhpat Industrial & Peco Road' WHERE `cluster_code` = 'LHR-SOUTH-CENTRAL';
UPDATE `geographic_clusters` SET `covered_areas_summary` = 'Johar Town Phase 1 & 2, Township, Wapda Town, PIA Society, Green Town & Thokar Niaz Baig' WHERE `cluster_code` = 'LHR-SOUTHWEST-RES';
UPDATE `geographic_clusters` SET `covered_areas_summary` = 'Bahria Town (Sectors A-F), Lake City, Valencia Town, Khayaban-e-Amin & Pine Avenue' WHERE `cluster_code` = 'LHR-DEEP-SOUTH';

-- 2. Additive Clusters 9 through 12 to resolve peripheral coverage gaps
INSERT INTO `geographic_clusters` (`id`, `cluster_code`, `name`, `district`, `region_code`, `hub_name`, `hub_latitude`, `hub_longitude`, `coverage_radius_km`, `is_active`, `cluster_version`, `covered_areas_summary`, `metadata`)
VALUES
(9, 'LHR-RAIWIND-RURAL', 'Raiwind & Sundar Agri-Industrial Cluster', 'Lahore', 'K', 'Raiwind Markaz Hub', 31.2520000, 74.2180000, 10.00, TRUE, 1, 'Raiwind City Center, Sundar Industrial Estate (SIE), Manga Mandi & Raiwind Road Agri Corridor', '{"natural_barriers": ["Manga-Raiwind Railway Line"], "primary_access": ["Raiwind Road", "Manga-Raiwind Bypass", "Sundar Road"]}'),
(10, 'LHR-SOUTHEAST-FEROZ', 'Kahna & Ferozepur Road Southern Cluster', 'Lahore', 'K', 'Kahna Nau Chowk Hub', 31.3680000, 74.3620000, 8.50, TRUE, 1, 'Kahna Nau, Sue-e-Asal, Kahna Kacha, Gajju Matah & Southern Ferozepur Corridor', '{"natural_barriers": ["Rohi Nullah Crossing"], "primary_access": ["Ferozepur Road South", "Kahna Kacha Road", "Lahore Ring Road South"]}'),
(11, 'LHR-EAST-PERIPHERY', 'Wagah, Batapur & Shalimar Eastern Corridor', 'Lahore', 'C', 'Batapur / GT Road Hub', 31.5920000, 74.4550000, 8.50, TRUE, 1, 'Daroghawala, Batapur, Wagah Town, Jallo Park Area, Manawan & Eastern Canal Corridor', '{"natural_barriers": ["BRB Canal (Bambawali-Ravi-Bedian)"], "primary_access": ["GT Road East", "Canal Bank Road East", "Barkat Road"]}'),
(12, 'LHR-DHA-SOUTHERN', 'DHA Phase 6-9 & Bedian Corridor', 'Lahore', 'D', 'DHA Phase 6 Commercial Hub', 31.4380000, 74.4480000, 7.50, TRUE, 1, 'DHA Phase 6, DHA Phase 7, DHA Phase 8 (Ex-Air Avenue), DHA Phase 9 Prism & Bedian Road', '{"natural_barriers": ["BRB Canal Crossing"], "primary_access": ["Main Boulevard DHA 6", "Bedian Road", "Ring Road DHA Interchange"]}');

-- 3. Reassign previously peripheral localities to optimal dedicated clusters
UPDATE `geographic_localities` SET `cluster_id` = 11 WHERE `locality_code` = 'LOC-LHR-DAROGHAWALA';
UPDATE `geographic_localities` SET `cluster_id` = 12 WHERE `locality_code` = 'LOC-LHR-DHA-PH6';
UPDATE `geographic_localities` SET `cluster_id` = 9 WHERE `locality_code` = 'LOC-LHR-RAIWIND-CITY';
UPDATE `geographic_localities` SET `cluster_id` = 9 WHERE `locality_code` = 'LOC-LHR-MANGAMANDI';
UPDATE `geographic_localities` SET `cluster_id` = 10 WHERE `locality_code` = 'LOC-LHR-SUE-E-ASAL';
UPDATE `geographic_localities` SET `cluster_id` = 10 WHERE `locality_code` = 'LOC-LHR-KAHNA-NAU';

-- 4. Seed newly discovered strategic industrial, residential, and peripheral localities
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
VALUES
('LOC-LHR-SUNDAR-IND', 9, 'Sundar Industrial Estate', 'سندر انڈسٹریل اسٹیٹ', 'K', '55150', 31.2900000, 74.1700000, 'VERIFIED', TRUE, '["Sundar", "SIE", "Sundar Food Processing Zone", "Sundar Industrial Area"]'),
('LOC-LHR-WAGAH', 11, 'Wagah Town', 'واہگہ ٹاؤن', 'C', '53400', 31.5810000, 74.5350000, 'VERIFIED', TRUE, '["Wagah", "Wagah Border Town", "GT Road Wagah"]'),
('LOC-LHR-BATAPUR', 11, 'Batapur', 'باٹا پور', 'C', '53400', 31.5925000, 74.4560000, 'VERIFIED', TRUE, '["Bata Pur", "Batapur GT Road", "Jallo Mor"]'),
('LOC-LHR-JALLO', 11, 'Jallo & Manawan', 'جلو و مناواں', 'C', '53400', 31.5850000, 74.4820000, 'VERIFIED', TRUE, '["Jallo", "Manawan", "Jallo Park Area"]'),
('LOC-LHR-DHA-PH7', 12, 'DHA Phase 7', 'ڈی ایچ اے فیز 7', 'D', '54792', 31.4250000, 74.4320000, 'VERIFIED', TRUE, '["DHA 7", "Defence Phase 7"]'),
('LOC-LHR-DHA-PH8', 12, 'DHA Phase 8', 'ڈی ایچ اے فیز 8', 'D', '54792', 31.4420000, 74.4680000, 'VERIFIED', TRUE, '["DHA 8", "Defence Phase 8", "Air Avenue DHA"]'),
('LOC-LHR-BEDIAN-RD', 12, 'Bedian Road Corridor', 'بیدیاں روڈ', 'D', '54792', 31.4510000, 74.4520000, 'VERIFIED', TRUE, '["Bedian Road", "Heer Village Bedian"]');

-- 5. Create Buyer Delivery Addresses Table (Smart Location Lite)
CREATE TABLE IF NOT EXISTS `buyer_delivery_addresses` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `city` VARCHAR(50) NOT NULL DEFAULT 'Lahore',
  `cluster_id` INT NOT NULL,
  `cluster_version` INT NOT NULL DEFAULT 1,
  `society_area` VARCHAR(255) NOT NULL,
  `full_address` TEXT NOT NULL,
  `pin_latitude` DECIMAL(10, 7) NULL,
  `pin_longitude` DECIMAL(10, 7) NULL,
  `geographic_match_status` ENUM('VERIFIED', 'PROVISIONAL', 'AMBIGUOUS', 'UNRESOLVED') NOT NULL DEFAULT 'PROVISIONAL',
  `user_confirmation_status` ENUM('CONFIRMED', 'NOT_CONFIRMED') NOT NULL DEFAULT 'CONFIRMED',
  `business_verification_status` ENUM('VERIFIED', 'PENDING', 'NOT_REQUIRED', 'FAILED') NOT NULL DEFAULT 'NOT_REQUIRED',
  `manual_review_required` BOOLEAN NOT NULL DEFAULT FALSE,
  `is_default` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_buyer_addr_user` (`user_id`),
  KEY `idx_buyer_addr_cluster` (`cluster_id`),
  KEY `idx_buyer_addr_default` (`user_id`, `is_default`),
  CONSTRAINT `fk_buyer_addr_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_buyer_addr_cluster` FOREIGN KEY (`cluster_id`) REFERENCES `geographic_clusters` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 6. Create Supplier Delivery Configuration Table
CREATE TABLE IF NOT EXISTS `supplier_delivery_configurations` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `supplier_id` INT NOT NULL UNIQUE,
  `standard_delivery_enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `pickup_enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `express_enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `express_cutoff_time` TIME NULL DEFAULT '14:00:00',
  `express_fulfillment_hours` INT NULL DEFAULT 4,
  `version` INT NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_sup_deliv_cfg_user` (`supplier_id`),
  CONSTRAINT `fk_sup_deliv_cfg_user` FOREIGN KEY (`supplier_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 7. Create Supplier Delivery Cluster Rates Table
CREATE TABLE IF NOT EXISTS `supplier_delivery_cluster_rates` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `supplier_id` INT NOT NULL,
  `cluster_id` INT NOT NULL,
  `mode` ENUM('STANDARD_CLUSTERED', 'EXPRESS') NOT NULL,
  `is_eligible` BOOLEAN NOT NULL DEFAULT TRUE,
  `fee_pkr` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `version` INT NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_supplier_cluster_mode` (`supplier_id`, `cluster_id`, `mode`),
  KEY `idx_sup_rates_lookup` (`supplier_id`, `mode`, `is_eligible`),
  CONSTRAINT `fk_sup_rates_user` FOREIGN KEY (`supplier_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sup_rates_cluster` FOREIGN KEY (`cluster_id`) REFERENCES `geographic_clusters` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 8. Create Supplier Pickup Points Table
CREATE TABLE IF NOT EXISTS `supplier_pickup_points` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `supplier_id` INT NOT NULL,
  `point_name` VARCHAR(150) NOT NULL,
  `cluster_id` INT NOT NULL,
  `address_line` TEXT NOT NULL,
  `operating_hours` VARCHAR(100) NOT NULL DEFAULT 'Mon-Sat 09:00 - 18:00',
  `pickup_handling_fee_pkr` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  `collection_instructions` TEXT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `version` INT NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_pickup_pts_supplier` (`supplier_id`),
  KEY `idx_pickup_pts_active` (`supplier_id`, `is_active`),
  CONSTRAINT `fk_pickup_pts_user` FOREIGN KEY (`supplier_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pickup_pts_cluster` FOREIGN KEY (`cluster_id`) REFERENCES `geographic_clusters` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 9. Create Delivery Quotes Table (Server-Authoritative Quote Lifecycle)
CREATE TABLE IF NOT EXISTS `delivery_quotes` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `quote_code` VARCHAR(50) NOT NULL UNIQUE,
  `buyer_id` INT NOT NULL,
  `supplier_id` INT NOT NULL,
  `pool_id` INT NULL,
  `cluster_id` INT NOT NULL,
  `address_id` BIGINT NULL,
  `mode` ENUM('STANDARD_CLUSTERED', 'PICKUP', 'EXPRESS') NOT NULL,
  `quoted_delivery_fee_pkr` DECIMAL(10, 2) NOT NULL,
  `pickup_point_id` INT NULL,
  `supplier_config_version` INT NOT NULL DEFAULT 1,
  `status` ENUM('PENDING', 'ACCEPTED', 'EXPIRED', 'SUPERSEDED') NOT NULL DEFAULT 'PENDING',
  `expires_at` DATETIME NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_deliv_quotes_code` (`quote_code`),
  KEY `idx_deliv_quotes_buyer` (`buyer_id`, `status`),
  KEY `idx_deliv_quotes_pool` (`pool_id`, `buyer_id`),
  CONSTRAINT `fk_deliv_quotes_buyer` FOREIGN KEY (`buyer_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_deliv_quotes_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_deliv_quotes_cluster` FOREIGN KEY (`cluster_id`) REFERENCES `geographic_clusters` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
