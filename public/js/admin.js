/* ============================================================
   EGYPT VOYAGE - ADMIN DASHBOARD SCRIPT
   ============================================================ */

let adminData = {
  settings: {},
  cities: [],
  tours: [],
  products: [],
  bookings: []
};

let quickUploadProductId = null;

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

  // Product Form Submit & Upload
  const productForm = document.getElementById('productEditForm');
  if (productForm) {
    productForm.addEventListener('submit', handleSaveProduct);
  }

  const productImageFile = document.getElementById('productImageFile');
  if (productImageFile) {
    productImageFile.addEventListener('change', uploadProductImage);
  }

  const quickProductImgInput = document.getElementById('quickProductImageFile');
  if (quickProductImgInput) {
    quickProductImgInput.addEventListener('change', handleQuickProductImageUpload);
  }

  const productUrlInput = document.getElementById('productImageUrlInput');
  if (productUrlInput) {
    productUrlInput.addEventListener('input', () => {
      const prev = document.getElementById('productImagePreview');
      const val = productUrlInput.value.trim();
      if (prev) {
        if (val) {
          prev.src = val;
          prev.style.display = 'block';
        } else {
          prev.style.display = 'none';
        }
      }
    });
  }

  // Close Tour / Product Modal on Backdrop click
  const tourModal = document.getElementById('tourModalOverlay');
  if (tourModal) {
    tourModal.addEventListener('click', (e) => {
      if (e.target === tourModal) {
        closeTourModal();
      }
    });
  }

  const productModal = document.getElementById('productModalOverlay');
  if (productModal) {
    productModal.addEventListener('click', (e) => {
      if (e.target === productModal) {
        closeProductModal();
      }
    });
  }

  // Close on Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTourModal();
      closeProductModal();
    }
  });
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
    renderProductsTable();
    renderCitiesTable();
    renderReviewsTable();
    renderBookingsTable();
    populateSettingsForm();
    populateCityDropdown();

    if (window.location.hash === '#settings') {
      switchTab('settings');
    } else if (window.location.hash === '#bazar') {
      switchTab('bazar');
    } else if (window.location.hash === '#addTour') {
      openAddTourModal();
    } else if (window.location.hash === '#addProduct') {
      switchTab('bazar');
      openAddProductModal();
    }
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

  const productsCount = (adminData.products || []).length;
  const statProductsEl = document.getElementById('statTotalProducts');
  if (statProductsEl) statProductsEl.textContent = productsCount;
  const bazarBadge = document.getElementById('bazarProductsCountBadge');
  if (bazarBadge) bazarBadge.textContent = productsCount;

  const reviews = adminData.reviews || [];
  const pendingCount = reviews.filter(r => !r.approved).length;
  const pendingEl = document.getElementById('statPendingReviews');
  if (pendingEl) pendingEl.textContent = pendingCount;

  const badgeEl = document.getElementById('reviewsPendingBadge');
  if (badgeEl) {
    if (pendingCount > 0) {
      badgeEl.textContent = pendingCount;
      badgeEl.style.display = 'inline-block';
    } else {
      badgeEl.style.display = 'none';
    }
  }
}

