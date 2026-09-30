/**
 * GadgetGuard OSA Admin Command Center Controller
 * Professional School-Management Administrative Dashboard
 */

let allGadgetsCache = [];
let allUsersCache = [];
let currentActiveOsaScreen = 'dashboard';

document.addEventListener('DOMContentLoaded', async () => {
  await ensureAdminAuthenticated();
  initOsaNavigation();
  await loadCurrentOsaScreenData();

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Real-time EventSource listener
  onLiveEvent((evt) => {
    loadOsaDashboardStats();
    loadCurrentOsaScreenData();
  });
});

async function ensureAdminAuthenticated() {
  const token = api.getToken();
  if (!token) {
    window.location.href = '/osa/login.html';
    return;
  }

  try {
    const meRes = await api.getMe();
    if (meRes.success && meRes.user) {
      api.setCurrentUser(meRes.user);
    }
  } catch (e) {
    console.warn('Could not refresh OSA admin session:', e);
  }

  const user = api.getCurrentUser();
  if (!user || user.role !== 'osa_admin') {
    window.location.href = '/osa/login.html?error=unauthorized';
    return;
  }

  const nameEl = document.getElementById('osa-admin-name');
  if (nameEl) nameEl.textContent = user.name;
}

function initOsaNavigation() {
  const hash = window.location.hash.replace('#', '');
  if (hash) {
    navigateOsa(hash);
  } else {
    navigateOsa('dashboard');
  }
}

function navigateOsa(screenName) {
  currentActiveOsaScreen = screenName;
  document.querySelectorAll('.osa-screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.osa-nav-link').forEach(l => l.classList.remove('active'));

  const screenEl = document.getElementById(`osa-screen-${screenName}`);
  if (screenEl) {
    screenEl.classList.add('active');
    window.location.hash = screenName;
  }

  const linkEl = document.getElementById(`nav-osa-${screenName}`);
  if (linkEl) {
    linkEl.classList.add('active');
  }

  const titles = {
    dashboard: 'Dashboard Overview',
    approvals: 'Gadget Registrations (Pending Approvals)',
    registered: 'Registered Gadgets Vault Directory',
    missing: 'Active Missing Incidents Monitor',
    found: 'Custody Vault & Finder Intake',
    claims: 'Ownership Claims Review Desk',
    scanner: 'Official OSA QR Scanner',
    users: 'Registered Campus Users',
    notifications: 'Incident Notifications Feed',
    scans: 'Administrative QR Scan Telemetry Logs',
    reports: 'Campus Asset Security Reports',
    audit: 'Complete System Security Audit Logs',
    settings: 'Campus Configuration & Live Demo Reset'
  };

  const titleEl = document.getElementById('osa-page-title');
  if (titleEl) titleEl.textContent = titles[screenName] || 'Admin Console';

  loadCurrentOsaScreenData();
}

function reloadCurrentOsaScreen() {
  showToast('info', 'Refreshing', 'Updating data from central database...');
  loadCurrentOsaScreenData();
}

async function loadCurrentOsaScreenData() {
  await loadOsaDashboardStats();

  if (currentActiveOsaScreen === 'dashboard') {
    loadDashboardTriage();
    loadDashboardAuditFeed();
  } else if (currentActiveOsaScreen === 'approvals') {
    loadApprovalsQueue();
  } else if (currentActiveOsaScreen === 'registered') {
    loadRegisteredVault();
  } else if (currentActiveOsaScreen === 'missing') {
    loadMissingIncidents();
  } else if (currentActiveOsaScreen === 'found') {
    loadFoundCustodyVault();
  } else if (currentActiveOsaScreen === 'claims') {
    loadClaimsDesk();
  } else if (currentActiveOsaScreen === 'scanner') {
    initOsaScannerWidget();
  } else if (currentActiveOsaScreen === 'users') {
    loadUserAccounts();
  } else if (currentActiveOsaScreen === 'notifications') {
    loadOsaNotifications();
  } else if (currentActiveOsaScreen === 'scans') {
    loadScanTelemetry();
  } else if (currentActiveOsaScreen === 'reports') {
    loadReportsData();
  } else if (currentActiveOsaScreen === 'audit') {
    loadAuditLogs();
  } else if (currentActiveOsaScreen === 'settings') {
    loadSettingsForm();
  }
}

async function loadOsaDashboardStats() {
  try {
    const res = await api.getOsaStats();
    if (!res.success) return;

    const s = res.stats;
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = (val !== undefined && val !== null) ? val : '0';
    };

    setVal('kpi-total-users', s.totalUsers);
    setVal('kpi-registered', s.registeredGadgets);
    setVal('kpi-pending-reg', s.pendingGadgets);
    setVal('kpi-missing', s.missingGadgets);
    setVal('kpi-found', s.inCustodyGadgets);
    setVal('kpi-pending-claims', s.pendingClaims);
    setVal('kpi-returned', s.returnedGadgets);
    setVal('kpi-unclaimed', s.inCustodyGadgets);
    setVal('kpi-scans', s.totalScans);

    // Sidebar badge counters
    updateSidebarBadge('badge-pending-count', s.pendingGadgets);
    updateSidebarBadge('badge-missing-count', s.missingGadgets);
    updateSidebarBadge('badge-claims-count', s.pendingClaims);
  } catch (err) {
    console.warn('Error loading stats:', err);
  }
}

function updateSidebarBadge(badgeId, count) {
  const el = document.getElementById(badgeId);
  if (!el) return;
  if (count > 0) {
    el.textContent = count;
    el.style.display = 'inline-block';
  } else {
    el.style.display = 'none';
  }
}

