/**
 * GadgetGuard Student Portal Controller
 * Professional School-Management Dashboard Architecture
 */

let myGadgetsData = [];
let pendingMissingReportData = null;
let activeStudentFilter = 'ALL';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Authenticate and populate user profile
  await ensureStudentAuthenticated();
  initStudentNavigation();
  await loadAllStudentData();

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Real-time EventSource listener
  onLiveEvent((evt) => {
    loadAllStudentData();
  });
});

function populateStudentUserUI(user) {
  if (!user) return;

  // Sidebar user pill
  const sbName = document.getElementById('user-sidebar-name');
  const sbId = document.getElementById('user-sidebar-id');
  const sbAvatar = document.getElementById('user-sidebar-avatar');
  if (sbName) sbName.textContent = user.name || 'Student';
  if (sbId) sbId.textContent = user.idNumber || '-';
  if (sbAvatar) {
    sbAvatar.src = user.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.name || 'Student')}`;
  }

  // Greeting text
  const firstName = user.name ? user.name.split(' ')[0] : 'Student';
  const greetEl = document.getElementById('dash-greeting-text');
  if (greetEl) greetEl.textContent = `Good day, ${firstName}!`;

  // Profile screen
  const pName = document.getElementById('prof-full-name');
  const pId = document.getElementById('prof-id-num');
  const pDept = document.getElementById('prof-dept-name');
  const pRole = document.getElementById('prof-role-badge');
  const pEmail = document.getElementById('prof-email-val');
  const pContact = document.getElementById('prof-contact-val');
  const pAv = document.getElementById('prof-avatar-img');

  if (pName) pName.textContent = user.name || '-';
  if (pId) pId.textContent = user.idNumber || '-';
  if (pDept) pDept.textContent = user.department || '-';
  const pDeptVal = document.getElementById('prof-dept-val');
  if (pDeptVal) pDeptVal.textContent = user.department || '-';
  if (pRole) pRole.textContent = (user.role === 'student' ? 'Enrolled Student' : user.role) || 'Enrolled Student';
  if (pEmail) pEmail.textContent = user.email || '-';
  if (pContact) pContact.textContent = user.contactNumber || '-';
  if (pAv) {
    pAv.src = user.avatarUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user.name || 'Student')}`;
  }
}

async function ensureStudentAuthenticated() {
  let token = api.getToken();
  let user = api.getCurrentUser();

  // If user is cached, render immediately
  if (user && user.role !== 'osa_admin') {
    populateStudentUserUI(user);
  }

  if (!token || !user || user.role === 'osa_admin') {
    window.location.href = '/?login=1';
    return;
  }

  // Validate active token with server
  try {
    const meRes = await api.getMe();
    if (meRes && meRes.success && meRes.user) {
      user = meRes.user;
      api.setCurrentUser(user);
      populateStudentUserUI(user);
    } else {
      api.clearAuth();
      window.location.href = '/?login=1';
    }
  } catch (e) {
    console.warn('Could not refresh student session:', e);
  }
}

function initStudentNavigation() {
  const hash = window.location.hash.replace('#', '');
  if (hash) {
    navigateStudent(hash);
  } else {
    navigateStudent('dashboard');
  }
}

function navigateStudent(screenName) {
  let targetReturnId = null;
  if (screenName && screenName.includes('?')) {
    const parts = screenName.split('?');
    screenName = parts[0];
    try {
      const params = new URLSearchParams(parts[1]);
      targetReturnId = params.get('id');
    } catch (e) {}
  }

  if (screenName === 'scans') screenName = 'lost-status';
  if (screenName === 'returns' || screenName === 'return-history') screenName = 'claims';

  // Hide all screens
  document.querySelectorAll('.student-screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.student-nav-item').forEach(i => i.classList.remove('active'));

  const target = document.getElementById(`student-screen-${screenName}`);
  if (target) {
    target.classList.add('active');
    window.location.hash = targetReturnId ? `${screenName}?id=${targetReturnId}` : screenName;
  }

  const navItem = document.getElementById(`nav-item-${screenName}`);
  if (navItem) {
    navItem.classList.add('active');
  }

  // Update Page Header Title
  const titles = {
    'dashboard': 'Dashboard Overview',
    'gadgets': 'My Registered Gadgets',
    'missing-form': 'Report Gadget as Missing',
    'lost-status': 'Lost Gadget Status & Campus Board',
    'claims': 'My Gadget Return History',
    'returns': 'My Gadget Return History',
    'notifications': 'Notifications Center',
    'profile': 'My Student Profile'
  };
  const heading = document.getElementById('screen-page-heading');
  if (heading) heading.textContent = titles[screenName] || 'Student Portal';

  // Close mobile sidebar if open
  const sb = document.getElementById('student-sidebar');
  if (sb) sb.classList.remove('mobile-open');

  // Load screen-specific data
  if (screenName === 'lost-status') loadLostStatusScreen();
  if (screenName === 'claims') loadClaimsScreen(targetReturnId);
  if (screenName === 'notifications') loadNotificationsFeed();
  if (screenName === 'missing-form') populateMissingFormDropdown();
}

function toggleMobileSidebar() {
  const sb = document.getElementById('student-sidebar');
  if (sb) sb.classList.toggle('mobile-open');
}

async function loadAllStudentData() {
  await loadMyGadgetsData();
  await loadNotificationsFeed();
  await loadDashboardScanHighlight();
}

async function loadMyGadgetsData() {
  try {
    const res = await api.getMyGadgets();
    myGadgetsData = (res && res.gadgets) ? res.gadgets : [];

    // Compute real database metrics
    const totalReg = myGadgetsData.filter(g => g.status === 'REGISTERED').length;
    const totalMissing = myGadgetsData.filter(g => g.status === 'MISSING').length;
    const totalCustody = myGadgetsData.filter(g => g.status === 'FOUND_IN_CUSTODY').length;
    const totalReturned = myGadgetsData.filter(g => g.status === 'RETURNED').length;

    // Fetch user return history count
    let totalReturns = 0;
    try {
      const returnsRes = await api.getReturns();
      totalReturns = (returnsRes && returnsRes.returns) ? returnsRes.returns.length : 0;
    } catch (e) {
      totalReturns = myGadgetsData.filter(g => g.status === 'RETURNED' || g.claimStatus === 'RETURNED').length;
    }

    // Update Dashboard 4 Metric Cards
    const regEl = document.getElementById('stat-registered-val');
    const misEl = document.getElementById('stat-missing-val');
    const clmEl = document.getElementById('stat-claims-val');
    const retEl = document.getElementById('stat-returned-val');

    if (regEl) regEl.textContent = totalReg;
    if (misEl) misEl.textContent = totalMissing;
    if (clmEl) clmEl.textContent = totalReturns;
    if (retEl) retEl.textContent = totalCustody + totalReturned;

    // Update sidebar missing badge
    const badgeMiss = document.getElementById('badge-missing-count');
    if (badgeMiss) {
      if (totalMissing > 0) {
        badgeMiss.textContent = totalMissing;
        badgeMiss.style.display = 'inline-block';
      } else {
        badgeMiss.style.display = 'none';
      }
    }

    // Toggle OSA Physical Verification Banner
    const pendingGadgets = myGadgetsData.filter(g => g.status === 'PENDING_APPROVAL');
    const verifyBanner = document.getElementById('student-osa-verify-banner');
    const verifyDevName = document.getElementById('pending-verify-device-name');
    if (verifyBanner) {
      if (pendingGadgets.length > 0) {
        verifyBanner.style.display = 'block';
        if (verifyDevName) {
          const names = pendingGadgets.map(g => `${g.brand} ${g.model}`).join(', ');
          verifyDevName.textContent = names;
        }
      } else {
        verifyBanner.style.display = 'none';
      }
    }

    renderDashboardGadgets();
    renderStudentAllGadgets();
    populateMissingFormDropdown();
  } catch (err) {
    console.warn('Error loading student gadgets:', err);
  }
}

