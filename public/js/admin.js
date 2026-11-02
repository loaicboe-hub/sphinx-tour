/* ============================================================
   EGYPT VOYAGE - ADMIN DASHBOARD SCRIPT
   ============================================================ */

let adminData = {
  settings: {},
  cities: [],
  tours: [],
  bookings: []
};

let currentAdminPin = localStorage.getItem('egypt_voyage_admin_pin') || '';

document.addEventListener('DOMContentLoaded', () => {
  if (currentAdminPin) {
    verifySession();
  } else {
    showLogin();
  }
  setupAdminListeners();
});

function showLogin() {
  document.getElementById('loginWrapper').style.display = 'flex';
  document.getElementById('adminLayout').style.display = 'none';
}

function showDashboard() {
  document.getElementById('loginWrapper').style.display = 'none';
  document.getElementById('adminLayout').style.display = 'flex';
  loadAdminData();
}

// Verify stored PIN
async function verifySession() {
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: currentAdminPin })
    });
    if (res.ok) {
      showDashboard();
    } else {
      localStorage.removeItem('egypt_voyage_admin_pin');
      showLogin();
    }
  } catch (err) {
    showLogin();
  }
}

// Setup Event Listeners
function setupAdminListeners() {
  // Login Form
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = document.getElementById('pinInput').value.trim();
      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          currentAdminPin = pin;
          localStorage.setItem('egypt_voyage_admin_pin', pin);
          showDashboard();
        } else {
          alert('❌ ' + (data.error || 'Invalid Admin PIN'));
        }
      } catch (err) {
        alert('Server connection error');
      }
    });
  }

  // Sidebar navigation
  document.querySelectorAll('.sidebar-link[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      switchTab(tab);
    });
  });

  // Tour Form Submit
  const tourForm = document.getElementById('tourEditForm');
  if (tourForm) {
    tourForm.addEventListener('submit', handleSaveTour);
  }

  // Image Upload handler
  const imageFileInput = document.getElementById('tourImageFile');
  if (imageFileInput) {
    imageFileInput.addEventListener('change', uploadTourImage);
  }

  // Settings Form Submit
  const settingsForm = document.getElementById('settingsForm');
  if (settingsForm) {
    settingsForm.addEventListener('submit', handleSaveSettings);
  }
}

function logout() {
  localStorage.removeItem('egypt_voyage_admin_pin');
  currentAdminPin = '';
  showLogin();
}

function switchTab(tabId) {
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.remove('active'));

  const activeLink = document.querySelector(`.sidebar-link[data-tab="${tabId}"]`);
  const activePane = document.getElementById(`tab-${tabId}`);

  if (activeLink) activeLink.classList.add('active');
  if (activePane) activePane.classList.add('active');
}

// Load all admin data
async function loadAdminData() {
  try {
    const res = await fetch('/api/admin/all', {
      headers: { 'x-admin-pin': currentAdminPin }
    });
    if (!res.ok) {
      logout();
      return;
    }
    const data = await res.json();
    adminData = data;

    renderStats();
    renderToursTable();
    renderCitiesTable();
    renderBookingsTable();
    populateSettingsForm();
    populateCityDropdown();
  } catch (err) {
    console.error('Error fetching admin data:', err);
  }
}

// Render Top Stats
function renderStats() {
  document.getElementById('statTotalTours').textContent = adminData.tours.length;
  document.getElementById('statActiveTours').textContent = adminData.tours.filter(t => t.active !== false).length;
  document.getElementById('statTotalCities').textContent = adminData.cities.length;
  document.getElementById('statTotalBookings').textContent = (adminData.bookings || []).length;
}