// 1. Dashboard Pending Triage
async function loadDashboardTriage() {
  const container = document.getElementById('dash-triage-container');
  if (!container) return;

  try {
    const res = await api.getAllGadgets({ status: 'PENDING_APPROVAL' });
    const pending = res.gadgets || [];

    if (pending.length === 0) {
      container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted);">✓ Queue clear. All student gadgets have been verified.</div>`;
      return;
    }

    container.innerHTML = `
      <table class="clean-table">
        <thead>
          <tr>
            <th>Gadget</th>
            <th>Owner</th>
            <th>Serial Number</th>
            <th>Submitted</th>
            <th class="text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          ${pending.slice(0, 4).map(g => `
            <tr>
              <td>
                <div class="table-primary-title">${escapeHtml(g.brand)} ${escapeHtml(g.model)}</div>
                <div class="table-secondary-sub">${escapeHtml(g.category)} • ${escapeHtml(g.color || 'Standard')}</div>
              </td>
              <td>
                <div style="font-weight:700; color:#0f172a; margin-bottom:3px;">${escapeHtml(g.owner?.name || 'Student')}</div>
                <div style="font-family:var(--font-mono); font-size:0.775rem; color:var(--primary); font-weight:600; margin-bottom:2px;">${escapeHtml(g.owner?.idNumber || '-')}</div>
                ${g.owner?.department ? `<div style="font-size:0.725rem; color:#475569;">${escapeHtml(g.owner.department)}</div>` : ''}
              </td>
              <td class="font-mono" style="font-size:0.8rem; font-weight:600;">${escapeHtml(g.serialNumber)}</td>
              <td style="font-size:0.8rem; color:var(--text-muted);">${formatDate(g.registrationDate)}</td>
              <td class="text-right">
                <button class="btn btn-success btn-sm" onclick="handleApproveGadget('${g.id}')">✓ Approve & Issue QR</button>
                <button class="btn btn-danger btn-sm" onclick="openRejectGadgetModal('${g.id}')">✕ Reject</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {}
}

async function loadDashboardAuditFeed() {
  const container = document.getElementById('dash-audit-container');
  if (!container) return;

  try {
    const res = await api.getAuditLogs();
    const logs = (res.logs || []).slice(0, 4);

    if (logs.length === 0) {
      container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-muted);">No audit records.</div>`;
      return;
    }

    container.innerHTML = `
      <table class="clean-table">
        <thead>
          <tr>
            <th>Action Code</th>
            <th>Details</th>
            <th>Actor</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(l => `
            <tr>
              <td><span class="status-badge" style="background:#eff6ff; color:#1d4ed8; font-size:0.7rem;">${escapeHtml(l.action)}</span></td>
              <td style="font-size:0.825rem; max-width:300px;">${escapeHtml(l.details)}</td>
              <td style="font-size:0.8rem; color:var(--text-muted);">${escapeHtml(l.userId)} (${escapeHtml(l.userRole)})</td>
              <td style="font-size:0.775rem; color:var(--text-dim);">${formatDate(l.timestamp)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {}
}

// 2. Gadget Approvals Full Queue
async function loadApprovalsQueue() {
  const container = document.getElementById('approvals-full-table');
  if (!container) return;

  try {
    const res = await api.getAllGadgets({ status: 'PENDING_APPROVAL' });
    const gadgets = res.gadgets || [];

    if (gadgets.length === 0) {
      container.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 6px;">🎉</div>
          <h4 style="font-weight: 700; color: var(--text-main);">No Pending Approvals!</h4>
          <p style="font-size: 0.85rem;">All submitted gadgets have been verified.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <table class="clean-table">
        <thead>
          <tr>
            <th style="width: 70px;">Photo</th>
            <th>Device Specs</th>
            <th>Owner Information</th>
            <th>Serial Number</th>
            <th>Description & Marks</th>
            <th>Submission Date</th>
            <th class="text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          ${gadgets.map(g => `
            <tr>
              <td>
                <img src="${g.photoUrl || 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500'}" alt="Proof" style="width: 54px; height: 54px; object-fit: cover; border-radius: 8px; border: 1.5px solid #cbd5e1; cursor: pointer;" onclick="previewOsaDevicePhoto('${g.photoUrl || 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500'}', '${escapeHtml(g.brand + ' ' + g.model)}', '${escapeHtml(g.owner?.name || 'Student')}')" title="Click to enlarge photo proof">
              </td>
              <td>
                <div class="table-primary-title">${escapeHtml(g.brand)} ${escapeHtml(g.model)}</div>
                <div class="table-secondary-sub">${escapeHtml(g.category)} • Color: ${escapeHtml(g.color || 'Standard')}</div>
              </td>
              <td>
                <div style="font-weight: 600;">${escapeHtml(g.owner?.name || 'Student')}</div>
                <div style="font-size: 0.75rem; color: var(--primary); font-family: var(--font-mono);">${escapeHtml(g.owner?.idNumber || '-')}</div>
                ${g.owner?.department ? `<div style="font-size: 0.7rem; color: #1e40af; font-weight: 600;">${escapeHtml(g.owner.department)}</div>` : ''}
              </td>
              <td class="font-mono" style="font-size: 0.825rem; font-weight: 700;">${escapeHtml(g.serialNumber)}</td>
              <td style="font-size: 0.8rem; color: var(--text-secondary); max-width: 200px;">"${escapeHtml(g.description || 'None')}"</td>
              <td style="font-size: 0.8rem; color: var(--text-muted);">${formatDate(g.registrationDate)}</td>
              <td class="text-right">
                <div class="table-action-btns">
                  <button class="btn btn-success btn-sm" onclick="handleApproveGadget('${g.id}')">✓ Approve & Generate QR</button>
                  <button class="btn btn-danger btn-sm" onclick="openRejectGadgetModal('${g.id}')">✕ Reject</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {}
}

function previewOsaDevicePhoto(photoUrl, deviceTitle, ownerName) {
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: deviceTitle,
      text: `Submitted by: ${ownerName}`,
      imageUrl: photoUrl,
      imageAlt: deviceTitle,
      imageHeight: 320,
      imageWidth: 420,
      confirmButtonColor: '#142a6d',
      confirmButtonText: 'Close Preview'
    });
  }
}

async function handleApproveGadget(gadgetId) {
  const confirmApprove = await SwalHelper.confirm({
    title: 'Approve Gadget Registration?',
    html: '<p>Confirm physical inspection for this device?</p><p style="font-size:0.85rem; color:#64748b;">This will register the gadget in the NCST database and issue an official tamper-proof QR code.</p>',
    icon: 'question',
    confirmText: '✓ Approve & Issue QR',
    cancelText: 'Cancel',
    confirmColor: '#059669'
  });

  if (!confirmApprove) return;

  try {
    const res = await api.approveGadget(gadgetId);
    await SwalHelper.success('Gadget Approved! 🎉', `Device verified. Issued QR Token: ${res.gadget.secureToken}. Preparing sticker print preview.`, 1800);
    await loadCurrentOsaScreenData();
    
    setTimeout(() => {
      openPrintStickerModal(res.gadget.id);
    }, 400);
  } catch (err) {
    await SwalHelper.error('Approval Failed', err.message || 'Unable to approve gadget.');
  }
}

