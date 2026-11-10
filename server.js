const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'database.json');
const TMP_DB_FILE = path.join(os.tmpdir(), 'sphinxtour_database.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

// Behind reverse proxies (Hostinger, Vercel) use first proxy hop for accurate client IP rate-limiting
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Ensure uploads dir exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ==================== SECURITY MIDDLEWARE (HEADERS, ANTI-DOS, CORS) ====================
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
      formAction: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'same-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  // Basic malformed URI / null-byte / length guard against DoS probes
  if (req.originalUrl && (req.originalUrl.length > 2048 || req.originalUrl.includes('\0') || req.originalUrl.toLowerCase().includes('%00'))) {
    return res.status(400).json({ success: false, error: 'Invalid request' });
  }
  next();
});

const ALLOWED_CORS_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
  /^https:\/\/([a-z0-9-]+\.)?sphinx-tour\.com$/i,
  /^https:\/\/([a-z0-9-]+\.)?sphinxtour\.com$/i,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const allowed = ALLOWED_CORS_ORIGINS.some(re => re.test(origin));
    return cb(null, allowed);
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-admin-pin'],
  maxAge: 600
}));

// Rate Limiters (each uses its own memory store cleanly)
const rateLimitValidate = { forwardedHeader: false };

const generalTrafficLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: rateLimitValidate,
  skip: (req) => req.path.startsWith('/api/'),
  handler: (req, res) => {
    res.status(429).send('Too many requests. Please try again in a minute.');
  }
});

const apiReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: rateLimitValidate,
  message: { success: false, error: 'Too many API requests, please slow down.' }
});

const publicWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: rateLimitValidate,
  message: { success: false, error: 'Too many submissions from your IP. Please try again later.' }
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: rateLimitValidate,
  message: { success: false, error: 'Too many failed Admin PIN attempts. Locked for 15 minutes.' }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: rateLimitValidate,
  message: { success: false, error: 'Too many file uploads. Please try again later.' }
});

app.use(generalTrafficLimiter);
app.use('/api', apiReadLimiter);

// Strict JSON / URL-encoded payload size limits (prevents JSON memory-bomb DoS)
app.use(express.json({ limit: '100kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '100kb', parameterLimit: 50 }));

// ==================== INPUT & FILE MALWARE SANITIZATION ====================
const SAFE_IMAGE_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const SAFE_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Memory storage prevents untrusted/infected files from touching disk before magic-byte & malware scan
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
    files: 1,
    fields: 5,
    headerPairs: 50
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    // Explicitly disallow SVG & active content even if image/*
    if (!SAFE_IMAGE_EXT.has(ext) || !SAFE_IMAGE_MIME.has(mime)) {
      return cb(new Error('Only safe raster images (JPG, PNG, WEBP, GIF) are allowed.'));
    }
    return cb(null, true);
  }
});

function detectAndScanImageBuffer(buf, originalExt) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) {
    return { valid: false, reason: 'Invalid or empty file buffer.' };
  }

  // Verify real binary magic bytes
  let detectedExt = null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    detectedExt = '.jpg';
  } else if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    detectedExt = '.png';
  } else if (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a') {
    detectedExt = '.gif';
  } else if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    detectedExt = '.webp';
  }

  if (!detectedExt) {
    return { valid: false, reason: 'File binary signature does not match a valid image.' };
  }

  // Reject masked extension spoofing (e.g., PNG renamed to .gif? minor; block non-image header masquerading)
  const normOrig = originalExt === '.jpeg' ? '.jpg' : originalExt;
  if (normOrig !== detectedExt && !(normOrig === '.jpg' && detectedExt === '.jpg')) {
    return { valid: false, reason: 'File extension does not match actual image contents.' };
  }

  // Scan binary payload for embedded PHP shells, XSS scripts, or executable polyglots
  const asciiLower = buf.toString('latin1').toLowerCase();
  const bannedPatterns = [
    '<?php',
    '<script',
    '</script>',
    '<iframe',
    '<object',
    '<embed',
    'javascript:'
  ];
  for (const sig of bannedPatterns) {
    if (asciiLower.includes(sig)) {
      return { valid: false, reason: 'Potentially malicious or active script content detected in file.' };
    }
  }
  if (/<\?=[\s\x20-\x7e]{2,120}\?>/.test(asciiLower)) {
    return { valid: false, reason: 'Potentially malicious embedded PHP expression detected in file.' };
  }

  // Reject executable headers if prepended or embedded near file boundaries
  const headerSlice = buf.subarray(0, 64);
  if (
    headerSlice.subarray(0, 2).toString('ascii') === 'MZ' ||
    headerSlice.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    asciiLower.startsWith('%pdf-') ||
    asciiLower.trimStart().startsWith('<svg')
  ) {
    return { valid: false, reason: 'Executable or vector document blocked.' };
  }

  return { valid: true, ext: detectedExt };
}

function cleanText(val, maxLen = 300, stripHtml = false) {
  if (typeof val !== 'string') return '';
  let out = val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (stripHtml) {
    out = out.replace(/<[^>]*>/g, '');
  }
  if (out.length > maxLen) {
    out = out.slice(0, maxLen);
  }
  return out;
}

function sanitizeExternalUrl(url, fallback = '') {
  if (typeof url !== 'string') return fallback;
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.length > 1000) return fallback;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

function sanitizeImageUrl(url, fallback = '/uploads/banner_1.jpg') {
  if (typeof url !== 'string') return fallback;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 1000) return fallback;
  if (trimmed.startsWith('/uploads/') && !trimmed.includes('..') && !trimmed.includes('\\')) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

function sanitizeNestedStrings(val, maxLen = 3000, depth = 0) {
  if (depth > 6) return '';
  if (typeof val === 'string') return cleanText(val, maxLen, true);
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  if (Array.isArray(val)) {
    return val.slice(0, 50).map(item => sanitizeNestedStrings(item, maxLen, depth + 1));
  }
  if (val && typeof val === 'object') {
    const out = {};
    for (const key of Object.keys(val)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      out[key] = sanitizeNestedStrings(val[key], maxLen, depth + 1);
    }
    return out;
  }
  return val;
}

// Strip prototype pollution keys globally on incoming JSON bodies
function stripDangerousKeys(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return obj;
  if (Array.isArray(obj)) {
    return obj.slice(0, 200).map(item => stripDangerousKeys(item, depth + 1));
  }
  const clean = {};
  for (const key of Object.keys(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    clean[key] = stripDangerousKeys(obj[key], depth + 1);
  }
  return clean;
}

app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = stripDangerousKeys(req.body);
  }
  next();
});

