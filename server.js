const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'database.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

// Ensure uploads dir exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer Storage for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = 'tour_' + Date.now() + '_' + Math.round(Math.random() * 1e6) + ext;
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp|gif|svg/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only image files (jpg, png, webp, svg) are allowed!'));
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// Helper: read and write database
function getDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading database:', err);
    return { settings: {}, cities: [], tours: [], bookings: [] };
  }
}

function saveDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Error saving database:', err);
    return false;
  }
}

// Authentication middleware for admin mutations
function verifyAdmin(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.query.admin_pin || req.body.admin_pin;
  const db = getDb();
  const currentPin = db.settings.admin_pin || 'admin123';
  if (pin && pin === currentPin) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized: Invalid Admin PIN' });
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
    tours: db.tours.filter(t => t.active !== false)
  });
});

// Admin check / login
app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body;
  const db = getDb();
  const currentPin = db.settings.admin_pin || 'admin123';
  if (pin === currentPin) {
    res.json({ success: true, message: 'Logged in successfully' });
  } else {
    res.status(401).json({ success: false, error: 'Incorrect Admin PIN' });
  }
});

// Admin get all data (including inactive tours and bookings)
app.get('/api/admin/all', verifyAdmin, (req, res) => {
  const db = getDb();
  res.json(db);
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

  if (whatsapp_number) db.settings.whatsapp_number = whatsapp_number.replace(/[^0-9]/g, '');
  if (site_name) db.settings.site_name = site_name;
  if (contact_email) db.settings.contact_email = contact_email;
  if (phone) db.settings.phone = phone;
  if (currency) db.settings.currency = currency;
  if (currency_code) db.settings.currency_code = currency_code;
  if (social_facebook !== undefined) db.settings.social_facebook = social_facebook;
  if (social_instagram !== undefined) db.settings.social_instagram = social_instagram;
  if (social_telegram !== undefined) db.settings.social_telegram = social_telegram;
  if (new_admin_pin && new_admin_pin.trim().length >= 4) {
    db.settings.admin_pin = new_admin_pin.trim();
  }

  saveDb(db);
  res.json({ success: true, settings: db.settings });
});

// Cities CRUD
app.get('/api/cities', (req, res) => {
  const db = getDb();
  res.json(db.cities);
});

app.post('/api/cities', verifyAdmin, (req, res) => {
  const db = getDb();
  const cityData = req.body;
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
  const { city } = req.query;
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
  const tourData = req.body;

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
  if (price !== undefined) db.tours[idx].price = Number(price);
  if (price_child !== undefined) db.tours[idx].price_child = Number(price_child);

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

// Handle Image Upload
app.post('/api/upload', verifyAdmin, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, url: fileUrl, filename: req.file.filename });
});

// Handle Booking log from client
app.post('/api/book', (req, res) => {
  const { tour_id, tour_name, city, date, adults, children, client_name, hotel, notes, lang } = req.body;
  const db = getDb();

  const booking = {
    id: 'BK-' + Date.now().toString(36).toUpperCase(),
    tour_id,
    tour_name,
    city,
    date,
    adults: Number(adults) || 1,
    children: Number(children) || 0,
    client_name: client_name || 'Guest',
    hotel: hotel || 'Not specified',
    notes: notes || '',
    lang: lang || 'en',
    created_at: new Date().toISOString()
  };

  if (!db.bookings) db.bookings = [];
  db.bookings.unshift(booking);
  saveDb(db);

  res.json({ success: true, booking });
});

// Admin get bookings
app.get('/api/bookings', verifyAdmin, (req, res) => {
  const db = getDb();
  res.json(db.bookings || []);
});

// SPA / direct route fallback (Express 5 compatible)
app.use((req, res) => {
  if (req.path.startsWith('/admin')) {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Start Server with fallback port
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Tour Booking Platform is LIVE on http://localhost:${port}`);
    console.log(`🔑 Admin Panel available at: http://localhost:${port}/admin.html`);
    console.log(`🔑 Default Admin PIN: admin123`);
    console.log(`======================================================\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(PORT);
