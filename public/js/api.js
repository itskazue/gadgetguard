
/**
 * NCST GadgetGuard Universal SweetAlert2 & Error Handling System
 * Formatted with NCST Institutional Colors (Yellow, Royal Blue, Pure White)
 */
const SwalHelper = {
  hasSwal() {
    return typeof Swal !== 'undefined';
  },

  async confirm({
    title = 'Are you sure?',
    text = '',
    html = '',
    icon = 'question',
    confirmText = 'Yes, Proceed',
    cancelText = 'Cancel',
    isDanger = false,
    confirmColor = null
  } = {}) {
    if (!this.hasSwal()) {
      return window.confirm(html ? title : (title + '\n\n' + text));
    }

    const defaultConfirmColor = isDanger ? '#dc2626' : (confirmColor || '#142a6d');
    const result = await Swal.fire({
      title,
      text: html ? undefined : text,
      html: html || undefined,
      icon,
      showCancelButton: true,
      confirmButtonColor: defaultConfirmColor,
      cancelButtonColor: '#64748b',
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      reverseButtons: true,
      focusCancel: isDanger,
      customClass: {
        popup: 'ncst-swal-popup',
        confirmButton: 'ncst-swal-confirm',
        cancelButton: 'ncst-swal-cancel',
        title: 'ncst-swal-title'
      }
    });

    return result.isConfirmed;
  },

  async success(title, text = '', timer = 2200) {
    if (!this.hasSwal()) {
      alert(title + '\n' + text);
      return;
    }
    return await Swal.fire({
      icon: 'success',
      title,
      text,
      confirmButtonColor: '#142a6d',
      confirmButtonText: 'Great!',
      timer: timer > 0 ? timer : undefined,
      timerProgressBar: Boolean(timer),
      customClass: { popup: 'ncst-swal-popup' }
    });
  },

  async error(title, text = 'An error occurred. Please try again.') {
    if (!this.hasSwal()) {
      alert('Error: ' + title + '\n' + text);
      return;
    }
    return await Swal.fire({
      icon: 'error',
      title: title || 'Action Failed',
      text: String(text || 'An unexpected error occurred.'),
      confirmButtonColor: '#142a6d',
      confirmButtonText: 'Understood',
      customClass: { popup: 'ncst-swal-popup' }
    });
  },

  async warning(title, text = '') {
    if (!this.hasSwal()) {
      alert('Notice: ' + title + '\n' + text);
      return;
    }
    return await Swal.fire({
      icon: 'warning',
      title,
      text,
      confirmButtonColor: '#f59e0b',
      confirmButtonText: 'Got It',
      customClass: { popup: 'ncst-swal-popup' }
    });
  },

  async info(title, text = '') {
    if (!this.hasSwal()) {
      alert('Information: ' + title + '\n' + text);
      return;
    }
    return await Swal.fire({
      icon: 'info',
      title,
      text,
      confirmButtonColor: '#142a6d',
      confirmButtonText: 'OK',
      customClass: { popup: 'ncst-swal-popup' }
    });
  },

  async prompt({
    title = 'Input Required',
    text = '',
    input = 'text',
    inputPlaceholder = '',
    inputValue = '',
    confirmText = 'Submit',
    cancelText = 'Cancel',
    isRequired = true,
    validationMessage = 'This field cannot be left blank.'
  } = {}) {
    if (!this.hasSwal()) {
      const val = window.prompt(title + '\n' + text, inputValue);
      return val !== null && val.trim() !== '' ? val : null;
    }

    const { value: resultVal, isConfirmed } = await Swal.fire({
      title,
      text,
      input,
      inputValue,
      inputPlaceholder,
      showCancelButton: true,
      confirmButtonColor: '#142a6d',
      cancelButtonColor: '#64748b',
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      reverseButtons: true,
      inputValidator: (val) => {
        if (isRequired && (!val || !val.trim())) {
          return validationMessage;
        }
      },
      customClass: { popup: 'ncst-swal-popup' }
    });

    return isConfirmed ? resultVal : null;
  },

  toast(icon = 'info', title = '', text = '') {
    if (!this.hasSwal()) {
      if (typeof showToast === 'function') showToast(icon, title, text);
      return;
    }
    const Toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 3500,
      timerProgressBar: true
    });

    Toast.fire({
      icon,
      title: text ? (title + ': ' + text) : title
    });
  }
};