// Render Tours Table
function renderToursTable() {
  const tbody = document.getElementById('toursTableBody');
  if (!tbody) return;

  const curr = adminData.settings?.currency || '€';
  tbody.innerHTML = '';

  adminData.tours.forEach(tour => {
    const tr = document.createElement('tr');
    const city = adminData.cities.find(c => c.id === tour.city_id);
    const cityName = city?.names?.en || tour.city_id;

    tr.innerHTML = `
      <td>
        <img src="${tour.image}" class="table-thumb" alt="Thumbnail" />
      </td>
      <td>
        <div style="font-weight: 700; color: #FFF;">${tour.names?.en || 'Unnamed'}</div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">${tour.names?.ru ? '🇷🇺 ' + tour.names.ru : ''}</div>
      </td>
      <td>
        <span style="color: var(--admin-accent); font-weight: 600;">📍 ${cityName}</span>
      </td>
      <td>
        <div style="display: flex; align-items: center; gap: 4px;">
          <span>${curr}</span>
          <input type="number" class="quick-price-input" value="${tour.price}" onchange="quickUpdatePrice(${tour.id}, this.value)" title="Change price and click outside to save" />
        </div>
      </td>
      <td>
        <button class="badge-status ${tour.active !== false ? 'badge-active' : 'badge-inactive'}" onclick="toggleTourActive(${tour.id}, ${tour.active !== false})" style="border: none; cursor: pointer;">
          ${tour.active !== false ? 'Active' : 'Hidden'}
        </button>
      </td>
      <td>
        <button class="badge-status ${tour.featured ? 'badge-featured' : 'badge-inactive'}" onclick="toggleTourFeatured(${tour.id}, ${Boolean(tour.featured)})" style="border: none; cursor: pointer;">
          ${tour.featured ? '★ Featured' : 'Normal'}
        </button>
      </td>
      <td>
        <div class="table-actions">
          <button class="btn-icon" onclick="openEditTourModal(${tour.id})" title="Edit All Details">✏️</button>
          <button class="btn-icon delete" onclick="deleteTour(${tour.id})" title="Delete Tour">🗑️</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Quick Price Update on Change
async function quickUpdatePrice(tourId, newPrice) {
  try {
    const res = await fetch(`/api/tours/${tourId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pin': currentAdminPin
      },
      body: JSON.stringify({ price: Number(newPrice) })
    });
    if (res.ok) {
      loadAdminData();
    }
  } catch (e) {
    alert('Failed to update price');
  }
}

// Toggle Tour Active
async function toggleTourActive(tourId, currentActive) {
  try {
    await fetch(`/api/tours/${tourId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pin': currentAdminPin
      },
      body: JSON.stringify({ active: !currentActive })
    });
    loadAdminData();
  } catch (e) {
    alert('Error toggling status');
  }
}

// Toggle Tour Featured
async function toggleTourFeatured(tourId, currentFeatured) {
  try {
    await fetch(`/api/tours/${tourId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pin': currentAdminPin
      },
      body: JSON.stringify({ featured: !currentFeatured })
    });
    loadAdminData();
  } catch (e) {
    alert('Error toggling featured');
  }
}

// Delete Tour
async function deleteTour(tourId) {
  if (!confirm('Are you sure you want to delete this excursion?')) return;

  try {
    const res = await fetch(`/api/tours/${tourId}`, {
      method: 'DELETE',
      headers: { 'x-admin-pin': currentAdminPin }
    });
    if (res.ok) {
      loadAdminData();
    }
  } catch (e) {
    alert('Error deleting tour');
  }
}

// Open Tour Modal for Add / Edit
function openAddTourModal() {
  document.getElementById('tourFormModalTitle').textContent = 'Add New Excursion';
  document.getElementById('tourEditForm').reset();
  document.getElementById('tourEditId').value = '';
  document.getElementById('tourImagePreview').style.display = 'none';
  document.getElementById('tourModalOverlay').classList.add('active');
}