// Render Tours Table
function renderToursTable() {
  const tbody = document.getElementById('toursTableBody');
  if (!tbody) return;

  const curr = adminData.settings?.currency || '$';
  document.querySelectorAll('.admin-curr-label').forEach(el => {
    el.textContent = curr;
  });
  tbody.innerHTML = '';

  adminData.tours.forEach(tour => {
    const tr = document.createElement('tr');
    const city = adminData.cities.find(c => c.id === tour.city_id);
    const cityName = city?.names?.en || tour.city_id;

    tr.innerHTML = `
      <td>
        <img src="${escapeHtmlAdmin(tour.image || '/uploads/banner_1.jpg')}" class="table-thumb" alt="Thumbnail" />
      </td>
      <td>
        <div style="font-weight: 700; color: #FFF;">${escapeHtmlAdmin(tour.names?.en || 'Unnamed')}</div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">${tour.names?.ru ? '🇷🇺 ' + escapeHtmlAdmin(tour.names.ru) : ''}</div>
      </td>
      <td>
        <span style="color: var(--admin-accent); font-weight: 600;">📍 ${escapeHtmlAdmin(cityName)}</span>
      </td>
      <td>
        <div style="display: flex; align-items: center; gap: 4px;">
          <span style="color: #F97316; font-weight: 700;">${escapeHtmlAdmin(curr)}</span>
          <input type="number" class="quick-price-input" value="${Number(tour.price) || 0}" onchange="quickUpdatePrice(${Number(tour.id) || 0}, this.value)" title="Change price and click outside to save" />
        </div>
      </td>
      <td>
        <button class="badge-status ${tour.active !== false ? 'badge-active' : 'badge-inactive'}" onclick="toggleTourActive(${Number(tour.id) || 0}, ${tour.active !== false})" style="border: none; cursor: pointer;">
          ${tour.active !== false ? 'Active' : 'Hidden'}
        </button>
      </td>
      <td>
        <button class="badge-status ${tour.featured ? 'badge-featured' : 'badge-inactive'}" onclick="toggleTourFeatured(${Number(tour.id) || 0}, ${Boolean(tour.featured)})" style="border: none; cursor: pointer;">
          ${tour.featured ? '★ Featured' : 'Normal'}
        </button>
      </td>
      <td>
        <div class="table-actions">
          <button class="btn-icon" onclick="openEditTourModal(${Number(tour.id) || 0})" title="Edit All Details">✏️</button>
          <button class="btn-icon delete" onclick="deleteTour(${Number(tour.id) || 0})" title="Delete Tour">🗑️</button>
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

// Switch Tour Multilingual Tab in Modal
function switchTourModalLang(lang, btn) {
  document.querySelectorAll('.tour-lang-btn').forEach(b => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    const defaultBtn = document.querySelector(`.tour-lang-btn[onclick*="'${lang}'"]`);
    if (defaultBtn) defaultBtn.classList.add('active');
  }

  const langBoxes = ['en', 'ru', 'fr', 'pl'];
  if (lang === 'all') {
    langBoxes.forEach(l => {
      const box = document.getElementById(`tourLangBox-${l}`);
      if (box) box.style.display = 'block';
    });
  } else {
    langBoxes.forEach(l => {
      const box = document.getElementById(`tourLangBox-${l}`);
      if (box) {
        box.style.display = (l === lang) ? 'block' : 'none';
      }
    });
  }
}

// Open Tour Modal for Add / Edit
function openAddTourModal() {
  document.getElementById('tourFormModalTitle').textContent = 'Add New Excursion';
  document.getElementById('tourEditForm').reset();
  document.getElementById('tourEditId').value = '';
  document.getElementById('tourImagePreview').style.display = 'none';
  const statusText = document.getElementById('uploadStatusText');
  if (statusText) statusText.textContent = 'JPG, PNG, WebP, GIF up to 5MB';
  
  switchTourModalLang('en');
  document.getElementById('tourModalOverlay').classList.add('active');
  const modalBody = document.querySelector('#tourModalOverlay .modal-body');
  if (modalBody) modalBody.scrollTop = 0;
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

  switchTourModalLang('en');
  document.getElementById('tourModalOverlay').classList.add('active');
  const modalBody = document.querySelector('#tourModalOverlay .modal-body');
  if (modalBody) modalBody.scrollTop = 0;
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
      statusText.textContent = '❌ ' + (data.error || 'Upload failed');
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
    image: image || '/uploads/banner_1.jpg',
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
      <td><img src="${escapeHtmlAdmin(city.image)}" class="table-thumb" alt="${escapeHtmlAdmin(city.id)}" /></td>
      <td><strong>${escapeHtmlAdmin(city.names?.en || city.id)}</strong></td>
      <td>${escapeHtmlAdmin(city.names?.ru || '—')}</td>
      <td>${escapeHtmlAdmin(city.names?.fr || '—')}</td>
      <td>${escapeHtmlAdmin(city.names?.pl || '—')}</td>
      <td><span class="badge-status badge-active">${count} Excursions</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Render Bookings Table
/* ==================== REVIEWS MODERATION MODULE ==================== */
let currentReviewsAdminFilter = 'all';

function filterReviewsAdmin(filter) {
  currentReviewsAdminFilter = filter;
  ['all', 'pending', 'approved'].forEach(f => {
    const btn = document.getElementById(`btnFilter${f.charAt(0).toUpperCase() + f.slice(1)}Reviews`);
    if (btn) {
      if (f === filter) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  renderReviewsTable();
}

function renderReviewsTable() {
  const tbody = document.getElementById('reviewsTableBody');
  if (!tbody) return;

  const allReviews = adminData.reviews || [];
  const countAll = allReviews.length;
  const countPending = allReviews.filter(r => !r.approved).length;
  const countApproved = allReviews.filter(r => r.approved).length;

  const countAllEl = document.getElementById('countReviewsAll');
  const countPendingEl = document.getElementById('countReviewsPending');
  const countApprovedEl = document.getElementById('countReviewsApproved');
  if (countAllEl) countAllEl.textContent = countAll;
  if (countPendingEl) countPendingEl.textContent = countPending;
  if (countApprovedEl) countApprovedEl.textContent = countApproved;

  // Filter list
  let displayList = allReviews;
  if (currentReviewsAdminFilter === 'pending') {
    displayList = allReviews.filter(r => !r.approved);
  } else if (currentReviewsAdminFilter === 'approved') {
    displayList = allReviews.filter(r => r.approved);
  }

  tbody.innerHTML = '';
  if (displayList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 36px;">No reviews in this view.</td></tr>`;
    return;
  }

  displayList.forEach(r => {
    const tr = document.createElement('tr');
    const isApproved = r.approved === true;
    const ratingStars = '★'.repeat(r.rating || 5) + '☆'.repeat(5 - (r.rating || 5));

    const statusBadge = isApproved
      ? `<span class="badge-status-approved">✓ Published</span>`
      : `<span class="badge-status-pending">⏳ Pending Approval</span>`;

    const toggleBtn = isApproved
      ? `<button class="btn-unapprove" onclick="toggleReviewApproval(${r.id}, false)">Unpublish</button>`
      : `<button class="btn-approve" onclick="toggleReviewApproval(${r.id}, true)">✓ Approve</button>`;

    tr.innerHTML = `
      <td>
        <strong style="color: #FFFFFF; font-size: 0.95rem; display: block; margin-bottom: 2px;">${escapeHtmlAdmin(r.name)}</strong>
        <div style="font-size: 0.8rem; color: #94A3B8;">${escapeHtmlAdmin(r.country || 'Guest')}</div>
      </td>
      <td><span style="color: var(--admin-accent); font-weight: 600;">${escapeHtmlAdmin(r.tour || 'General')}</span></td>
      <td><span style="color: #F59E0B; font-weight: 700; letter-spacing: 1px;">${ratingStars}</span></td>
      <td style="max-width: 340px; font-size: 0.92rem; line-height: 1.5; color: #F1F5F9;">${escapeHtmlAdmin(r.comment)}</td>
      <td style="font-size: 0.85rem; color: #CBD5E1; white-space: nowrap;">${r.date || '—'}</td>
      <td>${statusBadge}</td>
      <td style="text-align: right;">
        <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center;">
          ${toggleBtn}
          <button class="btn-icon" style="color: #EF4444;" onclick="deleteReviewAdmin(${r.id})" title="Delete Review">🗑️</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function toggleReviewApproval(reviewId, approved) {
  try {
    const res = await fetch(`/api/admin/reviews/${reviewId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pin': currentAdminPin
      },
      body: JSON.stringify({ approved })
    });
    const result = await res.json();
    if (result.success) {
      const rev = (adminData.reviews || []).find(r => String(r.id) === String(reviewId));
      if (rev) {
        rev.approved = approved;
        rev.status = approved ? 'approved' : 'rejected';
      }
      renderStats();
      renderReviewsTable();
    } else {
      alert(result.error || 'Failed to update review status');
    }
  } catch (err) {
    console.error('Error updating review:', err);
  }
}