/**
 * GadgetGuard Unified API Client & Real-time State Hub
 */

const API_BASE = '/api';

const api = {
  getToken() {
    return localStorage.getItem('gg_token');
  },

  setToken(token) {
    if (token) {
      localStorage.setItem('gg_token', token);
    } else {
      localStorage.removeItem('gg_token');
    }
  },

  getCurrentUser() {
    const raw = localStorage.getItem('gg_user');
    try {
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  setCurrentUser(user) {
    if (user) {
      localStorage.setItem('gg_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('gg_user');
    }
  },

  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(url, {
        ...options,
        headers
      });

      const data = await res.json().catch(() => ({ success: false, error: 'Network parsing error' }));

      if (!res.ok) {
        if (res.status === 401 && !endpoint.includes('/login') && !endpoint.includes('/register')) {
          console.warn('Session expired or unauthorized');
        }
        throw new Error(data.error || `HTTP error ${res.status}`);
      }

      return data;
    } catch (err) {
      console.error(`API Error [${endpoint}]:`, err);
      throw err;
    }
  },

  // Auth endpoints
  async login(email, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (data.success) {
      this.setToken(data.token);
      this.setCurrentUser(data.user);
    }
    return data;
  },

  async register(formData) {
    const data = await this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(formData)
    });
    if (data.success) {
      this.setToken(data.token);
      this.setCurrentUser(data.user);
    }
    return data;
  },

  async getMe() {
    const data = await this.request('/auth/me');
    if (data.success) {
      this.setCurrentUser(data.user);
    }
    return data;
  },

  logout() {
    this.setToken(null);
    this.setCurrentUser(null);
  },

  async changePassword(currentPassword, newPassword, confirmNewPassword) {
    return await this.request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword })
    });
  },

  // Gadgets
  async getMyGadgets() {
    return await this.request('/gadgets/my');
  },

  async getAllGadgets(params = {}) {
    const query = new URLSearchParams(params).toString();
    return await this.request(`/gadgets?${query}`);
  },

  async getGadget(id) {
    return await this.request(`/gadgets/${id}`);
  },

  async registerGadget(gadgetData) {
    return await this.request('/gadgets/register', {
      method: 'POST',
      body: JSON.stringify(gadgetData)
    });
  },

  async approveGadget(id) {
    return await this.request(`/gadgets/${id}/approve`, { method: 'POST' });
  },

  async rejectGadget(id, reason) {
    return await this.request(`/gadgets/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },

  async updateGadgetPhoto(id, photoUrl, removePhoto = false) {
    return await this.request(`/gadgets/${id}/photo`, {
      method: 'PATCH',
      body: JSON.stringify({ photoUrl, removePhoto })
    });
  },

  // Missing
  async reportMissing(missingData) {
    return await this.request('/missing/report', {
      method: 'POST',
      body: JSON.stringify(missingData)
    });
  },

  async getActiveMissing(params = {}) {
    const q = new URLSearchParams(params).toString();
    return await this.request('/missing/active' + (q ? '?' + q : ''));
  },

  async cancelMissing(id) {
    return await this.request(`/missing/${id}/cancel`, { method: 'POST' });
  },

  // Scan & Device QR
  async lookupDeviceQR(token, extraParams = {}) {
    const params = { ...extraParams };
    const finderToken = params.finderToken;
    const query = new URLSearchParams(params).toString();
    const headers = {};
    if (finderToken) {
      headers['x-finder-token'] = finderToken;
    }
    return await this.request(`/scan/device/${token}${query ? '?' + query : ''}`, { headers });
  },

  async logScan(tokenOrPayload, locationNote, deviceInfo) {
    let payload = {};
    if (typeof tokenOrPayload === 'object' && tokenOrPayload !== null) {
      payload = { ...tokenOrPayload };
    } else {
      payload = { token: tokenOrPayload, locationNote, deviceInfo };
    }
    const headers = {};
    if (payload.finderToken) {
      headers['x-finder-token'] = payload.finderToken;
    }
    return await this.request('/scan/log', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  },

  async getMyScanHistory() {
    return await this.request('/scan/history/my');
  },

  async getAllScanHistory() {
    return await this.request('/scan/history/all');
  },

  // Finder
  async reportFoundGadget(token, data) {
    return await this.submitFoundReport({
      token,
      secureToken: token,
      ...data,
      foundLocation: data.location || data.foundLocation,
      message: data.notes || data.message
    });
  },

  async submitFoundReport(reportData) {
    const headers = {};
    const finderToken = reportData.finderSessionToken || reportData.finderToken;
    if (finderToken) {
      headers['x-finder-token'] = finderToken;
    }
    return await this.request('/finder/report', {
      method: 'POST',
      headers,
      body: JSON.stringify(reportData)
    });
  },

  async getAllFoundReports() {
    return await this.request('/finder/reports');
  },

  async receiveIntoCustody(reportId, custodyData) {
    return await this.request(`/finder/${reportId}/receive`, {
      method: 'POST',
      body: JSON.stringify(custodyData)
    });
  },

  // Recovery Chat (Private Finder ↔ Owner communication)
  async getRecoveryChat(chatId, finderToken = null) {
    const headers = {};
    if (finderToken) {
      headers['x-finder-token'] = finderToken;
    }
    return await this.request(`/chat/${chatId}`, { headers });
  },

  async sendRecoveryChatMessage(chatId, text, finderToken = null) {
    const headers = {};
    if (finderToken) {
      headers['x-finder-token'] = finderToken;
    }
    return await this.request(`/chat/${chatId}/message`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, finderToken })
    });
  },

  async getRecoveryChatByGadget(gadgetId) {
    return await this.request(`/chat/by-gadget/${gadgetId}`);
  },

  async getActiveFinderChat(token, finderToken) {
    const headers = { 'x-finder-token': finderToken };
    return await this.request(`/chat/active-finder/${token}`, { headers });
  },

  // Claims
  async submitClaim(claimData) {
    return await this.request('/claims/submit', {
      method: 'POST',
      body: JSON.stringify(claimData)
    });
  },

  async getMyClaims() {
    return await this.request('/claims/my');
  },

  async getAllClaims() {
    return await this.request('/claims');
  },

  async reviewClaim(claimId, action, rejectionReason) {
    return await this.request(`/claims/${claimId}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, rejectionReason })
    });
  },

  // OSA operations
  async getOsaStats() {
    return await this.request('/osa/stats');
  },

  // Photo Upload helper
  async uploadPhoto(fileOrBase64) {
    if (typeof fileOrBase64 === 'string' && fileOrBase64.startsWith('data:')) {
      return await this.request('/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo: fileOrBase64 })
      });
    } else if (fileOrBase64 instanceof FormData) {
      const token = this.getToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${this.baseUrl}/upload`, {
        method: 'POST',
        headers,
        body: fileOrBase64
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      return data;
    } else if (fileOrBase64 instanceof File || fileOrBase64 instanceof Blob) {
      const formData = new FormData();
      formData.append('photo', fileOrBase64);
      const token = this.getToken();
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${this.baseUrl}/upload`, {
        method: 'POST',
        headers,
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      return data;
    }
    throw new Error('Invalid photo upload payload');
  },

  async dispatchReturn(returnData) {
    return await this.request('/osa/return', {
      method: 'POST',
      body: JSON.stringify(returnData)
    });
  },

  async getReturns() {
    return await this.request('/osa/returns');
  },

  async getAuditLogs() {
    return await this.request('/osa/audit-logs');
  },

  async getSettings() {
    return await this.request('/osa/settings');
  },

  async updateSettings(settings) {
    return await this.request('/osa/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  },

  async resetDemoData() {
    return await this.request('/osa/reset-demo', { method: 'POST' });
  },

  // Notifications
  async getNotifications() {
    return await this.request('/notifications');
  },

  async markNotificationRead(id) {
    return await this.request(`/notifications/${id}/read`, { method: 'PUT' });
  },

  async markAllNotificationsRead() {
    return await this.request('/notifications/read-all', { method: 'PUT' });
  }
};


// Universal SweetAlert Confirmation Dialog
async function confirmAction({
  title = 'Are you sure?',
  text = '',
  html = '',
  icon = 'warning',
  confirmButtonText = 'Yes, Proceed',
  cancelButtonText = 'Cancel',
  confirmButtonColor = '#142a6d',
  cancelButtonColor = '#64748b'
} = {}) {
  if (typeof Swal === 'undefined') {
    return window.confirm(text || title);
  }
  const result = await Swal.fire({
    title,
    text: html ? undefined : text,
    html: html || undefined,
    icon,
    showCancelButton: true,
    confirmButtonColor,
    cancelButtonColor,
    confirmButtonText,
    cancelButtonText,
    reverseButtons: true,
    focusCancel: true
  });
  return result.isConfirmed;
}

// UI Helper: Toast Notifications
function showToast(type = 'info', title = '', message = '') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(message)}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 200);
    }
  }, 4500);
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

