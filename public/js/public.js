/**
 * NCST GadgetGuard Public Website Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI();
  loadPublicStats();
  loadMissingBoard();
  loadOsaSettings();
  initPublicNavScrollSpy();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('requireLogin') === 'true' || urlParams.get('login') === '1') {
    const user = api.getCurrentUser();
    if (user && user.role !== 'osa_admin') {
      const redirect = urlParams.get('redirect') || '/student/';
      window.location.href = redirect;
      return;
    }
    openLoginModal();
    showToast('info', 'Sign In Required', 'Please log in with your NCST Student ID or Email.');
  }

  // Direct anchor navigation for OSA surrender drop-off instructions
  const hash = window.location.hash;
  if (hash === '#osa-surrender' || hash === '#contact') {
    setTimeout(() => {
      const target = document.getElementById('osa-surrender') || document.getElementById('contact');
      if (target) {
        const navHeader = document.querySelector('.public-nav');
        const navHeight = navHeader ? navHeader.offsetHeight : 70;
        const targetTop = target.getBoundingClientRect().top + window.pageYOffset - navHeight - 10;
        window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
      }
    }, 150);
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
        <a href="${isOsa ? '/osa/' : '/student/'}" class="btn-nav-student-login" style="padding:7px 16px; text-decoration:none; display:inline-flex; align-items:center; gap:6px;">
          ${isOsa ? '<svg class="ui-icon" style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Admin Console' : '<svg class="ui-icon" style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>Student Portal'}
        </a>
        <button class="btn btn-secondary btn-sm" onclick="logoutCurrentSession()" style="padding:7px 12px; border-radius:8px;">Sign Out</button>
      </div>
    `;
  } else {
    navContainer.innerHTML = `
      <button class="btn-nav-student-login" onclick="openLoginModal()" style="display:inline-flex; align-items:center; gap:6px;">
        <svg class="ui-icon" style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Student Login
      </button>
    `;
  }
}

function handleStudentPortalClick() {
  const user = api.getCurrentUser();
  if (user) {
    window.location.href = user.role === 'osa_admin' ? '/osa/' : '/student/';
  } else {
    openLoginModal();
  }
}

function handleReportMissingClick() {
  const user = api.getCurrentUser();
  if (user) {
    window.location.href = '/student/#missing';
  } else {
    openLoginModal();
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
          <div style="display:flex; justify-content:center; margin-bottom: 8px;">
            <svg class="ui-icon" style="width:36px;height:36px;color:#10b981;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <h3 style="font-weight: 700; color: #0f172a;">No Missing Gadgets Currently Reported!</h3>
          <p class="text-muted" style="font-size: 0.85rem; margin-top: 4px;">All registered gadgets on campus are currently safe with their owners.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = res.reports.map(report => {
      const effectivePhoto = typeof getEffectiveGadgetPhoto === 'function' 
        ? getEffectiveGadgetPhoto(report.gadget?.photoUrl) 
        : (window.getEffectiveGadgetPhoto ? window.getEffectiveGadgetPhoto(report.gadget?.photoUrl) : (report.gadget?.photoUrl && report.gadget?.photoUrl.trim() ? report.gadget?.photoUrl.trim() : null));

      return `
      <div class="missing-card">
        ${effectivePhoto ? `
          <img src="${escapeHtml(effectivePhoto)}" alt="${escapeHtml(report.gadget?.model || 'Device')}" class="missing-img">
        ` : `
          <div class="missing-img" style="background: linear-gradient(135deg, #f8fafc 0%, #edf2f7 100%); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #64748b; border-bottom: 1px solid #e2e8f0;">
            <svg class="ui-icon" style="width:28px;height:28px;color:#94a3b8;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            <span style="font-size: 0.72rem; font-weight: 700; color: #475569;">No Photo Uploaded</span>
          </div>
        `}
        <div class="missing-body">
          <div class="missing-meta">
            <span class="status-badge MISSING">MISSING</span>
            <span style="font-size: 0.75rem; color: #94a3b8;">${formatDate(report.lastSeenDate)}</span>
          </div>
          <h4 style="font-weight: 700; font-size: 1rem; margin-bottom: 4px;">
            ${escapeHtml(report.gadget?.brand)} ${escapeHtml(report.gadget?.model)}
          </h4>
          <div style="font-size: 0.8rem; color: #dc2626; font-weight: 600; margin-bottom: 8px; display:inline-flex; align-items:center; gap:4px;">
            <svg class="ui-icon" style="width:13px;height:13px;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>Last Seen: ${escapeHtml(report.lastSeenLocation)}
          </div>
          <p style="font-size: 0.8rem; color: var(--text-muted); line-line: 1.4; margin-bottom: 12px;">
            "${escapeHtml(report.details || 'No special notes provided.')}"
          </p>
          <div style="display: flex; gap: 8px;">
            <a href="/device/${report.gadget?.secureToken || ''}" class="btn btn-warning btn-sm" style="flex:1;">
              Found This? Scan / Report
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
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
  openLoginModal();
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('active');
}

function openForgotPasswordModal() {
  closeModal('login-modal');
  const modal = document.getElementById('forgot-password-modal');
  if (modal) {
    modal.classList.add('active');
    const input = document.getElementById('forgot-email');
    if (input) {
      const loginEmail = document.getElementById('login-email');
      if (loginEmail && loginEmail.value.trim()) {
        input.value = loginEmail.value.trim();
      }
      setTimeout(() => input.focus(), 100);
    }
  }
}

async function handleForgotPasswordSubmit(e) {
  e.preventDefault();
  const emailInput = document.getElementById('forgot-email');
  if (!emailInput) return;
  const email = emailInput.value.trim();

  if (!email) {
    await SwalHelper.warning('Email Required', 'Please enter your registered NCST school email address or Student ID.');
    return;
  }

  const submitBtn = document.getElementById('btn-submit-forgot');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing Password Reset Request...';
  }

  try {
    const res = await api.forgotPassword(email);
    closeModal('forgot-password-modal');
    await SwalHelper.info(
      'Password Reset Request',
      res.message || 'If an active account with that email exists, password reset instructions have been recorded.',
      4000
    );
    emailInput.value = '';
  } catch (err) {
    await SwalHelper.error('Request Failed', err.message || 'Could not process password reset request.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<svg class="ui-icon" style="width:14px;height:14px;margin-right:6px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Request Password Reset';
    }
  }
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
      const redirectUrl = new URLSearchParams(window.location.search).get('redirect');
      if (redirectUrl && (redirectUrl.startsWith('/student') || redirectUrl.startsWith('/osa'))) {
        window.location.href = redirectUrl;
      } else if (res.user.role === 'osa_admin') {
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

/**
 * Public Website Navigation Scroll Spy & Active Indicator Controller
 */