// Render Dashboard Gadgets Grid
function renderDashboardGadgets() {
  const container = document.getElementById('dash-gadgets-grid');
  if (!container) return;

  if (myGadgetsData.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; background: #ffffff; border: 1px dashed var(--card-border); border-radius: var(--radius-lg); padding: 32px; text-align: center;">
        <div style="font-size: 2rem; margin-bottom: 8px;">💻</div>
        <h4 style="font-weight: 700;">No Registered Gadgets Yet</h4>
        <p class="text-muted" style="font-size: 0.85rem; margin: 4px 0 16px;">Register your laptop, phone, or tablet to get your official QR protection sticker.</p>
        <button class="btn btn-primary btn-sm" onclick="openRegisterGadgetModal()">➕ Register First Gadget</button>
      </div>
    `;
    return;
  }

  // Display up to 4 gadgets on dashboard
  container.innerHTML = myGadgetsData.slice(0, 4).map(g => createGadgetCardHtml(g)).join('');
}

// Render All Gadgets Screen
function renderStudentAllGadgets() {
  const container = document.getElementById('student-all-gadgets-grid');
  if (!container) return;

  let filtered = myGadgetsData;
  if (activeStudentFilter !== 'ALL') {
    filtered = myGadgetsData.filter(g => g.status === activeStudentFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; padding: 40px; text-align: center; color: var(--text-muted);">
        No devices found under this filter category.
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(g => createGadgetCardHtml(g)).join('');
}

function filterStudentGadgets(status) {
  activeStudentFilter = status;
  document.querySelectorAll('#gadget-filter-bar .filter-tab-btn').forEach(b => {
    b.classList.remove('active');
    if (b.textContent.toUpperCase().includes(status) || (status === 'ALL' && b.textContent.includes('All'))) {
      b.classList.add('active');
    }
  });
  renderStudentAllGadgets();
}

function createGadgetCardHtml(g) {
  return `
    <div class="gadget-item-card">
      <div class="gadget-item-img-box">
        <img src="${g.photoUrl || 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500'}" alt="${escapeHtml(g.model)}" class="gadget-item-img">
        <div class="gadget-item-status-pill">
          ${renderStatusBadge(g.status)}
        </div>
      </div>
      <div class="gadget-item-body">
        <div class="gadget-item-title">${escapeHtml(g.brand)} ${escapeHtml(g.model)}</div>
        <div class="gadget-item-meta-row">
          <span>${escapeHtml(g.category)}</span>
          <span>Color: ${escapeHtml(g.color || 'Standard')}</span>
        </div>
        <div>
          <span class="gadget-item-sn">S/N: ${escapeHtml(g.serialNumber)}</span>
        </div>
        <div class="gadget-item-footer">
          <span style="font-size: 0.75rem; color: var(--text-dim);">${formatDate(g.registrationDate).split(',')[0]}</span>
          <button class="btn btn-secondary btn-sm" onclick="openGadgetDetailsModal('${g.id}')">
            View Details →
          </button>
        </div>
      </div>
    </div>
  `;
}

// Highlighted Activity Section (Recent QR Scan or Status update)
async function loadDashboardScanHighlight() {
  const titleEl = document.getElementById('highlight-act-title');
  const descEl = document.getElementById('highlight-act-desc');
  const metaEl = document.getElementById('highlight-act-meta');
  const btnEl = document.getElementById('highlight-act-btn');

  try {
    const res = await api.getMyScanHistory();
    const scans = res.scans || [];

    if (scans.length > 0) {
      const latest = scans[0];
      const scanFormatted = formatDate(latest.scannedAt);

      titleEl.innerHTML = `🚨 QR Scan Event Detected: ${escapeHtml(latest.gadget?.brand || '')} ${escapeHtml(latest.gadget?.model || '')}`;
      descEl.textContent = `Your registered ${latest.gadget?.brand || 'device'} ${latest.gadget?.model || ''} QR code was scanned at "${latest.scanLocationNote || 'Campus Area'}".`;
      metaEl.innerHTML = `<strong>Scan Time:</strong> ${scanFormatted} • <strong>Scanner Device:</strong> ${escapeHtml(latest.deviceInfo || 'Mobile Browser')} • <strong>Status:</strong> Detected`;
      
      btnEl.textContent = 'View Scan History →';
      btnEl.onclick = () => openGadgetDetailsModal(latest.gadgetId);
    }
  } catch (e) {}
}

// Gadget Details Modal
function openGadgetDetailsModal(gadgetId) {
  const gadget = myGadgetsData.find(g => g.id === gadgetId);
  if (!gadget) return;

  document.getElementById('gmodal-title').textContent = `${gadget.brand} ${gadget.model}`;
  document.getElementById('gmodal-sn').textContent = gadget.serialNumber;
  document.getElementById('gmodal-cat').textContent = gadget.category;
  document.getElementById('gmodal-color').textContent = gadget.color || 'Standard';
  document.getElementById('gmodal-date').textContent = formatDate(gadget.registrationDate);
  document.getElementById('gmodal-img').src = gadget.photoUrl || 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500';
  document.getElementById('gmodal-badge').innerHTML = renderStatusBadge(gadget.status);

  const securitySection = document.getElementById('gmodal-security-section');
  const actionsEl = document.getElementById('gmodal-actions');

  if (gadget.status === 'REGISTERED' || gadget.status === 'MISSING' || gadget.status === 'FOUND_IN_CUSTODY' || gadget.status === 'RETURNED') {
    if (securitySection) {
      securitySection.style.display = 'block';
      const tokEl = document.getElementById('gmodal-token');
      if (tokEl) tokEl.textContent = gadget.secureToken || 'Assigned by OSA';
    }
  } else {
    if (securitySection) securitySection.style.display = 'none';
  }

  // Build Status-Specific Allowed Actions
  let actionHtml = '';
  if (gadget.status === 'PENDING_APPROVAL') {
    actionHtml += `
      <div style="background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: var(--radius-md); padding: 14px; font-size: 0.825rem; color: #1e3a8a; line-height: 1.5;">
        <div style="font-weight: 800; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
          <span>🏢</span> In-Person OSA Verification Required:
        </div>
        <div>To verify device ownership and receive your official printed QR code sticker:</div>
        <ul style="margin: 6px 0 0 16px; padding: 0;">
          <li>Bring your <strong>physical Student ID card</strong> to prove your university enrollment.</li>
          <li>Bring your <strong>${escapeHtml(gadget.brand)} ${escapeHtml(gadget.model)}</strong> (S/N: <code>${escapeHtml(gadget.serialNumber)}</code>) to OSA Room 1109.</li>
          <li>The OSA officer will inspect the device on-site and release your printed QR sticker.</li>
        </ul>
      </div>
    `;
  } else if (gadget.status === 'REGISTERED' || gadget.status === 'RETURNED') {
    actionHtml += `
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button class="btn btn-danger btn-sm" onclick="initiateMissingReportFor('${gadget.id}')">
          🚨 Report as Missing
        </button>
      </div>
    `;
  } else if (gadget.status === 'MISSING') {
    actionHtml += `
      <button class="btn btn-success btn-sm" onclick="cancelMissingReportFor('${gadget.missingReport?.id || gadget.id}')">
        ✅ Mark as Recovered / Safe
      </button>
    `;
    if (gadget.finderInfo) {
      actionHtml += `
        <div style="background: #ecfdf5; border: 1.5px solid #a7f3d0; border-radius: var(--radius-md); padding: 16px; margin-top: 14px; text-align: left;">
          <div style="font-weight: 800; color: #047857; font-size: 0.9rem; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
            <span>🌟</span> Good Samaritan Contact Information:
          </div>
          <div style="font-size: 0.825rem; color: #065f46; line-height: 1.55; background: #ffffff; border: 1px solid #d1fae5; border-radius: 8px; padding: 12px; margin-bottom: 10px;">
            <div>👤 <strong>Finder Name:</strong> ${escapeHtml(gadget.finderInfo.finderName)}</div>
            <div>📞 <strong>Contact Number:</strong> <a href="tel:${escapeHtml(gadget.finderInfo.finderContact)}" style="font-weight: 800; color: #1e40af; text-decoration: underline;">${escapeHtml(gadget.finderInfo.finderContact)}</a></div>
            ${gadget.finderInfo.finderEmail ? `<div>✉️ <strong>Email:</strong> <a href="mailto:${escapeHtml(gadget.finderInfo.finderEmail)}">${escapeHtml(gadget.finderInfo.finderEmail)}</a></div>` : ''}
            <div>📍 <strong>Found Location:</strong> ${escapeHtml(gadget.finderInfo.foundLocation)}</div>
            ${gadget.finderInfo.message ? `<div>📝 <strong>Notes:</strong> "${escapeHtml(gadget.finderInfo.message)}"</div>` : ''}
          </div>

          <div style="font-size: 0.78rem; color: #047857; font-weight: 600; line-height: 1.45; margin-bottom: 10px;">
            💡 You may contact the finder to arrange the return of your gadget. For your safety, we recommend completing the return through the OSA whenever possible.
          </div>

          <div style="background: #fffbeb; border: 1px solid #fef3c7; border-left: 3.5px solid #f59e0b; border-radius: 6px; padding: 10px 12px; font-size: 0.74rem; color: #92400e; line-height: 1.5;">
            <div style="font-weight: 800; color: #b45309; margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
              <span>⚠️</span> Safety & Liability Notice
            </div>
            <p style="margin-bottom: 4px;">
              Please prioritize your safety when arranging the return of a missing gadget.
            </p>
            <p style="margin-bottom: 4px;">
              GadgetGuard and the school/OSA provide this platform to facilitate communication between the gadget owner and finder. Any personal meetup or arrangement outside the school/OSA is the responsibility of the individuals involved.
            </p>
            <p style="margin-bottom: 4px;">
              The school/OSA is not responsible for incidents, injuries, losses, or other circumstances arising from personal meetups conducted outside official school premises or OSA-supervised procedures.
            </p>
            <p>
              For your safety, we strongly recommend arranging the return through the <strong>Office of Student Affairs (OSA Room 1109)</strong>. If a personal meetup is necessary, choose a safe and public location, such as a police station or busy mall, and inform someone you trust.
            </p>
          </div>
        </div>
      `;
    }
  } else if (gadget.status === 'FOUND_IN_CUSTODY') {
    actionHtml += `
      <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: var(--radius-md); padding: 12px; font-size: 0.825rem; color: #065f46;">
        🌟 <strong>Device Secured in OSA Custody!</strong><br>
        Please visit the Office of Student Affairs (Room 1109) with your student ID to claim your gadget.
      </div>
    `;
  }

  // Allow updating device photo / proof of ownership anytime
  actionHtml += `
    <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #e2e8f0; display: flex; justify-content: flex-end;">
      <button type="button" class="btn btn-secondary btn-sm" onclick="openUpdatePhotoModal('${gadget.id}')">
        📷 Update Photo / Add Proof
      </button>
    </div>
  `;

  actionsEl.innerHTML = actionHtml;
  document.getElementById('gadget-details-modal').classList.add('active');
}

// Open Update Photo Modal
function openUpdatePhotoModal(gadgetId) {
  const gadget = myGadgetsData.find(g => g.id === gadgetId);
  if (!gadget) return;

  document.getElementById('update-photo-gadget-id').value = gadget.id;
  document.getElementById('update-photo-url').value = gadget.photoUrl || '';
  const preview = document.getElementById('update-photo-preview');
  if (preview) {
    preview.src = gadget.photoUrl || 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500';
  }

  document.getElementById('update-photo-modal').classList.add('active');
}

async function handleUpdatePhotoSubmit(e) {
  e.preventDefault();
  const gadgetId = document.getElementById('update-photo-gadget-id').value;
  const photoUrl = document.getElementById('update-photo-url').value.trim() || document.getElementById('update-photo-preview').src;

  if (!photoUrl) {
    await SwalHelper.warning('Photo Required', 'Please select or upload an image file or provide an Image URL.');
    return;
  }

  const btn = document.getElementById('btn-save-photo');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  try {
    const res = await api.updateGadgetPhoto(gadgetId, photoUrl, false);
    if (res.success) {
      await SwalHelper.success('Photo Proof Updated! 📷', 'Your updated device photo has been saved and is visible to OSA administrators.');
      closeModal('update-photo-modal');
      closeModal('gadget-details-modal');
      await loadMyGadgetsData();
    } else {
      await SwalHelper.error('Update Failed', res.error || 'Unable to update photo.');
    }
  } catch (err) {
    await SwalHelper.error('Update Failed', err.message || 'Error updating device photo.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Save Photo Proof';
    }
  }
}

async function handleRemovePhotoSubmit() {
  const gadgetId = document.getElementById('update-photo-gadget-id').value;
  if (!gadgetId) return;

  const confirmed = await SwalHelper.confirm({
    title: 'Remove Photo Proof?',
    text: 'Are you sure you want to remove the attached photo proof from this gadget?',
    icon: 'warning',
    confirmText: 'Yes, Remove Photo',
    isDanger: true
  });

  if (!confirmed) return;

  try {
    const res = await api.updateGadgetPhoto(gadgetId, null, true);
    if (res.success) {
      await SwalHelper.success('Photo Removed', 'The photo proof has been removed.');
      closeModal('update-photo-modal');
      closeModal('gadget-details-modal');
      await loadMyGadgetsData();
    } else {
      await SwalHelper.error('Failed to Remove', res.error || 'Could not remove photo.');
    }
  } catch (err) {
    await SwalHelper.error('Error', err.message || 'Error removing photo.');
  }
}

// Student Change Password Handler
async function handleStudentChangePasswordSubmit(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('student-current-password').value;
  const newPassword = document.getElementById('student-new-password').value;
  const confirmNewPassword = document.getElementById('student-confirm-new-password').value;

  if (!currentPassword || !newPassword || !confirmNewPassword) {
    await SwalHelper.warning('Missing Fields', 'Please fill in all password fields.');
    return;
  }

  if (newPassword.length < 6) {
    await SwalHelper.warning('Password Too Short', 'New password must be at least 6 characters long.');
    return;
  }

  if (newPassword !== confirmNewPassword) {
    await SwalHelper.warning('Password Mismatch', 'New password and confirm password do not match.');
    return;
  }

  const btn = document.getElementById('btn-update-password');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Updating Password...';
  }

  try {
    const res = await api.changePassword(currentPassword, newPassword, confirmNewPassword);
    if (res.success) {
      await SwalHelper.success('Password Updated! 🔒', 'Your account password has been changed successfully.');
      document.getElementById('student-current-password').value = '';
      document.getElementById('student-new-password').value = '';
      document.getElementById('student-confirm-new-password').value = '';
    } else {
      await SwalHelper.error('Update Failed', res.error || 'Incorrect current password.');
    }
  } catch (err) {
    await SwalHelper.error('Password Update Failed', err.message || 'Unable to update password.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Update Password';
    }
  }
}

// Register Gadget Modal & Form
function openRegisterGadgetModal() {
  const form = document.querySelector('#register-gadget-modal form');
  if (form) form.reset();
  const wrap = document.getElementById('modal-reg-photo-preview-wrap');
  if (wrap) wrap.style.display = 'none';
  handleCategoryChange(document.getElementById('modal-reg-category').value);
  document.getElementById('register-gadget-modal').classList.add('active');
}

// Image File & URL Handlers
function handlePhotoFileSelect(e, previewImgId, inputUrlId) {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    SwalHelper.warning('Invalid File', 'Please select an image file (PNG, JPG, JPEG, WEBP).');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    const dataUrl = evt.target.result;
    const preview = document.getElementById(previewImgId);
    if (preview) {
      preview.src = dataUrl;
      const wrap = preview.parentElement;
      if (wrap) wrap.style.display = 'block';
    }
    const inputUrl = document.getElementById(inputUrlId);
    if (inputUrl) {
      inputUrl.value = dataUrl;
    }
  };
  reader.readAsDataURL(file);
}

function updatePhotoUrlPreview(url, previewImgId) {
  const preview = document.getElementById(previewImgId);
  if (!preview) return;
  const wrap = preview.parentElement;
  if (url && url.trim()) {
    preview.src = url.trim();
    if (wrap) wrap.style.display = 'block';
  } else {
    if (wrap) wrap.style.display = 'none';
  }
}

function handleCategoryChange(cat) {
  const defaultPhotos = {
    Laptop: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=500',
    Smartphone: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=500',
    Tablet: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500',
    Earbuds: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500',
    Calculator: 'https://images.unsplash.com/photo-1587145820266-a5951ee6f620?w=500',
    Smartwatch: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500',
    Camera: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=500',
    Other: 'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=500'
  };
  const photoInput = document.getElementById('modal-reg-photo');
  if (photoInput && !photoInput.value) {
    photoInput.placeholder = defaultPhotos[cat] || 'https://...';
  }

  const snInput = document.getElementById('modal-reg-sn');
  const snLabel = document.getElementById('modal-reg-sn-label');
  const snBadge = document.getElementById('modal-reg-sn-badge');
  const snHint = document.getElementById('modal-reg-sn-hint');

  const isOptional = (cat === 'Earbuds' || cat === 'Other');

  if (snInput) {
    if (isOptional) {
      snInput.required = false;
      snInput.placeholder = 'Optional (most earbuds/accessories do not have printed S/N)';
      if (snLabel) snLabel.textContent = 'Serial Number (Optional)';
      if (snBadge) {
        snBadge.textContent = 'OPTIONAL';
        snBadge.style.color = '#059669';
      }
      if (snHint) {
        snHint.textContent = 'You may leave this blank if there is no serial number printed on your accessory.';
      }
    } else {
      snInput.required = true;
      snInput.placeholder = 'Found on device chassis or in Settings';
      if (snLabel) snLabel.textContent = 'Serial Number / IMEI *';
      if (snBadge) {
        snBadge.textContent = 'REQUIRED';
        snBadge.style.color = '#dc2626';
      }
      if (snHint) {
        snHint.textContent = 'Unique hardware serial number is permanently linked to your student ID.';
      }
    }
  }
}

async function handleRegisterGadgetSubmit(e) {
  e.preventDefault();
  const category = document.getElementById('modal-reg-category').value;
  const brand = document.getElementById('modal-reg-brand').value.trim();
  const model = document.getElementById('modal-reg-model').value.trim();
  const serialNumber = document.getElementById('modal-reg-sn').value.trim();
  const color = document.getElementById('modal-reg-color').value.trim();
  const description = document.getElementById('modal-reg-desc').value.trim();
  const photoUrl = document.getElementById('modal-reg-photo').value.trim();

  const isOptional = (category === 'Earbuds' || category === 'Other');
  if (!isOptional && !serialNumber) {
    await SwalHelper.warning('Serial Number Required', `Please enter the Serial Number or IMEI for your ${category}.`);
    return;
  }

  if (!brand || !model) {
    await SwalHelper.warning('Device Information Required', 'Please provide both the brand and model of your gadget.');
    return;
  }

  const defaultPhotos = {
    Laptop: 'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=500',
    Smartphone: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=500',
    Tablet: 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500',
    Earbuds: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=500',
    Calculator: 'https://images.unsplash.com/photo-1587145820266-a5951ee6f620?w=500',
    Smartwatch: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500',
    Camera: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=500',
    Other: 'https://images.unsplash.com/photo-1526738549149-8e07eca6c147?w=500'
  };

  const finalPhoto = photoUrl || defaultPhotos[category] || defaultPhotos.Other;

  window.pendingGadgetRegistration = {
    category,
    brand,
    model,
    serialNumber: serialNumber || 'N/A',
    color: color || 'Standard',
    description,
    photoUrl: finalPhoto
  };

  // Populate preview safely without null exceptions
  const devEl = document.getElementById('student-conf-device');
  const catEl = document.getElementById('student-conf-cat');
  const snEl = document.getElementById('student-conf-sn');
  const colEl = document.getElementById('student-conf-color');
  const photoEl = document.getElementById('student-conf-photo');

  if (devEl) devEl.textContent = `${brand} ${model}`;
  if (catEl) catEl.textContent = category;
  if (snEl) snEl.textContent = serialNumber || 'N/A (Optional)';
  if (colEl) colEl.textContent = color || 'Standard';
  if (photoEl) photoEl.src = finalPhoto;

  document.getElementById('confirm-gadget-reg-modal').classList.add('active');
}

async function executeFinalGadgetSubmit() {
  if (!window.pendingGadgetRegistration) return;

  const btn = document.getElementById('btn-final-gadget-submit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting...';
  }

  try {
    const res = await api.registerGadget(window.pendingGadgetRegistration);

    closeModal('confirm-gadget-reg-modal');
    closeModal('register-gadget-modal');
    
    await SwalHelper.success(
      'Device Submitted for Review! 🎉',
      'Your gadget is now registered as PENDING_APPROVAL. Please present the device at the Office of Student Affairs (OSA Room 1109) for physical inspection and official QR code sticker issuance.'
    );

    const form = document.querySelector('#register-gadget-modal form');
    if (form) form.reset();
    const wrap = document.getElementById('modal-reg-photo-preview-wrap');
    if (wrap) wrap.style.display = 'none';

    await loadMyGadgetsData();
    navigateStudent('gadgets');
  } catch (err) {
    await SwalHelper.error('Registration Failed', err.message || 'Unable to register device.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '✓ Confirm & Submit Device';
    }
  }
}

// Report Missing Step Form & Confirmation Dialog
function populateMissingFormDropdown() {
  const select = document.getElementById('missing-form-gadget-select');
  if (!select) return;

  const eligible = myGadgetsData.filter(g => g.status === 'REGISTERED' || g.status === 'RETURNED');
  if (eligible.length === 0) {
    select.innerHTML = `<option value="">No eligible registered gadgets to report missing</option>`;
    return;
  }

  select.innerHTML = eligible.map(g => `
    <option value="${g.id}">${g.brand} ${g.model} (S/N: ${g.serialNumber})</option>
  `).join('');
}

// Seamless Direct Missing Report Trigger from Gadget Details Modal
async function initiateMissingReportFor(gadgetId) {
  closeModal('gadget-details-modal');
  const gadget = myGadgetsData.find(g => g.id === gadgetId);
  if (!gadget) return;

  if (gadget.status !== 'REGISTERED') {
    await SwalHelper.warning('Unable to Report', `This gadget is currently marked as ${gadget.status}.`);
    return;
  }

  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const { value: formValues } = await Swal.fire({
    title: `🚨 Report ${escapeHtml(gadget.brand)} ${escapeHtml(gadget.model)} as Missing`,
    html: `
      <div style="text-align: left; font-size: 0.85rem; color: #334155; margin-top: 10px;">
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; font-size: 0.8rem; color: #991b1b; line-height: 1.4;">
          <strong>Security Notice:</strong> Broadcasting this alert changes your gadget's QR code to <strong>RECOVERY MODE</strong> and alerts campus security and the Office of Student Affairs (Room 1109).
        </div>
        <div style="margin-bottom: 12px;">
          <label style="font-weight: 700; color: #1e293b; display: block; margin-bottom: 4px;">Last Known Campus Location *</label>
          <input id="swal-missing-loc" class="swal2-input" style="width: 100%; margin: 0; font-size: 0.875rem; box-sizing: border-box;" placeholder="e.g. Library 3rd Floor, Cafeteria, Room 302" required autofocus>
        </div>
        <div style="margin-bottom: 12px;">
          <label style="font-weight: 700; color: #1e293b; display: block; margin-bottom: 4px;">Approximate Date & Time Lost *</label>
          <input type="datetime-local" id="swal-missing-datetime" class="swal2-input" style="width: 100%; margin: 0; font-size: 0.875rem; box-sizing: border-box;" value="${nowLocal}" required>
        </div>
        <div style="margin-bottom: 6px;">
          <label style="font-weight: 700; color: #1e293b; display: block; margin-bottom: 4px;">Additional Circumstances / Identifying Marks</label>
          <textarea id="swal-missing-notes" class="swal2-textarea" style="width: 100%; margin: 0; font-size: 0.85rem; height: 60px; box-sizing: border-box;" placeholder="e.g. Left in black casing, sticker on back..."></textarea>
        </div>
      </div>
    `,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: '🚨 Broadcast Missing Alert',
    cancelButtonText: 'Cancel',
    reverseButtons: true,
    focusConfirm: false,
    preConfirm: () => {
      const loc = document.getElementById('swal-missing-loc').value.trim();
      const dt = document.getElementById('swal-missing-datetime').value;
      const notes = document.getElementById('swal-missing-notes').value.trim();
      if (!loc) {
        Swal.showValidationMessage('Please specify the last known location.');
        return false;
      }
      return { lastSeenLocation: loc, lastSeenDate: dt, details: notes };
    }
  });

  if (!formValues) return;

  try {
    const res = await api.reportMissing({
      gadgetId: gadget.id,
      lastSeenLocation: formValues.lastSeenLocation,
      lastSeenDate: formValues.lastSeenDate,
      details: formValues.details
    });

    if (res.success) {
      await Swal.fire({
        icon: 'success',
        title: 'Missing Alert Broadcasted! 🚨',
        html: `
          <p>Your <strong>${escapeHtml(gadget.brand)} ${escapeHtml(gadget.model)}</strong> is now marked as <strong>MISSING</strong>.</p>
          <p style="font-size:0.85rem; color:#64748b; margin-top:8px;">
            Anyone who scans its QR sticker will be instructed to surrender it to the Office of Student Affairs (OSA Room 1109).
          </p>
        `,
        confirmButtonColor: '#142a6d'
      });
      await loadMyGadgetsData();
      navigateStudent('lost-status');
    } else {
      await SwalHelper.error('Report Failed', res.error || 'Could not report gadget as missing.');
    }
  } catch (err) {
    await SwalHelper.error('Report Failed', err.message || 'Error reporting device missing.');
  }
}

function triggerReportMissingFor(gadgetId) {
  closeModal('gadget-details-modal');
  initiateMissingReportFor(gadgetId);
}

function handleMissingFormSubmit(e) {
  e.preventDefault();
  const gadgetId = document.getElementById('missing-form-gadget-select').value;
  const lastSeenLocation = document.getElementById('missing-form-location').value.trim();
  const lastSeenDate = document.getElementById('missing-form-datetime').value;
  const details = document.getElementById('missing-form-details').value.trim();
  const contactRewardOffer = document.getElementById('missing-form-reward').value.trim();

  if (!gadgetId) {
    SwalHelper.warning('Please Select Gadget', 'Choose a registered gadget to report missing.');
    return;
  }

  const gadget = myGadgetsData.find(g => g.id === gadgetId);
  pendingMissingReportData = { gadgetId, lastSeenLocation, lastSeenDate, details, contactRewardOffer };

  // Populate confirmation dialog
  const nameEl = document.getElementById('confirm-missing-device-name');
  const locEl = document.getElementById('confirm-missing-loc-val');
  const dateEl = document.getElementById('confirm-missing-date-val');

  if (nameEl) nameEl.textContent = gadget ? `${gadget.brand} ${gadget.model}` : 'this device';
  if (locEl) locEl.textContent = lastSeenLocation;
  if (dateEl) dateEl.textContent = lastSeenDate ? new Date(lastSeenDate).toLocaleString() : 'Now';

  document.getElementById('confirm-missing-modal').classList.add('active');
}

async function executeMissingSubmission() {
  if (!pendingMissingReportData) return;

  const confirmAlert = await SwalHelper.confirm({
    title: 'Broadcast Missing Alert?',
    html: '<p>Confirm broadcasting this incident to <strong>NCST Campus Security & OSA</strong>?</p><p style="font-size:0.85rem; color:#dc2626;">Your gadget will be flagged on the public recovery system.</p>',
    icon: 'warning',
    confirmText: 'Yes, Broadcast Alert',
    cancelText: 'Review Form',
    isDanger: true
  });

  if (!confirmAlert) return;

  try {
    await api.reportMissing(pendingMissingReportData);
    closeModal('confirm-missing-modal');
    const form = document.getElementById('report-missing-main-form') || document.getElementById('missing-report-form');
    if (form) form.reset();
    pendingMissingReportData = null;

    await SwalHelper.warning('Missing Alert Active 🚨', 'Campus security officers and OSA have been alerted. Your device is now listed on the Lost & Found Board.');
    await loadMyGadgetsData();
    navigateStudent('lost-status');
  } catch (err) {
    await SwalHelper.error('Report Failed', err.message || 'Unable to submit missing report.');
  }
}

async function cancelMissingReportFor(reportOrGadgetId) {
  if (!reportOrGadgetId) return;

  const result = await Swal.fire({
    title: 'Mark Gadget as Recovered?',
    text: 'Has this gadget been safely returned to your possession? This will cancel the missing alert and restore the QR sticker to normal registered status.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#16a34a',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Yes, Gadget is Safe',
    cancelButtonText: 'Keep as Missing',
    reverseButtons: true
  });
  if (!result.isConfirmed) return;

  try {
    const res = await api.cancelMissing(reportOrGadgetId);
    if (res.success) {
      await Swal.fire({
        icon: 'success',
        title: 'Gadget Recovered! 🛡️',
        text: 'The missing report is resolved and your QR code status is restored to REGISTERED.',
        confirmButtonColor: '#142a6d'
      });
      closeModal('gadget-details-modal');
      await loadMyGadgetsData();
      navigateStudent('gadgets');
    } else {
      await SwalHelper.error('Update Failed', res.error || 'Could not cancel missing report.');
    }
  } catch (err) {
    await SwalHelper.error('Action Failed', err.message || 'Error cancelling missing report.');
  }
}

// Lost Gadget Status & Campus Board Screen
async function loadLostStatusScreen() {
  const activeContainer = document.getElementById('my-active-missing-list');
  const boardContainer = document.getElementById('campus-missing-board-grid');

  let scansData = [];
  try {
    const scanRes = await api.getMyScanHistory();
    scansData = scanRes.scans || [];
  } catch (e) {}

  const myMissing = myGadgetsData.filter(g => g.status === 'MISSING');
  if (activeContainer) {
    if (myMissing.length === 0) {
      activeContainer.innerHTML = `
        <div style="background: #f8fafc; border: 1px solid var(--card-border); border-radius: var(--radius-md); padding: 24px; text-align: center;">
          <div style="font-size: 1.5rem; margin-bottom: 4px;">🛡️</div>
          <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">None of your devices are currently missing</div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">All your registered equipment is safe.</div>
        </div>
      `;
    } else {
      activeContainer.innerHTML = myMissing.map(g => {
        const scansForGadget = scansData.filter(s => s.gadgetId === g.id);
        const scansCount = scansForGadget.length;

        let scansListHtml = '';
        if (scansCount > 0) {
          scansListHtml = `
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #fecaca; width: 100%;">
              <div style="font-weight: 700; font-size: 0.8rem; color: #991b1b; margin-bottom: 6px;">📍 Recent QR Scan Alerts (${scansCount}):</div>
              <div style="display: flex; flex-direction: column; gap: 6px;">
                ${scansForGadget.map(s => `
                  <div style="background: #ffffff; border: 1px solid #fed7aa; border-radius: 8px; padding: 8px 12px; font-size: 0.78rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 4px;">
                    <div>
                      <strong style="color: #b91c1c;">📍 ${escapeHtml(s.scanLocationNote || 'Location unavailable')}</strong>
                      ${s.locationSource === 'GPS' ? '<span style="background:#ecfdf5; color:#047857; font-size:0.68rem; font-weight:700; border:1px solid #a7f3d0; border-radius:4px; padding:1px 5px; margin-left:6px;">GPS</span>' : (s.locationSource === 'IP' ? '<span style="background:#eff6ff; color:#1e40af; font-size:0.68rem; font-weight:700; border:1px solid #bfdbfe; border-radius:4px; padding:1px 5px; margin-left:6px;">Estimated Area</span>' : '')}
                      <span style="color: #64748b; margin-left: 6px;">(${escapeHtml(s.deviceInfo || 'Mobile Browser')})</span>
                    </div>
                    <div style="color: #64748b; font-size: 0.74rem;">${formatDate(s.scannedAt)}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }

        const isAwaitingOsaHandover = Boolean(
          g.custodyStatus === 'PENDING_OSA_TURNOVER' || 
          g.surrenderStatus === 'WILL_SURRENDER_TO_OSA' || 
          (g.surrenderInfo && (g.surrenderInfo.status === 'AWAITING OSA HANDOVER' || g.surrenderInfo.status === 'PENDING_OSA_TURNOVER'))
        );

        let finderCardHtml = '';
        const chatsList = (Array.isArray(g.finderChats) && g.finderChats.length > 0) 
          ? g.finderChats 
          : (g.finderInfo ? [g.finderInfo] : []);

        if (chatsList.length > 0) {
          finderCardHtml = chatsList.map(fc => {
            const finderDisplayName = escapeHtml(fc.finderName || 'Finder');
            const foundLocationText = escapeHtml(fc.foundLocation || 'Campus');
            const deviceDisplayName = escapeHtml(`${g.brand} ${g.model}`);
            const chatId = fc.chatId || fc.id || '';
            const btnLabel = chatsList.length > 1 ? `💬 Chat / Message ${finderDisplayName}` : '💬 Chat / Message Finder';

            return `
              <div style="background: #ecfdf5; border: 1.5px solid #a7f3d0; border-radius: 12px; padding: 16px; margin-top: 10px; text-align: left;">
                <div style="font-weight: 800; color: #047857; font-size: 0.92rem; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span>🌟</span> Someone Found Your Gadget!
                  </div>
                  <span style="background: #d1fae5; color: #065f46; font-size: 0.72rem; font-weight: 800; padding: 3px 8px; border-radius: 6px; border: 1px solid #a7f3d0;">
                    Keeping Gadget Safe
                  </span>
                </div>

                <!-- Finder Information (Section E: Strictly no contact number) -->
                <div style="font-size: 0.84rem; color: #065f46; line-height: 1.6; background: #ffffff; border: 1px solid #d1fae5; border-radius: 10px; padding: 14px; margin-bottom: 0;">
                  <div>👤 <strong>Finder:</strong> ${finderDisplayName}</div>
                  <div>📍 <strong>Found Location:</strong> ${foundLocationText}</div>
                  <div>📋 <strong>Finder Action:</strong> Keeping Gadget Safe</div>
                  ${fc.message ? `<div style="margin-top: 4px; font-style: italic; color: #475569;">📝 Notes: "${escapeHtml(fc.message)}"</div>` : ''}
                  <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #d1fae5;">
                    <button class="btn btn-primary btn-sm" onclick="openOwnerRecoveryChat('${chatId}', '${g.id}', '${finderDisplayName}', '${deviceDisplayName}', '${foundLocationText}')" style="background: #142a6d; border-color: #142a6d; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; padding: 7px 15px;">
                      ${btnLabel}
                    </button>
                  </div>
                </div>
              </div>
            `;
          }).join('');
        }

        let surrenderCardHtml = '';
        if (isAwaitingOsaHandover || g.surrenderInfo) {
          const sRef = escapeHtml(g.surrenderInfo?.surrenderReference || g.pendingSurrenderRef || '');
          const sLoc = escapeHtml(g.surrenderInfo?.foundLocation || 'Campus');
          surrenderCardHtml = `
            <div class="surrender-status-card" style="background: #eff6ff; border: 1.5px solid #93c5fd; border-radius: 12px; padding: 16px; margin-top: 10px; text-align: left; box-shadow: 0 2px 8px rgba(30,58,138,0.04);">
              <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 1.25rem;">🏢</span>
                  <strong style="color: #1e40af; font-size: 0.96rem;">Finder Surrender in Progress</strong>
                </div>
                <span style="background: #fef3c7; color: #92400e; font-size: 0.74rem; font-weight: 800; padding: 4px 10px; border-radius: 999px; border: 1px solid #fde68a; text-transform: uppercase; letter-spacing: 0.03em;">
                  AWAITING OSA HANDOVER
                </span>
              </div>
              <div style="font-size: 0.85rem; color: #1e3a8a; line-height: 1.6; background: #ffffff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 14px;">
                <p style="margin: 0 0 8px; font-weight: 600; font-size: 0.88rem; color: #1e40af;">
                  The finder has decided to surrender your gadget to OSA. Awaiting physical handover.
                </p>
                <div style="display: grid; gap: 6px; font-size: 0.82rem; color: #334155; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #cbd5e1;">
                  <div>📍 <strong>Found Location:</strong> ${sLoc}</div>
                  ${sRef ? `<div>📋 <strong>Case Reference:</strong> <span class="font-mono" style="color: #1e40af; font-weight: 700;">${sRef}</span></div>` : ''}
                  <div>🏢 <strong>Turnover Destination:</strong> Office of Student Affairs (OSA Room 1109)</div>
                  <div style="color: #64748b; font-style: italic; margin-top: 2px;">
                    Once OSA physically receives and confirms possession of the gadget, its status will be updated to IN OSA CUSTODY / READY FOR CLAIM.
                  </div>
                </div>
                ${g.closedChatInfo ? `
                  <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #cbd5e1;">
                    <button class="btn btn-secondary btn-sm" onclick="openOwnerRecoveryChat('${g.closedChatInfo.chatId}', '${g.id}', '${escapeHtml(g.closedChatInfo.finderName || 'Finder')}', '${escapeHtml(g.brand + ' ' + g.model)}', '${escapeHtml(g.closedChatInfo.foundLocation || 'Campus')}')" style="font-size: 0.78rem; display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; font-weight: 600;">
                      💬 View Closed Conversation (Read-Only)
                    </button>
                  </div>
                ` : ''}
              </div>
            </div>
          `;
        }

        // Action buttons: "I Found My Gadget / Cancel Alert" is removed ONLY for this gadget if awaiting OSA handover
        let actionButtonsHtml = `<button class="btn btn-secondary btn-sm" onclick="openGadgetDetailsModal('${g.id}')">View Details</button>`;
        if (!isAwaitingOsaHandover) {
          actionButtonsHtml += ` <button class="btn btn-success btn-sm" onclick="cancelMissingReportFor('${g.missingReport?.id || g.id}')">✅ I Found My Device (Cancel Alert)</button>`;
        }

        return `
          <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-radius: var(--radius-md); padding: 18px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
              <div>
                <div style="font-weight: 800; font-size: 1.05rem; color: #b91c1c;">${escapeHtml(g.brand)} ${escapeHtml(g.model)}</div>
                <div style="font-size: 0.82rem; color: #7f1d1d; margin-top: 2px;">
                  📍 Last Seen: ${escapeHtml(g.missingReport?.lastSeenLocation || 'Campus')}
                </div>
                <div style="font-size: 0.78rem; color: #991b1b; font-weight: 700; margin-top: 4px;">
                  ${isAwaitingOsaHandover ? '🟡 Status: Awaiting OSA Handover' : '🔴 Public Missing Alert: Active'} • Scans: ${scansCount}
                </div>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                ${actionButtonsHtml}
              </div>
            </div>
            ${finderCardHtml}
            ${surrenderCardHtml}
            ${scansListHtml}
          </div>
        `;
      }).join('');
    }
  }

  if (boardContainer) {
    try {
      const res = await api.getActiveMissing();
      const reports = res.reports || [];

      if (reports.length === 0) {
        boardContainer.innerHTML = `<div style="grid-column:1/-1; padding:24px; text-align:center; color:var(--text-muted);">No missing gadgets currently reported across campus.</div>`;
        return;
      }

      boardContainer.innerHTML = reports.map(r => `
        <div class="gadget-item-card">
          <div class="gadget-item-img-box">
            <img src="${r.gadget?.photoUrl || 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500'}" alt="${escapeHtml(r.gadget?.model)}" class="gadget-item-img">
            <div class="gadget-item-status-pill">
              <span class="status-badge MISSING">MISSING</span>
            </div>
          </div>
          <div class="gadget-item-body">
            <div class="gadget-item-title">${escapeHtml(r.gadget?.brand)} ${escapeHtml(r.gadget?.model)}</div>
            <div style="font-size: 0.8rem; color: #b91c1c; font-weight: 600; margin-bottom: 6px;">
              📍 Last Seen: ${escapeHtml(r.lastSeenLocation)}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.4;">
              "${escapeHtml(r.details || 'Reported lost on campus grounds.')}"
            </div>
            <div class="gadget-item-footer">
              <a href="/device/${r.gadget?.secureToken}" target="_blank" class="btn btn-warning btn-sm" style="width: 100%; font-weight: 700; text-align: center;" title="Found this item? Click to submit a surrender report to OSA Room 1109.">
                📢 Found This? Surrender to OSA
              </a>
            </div>
          </div>
        </div>
      `).join('');
    } catch (e) {}
  }
}

// Return Date & Time Formatter in Philippine Standard Time (PHT)
function formatReturnDateTime(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(d);
  } catch (e) {
    return '—';
  }
}

// Return History Screen (Consolidated Single Table)
async function loadClaimsScreen(openReturnIdOnLoad = null) {
  const container = document.getElementById('student-returns-table-container');
  if (!container) return;

  try {
    container.innerHTML = `<div style="padding:32px; text-align:center; color:var(--text-muted);"><div class="spinner"></div><div style="margin-top:8px;">Loading Return History...</div></div>`;

    const res = await api.getReturns();
    const rawReturns = (res && res.returns) ? res.returns : [];

    // Deduplicate genuine return records by unique return transaction ID
    const genuineReturns = [];
    const seenTxIds = new Set();

    for (const r of rawReturns) {
      const txId = r.id || r.returnId;
      if (txId) {
        if (seenTxIds.has(txId)) continue;
        seenTxIds.add(txId);
      }
      genuineReturns.push(r);
    }

    // Sort by return date descending
    genuineReturns.sort((a, b) => {
      const timeA = new Date(a.returnDate || a.returnedAt || a.processedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.returnDate || b.returnedAt || b.processedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    window._studentReturnsList = genuineReturns;

    if (genuineReturns.length === 0) {
      container.innerHTML = `
        <div style="padding: 48px 20px; text-align: center; color: var(--text-muted);">
          <div style="font-size: 2.5rem; margin-bottom: 10px;">📜</div>
          <div style="font-weight: 700; font-size: 1.05rem; color: #1e293b;">No gadget return records on file.</div>
          <p style="font-size: 0.825rem; color: #64748b; max-width: 440px; margin: 6px auto 0;">
            When a missing or turned-in gadget is officially returned to you by the Office of Student Affairs (OSA Room 1109), official return receipts and verified handover details will be recorded here.
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="overflow-x: auto;">
        <table class="clean-table" style="min-width: 700px;">
          <thead>
            <tr>
              <th style="min-width: 220px;">Gadget</th>
              <th style="min-width: 190px;">Return Date &amp; Time (PHT)</th>
              <th style="min-width: 140px;">Status</th>
              <th class="text-right" style="min-width: 130px;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${genuineReturns.map(r => {
              const brandModel = `${r.gadget?.brand || ''} ${r.gadget?.model || 'Gadget'}`.trim();
              const category = r.gadget?.category || '';
              const color = r.gadget?.color || '';
              const gadgetId = r.gadgetId || r.gadget?.id || '';
              const serialNo = r.gadget?.serialNumber || '';
              const returnDate = r.returnDate || r.returnedAt || r.processedAt || r.createdAt;
              const formattedDate = formatReturnDateTime(returnDate);
              const receiptId = r.id || r.returnId || 'RECEIPT';

              return `
                <tr id="return-row-${escapeHtml(receiptId)}">
                  <td>
                    <div style="font-weight: 700; font-size: 0.92rem; color: #0f172a;">${escapeHtml(brandModel)}</div>
                    <div style="display: flex; gap: 6px; align-items: center; margin-top: 3px; font-size: 0.775rem; color: #64748b;">
                      ${category ? `<span>${escapeHtml(category)}</span>` : ''}
                      ${category && color ? `<span>•</span>` : ''}
                      ${color ? `<span>Color: ${escapeHtml(color)}</span>` : ''}
                    </div>
                    ${(gadgetId || serialNo) ? `
                      <div class="font-mono" style="font-size: 0.72rem; color: #94a3b8; margin-top: 3px;">
                        ${gadgetId ? `ID: ${escapeHtml(gadgetId)}` : ''}
                        ${gadgetId && serialNo ? ` • ` : ''}
                        ${serialNo ? `S/N: ${escapeHtml(serialNo)}` : ''}
                      </div>
                    ` : ''}
                  </td>
                  <td>
                    <div style="font-weight: 700; font-size: 0.85rem; color: #1e293b;">
                      ${formattedDate}
                    </div>
                    <div class="font-mono" style="font-size: 0.73rem; color: #059669; font-weight: 600; margin-top: 2px;">
                      Ref: ${escapeHtml(receiptId)}
                    </div>
                  </td>
                  <td>
                    <span class="status-badge" style="background: #ecfdf5; color: #047857; font-weight: 800; font-size: 0.74rem; padding: 4px 10px; border: 1px solid #a7f3d0; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
                      ✓ RETURNED
                    </span>
                    <div style="font-size: 0.7rem; color: #059669; font-weight: 600; margin-top: 2px;">Handover Complete</div>
                  </td>
                  <td class="text-right">
                    <button class="btn btn-primary btn-sm" onclick="openStudentReturnReceiptModal('${escapeHtml(receiptId)}')" style="font-size: 0.78rem; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; padding: 5px 12px; background: #142a6d; border-color: #142a6d;">
                      🧾 View Receipt
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Also clear legacy hidden claimsContainer if present to prevent any issues
    const claimsContainer = document.getElementById('student-claims-table-container');
    if (claimsContainer && claimsContainer !== container) {
      claimsContainer.innerHTML = '';
    }

    if (openReturnIdOnLoad) {
      openStudentReturnReceiptModal(openReturnIdOnLoad);
    }
  } catch (err) {
    console.error('Error loading student return history:', err);
    container.innerHTML = `<div style="padding:24px; text-align:center; color:#dc2626;">Failed to load return history records. Please try again.</div>`;
  }
}

// Modal: Open Official Return Receipt
async function openStudentReturnReceiptModal(returnId) {
  let record = null;
  if (window._studentReturnsList && window._studentReturnsList.length > 0) {
    record = window._studentReturnsList.find(r => (r.id === returnId || r.returnId === returnId));
  }

  if (!record) {
    try {
      const res = await api.getReturns();
      const returns = (res && res.returns) ? res.returns : [];
      window._studentReturnsList = returns;
      record = returns.find(r => (r.id === returnId || r.returnId === returnId));
    } catch (e) {}
  }

  // If still not found, check if returnId was omitted or passed null/empty, pick first available
  if (!record && window._studentReturnsList && window._studentReturnsList.length > 0) {
    record = window._studentReturnsList[0];
  }

  if (!record) {
    showToast('error', 'Receipt Not Found', 'Could not locate the requested return receipt.');
    return;
  }

  const receiptRef = record.id || record.returnId || 'RET-ACK';
  const brandModel = `${record.gadget?.brand || ''} ${record.gadget?.model || 'Gadget'}`.trim();
  const category = record.gadget?.category || 'Electronic Device';
  const color = record.gadget?.color || 'Standard';
  const gadgetId = record.gadgetId || record.gadget?.id || '—';
  const serialNo = record.gadget?.serialNumber || '—';
  const returnDate = record.returnDate || record.returnedAt || record.processedAt || record.createdAt;
  const staffName = record.returnedByAdmin || record.returnedByOsaAdminName || record.processedByName || 'OSA Staff';
  const recipientName = record.receivedByPersonName || record.owner?.name || 'Verified Student Owner';
  const recipientId = record.receivedByPersonId || record.ownerStudentId || record.owner?.idNumber || 'Verified ID';
  const notes = record.notes || 'Official gadget return handover completed at OSA Room 1109.';
  const handoverPhoto = record.handoverPhotoUrl || null;

  // Set modal elements
  const refEl = document.getElementById('receipt-modal-ref');
  const gNameEl = document.getElementById('receipt-modal-gadget-name');
  const gMetaEl = document.getElementById('receipt-modal-gadget-meta');
  const gIdEl = document.getElementById('receipt-modal-gadget-id');
  const serialEl = document.getElementById('receipt-modal-serial');
  const dateEl = document.getElementById('receipt-modal-date');
  const staffEl = document.getElementById('receipt-modal-staff');
  const recNameEl = document.getElementById('receipt-modal-recipient-name');
  const recIdEl = document.getElementById('receipt-modal-recipient-id');
  const notesEl = document.getElementById('receipt-modal-notes');

  if (refEl) refEl.textContent = receiptRef;
  if (gNameEl) gNameEl.textContent = brandModel;
  if (gMetaEl) gMetaEl.textContent = `${category}${color ? ` • Color: ${color}` : ''}`;
  if (gIdEl) gIdEl.textContent = gadgetId;
  if (serialEl) serialEl.textContent = serialNo;
  if (dateEl) dateEl.textContent = formatReturnDateTime(returnDate);
  if (staffEl) staffEl.textContent = staffName;
  if (recNameEl) recNameEl.textContent = recipientName;
  if (recIdEl) recIdEl.textContent = recipientId;
  if (notesEl) notesEl.textContent = notes;

  const photoImg = document.getElementById('receipt-modal-photo-img');
  const noPhotoDiv = document.getElementById('receipt-modal-no-photo');
  const photoCaption = document.getElementById('receipt-modal-photo-caption');

  if (handoverPhoto) {
    if (photoImg) {
      photoImg.src = handoverPhoto;
      photoImg.style.display = 'inline-block';
    }
    if (noPhotoDiv) noPhotoDiv.style.display = 'none';
    if (photoCaption) photoCaption.style.display = 'block';
  } else {
    if (photoImg) {
      photoImg.src = '';
      photoImg.style.display = 'none';
    }
    if (noPhotoDiv) noPhotoDiv.style.display = 'block';
    if (photoCaption) photoCaption.style.display = 'none';
  }

  const modal = document.getElementById('student-return-receipt-modal');
  if (modal) modal.classList.add('active');
}

// Helper: Open Return Receipt directly from notification
async function openStudentReturnReceiptForNotif(notif, targetReturnId) {
  try {
    const res = await api.getReturns();
    const returns = (res && res.returns) ? res.returns : [];
    window._studentReturnsList = returns;

    let match = null;
    if (targetReturnId) {
      match = returns.find(r => r.id === targetReturnId || r.returnId === targetReturnId);
    }
    if (!match && notif?.gadgetId) {
      match = returns.find(r => (r.gadgetId === notif.gadgetId || r.gadget?.id === notif.gadgetId));
    }
    if (!match && returns.length > 0) {
      match = returns[0];
    }

    if (match) {
      openStudentReturnReceiptModal(match.id);
    }
  } catch (e) {
    console.error('Error opening return receipt from notification:', e);
  }
}

// Claims Submit Modal
function openSubmitClaimModal(gadgetId, gadgetName) {
  document.getElementById('claim-gadget-id').value = gadgetId;
  document.getElementById('claim-gadget-name').value = gadgetName;
  
  const user = api.getCurrentUser();
  if (user) {
    document.getElementById('claim-id-number').value = user.idNumber;
  }
  document.getElementById('submit-claim-modal').classList.add('active');
}

async function handleClaimSubmit(e) {
  e.preventDefault();
  const gadgetId = document.getElementById('claim-gadget-id').value;
  const claimProofDetails = document.getElementById('claim-proof').value.trim();
  const verificationIdType = document.getElementById('claim-id-type').value;
  const verificationIdNumber = document.getElementById('claim-id-number').value.trim();

  if (!claimProofDetails) {
    await SwalHelper.warning('Proof Details Required', 'Please describe identifying marks, stickers, wallpapers, or proof of purchase.');
    return;
  }

  const confirmClaim = await SwalHelper.confirm({
    title: 'Submit Ownership Claim?',
    text: 'Submit this claim to the NCST Office of Student Affairs for verification and scheduled handover?',
    icon: 'question',
    confirmText: 'Yes, Submit Claim',
    cancelText: 'Review Form',
    confirmColor: '#142a6d'
  });

  if (!confirmClaim) return;

  try {
    const res = await api.submitClaim({
      gadgetId,
      claimProofDetails,
      verificationIdType,
      verificationIdNumber
    });
    closeModal('submit-claim-modal');
    await SwalHelper.success('Claim Submitted! 📋', `Claim ID ${res.claim ? res.claim.id : ''} recorded. OSA will review your verification proof at Room 1109.`, 2400);
    navigateStudent('claims');
  } catch (err) {
    await SwalHelper.error('Claim Submission Failed', err.message || 'Unable to submit claim.');
  }
}

// Notifications Feed & Collapsible Accordion System
const expandedNotificationIds = new Set();
let studentNotifsCache = [];

async function loadNotificationsFeed() {
  const container = document.getElementById('student-notifications-feed');
  const badge = document.getElementById('badge-notif-count');

  try {
    const res = await api.getNotifications();
    studentNotifsCache = res.notifications || [];
    const unread = res.unreadCount || 0;

    if (badge) {
      if (unread > 0) {
        badge.textContent = unread;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }

    if (!container) return;

    if (studentNotifsCache.length === 0) {
      container.innerHTML = `
        <div style="padding: 44px 20px; text-align: center; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">📭</div>
          <h4 style="font-weight: 700; color: var(--text-main); margin-bottom: 4px;">No notifications yet</h4>
          <p style="font-size: 0.825rem;">You are completely up to date.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="notif-accordion-container">
        ${studentNotifsCache.map(n => renderNotificationCard(n)).join('')}
      </div>
    `;
  } catch (e) {
    console.error('Error loading notifications feed:', e);
  }
}

function renderNotificationCard(n) {
  const isExpanded = expandedNotificationIds.has(n.id);
  const isUnread = !n.read;
  const icon = getNotifIcon(n.type, n.title);

  return `
    <div class="notif-accordion-card ${isUnread ? 'unread' : 'read'} ${isExpanded ? 'expanded' : ''}" id="notif-card-${n.id}">
      <div class="notif-header-row" onclick="toggleNotificationItem('${n.id}', event)" role="button" aria-expanded="${isExpanded}">
        <div class="notif-header-left">
          <div class="notif-icon-badge">${icon}</div>
          <div class="notif-title-area">
            <span class="notif-title-text" title="${escapeHtml(n.title)}">${escapeHtml(n.title)}</span>
            ${isUnread ? `<span class="notif-unread-dot" id="notif-dot-${n.id}" title="Unread notification"></span>` : ''}
          </div>
        </div>
        <div class="notif-header-right">
          <span class="notif-timestamp-text">${formatDate(n.createdAt)}</span>
          <span class="notif-chevron-wrap" aria-hidden="true">
            <svg class="notif-chevron-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
        </div>
      </div>
      <div class="notif-collapse-body" id="notif-body-${n.id}">
        <div class="notif-collapse-inner">
          <div class="notif-details-content">
            <div class="notif-message-text">
              ${renderFormattedNotificationMessage(n.message)}
            </div>
            ${renderNotificationActions(n)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderFormattedNotificationMessage(msg) {
  if (!msg) return '';
  const lines = msg.split('\n').map(l => l.trim());
  
  let html = '';
  let metaRows = [];
  let currentParagraph = [];

  function flushParagraph() {
    if (currentParagraph.length > 0) {
      html += `<p style="margin: 0 0 8px 0; line-height: 1.55;">${currentParagraph.join(' ')}</p>`;
      currentParagraph = [];
    }
  }

  function flushMeta() {
    if (metaRows.length > 0) {
      html += `<div class="notif-meta-block">${metaRows.join('')}</div>`;
      metaRows = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      flushParagraph();
      flushMeta();
      continue;
    }

    if (line.includes('Safety & Liability Notice') || line.includes('Safety Notice')) {
      flushParagraph();
      flushMeta();
      html += `<div class="notif-notice-card">⚠️ <strong>Safety Notice:</strong> ${escapeHtml(line.replace(/^[⚠️\s]*Safety\s*(&|and)?\s*Liability\s*Notice:?/i, '').trim())}</div>`;
      continue;
    }

    const matchMeta = line.match(/^(Device|Custody Location|Finder Name|Found Location|Approximate Location|Device Info|Audit IP|Reason|Reference No|Claim Status):\s*(.+)$/i);
    if (matchMeta) {
      flushParagraph();
      metaRows.push(`
        <div class="notif-meta-row">
          <span class="notif-meta-label">${escapeHtml(matchMeta[1])}:</span>
          <span class="notif-meta-val">${escapeHtml(matchMeta[2])}</span>
        </div>
      `);
      continue;
    }

    flushMeta();
    currentParagraph.push(escapeHtml(line));
  }

  flushParagraph();
  flushMeta();

  return html;
}

function renderNotificationActions(n) {
  const isFoundNotif = n.title === 'Someone Found Your Gadget' || n.type === 'CHAT_MESSAGE';
  const hasCustody = n.title?.includes('Custody') || n.type === 'GADGET_FOUND';
  const isMissing = n.type === 'MISSING_ALERT' || n.title?.includes('Missing');

  let buttons = [];

  if (isFoundNotif) {
    buttons.push(`
      <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); handleNotifActionClick('${n.id}', 'chat')" style="font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">
        💬 Open Chat / Message Finder
      </button>
    `);
  }

  if (hasCustody) {
    buttons.push(`
      <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); handleNotifActionClick('${n.id}', 'claims')" style="background: #059669; border-color: #059669; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">
        📋 View Claims / Handover History
      </button>
    `);
  }

  if (isMissing && !isFoundNotif) {
    buttons.push(`
      <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); handleNotifActionClick('${n.id}', 'lost-status')" style="font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
        🚨 Lost Gadget Status
      </button>
    `);
  }

  if (n.linkUrl && !isFoundNotif && !hasCustody && !isMissing) {
    buttons.push(`
      <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); handleNotifActionClick('${n.id}', '${n.linkUrl}')" style="font-weight: 600; display: inline-flex; align-items: center; gap: 6px;">
        🔗 View Details
      </button>
    `);
  }

  if (buttons.length === 0) return '';
  return `<div class="notif-actions-bar">${buttons.join('')}</div>`;
}

function getNotifIcon(type, title = '') {
  const t = title || '';
  if (t.includes('Returned')) return '✨';
  if (t.includes('Custody') || type === 'GADGET_FOUND') return '🌟';
  if (t.includes('Missing') || type === 'MISSING_ALERT') return '🚨';
  if (t.includes('Approved') || type === 'REGISTRATION_APPROVED') return '🎉';
  if (t.includes('Submitted') || t.includes('Review')) return '🛡️';
  if (t.includes('Scanned') || type === 'QR_SCANNED') return '📍';
  if (t.includes('Found') || type === 'CHAT_MESSAGE') return '💬';
  if (type === 'CLAIM_APPROVED') return '📦';
  if (type === 'REGISTRATION_REJECTED' || type === 'CLAIM_REJECTED') return '⚠️';
  if (type === 'RETURNED_SUCCESS') return '✨';
  if (type === 'SYSTEM') return '🛡️';

  const icons = {
    REGISTRATION_APPROVED: '🎉',
    REGISTRATION_REJECTED: '⚠️',
    MISSING_ALERT: '🚨',
    QR_SCANNED: '📍',
    GADGET_FOUND: '🌟',
    CLAIM_APPROVED: '📦',
    CLAIM_REJECTED: '❌',
    RETURNED_SUCCESS: '✨',
    SYSTEM: '🛡️',
    CHAT_MESSAGE: '💬'
  };
  return icons[type] || '🔔';
}

async function toggleNotificationItem(id, event) {
  if (event) event.stopPropagation();

  const card = document.getElementById(`notif-card-${id}`);
  if (!card) return;

  const isCurrentlyExpanded = card.classList.contains('expanded');

  if (isCurrentlyExpanded) {
    // Collapse clicked notification
    card.classList.remove('expanded');
    card.querySelector('.notif-header-row')?.setAttribute('aria-expanded', 'false');
    expandedNotificationIds.delete(id);
  } else {
    // Expand clicked notification
    card.classList.add('expanded');
    card.querySelector('.notif-header-row')?.setAttribute('aria-expanded', 'true');
    expandedNotificationIds.add(id);

    // If unread, mark as read
    if (card.classList.contains('unread')) {
      card.classList.remove('unread');
      card.classList.add('read');

      const dot = document.getElementById(`notif-dot-${id}`);
      if (dot) dot.remove();

      // Decrement sidebar unread badge
      const badge = document.getElementById('badge-notif-count');
      if (badge && badge.style.display !== 'none') {
        let currentCount = parseInt(badge.textContent) || 0;
        currentCount = Math.max(0, currentCount - 1);
        if (currentCount > 0) {
          badge.textContent = currentCount;
        } else {
          badge.style.display = 'none';
        }
      }

      // Mark as read in server & memory cache
      const cached = studentNotifsCache.find(n => n.id === id);
      if (cached) cached.read = true;

      try {
        await api.markNotificationRead(id);
      } catch (err) {
        console.warn('Error marking notification read:', err);
      }
    }
  }
}

async function handleNotifActionClick(id, actionTarget) {
  const notif = (studentNotifsCache || []).find(n => n.id === id);
  const isReturnNotif = (notif && (notif.type === 'RETURNED_SUCCESS' || (notif.title && notif.title.toLowerCase().includes('returned')))) ||
                        (actionTarget && (actionTarget.includes('returns') || actionTarget.includes('return')));

  if (isReturnNotif) {
    let targetReturnId = notif?.returnId;
    if (!targetReturnId && actionTarget && actionTarget.includes('id=')) {
      try {
        const match = actionTarget.match(/id=([a-zA-Z0-9_\-]+)/);
        if (match) targetReturnId = match[1];
      } catch (e) {}
    }

    // Navigate to Return History screen (student-screen-claims)
    navigateStudent('claims');

    // Automatically open the verified return receipt modal
    await openStudentReturnReceiptForNotif(notif, targetReturnId);
    return;
  }

  if (actionTarget === 'chat') {
    navigateStudent('lost-status');
    const myMissingWithFinder = myGadgetsData.find(g => g.status === 'MISSING' && g.finderInfo);
    if (myMissingWithFinder && myMissingWithFinder.finderInfo) {
      openOwnerRecoveryChat(
        myMissingWithFinder.finderInfo.chatId || '',
        myMissingWithFinder.id,
        myMissingWithFinder.finderInfo.finderName || 'Finder',
        `${myMissingWithFinder.brand} ${myMissingWithFinder.model}`,
        myMissingWithFinder.finderInfo.foundLocation || 'Campus'
      );
    }
  } else if (actionTarget === 'claims') {
    navigateStudent('claims');
  } else if (actionTarget === 'lost-status') {
    navigateStudent('lost-status');
  } else if (actionTarget) {
    let targetHash = actionTarget.split('#')[1] || actionTarget;
    if (targetHash.includes('?')) {
      targetHash = targetHash.split('?')[0];
    }
    if (targetHash === 'scans') targetHash = 'lost-status';
    if (targetHash === 'returns' || targetHash === 'return-history') targetHash = 'claims';
    if (targetHash.startsWith('/')) targetHash = targetHash.replace(/^\//, '');
    if (targetHash) navigateStudent(targetHash);
  }
}

async function markAllNotificationsRead() {
  try {
    await api.markAllNotificationsRead();
    showToast('info', 'Updated', 'All notifications marked as read.');
    
    // Smoothly update existing cards without collapsing active items
    studentNotifsCache.forEach(n => { n.read = true; });
    const cards = document.querySelectorAll('.notif-accordion-card.unread');
    cards.forEach(c => {
      c.classList.remove('unread');
      c.classList.add('read');
    });
    const dots = document.querySelectorAll('.notif-unread-dot');
    dots.forEach(d => d.remove());

    const badge = document.getElementById('badge-notif-count');
    if (badge) badge.style.display = 'none';
  } catch (e) {
    console.error('Error marking all notifications read:', e);
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

// ==========================================
// OWNER RECOVERY CHAT LOGIC (Section C, E, H)
// ==========================================
let activeOwnerChatId = null;
let activeOwnerGadgetId = null;
let activeOwnerChatInterval = null;

async function openOwnerRecoveryChat(chatId, gadgetId, finderName, deviceName, foundLocation) {
  activeOwnerChatId = chatId;
  activeOwnerGadgetId = gadgetId;

  const finderTitle = document.getElementById('owner-chat-finder-title');
  const deviceTitle = document.getElementById('owner-chat-device-title');
  const locTitle = document.getElementById('owner-chat-location-title');

  if (finderTitle) finderTitle.textContent = finderName || 'Finder';
  if (deviceTitle) deviceTitle.textContent = deviceName || 'Missing Gadget';
  if (locTitle) locTitle.textContent = foundLocation || 'Campus';

  document.getElementById('owner-recovery-chat-modal').classList.add('active');

  // If chatId is not provided directly, lookup by gadget
  if (!activeOwnerChatId && gadgetId) {
    try {
      const res = await api.getRecoveryChatByGadget(gadgetId);
      if (res.chat) {
        activeOwnerChatId = res.chat.id;
        if (finderTitle) finderTitle.textContent = res.chat.finderName || 'Finder';
        if (locTitle) locTitle.textContent = res.chat.foundLocation || 'Campus';
      }
    } catch (e) {}
  }

  loadOwnerChatMessages();

  if (activeOwnerChatInterval) clearInterval(activeOwnerChatInterval);
  activeOwnerChatInterval = setInterval(loadOwnerChatMessages, 3500);
}

function closeOwnerRecoveryChat() {
  if (activeOwnerChatInterval) {
    clearInterval(activeOwnerChatInterval);
    activeOwnerChatInterval = null;
  }
  closeModal('owner-recovery-chat-modal');
}

async function loadOwnerChatMessages() {
  if (!activeOwnerChatId) {
    if (activeOwnerGadgetId) {
      try {
        const res = await api.getRecoveryChatByGadget(activeOwnerGadgetId);
        if (res.chat) {
          activeOwnerChatId = res.chat.id;
        }
      } catch (e) {
        return;
      }
    } else {
      return;
    }
  }

  try {
    const res = await api.getRecoveryChat(activeOwnerChatId);
    const chat = res.chat;
    const msgContainer = document.getElementById('owner-chat-messages');
    const closedBanner = document.getElementById('owner-chat-closed-banner');
    const chatForm = document.getElementById('owner-chat-form');

    if (!msgContainer) return;

    if (chat.isClosed) {
      if (closedBanner) {
        closedBanner.style.display = 'block';
        const isSurrendered = Boolean(
          chat.closedReason === 'SURRENDERED_TO_OSA' || 
          (chat.gadget && (chat.gadget.custodyStatus === 'PENDING_OSA_TURNOVER' || chat.gadget.surrenderStatus === 'WILL_SURRENDER_TO_OSA'))
        );
        if (isSurrendered) {
          closedBanner.innerHTML = '🔒 The finder has decided to surrender your gadget to OSA. Awaiting physical handover.';
        } else {
          closedBanner.innerHTML = '🔒 This recovery conversation is closed because the gadget has been marked recovered or returned.';
        }
      }
      if (chatForm) chatForm.style.display = 'none';
      if (activeOwnerChatInterval) {
        clearInterval(activeOwnerChatInterval);
        activeOwnerChatInterval = null;
      }
    } else {
      if (closedBanner) closedBanner.style.display = 'none';
      if (chatForm) chatForm.style.display = 'flex';
    }

    if (!chat.messages || chat.messages.length === 0) {
      msgContainer.innerHTML = `
        <div style="margin: auto; text-align: center; color: #64748b; font-size: 0.84rem; padding: 20px;">
          <div style="font-size: 1.8rem; margin-bottom: 6px;">💬</div>
          <div style="font-weight: 700;">Safe Recovery Chat Initialized</div>
          <p style="font-size: 0.78rem; margin-top: 4px;">Send a message to coordinate with the finder.</p>
        </div>
      `;
      return;
    }

    const shouldScroll = (msgContainer.scrollHeight - msgContainer.scrollTop <= msgContainer.clientHeight + 60);

    msgContainer.innerHTML = chat.messages.map(m => {
      const isMine = m.senderRole === 'OWNER';
      return `
        <div style="display: flex; flex-direction: column; max-width: 82%; align-self: ${isMine ? 'flex-end' : 'flex-start'}; align-items: ${isMine ? 'flex-end' : 'flex-start'};">
          <div style="font-weight: 700; font-size: 0.72rem; margin-bottom: 2px; color: #475569;">
            ${escapeHtml(m.senderLabel)}
          </div>
          <div style="padding: 9px 13px; border-radius: 14px; font-size: 0.86rem; line-height: 1.45; word-break: break-word; text-align: left; background: ${isMine ? '#142a6d' : '#ffffff'}; color: ${isMine ? '#ffffff' : '#0f172a'}; border: ${isMine ? 'none' : '1px solid #cbd5e1'}; ${isMine ? 'border-bottom-right-radius: 2px;' : 'border-bottom-left-radius: 2px;'}; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            ${escapeHtml(m.text)}
          </div>
          <div style="font-size: 0.68rem; margin-top: 3px; color: #64748b; ${isMine ? 'text-align: right;' : ''}">
            ${formatChatDate(m.createdAt)}
          </div>
        </div>
      `;
    }).join('');

    if (shouldScroll) {
      msgContainer.scrollTop = msgContainer.scrollHeight;
    }
  } catch (e) {
    console.error('Error polling owner chat:', e);
  }
}

async function handleSendOwnerChatMessage(e) {
  e.preventDefault();
  const input = document.getElementById('owner-chat-input');
  const text = input ? input.value.trim() : '';

  if (!text || !activeOwnerChatId) return;

  input.value = '';

  try {
    await api.sendRecoveryChatMessage(activeOwnerChatId, text);
    await loadOwnerChatMessages();
    const msgContainer = document.getElementById('owner-chat-messages');
    if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
  } catch (err) {
    await SwalHelper.error('Message Not Sent', err.message || 'Could not send message.');
  }
}

function formatChatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' • ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
