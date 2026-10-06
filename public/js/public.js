/**
 * NCST GadgetGuard Public Website Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI();
  loadPublicStats();
  loadMissingBoard();
  loadOsaSettings();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('requireLogin') === 'true' || urlParams.get('login') === '1') {
    openLoginModal();
    showToast('info', 'Sign In Required', 'Please log in with your NCST Student ID or Email.');
  }

  // Re-fetch on live server events
  onLiveEvent((evt) => {
    loadPublicStats();
    loadMissingBoard();
  });
});

function updateAuthUI() {
  const user = api.getCurrentUser();
  const navContainer = document.getElementById('nav-auth-actions');
  if (!navContainer) return;

  if (user) {
    const isOsa = user.role === 'osa_admin';
    navContainer.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:0.875rem; color:#334155; font-weight:500;">
          Hi, <strong style="color:#142a6d;">${escapeHtml(user.name.split(' ')[0])}</strong>
        </span>
        <a href="${isOsa ? '/osa/' : '/student/'}" class="btn btn-primary btn-sm" style="display:flex; align-items:center; gap:6px; padding:7px 14px; border-radius:8px; font-weight:700;">
          ${isOsa ? '🏢 OSA Console' : '📱 Student Portal'}
        </a>
        <button class="btn btn-secondary btn-sm" onclick="logoutCurrentSession()" style="padding:7px 12px; border-radius:8px;">Sign Out</button>
      </div>
    `;
  } else {
    navContainer.innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="openLoginModal()" style="display:flex; align-items:center; gap:6px; padding:8px 18px; border-radius:8px; font-weight:700;">
        <span>🔐</span> Student Login
      </button>
      <a href="/osa/login.html" class="btn btn-secondary btn-sm" style="padding:8px 14px; border-radius:8px; font-weight:600;">OSA Portal</a>
    `;
  }
}

async function loadPublicStats() {
  try {
    const res = await fetch('/api/stats/public');
    const data = await res.json();
    if (!data.success) return;

    const s = data.stats || {};
    
    const missingEl = document.getElementById('stat-missing-count');
    if (missingEl) {
      missingEl.textContent = s.activeMissingCases !== undefined ? s.activeMissingCases : '0';
    }

    const regEl = document.getElementById('stat-registered-count');
    if (regEl) regEl.textContent = s.registeredGadgets !== undefined ? s.registeredGadgets : '0';

    const retEl = document.getElementById('stat-returned-count');
    if (retEl) retEl.textContent = s.totalReturns !== undefined ? s.totalReturns : '0';

    const userEl = document.getElementById('stat-users-count');
    if (userEl) userEl.textContent = s.totalUsers !== undefined ? s.totalUsers : '0';
  } catch (err) {
    console.warn('Could not load public stats:', err);
  }
}

async function loadMissingBoard() {
  const container = document.getElementById('public-missing-list');
  if (!container) return;

  try {
    const res = await api.getActiveMissing();
    if (!res.reports || res.reports.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 40px; background: rgba(0,0,0,0.03); border: 1px dashed #cbd5e1; border-radius: var(--radius-lg);">
          <div style="font-size: 2rem; margin-bottom: 8px;">🎉</div>
          <h3 style="font-weight: 700; color: #0f172a;">No Missing Gadgets Currently Reported!</h3>
          <p class="text-muted" style="font-size: 0.85rem; margin-top: 4px;">All registered gadgets on campus are currently safe with their owners.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = res.reports.map(report => `
      <div class="missing-card">
        <img src="${report.gadget?.photoUrl || 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500'}" alt="${escapeHtml(report.gadget?.model)}" class="missing-img">
        <div class="missing-body">
          <div class="missing-meta">
            <span class="status-badge MISSING">MISSING</span>
            <span style="font-size: 0.75rem; color: #94a3b8;">${formatDate(report.lastSeenDate)}</span>
          </div>
          <h4 style="font-weight: 700; font-size: 1rem; margin-bottom: 4px;">
            ${escapeHtml(report.gadget?.brand)} ${escapeHtml(report.gadget?.model)}
          </h4>
          <div style="font-size: 0.8rem; color: #dc2626; font-weight: 600; margin-bottom: 8px;">
            📍 Last Seen: ${escapeHtml(report.lastSeenLocation)}
          </div>
          <p style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.4; margin-bottom: 12px;">
            "${escapeHtml(report.details || 'No special notes provided.')}"
          </p>
          <div style="display: flex; gap: 8px;">
            <a href="/device/${report.gadget?.secureToken || ''}" class="btn btn-warning btn-sm" style="flex:1;">
              Found This? Scan / Report
            </a>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div style="grid-column:1/-1; color:#f87171; text-align:center;">Failed to load missing board.</div>`;
  }
}

async function loadOsaSettings() {
  try {
    const res = await api.getSettings();
    if (res.success && res.settings) {
      const loc = document.getElementById('contact-location');
      const hours = document.getElementById('contact-hours');
      const phone = document.getElementById('contact-phone');

      if (loc) loc.textContent = res.settings.osaOfficeLocation;
      if (hours) hours.textContent = res.settings.operatingHours;
      if (phone) phone.textContent = res.settings.osaContactPhone;
    }
  } catch (err) {
    // Ignore
  }
}

// Modal Handlers
function openLoginModal() {
  const modal = document.getElementById('login-modal');
  if (modal) modal.classList.add('active');
}

function openRegisterModal() {
  // Direct to login modal as student self-registration is replaced by SIS pre-provisioning
  openLoginModal();
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('active');
}

async function quickFillLogin(identifier, password) {
  const emailInput = document.getElementById('login-email');
  const passInput = document.getElementById('login-password');
  if (emailInput) emailInput.value = identifier;
  if (passInput) passInput.value = password;
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    await SwalHelper.warning('Missing Credentials', 'Please enter both your Student ID / Email and password.');
    return;
  }

  try {
    const res = await api.login(email, password);
    closeModal('login-modal');
    updateAuthUI();
    await SwalHelper.success('Welcome Back!', `Logged in as ${res.user.name}`, 1200);

    setTimeout(() => {
      if (res.user.role === 'osa_admin') {
        window.location.href = '/osa/';
      } else {
        window.location.href = '/student/';
      }
    }, 400);
  } catch (err) {
    await SwalHelper.error('Login Failed', err.message || 'Invalid Student ID / Email or password.');
  }
}

async function logoutCurrentSession() {
  api.logout();
  updateAuthUI();
  await SwalHelper.success('Signed Out', 'You have been safely signed out.', 1200);
}