function initPublicNavScrollSpy() {
  const navMenu = document.querySelector('.nav-menu');
  if (!navMenu) return;

  const navLinks = Array.from(navMenu.querySelectorAll('.nav-link'));
  if (navLinks.length === 0) return;

  // Collect target sections
  const sections = [];
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.startsWith('#')) {
      const targetId = href.substring(1);
      const targetEl = document.getElementById(targetId);
      if (targetEl) {
        sections.push({ id: targetId, el: targetEl, link: link });
      }
    }
  });

  if (sections.length === 0) return;

  let isManualClickScrolling = false;
  let clickScrollTimer = null;

  function setActive(activeId) {
    sections.forEach(({ id, link }) => {
      if (id === activeId) {
        if (!link.classList.contains('active')) {
          link.classList.add('active');
        }
      } else {
        link.classList.remove('active');
      }
    });
  }

  // Smooth click navigation
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (!href || !href.startsWith('#')) return;

      const targetId = href.substring(1);
      const targetSection = document.getElementById(targetId);
      if (!targetSection) return;

      e.preventDefault();
      setActive(targetId);

      isManualClickScrolling = true;
      if (clickScrollTimer) clearTimeout(clickScrollTimer);

      if (window.history && window.history.pushState) {
        window.history.pushState(null, null, href);
      } else {
        window.location.hash = href;
      }

      const navHeader = document.querySelector('.public-nav');
      const navHeight = navHeader ? navHeader.offsetHeight : 70;
      const targetTop = targetSection.getBoundingClientRect().top + window.pageYOffset - navHeight;

      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth'
      });

      clickScrollTimer = setTimeout(() => {
        isManualClickScrolling = false;
      }, 750);
    });
  });

  // Scroll spy with requestAnimationFrame throttling
  let ticking = false;

  function onWindowScroll() {
    if (isManualClickScrolling) return;
    if (!ticking) {
      window.requestAnimationFrame(() => {
        updateActiveFromScroll();
        ticking = false;
      });
      ticking = true;
    }
  }

  function updateActiveFromScroll() {
    if (isManualClickScrolling) return;

    const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    const windowHeight = window.innerHeight;
    const docHeight = document.documentElement.scrollHeight;

    // Bottom of the page check -> activate last section
    if (scrollY + windowHeight >= docHeight - 40) {
      const last = sections[sections.length - 1];
      if (last) {
        setActive(last.id);
        return;
      }
    }

    const navHeader = document.querySelector('.public-nav');
    const navHeight = navHeader ? navHeader.offsetHeight : 70;
    // Section trigger threshold: nav height + 80px offset
    const triggerOffset = navHeight + 80;

    let currentId = sections[0].id;
    for (let i = 0; i < sections.length; i++) {
      const { id, el } = sections[i];
      const rect = el.getBoundingClientRect();
      if (rect.top <= triggerOffset) {
        currentId = id;
      }
    }

    setActive(currentId);
  }

  window.addEventListener('scroll', onWindowScroll, { passive: true });

  // Handle browser back/forward and hash changes
  window.addEventListener('popstate', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash && sections.some(s => s.id === hash)) {
      setActive(hash);
    } else {
      updateActiveFromScroll();
    }
  });

  // Initial active resolution on page load
  const initialHash = window.location.hash.replace('#', '');
  if (initialHash && sections.some(s => s.id === initialHash)) {
    setActive(initialHash);
  } else {
    updateActiveFromScroll();
  }
}

