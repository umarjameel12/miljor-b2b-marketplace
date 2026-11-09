-- =============================================================================
-- Migration 025: Lahore District Geographic Clustering & Locality Infrastructure
-- MilJor Special Phase G1: Lahore-Only Geographic Foundation
-- =============================================================================

CREATE TABLE IF NOT EXISTS `geographic_clusters` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `cluster_code` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(100) NOT NULL,
  `district` VARCHAR(50) NOT NULL DEFAULT 'Lahore',
  `region_code` VARCHAR(10) NOT NULL,
  `hub_name` VARCHAR(150) NOT NULL,
  `hub_latitude` DECIMAL(10, 7) NOT NULL,
  `hub_longitude` DECIMAL(10, 7) NOT NULL,
  `coverage_radius_km` DECIMAL(5, 2) NOT NULL DEFAULT 5.00,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `metadata` JSON NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_clusters_code` (`cluster_code`),
  KEY `idx_clusters_district` (`district`),
  KEY `idx_clusters_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `geographic_localities` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `locality_code` VARCHAR(60) NOT NULL UNIQUE,
  `cluster_id` INT NULL,
  `name_en` VARCHAR(150) NOT NULL,
  `name_ur` VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `region_code` VARCHAR(10) NOT NULL,
  `postal_code` VARCHAR(10) NULL,
  `latitude` DECIMAL(10, 7) NOT NULL,
  `longitude` DECIMAL(10, 7) NOT NULL,
  `status` ENUM('VERIFIED', 'PROVISIONAL', 'AMBIGUOUS', 'OUTSIDE_DISTRICT') NOT NULL DEFAULT 'VERIFIED',
  `is_supported` BOOLEAN NOT NULL DEFAULT TRUE,
  `aliases` JSON NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_localities_code` (`locality_code`),
  KEY `idx_localities_cluster` (`cluster_id`),
  KEY `idx_localities_region` (`region_code`),
  KEY `idx_localities_status` (`status`, `is_supported`),
  KEY `idx_localities_coords` (`latitude`, `longitude`),
  CONSTRAINT `fk_localities_cluster` FOREIGN KEY (`cluster_id`) REFERENCES `geographic_clusters` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================================
-- Seed 8 Authoritative Lahore Operational Delivery Clusters
-- =============================================================================
INSERT INTO `geographic_clusters` (`cluster_code`, `name`, `district`, `region_code`, `hub_name`, `hub_latitude`, `hub_longitude`, `coverage_radius_km`, `is_active`, `metadata`)
VALUES
('LHR-NORTH-RVI', 'Shahdara / Northern Ravi Cluster', 'Lahore', 'A', 'Shahdara Chowk Hub', 31.6212000, 74.2828000, 6.50, TRUE, '{"natural_barriers": ["Ravi River"], "primary_access": ["Old Ravi Bridge", "Sagian Bridge", "GT Road North"]}'),
('LHR-CENTRAL-HIST', 'Central & Walled City Cluster', 'Lahore', 'B', 'Lahore Railway Station Hub', 31.5770000, 74.3315000, 5.00, TRUE, '{"natural_barriers": ["Circular Road Bottlenecks", "Railway Tracks"], "primary_access": ["Circular Road", "Allama Iqbal Road", "Mall Road"]}'),
('LHR-EAST-CANTONMENT', 'Cantt & DHA Sector Cluster', 'Lahore', 'D', 'Cavalry Ground / Cantt Hub', 31.5030000, 74.3780000, 7.50, TRUE, '{"natural_barriers": ["Railway Mainline", "Cantt Checkposts"], "primary_access": ["Lahore Ring Road East", "Bedian Road", "Walton Road", "Ghazi Road"]}'),
('LHR-CORE-COMMERCIAL', 'Gulberg & Commercial Core Cluster', 'Lahore', 'E', 'Main Market Gulberg Hub', 31.5180000, 74.3480000, 5.00, TRUE, '{"natural_barriers": ["Lahore Canal (Bambawali Canal)"], "primary_access": ["Main Boulevard Gulberg", "Jail Road", "Ferozepur Road"]}'),
('LHR-MIDWEST-URBAN', 'Iqbal Town, Samanabad, Wahdat Cluster', 'Lahore', 'F', 'Moon Market Allama Iqbal Town Hub', 31.5120000, 74.2880000, 5.50, TRUE, '{"natural_barriers": ["Canal Crossings", "Multan Road Traffic"], "primary_access": ["Wahdat Road", "Multan Road", "Main Boulevard Iqbal Town"]}'),
('LHR-SOUTH-CENTRAL', 'Model Town, Kot Lakhpat, Township Cluster', 'Lahore', 'G', 'Model Town Link Road Hub', 31.4740000, 74.3160000, 6.00, TRUE, '{"natural_barriers": ["Railway Tracks at Kot Lakhpat"], "primary_access": ["Ferozepur Road", "Peco Road", "Model Town Circular"]}'),
('LHR-SOUTHWEST-RES', 'Johar Town, Wapda Town, Thokar Cluster', 'Lahore', 'H', 'Shaukat Khanum Chowk Hub', 31.4640000, 74.2660000, 6.50, TRUE, '{"natural_barriers": ["Canal South Border", "Thokar Bypass Merge"], "primary_access": ["Khayaban-e-Firdousi", "Khayaban-e-Jinnah", "Raiwind Road North", "Canal Bank Road"]}'),
('LHR-DEEP-SOUTH', 'Bahria, Lake City, Valencia, Raiwind Cluster', 'Lahore', 'J', 'Adda Plot / Raiwind Road Hub', 31.3650000, 74.2250000, 8.50, TRUE, '{"natural_barriers": ["Rohi Nullah", "Ring Road South Slips"], "primary_access": ["Raiwind Road", "Pine Avenue", "Ring Road Southern Loop"]}');

-- =============================================================================
-- Seed Authoritative Localities Across All 11 Regions (A through K)
-- =============================================================================
-- Region A: Shahdara & Northern Ravi
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-SHAHDARA', id, 'Shahdara Town', 'شاہدرہ ٹاؤن', 'A', '54900', 31.6215000, 74.2825000, 'VERIFIED', TRUE, '["Shahdara", "Shahdara Chowk", "Shahdara More"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-NORTH-RVI';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-BEGUMKOT', id, 'Begum Kot', 'بیگم کوٹ', 'A', '54900', 31.6360000, 74.2640000, 'VERIFIED', TRUE, '["Begum Kot Shahdara"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-NORTH-RVI';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-WANDALA', id, 'Wandala Dayal Shah', 'ونڈالہ دیال شاہ', 'A', '54900', 31.6420000, 74.2950000, 'VERIFIED', TRUE, '["Wandala"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-NORTH-RVI';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-RAVITOLL', id, 'Ravi Toll Plaza', 'راوی ٹول پلازہ', 'A', '54900', 31.6080000, 74.2980000, 'VERIFIED', TRUE, '["Ravi Bridge", "Ravi Toll"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-NORTH-RVI';

-- Region B: Walled City & Central Historic
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-WALLED-CITY', id, 'Walled City (Androon Shehr)', 'اندرون شہر', 'B', '54000', 31.5880000, 74.3150000, 'VERIFIED', TRUE, '["Old City", "Androon Lahore", "Fort Lahore", "Badshahi Mosque Area"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CENTRAL-HIST';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-DATADARBAR', id, 'Data Darbar & Bhati Gate', 'داتا دربار و بھاٹی گیٹ', 'B', '54000', 31.5790000, 74.3050000, 'VERIFIED', TRUE, '["Data Ganj Bakhsh", "Bhati Gate", "Lower Mall"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CENTRAL-HIST';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-ANARKALI', id, 'Anarkali Bazaar', 'انارکلی بازار', 'B', '54000', 31.5690000, 74.3140000, 'VERIFIED', TRUE, '["Old Anarkali", "New Anarkali", "Mall Road Lower"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CENTRAL-HIST';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-RAILWAY-STN', id, 'Lahore Railway Station', 'لاہور ریلوے اسٹیشن', 'B', '54000', 31.5775000, 74.3310000, 'VERIFIED', TRUE, '["Station", "Naulakha", "Circular Road Station"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CENTRAL-HIST';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-DELHIGATE', id, 'Delhi Gate', 'دہلی گیٹ', 'B', '54000', 31.5830000, 74.3230000, 'VERIFIED', TRUE, '["Wazir Khan Area", "Delhi Darwaza", "Akbari Mandi"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CENTRAL-HIST';

-- Region C: Shalimar, Baghbanpura, Mughalpura
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-SHALIMAR', id, 'Shalimar Gardens', 'شالامار باغ', 'C', '54920', 31.5860000, 74.3820000, 'VERIFIED', TRUE, '["Shalamar", "Shalimar Link Road", "GT Road Shalimar"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CENTRAL-HIST';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-BAGHBANPURA', id, 'Baghbanpura', 'باغبانپورہ', 'C', '54920', 31.5810000, 74.3720000, 'VERIFIED', TRUE, '["Baghban Pura", "Baghbanpura Bazaar"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CENTRAL-HIST';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-MUGHALPURA', id, 'Mughalpura', 'مغلپورہ', 'C', '54840', 31.5640000, 74.3680000, 'VERIFIED', TRUE, '["Mughalpura Dry Port", "Lalpul", "Shalimar Crossing"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CENTRAL-HIST';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-DAROGHAWALA', id, 'Daroghawala', 'دروغہ والا', 'C', '54920', 31.5950000, 74.4050000, 'VERIFIED', TRUE, '["Daroghawala Chowk", "GT Road Daroghawala"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CENTRAL-HIST';

-- Region D: Lahore Cantt, Saddar & DHA Phase 1-6
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-CANTT-SADDAR', id, 'Lahore Cantt Saddar', 'لاہور کینٹ صدر', 'D', '54810', 31.5360000, 74.3710000, 'VERIFIED', TRUE, '["Saddar Cantt", "Cantt Bazaar", "Saddar Roundabout"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-EAST-CANTONMENT';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-CAVALRY', id, 'Cavalry Ground', 'کیولری گراؤنڈ', 'D', '54810', 31.5030000, 74.3690000, 'VERIFIED', TRUE, '["Cavalry", "Cavalry Ground Commercial", "Masood Anwari Road"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-EAST-CANTONMENT';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-DHA-PH1', id, 'DHA Phase 1', 'ڈی ایچ اے فیز 1', 'D', '54792', 31.4870000, 74.3880000, 'VERIFIED', TRUE, '["DHA 1", "Defence Phase 1"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-EAST-CANTONMENT';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-DHA-PH2', id, 'DHA Phase 2', 'ڈی ایچ اے فیز 2', 'D', '54792', 31.4790000, 74.3980000, 'VERIFIED', TRUE, '["DHA 2", "Defence Phase 2", "Lalik Jan Chowk"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-EAST-CANTONMENT';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-DHA-PH3', id, 'DHA Phase 3', 'ڈی ایچ اے فیز 3', 'D', '54792', 31.4680000, 74.3750000, 'VERIFIED', TRUE, '["DHA 3", "Defence Phase 3", "Y Block DHA"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-EAST-CANTONMENT';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-DHA-PH5', id, 'DHA Phase 5', 'ڈی ایچ اے فیز 5', 'D', '54792', 31.4550000, 74.4150000, 'VERIFIED', TRUE, '["DHA 5", "Defence Phase 5", "DHA Raya"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-EAST-CANTONMENT';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-DHA-PH6', id, 'DHA Phase 6', 'ڈی ایچ اے فیز 6', 'D', '54792', 31.4350000, 74.4450000, 'VERIFIED', TRUE, '["DHA 6", "Defence Phase 6", "Main Boulevard DHA 6"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-EAST-CANTONMENT';

-- Region E: Gulberg, Shadman, Jail Road
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-GULBERG2', id, 'Gulberg II', 'گلبرگ 2', 'E', '54660', 31.5280000, 74.3480000, 'VERIFIED', TRUE, '["Gulberg 2", "Zafar Ali Road", "Siddiq Trade Centre Area"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CORE-COMMERCIAL';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-GULBERG3', id, 'Gulberg III', 'گلبرگ 3', 'E', '54660', 31.5080000, 74.3490000, 'VERIFIED', TRUE, '["Gulberg 3", "Liberty Market", "Hafiz Centre", "Ghalib Market"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CORE-COMMERCIAL';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-MAINMKT', id, 'Main Market Gulberg', 'مین مارکیٹ گلبرگ', 'E', '54660', 31.5200000, 74.3450000, 'VERIFIED', TRUE, '["Main Market", "Gulberg Roundabout"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CORE-COMMERCIAL';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-MMALAM', id, 'MM Alam Road', 'ایم ایم عالم روڈ', 'E', '54660', 31.5140000, 74.3540000, 'VERIFIED', TRUE, '["MM Alam", "Gulberg Food Street"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CORE-COMMERCIAL';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-SHADMAN', id, 'Shadman', 'شادمان', 'E', '54000', 31.5360000, 74.3280000, 'VERIFIED', TRUE, '["Shadman 1", "Shadman 2", "Shadman Market"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CORE-COMMERCIAL';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-JAILRD', id, 'Jail Road Commercial Strip', 'جیل روڈ کمرشل', 'E', '54000', 31.5390000, 74.3410000, 'VERIFIED', TRUE, '["Jail Road", "Allama Iqbal Medical College Old Area"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-CORE-COMMERCIAL';

-- Region F: Samanabad, Ichhra, Wahdat Road, Iqbal Town
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-SAMANABAD', id, 'Samanabad', 'سمن آباد', 'F', '54500', 31.5340000, 74.2980000, 'VERIFIED', TRUE, '["Samanabad Roundabout", "Mozang Samanabad Link"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-MIDWEST-URBAN';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-ICHHRA', id, 'Ichhra', 'اچھرا', 'F', '54600', 31.5250000, 74.3160000, 'VERIFIED', TRUE, '["Ichra", "Ichhra Bazaar", "Ferozepur Road Ichhra"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-MIDWEST-URBAN';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-WAHDAT', id, 'Wahdat Colony', 'وحدت کالونی', 'F', '54600', 31.5160000, 74.3050000, 'VERIFIED', TRUE, '["Wahdat Road", "Wahdat Flats"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-MIDWEST-URBAN';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-IQBALTOWN', id, 'Allama Iqbal Town', 'علامہ اقبال ٹاؤن', 'F', '54570', 31.5125000, 74.2885000, 'VERIFIED', TRUE, '["Iqbal Town", "Moon Market", "Khyber Block", "Chenab Block"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-MIDWEST-URBAN';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-KARIMBLOCK', id, 'Karim Block Iqbal Town', 'کریم بلاک اقبال ٹاؤن', 'F', '54570', 31.5060000, 74.2820000, 'VERIFIED', TRUE, '["Karim Block Market", "Wahdat Road Karim Block"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-MIDWEST-URBAN';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-MUSLIMTOWN', id, 'Muslim Town', 'مسلم ٹاؤن', 'F', '54600', 31.5190000, 74.3210000, 'VERIFIED', TRUE, '["Old Muslim Town", "New Muslim Town", "Canal Muslim Town"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-MIDWEST-URBAN';

-- Region G: Model Town, Garden Town, Faisal Town, Kot Lakhpat
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-MODELTOWN', id, 'Model Town', 'ماڈل ٹاؤن', 'G', '54700', 31.4820000, 74.3240000, 'VERIFIED', TRUE, '["Model Town Blocks A-M", "Model Town Link Road", "Central Park Model Town"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTH-CENTRAL';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-GARDENTOWN', id, 'New Garden Town', 'نیو گارڈن ٹاؤن', 'G', '54660', 31.5030000, 74.3280000, 'VERIFIED', TRUE, '["Garden Town", "Barkat Market", "Kalma Chowk Garden Town"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTH-CENTRAL';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-FAISALTOWN', id, 'Faisal Town', 'فیصل ٹاؤن', 'G', '54770', 31.4720000, 74.3010000, 'VERIFIED', TRUE, '["Faisal Town Kotha Pind", "Faisal Town Roundabout"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTH-CENTRAL';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-KOTLAKHPAT', id, 'Kot Lakhpat Industrial Area', 'کوٹ لکھپت انڈسٹریل ایریا', 'G', '54770', 31.4580000, 74.3360000, 'VERIFIED', TRUE, '["Kot Lakhpat", "Lakhpat Quaid-e-Azam Industrial Estate"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTH-CENTRAL';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-PECOROAD', id, 'Peco Road Corridor', 'پیکو روڈ', 'G', '54700', 31.4630000, 74.3200000, 'VERIFIED', TRUE, '["Peco Road", "Badshahi Road Peco"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTH-CENTRAL';

-- Region H: Johar Town, Township, Green Town, Wapda Town
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-JOHAR-PH1', id, 'Johar Town Phase 1', 'جوہر ٹاؤن فیز 1', 'H', '54782', 31.4710000, 74.2780000, 'VERIFIED', TRUE, '["Johar Town 1", "Doctors Hospital Area", "Allah Hoo Roundabout"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTHWEST-RES';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-JOHAR-PH2', id, 'Johar Town Phase 2', 'جوہر ٹاؤن فیز 2', 'H', '54782', 31.4590000, 74.2640000, 'VERIFIED', TRUE, '["Johar Town 2", "Shaukat Khanum Area", "Emporium Mall Area", "Expo Centre Lahore"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTHWEST-RES';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-TOWNSHIP', id, 'Township', 'ٹاؤن شپ', 'H', '54770', 31.4480000, 74.3050000, 'VERIFIED', TRUE, '["Township Sector A-D", "Madar-e-Millat Road", "Chandni Chowk Township"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTHWEST-RES';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-GREENTOWN', id, 'Green Town', 'گرین ٹاؤن', 'H', '54770', 31.4390000, 74.3120000, 'VERIFIED', TRUE, '["Green Town Sector D", "Bagrian Green Town"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTHWEST-RES';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-WAPDATOWN', id, 'Wapda Town', 'واپڈا ٹاؤن', 'H', '54770', 31.4360000, 74.2590000, 'VERIFIED', TRUE, '["Wapda Town Phase 1 & 2", "Wapda Town Roundabout"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTHWEST-RES';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-PIASOCIETY', id, 'PIA Housing Society', 'پی آئی اے سوسائٹی', 'H', '54770', 31.4490000, 74.2580000, 'VERIFIED', TRUE, '["PIA Society", "Wapda Town Link"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTHWEST-RES';

-- Region I: Thokar Niaz Baig, Multan Road, Chung, Mohlanwal
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-THOKAR', id, 'Thokar Niaz Baig', 'ٹھوکر نیاز بیگ', 'I', '53700', 31.4680000, 74.2380000, 'VERIFIED', TRUE, '["Thokar", "Thokar Flyover", "M2 Interchange Thokar", "Canal View"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTHWEST-RES';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-MULTANRD', id, 'Multan Road Corridor', 'ملتان روڈ کوریڈور', 'I', '53700', 31.4520000, 74.2180000, 'VERIFIED', TRUE, '["Multan Road Industrial", "Hanjarwal"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTHWEST-RES';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-CHUNG', id, 'Chung', 'چوہنگ', 'I', '53700', 31.4250000, 74.1950000, 'VERIFIED', TRUE, '["Chuhng", "Chung Multan Road"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-SOUTHWEST-RES';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-MOHLANWAL', id, 'Mohlanwal', 'موہلنوال', 'I', '53700', 31.3980000, 74.1750000, 'VERIFIED', TRUE, '["Mohlanwal Scheme", "Multan Road Mohlanwal"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-DEEP-SOUTH';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-MARAKA', id, 'Maraka', 'مارکہ', 'I', '53700', 31.3820000, 74.1620000, 'VERIFIED', TRUE, '["Maraka Multan Road", "Shamke Bhattian Border"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-DEEP-SOUTH';

-- Region J: Bahria Town, Lake City, Valencia, Pine Avenue
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-BAHRIA-AC', id, 'Bahria Town Sectors A-C', 'بحریہ ٹاؤن سیکٹرز اے تا سی', 'J', '53720', 31.3680000, 74.1820000, 'VERIFIED', TRUE, '["Bahria Town Lahore", "Eiffel Tower Bahria", "Sector B", "Sector C"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-DEEP-SOUTH';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-BAHRIA-DF', id, 'Bahria Town Sectors D-F', 'بحریہ ٹاؤن سیکٹرز ڈی تا ایف', 'J', '53720', 31.3550000, 74.1750000, 'VERIFIED', TRUE, '["Bahria Sector D", "Bahria Sector E", "Bahria Sector F", "Ghauri Block"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-DEEP-SOUTH';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-LAKECITY', id, 'Lake City', 'لیک سٹی', 'J', '54770', 31.3720000, 74.2480000, 'VERIFIED', TRUE, '["Lake City Lahore", "Lake City Ring Road Interchange", "Golf Estate Lake City"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-DEEP-SOUTH';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-VALENCIA', id, 'Valencia Town', 'ویلنشیا ٹاؤن', 'J', '54770', 31.4080000, 74.2620000, 'VERIFIED', TRUE, '["Valencia", "Valencia Roundabout", "Valancia Gate"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-DEEP-SOUTH';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-KHAYABAN-AMIN', id, 'Khayaban-e-Amin', 'خیابان امین', 'J', '54770', 31.3850000, 74.2780000, 'VERIFIED', TRUE, '["Khayaban e Amin", "Pine Avenue Amin"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-DEEP-SOUTH';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-PINEAVENUE', id, 'Pine Avenue Corridor', 'پائن ایونیو', 'J', '54770', 31.3950000, 74.2550000, 'VERIFIED', TRUE, '["Pine Avenue", "DHA Rahbar Link"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-DEEP-SOUTH';

-- Region K: Raiwind City, Manga Mandi, Sue-e-Asal & Southern Rural Peripheral
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-RAIWIND-CITY', id, 'Raiwind City Center', 'رائے ونڈ سٹی سینٹر', 'K', '55050', 31.2480000, 74.2150000, 'VERIFIED', TRUE, '["Raiwind", "Raiwind Markaz", "Raiwind Railway Junction"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-DEEP-SOUTH';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-RAIWIND-RD', id, 'Raiwind Road Agri Hub', 'رائے ونڈ روڈ ایگری ہب', 'K', '55050', 31.3250000, 74.2280000, 'VERIFIED', TRUE, '["Raiwind Road Corridor", "Superior University Campus Area"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-DEEP-SOUTH';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-MANGAMANDI', id, 'Manga Mandi', 'مانگا منڈی', 'K', '55030', 31.3050000, 74.0720000, 'PROVISIONAL', TRUE, '["Manga", "Manga Bypass", "Multan Road Manga"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-DEEP-SOUTH';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-SUE-E-ASAL', id, 'Sue-e-Asal', 'سوئے آصل', 'K', '55110', 31.2820000, 74.3380000, 'VERIFIED', TRUE, '["Sue e Asal", "Ferozepur Road Sue Asal"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-DEEP-SOUTH';
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
SELECT 'LOC-LHR-KAHNA-NAU', id, 'Kahna Nau', 'کاہنہ نو', 'K', '54760', 31.3710000, 74.3640000, 'VERIFIED', TRUE, '["Kahna", "Kahna Ferozepur Road", "Kahna Kacha Link"]' FROM `geographic_clusters` WHERE `cluster_code` = 'LHR-DEEP-SOUTH';

-- Neighboring District Control Localities (OUTSIDE_DISTRICT: strictly unsupported, no cluster_id)
INSERT INTO `geographic_localities` (`locality_code`, `cluster_id`, `name_en`, `name_ur`, `region_code`, `postal_code`, `latitude`, `longitude`, `status`, `is_supported`, `aliases`)
VALUES
('LOC-KSR-KASUR-CITY', NULL, 'Kasur City', 'قصور سٹی', 'OUT', '55000', 31.1160000, 74.4500000, 'OUTSIDE_DISTRICT', FALSE, '["Kasur", "District Kasur", "Ganda Singh Border Area"]'),
('LOC-KSR-KOT-RADHA', NULL, 'Kot Radha Kishan', 'کوٹ رادھا کشن', 'OUT', '55010', 31.1710000, 74.1020000, 'OUTSIDE_DISTRICT', FALSE, '["Kot Radha Kishan Kasur"]'),
('LOC-KSR-PATTOKI', NULL, 'Pattoki', 'پتوکی', 'OUT', '55300', 31.0210000, 73.8540000, 'OUTSIDE_DISTRICT', FALSE, '["Pattoki Mandi", "District Kasur Pattoki"]'),
('LOC-SKP-MURIDKE', NULL, 'Muridke', 'مریدکے', 'OUT', '39010', 31.8020000, 74.2560000, 'OUTSIDE_DISTRICT', FALSE, '["Muridke GT Road", "District Sheikhupura Muridke"]'),
('LOC-SKP-SHEIKHUPURA', NULL, 'Sheikhupura City', 'شیخوپورہ سٹی', 'OUT', '39350', 31.7130000, 73.9850000, 'OUTSIDE_DISTRICT', FALSE, '["Sheikhupura", "District Sheikhupura", "Hiran Minar Area"]'),
('LOC-SKP-FEROZEWALA', NULL, 'Ferozewala', 'فیروزوالہ', 'OUT', '39020', 31.6560000, 74.2380000, 'OUTSIDE_DISTRICT', FALSE, '["Ferozewala Sheikhupura", "Rachna Town Ferozewala"]');
