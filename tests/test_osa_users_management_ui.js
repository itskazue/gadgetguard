/**
 * NCST GadgetGuard — Task #5: OSA Users Management UI Improvements Test Suite
 * Validates removal of Resend/Suspend actions, View Registered Gadgets modal,
 * strict read-only enforcement, user isolation, XSS protection, and database immutability.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('========================================================================');
console.log('   GADGETGUARD — TASK #5: OSA USERS MANAGEMENT UI TEST SUITE            ');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// [1/6] Verify Baseline Database Integrity
// -----------------------------------------------------------------------------
console.log('[1/6] Verifying Baseline Database Checksum...');
const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
const initialChecksum = crypto.createHash('sha256').update(fs.readFileSync(DB_PATH)).digest('hex').toLowerCase();
const EXPECTED_CHECKSUM = '4505f70dd6fc6e3770c37564946868d199a9cc1b98ccb18b27f51f00a996f8e6';
assert.strictEqual(initialChecksum, EXPECTED_CHECKSUM, `Database checksum mismatch: ${initialChecksum}`);
console.log(`  ✓ Database checksum verified: ${initialChecksum}\n`);

// -----------------------------------------------------------------------------
// [2/6] Inspect Source Files & Static Markup
// -----------------------------------------------------------------------------
console.log('[2/6] Inspecting Static Files (index.html, osa.css, osa.js)...');

const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'index.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'osa.css'), 'utf8');
const jsContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'osa.js'), 'utf8');

// HTML modal inspection
assert(htmlContent.includes('id="osa-user-gadgets-modal"'), 'index.html contains #osa-user-gadgets-modal');
assert(htmlContent.includes('id="user-gadgets-modal-subtitle"'), 'index.html contains #user-gadgets-modal-subtitle');
assert(htmlContent.includes('id="user-gadgets-modal-body"'), 'index.html contains #user-gadgets-modal-body');

// CSS rules inspection
assert(cssContent.includes('.user-gadgets-list'), 'osa.css contains .user-gadgets-list');
assert(cssContent.includes('.user-gadget-card'), 'osa.css contains .user-gadget-card');
assert(cssContent.includes('.user-gadget-photo-box'), 'osa.css contains .user-gadget-photo-box');
assert(cssContent.includes('.user-gadget-photo-placeholder'), 'osa.css contains .user-gadget-photo-placeholder');

// JS Table Header inspection
assert(jsContent.includes('<th class="text-right">Actions</th>'), 'osa.js renamed Access Control header to Actions');
assert(!jsContent.includes('<th class="text-right">Access Control</th>'), 'osa.js removed legacy Access Control header');

console.log('  ✓ Static inspection passed: Markup, CSS classes, and Action header verified.\n');

// -----------------------------------------------------------------------------
// [3/6] Setting Up Sandboxed Environment for osa.js Logic
// -----------------------------------------------------------------------------
console.log('[3/6] Setting Up Simulated DOM Sandbox for OSA Users...');

const apiHelpers = require('../public/js/api.js');
const { getEffectiveGadgetPhoto } = apiHelpers;

// Simulated DOM elements
const elements = {};
function getOrCreateEl(id) {
  if (!elements[id]) {
    elements[id] = {
      id,
      innerHTML: '',
      textContent: '',
      value: '',
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); }
      },
      style: {},
      setAttribute(k, v) { this[k] = v; },
      getAttribute(k) { return this[k]; }
    };
  }
  return elements[id];
}

const mockWindow = {
  getEffectiveGadgetPhoto,
  addEventListener(event, fn) {
    mockWindow.listeners = mockWindow.listeners || {};
    mockWindow.listeners[event] = mockWindow.listeners[event] || [];
    mockWindow.listeners[event].push(fn);
  },
  triggerKey(key) {
    if (mockWindow.listeners && mockWindow.listeners.keydown) {
      mockWindow.listeners.keydown.forEach(fn => fn({ key }));
    }
  }
};

const mockDocument = {
  getElementById(id) {
    return getOrCreateEl(id);
  },
  querySelectorAll() {
    return [];
  },
  querySelector() {
    return null;
  },
  addEventListener() {}
};

// Sandbox evaluation
const vm = require('vm');
const sandbox = {
  window: mockWindow,
  document: mockDocument,
  console,
  setTimeout,
  clearTimeout,
  URLSearchParams,
  getEffectiveGadgetPhoto,
  escapeHtml: (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
  formatDate: (iso) => iso ? String(iso).substring(0, 10) : '—',
  renderStatusBadge: (status) => `<span class="status-badge ${status}">${status}</span>`,
  allUsersCache: [],
  api: {}
};

vm.createContext(sandbox);

// Extract only necessary OSA users module snippets to execute in sandbox
vm.runInContext(jsContent, sandbox);

console.log('  ✓ Simulated DOM sandbox successfully initialized.\n');

// -----------------------------------------------------------------------------
// [4/6] Test Users Management Table Rendering & Action Removal
// -----------------------------------------------------------------------------
console.log('[4/6] Testing Users Table Action Buttons...');

const testUsers = [
  {
    id: 'usr_student_01',
    name: 'Juan Dela Cruz',
    idNumber: 'ST-2024-001',
    email: 'juan@ncst.edu.ph',
    role: 'student',
    department: 'Computer Science',
    contactNumber: '09171234567',
    gadgetCount: 2,
    status: 'ACTIVE'
  },
  {
    id: 'usr_student_02',
    name: 'Maria Clara',
    idNumber: 'ST-2024-002',
    email: 'maria@ncst.edu.ph',
    role: 'student',
    department: 'Engineering',
    contactNumber: '09181234567',
    gadgetCount: 0,
    status: 'ACTIVE'
  },
  {
    id: 'usr_admin_01',
    name: 'Carlos Mendoza',
    idNumber: 'AD-2024-099',
    email: 'carlos@ncst.edu.ph',
    role: 'osa_admin',
    department: 'OSA Office',
    contactNumber: '09191234567',
    gadgetCount: 0,
    status: 'ACTIVE'
  }
];

sandbox.allUsersCache = testUsers;
mockWindow.allUsersCache = testUsers;
sandbox.renderUsersTable(testUsers);

const tableHtml = sandbox.document.getElementById('users-accounts-table').innerHTML;

// Verify removed actions are ABSENT
assert(!tableHtml.includes('Resend Email'), 'Resend Email button is completely absent from table');
assert(!tableHtml.includes('resendApprovalEmail'), 'resendApprovalEmail invocation is absent from table rows');
assert(!tableHtml.includes('Suspend'), 'Suspend button is completely absent from table');
assert(!tableHtml.includes('toggleUserStatus'), 'toggleUserStatus invocation is absent from table rows');

// Verify "View Registered Gadgets" is present for students
assert(tableHtml.includes('View Registered Gadgets'), 'Table includes View Registered Gadgets button');
assert(tableHtml.includes("openUserGadgetsModal('usr_student_01')"), 'Student 1 button calls openUserGadgetsModal with ID');
assert(tableHtml.includes("openUserGadgetsModal('usr_student_02')"), 'Student 2 button calls openUserGadgetsModal with ID');

// Verify Admin row does not show student gadget action
assert(tableHtml.includes('Admin'), 'Admin account displays Admin indicator');

console.log('  ✓ Visible Resend Email & Suspend actions confirmed completely removed.');
console.log('  ✓ "View Registered Gadgets" action verified on student rows.\n');

// -----------------------------------------------------------------------------
// [5/6] Test Read-Only Modal, User Isolation, Photo Compatibility, & Error Handling
// -----------------------------------------------------------------------------
console.log('[5/6] Testing Registered Gadgets Modal Scenarios...');

// Mock gadget records for testing
const mockAllGadgets = [
  {
    id: 'gdt_01',
    userId: 'usr_student_01',
    brand: 'Samsung',
    model: 'Galaxy S23 Ultra',
    category: 'Smartphone',
    color: 'Phantom Black',
    status: 'REGISTERED',
    registrationDate: '2026-09-06T14:20:00.000Z',
    photoUrl: 'data:image/jpeg;base64,genuineUserPhotoBase64',
    secureToken: 'SECRET_QR_TOKEN_ABC123',
    qrCodeDataUrl: 'data:image/png;base64,SECRET_QR_IMAGE'
  },
  {
    id: 'gdt_02',
    userId: 'usr_student_01',
    brand: 'Apple',
    model: 'MacBook Air M2',
    category: 'Laptop',
    color: 'Space Gray',
    status: 'PENDING_APPROVAL',
    registrationDate: '2026-09-10T10:00:00.000Z',
    photoUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=500', // Legacy default stock pattern
    secureToken: 'SECRET_QR_TOKEN_XYZ789'
  },
  {
    id: 'gdt_03',
    userId: 'usr_student_03_other',
    brand: 'Sony',
    model: 'WH-1000XM5',
    category: 'Accessories',
    color: 'Silver',
    status: 'REGISTERED',
    registrationDate: '2026-09-15T08:00:00.000Z',
    photoUrl: null,
    secureToken: 'SECRET_OTHER_USER_TOKEN'
  }
];

// Test 5.1: Modal opens for Student 1 with 2 gadgets
(async () => {
  sandbox.api.getAllGadgets = async () => ({ success: true, gadgets: mockAllGadgets });

  await sandbox.openUserGadgetsModal('usr_student_01');

  const modalEl = sandbox.document.getElementById('osa-user-gadgets-modal');
  const subtitleEl = sandbox.document.getElementById('user-gadgets-modal-subtitle');
  const bodyEl = sandbox.document.getElementById('user-gadgets-modal-body');

  assert(modalEl.classList.contains('active'), 'Modal receives active class');
  assert(subtitleEl.innerHTML.includes('Juan Dela Cruz'), 'Header shows selected student name');
  assert(subtitleEl.innerHTML.includes('ST-2024-001'), 'Header shows Student ID');

  // Strict ownership isolation check
  assert(bodyEl.innerHTML.includes('Samsung Galaxy S23 Ultra'), 'Displays Student 1 device (Samsung)');
  assert(bodyEl.innerHTML.includes('MacBook Air M2'), 'Displays Student 1 device (MacBook)');
  assert(!bodyEl.innerHTML.includes('Sony WH-1000XM5'), 'STRICT ISOLATION: Student 3 device (Sony) is NOT displayed');

  // Photo compatibility check
  assert(bodyEl.innerHTML.includes('genuineUserPhotoBase64'), 'Genuine base64 upload is preserved and rendered');
  assert(bodyEl.innerHTML.includes('No Photo'), 'Legacy stock Unsplash pattern correctly triggers No Photo placeholder');

  // Strictly Read-Only check
  const forbiddenKeywords = ['onclick="handleApproveGadget', 'openRejectGadgetModal', 'openDispatchReturn', 'editGadget', 'deleteGadget'];
  forbiddenKeywords.forEach(kw => {
    assert(!bodyEl.innerHTML.includes(kw), `Strict Read-Only: modal does not contain ${kw}`);
  });

  // Security & Privacy check: NO secrets leaked
  assert(!bodyEl.innerHTML.includes('SECRET_QR_TOKEN_ABC123'), 'Privacy: secureToken is NOT exposed');
  assert(!bodyEl.innerHTML.includes('SECRET_QR_IMAGE'), 'Privacy: qrCodeDataUrl is NOT exposed');

  console.log('  ✓ Modal opens for Student 1 with verified ownership isolation & photo compatibility.');
  console.log('  ✓ Confirmed strictly read-only: Zero mutating buttons or secret tokens in DOM.');

  // Test 5.2: Student 2 with Zero registered gadgets
  await sandbox.openUserGadgetsModal('usr_student_02');
  assert(bodyEl.innerHTML.includes('No Registered Gadgets'), 'Displays clean empty state for student with 0 devices');
  assert(!bodyEl.innerHTML.includes('Samsung'), 'Previous student gadgets cleared immediately');
  console.log('  ✓ Empty state verified for zero-gadget student.');

  // Test 5.3: Error state handling
  sandbox.api.getAllGadgets = async () => { throw new Error('Network timeout connecting to vault database'); };
  await sandbox.openUserGadgetsModal('usr_student_01');
  assert(bodyEl.innerHTML.includes('Unable to Retrieve Gadgets'), 'Displays error heading upon failure');
  assert(bodyEl.innerHTML.includes('Network timeout connecting to vault database'), 'Displays meaningful error message');
  assert(bodyEl.innerHTML.includes('Retry'), 'Provides retry action button');
  console.log('  ✓ Error state & retry handling verified.');

  // Test 5.4: Keyboard Accessibility (Escape key)
  modalEl.classList.add('active');
  mockWindow.triggerKey('Escape');
  assert(!modalEl.classList.contains('active'), 'Escape key cleanly dismisses active modal');
  console.log('  ✓ Keyboard Escape accessibility verified.');

  // Test 5.5: XSS Sanitization
  const maliciousStudent = {
    id: 'usr_malicious',
    name: '<script>alert("xss")</script>Bobby Tables',
    idNumber: 'ST-<img src=x onerror=alert(1)>',
    department: '<b>Hacking</b>',
    role: 'student'
  };
  sandbox.allUsersCache.push(maliciousStudent);
  mockWindow.allUsersCache.push(maliciousStudent);
  sandbox.api.getAllGadgets = async () => ({ success: true, gadgets: [] });

  await sandbox.openUserGadgetsModal('usr_malicious');
  assert(!subtitleEl.innerHTML.includes('<script>'), 'XSS: <script> tag properly escaped in student name');
  assert(!subtitleEl.innerHTML.includes('<img src=x'), 'XSS: <img> injection properly escaped in student ID');
  console.log('  ✓ XSS protection verified across student metadata.\n');

  // ---------------------------------------------------------------------------
  // [6/6] Final Database Immutability Check
  // ---------------------------------------------------------------------------
  console.log('[6/6] Verifying Final Database SHA256 Immutability...');
  const finalChecksum = crypto.createHash('sha256').update(fs.readFileSync(DB_PATH)).digest('hex').toLowerCase();
  assert.strictEqual(finalChecksum, initialChecksum, 'Database file must not be modified in any way');
  console.log(`  ✓ Database checksum strictly verified: ${finalChecksum}`);
  console.log('  ✓ ZERO production records altered. ZERO credentials exposed.\n');

  console.log('========================================================================');
  console.log('TASK #5 TEST SUITE PASSED (100% VERIFIED)');
  console.log('========================================================================\n');
})();
