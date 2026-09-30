/**
 * GadgetGuard Public Website (Site 1) Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI();
  loadPublicStats();
  loadMissingBoard();
  loadOsaSettings();

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('requireLogin') === 'true') {
    openLoginModal();
    showToast('info', 'Sign In Required', 'Please log in to your active account.');
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
      <div style="display:flex; align-items:center; gap:12px;">
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
      <button class="btn btn-secondary btn-sm" onclick="openLoginModal()" style="padding:7px 16px; border-radius:8px; font-weight:600;">Login</button>
      <button class="btn btn-primary btn-sm" onclick="openRegisterModal()" style="padding:7px 16px; border-radius:8px; font-weight:700;">Create Account</button>
    `;
  }
}

async function loadPublicStats() {
  try {
    const res = await fetch('/api/stats/public');
    const data = await res.json();
    if (!data.success) return;

    const s = data.stats || {};
    
    // Set public stats
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
        <div style="grid-column: 1/-1; text-align: center; padding: 40px; background: rgba(0,0,0,0.2); border-radius: var(--radius-lg);">
          <div style="font-size: 2rem; margin-bottom: 8px;">🎉</div>
          <h3 style="font-weight: 700;">No Missing Gadgets Currently Reported!</h3>
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
          <div style="font-size: 0.8rem; color: #fca5a5; margin-bottom: 8px;">
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
  document.getElementById('login-modal').classList.add('active');
}

function openRegisterModal() {
  document.getElementById('register-modal').classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

async function quickFillLogin(email, password) {
  document.getElementById('login-email').value = email;
  document.getElementById('login-password').value = password;
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    await SwalHelper.warning('Missing Credentials', 'Please enter both your active email address and password.');
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
    await SwalHelper.error('Login Failed', err.message || 'Invalid email or password.');
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const firstName = document.getElementById('reg-firstname')?.value.trim() || '';
  const lastName = document.getElementById('reg-lastname')?.value.trim() || '';
  const name = `${firstName} ${lastName}`.trim();

  const email = document.getElementById('reg-email').value.trim();
  const idNumber = document.getElementById('reg-id').value.trim();
  const educationLevel = document.getElementById('reg-level')?.value || 'College';
  
  let academicSubfield = '';
  const academicSelect = document.getElementById('reg-academic-select');
  if (academicSelect) {
    academicSubfield = academicSelect.value.trim();
  }
  const department = `${educationLevel} - ${academicSubfield}`;

  const contactNumber = document.getElementById('reg-contact').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirmPassword = document.getElementById('reg-confirm-password')?.value;

  // Name validation
  const nameRegex = /^[a-zA-ZñÑ\s\.\,\-]+$/;
  if (!firstName || !lastName || !nameRegex.test(firstName) || !nameRegex.test(lastName)) {
    await SwalHelper.warning('Invalid Name', 'First name and surname must contain letters only.');
    return;
  }

  // Contact validation
  let cleanContact = contactNumber.replace(/\D/g, '');
  if (cleanContact.startsWith('63') && cleanContact.length === 12) {
    cleanContact = '0' + cleanContact.substring(2);
  }
  if (cleanContact.length !== 11 || !cleanContact.startsWith('09')) {
    await SwalHelper.warning('Invalid Contact', 'Contact number must be exactly 11 digits starting with 09 (e.g. 09123456789 or +63 912 345 6789).');
    return;
  }

  if (password !== confirmPassword) {
    await SwalHelper.warning('Password Mismatch', 'Password and Confirm Password do not match.');
    return;
  }

  if (password.length < 6) {
    await SwalHelper.warning('Weak Password', 'Password must be at least 6 characters.');
    return;
  }

  // Device fields
  const devCategory = document.getElementById('reg-dev-category')?.value || 'Smartphone';
  const devBrand = document.getElementById('reg-dev-brand')?.value.trim();
  const devModel = document.getElementById('reg-dev-model')?.value.trim();
  const devSn = document.getElementById('reg-dev-sn')?.value.trim();
  const devColor = document.getElementById('reg-dev-color')?.value.trim() || 'Standard';

  const isSerialOptional = (devCategory === 'Earbuds' || devCategory === 'Other');

  if (!devBrand || !devModel) {
    await SwalHelper.warning('Device Required', 'Please enter your initial device Brand and Model.');
    return;
  }
  if (!isSerialOptional && !devSn) {
    await SwalHelper.warning('Serial Number Required', `Please enter the Serial Number or IMEI for your ${devCategory}.`);
    return;
  }

  const initialDevice = {
    category: devCategory,
    brand: devBrand,
    model: devModel,
    serialNumber: devSn || '',
    color: devColor,
    description: 'Initial device registered during student signup.'
  };

  const pendingRegistrationPayload = {
    name,
    email,
    idNumber,
    role: 'student',
    department,
    contactNumber,
    password,
    initialDevice
  };

  // Populate Review Confirmation Modal
  document.getElementById('conf-summary-name').textContent = name;
  document.getElementById('conf-summary-id').textContent = idNumber;
  document.getElementById('conf-summary-email').textContent = email;
  document.getElementById('conf-summary-contact').textContent = contactNumber;
  
  const levelEl = document.getElementById('conf-summary-level');
  if (levelEl) levelEl.textContent = educationLevel;

  const subLabelEl = document.getElementById('conf-summary-subfield-label');
  const subValEl = document.getElementById('conf-summary-subfield-val');
  if (subLabelEl && subValEl) {
    subLabelEl.textContent = (educationLevel === 'SHS') ? 'Track & Strand:' : 'Course / Program:';
    subValEl.textContent = academicSubfield;
  }
  
  if (initialDevice) {
    document.getElementById('conf-summary-device').textContent = `${initialDevice.brand} ${initialDevice.model} (${initialDevice.category})`;
    document.getElementById('conf-summary-sn').textContent = initialDevice.serialNumber || 'N/A (Optional)';
    document.getElementById('conf-summary-color').textContent = initialDevice.color || 'Standard';
  }

  // Open confirmation modal
  window.pendingRegistrationData = pendingRegistrationPayload;
  document.getElementById('confirm-register-modal').classList.add('active');
}

async function executeFinalRegisterSubmission() {
  if (!window.pendingRegistrationData) return;

  const payload = window.pendingRegistrationData;
  const btn = document.getElementById('btn-final-confirm-submit');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>⏳</span> Submitting Application...`;
  }

  try {
    const res = await api.register(payload);

    closeModal('confirm-register-modal');
    closeModal('register-modal');
    window.pendingRegistrationData = null;
    updateAuthUI();

    if (res.pendingApproval) {
      api.setToken(null);
      api.setCurrentUser(null);
      updateAuthUI();

      const devNameEl = document.getElementById('osa-modal-dev-name');
      const devSnEl = document.getElementById('osa-modal-dev-sn');
      if (devNameEl && res.device) devNameEl.textContent = `${res.device.brand} ${res.device.model} (${res.device.category})`;
      if (devSnEl && res.device) devSnEl.textContent = `S/N: ${res.device.serialNumber}`;

      const verifyModal = document.getElementById('osa-verify-instruction-modal');
      if (verifyModal) {
        verifyModal.classList.add('active');
      }
      await SwalHelper.success(
        'Application Submitted! 🎉',
        'Your registration application has been submitted to the Office of Student Affairs (OSA). Please visit Room 204 for physical verification.',
        2500
      );
      return;
    }

    await SwalHelper.success('Registration Successful! 🎉', `Welcome to NCST GadgetGuard, ${res.user.name}! Redirecting to dashboard...`, 1600);
    setTimeout(() => {
      window.location.href = res.user.role === 'osa_admin' ? '/osa/' : '/student/';
    }, 1500);
  } catch (err) {
    await SwalHelper.error('Registration Failed', err.message || 'Could not complete registration.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `✓ Confirm & Submit Application`;
    }
  }
}

function handleAcademicLevelChange(level) {
  const labelEl = document.getElementById('label-academic-subfield');
  const containerEl = document.getElementById('container-academic-subfield');
  if (!labelEl || !containerEl) return;

  if (level === 'SHS') {
    labelEl.textContent = 'Senior High Strand / Track *';
    containerEl.innerHTML = `
      <select id="reg-academic-select" class="form-control">
        <option value="STEM - Science, Technology, Engineering & Mathematics">STEM - Science, Technology, Engineering & Mathematics</option>
        <option value="ABM - Accountancy, Business & Management">ABM - Accountancy, Business & Management</option>
        <option value="HUMSS - Humanities & Social Sciences">HUMSS - Humanities & Social Sciences</option>
        <option value="GAS - General Academic Strand">GAS - General Academic Strand</option>
        <option value="TVL - ICT (Information & Communications Tech)">TVL - ICT (Information & Communications Tech)</option>
        <option value="TVL - Home Economics">TVL - Home Economics</option>
        <option value="TVL - Industrial Arts">TVL - Industrial Arts</option>
      </select>
    `;
  } else {
    // College
    labelEl.textContent = 'Course / Program *';
    containerEl.innerHTML = `
      <select id="reg-academic-select" class="form-control">
        <option value="AB Communication">AB Communication</option>
        <option value="ACT">ACT</option>
        <option value="Associate in Office Management">Associate in Office Management</option>
        <option value="BS Architecture">BS Architecture</option>
        <option value="BS Business Administration-Operations Management">BS Business Administration-Operations Management</option>
        <option value="BS Electronics Engineering">BS Electronics Engineering</option>
        <option value="BS Entrepreneurship">BS Entrepreneurship</option>
        <option value="BS Hospitality Management">BS Hospitality Management</option>
        <option value="BS Industrial Engineering">BS Industrial Engineering</option>
        <option value="BS Industrial Security Management">BS Industrial Security Management</option>
        <option value="BS Management Accounting">BS Management Accounting</option>
        <option value="BS Public Administration">BS Public Administration</option>
        <option value="BS Real Estate Management">BS Real Estate Management</option>
        <option value="BS-ACCOUNTANCY">BS-ACCOUNTANCY</option>
        <option value="BS-Computer Engineering">BS-Computer Engineering</option>
        <option value="BS-Computer Science">BS-Computer Science</option>
        <option value="BS-Criminology">BS-Criminology</option>
        <option value="BS-Customs Administration">BS-Customs Administration</option>
        <option value="BS-Information Technology">BS-Information Technology</option>
        <option value="BS-Office Administration">BS-Office Administration</option>
        <option value="BS-Psychology">BS-Psychology</option>
        <option value="BS-Tourism Management">BS-Tourism Management</option>
        <option value="BSBA - Financial Management">BSBA - Financial Management</option>
        <option value="BSBA Marketing-Management">BSBA Marketing-Management</option>
        <option value="BSEd - English">BSEd - English</option>
        <option value="BSEd - Filipino">BSEd - Filipino</option>
        <option value="BSEd - Mathematics">BSEd - Mathematics</option>
        <option value="BSEd - Social Studies">BSEd - Social Studies</option>
        <option value="Professional Educational Units">Professional Educational Units</option>
        <option value="Teacher Certificate Program">Teacher Certificate Program</option>
      </select>
    `;
  }
}

function goToStudentPortalFromModal() {
  closeModal('osa-verify-instruction-modal');
  window.location.href = '/student/';
}

function handleRegDevCategoryChange(category) {
  const snInput = document.getElementById('reg-dev-sn');
  const snLabel = document.getElementById('reg-dev-sn-label');
  const snBadge = document.getElementById('reg-dev-sn-badge');
  const snHint = document.getElementById('reg-dev-sn-hint');

  if (!snInput) return;

  const isOptional = (category === 'Earbuds' || category === 'Other');

  if (isOptional) {
    snInput.required = false;
    snInput.placeholder = 'Optional (accessories usually do not have a serial number)';
    if (snLabel) snLabel.textContent = 'Device Serial Number (Optional)';
    if (snBadge) {
      snBadge.textContent = 'OPTIONAL';
      snBadge.style.color = '#059669';
    }
    if (snHint) {
      snHint.textContent = 'You may leave this blank if your earbuds or accessory has no visible serial number.';
    }
  } else {
    snInput.required = true;
    snInput.placeholder = 'Check Settings > About or back chassis';
    if (snLabel) snLabel.textContent = 'Device Serial Number / IMEI *';
    if (snBadge) {
      snBadge.textContent = 'REQUIRED';
      snBadge.style.color = '#dc2626';
    }
    if (snHint) {
      snHint.textContent = 'OSA will verify this in person against your physical device.';
    }
  }
}
