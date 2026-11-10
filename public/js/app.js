/* ============================================================
   EGYPT VOYAGE TOURS - CLIENT APPLICATION LOGIC
   ============================================================ */

let appData = {
  settings: {},
  cities: [],
  tours: [],
  products: []
};

let currentLang = localStorage.getItem('egypt_voyage_lang') || 'en';
let selectedCityFilter = 'hurghada';
let searchQuery = '';
let selectedBazarCategory = 'all';
let bazarSearchQuery = '';
let selectedBookingTour = null;
let bookingAdults = 2;
let bookingChildren = 0;
let selectedOrderProduct = null;
let bazarOrderQty = 1;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initLanguage();
  initRotatingBanner();
  fetchData();
  setupEventListeners();
  setDefaultBookingDate();
});

/* ==================== ROTATING BANNER CONTROLLER ==================== */
let bannerCurrentIndex = 0;
let bannerInterval = null;
let bannerIsPlaying = true;
const BANNER_AUTOPLAY_DELAY = 5000;

function initRotatingBanner() {
  const wrapper = document.getElementById('rotatingBannerWrapper');
  const slides = document.querySelectorAll('.banner-slide');
  const dots = document.querySelectorAll('.banner-dot');
  const prevBtn = document.getElementById('bannerPrevBtn');
  const nextBtn = document.getElementById('bannerNextBtn');
  const playToggle = document.getElementById('bannerPlayToggle');
  const playIcon = document.getElementById('playToggleIcon');

  if (!wrapper || slides.length === 0) return;

  function goToSlide(idx) {
    if (idx < 0) idx = slides.length - 1;
    if (idx >= slides.length) idx = 0;

    bannerCurrentIndex = idx;

    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === idx);
    });

    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === idx);
    });
  }

  function nextSlide() {
    goToSlide(bannerCurrentIndex + 1);
  }

  function prevSlide() {
    goToSlide(bannerCurrentIndex - 1);
  }

  function startBannerTimer() {
    stopBannerTimer();
    bannerInterval = setInterval(nextSlide, BANNER_AUTOPLAY_DELAY);
    bannerIsPlaying = true;
    if (playIcon) playIcon.textContent = '⏸';
  }

  function stopBannerTimer() {
    if (bannerInterval) {
      clearInterval(bannerInterval);
      bannerInterval = null;
    }
  }

  function togglePlay() {
    if (bannerIsPlaying) {
      stopBannerTimer();
      bannerIsPlaying = false;
      if (playIcon) playIcon.textContent = '▶';
    } else {
      startBannerTimer();
      bannerIsPlaying = true;
      if (playIcon) playIcon.textContent = '⏸';
    }
  }

  // Event handlers
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      nextSlide();
      if (bannerIsPlaying) startBannerTimer();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      prevSlide();
      if (bannerIsPlaying) startBannerTimer();
    });
  }

  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      const idx = parseInt(dot.getAttribute('data-index'), 10);
      goToSlide(idx);
      if (bannerIsPlaying) startBannerTimer();
    });
  });

  if (playToggle) {
    playToggle.addEventListener('click', togglePlay);
  }

  // Hover to pause, leave to resume
  wrapper.addEventListener('mouseenter', () => {
    if (bannerIsPlaying) stopBannerTimer();
  });

  wrapper.addEventListener('mouseleave', () => {
    if (bannerIsPlaying) startBannerTimer();
  });

  // Mobile touch swipe support
  let touchStartX = 0;
  let touchEndX = 0;

  wrapper.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  wrapper.addEventListener('touchend', (e) => {
    touchEndX = e.changedTouches[0].screenX;
    const diff = touchEndX - touchStartX;
    if (Math.abs(diff) > 40) {
      if (diff < 0) {
        nextSlide();
      } else {
        prevSlide();
      }
      if (bannerIsPlaying) startBannerTimer();
    }
  }, { passive: true });

  // Start auto-rotation
  startBannerTimer();
}

// Fetch all public data from server
async function fetchData() {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error('Failed to load data');
    const data = await res.json();
    appData = data;

    // Check if custom settings are saved in localStorage (provides instant sync even across serverless/static deployments)
    try {
      const localSettings = localStorage.getItem('sphinxtour_custom_settings');
      if (localSettings) {
        const parsed = JSON.parse(localSettings);
        if (!localStorage.getItem('sphinxtour_currency_migrated_usd')) {
          if (parsed.currency === '€' || parsed.currency === 'EUR') {
            parsed.currency = '$';
            localStorage.setItem('sphinxtour_custom_settings', JSON.stringify(parsed));
          }
          localStorage.setItem('sphinxtour_currency_migrated_usd', '1');
        }
        appData.settings = { ...(appData.settings || {}), ...parsed };
      }
    } catch (e) {}

    updateSiteSettings();
    renderCities();
    renderCityFilters();
    renderTours();
    renderBazarFilters();
    renderBazarProducts();
    renderReviews();
    initHeroSearchFilter();
    applyTranslations();
  } catch (err) {
    console.error('Error loading site data:', err);
    // Fallback to local settings if available
    try {
      const localSettings = localStorage.getItem('sphinxtour_custom_settings');
      if (localSettings) {
        appData.settings = JSON.parse(localSettings);
        updateSiteSettings();
        initHeroSearchFilter();
      }
    } catch (e) {}
  }
}