function openEditTourModal(tourId) {
  const tour = adminData.tours.find(t => t.id === tourId);
  if (!tour) return;

  document.getElementById('tourFormModalTitle').textContent = 'Edit Excursion #' + tour.id;
  document.getElementById('tourEditId').value = tour.id;
  document.getElementById('tourCitySelect').value = tour.city_id;
  document.getElementById('tourCategorySelect').value = tour.category || 'island';
  document.getElementById('tourDurationInput').value = tour.duration || '';
  document.getElementById('tourPriceInput').value = tour.price || 0;
  document.getElementById('tourChildPriceInput').value = tour.price_child || '';
  document.getElementById('tourImageUrlInput').value = tour.image || '';

  // Show preview
  const prev = document.getElementById('tourImagePreview');
  if (tour.image) {
    prev.src = tour.image;
    prev.style.display = 'block';
  } else {
    prev.style.display = 'none';
  }

  // Multilingual Names
  document.getElementById('tourNameEn').value = tour.names?.en || '';
  document.getElementById('tourNameRu').value = tour.names?.ru || '';
  document.getElementById('tourNameFr').value = tour.names?.fr || '';
  document.getElementById('tourNamePl').value = tour.names?.pl || '';

  // Multilingual Descriptions
  document.getElementById('tourDescEn').value = tour.descriptions?.en || '';
  document.getElementById('tourDescRu').value = tour.descriptions?.ru || '';
  document.getElementById('tourDescFr').value = tour.descriptions?.fr || '';
  document.getElementById('tourDescPl').value = tour.descriptions?.pl || '';

  // Inclusions
  document.getElementById('tourIncEn').value = (tour.included?.en || []).join('\n');
  document.getElementById('tourIncRu').value = (tour.included?.ru || []).join('\n');

  document.getElementById('tourModalOverlay').classList.add('active');
}

function closeTourModal() {
  document.getElementById('tourModalOverlay').classList.remove('active');
}

// Upload Tour Image
async function uploadTourImage(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('image', file);

  const statusText = document.getElementById('uploadStatusText');
  statusText.textContent = 'Uploading...';

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'x-admin-pin': currentAdminPin },
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.success) {
      document.getElementById('tourImageUrlInput').value = data.url;
      const prev = document.getElementById('tourImagePreview');
      prev.src = data.url;
      prev.style.display = 'block';
      statusText.textContent = '✓ Uploaded successfully!';
    } else {
      statusText.textContent = '❌ Upload failed';
    }
  } catch (err) {
    statusText.textContent = '❌ Network error';
  }
}

// Save Tour (Create or Update)
async function handleSaveTour(e) {
  e.preventDefault();

  const id = document.getElementById('tourEditId').value;
  const city_id = document.getElementById('tourCitySelect').value;
  const category = document.getElementById('tourCategorySelect').value;
  const duration = document.getElementById('tourDurationInput').value.trim();
  const price = Number(document.getElementById('tourPriceInput').value);
  const price_child = Number(document.getElementById('tourChildPriceInput').value) || Math.round(price * 0.6);
  const image = document.getElementById('tourImageUrlInput').value.trim();

  // Names (fallback to EN if others are empty)
  const nameEn = document.getElementById('tourNameEn').value.trim();
  const names = {
    en: nameEn,
    ru: document.getElementById('tourNameRu').value.trim() || nameEn,
    fr: document.getElementById('tourNameFr').value.trim() || nameEn,
    pl: document.getElementById('tourNamePl').value.trim() || nameEn
  };

  // Descriptions
  const descEn = document.getElementById('tourDescEn').value.trim();
  const descriptions = {
    en: descEn,
    ru: document.getElementById('tourDescRu').value.trim() || descEn,
    fr: document.getElementById('tourDescFr').value.trim() || descEn,
    pl: document.getElementById('tourDescPl').value.trim() || descEn
  };

  // Short descriptions generated from first sentence
  const short_descriptions = {
    en: descEn.split('.')[0] + '.',
    ru: (descriptions.ru.split('.')[0] || descEn) + '.',
    fr: (descriptions.fr.split('.')[0] || descEn) + '.',
    pl: (descriptions.pl.split('.')[0] || descEn) + '.'
  };

  // Included items from textarea lines
  const incEnRaw = document.getElementById('tourIncEn').value.split('\n').map(s => s.trim()).filter(Boolean);
  const incRuRaw = document.getElementById('tourIncRu').value.split('\n').map(s => s.trim()).filter(Boolean);
  const included = {
    en: incEnRaw.length > 0 ? incEnRaw : ['Hotel pickup & drop-off', 'Professional guide'],
    ru: incRuRaw.length > 0 ? incRuRaw : incEnRaw,
    fr: incEnRaw,
    pl: incEnRaw
  };

  const payload = {
    city_id,
    category,
    duration,
    price,
    price_child,
    image: image || 'https://images.unsplash.com/photo-1544885935-98dd03b09034?auto=format&fit=crop&w=900&q=80',
    names,
    descriptions,
    short_descriptions,
    included
  };

  if (id) payload.id = Number(id);

  try {
    const res = await fetch('/api/tours', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pin': currentAdminPin
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      closeTourModal();
      loadAdminData();
    } else {
      alert('Failed to save tour');
    }
  } catch (err) {
    alert('Server error saving tour');
  }
}