function formatPhDate(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '-';
  
  // Explicit UTC+8 calculation for Philippine Standard Time (PST)
  const utcMs = d.getTime() + (d.getTimezoneOffset() * 60000);
  const phDate = new Date(utcMs + (8 * 3600000));
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[phDate.getMonth()];
  const day = phDate.getDate();
  const year = phDate.getFullYear();
  const hours24 = phDate.getHours();
  const hours12 = String(hours24 % 12 || 12).padStart(2, '0');
  const minutes = String(phDate.getMinutes()).padStart(2, '0');
  const ampm = hours24 >= 12 ? 'PM' : 'AM';
  
  return `${month} ${day}, ${year}, ${hours12}:${minutes} ${ampm}`;
}

function formatDate(isoStr) {
  return formatPhDate(isoStr);
}

function renderStatusBadge(status) {
  const labels = {
    REGISTERED: 'Registered & Protected',
    PENDING_APPROVAL: 'Pending Approval',
    MISSING: 'Reported Missing',
    FOUND_IN_CUSTODY: 'In OSA Custody',
    RETURNED: 'Reunited / Returned',
    REJECTED: 'Rejected'
  };
  const label = labels[status] || status;
  return `<span class="status-badge ${status}">${label}</span>`;
}

// Live Server-Sent Events sync
let eventListeners = [];
function onLiveEvent(callback) {
  eventListeners.push(callback);
}

