-- ============================================================
-- SPHINXTOUR - HOSTINGER MYSQL DATABASE SCHEMA
-- Note: server.js automatically creates these tables AND seeds
-- all initial cities, tours, bazar products, settings, and reviews
-- from data/database.json on first request when Hostinger MYSQL_*
-- environment variables are configured.
-- You can also import this file in phpMyAdmin if preferred.
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for app_meta
-- ----------------------------
CREATE TABLE IF NOT EXISTS `app_meta` (
  `meta_key` VARCHAR(64) NOT NULL,
  `meta_value` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`meta_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Table structure for settings
-- ----------------------------
CREATE TABLE IF NOT EXISTS `settings` (
  `id` INT NOT NULL,
  `site_name` VARCHAR(255) NOT NULL DEFAULT 'SphinxTour',
  `whatsapp_number` VARCHAR(64) NOT NULL DEFAULT '201140423458',
  `contact_email` VARCHAR(255) DEFAULT 'info@sphinxtour.com',
  `phone` VARCHAR(64) DEFAULT '+20 114 042 3458',
  `currency` VARCHAR(16) DEFAULT '$',
  `currency_code` VARCHAR(16) DEFAULT 'USD',
  `admin_pin` VARCHAR(255) DEFAULT 'admin123',
  `social_facebook` VARCHAR(512) DEFAULT '',
  `social_instagram` VARCHAR(512) DEFAULT '',
  `social_telegram` VARCHAR(512) DEFAULT '',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `settings` (`id`, `site_name`, `whatsapp_number`, `contact_email`, `phone`, `currency`, `currency_code`, `admin_pin`, `social_facebook`, `social_instagram`, `social_telegram`)
VALUES (1, 'SphinxTour', '201140423458', 'info@sphinxtour.com', '+20 114 042 3458', '$', 'USD', 'admin123', '', '', '')
ON DUPLICATE KEY UPDATE `site_name` = VALUES(`site_name`);

-- ----------------------------
-- Table structure for cities
-- ----------------------------
CREATE TABLE IF NOT EXISTS `cities` (
  `id` VARCHAR(64) NOT NULL,
  `slug` VARCHAR(128) NOT NULL,
  `sort_order` INT DEFAULT 1,
  `featured` TINYINT(1) DEFAULT 1,
  `image` VARCHAR(1000) DEFAULT '',
  `names_json` LONGTEXT,
  `taglines_json` LONGTEXT,
  `descriptions_json` LONGTEXT,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Table structure for tours
-- ----------------------------
CREATE TABLE IF NOT EXISTS `tours` (
  `id` BIGINT NOT NULL,
  `city_id` VARCHAR(64) NOT NULL,
  `category` VARCHAR(64) DEFAULT 'island',
  `price` DECIMAL(10,2) DEFAULT 0.00,
  `price_child` DECIMAL(10,2) DEFAULT 0.00,
  `duration` VARCHAR(120) DEFAULT '',
  `rating` DECIMAL(3,1) DEFAULT 5.0,
  `reviews_count` INT DEFAULT 1,
  `image` VARCHAR(1000) DEFAULT '',
  `names_json` LONGTEXT,
  `short_descriptions_json` LONGTEXT,
  `descriptions_json` LONGTEXT,
  `gallery_json` LONGTEXT,
  `included_json` LONGTEXT,
  `featured` TINYINT(1) DEFAULT 0,
  `active` TINYINT(1) DEFAULT 1,
  `sort_idx` INT DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Table structure for products (Bazar Shop)
-- ----------------------------
CREATE TABLE IF NOT EXISTS `products` (
  `id` BIGINT NOT NULL,
  `category` VARCHAR(64) DEFAULT 'souvenirs',
  `price` DECIMAL(10,2) DEFAULT 0.00,
  `image` VARCHAR(1000) DEFAULT '',
  `names_json` LONGTEXT,
  `specs_json` LONGTEXT,
  `descriptions_json` LONGTEXT,
  `featured` TINYINT(1) DEFAULT 0,
  `active` TINYINT(1) DEFAULT 1,
  `sort_idx` INT DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Table structure for bookings
-- ----------------------------
CREATE TABLE IF NOT EXISTS `bookings` (
  `id` VARCHAR(64) NOT NULL,
  `tour_id` VARCHAR(64) DEFAULT '',
  `tour_name` VARCHAR(255) DEFAULT '',
  `city` VARCHAR(120) DEFAULT '',
  `booking_date` VARCHAR(32) DEFAULT '',
  `adults` INT DEFAULT 1,
  `children` INT DEFAULT 0,
  `client_name` VARCHAR(150) DEFAULT 'Guest',
  `hotel` VARCHAR(255) DEFAULT '',
  `notes` TEXT,
  `lang` VARCHAR(16) DEFAULT 'en',
  `created_at` VARCHAR(40) DEFAULT '',
  `sort_idx` INT DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- Table structure for reviews
-- ----------------------------
CREATE TABLE IF NOT EXISTS `reviews` (
  `id` BIGINT NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `country` VARCHAR(100) DEFAULT 'Verified Traveler',
  `tour` VARCHAR(255) DEFAULT 'Egypt Excursion',
  `rating` TINYINT DEFAULT 5,
  `comment` TEXT NOT NULL,
  `review_date` VARCHAR(32) DEFAULT '',
  `approved` TINYINT(1) DEFAULT 0,
  `status` VARCHAR(32) DEFAULT 'pending',
  `sort_idx` INT DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
