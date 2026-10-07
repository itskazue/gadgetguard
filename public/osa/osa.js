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
                <div style="font-weight:700; color:#0f172a; margin-bottom:3px;">${escapeHtml(formatStudentDisplayName(g.owner?.name))}</div>
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

// ==========================================
// STUDENT SURNAME, FILTERING & SORTING UTILITIES
// ==========================================

// Extracts student surname, handling single names, comma format ("Dela Cruz, Juan"), and Filipino prefix surnames ("Juan Dela Cruz" -> "Dela Cruz")
function getStudentSurname(fullName) {
  if (!fullName || typeof fullName !== 'string') return '';
  const trimmed = fullName.trim();
  if (!trimmed) return '';

  if (trimmed.includes(',')) {
    return trimmed.split(',')[0].trim();
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0];

  const lowerParts = parts.map(p => p.toLowerCase());
  const len = parts.length;

  // Multi-word Filipino compound surnames: "de la Cruz", "de los Santos"
  if (len >= 3) {
    const thirdFromLast = lowerParts[len - 3];
    const secondFromLast = lowerParts[len - 2];
    if ((thirdFromLast === 'de' && (secondFromLast === 'la' || secondFromLast === 'los')) ||
        (thirdFromLast === 'del' && secondFromLast === 'os')) {
      return parts.slice(len - 3).join(' ');
    }
  }

  // Common prefixes: "Dela Cruz", "Del Rosario", "San Juan", "Santa Maria"
  if (len >= 2) {
    const secondFromLast = lowerParts[len - 2];
    const prefixes = ['de', 'del', 'dela', 'delos', 'san', 'santa', 'sto.', 'sto', 'sta.', 'sta'];
    if (prefixes.includes(secondFromLast)) {
      return parts.slice(len - 2).join(' ');
    }
  }

  return parts[len - 1];
}

// Formats display name as "Surname, First Name" (e.g. "Dela Cruz, Juan")
function formatStudentDisplayName(fullName) {
  if (!fullName || typeof fullName !== 'string') return 'Student';
  const trimmed = fullName.trim();
  if (!trimmed) return 'Student';
  if (trimmed.includes(',')) return trimmed;

  const surname = getStudentSurname(trimmed);
  if (surname && trimmed.endsWith(surname) && trimmed !== surname) {
    const firstName = trimmed.slice(0, trimmed.length - surname.length).trim();
    if (firstName) {
      return `${surname}, ${firstName}`;
    }
  }
  return trimmed;
}

// Device Category Matcher
function matchesDeviceCategory(gadgetCategory, filterCategory) {
  if (!filterCategory || filterCategory === 'ALL') return true;
  const cat = (gadgetCategory || '').toLowerCase();
  const target = filterCategory.toLowerCase();

  if (target === 'smartphone') {
    return cat.includes('phone');
  }
  if (target === 'laptop') {
    return cat.includes('laptop') || cat.includes('macbook') || cat.includes('notebook');
  }
  if (target === 'tablet') {
    return cat.includes('tablet') || cat.includes('ipad');
  }
  if (target === 'smartwatch') {
    return cat.includes('watch') || cat.includes('wearable');
  }
  if (target === 'earbuds') {
    return cat.includes('earbud') || cat.includes('headphone') || cat.includes('airpod');
  }
  if (target === 'other') {
    const standard = ['smartphone', 'phone', 'laptop', 'macbook', 'notebook', 'tablet', 'ipad', 'watch', 'wearable', 'earbud', 'headphone', 'airpod'];
    return cat.includes('other') || !standard.some(s => cat.includes(s));
  }
  return cat.includes(target);
}

// Unified Sorting Pipeline
// Default: Primary = Student Surname (A-Z), Secondary = Student ID (Ascending)
// If the same student has multiple records, they are kept consecutive.
function sortGadgetsList(items, sortOption, getOwnerFn, getDateFn) {
  const opt = sortOption || 'SURNAME_ASC';
  return [...items].sort((a, b) => {
    const ownerA = getOwnerFn(a) || {};
    const ownerB = getOwnerFn(b) || {};
    const surnameA = getStudentSurname(ownerA.name || '').toLowerCase();
    const surnameB = getStudentSurname(ownerB.name || '').toLowerCase();
    const idA = (ownerA.idNumber || '').toLowerCase();
    const idB = (ownerB.idNumber || '').toLowerCase();
    const dateA = new Date(getDateFn(a) || 0).getTime();
    const dateB = new Date(getDateFn(b) || 0).getTime();

    if (opt === 'SURNAME_DESC') {
      const cmp = surnameB.localeCompare(surnameA);
      if (cmp !== 0) return cmp;
      const idCmp = idA.localeCompare(idB);
      if (idCmp !== 0) return idCmp;
      return dateB - dateA;
    }

    if (opt === 'ID_ASC') {
      const cmp = idA.localeCompare(idB);
      if (cmp !== 0) return cmp;
      const sCmp = surnameA.localeCompare(surnameB);
      if (sCmp !== 0) return sCmp;
      return dateB - dateA;
    }

    if (opt === 'ID_DESC') {
      const cmp = idB.localeCompare(idA);
      if (cmp !== 0) return cmp;
      const sCmp = surnameA.localeCompare(surnameB);
      if (sCmp !== 0) return sCmp;
      return dateB - dateA;
    }

    if (opt === 'NEWEST') {
      if (dateB !== dateA) return dateB - dateA;
      const sCmp = surnameA.localeCompare(surnameB);
      if (sCmp !== 0) return sCmp;
      return idA.localeCompare(idB);
    }

    if (opt === 'OLDEST') {
      if (dateA !== dateB) return dateA - dateB;
      const sCmp = surnameA.localeCompare(surnameB);
      if (sCmp !== 0) return sCmp;
      return idA.localeCompare(idB);
    }

    // Default: SURNAME_ASC (Primary: Surname A-Z, Secondary: Student ID Ascending)
    // Ensures all gadgets belonging to the same student appear consecutively!
    const sCmp = surnameA.localeCompare(surnameB);
    if (sCmp !== 0) return sCmp;
    const idCmp = idA.localeCompare(idB);
    if (idCmp !== 0) return idCmp;
    return dateB - dateA;
  });
}

// 2. Gadget Approvals Full Queue (Registration Requests)
let approvalsQueueCache = [];

async function loadApprovalsQueue() {
  const container = document.getElementById('approvals-full-table');
  if (!container) return;

  try {
    const res = await api.getAllGadgets();
    approvalsQueueCache = res.gadgets || [];
    const pendingCount = approvalsQueueCache.filter(g => g.status === 'PENDING_APPROVAL').length;
    const badge = document.getElementById('badge-pending-count');
    if (badge) {
      badge.textContent = pendingCount;
      badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
    }
    filterApprovalsTable();
  } catch (e) {
    container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted);">Error loading gadget registrations.</div>`;
  }
}

function filterApprovalsTable() {
  const studentQuery = (document.getElementById('approvals-student-filter')?.value || '').trim().toLowerCase();
  const deviceQuery = (document.getElementById('approvals-device-search')?.value || '').trim().toLowerCase();
  const categoryFilter = document.getElementById('approvals-type-filter')?.value || 'ALL';
  const statusFilter = document.getElementById('approvals-status-filter')?.value || 'PENDING_APPROVAL';
  const sortOption = document.getElementById('approvals-sort-filter')?.value || 'SURNAME_ASC';

  let filtered = approvalsQueueCache;

  // 1. Status Filter (Pending by default, All, Approved, Rejected)
  if (statusFilter !== 'ALL') {
    filtered = filtered.filter(g => g.status === statusFilter);
  }

  // 2. Device Type Filter
  if (categoryFilter !== 'ALL') {
    filtered = filtered.filter(g => matchesDeviceCategory(g.category, categoryFilter));
  }

  // 3. Dedicated Search by Student ID or Student Surname
  if (studentQuery) {
    filtered = filtered.filter(g => {
      const studentId = (g.owner?.idNumber || '').toLowerCase();
      const studentName = (g.owner?.name || '').toLowerCase();
      const surname = getStudentSurname(g.owner?.name || '').toLowerCase();
      return studentId.includes(studentQuery) || surname.includes(studentQuery) || studentName.includes(studentQuery);
    });
  }

  // 4. Device Search (device brand, model, serial no., QR token)
  if (deviceQuery) {
    filtered = filtered.filter(g => {
      const brand = (g.brand || '').toLowerCase();
      const model = (g.model || '').toLowerCase();
      const fullDev = `${brand} ${model}`;
      const sn = (g.serialNumber || '').toLowerCase();
      const token = (g.secureToken || '').toLowerCase();
      return brand.includes(deviceQuery) || model.includes(deviceQuery) || fullDev.includes(deviceQuery) || sn.includes(deviceQuery) || token.includes(deviceQuery);
    });
  }

  // 5. Automatic Sort (Default: Surname A-Z, then Student ID Ascending)
  // Consecutive grouping for same student
  const sorted = sortGadgetsList(filtered, sortOption, g => g.owner, g => g.registrationDate || g.createdAt);

  const hasActiveFilters = Boolean(studentQuery || deviceQuery || categoryFilter !== 'ALL' || statusFilter !== 'PENDING_APPROVAL' || sortOption !== 'SURNAME_ASC');
  renderApprovalsTable(sorted, hasActiveFilters);
}