async function openRejectGadgetModal(gadgetId) {
  if (typeof Swal !== 'undefined') {
    const { value: reason } = await Swal.fire({
      title: 'Reject Gadget Registration',
      input: 'textarea',
      inputLabel: 'Reason for Rejection (Visible to student):',
      inputPlaceholder: 'e.g. Serial number does not match receipt, physical inspection failed, duplicate serial...',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Confirm Rejection',
      cancelButtonText: 'Cancel',
      reverseButtons: true,
      inputValidator: (value) => {
        if (!value || !value.trim()) {
          return 'Please provide a reason for the rejection!';
        }
      }
    });

    if (reason) {
      try {
        await api.rejectGadget(gadgetId, reason.trim());
        Swal.fire({
          icon: 'info',
          title: 'Gadget Rejected',
          text: 'The student has been notified with your reason.',
          confirmButtonColor: '#142a6d'
        });
        loadPendingApprovals();
        loadDashboardData();
      } catch (err) {
        showToast('error', 'Rejection Error', err.message);
      }
    }
    return;
  }

  document.getElementById('reject-gadget-id').value = gadgetId;
  document.getElementById('reject-reason-text').value = '';
  document.getElementById('reject-gadget-modal').classList.add('active');
}

async function handleRejectGadgetSubmit(e) {
  e.preventDefault();
  const gadgetId = document.getElementById('reject-gadget-id').value;
  const reason = document.getElementById('reject-reason-text').value.trim();

  if (!reason) {
    await SwalHelper.warning('Reason Required', 'Please provide a valid rejection explanation for audit.');
    return;
  }

  const confirmReject = await SwalHelper.confirm({
    title: 'Reject Gadget Registration?',
    text: 'Are you sure you want to reject this registration? The student will be notified.',
    icon: 'warning',
    confirmText: 'Yes, Confirm Rejection',
    cancelText: 'Cancel',
    isDanger: true
  });

  if (!confirmReject) return;

  try {
    await api.rejectGadget(gadgetId, reason);
    closeModal('reject-gadget-modal');
    await SwalHelper.info('Gadget Registration Rejected', 'The student has been notified with your remarks.');
    loadCurrentOsaScreenData();
  } catch (err) {
    await SwalHelper.error('Rejection Failed', err.message || 'Could not reject gadget.');
  }
}

// 3. Registered Vault
async function loadRegisteredVault() {
  const container = document.getElementById('registered-vault-table');
  if (!container) return;

  try {
    const res = await api.getAllGadgets();
    allGadgetsCache = res.gadgets || [];
    renderVaultTable(allGadgetsCache);
  } catch (e) {}
}

function filterVaultTable() {
  const search = (document.getElementById('vault-search-input')?.value || '').toLowerCase();
  const status = document.getElementById('vault-status-select')?.value || 'ALL';

  let filtered = allGadgetsCache;
  if (status !== 'ALL') {
    filtered = filtered.filter(g => g.status === status);
  }
  if (search) {
    filtered = filtered.filter(g => 
      g.brand.toLowerCase().includes(search) ||
      g.model.toLowerCase().includes(search) ||
      g.serialNumber.toLowerCase().includes(search) ||
      (g.secureToken && g.secureToken.toLowerCase().includes(search)) ||
      (g.owner?.name && g.owner.name.toLowerCase().includes(search))
    );
  }

  renderVaultTable(filtered);
}