// Block direct access to non-image files inside /uploads even if placed manually
app.use('/uploads', (req, res, next) => {
  const cleanPath = (req.path || '').split('?')[0].toLowerCase();
  if (cleanPath && cleanPath !== '/') {
    const ext = path.extname(cleanPath);
    if (!SAFE_IMAGE_EXT.has(ext)) {
      return res.status(403).send('Forbidden');
    }
  }
  next();
});

// Serve static frontend files with safe headers
app.use(express.static(path.join(__dirname, 'public'), {
  dotfiles: 'deny',
  maxAge: '1h',
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));
app.use('/uploads', express.static(UPLOADS_DIR, {
  dotfiles: 'deny',
  index: false,
  maxAge: '1d',
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

// Helper: read and write database (Hostinger MySQL via env vars, with local JSON fallback)
function getMysqlConfig() {
  const urlStr = process.env.MYSQL_URL || process.env.DATABASE_URL || '';
  if (urlStr) {
    try {
      const u = new URL(urlStr);
      const dbName = (u.pathname || '').replace(/^\//, '');
      if (u.hostname && u.username && dbName) {
        return {
          host: u.hostname,
          port: Number(u.port || 3306),
          user: decodeURIComponent(u.username || ''),
          password: decodeURIComponent(u.password || ''),
          database: dbName,
          ssl: process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined
        };
      }
    } catch (e) {
      console.error('Invalid MYSQL_URL / DATABASE_URL format');
    }
  }

  const user = process.env.MYSQL_USER || process.env.DB_USER || '';
  const database = process.env.MYSQL_DATABASE || process.env.MYSQL_DB || process.env.DB_NAME || '';
  if (!user || !database) return null;

  const password = process.env.MYSQL_PASSWORD !== undefined
    ? process.env.MYSQL_PASSWORD
    : (process.env.DB_PASSWORD !== undefined
      ? process.env.DB_PASSWORD
      : (process.env.DB_PASS || ''));

  return {
    host: process.env.MYSQL_HOST || process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || process.env.DB_PORT || 3306),
    user,
    password,
    database,
    ssl: process.env.MYSQL_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  };
}

function isMysqlEnabled() {
  return Boolean(getMysqlConfig());
}

function readJsonDbSync() {
  try {
    const hasTmp = fs.existsSync(TMP_DB_FILE);
    const hasDb = fs.existsSync(DB_FILE);
    const useTmp = hasTmp && (!hasDb || fs.statSync(TMP_DB_FILE).mtimeMs > fs.statSync(DB_FILE).mtimeMs);
    const raw = fs.readFileSync(useTmp ? TMP_DB_FILE : DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.products) parsed.products = [];
    if (!parsed.bookings) parsed.bookings = [];
    if (!parsed.reviews) parsed.reviews = [];
    if (!parsed.cities) parsed.cities = [];
    if (!parsed.tours) parsed.tours = [];
    if (!parsed.settings) parsed.settings = {};
    return parsed;
  } catch (err) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed.products) parsed.products = [];
      if (!parsed.bookings) parsed.bookings = [];
      if (!parsed.reviews) parsed.reviews = [];
      if (!parsed.cities) parsed.cities = [];
      if (!parsed.tours) parsed.tours = [];
      if (!parsed.settings) parsed.settings = {};
      return parsed;
    } catch (e) {
      console.error('Error reading database:', err);
      return { settings: {}, cities: [], tours: [], products: [], bookings: [], reviews: [] };
    }
  }
}

function saveJsonDbSync(data) {
  let saved = false;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    saved = true;
  } catch (err) {
    // Read-only filesystem (e.g. serverless)
  }

  try {
    fs.writeFileSync(TMP_DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    saved = true;
  } catch (tmpErr) {
    console.error('Error writing to tmp:', tmpErr);
  }

  return saved;
}

function safeJsonParse(str, fallback) {
  if (typeof str !== 'string') return str || fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

let mysqlPool = null;
let mysqlInitPromise = null;
let mysqlWriteChain = Promise.resolve();

async function createMysqlPoolWithFallback() {
  const cfg = getMysqlConfig();
  if (!cfg) return null;

  const baseOpts = {
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 5,
    maxIdle: 5,
    idleTimeout: 60000,
    enableKeepAlive: true,
    connectTimeout: 8000
  };

  let pool = mysql.createPool({ ...baseOpts, host: cfg.host });
  try {
    await pool.query('SELECT 1');
    return pool;
  } catch (err) {
    // Hostinger local containers sometimes bind TCP on 127.0.0.1 vs localhost socket
    if (cfg.host === 'localhost' || cfg.host === '127.0.0.1') {
      const altHost = cfg.host === 'localhost' ? '127.0.0.1' : 'localhost';
      await pool.end().catch(() => {});
      pool = mysql.createPool({ ...baseOpts, host: altHost });
      try {
        await pool.query('SELECT 1');
        return pool;
      } catch (altErr) {
        await pool.end().catch(() => {});
        throw altErr;
      }
    }
    await pool.end().catch(() => {});
    throw err;
  }
}

async function ensureMysqlReady() {
  if (!isMysqlEnabled()) return null;
  if (mysqlInitPromise) return mysqlInitPromise;

  mysqlInitPromise = (async () => {
    const pool = await createMysqlPoolWithFallback();
    mysqlPool = pool;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_meta (
        meta_key VARCHAR(64) PRIMARY KEY,
        meta_value VARCHAR(255) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT PRIMARY KEY,
        site_name VARCHAR(255) NOT NULL DEFAULT 'SphinxTour',
        whatsapp_number VARCHAR(64) NOT NULL DEFAULT '201140423458',
        contact_email VARCHAR(255) DEFAULT 'info@sphinxtour.com',
        phone VARCHAR(64) DEFAULT '+20 114 042 3458',
        currency VARCHAR(16) DEFAULT '$',
        currency_code VARCHAR(16) DEFAULT 'USD',
        admin_pin VARCHAR(255) DEFAULT 'admin123',
        social_facebook VARCHAR(512) DEFAULT '',
        social_instagram VARCHAR(512) DEFAULT '',
        social_telegram VARCHAR(512) DEFAULT ''
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cities (
        id VARCHAR(64) PRIMARY KEY,
        slug VARCHAR(128) NOT NULL,
        sort_order INT DEFAULT 1,
        featured TINYINT(1) DEFAULT 1,
        image VARCHAR(1000) DEFAULT '',
        names_json LONGTEXT,
        taglines_json LONGTEXT,
        descriptions_json LONGTEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tours (
        id BIGINT PRIMARY KEY,
        city_id VARCHAR(64) NOT NULL,
        category VARCHAR(64) DEFAULT 'island',
        price DECIMAL(10,2) DEFAULT 0,
        price_child DECIMAL(10,2) DEFAULT 0,
        duration VARCHAR(120) DEFAULT '',
        rating DECIMAL(3,1) DEFAULT 5.0,
        reviews_count INT DEFAULT 1,
        image VARCHAR(1000) DEFAULT '',
        names_json LONGTEXT,
        short_descriptions_json LONGTEXT,
        descriptions_json LONGTEXT,
        gallery_json LONGTEXT,
        included_json LONGTEXT,
        featured TINYINT(1) DEFAULT 0,
        active TINYINT(1) DEFAULT 1,
        sort_idx INT DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id BIGINT PRIMARY KEY,
        category VARCHAR(64) DEFAULT 'souvenirs',
        price DECIMAL(10,2) DEFAULT 0,
        image VARCHAR(1000) DEFAULT '',
        names_json LONGTEXT,
        specs_json LONGTEXT,
        descriptions_json LONGTEXT,
        featured TINYINT(1) DEFAULT 0,
        active TINYINT(1) DEFAULT 1,
        sort_idx INT DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id VARCHAR(64) PRIMARY KEY,
        tour_id VARCHAR(64) DEFAULT '',
        tour_name VARCHAR(255) DEFAULT '',
        city VARCHAR(120) DEFAULT '',
        booking_date VARCHAR(32) DEFAULT '',
        adults INT DEFAULT 1,
        children INT DEFAULT 0,
        client_name VARCHAR(150) DEFAULT 'Guest',
        hotel VARCHAR(255) DEFAULT '',
        notes TEXT,
        lang VARCHAR(16) DEFAULT 'en',
        created_at VARCHAR(40) DEFAULT '',
        sort_idx INT DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id BIGINT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        country VARCHAR(100) DEFAULT 'Verified Traveler',
        tour VARCHAR(255) DEFAULT 'Egypt Excursion',
        rating TINYINT DEFAULT 5,
        comment TEXT NOT NULL,
        review_date VARCHAR(32) DEFAULT '',
        approved TINYINT(1) DEFAULT 0,
        status VARCHAR(32) DEFAULT 'pending',
        sort_idx INT DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Seed initial data once from data/database.json if this MySQL database has not been seeded yet
    const [metaRows] = await pool.query("SELECT meta_value FROM app_meta WHERE meta_key = 'initial_seed_v1'");
    if (metaRows.length === 0) {
      const [settingsCnt] = await pool.query('SELECT COUNT(*) AS c FROM settings');
      const [cityCnt] = await pool.query('SELECT COUNT(*) AS c FROM cities');
      const [tourCnt] = await pool.query('SELECT COUNT(*) AS c FROM tours');
      const seedData = readJsonDbSync();
      if (process.env.ADMIN_PIN && process.env.ADMIN_PIN.trim().length >= 4) {
        seedData.settings = { ...(seedData.settings || {}), admin_pin: process.env.ADMIN_PIN.trim() };
      }

      if (cityCnt[0].c === 0 && tourCnt[0].c === 0) {
        await writeMysqlTables(pool, seedData, ['settings', 'cities', 'tours', 'products', 'bookings', 'reviews']);
      } else if (settingsCnt[0].c === 0) {
        await writeMysqlTables(pool, seedData, ['settings']);
      }
      await pool.query("INSERT IGNORE INTO app_meta (meta_key, meta_value) VALUES ('initial_seed_v1', '1')");
    }

    return pool;
  })().catch((err) => {
    mysqlInitPromise = null;
    mysqlPool = null;
    throw err;
  });

  return mysqlInitPromise;
}

async function writeMysqlTables(pool, data, scopes) {
  const scopeSet = new Set(scopes && scopes.length ? scopes : ['settings', 'cities', 'tours', 'products', 'bookings', 'reviews']);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (scopeSet.has('settings')) {
      const s = data.settings || {};
      await conn.query(
        `INSERT INTO settings (id, site_name, whatsapp_number, contact_email, phone, currency, currency_code, admin_pin, social_facebook, social_instagram, social_telegram)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           site_name = VALUES(site_name),
           whatsapp_number = VALUES(whatsapp_number),
           contact_email = VALUES(contact_email),
           phone = VALUES(phone),
           currency = VALUES(currency),
           currency_code = VALUES(currency_code),
           admin_pin = VALUES(admin_pin),
           social_facebook = VALUES(social_facebook),
           social_instagram = VALUES(social_instagram),
           social_telegram = VALUES(social_telegram)`,
        [
          s.site_name || 'SphinxTour',
          s.whatsapp_number || '201140423458',
          s.contact_email || 'info@sphinxtour.com',
          s.phone || '+20 114 042 3458',
          s.currency || '$',
          s.currency_code || 'USD',
          s.admin_pin || 'admin123',
          s.social_facebook || '',
          s.social_instagram || '',
          s.social_telegram || ''
        ]
      );
    }

    if (scopeSet.has('cities')) {
      const cities = Array.isArray(data.cities) ? data.cities : [];
      if (cities.length === 0) {
        await conn.query('DELETE FROM cities');
      } else {
        const ids = cities.map(c => String(c.id));
        await conn.query(`DELETE FROM cities WHERE id NOT IN (${ids.map(() => '?').join(',')})`, ids);
        for (let i = 0; i < cities.length; i++) {
          const c = cities[i];
          await conn.query(
            `INSERT INTO cities (id, slug, sort_order, featured, image, names_json, taglines_json, descriptions_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               slug = VALUES(slug),
               sort_order = VALUES(sort_order),
               featured = VALUES(featured),
               image = VALUES(image),
               names_json = VALUES(names_json),
               taglines_json = VALUES(taglines_json),
               descriptions_json = VALUES(descriptions_json)`,
            [
              String(c.id),
              c.slug || String(c.id),
              Number(c.order) || (i + 1),
              c.featured !== false ? 1 : 0,
              c.image || '',
              JSON.stringify(c.names || {}),
              JSON.stringify(c.taglines || {}),
              JSON.stringify(c.descriptions || {})
            ]
          );
        }
      }
    }

    if (scopeSet.has('tours')) {
      const tours = Array.isArray(data.tours) ? data.tours : [];
      if (tours.length === 0) {
        await conn.query('DELETE FROM tours');
      } else {
        const ids = tours.map(t => Number(t.id) || 0);
        await conn.query(`DELETE FROM tours WHERE id NOT IN (${ids.map(() => '?').join(',')})`, ids);
        for (let i = 0; i < tours.length; i++) {
          const t = tours[i];
          await conn.query(
            `INSERT INTO tours (id, city_id, category, price, price_child, duration, rating, reviews_count, image, names_json, short_descriptions_json, descriptions_json, gallery_json, included_json, featured, active, sort_idx)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               city_id = VALUES(city_id),
               category = VALUES(category),
               price = VALUES(price),
               price_child = VALUES(price_child),
               duration = VALUES(duration),
               rating = VALUES(rating),
               reviews_count = VALUES(reviews_count),
               image = VALUES(image),
               names_json = VALUES(names_json),
               short_descriptions_json = VALUES(short_descriptions_json),
               descriptions_json = VALUES(descriptions_json),
               gallery_json = VALUES(gallery_json),
               included_json = VALUES(included_json),
               featured = VALUES(featured),
               active = VALUES(active),
               sort_idx = VALUES(sort_idx)`,
            [
              Number(t.id) || 0,
              t.city_id || 'hurghada',
              t.category || 'island',
              Number(t.price) || 0,
              Number(t.price_child) || 0,
              t.duration || '',
              Number(t.rating) || 5.0,
              Number(t.reviews_count) || 1,
              t.image || '/uploads/banner_1.jpg',
              JSON.stringify(t.names || {}),
              JSON.stringify(t.short_descriptions || {}),
              JSON.stringify(t.descriptions || {}),
              JSON.stringify(t.gallery || []),
              JSON.stringify(t.included || {}),
              t.featured ? 1 : 0,
              t.active !== false ? 1 : 0,
              i
            ]
          );
        }
      }
    }

    if (scopeSet.has('products')) {
      const products = Array.isArray(data.products) ? data.products : [];
      if (products.length === 0) {
        await conn.query('DELETE FROM products');
      } else {
        const ids = products.map(p => Number(p.id) || 0);
        await conn.query(`DELETE FROM products WHERE id NOT IN (${ids.map(() => '?').join(',')})`, ids);
        for (let i = 0; i < products.length; i++) {
          const p = products[i];
          await conn.query(
            `INSERT INTO products (id, category, price, image, names_json, specs_json, descriptions_json, featured, active, sort_idx)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               category = VALUES(category),
               price = VALUES(price),
               image = VALUES(image),
               names_json = VALUES(names_json),
               specs_json = VALUES(specs_json),
               descriptions_json = VALUES(descriptions_json),
               featured = VALUES(featured),
               active = VALUES(active),
               sort_idx = VALUES(sort_idx)`,
            [
              Number(p.id) || 0,
              p.category || 'souvenirs',
              Number(p.price) || 0,
              p.image || '/uploads/bazar_papyrus.jpg',
              JSON.stringify(p.names || {}),
              JSON.stringify(p.specs || {}),
              JSON.stringify(p.descriptions || {}),
              p.featured ? 1 : 0,
              p.active !== false ? 1 : 0,
              i
            ]
          );
        }
      }
    }

    if (scopeSet.has('bookings')) {
      const bookings = Array.isArray(data.bookings) ? data.bookings : [];
      if (bookings.length === 0) {
        await conn.query('DELETE FROM bookings');
      } else {
        const ids = bookings.map(b => String(b.id));
        await conn.query(`DELETE FROM bookings WHERE id NOT IN (${ids.map(() => '?').join(',')})`, ids);
        for (let i = 0; i < bookings.length; i++) {
          const b = bookings[i];
          await conn.query(
            `INSERT INTO bookings (id, tour_id, tour_name, city, booking_date, adults, children, client_name, hotel, notes, lang, created_at, sort_idx)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               tour_id = VALUES(tour_id),
               tour_name = VALUES(tour_name),
               city = VALUES(city),
               booking_date = VALUES(booking_date),
               adults = VALUES(adults),
               children = VALUES(children),
               client_name = VALUES(client_name),
               hotel = VALUES(hotel),
               notes = VALUES(notes),
               lang = VALUES(lang),
               created_at = VALUES(created_at),
               sort_idx = VALUES(sort_idx)`,
            [
              String(b.id),
              b.tour_id !== undefined && b.tour_id !== null ? String(b.tour_id) : '',
              b.tour_name || 'Excursion',
              b.city || '',
              b.date || '',
              Number(b.adults) || 1,
              Number(b.children) || 0,
              b.client_name || 'Guest',
              b.hotel || '',
              b.notes || '',
              b.lang || 'en',
              b.created_at || new Date().toISOString(),
              i
            ]
          );
        }
      }
    }

    if (scopeSet.has('reviews')) {
      const reviews = Array.isArray(data.reviews) ? data.reviews : [];
      if (reviews.length === 0) {
        await conn.query('DELETE FROM reviews');
      } else {
        const ids = reviews.map(r => Number(r.id) || 0);
        await conn.query(`DELETE FROM reviews WHERE id NOT IN (${ids.map(() => '?').join(',')})`, ids);
        for (let i = 0; i < reviews.length; i++) {
          const r = reviews[i];
          await conn.query(
            `INSERT INTO reviews (id, name, country, tour, rating, comment, review_date, approved, status, sort_idx)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               name = VALUES(name),
               country = VALUES(country),
               tour = VALUES(tour),
               rating = VALUES(rating),
               comment = VALUES(comment),
               review_date = VALUES(review_date),
               approved = VALUES(approved),
               status = VALUES(status),
               sort_idx = VALUES(sort_idx)`,
            [
              Number(r.id) || 0,
              r.name || 'Guest',
              r.country || 'Verified Traveler',
              r.tour || 'Egypt Excursion',
              Number(r.rating) || 5,
              r.comment || '',
              r.date || '',
              r.approved ? 1 : 0,
              r.status || (r.approved ? 'approved' : 'pending'),
              i
            ]
          );
        }
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function getDb() {
  if (!isMysqlEnabled()) {
    return readJsonDbSync();
  }

  const pool = await ensureMysqlReady();
  const [settingsRows] = await pool.query('SELECT * FROM settings WHERE id = 1');
  const [cityRows] = await pool.query('SELECT * FROM cities ORDER BY sort_order ASC, id ASC');
  const [tourRows] = await pool.query('SELECT * FROM tours ORDER BY sort_idx ASC, id DESC');
  const [productRows] = await pool.query('SELECT * FROM products ORDER BY sort_idx ASC, id DESC');
  const [bookingRows] = await pool.query('SELECT * FROM bookings ORDER BY sort_idx ASC, created_at DESC');
  const [reviewRows] = await pool.query('SELECT * FROM reviews ORDER BY sort_idx ASC, id DESC');

  const sRow = settingsRows[0] || {};
  const settings = {
    site_name: sRow.site_name || 'SphinxTour',
    whatsapp_number: sRow.whatsapp_number || '201140423458',
    contact_email: sRow.contact_email || 'info@sphinxtour.com',
    phone: sRow.phone || '+20 114 042 3458',
    currency: sRow.currency || '$',
    currency_code: sRow.currency_code || 'USD',
    admin_pin: sRow.admin_pin || 'admin123',
    social_facebook: sRow.social_facebook || '',
    social_instagram: sRow.social_instagram || '',
    social_telegram: sRow.social_telegram || ''
  };

  const cities = cityRows.map(r => ({
    id: r.id,
    slug: r.slug,
    names: safeJsonParse(r.names_json, {}),
    taglines: safeJsonParse(r.taglines_json, {}),
    descriptions: safeJsonParse(r.descriptions_json, {}),
    image: r.image || '',
    order: Number(r.sort_order) || 1,
    featured: Boolean(r.featured)
  }));

  const tours = tourRows.map(r => ({
    id: Number(r.id),
    city_id: r.city_id,
    category: r.category || 'island',
    names: safeJsonParse(r.names_json, {}),
    short_descriptions: safeJsonParse(r.short_descriptions_json, {}),
    descriptions: safeJsonParse(r.descriptions_json, {}),
    price: Number(r.price) || 0,
    price_child: Number(r.price_child) || 0,
    duration: r.duration || '',
    rating: Number(r.rating) || 5.0,
    reviews_count: Number(r.reviews_count) || 1,
    image: r.image || '/uploads/banner_1.jpg',
    gallery: safeJsonParse(r.gallery_json, []),
    included: safeJsonParse(r.included_json, {}),
    featured: Boolean(r.featured),
    active: r.active !== 0
  }));

  const products = productRows.map(r => ({
    id: Number(r.id),
    category: r.category || 'souvenirs',
    price: Number(r.price) || 0,
    image: r.image || '/uploads/bazar_papyrus.jpg',
    names: safeJsonParse(r.names_json, {}),
    specs: safeJsonParse(r.specs_json, {}),
    descriptions: safeJsonParse(r.descriptions_json, {}),
    featured: Boolean(r.featured),
    active: r.active !== 0
  }));

  const bookings = bookingRows.map(r => ({
    id: r.id,
    tour_id: r.tour_id,
    tour_name: r.tour_name,
    city: r.city,
    date: r.booking_date,
    adults: Number(r.adults) || 1,
    children: Number(r.children) || 0,
    client_name: r.client_name,
    hotel: r.hotel,
    notes: r.notes,
    lang: r.lang,
    created_at: r.created_at
  }));

  const reviews = reviewRows.map(r => ({
    id: Number(r.id),
    name: r.name,
    country: r.country,
    tour: r.tour,
    rating: Number(r.rating) || 5,
    comment: r.comment,
    date: r.review_date,
    approved: Boolean(r.approved),
    status: r.status || (r.approved ? 'approved' : 'pending')
  }));

  return { settings, cities, tours, products, bookings, reviews };
}

async function saveDb(data, scopes) {
  if (!isMysqlEnabled()) {
    return saveJsonDbSync(data);
  }

  const runWrite = async () => {
    const pool = await ensureMysqlReady();
    await writeMysqlTables(pool, data, scopes);
    return true;
  };

  const next = mysqlWriteChain.then(runWrite, runWrite);
  mysqlWriteChain = next.catch(() => {});
  return next;
}

// Constant-time PIN comparison & per-IP failed auth lockout
const failedAdminAttempts = new Map();
const ADMIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_MAX_FAILS = 12;

function safeComparePin(inputPin, actualPin) {
  if (typeof inputPin !== 'string' || typeof actualPin !== 'string') return false;
  if (inputPin.length === 0 || inputPin.length > 128) return false;
  const hashA = crypto.createHash('sha256').update(inputPin).digest();
  const hashB = crypto.createHash('sha256').update(actualPin).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function getClientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function checkAdminLocked(ip) {
  const rec = failedAdminAttempts.get(ip);
  if (!rec) return false;
  if (Date.now() > rec.resetAt) {
    failedAdminAttempts.delete(ip);
    return false;
  }
  return rec.count >= ADMIN_MAX_FAILS;
}

function recordAdminFailure(ip) {
  const now = Date.now();
  if (failedAdminAttempts.size > 5000) {
    for (const [k, v] of failedAdminAttempts) {
      if (now > v.resetAt) failedAdminAttempts.delete(k);
    }
    if (failedAdminAttempts.size > 5000) failedAdminAttempts.clear();
  }
  const cur = failedAdminAttempts.get(ip);
  if (!cur || now > cur.resetAt) {
    failedAdminAttempts.set(ip, { count: 1, resetAt: now + ADMIN_LOCK_WINDOW_MS });
  } else {
    cur.count += 1;
  }
}

// Authentication middleware for admin mutations
async function verifyAdmin(req, res, next) {
  const ip = getClientIp(req);
  if (checkAdminLocked(ip)) {
    return res.status(429).json({ success: false, error: 'Too many invalid authentication attempts. Try again later.' });
  }
  const rawHeader = req.headers['x-admin-pin'];
  const rawQuery = typeof req.query?.admin_pin === 'string' ? req.query.admin_pin : '';
  const rawBody = typeof req.body?.admin_pin === 'string' ? req.body.admin_pin : '';
  const pin = (typeof rawHeader === 'string' ? rawHeader : '') || rawQuery || rawBody;

  const db = await getDb();
  const currentPin = db.settings.admin_pin || 'admin123';
  if (safeComparePin(pin, currentPin)) {
    failedAdminAttempts.delete(ip);
    return next();
  }
  recordAdminFailure(ip);
  return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Admin PIN' });
}

/* ==================== API ROUTES ==================== */

// Storage / MySQL health check (exposes no credentials or internal hostnames)
app.get('/api/health', async (req, res) => {
  if (!isMysqlEnabled()) {
    return res.json({ ok: true, storage: 'json', connected: true });
  }
  try {
    const pool = await ensureMysqlReady();
    await pool.query('SELECT 1');
    return res.json({ ok: true, storage: 'mysql', connected: true });
  } catch (err) {
    console.error('MySQL health check failed:', err.code || err.message);
    return res.status(503).json({ ok: false, storage: 'mysql', connected: false });
  }
});

// Get complete public site data
app.get('/api/data', async (req, res) => {
  const db = await getDb();
  // Don't expose admin_pin to public
  const safeSettings = { ...db.settings };
  delete safeSettings.admin_pin;
  res.json({
    settings: safeSettings,
    cities: db.cities,
    tours: db.tours.filter(t => t.active !== false),
    products: (db.products || []).filter(p => p.active !== false),
    reviews: (db.reviews || []).filter(r => r.approved === true)
  });
});

// Admin check / login (strictly rate-limited against PIN brute-force)
app.post('/api/admin/login', adminLoginLimiter, async (req, res) => {
  const ip = getClientIp(req);
  if (checkAdminLocked(ip)) {
    return res.status(429).json({ success: false, error: 'Too many failed Admin PIN attempts. Locked for 15 minutes.' });
  }
  const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
  const db = await getDb();
  const currentPin = db.settings.admin_pin || 'admin123';
  if (safeComparePin(pin, currentPin)) {
    failedAdminAttempts.delete(ip);
    res.json({ success: true, message: 'Logged in successfully' });
  } else {
    recordAdminFailure(ip);
    res.status(401).json({ success: false, error: 'Incorrect Admin PIN' });
  }
});

// Admin get all data (including inactive tours and bookings, never leaking admin_pin)
app.get('/api/admin/all', verifyAdmin, async (req, res) => {
  const db = await getDb();
  const safeSettings = { ...(db.settings || {}) };
  delete safeSettings.admin_pin;
  res.json({ ...db, settings: safeSettings });
});

// Get/Update Settings
app.get('/api/settings', async (req, res) => {
  const db = await getDb();
  const safeSettings = { ...db.settings };
  delete safeSettings.admin_pin;
  res.json(safeSettings);
});

app.post('/api/settings', verifyAdmin, async (req, res) => {
  const db = await getDb();
  const { whatsapp_number, site_name, contact_email, phone, currency, currency_code, new_admin_pin, social_facebook, social_instagram, social_telegram } = req.body;

  if (whatsapp_number) db.settings.whatsapp_number = cleanText(whatsapp_number, 30, true).replace(/[^0-9]/g, '');
  if (site_name) db.settings.site_name = cleanText(site_name, 80, true);
  if (contact_email) db.settings.contact_email = cleanText(contact_email, 120, true);
  if (phone) db.settings.phone = cleanText(phone, 40, true);
  if (currency) db.settings.currency = cleanText(currency, 8, true);
  if (currency_code) db.settings.currency_code = cleanText(currency_code, 8, true);
  if (social_facebook !== undefined) db.settings.social_facebook = sanitizeExternalUrl(social_facebook, db.settings.social_facebook || '');
  if (social_instagram !== undefined) db.settings.social_instagram = sanitizeExternalUrl(social_instagram, db.settings.social_instagram || '');
  if (social_telegram !== undefined) db.settings.social_telegram = sanitizeExternalUrl(social_telegram, db.settings.social_telegram || '');
  if (typeof new_admin_pin === 'string' && new_admin_pin.trim().length >= 4 && new_admin_pin.trim().length <= 64) {
    db.settings.admin_pin = new_admin_pin.trim();
  }

  await saveDb(db, ['settings']);
  const safeSettings = { ...db.settings };
  delete safeSettings.admin_pin;
  res.json({ success: true, settings: safeSettings });
});

// Cities CRUD
app.get('/api/cities', async (req, res) => {
  const db = await getDb();
  res.json(db.cities);
});

app.post('/api/cities', verifyAdmin, async (req, res) => {
  const db = await getDb();
  const cityData = sanitizeNestedStrings({ ...req.body }, 1500);
  if (cityData.image) cityData.image = sanitizeImageUrl(cityData.image);
  if (!cityData.id) {
    cityData.id = (cityData.names?.en || 'city')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || ('city-' + Date.now());
  } else {
    cityData.id = String(cityData.id).slice(0, 64);
  }
  cityData.order = Number(cityData.order) || (db.cities.length + 1);
  cityData.featured = cityData.featured !== false;

  const existingIndex = db.cities.findIndex(c => c.id === cityData.id);
  if (existingIndex >= 0) {
    db.cities[existingIndex] = { ...db.cities[existingIndex], ...cityData };
  } else {
    db.cities.push(cityData);
  }
  await saveDb(db, ['cities']);
  res.json({ success: true, city: cityData });
});

app.delete('/api/cities/:id', verifyAdmin, async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  db.cities = db.cities.filter(c => c.id !== id);
  await saveDb(db, ['cities']);
  res.json({ success: true, message: `City ${id} deleted` });
});

// Tours CRUD
app.get('/api/tours', async (req, res) => {
  const db = await getDb();
  const city = typeof req.query.city === 'string' ? req.query.city : '';
  let tours = db.tours;
  if (city) {
    tours = tours.filter(t => t.city_id === city);
  }
  res.json(tours);
});

app.get('/api/tours/:id', async (req, res) => {
  const db = await getDb();
  const tour = db.tours.find(t => String(t.id) === String(req.params.id));
  if (!tour) return res.status(404).json({ error: 'Tour not found' });
  res.json(tour);
});

app.post('/api/tours', verifyAdmin, async (req, res) => {
  const db = await getDb();
  const tourData = sanitizeNestedStrings({ ...req.body }, 3000);
  if (tourData.image) tourData.image = sanitizeImageUrl(tourData.image);
  if (Array.isArray(tourData.gallery)) {
    tourData.gallery = tourData.gallery.map(u => sanitizeImageUrl(u)).filter(Boolean);
  }
  if (tourData.price !== undefined) tourData.price = Math.max(0, Number(tourData.price) || 0);
  if (tourData.price_child !== undefined) tourData.price_child = Math.max(0, Number(tourData.price_child) || 0);

  if (tourData.id) {
    // Update existing tour
    const idx = db.tours.findIndex(t => String(t.id) === String(tourData.id));
    if (idx >= 0) {
      db.tours[idx] = { ...db.tours[idx], ...tourData };
      await saveDb(db, ['tours']);
      return res.json({ success: true, tour: db.tours[idx] });
    }
  }

  // Create new tour
  const nextId = db.tours.length > 0 ? Math.max(...db.tours.map(t => Number(t.id) || 0)) + 1 : 1;
  const newTour = {
    id: nextId,
    active: true,
    rating: 5.0,
    reviews_count: 1,
    ...tourData
  };
  db.tours.unshift(newTour);
  await saveDb(db, ['tours']);
  res.json({ success: true, tour: newTour });
});

// Quick toggle active / featured status or update price
app.patch('/api/tours/:id', verifyAdmin, async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  const idx = db.tours.findIndex(t => String(t.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Tour not found' });

  const { active, featured, price, price_child } = req.body;
  if (active !== undefined) db.tours[idx].active = Boolean(active);
  if (featured !== undefined) db.tours[idx].featured = Boolean(featured);
  if (price !== undefined) db.tours[idx].price = Math.max(0, Number(price) || 0);
  if (price_child !== undefined) db.tours[idx].price_child = Math.max(0, Number(price_child) || 0);

  await saveDb(db, ['tours']);
  res.json({ success: true, tour: db.tours[idx] });
});

app.delete('/api/tours/:id', verifyAdmin, async (req, res) => {
  const db = await getDb();
  const id = req.params.id;
  db.tours = db.tours.filter(t => String(t.id) !== String(id));
  await saveDb(db, ['tours']);
  res.json({ success: true, message: `Tour ${id} deleted` });
});

// ==================== BAZAR PRODUCTS CRUD ====================
app.get('/api/products', async (req, res) => {
  const db = await getDb();
  const category = typeof req.query.category === 'string' ? req.query.category : '';
  let products = db.products || [];
  if (category && category !== 'all') {
    products = products.filter(p => p.category === category);
  }
  res.json(products);
});

app.get('/api/products/:id', async (req, res) => {
  const db = await getDb();
  const product = (db.products || []).find(p => String(p.id) === String(req.params.id));
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

app.post('/api/products', verifyAdmin, async (req, res) => {
  const db = await getDb();
  if (!db.products) db.products = [];
  const productData = sanitizeNestedStrings({ ...req.body }, 2000);
  if (productData.image) productData.image = sanitizeImageUrl(productData.image, '/uploads/bazar_papyrus.jpg');

  if (productData.id) {
    const idx = db.products.findIndex(p => String(p.id) === String(productData.id));
    if (idx >= 0) {
      db.products[idx] = {
        ...db.products[idx],
        ...productData,
        price: productData.price !== undefined ? Math.max(0, Number(productData.price) || 0) : db.products[idx].price
      };
      await saveDb(db, ['products']);
      return res.json({ success: true, product: db.products[idx] });
    }
  }

  const nextId = db.products.length > 0 ? Math.max(...db.products.map(p => Number(p.id) || 0)) + 1 : 1;
  const newProduct = {
    id: nextId,
    active: true,
    featured: false,
    ...productData,
    price: Math.max(0, Number(productData.price) || 0)
  };
  db.products.unshift(newProduct);
  await saveDb(db, ['products']);
  res.json({ success: true, product: newProduct });
});

app.patch('/api/products/:id', verifyAdmin, async (req, res) => {
  const db = await getDb();
  if (!db.products) db.products = [];
  const idx = db.products.findIndex(p => String(p.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Product not found' });

  const { active, featured, price, image, specs, category, names, descriptions } = req.body;
  if (active !== undefined) db.products[idx].active = Boolean(active);
  if (featured !== undefined) db.products[idx].featured = Boolean(featured);
  if (price !== undefined) db.products[idx].price = Math.max(0, Number(price) || 0);
  if (image !== undefined) db.products[idx].image = sanitizeImageUrl(image, db.products[idx].image);
  if (specs !== undefined) db.products[idx].specs = sanitizeNestedStrings(specs, 500);
  if (category !== undefined) db.products[idx].category = cleanText(category, 40, true);
  if (names !== undefined) db.products[idx].names = sanitizeNestedStrings(names, 200);
  if (descriptions !== undefined) db.products[idx].descriptions = sanitizeNestedStrings(descriptions, 2000);

  await saveDb(db, ['products']);
  res.json({ success: true, product: db.products[idx] });
});

app.delete('/api/products/:id', verifyAdmin, async (req, res) => {
  const db = await getDb();
  if (!db.products) db.products = [];
  const id = req.params.id;
  db.products = db.products.filter(p => String(p.id) !== String(id));
  await saveDb(db, ['products']);
  res.json({ success: true, message: `Product ${id} deleted` });
});

// Handle Image Upload (with magic-byte inspection & anti-malware payload scan)
app.post('/api/upload', uploadLimiter, verifyAdmin, upload.single('image'), (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ success: false, error: 'No image uploaded' });
  }

  const originalExt = path.extname(req.file.originalname || '').toLowerCase();
  const scan = detectAndScanImageBuffer(req.file.buffer, originalExt);
  if (!scan.valid) {
    return res.status(400).json({ success: false, error: scan.reason });
  }

  const safeFilename = 'tour_' + Date.now() + '_' + crypto.randomBytes(6).toString('hex') + scan.ext;
  const destPath = path.join(UPLOADS_DIR, safeFilename);
  try {
    fs.writeFileSync(destPath, req.file.buffer);
  } catch (writeErr) {
    return res.status(500).json({ success: false, error: 'Storage is read-only or unavailable.' });
  }

  const fileUrl = `/uploads/${safeFilename}`;
  res.json({ success: true, url: fileUrl, filename: safeFilename });
});

// Handle Booking log from client (rate-limited + HTML-stripped against spam/DoS)
app.post('/api/book', publicWriteLimiter, async (req, res) => {
  const { tour_id, tour_name, city, date, adults, children, client_name, hotel, notes, lang } = req.body;
  const db = await getDb();

  const booking = {
    id: 'BK-' + Date.now().toString(36).toUpperCase(),
    tour_id: typeof tour_id === 'number' || typeof tour_id === 'string' ? cleanText(String(tour_id), 40, true) : '',
    tour_name: cleanText(tour_name, 150, true) || 'Excursion',
    city: cleanText(city, 60, true),
    date: cleanText(date, 30, true),
    adults: Math.max(1, Math.min(50, Number(adults) || 1)),
    children: Math.max(0, Math.min(50, Number(children) || 0)),
    client_name: cleanText(client_name, 80, true) || 'Guest',
    hotel: cleanText(hotel, 120, true) || 'Not specified',
    notes: cleanText(notes, 500, true),
    lang: cleanText(lang, 10, true) || 'en',
    created_at: new Date().toISOString()
  };

  if (!db.bookings) db.bookings = [];
  db.bookings.unshift(booking);
  if (db.bookings.length > 2000) db.bookings.length = 2000;
  await saveDb(db, ['bookings']);

  res.json({ success: true, booking });
});

// Admin get bookings
app.get('/api/bookings', verifyAdmin, async (req, res) => {
  const db = await getDb();
  res.json(db.bookings || []);
});

// Reviews API - Public (Only approved reviews)
app.get('/api/reviews', async (req, res) => {
  const db = await getDb();
  const approved = (db.reviews || []).filter(r => r.approved === true);
  res.json(approved);
});

// Client submit review -> Defaults to Pending Approval (rate-limited + sanitized)
app.post('/api/reviews', publicWriteLimiter, async (req, res) => {
  const { name, rating, comment, tour, country } = req.body;
  const cleanName = cleanText(name, 80, true);
  const cleanComment = cleanText(comment, 1000, true);
  if (!cleanName) {
    return res.status(400).json({ success: false, error: 'Name is required' });
  }
  if (!cleanComment || cleanComment.length < 2) {
    return res.status(400).json({ success: false, error: 'Review comment is required' });
  }

  const numRating = Math.max(1, Math.min(5, parseInt(rating, 10) || 5));
  const db = await getDb();
  if (!db.reviews) db.reviews = [];

  const newReview = {
    id: Date.now(),
    name: cleanName,
    country: cleanText(country, 60, true) || 'Verified Traveler',
    tour: cleanText(tour, 120, true) || 'Egypt Excursion',
    rating: numRating,
    comment: cleanComment,
    date: new Date().toISOString().split('T')[0],
    approved: false,
    status: 'pending'
  };

  db.reviews.unshift(newReview);
  if (db.reviews.length > 1000) db.reviews.length = 1000;
  await saveDb(db, ['reviews']);

  res.json({
    success: true,
    pending: true,
    message: 'Thank you! Your review has been submitted and is awaiting approval.',
    review: newReview
  });
});

// Admin Review Moderation - Approve / Reject Review
app.patch('/api/admin/reviews/:id/status', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { status, approved } = req.body;
  const db = await getDb();
  if (!db.reviews) db.reviews = [];

  const review = db.reviews.find(r => String(r.id) === String(id));
  if (!review) {
    return res.status(404).json({ success: false, error: 'Review not found' });
  }

  if (typeof approved === 'boolean') {
    review.approved = approved;
    review.status = approved ? 'approved' : 'rejected';
  } else if (status) {
    review.status = status;
    review.approved = (status === 'approved');
  }

  await saveDb(db, ['reviews']);
  res.json({ success: true, review });
});

// Admin Delete Review
app.delete('/api/admin/reviews/:id', verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const db = await getDb();
  if (!db.reviews) db.reviews = [];

  const initialCount = db.reviews.length;
  db.reviews = db.reviews.filter(r => String(r.id) !== String(id));

  if (db.reviews.length === initialCount) {
    return res.status(404).json({ success: false, error: 'Review not found' });
  }

  await saveDb(db, ['reviews']);
  res.json({ success: true, message: 'Review deleted successfully' });
});

// Reject API calls to unknown endpoints cleanly instead of returning HTML
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'API endpoint not found' });
});

// SPA / direct route fallback (Express 5 compatible)
app.use((req, res) => {
  if (req.path.startsWith('/admin')) {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  } else if (req.path === '/bazar' || req.path.startsWith('/bazar/')) {
    res.sendFile(path.join(__dirname, 'public', 'bazar.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Safe global error handler (never leak internal stack traces, DB credentials, or server paths)
const DB_ERROR_CODES = new Set([
  'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNRESET',
  'PROTOCOL_CONNECTION_LOST', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR',
  'ER_DBACCESS_DENIED_ERROR', 'ER_NO_SUCH_TABLE'
]);

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'Request payload too large.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Malformed JSON body.' });
  }
  if (err && err.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'Image exceeds 5MB maximum limit.'
      : 'Invalid file upload request.';
    return res.status(400).json({ success: false, error: msg });
  }
  if (err && (err.sqlState || err.fatal || DB_ERROR_CODES.has(err.code))) {
    console.error('Database error:', err.code || err.message);
    return res.status(503).json({ success: false, error: 'Database service unavailable.' });
  }
  if (err) {
    const status = err.status || err.statusCode || (err.message && err.message.startsWith('Only safe raster images') ? 400 : 500);
    if (status >= 500) {
      console.error('Server request error:', err.message);
      return res.status(500).json({ success: false, error: 'Internal server error.' });
    }
    return res.status(status).json({ success: false, error: err.message || 'Bad request.' });
  }
  next();
});

// Start Server with DoS timeout protection and local 3001 alias
function applyHttpHardening(httpServer) {
  httpServer.requestTimeout = 15000;
  httpServer.headersTimeout = 10000;
  httpServer.keepAliveTimeout = 5000;
  httpServer.maxHeadersCount = 100;
  httpServer.setTimeout(20000);
}

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Tour Booking Platform is LIVE on http://localhost:${port}`);
    console.log(`🔑 Admin Panel available at: http://localhost:${port}/admin.html`);
    console.log(`💾 Storage: ${isMysqlEnabled() ? 'Hostinger MySQL (auto-initialized on first request)' : 'Local JSON (data/database.json)'}`);
    console.log(`🛡️  Security Hardened: Helmet CSP, Rate Limiting, Upload Malware Scan`);
    console.log(`======================================================\n`);
  });
  applyHttpHardening(server);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });

  // Also bind to 3001 locally if primary port is default 3000 so both links work
  if (port === 3000 && !process.env.PORT) {
    const backupServer = app.listen(3001, () => {
      console.log(`🚀 Also listening on alias: http://localhost:3001`);
    });
    applyHttpHardening(backupServer);
    backupServer.on('error', () => {
      // Ignore if 3001 is already taken
    });
  }
}

startServer(PORT);

module.exports = app;