function clearApprovalsFilter() {
  const stInput = document.getElementById('approvals-student-filter');
  const devInput = document.getElementById('approvals-device-search');
  const catSelect = document.getElementById('approvals-type-filter');
  const statusSelect = document.getElementById('approvals-status-filter');
  const sortSelect = document.getElementById('approvals-sort-filter');

  if (stInput) stInput.value = '';
  if (devInput) devInput.value = '';
  if (catSelect) catSelect.value = 'ALL';
  if (statusSelect) statusSelect.value = 'PENDING_APPROVAL';
  if (sortSelect) sortSelect.value = 'SURNAME_ASC';

  filterApprovalsTable();
}

function renderApprovalsTable(gadgets, hasActiveFilter = false) {
  const container = document.getElementById('approvals-full-table');
  if (!container) return;

  if (gadgets.length === 0) {
    if (hasActiveFilter) {
      container.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 6px;">🔍</div>
          <h4 style="font-weight: 700; color: var(--text-main);">No Registration Submissions Found</h4>
          <p style="font-size: 0.85rem;">No gadget records match your search or filter selection.</p>
          <button class="btn btn-secondary btn-sm" onclick="clearApprovalsFilter()" style="margin-top: 10px;">Reset Filters</button>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-muted);">
          <div style="font-size: 2rem; margin-bottom: 6px;">🎉</div>
          <h4 style="font-weight: 700; color: var(--text-main);">No Pending Submissions</h4>
          <p style="font-size: 0.85rem;">All submitted gadgets have been verified.</p>
        </div>
      `;
    }
    return;
  }

  container.innerHTML = `
    <table class="clean-table">
      <thead>
        <tr>
          <th style="width: 70px;">Photo</th>
          <th>Device Specs</th>
          <th>Student Information</th>
          <th>Serial Number</th>
          <th>Status</th>
          <th>Submission Date</th>
          <th class="text-right">Action</th>
        </tr>
      </thead>
      <tbody>
        ${gadgets.map((g, idx) => {
          const prevG = idx > 0 ? gadgets[idx - 1] : null;
          const isSameStudent = prevG && prevG.owner?.idNumber && prevG.owner?.idNumber === g.owner?.idNumber;
          const rowClass = isSameStudent ? 'student-group-accent' : '';
          return `
          <tr class="${rowClass}">
            <td>
              <img src="${g.photoUrl || 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500'}" alt="Proof" style="width: 52px; height: 52px; object-fit: cover; border-radius: 8px; border: 1.5px solid #cbd5e1; cursor: pointer;" onclick="previewOsaDevicePhoto('${g.photoUrl || 'https://images.unsplash.com/photo-1544244015-0df4b3ffc6b0?w=500'}', '${escapeHtml(g.brand + ' ' + g.model)}', '${escapeHtml(g.owner?.name || 'Student')}')" title="Click to enlarge photo proof">
            </td>
            <td>
              <div class="table-primary-title">${escapeHtml(g.brand)} ${escapeHtml(g.model)}</div>
              <div class="table-secondary-sub">${escapeHtml(g.category)} • Color: ${escapeHtml(g.color || 'Standard')}</div>
            </td>
            <td>
              <div style="font-weight: 700; color: #0f172a;">${escapeHtml(formatStudentDisplayName(g.owner?.name))}</div>
              <div class="font-mono" style="font-size: 0.8rem; color: var(--primary); font-weight: 700; margin-top: 2px;">
                ${g.owner?.idNumber ? `ID: ${escapeHtml(g.owner.idNumber)}` : '-'}
              </div>
              ${g.owner?.department ? `<div style="font-size: 0.725rem; color: #64748b;">${escapeHtml(g.owner.department)}</div>` : ''}
              ${g.owner?.email ? `<div style="font-size: 0.7rem; color: #94a3b8;">${escapeHtml(g.owner.email)}</div>` : ''}
            </td>
            <td class="font-mono" style="font-size: 0.825rem; font-weight: 700;">${escapeHtml(g.serialNumber || 'N/A')}</td>
            <td>${renderStatusBadge(g.status)}</td>
            <td style="font-size: 0.8rem; color: var(--text-muted);">${formatDate(g.registrationDate || g.createdAt)}</td>
            <td class="text-right">
              <div class="table-action-btns" style="display:inline-flex; align-items:center; gap:6px; justify-content:flex-end;">
                ${g.status === 'PENDING_APPROVAL' ? `
                  <button class="btn btn-success btn-sm" onclick="handleApproveGadget('${g.id}')">✓ Approve & Generate QR</button>
                  <button class="btn btn-danger btn-sm" onclick="openRejectGadgetModal('${g.id}')">✕ Reject</button>
                ` : ''}
                ${g.status === 'REGISTERED' && g.secureToken ? `
                  <button class="btn btn-secondary btn-sm" onclick="openPrintStickerModal('${g.id}')" title="Print QR Security Sticker">🏷️ Sticker</button>
                ` : ''}
                ${g.status === 'REJECTED' ? `
                  <span style="font-size:0.75rem; color:#b91c1c;" title="${escapeHtml(g.rejectionReason || 'Rejected')}">Reason: ${escapeHtml(g.rejectionReason || 'Unverified')}</span>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
        }).join('')}
      </tbody>
    </table>
  `;
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

  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: 'Approving & Dispatching Email...',
      text: 'Verifying registration & dispatching official email notification to student...',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });
  }

  try {
    const res = await api.approveGadget(gadgetId);
    await SwalHelper.success('Gadget Approved! 🎉', `Device verified and approval email sent to student! Issued QR Token: ${res.gadget.secureToken}. Preparing sticker print preview.`, 1800);
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
    filterVaultTable();
  } catch (e) {}
}

function filterVaultTable() {
  const studentQuery = (document.getElementById('vault-student-filter')?.value || '').trim().toLowerCase();
  const deviceQuery = (document.getElementById('vault-search-input')?.value || '').trim().toLowerCase();
  const categoryFilter = document.getElementById('vault-type-filter')?.value || 'ALL';
  const status = document.getElementById('vault-status-select')?.value || 'ALL';
  const sortOption = document.getElementById('vault-sort-filter')?.value || 'SURNAME_ASC';

  let filtered = allGadgetsCache;

  // 1. Status Filter
  if (status !== 'ALL') {
    filtered = filtered.filter(g => g.status === status);
  }

  // 2. Device Type Filter
  if (categoryFilter !== 'ALL') {
    filtered = filtered.filter(g => matchesDeviceCategory(g.category, categoryFilter));
  }

  // 3. Dedicated Search by Student ID or Student Surname
  if (studentQuery) {
    filtered = filtered.filter(g => {
      const sId = (g.owner?.idNumber || '').toLowerCase();
      const sName = (g.owner?.name || '').toLowerCase();
      const surname = getStudentSurname(g.owner?.name || '').toLowerCase();
      return sId.includes(studentQuery) || surname.includes(studentQuery) || sName.includes(studentQuery);
    });
  }

  // 4. Device Search (Search device, serial no., or QR token)
  if (deviceQuery) {
    filtered = filtered.filter(g => {
      const brand = (g.brand || '').toLowerCase();
      const model = (g.model || '').toLowerCase();
      const fullDev = `${brand} ${model}`;
      const sn = (g.serialNumber || '').toLowerCase();
      const token = (g.secureToken || '').toLowerCase();
      return brand.includes(deviceQuery) || model.includes(deviceQuery) || fullDev.includes(deviceQuery) || sn.includes(deviceQuery) || token.includes(deviceQuery);
    });
  }

  // 5. Automatic Sort (Default: Surname A-Z, then Student ID Ascending)
  // Keeps all devices belonging to the same student consecutive
  const sorted = sortGadgetsList(filtered, sortOption, g => g.owner, g => g.registrationDate || g.createdAt);

  const hasFilter = Boolean(studentQuery || deviceQuery || categoryFilter !== 'ALL' || status !== 'ALL' || sortOption !== 'SURNAME_ASC');
  renderVaultTable(sorted, hasFilter);
}

function clearVaultFilter() {
  const stInput = document.getElementById('vault-student-filter');
  const searchInput = document.getElementById('vault-search-input');
  const catSelect = document.getElementById('vault-type-filter');
  const statusSelect = document.getElementById('vault-status-select');
  const sortSelect = document.getElementById('vault-sort-filter');

  if (stInput) stInput.value = '';
  if (searchInput) searchInput.value = '';
  if (catSelect) catSelect.value = 'ALL';
  if (statusSelect) statusSelect.value = 'ALL';
  if (sortSelect) sortSelect.value = 'SURNAME_ASC';

  filterVaultTable();
}

function renderVaultTable(gadgets, hasFilter = false) {
  const container = document.getElementById('registered-vault-table');
  if (!container) return;

  if (gadgets.length === 0) {
    container.innerHTML = `
      <div style="padding: 35px; text-align: center; color: var(--text-muted);">
        <div style="font-size: 1.8rem; margin-bottom: 6px;">🔍</div>
        <h4 style="font-weight: 700; color: var(--text-main);">No Equipment Found</h4>
        <p style="font-size: 0.85rem;">No registered gadgets match the current search or filter criteria.</p>
        ${hasFilter ? `<button class="btn btn-secondary btn-sm" onclick="clearVaultFilter()" style="margin-top: 10px;">Reset Filters</button>` : ''}
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <table class="clean-table">
      <thead>
        <tr>
          <th>Device</th>
          <th>Student Owner</th>
          <th>Serial Number</th>
          <th>QR Token</th>
          <th>Status</th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${gadgets.map((g, idx) => {
          const prevG = idx > 0 ? gadgets[idx - 1] : null;
          const isSameStudent = prevG && prevG.owner?.idNumber && prevG.owner?.idNumber === g.owner?.idNumber;
          const rowClass = isSameStudent ? 'student-group-accent' : '';
          return `
          <tr class="${rowClass}">
            <td>
              <div class="table-primary-title">${escapeHtml(g.brand)} ${escapeHtml(g.model)}</div>
              <div class="table-secondary-sub">${escapeHtml(g.category)} ${g.color ? `• Color: ${escapeHtml(g.color)}` : ''}</div>
            </td>
            <td>
              <div style="font-weight: 700; color: #0f172a; margin-bottom: 3px;">${escapeHtml(formatStudentDisplayName(g.owner?.name))}</div>
              <div class="font-mono" style="font-size: 0.775rem; color: var(--primary); font-weight: 700;">
                ${g.owner?.idNumber ? `ID: ${escapeHtml(g.owner.idNumber)}` : '-'}
              </div>
              ${g.owner?.department ? `<div style="font-size: 0.7rem; color: #64748b;">${escapeHtml(g.owner.department)}</div>` : ''}
            </td>
            <td>
              <span class="font-mono" style="font-size: 0.825rem; font-weight: 700; color: #1e293b; background: #f8fafc; padding: 4px 8px; border-radius: 6px; border: 1px solid #e2e8f0; display: inline-block;">
                ${escapeHtml(g.serialNumber || 'N/A')}
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
                ${(g.status === 'REGISTERED' || g.status === 'RETURNED') ? `
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
        `;
        }).join('')}
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
let missingReportsCache = [];

async function loadMissingIncidents() {
  const container = document.getElementById('missing-incidents-table');
  if (!container) return;

  try {
    const res = await api.getActiveMissing({ all: true });
    missingReportsCache = res.reports || [];
    const activeCount = missingReportsCache.filter(r => r.status === 'ACTIVE' && (r.gadget?.status === 'MISSING' || !r.gadget?.status)).length;
    const badge = document.getElementById('badge-missing-count');
    if (badge) {
      badge.textContent = activeCount;
      badge.style.display = activeCount > 0 ? 'inline-block' : 'none';
    }
    filterMissingTable();
  } catch (e) {
    container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted);">Error loading missing incidents.</div>`;
  }
}

function filterMissingTable() {
  const studentQuery = (document.getElementById('missing-student-filter')?.value || '').trim().toLowerCase();
  const deviceQuery = (document.getElementById('missing-device-search')?.value || '').trim().toLowerCase();
  const categoryFilter = document.getElementById('missing-type-filter')?.value || 'ALL';
  const statusFilter = document.getElementById('missing-status-filter')?.value || 'ACTIVE';
  const sortOption = document.getElementById('missing-sort-filter')?.value || 'SURNAME_ASC';

  let filtered = missingReportsCache;

  // 1. Missing Status Filter (ACTIVE, ALL, FOUND_IN_CUSTODY, RESOLVED)
  if (statusFilter === 'ACTIVE') {
    filtered = filtered.filter(r => r.status === 'ACTIVE' && (r.gadget?.status === 'MISSING' || !r.gadget?.status));
  } else if (statusFilter === 'FOUND_IN_CUSTODY') {
    filtered = filtered.filter(r => r.gadget?.status === 'FOUND_IN_CUSTODY');
  } else if (statusFilter === 'RESOLVED') {
    filtered = filtered.filter(r => r.status === 'RESOLVED' || r.status === 'CANCELLED' || r.gadget?.status === 'RETURNED');
  }
  // statusFilter === 'ALL' includes all incident records

  // 2. Device Type Filter
  if (categoryFilter !== 'ALL') {
    filtered = filtered.filter(r => matchesDeviceCategory(r.gadget?.category, categoryFilter));
  }

  // 3. Dedicated Search by Student ID or Student Surname
  if (studentQuery) {
    filtered = filtered.filter(r => {
      const studentId = (r.owner?.idNumber || '').toLowerCase();
      const studentName = (r.owner?.name || '').toLowerCase();
      const surname = getStudentSurname(r.owner?.name || '').toLowerCase();
      return studentId.includes(studentQuery) || surname.includes(studentQuery) || studentName.includes(studentQuery);
    });
  }

  // 4. Device Search (Search device, serial no., or QR token)
  if (deviceQuery) {
    filtered = filtered.filter(r => {
      const brand = (r.gadget?.brand || '').toLowerCase();
      const model = (r.gadget?.model || '').toLowerCase();
      const fullDev = `${brand} ${model}`;
      const sn = (r.gadget?.serialNumber || '').toLowerCase();
      const token = (r.gadget?.secureToken || '').toLowerCase();
      const loc = (r.lastSeenLocation || '').toLowerCase();
      const details = (r.details || '').toLowerCase();
      return brand.includes(deviceQuery) || model.includes(deviceQuery) || fullDev.includes(deviceQuery) || sn.includes(deviceQuery) || token.includes(deviceQuery) || loc.includes(deviceQuery) || details.includes(deviceQuery);
    });
  }

  // 5. Automatic Sort (Default: Surname A-Z, then Student ID Ascending)
  // Keeps all missing gadgets belonging to the same student consecutive
  const sorted = sortGadgetsList(filtered, sortOption, r => r.owner, r => r.lastSeenDate || r.reportedAt || r.createdAt);

  const hasFilter = Boolean(studentQuery || deviceQuery || categoryFilter !== 'ALL' || statusFilter !== 'ACTIVE' || sortOption !== 'SURNAME_ASC');
  renderMissingTable(sorted, hasFilter);
}

function clearMissingFilter() {
  const stInput = document.getElementById('missing-student-filter');
  const devInput = document.getElementById('missing-device-search');
  const catSelect = document.getElementById('missing-type-filter');
  const statusSelect = document.getElementById('missing-status-filter');
  const sortSelect = document.getElementById('missing-sort-filter');

  if (stInput) stInput.value = '';
  if (devInput) devInput.value = '';
  if (catSelect) catSelect.value = 'ALL';
  if (statusSelect) statusSelect.value = 'ACTIVE';
  if (sortSelect) sortSelect.value = 'SURNAME_ASC';

  filterMissingTable();
}

function renderMissingTable(reports, hasFilter = false) {
  const container = document.getElementById('missing-incidents-table');
  if (!container) return;

  if (reports.length === 0) {
    if (hasFilter) {
      container.innerHTML = `
        <div style="padding: 35px; text-align: center; color: var(--text-muted);">
          <div style="font-size: 1.8rem; margin-bottom: 6px;">🔍</div>
          <h4 style="font-weight: 700; color: var(--text-main);">No Missing Reports Found</h4>
          <p style="font-size: 0.85rem;">No missing incidents match your search or filter selection.</p>
          <button class="btn btn-secondary btn-sm" onclick="clearMissingFilter()" style="margin-top: 10px;">Reset Filters</button>
        </div>
      `;
    } else {
      container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted);">No active missing incidents on campus.</div>`;
    }
    return;
  }

  container.innerHTML = `
    <table class="clean-table">
      <thead>
        <tr>
          <th>Missing Gadget</th>
          <th>Student Owner</th>
          <th>Status</th>
          <th>Last Known Location</th>
          <th>Date & Time</th>
          <th>Circumstances</th>
          <th class="text-right">Intake / Recovery Action</th>
        </tr>
      </thead>
      <tbody>
        ${reports.map((r, idx) => {
          const prevR = idx > 0 ? reports[idx - 1] : null;
          const isSameStudent = prevR && prevR.owner?.idNumber && prevR.owner?.idNumber === r.owner?.idNumber;
          const rowClass = isSameStudent ? 'student-group-accent' : '';
          return `
          <tr class="${rowClass}">
            <td>
              <div class="table-primary-title" style="color: #b91c1c;">${escapeHtml(r.gadget?.brand)} ${escapeHtml(r.gadget?.model)}</div>
              <div class="table-secondary-sub">${escapeHtml(r.gadget?.category)} ${r.gadget?.serialNumber ? `• S/N: <span class="font-mono">${escapeHtml(r.gadget.serialNumber)}</span>` : ''}</div>
            </td>
            <td>
              <div style="font-weight: 700; color: #0f172a; margin-bottom: 3px;">${escapeHtml(formatStudentDisplayName(r.owner?.name))}</div>
              <div class="font-mono" style="font-size: 0.775rem; color: var(--primary); font-weight: 700;">
                ${r.owner?.idNumber ? `ID: ${escapeHtml(r.owner.idNumber)}` : '-'}
              </div>
              ${r.owner?.department ? `<div style="font-size: 0.725rem; color: #64748b;">${escapeHtml(r.owner.department)}</div>` : ''}
              ${r.owner?.email ? `<div style="font-size: 0.7rem; color: #94a3b8;">${escapeHtml(r.owner.email)}</div>` : ''}
            </td>
            <td>${renderStatusBadge(r.gadget?.status || r.status)}</td>
            <td>
              <div style="font-size: 0.875rem; color: #b91c1c; font-weight: 700; display:flex; align-items:center; gap:6px;">
                📍 ${escapeHtml(r.lastSeenLocation)}
              </div>
            </td>
            <td style="font-size: 0.825rem; color: #64748b;">${formatDate(r.lastSeenDate || r.reportedAt)}</td>
            <td style="font-size: 0.825rem; color: #475569; max-width: 240px; line-height: 1.45;">"${escapeHtml(r.details || 'None')}"</td>
            <td class="text-right">
              <div class="table-action-btns" style="display:inline-flex; align-items:center; gap:6px; justify-content:flex-end;">
                ${(r.gadget?.status === 'MISSING' || r.status === 'ACTIVE') ? `
                  <button class="btn btn-primary btn-sm" onclick="openReceiveCustodyModal('${r.gadgetId || r.gadget?.id}', '${escapeHtml(r.gadget?.brand || '')} ${escapeHtml(r.gadget?.model || '')}', '${escapeHtml(r.owner?.name || 'Student')}', '${escapeHtml(r.owner?.idNumber || 'N/A')}', '', '${escapeHtml(r.gadgetId || r.gadget?.id || '')}')" style="display:inline-flex; align-items:center; gap:5px;" title="Confirm physical receipt into OSA custody">
                    🏢 Confirm OSA Receipt
                  </button>
                ` : ''}
                ${r.gadget?.status === 'FOUND_IN_CUSTODY' ? `
                  <button class="btn btn-primary btn-sm" onclick="navigateOsa('claims')" style="display:inline-flex; align-items:center; gap:5px;">
                    🤝 Review Claims
                  </button>
                ` : ''}
                ${r.gadget?.secureToken ? `
                  <a href="/device/${r.gadget?.secureToken}" target="_blank" class="btn btn-secondary btn-sm" style="display:inline-flex; align-items:center; gap:4px;" title="Open public QR recovery page">
                    🔗
                  </a>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
        }).join('')}
      </tbody>
    </table>
  `;
}

// 5. Custody & Found Intake (Section F: Confirm Physical Receipt)
async function loadFoundCustodyVault() {
  const container = document.getElementById('found-custody-table');
  if (!container) return;

  try {
    const res = await api.getAllFoundReports();
    let reports = res.reports || [];

    // Filter out reports where the item is already returned back to the student
    reports = reports.filter(r => {
      if (r.status === 'RESOLVED' || r.status === 'CANCELLED' || r.status === 'RETURNED' || r.status === 'RECOVERED_BY_OWNER') {
        return false;
      }
      if (r.gadget && r.gadget.status === 'REGISTERED') {
        return false;
      }
      return true;
    });

    window._foundReportsList = reports;
    renderFoundCustodyTable(reports);
  } catch (e) {
    console.error('Error loading custody vault:', e);
  }
}

function renderFoundCustodyTable(reports) {
  const container = document.getElementById('found-custody-table');
  if (!container) return;

  if (!reports || reports.length === 0) {
    container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted);">No active surrendered or found devices matching criteria.</div>`;
    return;
  }

  container.innerHTML = `
    <table class="clean-table">
      <thead>
        <tr>
          <th>Surrender Ref / Case ID</th>
          <th>Gadget & Owner</th>
          <th>Finder Information</th>
          <th>Found Location</th>
          <th>Turnover Status</th>
          <th class="text-right">Custody Action</th>
        </tr>
      </thead>
      <tbody>
        ${reports.map(r => {
          const isInCustody = (r.status === 'IN_OSA_CUSTODY' || r.gadget?.custodyStatus === 'IN_OSA_CUSTODY' || r.gadget?.status === 'FOUND_IN_CUSTODY');
          const isPendingTurnover = (r.turnInMethod === 'SUBMITTED_TO_OSA' || r.finderDecision === 'WILL_SURRENDER_TO_OSA' || r.status === 'PENDING_OSA_TURNOVER');
          const surrenderRef = r.surrenderReference || ('SRF-' + (r.id ? r.id.substring(4, 10).toUpperCase() : 'PENDING'));

          return `
            <tr>
              <td>
                <div class="font-mono" style="font-weight: 800; color: #142a6d; font-size: 0.88rem; letter-spacing: 0.3px;">
                  ${escapeHtml(surrenderRef)}
                </div>
                <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">
                  ${formatDate(r.foundDate || r.createdAt)}
                </div>
              </td>
              <td>
                <div class="table-primary-title">${escapeHtml(r.gadget?.brand)} ${escapeHtml(r.gadget?.model)}</div>
                <div class="table-secondary-sub">
                  👤 ${escapeHtml(r.owner?.name || 'Student Member')} 
                  <span class="font-mono" style="font-weight: 700; color: #142a6d;">(${escapeHtml(r.owner?.idNumber || 'No ID')})</span>
                </div>
                <div class="font-mono" style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">
                  ID: ${escapeHtml(r.gadgetId || r.gadget?.id || '')}
                </div>
              </td>
              <td>
                <div style="font-weight: 700; color: #0f172a; margin-bottom: 2px;">
                  👤 ${escapeHtml(r.finderName || 'Finder')}
                </div>
                <div class="font-mono" style="font-size: 0.775rem; color: #475569;">
                  ${r.finderContact ? `📞 ${escapeHtml(r.finderContact)}` : '<span style="color:#94a3b8; font-style:italic;">None provided</span>'}
                </div>
              </td>
              <td>
                <div style="font-size: 0.85rem; font-weight: 600; color: #334155;">📍 ${escapeHtml(r.foundLocation)}</div>
                ${r.message ? `<div style="font-size: 0.75rem; color: #64748b; font-style: italic; margin-top: 2px; max-width: 220px;">"${escapeHtml(r.message)}"</div>` : ''}
              </td>
              <td>
                ${isInCustody ? `
                  <span class="status-badge" style="background: #ecfdf5; color: #047857; font-weight: 800; font-size: 0.74rem; padding: 4px 10px; border: 1px solid #a7f3d0;">
                    IN OSA CUSTODY
                  </span>
                  <div style="font-size: 0.72rem; color: #059669; font-weight: 600; margin-top: 3px;">Ready for Claim</div>
                ` : isPendingTurnover ? `
                  <span class="status-badge" style="background: #fef3c7; color: #92400e; font-weight: 800; font-size: 0.74rem; padding: 4px 10px; border: 1px solid #fde68a;">
                    PENDING OSA TURNOVER
                  </span>
                  <div style="font-size: 0.72rem; color: #b45309; font-weight: 600; margin-top: 3px;">Will Surrender to OSA</div>
                ` : `
                  <span class="status-badge" style="background: #f1f5f9; color: #334155; font-size: 0.74rem; padding: 4px 10px;">
                    Finder Holding
                  </span>
                `}
              </td>
              <td class="text-right">
                <div class="table-action-btns" style="justify-content: flex-end;">
                  ${isInCustody ? `
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:3px;">
                      <span style="font-size:0.8rem; color:#047857; font-weight:700;">✓ In Vault Locker</span>
                      <button class="btn btn-secondary btn-sm" onclick="navigateOsa('claims')" style="font-size:0.75rem; padding:3px 8px;">
                        Review Claims
                      </button>
                    </div>
                  ` : `
                    <button class="btn btn-primary btn-sm" onclick="openReceiveCustodyModal('${r.id}', '${escapeHtml(r.gadget?.brand || '')} ${escapeHtml(r.gadget?.model || '')}', '${escapeHtml(r.owner?.name || 'Student')}', '${escapeHtml(r.owner?.idNumber || 'N/A')}', '${escapeHtml(surrenderRef)}', '${escapeHtml(r.gadgetId || r.gadget?.id || '')}')" style="display:inline-flex; align-items:center; gap:5px; font-weight:700;">
                      🏢 Confirm OSA Receipt
                    </button>
                  `}
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function filterFoundCustodyTable() {
  const query = (document.getElementById('found-custody-search-input')?.value || '').toLowerCase().trim();
  if (!window._foundReportsList) return;
  if (!query) {
    renderFoundCustodyTable(window._foundReportsList);
    return;
  }
  const filtered = window._foundReportsList.filter(r => {
    const ref = (r.surrenderReference || '').toLowerCase();
    const gId = (r.gadgetId || r.gadget?.id || '').toLowerCase();
    const token = (r.gadget?.secureToken || '').toLowerCase();
    const gBrand = (r.gadget?.brand || '').toLowerCase();
    const gModel = (r.gadget?.model || '').toLowerCase();
    const ownerName = (r.owner?.name || '').toLowerCase();
    const ownerId = (r.owner?.idNumber || '').toLowerCase();
    const finder = (r.finderName || '').toLowerCase();
    const fLoc = (r.foundLocation || '').toLowerCase();
    return ref.includes(query) || gId.includes(query) || token.includes(query) ||
      gBrand.includes(query) || gModel.includes(query) || ownerName.includes(query) ||
      ownerId.includes(query) || finder.includes(query) || fLoc.includes(query);
  });
  renderFoundCustodyTable(filtered);
}

function openReceiveCustodyModal(reportIdOrGadgetId, deviceName = '', ownerName = '', studentIdNumber = '', surrenderRef = '', gadgetId = '') {
  document.getElementById('custody-report-id').value = reportIdOrGadgetId;

  const banner = document.getElementById('custody-device-info-banner');
  const dNameEl = document.getElementById('custody-device-name');
  const oNameEl = document.getElementById('custody-owner-name');
  const sRefEl = document.getElementById('custody-surrender-ref');
  const gIdEl = document.getElementById('custody-gadget-id');

  if (banner) {
    if (deviceName) {
      if (dNameEl) dNameEl.textContent = `📱 ${deviceName}`;
      if (oNameEl) oNameEl.textContent = `👤 Owner: ${ownerName} ${studentIdNumber ? `(${studentIdNumber})` : ''}`;
      if (sRefEl) sRefEl.textContent = `REF: ${surrenderRef || 'Direct Turnover'}`;
      if (gIdEl) gIdEl.textContent = `ID: ${gadgetId || reportIdOrGadgetId}`;
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
    }
  }

  const notesInput = document.getElementById('custody-notes-input');
  if (notesInput) {
    notesInput.value = 'Physical turnover confirmed at OSA front desk (Room 1109). Device verified in physical custody.';
  }

  document.getElementById('receive-custody-modal').classList.add('active');
}

async function handleReceiveCustodySubmit(e) {
  e.preventDefault();
  const reportId = document.getElementById('custody-report-id').value;
  const custodyLocation = document.getElementById('custody-location-input').value.trim();
  const notes = document.getElementById('custody-notes-input').value.trim();

  try {
    await api.receiveIntoCustody(reportId, { custodyLocation, notes });
    showToast('success', 'Item In OSA Custody!', `Moved to ${custodyLocation}. Owner notified to file claim.`);
    closeModal('receive-custody-modal');
    loadFoundCustodyVault();
    loadMissingGadgets();
  } catch (err) {
    showToast('error', 'Intake Failed', err.message);
  }
}

// 6. Claims Review Desk
// 6. Ownership Claims & Return Records Desk (Section A & D)
async function loadClaimsDesk() {
  const container = document.getElementById('claims-review-table');
  if (!container) return;

  try {
    const res = await api.getAllClaims();
    const claims = res.claims || [];
    window._claimsList = claims;
    renderClaimsTable(claims);
  } catch (e) {
    console.error('Error loading claims:', e);
  }
}

function renderClaimsTable(claims) {
  const container = document.getElementById('claims-review-table');
  if (!container) return;

  if (!claims || claims.length === 0) {
    container.innerHTML = `<div style="padding: 36px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">No ownership claims or return records found matching criteria.</div>`;
    return;
  }

  container.innerHTML = `
    <table class="clean-table">
      <thead>
        <tr>
          <th>Owner</th>
          <th>Gadget</th>
          <th>Device Identification</th>
          <th>Claim Proof</th>
          <th>Return Details</th>
          <th>Status</th>
          <th class="text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${claims.map(c => {
          const ownerName = c.user?.name || c.returnRecord?.receivedByPersonName || 'Student Member';
          const studentId = c.user?.idNumber || c.verificationIdNumber || c.returnRecord?.receivedByPersonId || 'No ID';
          const brandModel = `${c.gadget?.brand || 'Gadget'} ${c.gadget?.model || ''}`.trim();
          const gadgetId = c.gadgetId || c.gadget?.id || '-';
          const serialNo = c.gadget?.serialNumber || '-';
          const color = c.gadget?.color || 'Standard';
          const gadgetPhoto = c.gadget?.photoUrl || '/assets/default-gadget.png';
          const handoverPhoto = c.handoverPhotoUrl || c.returnRecord?.handoverPhotoUrl || null;
          const returnDate = c.returnDate || c.returnedAt || c.processedAt || c.createdAt;
          const processedStaff = c.processedByName || 'OSA Staff';
          const isReturned = (c.status === 'RETURNED' || c.status === 'CLAIMED');
          const isApproved = (c.status === 'APPROVED');
          const isPending = (c.status === 'PENDING');

          return `
            <tr>
              <!-- Group 1: Owner (Owner Name + Student ID) -->
              <td>
                <div class="table-primary-title" style="font-weight: 700; color: #0f172a;">${escapeHtml(ownerName)}</div>
                <div class="font-mono" style="font-size: 0.775rem; color: #142a6d; font-weight: 700; margin-top: 1px;">
                  ${escapeHtml(studentId)}
                </div>
                ${c.user?.department ? `<div style="font-size: 0.72rem; color: #64748b; margin-top: 2px;">${escapeHtml(c.user.department)}</div>` : ''}
              </td>

              <!-- Group 2: Gadget (Gadget Photo + Brand/Model + Color) -->
              <td>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <div style="position: relative; flex-shrink: 0; cursor: pointer;" onclick="viewLargePhoto('${escapeHtml(gadgetPhoto)}', '${escapeHtml(brandModel)} Photo')" title="Click to view larger photo">
                    <img src="${escapeHtml(gadgetPhoto)}" alt="${escapeHtml(brandModel)}" style="width: 44px; height: 44px; object-fit: cover; border-radius: 8px; border: 1.5px solid #cbd5e1; box-shadow: 0 1px 3px rgba(0,0,0,0.06); transition: transform 0.15s;" onmouseover="this.style.transform='scale(1.06)'" onmouseout="this.style.transform='scale(1)'">
                    <span style="position: absolute; bottom: -3px; right: -3px; background: #ffffff; border-radius: 50%; font-size: 9px; padding: 1px 3px; border: 1px solid #cbd5e1; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">🔍</span>
                  </div>
                  <div>
                    <div class="table-primary-title" style="font-weight: 700; font-size: 0.88rem;">${escapeHtml(brandModel)}</div>
                    <div style="display: flex; gap: 4px; align-items: center; margin-top: 3px; flex-wrap: wrap;">
                      <span style="background: #f1f5f9; color: #334155; font-size: 0.72rem; padding: 1px 6px; border-radius: 4px; font-weight: 600; border: 1px solid #e2e8f0;">
                        🎨 ${escapeHtml(color)}
                      </span>
                      ${c.gadget?.category ? `<span style="font-size: 0.72rem; color: #64748b;">${escapeHtml(c.gadget.category)}</span>` : ''}
                    </div>
                  </div>
                </div>
              </td>

              <!-- Group 3: Device Identification (Gadget ID + Serial Number/IMEI) -->
              <td>
                <div class="font-mono" style="font-size: 0.78rem; font-weight: 700; color: #0f172a;">
                  ID: <span style="color: #142a6d;">${escapeHtml(gadgetId)}</span>
                </div>
                <div class="font-mono" style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">
                  ${serialNo !== '-' ? `S/N: ${escapeHtml(serialNo)}` : '<span style="font-style:italic; color:#94a3b8;">No S/N recorded</span>'}
                </div>
                ${c.gadget?.custodyLocation ? `<div style="font-size: 0.72rem; color: #059669; font-weight: 600; margin-top: 2px;">📦 Locker: ${escapeHtml(c.gadget.custodyLocation)}</div>` : ''}
              </td>

              <!-- Group 4: Claim Proof (Claim/Return Photo thumbnail) -->
              <td>
                ${handoverPhoto ? `
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="position: relative; flex-shrink: 0; cursor: pointer;" onclick="viewLargePhoto('${escapeHtml(handoverPhoto)}', 'Handover Photo Proof — ${escapeHtml(brandModel)}')" title="Click to view larger handover photo">
                      <img src="${escapeHtml(handoverPhoto)}" alt="Handover Proof" style="width: 44px; height: 44px; object-fit: cover; border-radius: 8px; border: 1.5px solid #10b981; box-shadow: 0 1px 4px rgba(16,185,129,0.2); transition: transform 0.15s;" onmouseover="this.style.transform='scale(1.06)'" onmouseout="this.style.transform='scale(1)'">
                      <span style="position: absolute; bottom: -3px; right: -3px; background: #ecfdf5; color: #047857; border-radius: 50%; font-size: 9px; padding: 1px 3px; border: 1px solid #10b981; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">✓</span>
                    </div>
                    <div>
                      <span style="background: #ecfdf5; color: #047857; font-size: 0.72rem; font-weight: 700; padding: 2px 7px; border-radius: 4px; border: 1px solid #a7f3d0; display: inline-block;">
                        📸 Handover Proof
                      </span>
                      <div style="font-size: 0.7rem; color: #059669; margin-top: 2px; font-weight: 600;">Verified In-person</div>
                    </div>
                  </div>
                ` : c.proofDocumentUrl ? `
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="position: relative; flex-shrink: 0; cursor: pointer;" onclick="viewLargePhoto('${escapeHtml(c.proofDocumentUrl)}', 'Proof of Ownership Document')" title="Click to view ownership document">
                      <img src="${escapeHtml(c.proofDocumentUrl)}" alt="Ownership Proof" style="width: 44px; height: 44px; object-fit: cover; border-radius: 8px; border: 1.5px solid #cbd5e1;">
                    </div>
                    <div>
                      <span style="background: #eff6ff; color: #1e40af; font-size: 0.72rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1px solid #bfdbfe;">
                        📄 Ownership Doc
                      </span>
                      <div style="font-size: 0.7rem; color: #64748b; margin-top: 2px;">Receipt / Proof</div>
                    </div>
                  </div>
                ` : `
                  <div>
                    <span style="background: #f8fafc; color: #64748b; font-size: 0.72rem; font-weight: 600; padding: 2px 6px; border-radius: 4px; border: 1px solid #e2e8f0; display: inline-block;">
                      ID &amp; Statement
                    </span>
                    <div style="font-size: 0.72rem; color: #64748b; margin-top: 2px; max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(c.claimProofDetails || '')}">
                      "${escapeHtml(c.claimProofDetails || 'In-person ID check')}"
                    </div>
                  </div>
                `}
              </td>

              <!-- Group 5: Return Details (Date/Time + Processed By) -->
              <td>
                <div style="font-size: 0.82rem; font-weight: 600; color: #1e293b;">
                  📅 ${formatDate(returnDate)}
                </div>
                <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">
                  Staff: <span style="color: #142a6d; font-weight: 700;">${escapeHtml(processedStaff)}</span>
                </div>
              </td>

              <!-- Group 6: Status -->
              <td>
                ${isReturned ? `
                  <span class="status-badge" style="background: #ecfdf5; color: #047857; font-weight: 800; font-size: 0.74rem; padding: 4px 10px; border: 1px solid #a7f3d0;">
                    ✓ RETURNED
                  </span>
                  <div style="font-size: 0.7rem; color: #059669; font-weight: 600; margin-top: 2px;">Handover Complete</div>
                ` : isApproved ? `
                  <span class="status-badge" style="background: #eff6ff; color: #1e40af; font-weight: 800; font-size: 0.74rem; padding: 4px 10px; border: 1px solid #bfdbfe;">
                    ✓ APPROVED
                  </span>
                  <div style="font-size: 0.7rem; color: #2563eb; font-weight: 600; margin-top: 2px;">Awaiting Handover</div>
                ` : isPending ? `
                  <span class="status-badge" style="background: #fef3c7; color: #92400e; font-weight: 800; font-size: 0.74rem; padding: 4px 10px; border: 1px solid #fde68a;">
                    ⏳ PENDING REVIEW
                  </span>
                  <div style="font-size: 0.7rem; color: #b45309; font-weight: 600; margin-top: 2px;">Awaiting Verification</div>
                ` : `
                  <span class="status-badge" style="background: #fef2f2; color: #991b1b; font-weight: 800; font-size: 0.74rem; padding: 4px 10px; border: 1px solid #fecaca;">
                    ✕ REJECTED
                  </span>
                `}
              </td>

              <!-- Group 7: Actions / View Details -->
              <td class="text-right">
                <div class="table-action-btns" style="justify-content: flex-end; gap: 5px;">
                  <button class="btn btn-secondary btn-sm" onclick="openClaimDetailsModal('${c.id}')" title="View Full Details" style="font-size: 0.78rem; padding: 5px 10px;">
                    👁️ View Details
                  </button>
                  ${isPending ? `
                    <button class="btn btn-success btn-sm" onclick="handleApproveClaim('${c.id}')" title="Approve Claim" style="font-size: 0.78rem; padding: 5px 9px;">
                      ✓ Approve
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="handleReviewClaim('${c.id}', 'REJECT')" title="Reject Claim" style="font-size: 0.78rem; padding: 5px 9px;">
                      ✕
                    </button>
                  ` : ''}
                  ${isApproved ? `
                    <button class="btn btn-primary btn-sm" onclick="openDispatchReturnForGadget('${c.gadgetId}', '${escapeHtml(ownerName)}', '${escapeHtml(studentId)}', '${c.id}')" style="background: #6d28d9; border-color: #6d28d9; font-size: 0.78rem; padding: 5px 10px; font-weight: 700;" title="Complete Face-to-Face Handover">
                      🤝 Handover
                    </button>
                  ` : ''}
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function filterClaimsTable() {
  const query = (document.getElementById('claims-search-input')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('claims-status-filter')?.value || 'ALL';
  if (!window._claimsList) return;

  const filtered = window._claimsList.filter(c => {
    // Status filter
    if (statusFilter !== 'ALL') {
      if (statusFilter === 'RETURNED' && !(c.status === 'RETURNED' || c.status === 'CLAIMED')) return false;
      if (statusFilter === 'APPROVED' && c.status !== 'APPROVED') return false;
      if (statusFilter === 'PENDING' && c.status !== 'PENDING') return false;
      if (statusFilter === 'REJECTED' && c.status !== 'REJECTED') return false;
    }

    // Text search
    if (!query) return true;
    const ownerName = (c.user?.name || c.returnRecord?.receivedByPersonName || '').toLowerCase();
    const studentId = (c.user?.idNumber || c.verificationIdNumber || c.returnRecord?.receivedByPersonId || '').toLowerCase();
    const brand = (c.gadget?.brand || '').toLowerCase();
    const model = (c.gadget?.model || '').toLowerCase();
    const gadgetId = (c.gadgetId || c.gadget?.id || '').toLowerCase();
    const serial = (c.gadget?.serialNumber || '').toLowerCase();
    const color = (c.gadget?.color || '').toLowerCase();
    const staff = (c.processedByName || '').toLowerCase();

    return ownerName.includes(query) || studentId.includes(query) || brand.includes(query) ||
      model.includes(query) || gadgetId.includes(query) || serial.includes(query) ||
      color.includes(query) || staff.includes(query);
  });

  renderClaimsTable(filtered);
}

// Lightbox Photo Viewer
function viewLargePhoto(photoUrl, caption = 'Photo Preview') {
  if (!photoUrl) return;
  Swal.fire({
    title: caption,
    imageUrl: photoUrl,
    imageAlt: caption,
    showCloseButton: true,
    confirmButtonText: 'Close',
    confirmButtonColor: '#142a6d',
    imageHeight: 380,
    customClass: {
      image: 'preview-modal-img'
    }
  });
}

// View Full Claim & Return Details Modal
function openClaimDetailsModal(claimId) {
  if (!window._claimsList) return;
  const c = window._claimsList.find(item => item.id === claimId);
  if (!c) return;

  const content = document.getElementById('claim-details-content');
  if (!content) return;

  const ownerName = c.user?.name || c.returnRecord?.receivedByPersonName || 'Student Member';
  const studentId = c.user?.idNumber || c.verificationIdNumber || c.returnRecord?.receivedByPersonId || 'No ID';
  const brandModel = `${c.gadget?.brand || 'Gadget'} ${c.gadget?.model || ''}`.trim();
  const gadgetId = c.gadgetId || c.gadget?.id || '-';
  const serialNo = c.gadget?.serialNumber || '-';
  const color = c.gadget?.color || 'Standard';
  const category = c.gadget?.category || 'General';
  const gadgetPhoto = c.gadget?.photoUrl || '/assets/default-gadget.png';
  const handoverPhoto = c.handoverPhotoUrl || c.returnRecord?.handoverPhotoUrl || null;
  const returnDate = c.returnDate || c.returnedAt || c.processedAt || c.createdAt;
  const processedStaff = c.processedByName || 'OSA Staff';
  const isReturned = (c.status === 'RETURNED' || c.status === 'CLAIMED');

  content.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px;">
      <div>
        <span class="status-badge" style="${isReturned ? 'background:#ecfdf5; color:#047857;' : (c.status === 'APPROVED' ? 'background:#eff6ff; color:#1e40af;' : 'background:#fef3c7; color:#92400e;')} font-size:0.8rem; font-weight:800; padding:4px 12px;">
          ${isReturned ? '✓ RETURNED' : (c.status === 'APPROVED' ? '✓ APPROVED' : c.status)}
        </span>
        <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">Record Ref: <code class="font-mono">${escapeHtml(c.id)}</code></div>
      </div>
      ${c.status === 'APPROVED' ? `
        <button class="btn btn-primary btn-sm" onclick="closeModal('claim-details-modal'); openDispatchReturnForGadget('${c.gadgetId}', '${escapeHtml(ownerName)}', '${escapeHtml(studentId)}', '${c.id}')" style="background: #6d28d9; border-color: #6d28d9; font-weight:700;">
          🤝 Proceed to Handover
        </button>
      ` : ''}
    </div>

    <!-- Photos Grid: Gadget Photo + Handover Proof -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 18px;">
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center;">
        <div style="font-weight: 700; color: #334155; font-size: 0.8rem; margin-bottom: 8px;">📱 Registered Gadget Photo</div>
        <img src="${escapeHtml(gadgetPhoto)}" alt="${escapeHtml(brandModel)}" style="width: 100%; height: 160px; object-fit: cover; border-radius: 8px; border: 1px solid #cbd5e1; cursor: pointer;" onclick="viewLargePhoto('${escapeHtml(gadgetPhoto)}', '${escapeHtml(brandModel)}')">
        <div style="font-size: 0.72rem; color: #64748b; margin-top: 6px;">Click image to enlarge</div>
      </div>

      <div style="background: ${handoverPhoto ? '#f0fdf4' : '#f8fafc'}; border: 1px solid ${handoverPhoto ? '#86efac' : '#e2e8f0'}; border-radius: 10px; padding: 12px; text-align: center;">
        <div style="font-weight: 700; color: ${handoverPhoto ? '#166534' : '#334155'}; font-size: 0.8rem; margin-bottom: 8px;">
          ${handoverPhoto ? '📸 Photo Proof of Gadget Handover' : '📸 Handover Photo Proof'}
        </div>
        ${handoverPhoto ? `
          <img src="${escapeHtml(handoverPhoto)}" alt="Handover Proof" style="width: 100%; height: 160px; object-fit: cover; border-radius: 8px; border: 1.5px solid #16a34a; cursor: pointer;" onclick="viewLargePhoto('${escapeHtml(handoverPhoto)}', 'Handover Proof — ${escapeHtml(brandModel)}')">
          <div style="font-size: 0.72rem; color: #15803d; margin-top: 6px; font-weight: 600;">✓ Verified Handover Photo Attached</div>
        ` : `
          <div style="height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #ffffff; border-radius: 8px; border: 1.5px dashed #cbd5e1; color: #94a3b8; font-size: 0.82rem; padding: 10px;">
            <span>📷</span>
            <div style="margin-top: 6px;">Handover photo will be captured upon physical return.</div>
          </div>
        `}
      </div>
    </div>

    <!-- Structured Details Groups -->
    <div style="display: grid; gap: 12px; font-size: 0.85rem;">
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px;">
        <div style="font-weight: 800; color: #142a6d; font-size: 0.85rem; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.03em;">
          👤 Registered Owner / Claimant
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          <div><span style="color:#64748b;">Full Name:</span> <strong>${escapeHtml(ownerName)}</strong></div>
          <div><span style="color:#64748b;">Student ID:</span> <strong class="font-mono" style="color:#142a6d;">${escapeHtml(studentId)}</strong></div>
          ${c.user?.email ? `<div><span style="color:#64748b;">Email:</span> ${escapeHtml(c.user.email)}</div>` : ''}
          ${c.user?.contactNumber ? `<div><span style="color:#64748b;">Contact:</span> ${escapeHtml(c.user.contactNumber)}</div>` : ''}
          ${c.user?.department ? `<div><span style="color:#64748b;">Department:</span> ${escapeHtml(c.user.department)}</div>` : ''}
        </div>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px;">
        <div style="font-weight: 800; color: #142a6d; font-size: 0.85rem; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.03em;">
          📱 Device Identification
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          <div><span style="color:#64748b;">Device:</span> <strong>${escapeHtml(brandModel)}</strong></div>
          <div><span style="color:#64748b;">Color:</span> <strong>${escapeHtml(color)}</strong></div>
          <div><span style="color:#64748b;">Gadget ID:</span> <span class="font-mono">${escapeHtml(gadgetId)}</span></div>
          <div><span style="color:#64748b;">Serial / IMEI:</span> <span class="font-mono">${escapeHtml(serialNo)}</span></div>
          <div><span style="color:#64748b;">Category:</span> ${escapeHtml(category)}</div>
          ${c.gadget?.custodyLocation ? `<div><span style="color:#64748b;">Vault Locker:</span> <strong style="color:#059669;">${escapeHtml(c.gadget.custodyLocation)}</strong></div>` : ''}
        </div>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px;">
        <div style="font-weight: 800; color: #142a6d; font-size: 0.85rem; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.03em;">
          📜 Verification &amp; Return Handover Audit
        </div>
        <div style="display: grid; gap: 6px;">
          <div><span style="color:#64748b;">Date &amp; Time:</span> <strong>${formatDate(returnDate)}</strong></div>
          <div><span style="color:#64748b;">Processed By OSA Staff:</span> <strong style="color:#142a6d;">${escapeHtml(processedStaff)}</strong></div>
          <div><span style="color:#64748b;">Proof / Statement:</span> "${escapeHtml(c.claimProofDetails || 'Face-to-face handover at OSA Room 1109.')}"</div>
          ${c.returnRecord?.notes ? `<div><span style="color:#64748b;">Handover Notes:</span> "${escapeHtml(c.returnRecord.notes)}"</div>` : ''}
          ${c.returnRecord?.id ? `<div><span style="color:#64748b;">Official Receipt ID:</span> <code class="font-mono" style="color:#6d28d9; font-weight:700;">${escapeHtml(c.returnRecord.id)}</code></div>` : ''}
        </div>
      </div>
    </div>
  `;

  document.getElementById('claim-details-modal').classList.add('active');
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
    loadClaimsDesk();
    loadFoundCustodyVault();
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
    loadClaimsDesk();
    loadFoundCustodyVault();
  } catch (err) {
    await SwalHelper.error('Rejection Failed', err.message || 'Could not reject claim.');
  }
}

// =========================================================================
// 7. Official Return Handover Dispatch with Photo Proof (Section B, C, D)
// =========================================================================
let activeHandoverCameraStream = null;

async function openDispatchReturnModal(preselectedGadgetId = null, preselectedOwnerName = '', preselectedOwnerId = '', linkedClaimId = '') {
  const select = document.getElementById('return-select-gadget');
  if (!select) return;

  // Clean previous photo state
  removeHandoverPhoto();
  document.getElementById('return-claim-id').value = linkedClaimId || '';

  const res = await api.getAllGadgets();
  // Filter exclusively to gadgets currently held in OSA custody / vault locker
  const eligible = (res.gadgets || []).filter(g => g.status === 'FOUND_IN_CUSTODY');

  if (eligible.length === 0) {
    select.innerHTML = `<option value="">-- No Gadgets Currently in Vault Locker --</option>`;
  } else {
    select.innerHTML = `<option value="">-- Choose Vault Gadget for Handover (${eligible.length} in Custody) --</option>` + eligible.map(g => `
      <option value="${g.id}" data-owner="${escapeHtml(g.owner?.name || '')}" data-idnum="${escapeHtml(g.owner?.idNumber || '')}" ${preselectedGadgetId === g.id ? 'selected' : ''}>
        ${escapeHtml(g.brand)} ${escapeHtml(g.model)} (S/N: ${escapeHtml(g.serialNumber || 'N/A')}) — Owner: ${escapeHtml(g.owner?.name || 'Student')} [Locker: ${escapeHtml(g.custodyLocation || 'Vault')}]
      </option>
    `).join('');
  }

  if (preselectedGadgetId) {
    document.getElementById('return-recipient-name').value = preselectedOwnerName || '';
    document.getElementById('return-recipient-id').value = preselectedOwnerId || '';
  } else if (eligible.length > 0) {
    handleReturnSelectChange(select.value);
  }

  document.getElementById('dispatch-return-modal').classList.add('active');
}

function openDispatchReturnForGadget(gadgetId, ownerName, studentId, claimId) {
  openDispatchReturnModal(gadgetId, ownerName, studentId, claimId);
}

function handleReturnSelectChange(gadgetId) {
  const select = document.getElementById('return-select-gadget');
  const option = select.options[select.selectedIndex];
  if (option) {
    document.getElementById('return-recipient-name').value = option.getAttribute('data-owner') || '';
    document.getElementById('return-recipient-id').value = option.getAttribute('data-idnum') || '';
  }
}

// Camera / Webcam handler
async function triggerHandoverCamera() {
  const cameraBox = document.getElementById('handover-camera-box');
  const video = document.getElementById('handover-camera-video');
  if (!cameraBox || !video) return;

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    try {
      if (activeHandoverCameraStream) {
        stopHandoverCamera();
      }
      activeHandoverCameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      video.srcObject = activeHandoverCameraStream;
      cameraBox.style.display = 'block';
    } catch (err) {
      console.warn('Camera access unavailable, opening file selector fallback:', err);
      // Fallback: trigger file input (which on mobile opens the native camera)
      document.getElementById('handover-photo-file-input').click();
    }
  } else {
    document.getElementById('handover-photo-file-input').click();
  }
}

function captureHandoverPhotoFromCamera() {
  const video = document.getElementById('handover-camera-video');
  const canvas = document.getElementById('handover-camera-canvas');
  if (!video || !canvas) return;

  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  stopHandoverCamera();
  setHandoverPhoto(dataUrl);
}

function stopHandoverCamera() {
  if (activeHandoverCameraStream) {
    activeHandoverCameraStream.getTracks().forEach(track => track.stop());
    activeHandoverCameraStream = null;
  }
  const cameraBox = document.getElementById('handover-camera-box');
  if (cameraBox) cameraBox.style.display = 'none';
}

function handleHandoverPhotoFileChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    SwalHelper.warning('Invalid File', 'Please select a valid image file (JPG, PNG, WebP).');
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    setHandoverPhoto(event.target.result);
  };
  reader.readAsDataURL(file);
}

function setHandoverPhoto(photoDataUrl) {
  document.getElementById('handover-photo-data').value = photoDataUrl;
  document.getElementById('handover-photo-preview-img').src = photoDataUrl;
  document.getElementById('handover-photo-preview-wrap').style.display = 'block';
  document.getElementById('handover-photo-empty-notice').style.display = 'none';
}

function removeHandoverPhoto() {
  stopHandoverCamera();
  const photoInput = document.getElementById('handover-photo-data');
  const fileInput = document.getElementById('handover-photo-file-input');
  const previewWrap = document.getElementById('handover-photo-preview-wrap');
  const emptyNotice = document.getElementById('handover-photo-empty-notice');

  if (photoInput) photoInput.value = '';
  if (fileInput) fileInput.value = '';
  if (previewWrap) previewWrap.style.display = 'none';
  if (emptyNotice) emptyNotice.style.display = 'block';
}

// Submit Handover Dispatch (Section C: Requires Photo Proof)
async function handleDispatchReturnSubmit(e) {
  e.preventDefault();
  const gadgetId = document.getElementById('return-select-gadget').value;
  const claimId = document.getElementById('return-claim-id')?.value || null;
  const receivedByPersonName = document.getElementById('return-recipient-name').value.trim();
  const receivedByPersonId = document.getElementById('return-recipient-id').value.trim();
  const notes = document.getElementById('return-notes-input').value.trim();
  const handoverPhotoRaw = document.getElementById('handover-photo-data')?.value;

  if (!gadgetId) {
    await SwalHelper.warning('Select Gadget', 'Please select a gadget held in custody vault.');
    return;
  }

  // Section C: Photo proof of gadget handover is STRICTLY REQUIRED before completing return
  if (!handoverPhotoRaw || !handoverPhotoRaw.trim()) {
    await SwalHelper.warning(
      'Photo Proof Required 📸',
      'Photo proof of gadget handover is required before completing the return. Please snap or upload a face-to-face turnover photo.'
    );
    return;
  }

  try {
    let finalPhotoUrl = handoverPhotoRaw;

    // If photo is a base64 string, upload to persistent storage
    if (handoverPhotoRaw.startsWith('data:')) {
      const uploadRes = await api.uploadPhoto(handoverPhotoRaw);
      if (uploadRes && (uploadRes.photoUrl || uploadRes.url)) {
        finalPhotoUrl = uploadRes.photoUrl || uploadRes.url;
      }
    }

    const res = await api.dispatchReturn({
      gadgetId,
      claimId,
      receivedByPersonName,
      receivedByPersonId,
      notes,
      handoverPhotoUrl: finalPhotoUrl
    });

    closeModal('dispatch-return-modal');
    removeHandoverPhoto();

    await Swal.fire({
      icon: 'success',
      title: 'Handover Completed! 🎉',
      html: `
        <p style="font-size:0.92rem; color:#334155; margin-bottom:12px;">
          The gadget has been officially returned to <strong>${escapeHtml(receivedByPersonName)}</strong> (${escapeHtml(receivedByPersonId)}).
        </p>
        <div style="background:#f0fdf4; border:1.5px solid #86efac; border-radius:10px; padding:12px; font-size:0.85rem; text-align:left;">
          <div style="font-weight:700; color:#166534; margin-bottom:4px;">📜 Official Handover Receipt:</div>
          <div style="font-family:monospace; font-weight:800; color:#14532d; font-size:1.05rem;">${escapeHtml(res.returnRecord?.id || 'RECEIPT-RECORDED')}</div>
          <div style="font-size:0.75rem; color:#15803d; margin-top:6px;">✓ Photo proof securely attached to audit trail and Claims table.</div>
        </div>
      `,
      confirmButtonText: 'Great!',
      confirmButtonColor: '#142a6d'
    });

    loadClaimsDesk();
    loadFoundCustodyVault();
    loadMissingGadgets();
    loadRegisteredGadgets();
    loadOsaDashboardStats();
  } catch (err) {
    await SwalHelper.error('Return Dispatch Failed', err.message || 'Could not complete gadget return.');
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
                    <button class="btn btn-secondary btn-sm" onclick="resendApprovalEmail('${u.id}', '${escapeHtml(u.email)}')">
                      📧 Resend Email
                    </button>
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

async function resendApprovalEmail(userId, email) {
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      title: 'Sending Approval Email...',
      text: `Dispatching official email notification to ${email}...`,
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });
  }
  try {
    const res = await api.request('/osa/resend-approval-email', {
      method: 'POST',
      body: JSON.stringify({ userId })
    });
    if (res.success) {
      await SwalHelper.success('Email Sent! 📧', `Approval notification has been dispatched to ${email}.`, 2200);
    } else {
      await SwalHelper.error('Dispatch Failed', res.error || 'Could not send email.');
    }
  } catch (e) {
    await SwalHelper.error('Dispatch Failed', e.message || 'Error communicating with server.');
  }
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
              <td style="font-size: 0.85rem; font-weight: 600;">
                📍 ${escapeHtml(s.scanLocationNote || 'Location unavailable')}
                ${s.locationSource === 'GPS' ? '<span class="badge" style="background:#ecfdf5; color:#047857; font-size:0.68rem; font-weight:700; border:1px solid #a7f3d0; border-radius:4px; padding:1px 5px; margin-left:4px;">GPS</span>' : (s.locationSource === 'IP' ? '<span class="badge" style="background:#eff6ff; color:#1e40af; font-size:0.68rem; font-weight:700; border:1px solid #bfdbfe; border-radius:4px; padding:1px 5px; margin-left:4px;">IP</span>' : '')}
              </td>
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

// Quick cross-section filter helper for OSA
function filterOsaByStudentId(screen, studentId) {
  if (!studentId) return;
  navigateOsa(screen);
  setTimeout(() => {
    if (screen === 'registered') {
      const input = document.getElementById('vault-student-filter');
      if (input) {
        input.value = studentId;
        filterVaultTable();
      }
    } else if (screen === 'missing') {
      const input = document.getElementById('missing-student-filter');
      if (input) {
        input.value = studentId;
        filterMissingTable();
      }
    } else if (screen === 'approvals') {
      const input = document.getElementById('approvals-student-filter');
      if (input) {
        input.value = studentId;
        filterApprovalsTable();
      }
    }
  }, 120);
}