async function deleteReviewAdmin(reviewId) {
  if (!confirm('Are you sure you want to permanently delete this review?')) return;

  try {
    const res = await fetch(`/api/admin/reviews/${reviewId}`, {
      method: 'DELETE',
      headers: { 'x-admin-pin': currentAdminPin }
    });
    const result = await res.json();
    if (result.success) {
      adminData.reviews = (adminData.reviews || []).filter(r => String(r.id) !== String(reviewId));
      renderStats();
      renderReviewsTable();
    } else {
      alert(result.error || 'Failed to delete review');
    }
  } catch (err) {
    console.error('Error deleting review:', err);
  }
}

function escapeHtmlAdmin(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
    const isBazar = String(b.tour_id || '').startsWith('BAZAR-');
    const guestsLabel = isBazar
      ? `Qty: ${b.adults || 1}`
      : `${b.adults} Adults, ${b.children} Kids`;
    tr.innerHTML = `
      <td><strong>${escapeHtmlAdmin(b.id)}</strong></td>
      <td>${escapeHtmlAdmin(b.tour_name)} <br><small style="color: var(--admin-accent);">📍 ${escapeHtmlAdmin(b.city)}</small></td>
      <td>${escapeHtmlAdmin(b.date)}</td>
      <td>${escapeHtmlAdmin(guestsLabel)}</td>
      <td>${escapeHtmlAdmin(b.hotel)}</td>
      <td><span class="badge-status badge-featured">${escapeHtmlAdmin((b.lang || 'en').toUpperCase())}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Settings Form
function populateSettingsForm() {
  let s = adminData.settings || {};
  try {
    const local = localStorage.getItem('sphinxtour_custom_settings');
    if (local) {
      const parsed = JSON.parse(local);
      if (!localStorage.getItem('sphinxtour_currency_migrated_usd')) {
        if (parsed.currency === '€' || parsed.currency === 'EUR') {
          parsed.currency = '$';
          localStorage.setItem('sphinxtour_custom_settings', JSON.stringify(parsed));
        }
        localStorage.setItem('sphinxtour_currency_migrated_usd', '1');
      }
      s = { ...s, ...parsed };
    }
  } catch (e) {}

  document.getElementById('settingWhatsapp').value = s.whatsapp_number || '';
  document.getElementById('settingPhone').value = s.phone || '';
  document.getElementById('settingEmail').value = s.contact_email || '';
  document.getElementById('settingCurrency').value = s.currency || '$';
  document.querySelectorAll('.admin-curr-label').forEach(el => {
    el.textContent = s.currency || '$';
  });
  const fb = document.getElementById('settingFacebook');
  if (fb) fb.value = s.social_facebook || '';
  const tg = document.getElementById('settingTelegram');
  if (tg) tg.value = s.social_telegram || '';
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const whatsapp_number = document.getElementById('settingWhatsapp').value.trim();
  const phone = document.getElementById('settingPhone').value.trim();
  const contact_email = document.getElementById('settingEmail').value.trim();
  const currency = document.getElementById('settingCurrency').value.trim() || '$';
  const social_facebook = document.getElementById('settingFacebook') ? document.getElementById('settingFacebook').value.trim() : undefined;
  const social_telegram = document.getElementById('settingTelegram') ? document.getElementById('settingTelegram').value.trim() : undefined;
  const new_admin_pin = document.getElementById('settingNewPin').value.trim();

  // Save to localStorage immediately so changes reflect everywhere in the browser instantly
  const localObj = {
    whatsapp_number: whatsapp_number.replace(/[^0-9]/g, ''),
    phone,
    contact_email,
    currency,
    social_facebook,
    social_telegram
  };
  try {
    localStorage.setItem('sphinxtour_custom_settings', JSON.stringify(localObj));
  } catch (e) {}

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
        social_facebook,
        social_telegram,
        new_admin_pin: new_admin_pin || undefined
      })
    });
    if (res.ok) {
      if (new_admin_pin) {
        currentAdminPin = new_admin_pin;
        localStorage.setItem('egypt_voyage_admin_pin', new_admin_pin);
      }
      alert('✅ Settings updated and applied successfully!');
      loadAdminData();
    } else {
      alert('✅ Settings saved in browser!');
    }
  } catch (err) {
    alert('✅ Settings saved in browser!');
  }
}

/* ==================== BAZAR PRODUCTS CRUD ==================== */
const BAZAR_CATEGORY_LABELS = {
  souvenirs: '🏺 Souvenirs & Gifts',
  perfumes: '🧴 Oils & Perfumes',
  crafts: '🗿 Alabaster & Crafts',
  spices: '🌿 Spices & Tea',
  textiles: '🧣 Cotton & Scarves'
};

function renderProductsTable() {
  const tbody = document.getElementById('productsTableBody');
  if (!tbody) return;

  const curr = adminData.settings?.currency || '$';
  document.querySelectorAll('.admin-curr-label').forEach(el => {
    el.textContent = curr;
  });

  const products = adminData.products || [];
  tbody.innerHTML = '';

  if (products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 36px;">No Online Shop products yet. Click "+ Add New Product" to create one!</td></tr>`;
    return;
  }

  products.forEach(product => {
    const tr = document.createElement('tr');
    const catLabel = BAZAR_CATEGORY_LABELS[product.category] || '🏺 Souvenirs';
    const specsList = product.specs?.en || [];
    const specsHtml = specsList.slice(0, 3).map(s => `<li>• ${escapeHtmlAdmin(s)}</li>`).join('') +
      (specsList.length > 3 ? `<li style="color: var(--admin-accent);">+ ${specsList.length - 3} more</li>` : '');

    tr.innerHTML = `
      <td>
        <div class="table-thumb-wrap">
          <img src="${escapeHtmlAdmin(product.image)}" class="table-thumb" alt="Product" style="cursor: pointer;" onclick="triggerQuickProductImage(${Number(product.id) || 0})" title="Click to upload replacement photo" />
          <button type="button" class="btn-thumb-edit" onclick="triggerQuickProductImage(${Number(product.id) || 0})" title="Change product image">📷</button>
        </div>
      </td>
      <td>
        <div style="font-weight: 700; color: #FFF;">${escapeHtmlAdmin(product.names?.en || 'Unnamed Product')}</div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">${product.names?.ru ? '🇷🇺 ' + escapeHtmlAdmin(product.names.ru) : ''}</div>
        <div style="font-size: 0.76rem; color: var(--admin-accent); margin-top: 3px;">${escapeHtmlAdmin(catLabel)}</div>
      </td>
      <td>
        ${specsHtml ? `<ul class="admin-specs-list">${specsHtml}</ul>` : '<span style="color: var(--text-dim);">—</span>'}
      </td>
      <td>
        <div style="display: flex; align-items: center; gap: 4px;">
          <span style="color: #F97316; font-weight: 700;">${escapeHtmlAdmin(curr)}</span>
          <input type="number" min="0" step="any" class="quick-price-input" value="${Number(product.price) || 0}" onchange="quickUpdateProductPrice(${Number(product.id) || 0}, this.value)" title="Change price and click outside to save" />
        </div>
      </td>
      <td>
        <button class="badge-status ${product.active !== false ? 'badge-active' : 'badge-inactive'}" onclick="toggleProductActive(${Number(product.id) || 0}, ${product.active !== false})" style="border: none; cursor: pointer;">
          ${product.active !== false ? 'Active' : 'Hidden'}
        </button>
      </td>
      <td>
        <button class="badge-status ${product.featured ? 'badge-featured' : 'badge-inactive'}" onclick="toggleProductFeatured(${Number(product.id) || 0}, ${Boolean(product.featured)})" style="border: none; cursor: pointer;">
          ${product.featured ? '★ Popular' : 'Normal'}
        </button>
      </td>
      <td>
        <div class="table-actions">
          <button class="btn-icon" onclick="openEditProductModal(${Number(product.id) || 0})" title="Edit Image, Specs & Price">✏️</button>
          <button class="btn-icon delete" onclick="deleteProduct(${Number(product.id) || 0})" title="Delete Product">🗑️</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function triggerQuickProductImage(productId) {
  quickUploadProductId = productId;
  const input = document.getElementById('quickProductImageFile');
  if (input) {
    input.value = '';
    input.click();
  }
}

async function handleQuickProductImageUpload(e) {
  const file = e.target.files[0];
  if (!file || !quickUploadProductId) return;

  const targetId = quickUploadProductId;
  quickUploadProductId = null;

  const formData = new FormData();
  formData.append('image', file);

  try {
    const upRes = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'x-admin-pin': currentAdminPin },
      body: formData
    });
    const upData = await upRes.json();
    if (!upRes.ok || !upData.success) {
      alert('❌ ' + (upData.error || 'Image upload failed'));
      return;
    }

    const patchRes = await fetch(`/api/products/${targetId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pin': currentAdminPin
      },
      body: JSON.stringify({ image: upData.url })
    });
    if (patchRes.ok) {
      loadAdminData();
    } else {
      alert('❌ Failed to update product image');
    }
  } catch (err) {
    alert('❌ Network error uploading product image');
  }
}