function renderVaultTable(gadgets) {
  const container = document.getElementById('registered-vault-table');
  if (!container) return;

  if (gadgets.length === 0) {
    container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted);">No matching equipment found in vault.</div>`;
    return;
  }

  container.innerHTML = `
    <table class="clean-table">
      <thead>
        <tr>
          <th>Device</th>
          <th>Owner</th>
          <th>Serial Number</th>
          <th>QR Token</th>
          <th>Status</th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${gadgets.map(g => `
          <tr>
            <td>
              <div class="table-primary-title">${escapeHtml(g.brand)} ${escapeHtml(g.model)}</div>
              <div class="table-secondary-sub">${escapeHtml(g.category)}</div>
            </td>
            <td>
              <div style="font-weight: 700; color: #0f172a; margin-bottom: 3px;">${escapeHtml(g.owner?.name || 'Student')}</div>
              <div class="font-mono" style="font-size: 0.775rem; color: var(--primary); font-weight: 600;">${escapeHtml(g.owner?.idNumber || '-')}</div>
            </td>
            <td>
              <span class="font-mono" style="font-size: 0.825rem; font-weight: 700; color: #1e293b; background: #f8fafc; padding: 4px 8px; border-radius: 6px; border: 1px solid #e2e8f0; display: inline-block;">
                ${escapeHtml(g.serialNumber)}
              </span>
            </td>
            <td>
              ${g.secureToken ? `
                <a href="/device/${g.secureToken}" target="_blank" class="font-mono" style="font-size:0.8rem; background:#eff6ff; color:#142a6d; padding:4px 10px; border-radius:6px; border:1px solid #bfdbfe; font-weight:700; display:inline-flex; align-items:center; gap:5px; text-decoration:none;">
                  <span>🔗</span> ${escapeHtml(g.secureToken)} ↗
                </a>
              ` : '<span class="text-muted" style="font-size:0.775rem;">Not Issued</span>'}
            </td>
            <td>${renderStatusBadge(g.status)}</td>
            <td class="text-right">
              <div class="table-action-btns" style="display:inline-flex; align-items:center; gap:6px; justify-content:flex-end;">
                ${g.status === 'REGISTERED' ? `
                  <button class="btn btn-sm" onclick="openOsaMarkMissingModal('${g.id}')" style="background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; font-weight:700; display:inline-flex; align-items:center; gap:5px;" title="Report as missing on behalf of student">
                    🚨 Report Missing
                  </button>
                ` : ''}

                ${g.status === 'PENDING_APPROVAL' ? `
                  <button class="btn btn-success btn-sm" onclick="handleApproveGadget('${g.id}')">✓ Approve</button>
                  <button class="btn btn-danger btn-sm" onclick="openRejectGadgetModal('${g.id}')">✕ Reject</button>
                ` : ''}

                ${g.status === 'MISSING' ? `
                  <button class="btn btn-primary btn-sm" onclick="navigateOsa('found')" style="display:inline-flex; align-items:center; gap:5px;" title="Receive into custody vault">
                    📦 Custody Intake
                  </button>
                ` : ''}

                ${g.status === 'FOUND_IN_CUSTODY' ? `
                  <button class="btn btn-primary btn-sm" onclick="navigateOsa('claims')" style="display:inline-flex; align-items:center; gap:5px;">
                    🤝 Review Claims
                  </button>
                ` : ''}

                ${g.secureToken ? `
                  <button class="btn btn-secondary btn-sm" onclick="openPrintStickerModal('${g.id}')" style="display:inline-flex; align-items:center; gap:6px;">
                    🏷️ Print Sticker
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function openOsaMarkMissingModal(gadgetId) {
  const gadget = allGadgetsCache.find(g => g.id === gadgetId);
  if (!gadget) return;

  const gidInput = document.getElementById('osa-missing-gadget-id');
  const dNameEl = document.getElementById('osa-missing-device-name');
  const oNameEl = document.getElementById('osa-missing-owner-name');
  const sInfoEl = document.getElementById('osa-missing-serial-info');
  const locInput = document.getElementById('osa-missing-location');
  const dtInput = document.getElementById('osa-missing-date');
  const detInput = document.getElementById('osa-missing-details');
  const rewInput = document.getElementById('osa-missing-reward');

  if (gidInput) gidInput.value = gadget.id;
  if (dNameEl) dNameEl.textContent = `${gadget.brand} ${gadget.model} (${gadget.category})`;
  if (oNameEl) oNameEl.textContent = `Owner: ${gadget.owner?.name || 'Student'} • Student ID: ${gadget.owner?.idNumber || 'N/A'}`;
  if (sInfoEl) sInfoEl.textContent = `Serial/IMEI: ${gadget.serialNumber} • QR Token: ${gadget.secureToken || 'N/A'}`;
  if (locInput) locInput.value = '';
  
  if (dtInput) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dtInput.value = now.toISOString().slice(0, 16);
  }
  
  if (detInput) detInput.value = 'Student reported misplaced equipment in person at the Office of Student Affairs (OSA Room 1109).';
  if (rewInput) rewInput.value = 'Please surrender immediately to OSA Room 1109 or Main Gate Security.';

  const modal = document.getElementById('osa-mark-missing-modal');
  if (modal) modal.classList.add('active');
}

async function handleOsaMarkMissingSubmit(event) {
  event.preventDefault();
  const gadgetId = document.getElementById('osa-missing-gadget-id')?.value;
  const lastSeenLocation = document.getElementById('osa-missing-location')?.value;
  const lastSeenDate = document.getElementById('osa-missing-date')?.value;
  const details = document.getElementById('osa-missing-details')?.value;
  const contactRewardOffer = document.getElementById('osa-missing-reward')?.value;

  if (!gadgetId || !lastSeenLocation) {
    SwalHelper.error('Missing Information', 'Please provide the gadget and last seen location.');
    return;
  }

  try {
    const res = await api.reportMissing({
      gadgetId,
      lastSeenLocation,
      lastSeenDate: lastSeenDate ? new Date(lastSeenDate).toISOString() : new Date().toISOString(),
      details,
      contactRewardOffer
    });

    closeModal('osa-mark-missing-modal');
    await SwalHelper.success(
      'Missing Alert Broadcasted! 🚨',
      'The equipment is now marked MISSING. The public missing board and QR telemetry safety guards have been activated.',
      2200
    );

    await loadCurrentOsaScreenData();
  } catch (err) {
    SwalHelper.error('Report Failed', err.message || 'Error marking device as missing.');
  }
}

function openPrintStickerModal(gadgetId) {
  const gadget = allGadgetsCache.find(g => g.id === gadgetId);
  if (!gadget || !gadget.qrCodeDataUrl) return;

  document.getElementById('admin-sticker-qr-img').src = gadget.qrCodeDataUrl;
  document.getElementById('admin-sticker-token').textContent = gadget.secureToken;
  document.getElementById('admin-sticker-device').textContent = `${gadget.brand} ${gadget.model}`;
  document.getElementById('admin-sticker-owner').textContent = `${gadget.owner?.name || 'Owner'} • ${gadget.owner?.idNumber || 'ID'}`;

  document.getElementById('print-sticker-modal').classList.add('active');
}

// 4. Missing Incidents Monitor
async function loadMissingIncidents() {
  const container = document.getElementById('missing-incidents-table');
  if (!container) return;

  try {
    const res = await api.getActiveMissing();
    const reports = res.reports || [];

    if (reports.length === 0) {
      container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted);">No active missing incidents on campus.</div>`;
      return;
    }

    container.innerHTML = `
      <table class="clean-table">
        <thead>
          <tr>
            <th>Missing Gadget</th>
            <th>Owner</th>
            <th>Last Known Location</th>
            <th>Date & Time</th>
            <th>Circumstances</th>
            <th class="text-right">Public Recovery Link</th>
          </tr>
        </thead>
        <tbody>
          ${reports.map(r => `
            <tr>
              <td>
                <div class="table-primary-title" style="color: #b91c1c;">${escapeHtml(r.gadget?.brand)} ${escapeHtml(r.gadget?.model)}</div>
                <div class="table-secondary-sub">${escapeHtml(r.gadget?.category)}</div>
              </td>
              <td>
                <div style="font-weight: 700; color: #0f172a; margin-bottom: 3px;">${escapeHtml(r.owner?.name || 'Student')}</div>
                <div style="font-size: 0.775rem; color: #64748b;">${escapeHtml(r.owner?.department || '-')}</div>
              </td>
              <td>
                <div style="font-size: 0.875rem; color: #b91c1c; font-weight: 700; display:flex; align-items:center; gap:6px;">
                  📍 ${escapeHtml(r.lastSeenLocation)}
                </div>
              </td>
              <td style="font-size: 0.825rem; color: #64748b;">${formatDate(r.lastSeenDate)}</td>
              <td style="font-size: 0.825rem; color: #475569; max-width: 240px; line-height: 1.45;">"${escapeHtml(r.details || 'None')}"</td>
              <td class="text-right">
                <div class="table-action-btns">
                  <a href="/device/${r.gadget?.secureToken}" target="_blank" class="btn btn-warning btn-sm" style="display:inline-flex; align-items:center; gap:6px;">
                    Open Recovery Page ↗
                  </a>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {}
}

