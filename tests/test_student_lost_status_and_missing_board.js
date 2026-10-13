/**
 * NCST GadgetGuard — Task #4 Test Suite
 * Student Lost Gadget Status & Campus-Wide Missing Board UI Redesign
 * 
 * Verifies:
 * 1. Active Missing gadget cards: white card with red accent, preserved actions, scan alerts.
 * 2. In OSA Custody cards: compact and collapsed by default, green accent, accessible toggle,
 *    full pickup details preserved in DOM, auto-expand on targeted notification deep-link.
 * 3. Student Campus-Wide Missing Board: strictly view-only, "Found This? Surrender to OSA" action removed,
 *    public informational notice present, device photos/placeholders intact, safe HTML escaping.
 * 4. Public Finder QR page and surrender workflow strictly intact.
 * 5. Production database checksum invariant.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

console.log('========================================================================');
console.log('   GADGETGUARD — TASK #4: LOST STATUS & CAMPUS BOARD TEST SUITE        ');
console.log('========================================================================\n');

// 1. Database Checksum Verification
const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
const INITIAL_CHECKSUM = crypto.createHash('sha256').update(fs.readFileSync(DB_PATH)).digest('hex').toLowerCase();
const EXPECTED_CHECKSUM = '4505f70dd6fc6e3770c37564946868d199a9cc1b98ccb18b27f51f00a996f8e6';

console.log('[1/6] Verifying Baseline Database Checksum...');
assert.strictEqual(INITIAL_CHECKSUM, EXPECTED_CHECKSUM, 'Production database must remain 100% untouched');
console.log('  ✓ Baseline database checksum verified intact.\n');

// 2. Source Files Inspection
console.log('[2/6] Inspecting Source Code Files...');
const studentJsPath = path.join(__dirname, '..', 'public', 'student', 'student.js');
const studentCssPath = path.join(__dirname, '..', 'public', 'student', 'student.css');
const finderHtmlPath = path.join(__dirname, '..', 'public', 'device', 'index.html');

const studentJsCode = fs.readFileSync(studentJsPath, 'utf8');
const studentCssCode = fs.readFileSync(studentCssPath, 'utf8');
const finderHtmlCode = fs.readFileSync(finderHtmlPath, 'utf8');

// Verify student.css styles
assert(studentCssCode.includes('.lost-gadget-card.missing'), 'student.css defines .lost-gadget-card.missing');
assert(studentCssCode.includes('border-left: 4px solid #ef4444'), 'student.css missing cards use red left accent');
assert(studentCssCode.includes('.lost-gadget-card.in-custody'), 'student.css defines .lost-gadget-card.in-custody');
assert(studentCssCode.includes('border-left: 4px solid #16a34a'), 'student.css custody cards use green left accent');
assert(studentCssCode.includes('.custody-collapsible-content'), 'student.css defines .custody-collapsible-content');
assert(studentCssCode.includes('.campus-missing-card'), 'student.css defines .campus-missing-card');
console.log('  ✓ student.css contains all required Task #4 classes and responsive styles.');

// Verify Public Finder QR page was NOT modified
assert(finderHtmlCode.includes('Surrender to OSA'), 'Public Finder QR page retains Surrender to OSA buttons');
assert(finderHtmlCode.includes('Confirm Surrender to OSA'), 'Public Finder QR page retains Confirm Surrender modal');
console.log('  ✓ Public Finder QR surrender workflow is 100% intact.\n');

// 3. Simulated DOM Sandbox for student.js
console.log('[3/6] Setting Up Simulated Browser Environment for student.js...');

function createStudentEnvironment() {
  const elements = new Map();

  class MockElement {
    constructor(id, tagName = 'div') {
      this.id = id;
      this.tagName = tagName.toUpperCase();
      this.classList = {
        _set: new Set(),
        add: (...cls) => cls.forEach(c => this.classList._set.add(c)),
        remove: (...cls) => cls.forEach(c => this.classList._set.delete(c)),
        contains: (c) => this.classList._set.has(c)
      };
      this.style = {};
      this.textContent = '';
      this.innerHTML = '';
      this._attrs = new Map();
      this._listeners = new Map();
      this.onclick = null;
    }

    setAttribute(name, val) { this._attrs.set(name, String(val)); }
    getAttribute(name) { return this._attrs.get(name) || null; }
    removeAttribute(name) { this._attrs.delete(name); }

    querySelector(selector) {
      if (selector === '.toggle-text') {
        if (!this._toggleText) this._toggleText = { textContent: 'Pickup Instructions' };
        return this._toggleText;
      }
      if (selector === '.custody-chevron') {
        if (!this._chevron) this._chevron = { textContent: '▼' };
        return this._chevron;
      }
      return null;
    }

    querySelectorAll(selector) { return []; }
    scrollIntoView() {}
    addEventListener(evt, fn) {
      if (!this._listeners.has(evt)) this._listeners.set(evt, []);
      this._listeners.get(evt).push(fn);
    }
  }

  const mockDoc = {
    elements,
    getElementById: (id) => {
      if (!elements.has(id)) {
        elements.set(id, new MockElement(id));
      }
      return elements.get(id);
    },
    querySelectorAll: (sel) => [],
    createElement: (tag) => new MockElement('', tag),
    addEventListener: (evt, fn) => {}
  };

  const mockApi = {
    getMyGadgets: async () => ({ gadgets: mockApi._gadgets || [] }),
    getMyScanHistory: async () => ({ scans: mockApi._scans || [] }),
    getActiveMissing: async () => ({ reports: mockApi._reports || [] }),
    _gadgets: [],
    _scans: [],
    _reports: []
  };

  const sandbox = {
    window: {},
    document: mockDoc,
    api: mockApi,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Swal: { fire: async () => ({ isConfirmed: true }) },
    SwalHelper: { error: async () => {}, warning: async () => {}, confirm: async () => true },
    escapeHtml: (str) => {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    },
    renderStatusBadge: (status) => `<span class="status-badge ${status}">${status}</span>`,
    getEffectiveGadgetPhoto: (url) => url,
    formatDate: (iso) => new Date(iso).toLocaleDateString(),
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    setInterval: () => {},
    clearInterval: () => {}
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(studentJsCode, sandbox);

  return { sandbox, elements, mockApi };
}

console.log('  ✓ Simulated sandbox successfully initialized.\n');

// 4. Test In OSA Custody Cards & Collapse / Expand Controls
console.log('[4/6] Testing In-Custody Compact Cards & Collapsible Controls...');

async function testCustodyCards() {
  const env = createStudentEnvironment();
  const custodyGadget = {
    id: 'g_custody_101',
    brand: 'Apple',
    model: 'MacBook Pro 16',
    serialNumber: 'SN-MBP-9988',
    category: 'Laptop',
    status: 'FOUND_IN_CUSTODY',
    custodyStatus: 'IN_OSA_CUSTODY',
    custodyLocation: 'Office of Student Affairs (OSA Room 1109) - Safe Locker',
    receivedAtOsaDate: '2026-10-12T14:30:00.000Z',
    receivedByOsaStaffName: 'Director Navarro'
  };

  env.mockApi._gadgets = [custodyGadget];
  await env.sandbox.loadMyGadgetsData();
  await env.sandbox.loadLostStatusScreen();

  const activeContainer = env.elements.get('my-active-missing-list');
  const html = activeContainer.innerHTML;

  // 1. Basic Structure & Badges
  assert(html.includes('id="lost-gadget-g_custody_101"'), 'Card contains id="lost-gadget-g_custody_101"');
  assert(html.includes('class="lost-gadget-card in-custody"'), 'Card has class lost-gadget-card in-custody');
  assert(html.includes('Apple MacBook Pro 16'), 'Card displays gadget brand and model');
  assert(html.includes('In OSA Custody (Ready for Physical Claim)'), 'Card displays ready for physical claim badge');
  assert(html.includes('View Details & Pickup Info'), 'Card provides View Details & Pickup Info button');

  // 2. Accessibility & Collapsible Button
  assert(html.includes('id="btn-toggle-custody-g_custody_101"'), 'Contains toggle button with unique ID');
  assert(html.includes('aria-expanded="false"'), 'Toggle button has aria-expanded="false" by default');
  assert(html.includes('aria-controls="custody-details-g_custody_101"'), 'Toggle button controls custody-details container');
  assert(html.includes('Pickup Instructions'), 'Toggle button initially displays "Pickup Instructions"');

  // 3. Collapsible Region starts collapsed
  assert(html.includes('id="custody-details-g_custody_101"'), 'Contains collapsible details container');
  assert(html.includes('style="display: none;"'), 'Collapsible details container starts with style="display: none;"');

  // 4. Verify all required pickup details are present in DOM
  assert(html.includes('OSA Room 1109'), 'Contains custody location Room 1109');
  assert(html.includes('Director Navarro'), 'Contains receiving staff name');
  assert(html.includes('Student ID card'), 'Specifies physical Student ID card requirement');
  assert(html.includes('NOT been returned yet'), 'Contains explicit notice that device has not yet been returned');
  assert(!html.includes('Cancel Alert'), 'Card does NOT show Cancel Alert button while in custody');

  // 5. Test toggleCustodyCardDetails(gadgetId) expanding
  const detailsEl = env.sandbox.document.getElementById('custody-details-g_custody_101');
  const btnEl = env.sandbox.document.getElementById('btn-toggle-custody-g_custody_101');
  detailsEl.style.display = 'none';

  env.sandbox.toggleCustodyCardDetails('g_custody_101');
  assert.strictEqual(detailsEl.style.display, 'block', 'Calling toggle expands details to display: block');
  assert.strictEqual(btnEl.getAttribute('aria-expanded'), 'true', 'aria-expanded updated to true');

  // 6. Test toggleCustodyCardDetails(gadgetId) collapsing
  env.sandbox.toggleCustodyCardDetails('g_custody_101');
  assert.strictEqual(detailsEl.style.display, 'none', 'Calling toggle again collapses details to display: none');
  assert.strictEqual(btnEl.getAttribute('aria-expanded'), 'false', 'aria-expanded updated to false');

  // 7. Test deep-link auto-expansion
  detailsEl.style.display = 'none';
  await env.sandbox.loadLostStatusScreen('g_custody_101');
  assert.strictEqual(detailsEl.style.display, 'block', 'Deep linking via openGadgetIdOnLoad auto-expands custody card');
  assert.strictEqual(btnEl.getAttribute('aria-expanded'), 'true', 'aria-expanded is true after deep link expansion');

  console.log('  ✓ In-Custody cards are compact by default with accessible toggle and full details preserved in DOM.');
  console.log('  ✓ Deep link auto-expansion verified.');
}

// 5. Test Active Missing Cards & Scan Alerts
console.log('\n[5/6] Testing Active Missing Cards & Campus Missing Board...');

async function testMissingCardsAndCampusBoard() {
  const env = createStudentEnvironment();
  const missingGadget = {
    id: 'g_missing_202',
    brand: 'Samsung',
    model: 'Galaxy S23 Ultra',
    serialNumber: 'SN-SAM-5544',
    category: 'Smartphone',
    status: 'MISSING',
    missingReport: {
      id: 'rep_missing_99',
      lastSeenLocation: 'University Library 2nd Floor'
    }
  };

  env.mockApi._gadgets = [missingGadget];
  await env.sandbox.loadMyGadgetsData();
  env.mockApi._scans = [
    {
      gadgetId: 'g_missing_202',
      scanLocationNote: 'NCST Main Gate Perimeter',
      locationSource: 'GPS',
      deviceInfo: 'Chrome on Android',
      scannedAt: '2026-10-12T15:45:00.000Z'
    },
    {
      gadgetId: 'g_missing_202',
      scanLocationNote: 'Dasmariñas Cavite',
      locationSource: 'IP',
      deviceInfo: 'Safari on iPhone',
      scannedAt: '2026-10-12T16:00:00.000Z'
    }
  ];

  env.mockApi._reports = [
    {
      id: 'rep_campus_1',
      lastSeenLocation: 'Gymnasium Bleachers',
      details: 'Left black backpack with laptop on bleachers after basketball practice.',
      reportedAt: '2026-10-12T16:30:00.000Z',
      gadget: {
        id: 'g_other_303',
        brand: 'Lenovo',
        model: 'Legion 5',
        category: 'Laptop',
        photoUrl: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=600',
        secureToken: 'SECURE_TOKEN_ST_12345'
      }
    },
    {
      id: 'rep_campus_2',
      lastSeenLocation: 'Engineering Lab 304',
      details: '<script>alert("xss")</script>Scientific calculator with name sticker.',
      reportedAt: '2026-10-12T17:00:00.000Z',
      gadget: {
        id: 'g_other_304',
        brand: 'Casio',
        model: 'fx-991EX',
        category: 'Calculator',
        photoUrl: '', // No photo uploaded
        secureToken: 'SECURE_TOKEN_ST_67890'
      }
    }
  ];

  await env.sandbox.loadLostStatusScreen();

  // Test Active Missing Card
  const activeContainer = env.elements.get('my-active-missing-list');
  const missingHtml = activeContainer.innerHTML;

  assert(missingHtml.includes('id="lost-gadget-g_missing_202"'), 'Missing card contains id="lost-gadget-g_missing_202"');
  assert(missingHtml.includes('class="lost-gadget-card missing"'), 'Missing card has class lost-gadget-card missing');
  assert(missingHtml.includes('Samsung Galaxy S23 Ultra'), 'Displays missing gadget name');
  assert(missingHtml.includes('University Library 2nd Floor'), 'Displays last seen location');
  assert(missingHtml.includes('Public Missing Alert: Active'), 'Displays missing active status indicator');
  assert(missingHtml.includes('View Details'), 'Preserves View Details button');
  assert(missingHtml.includes('✅ I Found My Device (Cancel Alert)'), 'Preserves I Found My Device button');

  // Verify scan alerts feed
  assert(missingHtml.includes('Recent QR Scan Alerts (2)'), 'Displays scan alert count header');
  assert(missingHtml.includes('NCST Main Gate Perimeter'), 'Displays GPS scan location');
  assert(missingHtml.includes('>GPS<'), 'Displays GPS badge');
  assert(missingHtml.includes('Dasmariñas Cavite'), 'Displays IP estimated location');
  assert(missingHtml.includes('>Estimated Area<'), 'Displays Estimated Area badge');

  // Test Campus-Wide Missing Board
  const boardContainer = env.elements.get('campus-missing-board-grid');
  const boardHtml = boardContainer.innerHTML;

  // 1. Strict Removal of Surrender Button from Student Board
  assert(!boardHtml.includes('Found This? Surrender to OSA'), 'Strictly excludes "Found This? Surrender to OSA" button');
  assert(!boardHtml.includes('SECURE_TOKEN_ST_12345'), 'Strictly excludes device secureToken link');
  assert(!boardHtml.includes('btn-warning'), 'No surrender action button on student board');

  // 2. View-only card structure & public notice
  assert(boardHtml.includes('campus-missing-card'), 'Card uses campus-missing-card class');
  assert(boardHtml.includes('Lenovo Legion 5'), 'Displays Lenovo device');
  assert(boardHtml.includes('Gymnasium Bleachers'), 'Displays last seen location');
  assert(boardHtml.includes('If you spot this device, please scan its physical QR sticker or turn it over to OSA Room 1109'), 'Contains student informational guidance notice');

  // 3. Device Photo vs No Photo Uploaded Placeholder
  assert(boardHtml.includes('https://images.unsplash.com/photo-1588872657578-7efd1f1555ed'), 'Genuine uploaded photo renders cleanly');
  assert(boardHtml.includes('No Photo Uploaded'), 'Neutral No Photo Uploaded placeholder renders for photo-less device');
  assert(boardHtml.includes('Calculator'), 'Placeholder shows device category');

  // 4. Safe HTML Escaping (XSS protection)
  assert(!boardHtml.includes('<script>alert("xss")</script>'), 'Dangerous script tag is escaped');
  assert(boardHtml.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'), 'XSS payload safely escaped in HTML output');

  console.log('  ✓ Active Missing cards render with red accent, preserved actions, and rich scan alerts.');
  console.log('  ✓ Student Campus Board is view-only with Surrender button removed and public notices intact.');
  console.log('  ✓ Photos, placeholders, and HTML escaping verified.');
}

// 6. Run Tests & Final Checksum
(async function runAll() {
  await testCustodyCards();
  await testMissingCardsAndCampusBoard();

  console.log('\n[6/6] Verifying Final Database Integrity...');
  const finalChecksum = crypto.createHash('sha256').update(fs.readFileSync(DB_PATH)).digest('hex').toLowerCase();
  assert.strictEqual(finalChecksum, EXPECTED_CHECKSUM, 'Production database must remain 100% untouched');
  console.log('  ✓ Final database checksum verified (4505f70dd6fc6e3770c37564946868d199a9cc1b98ccb18b27f51f00a996f8e6).');

  console.log('\n========================================================================');
  console.log('TASK #4 TEST SUITE PASSED (100% VERIFIED)');
  console.log('========================================================================\n');
})().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