// Populate Cities Dropdown in Tour Form
function populateCityDropdown() {
  const sel = document.getElementById('tourCitySelect');
  if (!sel) return;
  sel.innerHTML = '';
  adminData.cities.forEach(city => {
    const opt = document.createElement('option');
    opt.value = city.id;
    opt.textContent = `${city.names?.en || city.id} (${city.names?.ru || ''})`;
    sel.appendChild(opt);
  });
}

// Render Cities Table
function renderCitiesTable() {
  const tbody = document.getElementById('citiesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  adminData.cities.forEach(city => {
    const count = adminData.tours.filter(t => t.city_id === city.id).length;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><img src="${city.image}" class="table-thumb" alt="${city.id}" /></td>
      <td><strong>${city.names?.en || city.id}</strong></td>
      <td>${city.names?.ru || '—'}</td>
      <td>${city.names?.fr || '—'}</td>
      <td>${city.names?.pl || '—'}</td>
      <td><span class="badge-status badge-active">${count} Excursions</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Render Bookings Table
function renderBookingsTable() {
  const tbody = document.getElementById('bookingsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const list = adminData.bookings || [];
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">No bookings recorded yet. Leads generated via WhatsApp will appear here!</td></tr>`;
    return;
  }

  list.forEach(b => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${b.id}</strong></td>
      <td>${b.tour_name} <br><small style="color: var(--admin-accent);">📍 ${b.city}</small></td>
      <td>${b.date}</td>
      <td>${b.adults} Adults, ${b.children} Kids</td>
      <td>${b.hotel}</td>
      <td><span class="badge-status badge-featured">${(b.lang || 'en').toUpperCase()}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Settings Form
function populateSettingsForm() {
  const s = adminData.settings || {};
  document.getElementById('settingWhatsapp').value = s.whatsapp_number || '';
  document.getElementById('settingPhone').value = s.phone || '';
  document.getElementById('settingEmail').value = s.contact_email || '';
  document.getElementById('settingCurrency').value = s.currency || '€';
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const whatsapp_number = document.getElementById('settingWhatsapp').value.trim();
  const phone = document.getElementById('settingPhone').value.trim();
  const contact_email = document.getElementById('settingEmail').value.trim();
  const currency = document.getElementById('settingCurrency').value.trim();
  const new_admin_pin = document.getElementById('settingNewPin').value.trim();

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pin': currentAdminPin
      },
      body: JSON.stringify({
        whatsapp_number,
        phone,
        contact_email,
        currency,
        new_admin_pin: new_admin_pin || undefined
      })
    });
    if (res.ok) {
      if (new_admin_pin) {
        currentAdminPin = new_admin_pin;
        localStorage.setItem('egypt_voyage_admin_pin', new_admin_pin);
      }
      alert('✅ Settings updated successfully!');
      loadAdminData();
    }
  } catch (err) {
    alert('Error saving settings');
  }
}