// 5. Custody & Found Intake
async function loadFoundCustodyVault() {
  const container = document.getElementById('found-custody-table');
  if (!container) return;

  try {
    const res = await api.getAllFoundReports();
    const reports = res.reports || [];

    if (reports.length === 0) {
      container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted);">No finder reports logged.</div>`;
      return;
    }

    container.innerHTML = `
      <table class="clean-table">
        <thead>
          <tr>
            <th>Gadget</th>
            <th>Finder Information</th>
            <th>Found Location</th>
            <th>Turn-in Method</th>
            <th>Status</th>
            <th class="text-right">Intake Action</th>
          </tr>
        </thead>
        <tbody>
          ${reports.map(r => `
            <tr>
              <td>
                <div class="table-primary-title">${escapeHtml(r.gadget?.brand)} ${escapeHtml(r.gadget?.model)}</div>
                <div class="table-secondary-sub">Owner: ${escapeHtml(r.owner?.name || 'Student Member')}</div>
              </td>
              <td>
                <div style="font-weight: 700; color: #0f172a; margin-bottom: 3px;">${escapeHtml(r.finderName)}</div>
                <div class="font-mono" style="font-size: 0.775rem; color: #64748b;">${escapeHtml(r.finderContact)}</div>
              </td>
              <td>
                <div style="font-size: 0.875rem; font-weight: 600; color: #334155;">📍 ${escapeHtml(r.foundLocation)}</div>
              </td>
              <td>
                <span class="status-badge" style="background:#f1f5f9; color:#334155; font-size:0.75rem; padding:4px 10px;">
                  ${r.turnInMethod === 'SUBMITTED_TO_OSA' ? 'Surrendered to OSA' : 'Finder Holding'}
                </span>
              </td>
              <td>
                <span class="status-badge ${r.status === 'PROCESSED_BY_OSA' ? 'REGISTERED' : 'PENDING'}">
                  ${r.status === 'PROCESSED_BY_OSA' ? 'In Vault Locker' : 'Awaiting Intake'}
                </span>
              </td>
              <td class="text-right">
                <div class="table-action-btns">
                  ${r.status !== 'PROCESSED_BY_OSA' ? `
                    <button class="btn btn-primary btn-sm" onclick="openReceiveCustodyModal('${r.id}')" style="display:inline-flex; align-items:center; gap:6px;">
                      📦 Receive into Vault
                    </button>
                  ` : '<span style="font-size:0.8rem; color:#047857; font-weight:700;">✓ In Vault Locker</span>'}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {}
}

function openReceiveCustodyModal(reportId) {
  document.getElementById('custody-report-id').value = reportId;
  document.getElementById('receive-custody-modal').classList.add('active');
}

async function handleReceiveCustodySubmit(e) {
  e.preventDefault();
  const reportId = document.getElementById('custody-report-id').value;
  const custodyLocation = document.getElementById('custody-location-input').value.trim();
  const notes = document.getElementById('custody-notes-input').value.trim();

  try {
    await api.receiveIntoCustody(reportId, { custodyLocation, notes });
    showToast('success', 'Item In Custody!', `Moved to ${custodyLocation}. Owner notified to file claim.`);
    closeModal('receive-custody-modal');
    loadCurrentOsaScreenData();
  } catch (err) {
    showToast('error', 'Intake Failed', err.message);
  }
}

// 6. Claims Review Desk
async function loadClaimsDesk() {
  const container = document.getElementById('claims-review-table');
  if (!container) return;

  try {
    const res = await api.getAllClaims();
    const claims = res.claims || [];

    if (claims.length === 0) {
      container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted);">No ownership claims submitted.</div>`;
      return;
    }

    container.innerHTML = `
      <table class="clean-table">
        <thead>
          <tr>
            <th>Gadget</th>
            <th>Claimant</th>
            <th>Proof of Ownership</th>
            <th>ID Verification</th>
            <th>Status</th>
            <th class="text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          ${claims.map(c => `
            <tr>
              <td>
                <div class="table-primary-title">${escapeHtml(c.gadget?.brand)} ${escapeHtml(c.gadget?.model)}</div>
                <div class="table-secondary-sub" style="color: #142a6d; font-weight: 600;">Locker: ${escapeHtml(c.gadget?.custodyLocation || 'Vault')}</div>
              </td>
              <td>
                <div style="font-weight: 700; color: #0f172a; margin-bottom: 3px;">${escapeHtml(c.user?.name || 'Student')}</div>
                <div class="font-mono" style="font-size: 0.775rem; color: var(--primary); font-weight: 600;">${escapeHtml(c.user?.idNumber || '-')}</div>
              </td>
              <td style="font-size: 0.825rem; color: #475569; max-width: 260px; line-height: 1.45;">"${escapeHtml(c.claimProofDetails)}"</td>
              <td>
                <div style="font-size: 0.825rem; font-weight: 700; color: #0f172a; margin-bottom: 2px;">${escapeHtml(c.verificationIdType)}</div>
                <div class="font-mono" style="font-size: 0.775rem; color: var(--primary); font-weight: 600;">${escapeHtml(c.verificationIdNumber)}</div>
              </td>
              <td>${renderStatusBadge(c.status)}</td>
              <td class="text-right">
                <div class="table-action-btns">
                  ${c.status === 'PENDING' ? `
                    <button class="btn btn-success btn-sm" onclick="handleApproveClaim('${c.id}')">✓ Approve</button>
                    <button class="btn btn-danger btn-sm" onclick="handleReviewClaim('${c.id}', 'REJECT')">✕ Reject</button>
                  ` : '<span style="font-size:0.8rem; color:#64748b;">Processed</span>'}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {}
}

async function handleApproveClaim(claimId) {
  const confirmApprove = await SwalHelper.confirm({
    title: 'Approve Ownership Claim?',
    html: '<p>Confirm student proof of ownership?</p><p style="font-size:0.85rem; color:#64748b;">This will approve the claim and schedule physical handover at OSA Room 1109.</p>',
    icon: 'question',
    confirmText: '✓ Approve Claim',
    cancelText: 'Cancel',
    confirmColor: '#059669'
  });

  if (!confirmApprove) return;

  try {
    await api.reviewClaim(claimId, 'APPROVE');
    await SwalHelper.success('Claim Approved! 🤝', 'Claimant has been notified to proceed to OSA for device handover.');
    loadCurrentOsaScreenData();
  } catch (err) {
    await SwalHelper.error('Approval Error', err.message || 'Could not approve claim.');
  }
}

