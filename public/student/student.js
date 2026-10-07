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
  if (screenName === 'scans') screenName = 'lost-status';

  // Hide all screens
  document.querySelectorAll('.student-screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.student-nav-item').forEach(i => i.classList.remove('active'));

  const target = document.getElementById(`student-screen-${screenName}`);
  if (target) {
    target.classList.add('active');
    window.location.hash = screenName;
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
    'claims': 'Claim Requests & Handover History',
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
  if (screenName === 'claims') loadClaimsScreen();
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

    // Fetch user claims count
    let totalClaims = 0;
    try {
      const claimsRes = await api.getMyClaims();
      totalClaims = (claimsRes && claimsRes.claims) ? claimsRes.claims.length : 0;
    } catch (e) {}

    // Update Dashboard 4 Metric Cards
    const regEl = document.getElementById('stat-registered-val');
    const misEl = document.getElementById('stat-missing-val');
    const clmEl = document.getElementById('stat-claims-val');
    const retEl = document.getElementById('stat-returned-val');

    if (regEl) regEl.textContent = totalReg;
    if (misEl) misEl.textContent = totalMissing;
    if (clmEl) clmEl.textContent = totalClaims;
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

        let finderCardHtml = '';
        if (g.finderInfo) {
          finderCardHtml = `
            <div style="background: #ecfdf5; border: 1.5px solid #a7f3d0; border-radius: 12px; padding: 16px; margin-top: 10px; text-align: left;">
              <div style="font-weight: 800; color: #047857; font-size: 0.9rem; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                <span>🌟</span> Good Samaritan Contact Information:
              </div>
              <div style="font-size: 0.825rem; color: #065f46; line-height: 1.55; background: #ffffff; border: 1px solid #d1fae5; border-radius: 8px; padding: 12px; margin-bottom: 10px;">
                <div>👤 <strong>Finder Name:</strong> ${escapeHtml(g.finderInfo.finderName)}</div>
                <div>📞 <strong>Contact Number:</strong> <a href="tel:${escapeHtml(g.finderInfo.finderContact)}" style="font-weight: 800; color: #1e40af; text-decoration: underline;">${escapeHtml(g.finderInfo.finderContact)}</a></div>
                ${g.finderInfo.finderEmail ? `<div>✉️ <strong>Email:</strong> <a href="mailto:${escapeHtml(g.finderInfo.finderEmail)}">${escapeHtml(g.finderInfo.finderEmail)}</a></div>` : ''}
                <div>📍 <strong>Found Location:</strong> ${escapeHtml(g.finderInfo.foundLocation)}</div>
                ${g.finderInfo.message ? `<div>📝 <strong>Notes:</strong> "${escapeHtml(g.finderInfo.message)}"</div>` : ''}
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

        return `
          <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-radius: var(--radius-md); padding: 18px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
              <div>
                <div style="font-weight: 800; font-size: 1.05rem; color: #b91c1c;">${escapeHtml(g.brand)} ${escapeHtml(g.model)}</div>
                <div style="font-size: 0.82rem; color: #7f1d1d; margin-top: 2px;">
                  📍 Last Seen: ${escapeHtml(g.missingReport?.lastSeenLocation || 'Campus')}
                </div>
                <div style="font-size: 0.78rem; color: #991b1b; font-weight: 700; margin-top: 4px;">
                  🔴 Public Missing Alert: Active • Scans: ${scansCount}
                </div>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button class="btn btn-secondary btn-sm" onclick="openGadgetDetailsModal('${g.id}')">View Details</button>
                <button class="btn btn-success btn-sm" onclick="cancelMissingReportFor('${g.missingReport?.id || g.id}')">✅ I Found My Device (Cancel Alert)</button>
              </div>
            </div>
            ${finderCardHtml}
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

// Claims Screen
async function loadClaimsScreen() {
  const claimsContainer = document.getElementById('student-claims-table-container');
  const returnsContainer = document.getElementById('student-returns-table-container');

  try {
    const claimsRes = await api.getMyClaims();
    const claims = claimsRes.claims || [];

    if (claimsContainer) {
      if (claims.length === 0) {
        claimsContainer.innerHTML = `<div style="padding:24px; text-align:center; color:var(--text-muted);">No active claim requests submitted.</div>`;
      } else {
        claimsContainer.innerHTML = `
          <table class="clean-table">
            <thead>
              <tr>
                <th>Gadget</th>
                <th>Proof Details</th>
                <th>ID Verification</th>
                <th>Status</th>
                <th>Submitted Date</th>
              </tr>
            </thead>
            <tbody>
              ${claims.map(c => `
                <tr>
                  <td>
                    <div style="font-weight: 700;">${escapeHtml(c.gadget?.brand)} ${escapeHtml(c.gadget?.model)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(c.gadget?.category || '')}</div>
                  </td>
                  <td style="max-width: 250px; font-size: 0.825rem; color: var(--text-secondary);">"${escapeHtml(c.claimProofDetails)}"</td>
                  <td style="font-size: 0.825rem;">${escapeHtml(c.verificationIdType)} (${escapeHtml(c.verificationIdNumber)})</td>
                  <td>${renderStatusBadge(c.status)}</td>
                  <td style="font-size: 0.8rem; color: var(--text-muted);">${formatDate(c.claimDate)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    }

    const returnsRes = await api.getReturns();
    const returns = returnsRes.returns || [];

    if (returnsContainer) {
      if (returns.length === 0) {
        returnsContainer.innerHTML = `<div style="padding:24px; text-align:center; color:var(--text-muted);">No past device returns on record.</div>`;
      } else {
        returnsContainer.innerHTML = `
          <table class="clean-table">
            <thead>
              <tr>
                <th>Receipt ID</th>
                <th>Returned Device</th>
                <th>Received By</th>
                <th>Handover Date</th>
                <th>OSA Officer</th>
              </tr>
            </thead>
            <tbody>
              ${returns.map(r => `
                <tr>
                  <td class="font-mono" style="font-weight: 700; color: #6d28d9;">${escapeHtml(r.id)}</td>
                  <td>
                    <div style="font-weight: 700;">${escapeHtml(r.gadget?.brand)} ${escapeHtml(r.gadget?.model)}</div>
                  </td>
                  <td style="font-size: 0.825rem;">${escapeHtml(r.receivedByPersonName)} (${escapeHtml(r.receivedByPersonId)})</td>
                  <td style="font-size: 0.8rem; color: var(--text-muted);">${formatDate(r.returnDate)}</td>
                  <td style="font-size: 0.825rem; color: var(--primary); font-weight: 600;">${escapeHtml(r.returnedByAdmin)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    }
  } catch (e) {}
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

// Notifications Feed
async function loadNotificationsFeed() {
  const container = document.getElementById('student-notifications-feed');
  const badge = document.getElementById('badge-notif-count');

  try {
    const res = await api.getNotifications();
    const notifs = res.notifications || [];
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

    if (notifs.length === 0) {
      container.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 8px;">📭</div>
          <h4 style="font-weight: 700;">No notifications yet</h4>
          <p style="font-size: 0.8rem;">You are completely up to date.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = notifs.map(n => `
      <div style="padding: 16px; border-bottom: 1px solid var(--card-border); display: flex; gap: 14px; background: ${n.read ? '#ffffff' : '#eff6ff'};" onclick="handleNotificationClick('${n.id}', '${n.linkUrl || ''}')">
        <div style="font-size: 1.4rem; flex-shrink: 0;">${getNotifIcon(n.type)}</div>
        <div style="flex: 1;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span style="font-weight: 700; font-size: 0.9rem; color: var(--text-main);">${escapeHtml(n.title)}</span>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${formatDate(n.createdAt)}</span>
          </div>
          <div style="font-size: 0.825rem; color: var(--text-secondary); line-height: 1.45; white-space: pre-line;">
            ${escapeHtml(n.message)}
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

function getNotifIcon(type) {
  const icons = {
    REGISTRATION_APPROVED: '🎉',
    REGISTRATION_REJECTED: '⚠️',
    MISSING_ALERT: '🚨',
    QR_SCANNED: '📍',
    GADGET_FOUND: '🌟',
    CLAIM_APPROVED: '📦',
    CLAIM_REJECTED: '❌',
    RETURNED_SUCCESS: '✨',
    SYSTEM: '🛡️'
  };
  return icons[type] || '🔔';
}

async function handleNotificationClick(id, linkUrl) {
  try {
    const res = await api.getNotifications();
    const notif = (res.notifications || []).find(n => n.id === id);

    await api.markNotificationRead(id);
    await loadNotificationsFeed();

    if (notif) {
      await Swal.fire({
        title: `${getNotifIcon(notif.type)} ${escapeHtml(notif.title)}`,
        html: `
          <div style="text-align: left; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 12px 0; font-size: 0.88rem; line-height: 1.6; color: #1e293b; white-space: pre-line;">
            ${escapeHtml(notif.message)}
          </div>
          <div style="font-size: 0.75rem; color: #64748b; text-align: right;">
            Received: ${formatDate(notif.createdAt)}
          </div>
        `,
        confirmButtonText: linkUrl ? 'View Related Screen' : 'Close',
        confirmButtonColor: '#142a6d',
        showCancelButton: !!linkUrl,
        cancelButtonText: 'Close',
        cancelButtonColor: '#64748b'
      }).then((result) => {
        if (result.isConfirmed && linkUrl) {
          let targetHash = linkUrl.split('#')[1] || '';
          if (targetHash === 'scans') targetHash = 'lost-status';
          if (targetHash) navigateStudent(targetHash);
        }
      });
    } else if (linkUrl) {
      let targetHash = linkUrl.split('#')[1] || '';
      if (targetHash === 'scans') targetHash = 'lost-status';
      if (targetHash) navigateStudent(targetHash);
    }
  } catch (e) {
    console.error('Notification click error:', e);
  }
}

async function markAllNotificationsRead() {
  try {
    await api.markAllNotificationsRead();
    showToast('info', 'Updated', 'All notifications marked as read.');
    await loadNotificationsFeed();
  } catch (e) {}
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}