async function quickUpdateProductPrice(productId, newPrice) {
  try {
    const res = await fetch(`/api/products/${productId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pin': currentAdminPin
      },
      body: JSON.stringify({ price: Number(newPrice) })
    });
    if (res.ok) {
      loadAdminData();
    } else {
      alert('Failed to update product price');
    }
  } catch (e) {
    alert('Failed to update product price');
  }
}

async function toggleProductActive(productId, currentActive) {
  try {
    await fetch(`/api/products/${productId}`, {
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

async function toggleProductFeatured(productId, currentFeatured) {
  try {
    await fetch(`/api/products/${productId}`, {
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

async function deleteProduct(productId) {
  if (!confirm('Are you sure you want to delete this Online Shop product?')) return;
  try {
    const res = await fetch(`/api/products/${productId}`, {
      method: 'DELETE',
      headers: { 'x-admin-pin': currentAdminPin }
    });
    if (res.ok) {
      loadAdminData();
    }
  } catch (e) {
    alert('Error deleting product');
  }
}

function switchProductModalLang(lang, btn) {
  document.querySelectorAll('.prod-lang-btn').forEach(b => b.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
  } else {
    const defaultBtn = document.querySelector(`.prod-lang-btn[onclick*="'${lang}'"]`);
    if (defaultBtn) defaultBtn.classList.add('active');
  }

  const langBoxes = ['en', 'ru', 'fr', 'pl'];
  if (lang === 'all') {
    langBoxes.forEach(l => {
      const box = document.getElementById(`prodLangBox-${l}`);
      if (box) box.style.display = 'block';
    });
  } else {
    langBoxes.forEach(l => {
      const box = document.getElementById(`prodLangBox-${l}`);
      if (box) box.style.display = (l === lang) ? 'block' : 'none';
    });
  }
}

function openAddProductModal() {
  document.getElementById('productFormModalTitle').textContent = 'Add New Online Shop Product';
  document.getElementById('productEditForm').reset();
  document.getElementById('productEditId').value = '';
  document.getElementById('productImagePreview').style.display = 'none';
  const statusText = document.getElementById('productUploadStatusText');
  if (statusText) statusText.textContent = 'JPG, PNG, WebP, GIF up to 5MB';

  switchProductModalLang('en');
  document.getElementById('productModalOverlay').classList.add('active');
  const modalBody = document.querySelector('#productModalOverlay .modal-body');
  if (modalBody) modalBody.scrollTop = 0;
}

function openEditProductModal(productId) {
  const product = (adminData.products || []).find(p => String(p.id) === String(productId));
  if (!product) return;

  document.getElementById('productFormModalTitle').textContent = 'Edit Product #' + product.id;
  document.getElementById('productEditId').value = product.id;
  document.getElementById('productCategorySelect').value = product.category || 'souvenirs';
  document.getElementById('productPriceInput').value = product.price || 0;
  document.getElementById('productFeaturedInput').checked = Boolean(product.featured);
  document.getElementById('productImageUrlInput').value = product.image || '';

  const prev = document.getElementById('productImagePreview');
  if (product.image) {
    prev.src = product.image;
    prev.style.display = 'block';
  } else {
    prev.style.display = 'none';
  }

  document.getElementById('productNameEn').value = product.names?.en || '';
  document.getElementById('productNameRu').value = product.names?.ru || '';
  document.getElementById('productNameFr').value = product.names?.fr || '';
  document.getElementById('productNamePl').value = product.names?.pl || '';

  document.getElementById('productSpecsEn').value = (product.specs?.en || []).join('\n');
  document.getElementById('productSpecsRu').value = (product.specs?.ru || []).join('\n');
  document.getElementById('productSpecsFr').value = (product.specs?.fr || []).join('\n');
  document.getElementById('productSpecsPl').value = (product.specs?.pl || []).join('\n');

  document.getElementById('productDescEn').value = product.descriptions?.en || '';
  document.getElementById('productDescRu').value = product.descriptions?.ru || '';
  document.getElementById('productDescFr').value = product.descriptions?.fr || '';
  document.getElementById('productDescPl').value = product.descriptions?.pl || '';

  const statusText = document.getElementById('productUploadStatusText');
  if (statusText) statusText.textContent = 'JPG, PNG, WebP, GIF up to 5MB';

  switchProductModalLang('en');
  document.getElementById('productModalOverlay').classList.add('active');
  const modalBody = document.querySelector('#productModalOverlay .modal-body');
  if (modalBody) modalBody.scrollTop = 0;
}

function closeProductModal() {
  const modal = document.getElementById('productModalOverlay');
  if (modal) modal.classList.remove('active');
}

async function uploadProductImage(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('image', file);

  const statusText = document.getElementById('productUploadStatusText');
  statusText.textContent = 'Uploading...';

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'x-admin-pin': currentAdminPin },
      body: formData
    });
    const data = await res.json();
    if (res.ok && data.success) {
      document.getElementById('productImageUrlInput').value = data.url;
      const prev = document.getElementById('productImagePreview');
      prev.src = data.url;
      prev.style.display = 'block';
      statusText.textContent = '✓ Uploaded successfully!';
    } else {
      statusText.textContent = '❌ ' + (data.error || 'Upload failed');
    }
  } catch (err) {
    statusText.textContent = '❌ Network error';
  }
}

async function handleSaveProduct(e) {
  e.preventDefault();

  const id = document.getElementById('productEditId').value;
  const category = document.getElementById('productCategorySelect').value;
  const price = Number(document.getElementById('productPriceInput').value) || 0;
  const featured = document.getElementById('productFeaturedInput').checked;
  const image = document.getElementById('productImageUrlInput').value.trim();

  const nameEn = document.getElementById('productNameEn').value.trim();
  const names = {
    en: nameEn,
    ru: document.getElementById('productNameRu').value.trim() || nameEn,
    fr: document.getElementById('productNameFr').value.trim() || nameEn,
    pl: document.getElementById('productNamePl').value.trim() || nameEn
  };

  const specsEnRaw = document.getElementById('productSpecsEn').value.split('\n').map(s => s.trim()).filter(Boolean);
  const parseLines = (elId) => document.getElementById(elId).value.split('\n').map(s => s.trim()).filter(Boolean);
  const specsRuRaw = parseLines('productSpecsRu');
  const specsFrRaw = parseLines('productSpecsFr');
  const specsPlRaw = parseLines('productSpecsPl');

  const specs = {
    en: specsEnRaw,
    ru: specsRuRaw.length > 0 ? specsRuRaw : specsEnRaw,
    fr: specsFrRaw.length > 0 ? specsFrRaw : specsEnRaw,
    pl: specsPlRaw.length > 0 ? specsPlRaw : specsEnRaw
  };

  const descEn = document.getElementById('productDescEn').value.trim();
  const descriptions = {
    en: descEn,
    ru: document.getElementById('productDescRu').value.trim() || descEn,
    fr: document.getElementById('productDescFr').value.trim() || descEn,
    pl: document.getElementById('productDescPl').value.trim() || descEn
  };

  const payload = {
    category,
    price,
    featured,
    image: image || '/uploads/bazar_papyrus.jpg',
    names,
    specs,
    descriptions
  };

  if (id) payload.id = Number(id);

  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pin': currentAdminPin
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      closeProductModal();
      loadAdminData();
    } else {
      alert('Failed to save product');
    }
  } catch (err) {
    alert('Server error saving product');
  }
}