function connectLiveEvents() {
  if (typeof EventSource === 'undefined') return;
  
  const es = new EventSource('/api/events');
  es.onmessage = function (e) {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'MUTATION') {
        eventListeners.forEach(fn => fn(data));
      }
    } catch (err) {
      // Ignore
    }
  };

  es.onerror = function () {
    // Reconnects automatically
  };
}

// Auto-start SSE
connectLiveEvents();

// Universal Quick Switch Bar generator (Disabled for genuine production demo)
function renderUniversalSwitchBar(activeSite = 'public') {
  // Disabled
}

function openDemoAccountPicker() {
  // Disabled
}

async function logoutCurrentSession() {
  const confirmed = await SwalHelper.confirm({
    title: 'Sign Out Confirmation',
    text: 'Are you sure you want to log out of your GadgetGuard account?',
    icon: 'question',
    confirmText: 'Yes, Sign Out',
    cancelText: 'Stay Logged In',
    isDanger: true
  });

  if (!confirmed) return;

  try {
    api.logout();
    await SwalHelper.success('Signed Out', 'You have been logged out successfully.', 1200);
    const isOsa = window.location.pathname.includes('/osa');
    setTimeout(() => {
      window.location.href = isOsa ? '/osa/login.html' : '/';
    }, 600);
  } catch (err) {
    await SwalHelper.error('Sign Out Error', err.message || 'Error occurred while signing out.');
  }
}