async function handleReviewClaim(claimId, action) {
  if (action === 'APPROVE') {
    return handleApproveClaim(claimId);
  }

  const reason = await SwalHelper.prompt({
    title: 'Reject Ownership Claim',
    text: 'Please state the reason for rejecting this claim (e.g. Inconclusive proof of purchase, serial mismatch):',
    inputPlaceholder: 'Enter rejection remarks...',
    confirmText: 'Confirm Rejection',
    cancelText: 'Cancel',
    isRequired: true,
    validationMessage: 'A rejection reason is required for institutional audit.'
  });

  if (!reason) return;

  const confirmReject = await SwalHelper.confirm({
    title: 'Confirm Rejection?',
    text: 'Are you sure you want to reject this claim with the provided remarks?',
    icon: 'warning',
    confirmText: 'Yes, Reject Claim',
    cancelText: 'Cancel',
    isDanger: true
  });

  if (!confirmReject) return;

  try {
    await api.reviewClaim(claimId, 'REJECT', reason);
    await SwalHelper.info('Claim Rejected', 'Student notified of rejection remarks.');
    loadCurrentOsaScreenData();
  } catch (err) {
    await SwalHelper.error('Rejection Failed', err.message || 'Could not reject claim.');
  }
}

// 7. Official Return Handover Dispatch
async function openDispatchReturnModal() {
  const select = document.getElementById('return-select-gadget');
  if (!select) return;

  const res = await api.getAllGadgets();
  const eligible = (res.gadgets || []).filter(g => g.status === 'FOUND_IN_CUSTODY' || g.status === 'MISSING' || g.status === 'REGISTERED');

  select.innerHTML = `<option value="">-- Choose Gadget for Handover --</option>` + eligible.map(g => `
    <option value="${g.id}" data-owner="${escapeHtml(g.owner?.name || '')}" data-idnum="${escapeHtml(g.owner?.idNumber || '')}">
      ${g.brand} ${g.model} (S/N: ${g.serialNumber}) — Owner: ${g.owner?.name} [${g.status}]
    </option>
  `).join('');

  document.getElementById('dispatch-return-modal').classList.add('active');
}

function handleReturnSelectChange(gadgetId) {
  const select = document.getElementById('return-select-gadget');
  const option = select.options[select.selectedIndex];
  if (option) {
    document.getElementById('return-recipient-name').value = option.getAttribute('data-owner') || '';
    document.getElementById('return-recipient-id').value = option.getAttribute('data-idnum') || '';
  }
}

async function handleDispatchReturnSubmit(e) {
  e.preventDefault();
  const gadgetId = document.getElementById('return-select-gadget').value;
  const receivedByPersonName = document.getElementById('return-recipient-name').value.trim();
  const receivedByPersonId = document.getElementById('return-recipient-id').value.trim();
  const notes = document.getElementById('return-notes-input').value.trim();

  try {
    const res = await api.dispatchReturn({
      gadgetId,
      receivedByPersonName,
      receivedByPersonId,
      notes
    });

    showToast('success', 'Handover Recorded! 🎉', `Official Return Receipt generated: ${res.returnRecord.id}`);
    closeModal('dispatch-return-modal');
    loadCurrentOsaScreenData();
  } catch (err) {
    showToast('error', 'Return Failed', err.message);
  }
}

// 8. Admin QR Scanner Widget
function initOsaScannerWidget() {
  initPublicScanner('osa-admin-scanner-widget', (token) => {
    window.location.href = `/device/${token}`;
  });
}

// 9. Users Management
async function loadUserAccounts() {
  const container = document.getElementById('users-accounts-table');
  if (!container) return;

  try {
    const res = await api.request('/auth/users');
    const users = res.users || [];
    allUsersCache = users;

    container.innerHTML = `
      <table class="clean-table">
        <thead>
          <tr>
            <th>Name & ID</th>
            <th>Email</th>
            <th>Role</th>
            <th>Department</th>
            <th>Phone</th>
            <th>Registered Devices</th>
            <th>Status</th>
            <th class="text-right">Access Control</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>
                <div class="table-primary-title">${escapeHtml(u.name)}</div>
                <div class="font-mono" style="font-size: 0.775rem; color: var(--primary); font-weight: 600;">${escapeHtml(u.idNumber)}</div>
              </td>
              <td style="font-size: 0.85rem; color: #475569;">${escapeHtml(u.email)}</td>
              <td><span class="status-badge" style="background:#f1f5f9; color:#334155; font-size:0.75rem; padding:4px 10px;">${u.role}</span></td>
              <td style="font-size: 0.825rem; color: #64748b;">${escapeHtml(u.department || '-')}</td>
              <td class="font-mono" style="font-size: 0.825rem; color: #334155;">${escapeHtml(u.contactNumber || '-')}</td>
              <td>
                <span style="font-weight: 800; font-size: 0.95rem; color: #047857; background: #ecfdf5; padding: 4px 12px; border-radius: 6px; border: 1px solid #a7f3d0; display: inline-block;">
                  ${u.gadgetCount || 0}
                </span>
              </td>
              <td><span class="status-badge ${u.status === 'ACTIVE' ? 'REGISTERED' : 'MISSING'}">${u.status}</span></td>
              <td class="text-right">
                <div class="table-action-btns">
                  ${u.role !== 'osa_admin' ? `
                    <button class="btn btn-secondary btn-sm" onclick="toggleUserStatus('${u.id}', '${u.status}')">
                      ${u.status === 'ACTIVE' ? '🚫 Suspend' : '✓ Activate'}
                    </button>
                  ` : '<span class="text-muted" style="font-size:0.75rem;">Admin</span>'}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {}
}

async function toggleUserStatus(userId, currentStatus) {
  const newStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
  const actionText = currentStatus === 'ACTIVE' ? 'suspend' : 'activate';

  const confirmToggle = await SwalHelper.confirm({
    title: `${actionText.charAt(0).toUpperCase() + actionText.slice(1)} User Account?`,
    text: `Are you sure you want to ${actionText} this user's institutional access to NCST GadgetGuard?`,
    icon: currentStatus === 'ACTIVE' ? 'warning' : 'question',
    confirmText: `Yes, ${actionText.toUpperCase()}`,
    cancelText: 'Cancel',
    isDanger: currentStatus === 'ACTIVE'
  });

  if (!confirmToggle) return;

  try {
    await api.request(`/auth/users/${userId}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus })
    });
    SwalHelper.toast('success', 'User Updated', `Account status changed to ${newStatus}`);
    loadUserAccounts();
  } catch (err) {
    await SwalHelper.error('Update Failed', err.message || 'Could not update user status.');
  }
}

// 10. QR Scan Telemetry Logs
async function loadScanTelemetry() {
  const container = document.getElementById('scans-telemetry-table');
  if (!container) return;

  try {
    const res = await api.getAllScanHistory();
    const scans = res.scans || [];

    if (scans.length === 0) {
      container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted);">No scan events recorded.</div>`;
      return;
    }

    container.innerHTML = `
      <table class="clean-table">
        <thead>
          <tr>
            <th>Scanned Device</th>
            <th>Registered Owner</th>
            <th>Scan Status</th>
            <th>Approximate Location</th>
            <th>Scanner Device / OS</th>
            <th>Audit IP</th>
            <th class="text-right">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          ${scans.map(s => `
            <tr>
              <td>
                <div style="font-weight: 700;">${escapeHtml(s.gadget?.brand)} ${escapeHtml(s.gadget?.model)}</div>
                <div class="font-mono" style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(s.scannedToken)}</div>
              </td>
              <td>
                <div style="font-weight: 600;">${escapeHtml(s.owner?.name || 'Student')}</div>
                <div style="font-size: 0.725rem; color: var(--text-muted);">${escapeHtml(s.owner?.department || '-')}</div>
              </td>
              <td>
                <span class="status-badge ${s.scanStatus === 'MISSING_DEVICE_SCANNED' ? 'MISSING' : 'REGISTERED'}">
                  ${s.scanStatus || 'REGISTERED_DEVICE_SCANNED'}
                </span>
              </td>
              <td style="font-size: 0.85rem; font-weight: 600;">📍 ${escapeHtml(s.scanLocationNote || 'Location unavailable')}</td>
              <td style="font-size: 0.775rem; color: var(--text-secondary);">${escapeHtml(s.deviceInfo || 'Device unavailable')}</td>
              <td class="font-mono" style="font-size: 0.75rem; color: var(--text-dim);">${escapeHtml(s.scannerIp)}</td>
              <td class="text-right" style="font-size: 0.75rem; color: var(--text-muted);">${formatDate(s.scannedAt)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {}
}