// Update site settings from backend
function updateSiteSettings() {
  const { settings } = appData;
  if (!settings) return;

  const contactDigits = (settings.whatsapp_number || '201140423458').replace(/[^0-9]/g, '');

  // Floating WhatsApp button
  const floatingWa = document.getElementById('floatingWhatsappBtn');
  if (floatingWa && contactDigits) {
    const generalMsg = encodeURIComponent(
      currentLang === 'ru' ? 'Здравствуйте! Подскажите, пожалуйста, по поводу экскурсий.' :
      currentLang === 'fr' ? 'Bonjour! J\'aimerais avoir des informations sur vos excursions.' :
      currentLang === 'pl' ? 'Dzień dobry! Chciałbym zapytać o wycieczki.' :
      'Hello! I would like to inquire about your excursions.'
    );
    floatingWa.href = `https://wa.me/${contactDigits}?text=${generalMsg}`;
  }

  // Floating Telegram & Viber buttons (mobile stack directed to same phone number)
  const floatingTg = document.getElementById('floatingTelegramBtn');
  if (floatingTg && contactDigits) {
    floatingTg.href = `https://t.me/+${contactDigits}`;
  }

  const floatingViber = document.getElementById('floatingViberBtn');
  if (floatingViber && contactDigits) {
    floatingViber.href = `viber://chat?number=%2B${contactDigits}`;
  }

  // Nav WhatsApp button
  const navWa = document.getElementById('navWhatsappBtn');
  if (navWa && settings.whatsapp_number) {
    navWa.href = `https://wa.me/${settings.whatsapp_number}`;
  }

  // Mobile Drawer WhatsApp button
  const drawerWa = document.getElementById('mobileDrawerWhatsappBtn');
  if (drawerWa && settings.whatsapp_number) {
    drawerWa.href = `https://wa.me/${settings.whatsapp_number}`;
  }

  // Hero WhatsApp button
  const heroWa = document.getElementById('heroWhatsappBtn');
  if (heroWa && settings.whatsapp_number) {
    heroWa.href = `https://wa.me/${settings.whatsapp_number}`;
  }

  // Footer WhatsApp link
  const footerWa = document.getElementById('footerWhatsappLink');
  if (footerWa && settings.whatsapp_number) {
    footerWa.href = `https://wa.me/${settings.whatsapp_number}`;
  }

  // Footer phone and email
  const footerPhone = document.getElementById('footerPhone');
  if (footerPhone && settings.phone) {
    footerPhone.textContent = settings.phone;
    footerPhone.href = `tel:${settings.phone.replace(/[^0-9+]/g, '')}`;
  }
  const footerEmail = document.getElementById('footerEmail');
  if (footerEmail && settings.contact_email) {
    footerEmail.textContent = settings.contact_email;
    footerEmail.href = `mailto:${settings.contact_email}`;
  }

  // Footer Social links (Facebook & Telegram)
  const fbBtn = document.getElementById('footerSocialFacebook');
  if (fbBtn) {
    if (settings.social_facebook) {
      fbBtn.href = settings.social_facebook;
      fbBtn.style.display = 'inline-flex';
    } else {
      fbBtn.style.display = 'none';
    }
  }

  const tgBtn = document.getElementById('footerSocialTelegram');
  if (tgBtn) {
    if (settings.social_telegram) {
      tgBtn.href = settings.social_telegram;
      tgBtn.style.display = 'inline-flex';
    } else {
      tgBtn.style.display = 'none';
    }
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Language Selector toggle
  const langBtn = document.getElementById('langSelectorBtn');
  const langDropdown = document.getElementById('langDropdown');

  if (langBtn && langDropdown) {
    langBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      langDropdown.classList.toggle('show');
    });

    document.addEventListener('click', () => {
      langDropdown.classList.remove('show');
    });

    document.querySelectorAll('.lang-item').forEach(item => {
      item.addEventListener('click', () => {
        const lang = item.getAttribute('data-lang');
        switchLanguage(lang);
        langDropdown.classList.remove('show');
      });
    });
  }

  // Mobile Hamburger Menu toggle & drawer
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const mobileNavDrawer = document.getElementById('mobileNavDrawer');
  if (mobileMenuBtn && mobileNavDrawer) {
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = mobileNavDrawer.classList.toggle('open');
      mobileMenuBtn.classList.toggle('active', isOpen);
    });

    // Close on clicking outside
    document.addEventListener('click', (e) => {
      if (!mobileNavDrawer.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        mobileNavDrawer.classList.remove('open');
        mobileMenuBtn.classList.remove('active');
      }
    });

    // Close on clicking any link inside drawer
    mobileNavDrawer.querySelectorAll('.mobile-nav-link, a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNavDrawer.classList.remove('open');
        mobileMenuBtn.classList.remove('active');
      });
    });
  }

  // Search input
  const searchInput = document.getElementById('tourSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderTours();
    });
  }

  // Booking counter buttons
  const adultMinus = document.getElementById('adultMinus');
  const adultPlus = document.getElementById('adultPlus');
  const childMinus = document.getElementById('childMinus');
  const childPlus = document.getElementById('childPlus');

  if (adultMinus && adultPlus) {
    adultMinus.addEventListener('click', () => {
      if (bookingAdults > 1) {
        bookingAdults--;
        updateBookingCounters();
      }
    });
    adultPlus.addEventListener('click', () => {
      bookingAdults++;
      updateBookingCounters();
    });
  }

  if (childMinus && childPlus) {
    childMinus.addEventListener('click', () => {
      if (bookingChildren > 0) {
        bookingChildren--;
        updateBookingCounters();
      }
    });
    childPlus.addEventListener('click', () => {
      bookingChildren++;
      updateBookingCounters();
    });
  }

  // Booking Form Submit
  const bookingForm = document.getElementById('quickBookingForm');
  if (bookingForm) {
    bookingForm.addEventListener('submit', (e) => {
      e.preventDefault();
      executeWhatsAppBooking();
    });
  }

  // Bazar search input & order controls
  const bazarSearchInput = document.getElementById('bazarSearchInput');
  if (bazarSearchInput) {
    bazarSearchInput.addEventListener('input', (e) => {
      bazarSearchQuery = e.target.value.toLowerCase().trim();
      renderBazarProducts();
    });
  }

  const bazarQtyMinus = document.getElementById('bazarQtyMinus');
  const bazarQtyPlus = document.getElementById('bazarQtyPlus');
  if (bazarQtyMinus && bazarQtyPlus) {
    bazarQtyMinus.addEventListener('click', () => {
      if (bazarOrderQty > 1) {
        bazarOrderQty--;
        updateBazarOrderCounter();
      }
    });
    bazarQtyPlus.addEventListener('click', () => {
      bazarOrderQty++;
      updateBazarOrderCounter();
    });
  }

  const bazarOrderForm = document.getElementById('bazarOrderForm');
  if (bazarOrderForm) {
    bazarOrderForm.addEventListener('submit', (e) => {
      e.preventDefault();
      executeBazarWhatsAppOrder();
    });
  }

  const bazarOrderModal = document.getElementById('bazarOrderModal');
  if (bazarOrderModal) {
    bazarOrderModal.addEventListener('click', (e) => {
      if (e.target === bazarOrderModal) closeBazarOrderModal();
    });
  }

  // Initialize Star Rating Widget
  initStarRatingWidget();
}

