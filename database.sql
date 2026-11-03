-- ============================================================
-- SPHINXTOUR - HOSTINGER MYSQL DATABASE SCHEMA
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- Table structure for settings
-- ----------------------------
CREATE TABLE IF NOT EXISTS `settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `site_name` varchar(255) NOT NULL DEFAULT 'SphinxTour',
  `whatsapp_number` varchar(50) NOT NULL DEFAULT '201012345678',
  `contact_email` varchar(255) DEFAULT 'info@sphinxtour.com',
  `phone` varchar(50) DEFAULT '+20 101 234 5678',
  `currency` varchar(10) DEFAULT '€',
  `currency_code` varchar(10) DEFAULT 'EUR',
  `admin_pin` varchar(100) DEFAULT 'admin123',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `settings` (`id`, `site_name`, `whatsapp_number`, `contact_email`, `phone`, `currency`, `currency_code`, `admin_pin`)
VALUES (1, 'SphinxTour', '201012345678', 'info@sphinxtour.com', '+20 101 234 5678', '€', 'EUR', 'admin123')
ON DUPLICATE KEY UPDATE `site_name` = VALUES(`site_name`);

-- ----------------------------
-- Table structure for cities
-- ----------------------------
CREATE TABLE IF NOT EXISTS `cities` (
  `id` varchar(50) NOT NULL,
  `slug` varchar(100) NOT NULL,
  `name_en` varchar(150) NOT NULL,
  `name_ru` varchar(150) DEFAULT NULL,
  `name_fr` varchar(150) DEFAULT NULL,
  `name_pl` varchar(150) DEFAULT NULL,
  `tagline_en` varchar(255) DEFAULT NULL,
  `tagline_ru` varchar(255) DEFAULT NULL,
  `tagline_fr` varchar(255) DEFAULT NULL,
  `tagline_pl` varchar(255) DEFAULT NULL,
  `desc_en` text DEFAULT NULL,
  `desc_ru` text DEFAULT NULL,
  `desc_fr` text DEFAULT NULL,
  `desc_pl` text DEFAULT NULL,
  `image` text DEFAULT NULL,
  `sort_order` int(11) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `cities` (`id`, `slug`, `name_en`, `name_ru`, `name_fr`, `name_pl`, `tagline_en`, `tagline_ru`, `tagline_fr`, `tagline_pl`, `desc_en`, `desc_ru`, `desc_fr`, `desc_pl`, `image`, `sort_order`)
VALUES
('hurghada', 'hurghada', 'Hurghada', 'Хургада', 'Hourghada', 'Hurghada',
 'Red Sea Riviera & Island Paradises', 'Ривьера Красного моря и райские острова', 'Riviera de la Mer Rouge et îles paradisiaques', 'Riwiera Morza Czerwonego i rajskie wyspy',
 'Famous for turquoise bays, vibrant coral reefs, world-class diving, and desert quad safaris along the golden coast.',
 'Знаменита бирюзовыми лагунами, коралловыми рифами, дайвингом мирового класса и сафари по золотой пустыне.',
 'Célèbre pour ses baies turquoises, récifs coralliens spectaculaires, plongée sous-marine et safaris en quad.',
 'Słynie z turkusowych zatok, raf koralowych, nurkowania światowej klasy i safari na quadach po pustyni.',
 'https://images.unsplash.com/photo-1544885935-98dd03b09034?auto=format&fit=crop&w=1200&q=80', 1),

('sharm', 'sharm-el-sheikh', 'Sharm El Sheikh', 'Шарм-эль-Шейх', 'Charm el-Cheikh', 'Szarm el-Szejk',
 'The Pearl of Sinai & Marine Sanctuaries', 'Жемчужина Синая и морские заповедники', 'La perle du Sinaï et sanctuaires marins', 'Perła Synaju i morskie rezerwaty',
 'Surrounded by Ras Mohammed National Park, crystal-clear straits of Tiran, Mount Sinai sunrises, and luxury nightlife.',
 'Окружен заповедником Рас Мохаммед, проливом Тиран, рассветами на горе Синай и ночной жизнью.',
 'Entouré par le parc national de Ras Mohammed, les détroits de Tiran et les levers de soleil sur le mont Sinaï.',
 'Otoczony parkiem narodowym Ras Mohammed, cieśniną Tiran i wschodami słońca na górze Synaj.',
 'https://images.unsplash.com/photo-1568322445389-f64ac2515020?auto=format&fit=crop&w=1200&q=80', 2),

('marsa-alam', 'marsa-alam', 'Marsa Alam', 'Марса Алам', 'Marsa Alam', 'Marsa Alam',
 'Untouched Nature & Sea Turtles Haven', 'Нетронутая природа и рай морских черепах', 'Nature préservée et sanctuaire des tortues géantes', 'Dzika natura i przystań gigantycznych żółwi',
 'A tranquil southern jewel with pristine reefs, spinner dolphins at Sataya Reef, and sea cow (dugong) encounters.',
 'Южный оазис первозданных рифов, дельфиньих бухт Сатая и редких морских коров в заливе Абу Даббаб.',
 'Un joyau préservé du sud avec récifs intacts, dauphins de Sataya et dugongs de la baie d\'Abu Dabbab.',
 'Spokojna oaza z dziewiczymi rafami, delfinami w Sataya i diugoniami w zatoce Abu Dabbab.',
 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80', 3),

('alamein', 'alamein', 'Alamein & North Coast', 'Эль-Аламейн и Северное побережье', 'El Alamein & Côte Nord', 'El Alamein i Wybrzeże Północne',
 'Mediterranean Luxury & Historic Heritage', 'Средиземноморская роскошь и историческое наследие', 'Luxe méditerranéen et patrimoine historique', 'Śródziemnomorski luksus i dziedzictwo historyczne',
 'The modern Egyptian Riviera with pure white sands, turquoise Mediterranean waters, WWII history, and VIP yachting.',
 'Современная Ривьера с белоснежными песками, лазурным Средиземным морем, музеями ВОВ и яхтингом.',
 'La nouvelle Riviera égyptienne avec sables blancs, eaux cristallines, histoire et yachting VIP.',
 'Nowoczesna riwiera z białym piaskiem, turkusowym morzem, historią II Wojny Światowej i luksusowymi jachtami.',
 'https://images.unsplash.com/photo-1512100356356-de1b84283e18?auto=format&fit=crop&w=1200&q=80', 4)
ON DUPLICATE KEY UPDATE `name_en` = VALUES(`name_en`);

-- ----------------------------
-- Table structure for tours
-- ----------------------------
CREATE TABLE IF NOT EXISTS `tours` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `city_id` varchar(50) NOT NULL,
  `category` varchar(50) DEFAULT 'island',
  `name_en` varchar(255) NOT NULL,
  `name_ru` varchar(255) DEFAULT NULL,
  `name_fr` varchar(255) DEFAULT NULL,
  `name_pl` varchar(255) DEFAULT NULL,
  `desc_en` text DEFAULT NULL,
  `desc_ru` text DEFAULT NULL,
  `desc_fr` text DEFAULT NULL,
  `desc_pl` text DEFAULT NULL,
  `price` decimal(10,2) NOT NULL DEFAULT 0.00,
  `price_child` decimal(10,2) DEFAULT NULL,
  `duration` varchar(100) DEFAULT NULL,
  `rating` decimal(3,1) DEFAULT 4.9,
  `reviews_count` int(11) DEFAULT 150,
  `image` text DEFAULT NULL,
  `included_json` text DEFAULT NULL,
  `featured` tinyint(1) DEFAULT 0,
  `active` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------
-- Table structure for bookings
-- ----------------------------
CREATE TABLE IF NOT EXISTS `bookings` (
  `id` varchar(50) NOT NULL,
  `tour_id` int(11) DEFAULT NULL,
  `tour_name` varchar(255) DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `tour_date` date DEFAULT NULL,
  `adults` int(11) DEFAULT 1,
  `children` int(11) DEFAULT 0,
  `client_name` varchar(150) DEFAULT NULL,
  `hotel` varchar(255) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `lang` varchar(10) DEFAULT 'en',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------
-- Table structure for reviews
-- ----------------------------
CREATE TABLE IF NOT EXISTS `reviews` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `country` varchar(100) DEFAULT 'Verified Traveler',
  `tour` varchar(255) DEFAULT 'Egypt Excursion',
  `rating` int(2) NOT NULL DEFAULT 5,
  `comment` text NOT NULL,
  `review_date` date DEFAULT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