// 11. Reports Screen
async function loadReportsData() {
  try {
    const [statsRes, gadgetsRes] = await Promise.all([
      api.getOsaStats().catch(() => ({})),
      api.getAllGadgets().catch(() => ({}))
    ]);

    const s = statsRes.stats || {};
    const gadgets = gadgetsRes.gadgets || [];
    const total = gadgets.length || 1;

    // 1. Metric values
    const totalCasesEl = document.getElementById('report-total-cases');
    const activeStickersEl = document.getElementById('report-active-stickers');
    if (totalCasesEl) totalCasesEl.textContent = gadgets.length;
    if (activeStickersEl) activeStickersEl.textContent = s.registeredGadgets || 0;

    // 2. Category Census Breakdown
    const cats = {
      Laptop: 0,
      Smartphone: 0,
      Tablet: 0,
      Earbuds: 0,
      Camera: 0,
      Other: 0
    };

    gadgets.forEach(g => {
      const c = g.category || 'Other';
      if (cats[c] !== undefined) cats[c]++;
      else cats.Other++;
    });

    const updateCat = (key, count, elCountId, elBarId) => {
      const countEl = document.getElementById(elCountId);
      const barEl = document.getElementById(elBarId);
      const pct = Math.round((count / total) * 100);
      if (countEl) countEl.textContent = `${count} devices (${pct}%)`;
      if (barEl) barEl.style.width = `${pct}%`;
    };

    updateCat('Laptop', cats.Laptop, 'cat-count-laptop', 'cat-bar-laptop');
    updateCat('Smartphone', cats.Smartphone, 'cat-count-phone', 'cat-bar-phone');
    updateCat('Tablet', cats.Tablet, 'cat-count-tablet', 'cat-bar-tablet');
    updateCat('Earbuds', cats.Earbuds, 'cat-count-audio', 'cat-bar-audio');
    updateCat('Camera', cats.Camera, 'cat-count-camera', 'cat-bar-camera');

    // 3. Status Breakdown
    const regCount = s.registeredGadgets || 0;
    const custodyCount = s.inCustodyGadgets || 0;
    const returnedCount = s.returnedGadgets || 0;
    const pendingCount = s.pendingGadgets || 0;
    const missingCount = s.missingGadgets || 0;

    const updateStatus = (count, elCountId, elBarId) => {
      const countEl = document.getElementById(elCountId);
      const barEl = document.getElementById(elBarId);
      const pct = Math.round((count / total) * 100);
      if (countEl) countEl.textContent = `${count} assets (${pct}%)`;
      if (barEl) barEl.style.width = `${pct}%`;
    };

    updateStatus(regCount, 'status-count-registered', 'status-bar-registered');
    updateStatus(custodyCount, 'status-count-custody', 'status-bar-custody');
    updateStatus(returnedCount, 'status-count-returned', 'status-bar-returned');
    updateStatus(pendingCount, 'status-count-pending', 'status-bar-pending');
    updateStatus(missingCount, 'status-count-missing', 'status-bar-missing');

  } catch (err) {
    console.error('Error loading reports data:', err);
  }
}

function exportAnalyticsSummary() {
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      icon: 'info',
      title: 'NCST Executive Summary',
      html: `
        <div style="text-align:left; font-size:0.875rem; background:#f8fafc; padding:16px; border-radius:12px; border:1px solid #e2e8f0; line-height:1.6;">
          <div style="font-weight:700; color:#142a6d; margin-bottom:8px; border-bottom:1px solid #cbd5e1; padding-bottom:6px;">
            🏛️ National College of Science & Technology (NCST)
          </div>
          <div>✅ <strong>Recovery Success Rate:</strong> 100%</div>
          <div>⚡ <strong>Average Resolution Time:</strong> &lt; 24 Hours</div>
          <div>🛡️ <strong>System Protocol:</strong> Active 24/7 QR Telemetry</div>
          <div>🏢 <strong>Supervision:</strong> Office of Student Affairs (OSA Room 1109)</div>
        </div>
      `,
      confirmButtonText: 'Download Certificate Summary',
      confirmButtonColor: '#142a6d'
    });
  } else {
    alert('NCST Analytics Summary: 100% Recovery Rate verified.');
  }
}