// Set default booking date to tomorrow
function setDefaultBookingDate() {
  const dateInput = document.getElementById('bookingDate');
  if (dateInput) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateInput.value = tomorrow.toISOString().split('T')[0];
    dateInput.min = new Date().toISOString().split('T')[0];
  }
}

// Initialize Language
function initLanguage() {
  updateLangButtonText();
}

function switchLanguage(lang) {
  if (!TRANSLATIONS[lang]) return;
  currentLang = lang;
  localStorage.setItem('egypt_voyage_lang', lang);
  updateLangButtonText();
  applyTranslations();
  renderCities();
  renderCityFilters();
  renderTours();
  renderBazarFilters();
  renderBazarProducts();
  renderReviews();
  updateSiteSettings();
  updateHeroCityDropdown();
  const heroCitySelect = document.getElementById('heroCitySelect');
  updateHeroTourDropdown(heroCitySelect ? heroCitySelect.value : 'all');
}

function updateLangButtonText() {
  const label = document.getElementById('currentLangLabel');
  const flag = document.getElementById('currentLangFlag');
  const map = {
    en: { name: 'English', flag: '🇬🇧' },
    ru: { name: 'Русский', flag: '🇷🇺' },
    fr: { name: 'Français', flag: '🇫🇷' },
    pl: { name: 'Polski', flag: '🇵🇱' }
  };
  if (label && map[currentLang]) label.textContent = map[currentLang].name;
  if (flag && map[currentLang]) flag.textContent = map[currentLang].flag;

  document.querySelectorAll('.lang-item').forEach(item => {
    item.classList.toggle('active', item.getAttribute('data-lang') === currentLang);
  });
}

function t(key) {
  return (TRANSLATIONS[currentLang] && TRANSLATIONS[currentLang][key]) ||
         (TRANSLATIONS['en'] && TRANSLATIONS['en'][key]) || key;
}

// Apply static translations to elements with data-i18n
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const text = t(key);
    if (text) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = text;
      } else {
        el.textContent = text;
      }
    }
  });
  document.title = t('site_title');
}

