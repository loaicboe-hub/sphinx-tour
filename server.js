const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');

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

// Helper: read and write database
function getDb() {
  try {
    const hasTmp = fs.existsSync(TMP_DB_FILE);
    const hasDb = fs.existsSync(DB_FILE);
    const useTmp = hasTmp && (!hasDb || fs.statSync(TMP_DB_FILE).mtimeMs > fs.statSync(DB_FILE).mtimeMs);
    const raw = fs.readFileSync(useTmp ? TMP_DB_FILE : DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.products) parsed.products = [];
    return parsed;
  } catch (err) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed.products) parsed.products = [];
      return parsed;
    } catch (e) {
      console.error('Error reading database:', err);
      return { settings: {}, cities: [], tours: [], products: [], bookings: [], reviews: [] };
    }
  }
}

function saveDb(data) {
  let saved = false;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    saved = true;
  } catch (err) {
    // Read-only filesystem (e.g. Vercel serverless / AWS Lambda)
  }

  try {
    fs.writeFileSync(TMP_DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    saved = true;
  } catch (tmpErr) {
    console.error('Error writing to tmp:', tmpErr);
  }

  return saved;
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
function verifyAdmin(req, res, next) {
  const ip = getClientIp(req);
  if (checkAdminLocked(ip)) {
    return res.status(429).json({ success: false, error: 'Too many invalid authentication attempts. Try again later.' });
  }
  const rawHeader = req.headers['x-admin-pin'];
  const rawQuery = typeof req.query?.admin_pin === 'string' ? req.query.admin_pin : '';
  const rawBody = typeof req.body?.admin_pin === 'string' ? req.body.admin_pin : '';
  const pin = (typeof rawHeader === 'string' ? rawHeader : '') || rawQuery || rawBody;

  const db = getDb();
  const currentPin = db.settings.admin_pin || 'admin123';
  if (safeComparePin(pin, currentPin)) {
    failedAdminAttempts.delete(ip);
    return next();
  }
  recordAdminFailure(ip);
  return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Admin PIN' });
}

/* ==================== API ROUTES ==================== */

// Get complete public site data
app.get('/api/data', (req, res) => {
  const db = getDb();
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
app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  const ip = getClientIp(req);
  if (checkAdminLocked(ip)) {
    return res.status(429).json({ success: false, error: 'Too many failed Admin PIN attempts. Locked for 15 minutes.' });
  }
  const pin = typeof req.body?.pin === 'string' ? req.body.pin : '';
  const db = getDb();
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
app.get('/api/admin/all', verifyAdmin, (req, res) => {
  const db = getDb();
  const safeSettings = { ...(db.settings || {}) };
  delete safeSettings.admin_pin;
  res.json({ ...db, settings: safeSettings });
});

// Get/Update Settings
app.get('/api/settings', (req, res) => {
  const db = getDb();
  const safeSettings = { ...db.settings };
  delete safeSettings.admin_pin;
  res.json(safeSettings);
});

app.post('/api/settings', verifyAdmin, (req, res) => {
  const db = getDb();
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

  saveDb(db);
  const safeSettings = { ...db.settings };
  delete safeSettings.admin_pin;
  res.json({ success: true, settings: safeSettings });
});

// Cities CRUD
app.get('/api/cities', (req, res) => {
  const db = getDb();
  res.json(db.cities);
});

app.post('/api/cities', verifyAdmin, (req, res) => {
  const db = getDb();
  const cityData = sanitizeNestedStrings({ ...req.body }, 1500);
  if (cityData.image) cityData.image = sanitizeImageUrl(cityData.image);
  if (!cityData.id) {
    cityData.id = (cityData.names?.en || 'city')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-');
  }

  const existingIndex = db.cities.findIndex(c => c.id === cityData.id);
  if (existingIndex >= 0) {
    db.cities[existingIndex] = { ...db.cities[existingIndex], ...cityData };
  } else {
    db.cities.push(cityData);
  }
  saveDb(db);
  res.json({ success: true, city: cityData });
});

app.delete('/api/cities/:id', verifyAdmin, (req, res) => {
  const db = getDb();
  const id = req.params.id;
  db.cities = db.cities.filter(c => c.id !== id);
  saveDb(db);
  res.json({ success: true, message: `City ${id} deleted` });
});

// Tours CRUD
app.get('/api/tours', (req, res) => {
  const db = getDb();
  const city = typeof req.query.city === 'string' ? req.query.city : '';
  let tours = db.tours;
  if (city) {
    tours = tours.filter(t => t.city_id === city);
  }
  res.json(tours);
});

app.get('/api/tours/:id', (req, res) => {
  const db = getDb();
  const tour = db.tours.find(t => String(t.id) === String(req.params.id));
  if (!tour) return res.status(404).json({ error: 'Tour not found' });
  res.json(tour);
});

app.post('/api/tours', verifyAdmin, (req, res) => {
  const db = getDb();
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
      saveDb(db);
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
  saveDb(db);
  res.json({ success: true, tour: newTour });
});

// Quick toggle active / featured status or update price
app.patch('/api/tours/:id', verifyAdmin, (req, res) => {
  const db = getDb();
  const id = req.params.id;
  const idx = db.tours.findIndex(t => String(t.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'Tour not found' });

  const { active, featured, price, price_child } = req.body;
  if (active !== undefined) db.tours[idx].active = Boolean(active);
  if (featured !== undefined) db.tours[idx].featured = Boolean(featured);
  if (price !== undefined) db.tours[idx].price = Math.max(0, Number(price) || 0);
  if (price_child !== undefined) db.tours[idx].price_child = Math.max(0, Number(price_child) || 0);

  saveDb(db);
  res.json({ success: true, tour: db.tours[idx] });
});

app.delete('/api/tours/:id', verifyAdmin, (req, res) => {
  const db = getDb();
  const id = req.params.id;
  db.tours = db.tours.filter(t => String(t.id) !== String(id));
  saveDb(db);
  res.json({ success: true, message: `Tour ${id} deleted` });
});

// ==================== BAZAR PRODUCTS CRUD ====================
app.get('/api/products', (req, res) => {
  const db = getDb();
  const category = typeof req.query.category === 'string' ? req.query.category : '';
  let products = db.products || [];
  if (category && category !== 'all') {
    products = products.filter(p => p.category === category);
  }
  res.json(products);
});

app.get('/api/products/:id', (req, res) => {
  const db = getDb();
  const product = (db.products || []).find(p => String(p.id) === String(req.params.id));
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

app.post('/api/products', verifyAdmin, (req, res) => {
  const db = getDb();
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
      saveDb(db);
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
  saveDb(db);
  res.json({ success: true, product: newProduct });
});

app.patch('/api/products/:id', verifyAdmin, (req, res) => {
  const db = getDb();
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

  saveDb(db);
  res.json({ success: true, product: db.products[idx] });
});

app.delete('/api/products/:id', verifyAdmin, (req, res) => {
  const db = getDb();
  if (!db.products) db.products = [];
  const id = req.params.id;
  db.products = db.products.filter(p => String(p.id) !== String(id));
  saveDb(db);
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
app.post('/api/book', publicWriteLimiter, (req, res) => {
  const { tour_id, tour_name, city, date, adults, children, client_name, hotel, notes, lang } = req.body;
  const db = getDb();

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
  saveDb(db);

  res.json({ success: true, booking });
});

// Admin get bookings
app.get('/api/bookings', verifyAdmin, (req, res) => {
  const db = getDb();
  res.json(db.bookings || []);
});

// Reviews API - Public (Only approved reviews)
app.get('/api/reviews', (req, res) => {
  const db = getDb();
  const approved = (db.reviews || []).filter(r => r.approved === true);
  res.json(approved);
});

// Client submit review -> Defaults to Pending Approval (rate-limited + sanitized)
app.post('/api/reviews', publicWriteLimiter, (req, res) => {
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
  const db = getDb();
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
  saveDb(db);

  res.json({
    success: true,
    pending: true,
    message: 'Thank you! Your review has been submitted and is awaiting approval.',
    review: newReview
  });
});

// Admin Review Moderation - Approve / Reject Review
app.patch('/api/admin/reviews/:id/status', verifyAdmin, (req, res) => {
  const { id } = req.params;
  const { status, approved } = req.body;
  const db = getDb();
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

  saveDb(db);
  res.json({ success: true, review });
});

// Admin Delete Review
app.delete('/api/admin/reviews/:id', verifyAdmin, (req, res) => {
  const { id } = req.params;
  const db = getDb();
  if (!db.reviews) db.reviews = [];

  const initialCount = db.reviews.length;
  db.reviews = db.reviews.filter(r => String(r.id) !== String(id));

  if (db.reviews.length === initialCount) {
    return res.status(404).json({ success: false, error: 'Review not found' });
  }

  saveDb(db);
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

// Safe global error handler (never leak internal stack traces or server paths)
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
  if (err) {
    return res.status(400).json({ success: false, error: err.message || 'Bad request.' });
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