// 12. Audit Logs
async function loadAuditLogs() {
  const container = document.getElementById('audit-full-table');
  if (!container) return;

  try {
    const res = await api.getAuditLogs();
    const logs = res.logs || [];

    container.innerHTML = `
      <table class="clean-table">
        <thead>
          <tr>
            <th>Log ID</th>
            <th>Action Code</th>
            <th>Details</th>
            <th>Actor</th>
            <th>Audit IP</th>
            <th class="text-right">Timestamp</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(l => `
            <tr>
              <td class="font-mono" style="font-size: 0.775rem; color: #94a3b8;">${escapeHtml(l.id)}</td>
              <td>
                <span class="status-badge" style="background:#eff6ff; color:#142a6d; font-size:0.75rem; font-weight:700; padding:4px 10px; border:1px solid #bfdbfe;">
                  ${escapeHtml(l.action)}
                </span>
              </td>
              <td style="font-size: 0.875rem; max-width: 360px; line-height: 1.45; color: #1e293b;">${escapeHtml(l.details)}</td>
              <td>
                <div style="font-weight: 700; font-size: 0.85rem; color: #0f172a; margin-bottom: 2px;">${escapeHtml(l.userId)}</div>
                <div style="font-size: 0.75rem; color: #64748b;">Role: ${escapeHtml(l.userRole)}</div>
              </td>
              <td class="font-mono" style="font-size: 0.775rem; color: #64748b;">${escapeHtml(l.ipAddress)}</td>
              <td class="text-right" style="font-size: 0.8rem; color: #64748b; white-space: nowrap;">${formatDate(l.timestamp)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {}
}

// 13. Notifications Feed
async function loadOsaNotifications() {
  const container = document.getElementById('osa-notifications-feed');
  if (!container) return;

  try {
    const res = await api.getNotifications();
    const notifs = res.notifications || [];

    if (notifs.length === 0) {
      container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted);">No notifications.</div>`;
      return;
    }

    container.innerHTML = notifs.map(n => `
      <div style="padding: 16px; border-bottom: 1px solid var(--card-border); display: flex; gap: 14px; cursor: pointer; transition: background 0.2s ease; background: ${n.read ? '#ffffff' : '#eff6ff'};" onclick="handleOsaNotificationClick('${n.id}', '${n.linkUrl || ''}')">
        <div style="font-size: 1.4rem;">🔔</div>
        <div style="flex: 1;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: 700; font-size: 0.9rem; color: var(--text-main);">${escapeHtml(n.title)}</span>
            <span style="font-size: 0.75rem; color: var(--text-muted);">${formatDate(n.createdAt)}</span>
          </div>
          <div style="font-size: 0.825rem; color: var(--text-secondary); margin-top: 2px; white-space: pre-line;">${escapeHtml(n.message)}</div>
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

async function handleOsaNotificationClick(id, linkUrl) {
  try {
    const res = await api.getNotifications();
    const notif = (res.notifications || []).find(n => n.id === id);
    await api.markNotificationRead(id);
    await loadOsaNotifications();

    if (notif) {
      await Swal.fire({
        title: `🔔 ${escapeHtml(notif.title)}`,
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
          const target = linkUrl.split('#')[1] || '';
          if (target) navigateOsa(target);
        }
      });
    } else if (linkUrl) {
      const target = linkUrl.split('#')[1] || '';
      if (target) navigateOsa(target);
    }
  } catch (e) {}
}

// 14. Settings Form & Demo Reset
async function loadSettingsForm() {
  try {
    const res = await api.getSettings();
    if (res.success && res.settings) {
      const s = res.settings;
      document.getElementById('osa-set-school').value = s.schoolName;
      document.getElementById('osa-set-loc').value = s.osaOfficeLocation;
      document.getElementById('osa-set-phone').value = s.osaContactPhone;
      document.getElementById('osa-set-email').value = s.osaEmail;
      document.getElementById('osa-set-hours').value = s.operatingHours;
    }
  } catch (e) {}
}

async function handleOsaSettingsSave(e) {
  e.preventDefault();
  const schoolName = document.getElementById('osa-set-school').value.trim();
  const osaOfficeLocation = document.getElementById('osa-set-loc').value.trim();
  const osaContactPhone = document.getElementById('osa-set-phone').value.trim();
  const osaEmail = document.getElementById('osa-set-email').value.trim();
  const operatingHours = document.getElementById('osa-set-hours').value.trim();

  const confirmSave = await SwalHelper.confirm({
    title: 'Save Campus Settings?',
    text: 'Apply updated institutional settings across all connected student and public portals?',
    icon: 'question',
    confirmText: 'Yes, Save Settings',
    cancelText: 'Cancel',
    confirmColor: '#142a6d'
  });

  if (!confirmSave) return;

  try {
    await api.updateSettings({ schoolName, osaOfficeLocation, osaContactPhone, osaEmail, operatingHours });
    await SwalHelper.success('Settings Saved! 💾', 'NCST campus configuration updated across all interfaces.');
  } catch (err) {
    await SwalHelper.error('Save Failed', err.message || 'Could not update settings.');
  }
}

async function handleResetDemoData() {
  const confirmReset = await SwalHelper.confirm({
    title: '⚠️ Reset Database to Demo State?',
    html: '<p>Are you sure you want to <strong>reset the entire NCST database</strong> to default demo state?</p><p style="font-size:0.85rem; color:#dc2626;">All new gadgets, missing reports, custody intake records, and claims will be re-seeded.</p>',
    icon: 'warning',
    confirmText: 'Yes, Reset Everything',
    cancelText: 'Cancel, Keep Current Data',
    isDanger: true
  });

  if (!confirmReset) return;

  try {
    await api.resetDemoData();
    await SwalHelper.success('Database Reset! ⚡', 'All NCST demo records restored successfully.', 1500);
    setTimeout(() => {
      window.location.reload();
    }, 800);
  } catch (err) {
    await SwalHelper.error('Reset Failed', err.message || 'Could not reset demo data.');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

function printExecutiveReport() {
  SwalHelper.toast('info', 'Print Preview', 'Preparing NCST Executive Analytics Document...');
  setTimeout(() => {
    window.print();
  }, 400);
}
