-- =============================================================================
-- Migration 035: Package E3–E6 Complete Marketplace Schema
-- Subscriptions, Entitlements, Demand Requests, Invoices, Reviews,
-- In-App Conversations, and Sponsored Campaigns
-- =============================================================================

-- 1. Subscription Plans Table
CREATE TABLE IF NOT EXISTS subscription_plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL,
  max_active_families INT NOT NULL,
  max_active_listings INT NOT NULL,
  monthly_price_pkr DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  annual_price_pkr DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  transaction_fee_pct DECIMAL(5,2) NOT NULL DEFAULT 2.00,
  features_json JSON NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO subscription_plans (plan_code, name, max_active_families, max_active_listings, monthly_price_pkr, annual_price_pkr, transaction_fee_pct, features_json)
VALUES 
  ('STARTER', 'Starter Supplier', 4, 4, 0.00, 0.00, 3.00, '{"badge":"Starter","analytics":"Basic","support":"Community"}'),
  ('GROWTH', 'Growth Wholesale Partner', 13, 13, 3500.00, 35000.00, 2.00, '{"badge":"Verified Partner","analytics":"Advanced","support":"Priority"}'),
  ('BUSINESS', 'Enterprise Mill & Distributor', 25, 25, 8000.00, 80000.00, 1.50, '{"badge":"Premium Supplier","analytics":"Real-Time Demand Intelligence","support":"Dedicated Manager"}');

-- 2. Supplier Subscriptions Table
CREATE TABLE IF NOT EXISTS supplier_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  plan_code VARCHAR(32) NOT NULL,
  status ENUM('STARTER_ACTIVE','PAID_PENDING','ACTIVE','PAST_DUE','GRACE','EXPIRED','CANCELLED','SUSPENDED') DEFAULT 'STARTER_ACTIVE',
  current_period_start DATETIME NOT NULL,
  current_period_end DATETIME NULL,
  billing_cycle ENUM('MONTHLY','ANNUAL','FREE') DEFAULT 'MONTHLY',
  auto_renew TINYINT(1) DEFAULT 1,
  price_pkr DECIMAL(12,2) DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_supp_sub (supplier_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Add subscription_status to supplier_profiles if not exists
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'supplier_profiles' AND COLUMN_NAME = 'subscription_status');
SET @sqlstmt := IF(@exist = 0, 'ALTER TABLE supplier_profiles ADD COLUMN subscription_status ENUM(\'STARTER_ACTIVE\',\'PAID_PENDING\',\'ACTIVE\',\'PAST_DUE\',\'GRACE\',\'EXPIRED\',\'CANCELLED\',\'SUSPENDED\') DEFAULT \'STARTER_ACTIVE\' AFTER subscription_plan', 'SELECT \'subscription_status already exists\'');
PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Demand Pool Requests Table ("Request a Pool")
CREATE TABLE IF NOT EXISTS demand_pool_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_code VARCHAR(35) UNIQUE NOT NULL,
  buyer_id INT NOT NULL,
  category_id INT NOT NULL,
  family_id INT NOT NULL,
  commodity_name VARCHAR(150) NOT NULL,
  desired_specs TEXT NULL,
  target_quantity DECIMAL(12,2) NOT NULL,
  target_unit VARCHAR(20) NOT NULL,
  target_price_per_unit DECIMAL(12,2) NULL,
  cluster_id INT NULL,
  needed_by_date DATE NULL,
  notes TEXT NULL,
  status ENUM('OPEN','MATCHED','CONVERTED','EXPIRED','CANCELLED') DEFAULT 'OPEN',
  converted_pool_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_dpr_buyer (buyer_id),
  KEY idx_dpr_family (family_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_number VARCHAR(40) UNIQUE NOT NULL,
  order_id INT NOT NULL,
  buyer_id INT NOT NULL,
  supplier_id INT NOT NULL,
  subtotal_amount DECIMAL(12,2) NOT NULL,
  delivery_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  buyer_platform_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'PKR',
  status ENUM('ISSUED','PAID','CANCELLED','REFUNDED') DEFAULT 'ISSUED',
  invoice_snapshot_json JSON NULL,
  issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_inv_order (order_id),
  KEY idx_inv_buyer (buyer_id),
  KEY idx_inv_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Two-Way Order Reviews Table
CREATE TABLE IF NOT EXISTS order_reviews (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  reviewer_id INT NOT NULL,
  reviewer_role ENUM('BUYER','SUPPLIER') NOT NULL,
  target_id INT NOT NULL,
  rating INT NOT NULL,
  quality_rating INT NULL,
  delivery_rating INT NULL,
  communication_rating INT NULL,
  review_text TEXT NULL,
  is_verified_purchase TINYINT(1) DEFAULT 1,
  status ENUM('PUBLISHED','FLAGGED','HIDDEN') DEFAULT 'PUBLISHED',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_reviewer (order_id, reviewer_id),
  KEY idx_review_target (target_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. In-App Conversations and Messages
CREATE TABLE IF NOT EXISTS in_app_conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_code VARCHAR(40) UNIQUE NOT NULL,
  order_id INT NULL,
  pool_id INT NULL,
  buyer_id INT NOT NULL,
  supplier_id INT NOT NULL,
  last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_conv_participants (buyer_id, supplier_id),
  KEY idx_conv_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS in_app_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender_id INT NOT NULL,
  message_text TEXT NOT NULL,
  has_contact_warning TINYINT(1) DEFAULT 0,
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_msg_conv (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Sponsored Campaigns Table
CREATE TABLE IF NOT EXISTS sponsored_campaigns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campaign_code VARCHAR(40) UNIQUE NOT NULL,
  supplier_id INT NOT NULL,
  campaign_type ENUM('SPONSORED_LISTING','FEATURED_POOL') NOT NULL,
  listing_id INT NULL,
  pool_id INT NULL,
  daily_budget_pkr DECIMAL(12,2) DEFAULT 0.00,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('PENDING_REVIEW','ACTIVE','PAUSED','COMPLETED','REJECTED') DEFAULT 'PENDING_REVIEW',
  rejection_reason TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_sc_supp (supplier_id),
  KEY idx_sc_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