// Render 4 Cities Showcase (Top of Landing Page)
function renderCities() {
  const container = document.getElementById('citiesContainer');
  if (!container) return;

  container.innerHTML = '';
  appData.cities.forEach(city => {
    const cityName = city.names?.[currentLang] || city.names?.en || city.id;
    const cityTagline = city.taglines?.[currentLang] || city.taglines?.en || '';
    const cityDesc = city.descriptions?.[currentLang] || city.descriptions?.en || '';

    // Count tours in this city
    const tourCount = appData.tours.filter(t => t.city_id === city.id).length;
    const isSelected = selectedCityFilter === city.id;

    const card = document.createElement('div');
    card.className = `city-card ${isSelected ? 'active' : ''}`;
    card.setAttribute('data-city-id', city.id);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${cityName} - ${tourCount} tours`);
    card.onclick = () => filterByCity(city.id);
    card.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        filterByCity(city.id);
      }
    };

    card.innerHTML = `
      <div class="city-img-wrapper">
        <img class="city-img" src="${city.image}" alt="${cityName}" loading="lazy" />
      </div>
      <div class="city-gradient-overlay"></div>
      <div class="city-badge">
        <span>📍</span> ${tourCount} ${t('nav_tours')}
      </div>
      <div class="city-content">
        <h3 class="city-name">${cityName}</h3>
        <p class="city-tagline">${cityTagline}</p>
        <p class="city-desc">${cityDesc}</p>
        <div class="city-btn">
          <span>${t('hero_cta_explore')}</span>
          <span>→</span>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// Render dynamic City Filter pills
function renderCityFilters() {
  const container = document.getElementById('cityFiltersContainer');
  if (!container) return;

  container.innerHTML = '';

  appData.cities.forEach(city => {
    const cityName = city.names?.[currentLang] || city.names?.en || city.id;
    const isActive = selectedCityFilter === city.id ? 'active' : '';
    const btn = document.createElement('button');
    btn.className = `filter-pill ${isActive}`;
    btn.onclick = () => filterByCity(city.id);
    btn.innerHTML = `📍 ${cityName}`;
    container.appendChild(btn);
  });
}

function filterByCity(cityId) {
  selectedCityFilter = cityId;
  searchQuery = '';
  const searchInput = document.getElementById('tourSearchInput');
  if (searchInput) searchInput.value = '';

  // Highlight active city card
  document.querySelectorAll('.city-card').forEach(card => {
    card.classList.toggle('active', card.getAttribute('data-city-id') === cityId);
  });

  renderCityFilters();
  renderTours();

  // Sync hero dropdowns if city filter changed from elsewhere
  const heroCitySelect = document.getElementById('heroCitySelect');
  if (heroCitySelect && heroCitySelect.value !== cityId) {
    heroCitySelect.value = cityId;
    updateHeroTourDropdown(cityId);
  }

  // Scroll to tours section when selecting a destination
  if (cityId !== 'all') {
    const toursSec = document.getElementById('toursSection');
    if (toursSec) {
      const navHeight = document.querySelector('.header')?.offsetHeight || 75;
      const yOffset = -navHeight - 12;
      const y = toursSec.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }
}

// ==================== QUICK TOUR SEARCH FILTER ====================
function initHeroSearchFilter() {
  const citySelect = document.getElementById('heroCitySelect');
  const tourSelect = document.getElementById('heroTourSelect');
  const goBtn = document.getElementById('heroSearchGoBtn');

  if (!citySelect || !tourSelect) return;

  updateHeroCityDropdown();
  updateHeroTourDropdown(citySelect.value);

  // When city changes
  citySelect.onchange = () => {
    const cityId = citySelect.value;
    selectedCityFilter = (cityId === 'all') ? 'hurghada' : cityId;
    searchQuery = '';
    const searchInput = document.getElementById('tourSearchInput');
    if (searchInput) searchInput.value = '';

    // Highlight active destination card above
    document.querySelectorAll('.city-card').forEach(card => {
      card.classList.toggle('active', card.getAttribute('data-city-id') === selectedCityFilter);
    });

    renderCityFilters();
    renderTours();
    updateHeroTourDropdown(cityId);
  };

  // When tour changes
  tourSelect.onchange = () => {
    const tourId = tourSelect.value;
    if (tourId) {
      selectHeroTour(tourId);
    }
  };

  // Go / View Tour button
  if (goBtn) {
    goBtn.onclick = () => {
      const tourId = tourSelect.value;
      if (tourId) {
        selectHeroTour(tourId);
      } else {
        const toursSec = document.getElementById('toursSection');
        if (toursSec) {
          const navHeight = document.querySelector('.header')?.offsetHeight || 80;
          const y = toursSec.getBoundingClientRect().top + window.pageYOffset - navHeight - 12;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }
      }
    };
  }
}

function updateHeroCityDropdown() {
  const citySelect = document.getElementById('heroCitySelect');
  if (!citySelect) return;

  const currentVal = citySelect.value || 'all';
  citySelect.innerHTML = `<option value="all">${t('choose_destination_placeholder')}</option>`;

  if (appData.cities && appData.cities.length) {
    appData.cities.forEach(city => {
      const cityName = city.names?.[currentLang] || city.names?.en || city.id;
      const opt = document.createElement('option');
      opt.value = city.id;
      opt.textContent = `📍 ${cityName}`;
      citySelect.appendChild(opt);
    });
  }
  citySelect.value = currentVal;
}

function updateHeroTourDropdown(cityId) {
  const tourSelect = document.getElementById('heroTourSelect');
  if (!tourSelect) return;

  const curr = appData.settings?.currency || '$';
  tourSelect.innerHTML = `<option value="">${t('choose_tour_placeholder')}</option>`;

  let list = appData.tours || [];
  if (cityId && cityId !== 'all') {
    list = list.filter(t => t.city_id === cityId);
  }

  list.forEach(tour => {
    const tourName = tour.names?.[currentLang] || tour.names?.en || 'Tour';
    const opt = document.createElement('option');
    opt.value = tour.id;
    opt.textContent = `${tourName} — ${curr}${tour.price}`;
    tourSelect.appendChild(opt);
  });
}

function selectHeroTour(tourId) {
  if (!tourId) return;
  const tour = appData.tours.find(t => String(t.id) === String(tourId));
  if (!tour) return;

  searchQuery = '';
  const searchInput = document.getElementById('tourSearchInput');
  if (searchInput) searchInput.value = '';

  if (selectedCityFilter !== tour.city_id) {
    selectedCityFilter = tour.city_id;
    document.querySelectorAll('.city-card').forEach(card => {
      card.classList.toggle('active', card.getAttribute('data-city-id') === tour.city_id);
    });
    const citySelect = document.getElementById('heroCitySelect');
    if (citySelect) {
      citySelect.value = tour.city_id;
      updateHeroTourDropdown(tour.city_id);
      const tourSelect = document.getElementById('heroTourSelect');
      if (tourSelect) tourSelect.value = String(tour.id);
    }
    renderCityFilters();
  }
  renderTours();

  setTimeout(() => {
    const card = document.querySelector(`.tour-card[data-tour-id="${tourId}"]`);
    if (card) {
      const navHeight = document.querySelector('.header')?.offsetHeight || 80;
      const y = card.getBoundingClientRect().top + window.pageYOffset - navHeight - 16;
      window.scrollTo({ top: y, behavior: 'smooth' });
      card.classList.add('highlight-pulse');
      setTimeout(() => card.classList.remove('highlight-pulse'), 3500);
    } else {
      const toursSec = document.getElementById('toursSection');
      if (toursSec) toursSec.scrollIntoView({ behavior: 'smooth' });
    }
  }, 120);
}

// Render Tours Grid
function renderTours() {
  const container = document.getElementById('toursContainer');
  if (!container) return;

  const curr = appData.settings?.currency || '$';

  let filtered = appData.tours.filter(t => {
    // Search query searches across all destinations/excursions
    if (searchQuery) {
      const name = (t.names?.[currentLang] || t.names?.en || '').toLowerCase();
      const desc = (t.descriptions?.[currentLang] || t.descriptions?.en || '').toLowerCase();
      const cityObj = appData.cities.find(c => c.id === t.city_id);
      const cityName = (cityObj?.names?.[currentLang] || cityObj?.names?.en || t.city_id || '').toLowerCase();
      return name.includes(searchQuery) || desc.includes(searchQuery) || cityName.includes(searchQuery);
    }
    // City filter (Hurghada by default)
    if (selectedCityFilter !== 'all' && t.city_id !== selectedCityFilter) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px solid var(--border-glass);">
        <p style="font-size: 1.2rem; color: var(--text-muted);">${t('no_tours_found')}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(tour => {
    const tourName = tour.names?.[currentLang] || tour.names?.en || 'Excursion';
    
    // Find city name
    const cityObj = appData.cities.find(c => c.id === tour.city_id);
    const cityName = cityObj ? (cityObj.names?.[currentLang] || cityObj.names?.en) : tour.city_id;

    const card = document.createElement('div');
    card.className = 'tour-card';
    card.setAttribute('data-tour-id', tour.id);
    card.id = `tour-${tour.id}`;
    card.innerHTML = `
      <div class="tour-thumb">
        <img src="${tour.image}" alt="${tourName}" loading="lazy" />
        <div class="tour-city-tag">📍 ${cityName}</div>
      </div>
      <div class="tour-body">
        <h3 class="tour-title">${tourName}</h3>
        <div class="tour-price-box">
          <div class="tour-price-val">${curr}${tour.price}</div>
          ${tour.price_child ? `<div class="tour-price-child">${t('child_price')}: ${curr}${tour.price_child}</div>` : ''}
        </div>
        <div class="tour-actions">
          <button class="btn-card-details" onclick="openDetailsModal(${tour.id})">
            ${t('btn_details')}
          </button>
          <button class="btn-card-whatsapp" onclick="openBookingModal(${tour.id})">
            <span>💬</span> ${t('btn_book_whatsapp')}
          </button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

// Open Tour Details Modal
function openDetailsModal(tourId) {
  const tour = appData.tours.find(t => t.id === tourId);
  if (!tour) return;

  const curr = appData.settings?.currency || '$';
  const tourName = tour.names?.[currentLang] || tour.names?.en || '';
  const tourDesc = tour.descriptions?.[currentLang] || tour.descriptions?.en || '';

  const cityObj = appData.cities.find(c => c.id === tour.city_id);
  const cityName = cityObj ? (cityObj.names?.[currentLang] || cityObj.names?.en) : tour.city_id;

  const modal = document.getElementById('detailsModal');
  const body = document.getElementById('detailsModalBody');

  const includedList = (tour.included?.[currentLang] || tour.included?.en || [])
    .map(item => `<li class="included-item">${item}</li>`).join('');

  body.innerHTML = `
    <div class="modal-gallery">
      <img src="${tour.image}" alt="${tourName}" />
    </div>
    <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px;">
      <div>
        <span style="color: var(--accent-cyan); font-weight: 700; font-size: 0.85rem;">📍 ${cityName} • ⏱ ${tour.duration || 'Full Day'}</span>
        <h2 style="font-family: var(--font-heading); font-size: 1.6rem; margin-top: 4px; color: #000000;">${tourName}</h2>
      </div>
      <div style="text-align: right;">
        <span style="font-size: 0.8rem; color: var(--text-muted);">${t('from_price')}</span>
        <div style="font-size: 1.8rem; font-weight: 800; color: var(--price-orange, #F97316);">${curr}${tour.price}</div>
      </div>
    </div>
    <div class="currency-trust-badge" style="margin-top: 0; margin-bottom: 20px;">
      <span class="currency-badge-icon">💳</span>
      <span>${t('payment_currencies')}</span>
    </div>
    <div style="margin-bottom: 24px;">
      <h4 style="font-size: 1.05rem; color: #000000; margin-bottom: 8px; font-weight: 700;">${t('modal_details_itinerary')}</h4>
      <p style="color: #000000; font-size: 0.95rem; line-height: 1.6;">${tourDesc}</p>
    </div>
    ${includedList ? `
      <div style="margin-bottom: 24px;">
        <h4 style="font-size: 1rem; color: var(--accent-cyan); margin-bottom: 8px; font-weight: 700;">${t('modal_details_included')}</h4>
        <ul class="included-list">${includedList}</ul>
      </div>
    ` : ''}
    <div style="margin-top: 30px; display: flex; gap: 14px;">
      <button class="btn-whatsapp-large" style="width: 100%; justify-content: center;" onclick="closeDetailsModal(); openBookingModal(${tour.id})">
        <span>💬</span> ${t('btn_book_whatsapp')}
      </button>
    </div>
  `;

  modal.classList.add('active');
}

function closeDetailsModal() {
  document.getElementById('detailsModal').classList.remove('active');
}

// Open Quick WhatsApp Booking Modal
function openBookingModal(tourId) {
  const tour = appData.tours.find(t => t.id === tourId);
  if (!tour) return;

  selectedBookingTour = tour;
  bookingAdults = 2;
  bookingChildren = 0;

  const tourName = tour.names?.[currentLang] || tour.names?.en || '';
  const cityObj = appData.cities.find(c => c.id === tour.city_id);
  const cityName = cityObj ? (cityObj.names?.[currentLang] || cityObj.names?.en) : tour.city_id;

  document.getElementById('bookingModalTourName').textContent = tourName;
  document.getElementById('bookingModalCity').textContent = `📍 ${cityName}`;

  updateBookingCounters();
  document.getElementById('bookingModal').classList.add('active');
}

function closeBookingModal() {
  document.getElementById('bookingModal').classList.remove('active');
}

function updateBookingCounters() {
  document.getElementById('adultCount').textContent = bookingAdults;
  document.getElementById('childCount').textContent = bookingChildren;

  if (selectedBookingTour) {
    const curr = appData.settings?.currency || '$';
    const adultPrice = selectedBookingTour.price || 0;
    const childPrice = selectedBookingTour.price_child || (adultPrice * 0.6);
    const total = (bookingAdults * adultPrice) + (bookingChildren * childPrice);

    document.getElementById('bookingEstimatedPrice').textContent = `${curr}${Math.round(total)}`;
  }
}

// Execute WhatsApp Booking with smart pre-filled message
async function executeWhatsAppBooking() {
  if (!selectedBookingTour) return;

  const tour = selectedBookingTour;
  const tourName = tour.names?.[currentLang] || tour.names?.en || '';
  const cityObj = appData.cities.find(c => c.id === tour.city_id);
  const cityName = cityObj ? (cityObj.names?.[currentLang] || cityObj.names?.en) : tour.city_id;

  const date = document.getElementById('bookingDate').value;
  const hotel = document.getElementById('bookingHotel').value.trim() || 'To be specified';
  const notes = document.getElementById('bookingNotes').value.trim();

  const curr = appData.settings?.currency || '$';
  const adultPrice = tour.price || 0;
  const childPrice = tour.price_child || (adultPrice * 0.6);
  const total = Math.round((bookingAdults * adultPrice) + (bookingChildren * childPrice));

  // Log to backend
  try {
    fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tour_id: tour.id,
        tour_name: tourName,
        city: cityName,
        date,
        adults: bookingAdults,
        children: bookingChildren,
        hotel,
        notes,
        lang: currentLang
      })
    });
  } catch (e) {
    console.error('Failed to log booking lead', e);
  }

  // Generate localized message for WhatsApp
  let msg = '';
  if (currentLang === 'ru') {
    msg = `Здравствуйте! Я хочу забронировать экскурсию:\n` +
          `🌴 Экскурсия: *${tourName}*\n` +
          `📍 Курорт: ${cityName}\n` +
          `📅 Дата: ${date}\n` +
          `👥 Гости: ${bookingAdults} взр. + ${bookingChildren} дет.\n` +
          `🏨 Отель: ${hotel}\n` +
          (notes ? `📝 Пожелания: ${notes}\n` : '') +
          `💰 Примерная сумма: ${curr}${total}\n\n` +
          `Подскажите, пожалуйста, во сколько будет выезд из отеля?`;
  } else if (currentLang === 'fr') {
    msg = `Bonjour! Je souhaite réserver l'excursion :\n` +
          `🌴 Excursion : *${tourName}*\n` +
          `📍 Ville : ${cityName}\n` +
          `📅 Date : ${date}\n` +
          `👥 Participants : ${bookingAdults} Adultes, ${bookingChildren} Enfants\n` +
          `🏨 Hôtel : ${hotel}\n` +
          (notes ? `📝 Remarques : ${notes}\n` : '') +
          `💰 Total estimé : ${curr}${total}\n\n` +
          `Pourriez-vous me confirmer l'heure de prise en charge à l'hôtel ?`;
  } else if (currentLang === 'pl') {
    msg = `Dzień dobry! Chciałbym zarezerwować wycieczkę:\n` +
          `🌴 Wycieczka: *${tourName}*\n` +
          `📍 Miasto: ${cityName}\n` +
          `📅 Data: ${date}\n` +
          `👥 Uczestnicy: ${bookingAdults} Dorosłych, ${bookingChildren} Dzieci\n` +
          `🏨 Hotel: ${hotel}\n` +
          (notes ? `📝 Uwagi: ${notes}\n` : '') +
          `💰 Szacowany koszt: ${curr}${total}\n\n` +
          `Proszę o informację o której godzinie odbiór z hotelu?`;
  } else {
    // English default
    msg = `Hello! I would like to book the excursion:\n` +
          `🌴 Tour: *${tourName}*\n` +
          `📍 City: ${cityName}\n` +
          `📅 Date: ${date}\n` +
          `👥 Guests: ${bookingAdults} Adults, ${bookingChildren} Children\n` +
          `🏨 Hotel: ${hotel}\n` +
          (notes ? `📝 Notes: ${notes}\n` : '') +
          `💰 Estimated Total: ${curr}${total}\n\n` +
          `Could you please confirm the hotel pickup time?`;
  }

  const waNum = appData.settings?.whatsapp_number || '201012345678';
  const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;

  closeBookingModal();
  window.open(waUrl, '_blank');
}

/* ==================== EGYPTIAN BAZAR & PRODUCTS MODULE ==================== */
function getBazarCategoryLabel(cat) {
  const map = {
    all: `✨ ${t('bazar_cat_all')}`,
    souvenirs: `🏺 ${t('bazar_cat_souvenirs')}`,
    perfumes: `🧴 ${t('bazar_cat_perfumes')}`,
    spices: `🌿 ${t('bazar_cat_spices')}`,
    crafts: `🗿 ${t('bazar_cat_crafts')}`,
    textiles: `🧣 ${t('bazar_cat_textiles')}`
  };
  return map[cat] || map.souvenirs;
}

function renderBazarFilters() {
  const container = document.getElementById('bazarFiltersContainer');
  if (!container) return;

  const products = appData.products || [];
  const activeCats = ['all'];
  ['souvenirs', 'perfumes', 'crafts', 'spices', 'textiles'].forEach(cat => {
    if (products.some(p => p.category === cat)) {
      activeCats.push(cat);
    }
  });

  if (!activeCats.includes(selectedBazarCategory)) {
    selectedBazarCategory = 'all';
  }

  container.innerHTML = '';
  activeCats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `filter-pill ${selectedBazarCategory === cat ? 'active' : ''}`;
    btn.onclick = () => {
      selectedBazarCategory = cat;
      bazarSearchQuery = '';
      const inp = document.getElementById('bazarSearchInput');
      if (inp) inp.value = '';
      renderBazarFilters();
      renderBazarProducts();
    };
    btn.textContent = getBazarCategoryLabel(cat);
    container.appendChild(btn);
  });
}

function renderBazarProducts() {
  const container = document.getElementById('bazarContainer');
  if (!container) return;

  const curr = appData.settings?.currency || '$';
  const products = appData.products || [];

  const filtered = products.filter(p => {
    if (bazarSearchQuery) {
      const name = (p.names?.[currentLang] || p.names?.en || '').toLowerCase();
      const desc = (p.descriptions?.[currentLang] || p.descriptions?.en || '').toLowerCase();
      const specsText = (p.specs?.[currentLang] || p.specs?.en || []).join(' ').toLowerCase();
      const catLabel = getBazarCategoryLabel(p.category).toLowerCase();
      return name.includes(bazarSearchQuery) || desc.includes(bazarSearchQuery) || specsText.includes(bazarSearchQuery) || catLabel.includes(bazarSearchQuery);
    }
    if (selectedBazarCategory !== 'all' && p.category !== selectedBazarCategory) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px solid var(--border-light);">
        <p style="font-size: 1.15rem; color: var(--text-muted);">${t('bazar_empty')}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(product => {
    const prodName = escapeHtml(product.names?.[currentLang] || product.names?.en || 'Gift Item');
    const specsArr = product.specs?.[currentLang] || product.specs?.en || [];
    const specsHtml = specsArr.slice(0, 4).map(spec => `
      <li><span class="bazar-spec-dot">•</span><span>${escapeHtml(spec)}</span></li>
    `).join('');

    const card = document.createElement('div');
    card.className = 'bazar-card';
    card.setAttribute('data-product-id', product.id);
    card.id = `bazar-item-${product.id}`;
    card.innerHTML = `
      <div class="bazar-thumb">
        <img src="${escapeHtml(product.image)}" alt="${prodName}" loading="lazy" />
        ${product.featured ? `<div class="bazar-featured-badge">★ ${t('badge_popular')}</div>` : ''}
        <div class="bazar-cat-tag">${getBazarCategoryLabel(product.category)}</div>
      </div>
      <div class="bazar-body">
        <h3 class="bazar-title">${prodName}</h3>
        ${specsHtml ? `<ul class="bazar-specs-list">${specsHtml}</ul>` : ''}
        <div class="bazar-price-box">
          <div class="bazar-price-val">${curr}${product.price}</div>
        </div>
        <div class="tour-actions">
          <button class="btn-card-details" onclick="openProductDetailsModal(${product.id})">
            ${t('bazar_btn_specs')}
          </button>
          <button class="btn-card-whatsapp" onclick="openBazarOrderModal(${product.id})">
            <span>💬</span> ${t('bazar_btn_order')}
          </button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function openProductDetailsModal(productId) {
  const product = (appData.products || []).find(p => String(p.id) === String(productId));
  if (!product) return;

  const curr = appData.settings?.currency || '$';
  const prodName = escapeHtml(product.names?.[currentLang] || product.names?.en || '');
  const prodDesc = escapeHtml(product.descriptions?.[currentLang] || product.descriptions?.en || '');
  const specsArr = product.specs?.[currentLang] || product.specs?.en || [];

  const specsModalHtml = specsArr.map(item => `
    <li class="bazar-specs-modal-item">
      <span style="color: var(--accent-cyan); font-weight: 800;">✓</span>
      <span>${escapeHtml(item)}</span>
    </li>
  `).join('');

  const modal = document.getElementById('detailsModal');
  const body = document.getElementById('detailsModalBody');

  body.innerHTML = `
    <div class="modal-gallery">
      <img src="${escapeHtml(product.image)}" alt="${prodName}" />
    </div>
    <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 16px; gap: 16px;">
      <div>
        <span style="color: var(--accent-cyan); font-weight: 700; font-size: 0.85rem;">${getBazarCategoryLabel(product.category)}</span>
        <h2 style="font-family: var(--font-heading); font-size: 1.55rem; margin-top: 4px; color: #000000;">${prodName}</h2>
      </div>
      <div style="text-align: right; flex-shrink: 0;">
        <div style="font-size: 1.9rem; font-weight: 800; color: var(--price-orange, #F97316);">${curr}${product.price}</div>
      </div>
    </div>
    <div class="currency-trust-badge" style="margin-top: 0; margin-bottom: 20px;">
      <span class="currency-badge-icon">💳</span>
      <span>${t('payment_currencies')}</span>
    </div>
    ${prodDesc ? `
      <div style="margin-bottom: 22px;">
        <p style="color: #000000; font-size: 0.95rem; line-height: 1.6;">${prodDesc}</p>
      </div>
    ` : ''}
    ${specsModalHtml ? `
      <div style="margin-bottom: 24px;">
        <h4 style="font-size: 1rem; color: var(--accent-cyan); margin-bottom: 10px; font-weight: 700;">📋 ${t('bazar_specs_label')}</h4>
        <ul class="bazar-specs-modal-list">${specsModalHtml}</ul>
      </div>
    ` : ''}
    <div style="margin-top: 28px;">
      <button class="btn-whatsapp-large" style="width: 100%; justify-content: center;" onclick="closeDetailsModal(); openBazarOrderModal(${product.id})">
        <span>💬</span> ${t('bazar_btn_order')}
      </button>
    </div>
  `;

  modal.classList.add('active');
}

function openBazarOrderModal(productId) {
  const product = (appData.products || []).find(p => String(p.id) === String(productId));
  if (!product) return;

  selectedOrderProduct = product;
  bazarOrderQty = 1;

  const prodName = product.names?.[currentLang] || product.names?.en || '';
  document.getElementById('bazarOrderProductName').textContent = prodName;
  document.getElementById('bazarOrderProductCategory').textContent = getBazarCategoryLabel(product.category);

  updateBazarOrderCounter();
  document.getElementById('bazarOrderModal').classList.add('active');
}

function closeBazarOrderModal() {
  const modal = document.getElementById('bazarOrderModal');
  if (modal) modal.classList.remove('active');
}

function updateBazarOrderCounter() {
  const countEl = document.getElementById('bazarQtyCount');
  if (countEl) countEl.textContent = bazarOrderQty;

  if (selectedOrderProduct) {
    const curr = appData.settings?.currency || '$';
    const total = (Number(selectedOrderProduct.price) || 0) * bazarOrderQty;
    const totalEl = document.getElementById('bazarEstimatedPrice');
    if (totalEl) totalEl.textContent = `${curr}${Math.round(total)}`;
  }
}

async function executeBazarWhatsAppOrder() {
  if (!selectedOrderProduct) return;

  const product = selectedOrderProduct;
  const prodName = product.names?.[currentLang] || product.names?.en || '';
  const hotel = document.getElementById('bazarHotel').value.trim() || 'To be specified';
  const notes = document.getElementById('bazarNotes').value.trim();

  const curr = appData.settings?.currency || '$';
  const total = Math.round((Number(product.price) || 0) * bazarOrderQty);

  try {
    fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tour_id: `BAZAR-${product.id}`,
        tour_name: `[Bazar] ${prodName}`,
        city: 'Bazar Gift Shop',
        date: new Date().toISOString().split('T')[0],
        adults: bazarOrderQty,
        children: 0,
        hotel,
        notes,
        lang: currentLang
      })
    });
  } catch (e) {
    console.error('Failed to log Bazar order lead', e);
  }

  let msg = '';
  if (currentLang === 'ru') {
    msg = `Здравствуйте! Я хочу заказать товар из Базара:\n` +
          `🛍️ Товар: *${prodName}*\n` +
          `📦 Количество: ${bazarOrderQty} шт.\n` +
          `🏨 Отель: ${hotel}\n` +
          (notes ? `📝 Пожелания: ${notes}\n` : '') +
          `💰 Примерная сумма: ${curr}${total}\n\n` +
          `Подскажите, пожалуйста, когда возможна доставка в отель?`;
  } else if (currentLang === 'fr') {
    msg = `Bonjour ! Je souhaite commander un article du Bazar :\n` +
          `🛍️ Produit : *${prodName}*\n` +
          `📦 Quantité : ${bazarOrderQty}\n` +
          `🏨 Hôtel : ${hotel}\n` +
          (notes ? `📝 Remarques : ${notes}\n` : '') +
          `💰 Total estimé : ${curr}${total}\n\n` +
          `Pourriez-vous me confirmer la livraison à l'hôtel ?`;
  } else if (currentLang === 'pl') {
    msg = `Dzień dobry! Chciałbym zamówić produkt z Bazaru:\n` +
          `🛍️ Produkt: *${prodName}*\n` +
          `📦 Ilość: ${bazarOrderQty} szt.\n` +
          `🏨 Hotel: ${hotel}\n` +
          (notes ? `📝 Uwagi: ${notes}\n` : '') +
          `💰 Szacowany koszt: ${curr}${total}\n\n` +
          `Proszę o informację dotyczącą dostawy do hotelu.`;
  } else {
    msg = `Hello! I would like to order from Egyptian Bazar:\n` +
          `🛍️ Product: *${prodName}*\n` +
          `📦 Quantity: ${bazarOrderQty}\n` +
          `🏨 Hotel: ${hotel}\n` +
          (notes ? `📝 Notes: ${notes}\n` : '') +
          `💰 Estimated Total: ${curr}${total}\n\n` +
          `Could you please confirm delivery to my hotel?`;
  }

  const waNum = appData.settings?.whatsapp_number || '201012345678';
  const waUrl = `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;

  closeBazarOrderModal();
  window.open(waUrl, '_blank');
}

/* ==================== REVIEWS MODULE ==================== */
let selectedReviewRating = 5;

const RATING_DESCRIPTIONS = {
  en: { 1: '1/5 - Poor', 2: '2/5 - Fair', 3: '3/5 - Good', 4: '4/5 - Very Good', 5: '5/5 - Outstanding!' },
  ru: { 1: '1/5 - Плохо', 2: '2/5 - Нормально', 3: '3/5 - Хорошо', 4: '4/5 - Очень хорошо', 5: '5/5 - Великолепно!' },
  fr: { 1: '1/5 - Décevant', 2: '2/5 - Passable', 3: '3/5 - Bien', 4: '4/5 - Très bien', 5: '5/5 - Exceptionnel !' },
  pl: { 1: '1/5 - Słabo', 2: '2/5 - Przeciętnie', 3: '3/5 - Dobrze', 4: '4/5 - Bardzo dobrze', 5: '5/5 - Znakomicie!' }
};

function initStarRatingWidget() {
  const stars = document.querySelectorAll('.star-btn');
  const textEl = document.getElementById('starRatingText');
  const inputEl = document.getElementById('reviewRatingInput');

  function updateStars(val) {
    stars.forEach(s => {
      const sVal = parseInt(s.getAttribute('data-value'));
      if (sVal <= val) {
        s.classList.add('active');
      } else {
        s.classList.remove('active');
      }
    });
    if (textEl) {
      const descObj = RATING_DESCRIPTIONS[currentLang] || RATING_DESCRIPTIONS.en;
      textEl.textContent = descObj[val] || `${val} / 5`;
    }
    if (inputEl) inputEl.value = val;
  }

  stars.forEach(s => {
    const val = parseInt(s.getAttribute('data-value'));
    s.addEventListener('mouseenter', () => updateStars(val));
    s.addEventListener('mouseleave', () => updateStars(selectedReviewRating));
    s.addEventListener('click', () => {
      selectedReviewRating = val;
      updateStars(val);
    });
  });

  updateStars(selectedReviewRating);
}

function renderReviews() {
  const container = document.getElementById('reviewsGrid');
  if (!container) return;

  const reviews = appData.reviews || [];
  container.innerHTML = '';

  if (reviews.length === 0) {
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">${t('reviews_empty') || 'No reviews yet. Be the first to write a review!'}</div>`;
    return;
  }

  // Calculate average rating
  const avg = (reviews.reduce((sum, r) => sum + (Number(r.rating) || 5), 0) / reviews.length).toFixed(1);
  const bigNumEl = document.querySelector('.reviews-big-number');
  if (bigNumEl) bigNumEl.textContent = avg;

  reviews.forEach(review => {
    const card = document.createElement('div');
    card.className = 'review-card';

    // User initials for avatar
    const initials = (review.name || 'G')
      .split(' ')
      .map(part => part[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();

    const starCount = Math.max(1, Math.min(5, parseInt(review.rating) || 5));
    const starsHtml = '★'.repeat(starCount) + '☆'.repeat(5 - starCount);

    card.innerHTML = `
      <div class="review-card-top">
        <div class="review-user-info">
          <div class="review-avatar">${initials}</div>
          <div>
            <div class="review-name">${escapeHtml(review.name)}</div>
            <div class="review-country">${escapeHtml(review.country || 'Verified Traveler')}</div>
          </div>
        </div>
        <div class="review-badge-verified">
          ✓ <span>${t('reviews_verified') || 'Verified Guest'}</span>
        </div>
      </div>
      <div class="review-stars">${starsHtml}</div>
      ${review.tour ? `<div class="review-tour-tag">📍 ${escapeHtml(review.tour)}</div>` : ''}
      <p class="review-text">"${escapeHtml(review.comment)}"</p>
      <div class="review-date">🗓 ${review.date || 'Recent'}</div>
    `;
    container.appendChild(card);
  });
}

function openReviewModal() {
  const modal = document.getElementById('reviewModal');
  if (!modal) return;

  // Populate datalist with tours
  const dataList = document.getElementById('toursDataList');
  if (dataList && appData.tours) {
    dataList.innerHTML = appData.tours
      .map(tour => {
        const name = tour.names?.[currentLang] || tour.names?.en || '';
        return `<option value="${name}">`;
      })
      .join('');
  }

  // Reset star widget
  selectedReviewRating = 5;
  const inputEl = document.getElementById('reviewRatingInput');
  if (inputEl) inputEl.value = '5';
  const textEl = document.getElementById('starRatingText');
  if (textEl) {
    const descObj = RATING_DESCRIPTIONS[currentLang] || RATING_DESCRIPTIONS.en;
    textEl.textContent = descObj[5];
  }
  document.querySelectorAll('.star-btn').forEach(s => s.classList.add('active'));

  const alert = document.getElementById('reviewSuccessAlert');
  if (alert) alert.style.display = 'none';

  modal.classList.add('active');
}

function closeReviewModal() {
  const modal = document.getElementById('reviewModal');
  if (modal) modal.classList.remove('active');
}

async function handleReviewSubmit(e) {
  e.preventDefault();

  const name = document.getElementById('reviewAuthorName').value.trim();
  const country = document.getElementById('reviewAuthorCountry').value.trim();
  const tour = document.getElementById('reviewTourName').value.trim();
  const comment = document.getElementById('reviewCommentText').value.trim();
  const rating = parseInt(document.getElementById('reviewRatingInput').value) || selectedReviewRating || 5;

  if (!name || !comment) return;

  const btn = document.getElementById('reviewSubmitBtn');
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.7';
  }

  try {
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, country, tour, comment, rating })
    });
    const result = await res.json();
    if (result.success) {
      if (result.review && result.review.approved) {
        if (!appData.reviews) appData.reviews = [];
        appData.reviews.unshift(result.review);
        renderReviews();
      }

      const alert = document.getElementById('reviewSuccessAlert');
      if (alert) alert.style.display = 'block';

      setTimeout(() => {
        closeReviewModal();
        document.getElementById('addReviewForm').reset();
        if (alert) alert.style.display = 'none';
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '1';
        }
      }, 2500);
    }
  } catch (err) {
    console.error('Error posting review:', err);
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Sync settings in real time across browser tabs
window.addEventListener('storage', (e) => {
  if (e.key === 'sphinxtour_custom_settings' && e.newValue) {
    try {
      const parsed = JSON.parse(e.newValue);
      appData.settings = { ...(appData.settings || {}), ...parsed };
      updateSiteSettings();
    } catch (err) {}
  }
});
