/**
 * test_student_custody_and_counter_bugfixes.js
 *
 * Dedicated regression test suite for:
 * BUG 1 — Incorrect OSA Custody Notification Destination
 * BUG 2 — Incorrect Registered Gadgets Counter
 *
 * Validates:
 * 1. Registered Gadgets metric counts all approved gadgets (including MISSING and FOUND_IN_CUSTODY).
 * 2. Excludes pending (PENDING_APPROVAL, PENDING) and rejected (REJECTED) registrations.
 * 3. Count accuracy through lifecycle: REGISTERED -> MISSING -> OSA CUSTODY -> RETURNED -> MISSING AGAIN.
 * 4. Deduplication of registered gadget IDs.
 * 5. Notification action label changed to "View Gadget Status" for OSA Custody notifications.
 * 6. Custody notifications navigate to lost-status / gadget details, NOT claims or return receipt.
 * 7. Outdated notification links (e.g. /student/#claims) safely intercepted for custody notices.
 * 8. Return notifications (RETURNED_SUCCESS) remain linked to return history / receipt.
 * 9. Lost Gadget Status screen displays actual custody status and OSA pickup instructions.
 * 10. Live HTTP turnover generates notification with linkUrl: /student/#lost-status?id=...
 * 11. Zero modification to production database baseline.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const vm = require('vm');
const { fork } = require('child_process');

const ORIGINAL_DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
const INITIAL_DB_CHECKSUM = crypto.createHash('sha256').update(fs.readFileSync(ORIGINAL_DB_PATH)).digest('hex').toUpperCase();

const TEMP_DATA_DIR = path.join(__dirname, '..', 'scratch', 'test_custody_bugfixes_' + Date.now());
const TEMP_DB_PATH = path.join(TEMP_DATA_DIR, 'database.json');

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(err);
    process.exit(1);
  }
}

async function itAsync(desc, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(err);
    process.exit(1);
  }
}

(async function runTestSuite() {
console.log('GADGETGUARD: STUDENT PORTAL BUG 1 & BUG 2 REGRESSION TEST SUITE');
console.log('========================================================================\n');
console.log(`🔒 Baseline database checksum: ${INITIAL_DB_CHECKSUM}\n`);

// Load student HTML, JS and server routes
const studentHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'student', 'index.html'), 'utf8');
const studentJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'student', 'student.js'), 'utf8');
const finderRoutesJs = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'finderRoutes.js'), 'utf8');

// =========================================================================
// SIMULATED BROWSER DOM ENVIRONMENT FOR INTERACTION TESTING
// =========================================================================
function createSimulatedDomEnvironment() {
  const elements = new Map();

  class MockElement {
    constructor(id, tagName = 'div') {
      this.id = id;
      this.tagName = tagName;
      this.classList = {
        _classes: new Set(),
        add: (...cls) => cls.forEach(c => this.classList._classes.add(c)),
        remove: (...cls) => cls.forEach(c => this.classList._classes.delete(c)),
        contains: (c) => this.classList._classes.has(c)
      };
      this.style = {};
      this.textContent = '';
      this.innerHTML = '';
      this.src = '';
      this.value = '';
      this._eventListeners = new Map();
      this.onclick = null;
    }

    addEventListener(event, fn) {
      if (!this._eventListeners.has(event)) this._eventListeners.set(event, []);
      this._eventListeners.get(event).push(fn);
    }

    click() {
      if (typeof this.onclick === 'function') {
        this.onclick({ target: this, stopPropagation: () => {} });
      }
      const listeners = this._eventListeners.get('click') || [];
      listeners.forEach(fn => fn({ target: this, stopPropagation: () => {} }));
    }

    scrollIntoView() {}
  }

  const requiredIds = [
    'stat-registered-val',
    'stat-missing-val',
    'stat-claims-val',
    'stat-returned-val',
    'badge-missing-count',
    'student-osa-verify-banner',
    'pending-verify-device-name',
    'dash-gadgets-grid',
    'student-all-gadgets-grid',
    'my-active-missing-list',
    'campus-missing-board-grid',
    'gadget-details-modal',
    'gmodal-title',
    'gmodal-sn',
    'gmodal-cat',
    'gmodal-color',
    'gmodal-date',
    'gmodal-img',
    'gmodal-badge',
    'gmodal-security-section',
    'gmodal-actions',
    'gmodal-token',
    'student-sidebar',
    'screen-page-heading',
    'student-screen-lost-status',
    'student-screen-claims',
    'nav-item-lost-status',
    'nav-item-claims',
    'student-return-receipt-modal'
  ];

  requiredIds.forEach(id => {
    elements.set(id, new MockElement(id));
  });

  return {
    elements,
    addEventListener(event, fn) {},
    removeEventListener(event, fn) {},
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, new MockElement(id));
      }
      return elements.get(id);
    },
    querySelectorAll(selector) {
      const matched = [];
      for (const el of elements.values()) {
        if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) {
          matched.push(el);
        }
      }
      return matched;
    }
  };
}

function createStudentSandbox() {
  const mockDom = createSimulatedDomEnvironment();
  const context = {
    document: mockDom,
    window: {
      location: { hash: '' }
    },
    location: { hash: '' },
    console: console,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    Intl: Intl,
    Date: Date,
    Set: Set,
    Map: Map,
    Array: Array,
    Object: Object,
    String: String,
    Boolean: Boolean,
    Number: Number,
    parseInt: parseInt,
    Math: Math,
    escapeHtml: (s) => s || '',
    formatDate: (d) => String(d || ''),
    renderStatusBadge: (status) => `<span class="status-badge ${status}">${status}</span>`,
    api: {
      getMyGadgets: async () => ({ gadgets: context._mockGadgets || [] }),
      getReturns: async () => ({ returns: context._mockReturns || [] }),
      getNotifications: async () => ({ notifications: context._mockNotifs || [], unreadCount: 0 }),
      getMyScanHistory: async () => ({ scans: context._mockScans || [] }),
      getActiveMissing: async () => ({ reports: [] }),
      markNotificationRead: async () => ({ success: true })
    },
    SwalHelper: {
      fire: async () => ({ isConfirmed: true }),
      error: async () => {}
    }
  };
  context.window.document = mockDom;
  vm.createContext(context);
  vm.runInContext(studentJs, context);
  return context;
}

// -------------------------------------------------------------------------
// SECTION 1: BUG 2 — REGISTERED GADGETS COUNTER LOGIC
// -------------------------------------------------------------------------
console.log('--- SECTION 1: BUG 2 — REGISTERED GADGETS COUNTER LOGIC ---');

it('User Scenario: 1 REGISTERED, 3 MISSING -> Registered Gadgets metric MUST display 4', async () => {
  const ctx = createStudentSandbox();
  ctx._mockGadgets = [
    { id: 'g1', brand: 'Apple', model: 'MacBook Air', status: 'REGISTERED' },
    { id: 'g2', brand: 'Sony', model: 'WH-1000XM4', status: 'MISSING' },
    { id: 'g3', brand: 'Apple', model: 'iPad Air', status: 'MISSING' },
    { id: 'g4', brand: 'Dell', model: 'XPS 15', status: 'MISSING' }
  ];

  await ctx.loadMyGadgetsData();

  const regEl = ctx.document.getElementById('stat-registered-val');
  const misEl = ctx.document.getElementById('stat-missing-val');

  assert.strictEqual(regEl.textContent, 4, 'Registered Gadgets metric must count all 4 approved gadgets');
  assert.strictEqual(misEl.textContent, 3, 'Missing Gadgets metric must count 3 missing gadgets');
});

it('Lifecycle Test: Full recovery cycle (REGISTERED -> MISSING -> CUSTODY -> RETURNED -> MISSING AGAIN)', async () => {
  const ctx = createStudentSandbox();
  
  // Phase 1: 4 all safe and registered
  ctx._mockGadgets = [
    { id: 'g1', brand: 'Apple', model: 'MacBook Air', status: 'REGISTERED' },
    { id: 'g2', brand: 'Sony', model: 'WH-1000XM4', status: 'REGISTERED' },
    { id: 'g3', brand: 'Apple', model: 'iPad Air', status: 'REGISTERED' },
    { id: 'g4', brand: 'Dell', model: 'XPS 15', status: 'REGISTERED' }
  ];
  await ctx.loadMyGadgetsData();
  assert.strictEqual(ctx.document.getElementById('stat-registered-val').textContent, 4);
  assert.strictEqual(ctx.document.getElementById('stat-missing-val').textContent, 0);

  // Phase 2: g2, g3, g4 reported MISSING
  ctx._mockGadgets[1].status = 'MISSING';
  ctx._mockGadgets[2].status = 'MISSING';
  ctx._mockGadgets[3].status = 'MISSING';
  await ctx.loadMyGadgetsData();
  assert.strictEqual(ctx.document.getElementById('stat-registered-val').textContent, 4, 'Registered count remains 4 when gadgets are missing');
  assert.strictEqual(ctx.document.getElementById('stat-missing-val').textContent, 3, 'Missing count reflects 3');

  // Phase 3: g2 received into OSA Custody (FOUND_IN_CUSTODY)
  ctx._mockGadgets[1].status = 'FOUND_IN_CUSTODY';
  ctx._mockGadgets[1].custodyStatus = 'IN_OSA_CUSTODY';
  await ctx.loadMyGadgetsData();
  assert.strictEqual(ctx.document.getElementById('stat-registered-val').textContent, 4, 'Registered count remains 4 when gadget is in OSA Custody');
  assert.strictEqual(ctx.document.getElementById('stat-missing-val').textContent, 2, 'Missing count decreases to 2');

  // Phase 4: g2 officially returned to owner (status reset to REGISTERED)
  ctx._mockGadgets[1].status = 'REGISTERED';
  ctx._mockGadgets[1].custodyStatus = 'RETURNED_TO_OWNER';
  await ctx.loadMyGadgetsData();
  assert.strictEqual(ctx.document.getElementById('stat-registered-val').textContent, 4, 'Registered count remains 4 after gadget is returned');
  assert.strictEqual(ctx.document.getElementById('stat-missing-val').textContent, 2, 'Missing count remains 2');

  // Phase 5: g2 reported MISSING AGAIN in a second cycle
  ctx._mockGadgets[1].status = 'MISSING';
  ctx._mockGadgets[1].custodyStatus = null;
  await ctx.loadMyGadgetsData();
  assert.strictEqual(ctx.document.getElementById('stat-registered-val').textContent, 4, 'Registered count remains 4 when gadget is missing again');
  assert.strictEqual(ctx.document.getElementById('stat-missing-val').textContent, 3, 'Missing count updates to 3');
});

it('Exclusion Test: Pending and Rejected registrations are NOT counted as approved', async () => {
  const ctx = createStudentSandbox();
  ctx._mockGadgets = [
    { id: 'g1', brand: 'Apple', model: 'MacBook Air', status: 'REGISTERED' },
    { id: 'g2', brand: 'Sony', model: 'WH-1000XM4', status: 'MISSING' },
    { id: 'g3', brand: 'Apple', model: 'iPad Air', status: 'PENDING_APPROVAL' },
    { id: 'g4', brand: 'Dell', model: 'XPS 15', status: 'PENDING' },
    { id: 'g5', brand: 'Samsung', model: 'Galaxy Tab', status: 'REJECTED' }
  ];

  await ctx.loadMyGadgetsData();

  const regEl = ctx.document.getElementById('stat-registered-val');
  const misEl = ctx.document.getElementById('stat-missing-val');

  assert.strictEqual(regEl.textContent, 2, 'Only g1 (REGISTERED) and g2 (MISSING) must be counted as approved');
  assert.strictEqual(misEl.textContent, 1, 'Only g2 must be counted as missing');
});

it('Deduplication Test: Duplicate objects with same ID are counted exactly once', async () => {
  const ctx = createStudentSandbox();
  ctx._mockGadgets = [
    { id: 'g1', brand: 'Apple', model: 'MacBook Air', status: 'REGISTERED' },
    { id: 'g1', brand: 'Apple', model: 'MacBook Air', status: 'REGISTERED' }, // duplicate entry
    { id: 'g2', brand: 'Sony', model: 'WH-1000XM4', status: 'MISSING' },
    { id: 'g2', brand: 'Sony', model: 'WH-1000XM4', status: 'MISSING' }  // duplicate entry
  ];

  await ctx.loadMyGadgetsData();

  const regEl = ctx.document.getElementById('stat-registered-val');
  assert.strictEqual(regEl.textContent, 2, 'Deduplication guarantees exact unique gadget count');
});

// -------------------------------------------------------------------------
// SECTION 2: BUG 1 — OSA CUSTODY NOTIFICATION ACTIONS & ROUTING
// -------------------------------------------------------------------------
console.log('\n--- SECTION 2: BUG 1 — OSA CUSTODY NOTIFICATION ACTIONS & ROUTING ---');

it('Action Label: "Your Gadget is in OSA Custody!" notification renders "View Gadget Status"', () => {
  const ctx = createStudentSandbox();
  const custodyNotif = {
    id: 'notif_custody_1',
    title: 'Your Gadget is in OSA Custody! 🏢',
    message: 'Your missing gadget has been received by OSA and is now available for claim/verification.\n\nDevice: Apple MacBook Air\nCustody Location: OSA Lost & Found Locker (Room 1109)',
    type: 'GADGET_FOUND',
    linkUrl: '/student/#claims',
    gadgetId: 'g1'
  };

  const html = ctx.renderNotificationActions(custodyNotif);
  assert(html.includes('View Gadget Status'), 'Notification action must include "View Gadget Status"');
  assert(!html.includes('View Claims / Handover History'), 'Must NOT show "View Claims / Handover History"');
  assert(!html.includes("handleNotifActionClick('notif_custody_1', 'claims')"), 'Must NOT route action to claims');
});

it('Outdated Links Safe Interception: Old notification with linkUrl: "/student/#claims" navigates to lost-status', async () => {
  const ctx = createStudentSandbox();
  ctx._mockGadgets = [
    { id: 'g1', brand: 'Apple', model: 'MacBook Air', status: 'FOUND_IN_CUSTODY', custodyStatus: 'IN_OSA_CUSTODY' }
  ];
  ctx._mockNotifs = [
    {
      id: 'notif_old_1',
      title: 'Your Gadget is in OSA Custody! 🏢',
      message: 'Your missing gadget has been received by OSA.\n\nDevice: Apple MacBook Air\nCustody Location: OSA Room 1109',
      type: 'GADGET_FOUND',
      linkUrl: '/student/#claims' // Old outdated link!
    }
  ];

  await ctx.loadMyGadgetsData();

  let navigatedTo = null;
  ctx.navigateStudent = (target) => { navigatedTo = target; };
  let openedModalGadgetId = null;
  ctx.openGadgetDetailsModal = (id) => { openedModalGadgetId = id; };

  // Simulate clicking the action button on an outdated notification that had actionTarget 'claims'
  await ctx.handleNotifActionClick('notif_old_1', 'claims');

  assert(navigatedTo.includes('lost-status'), `Outdated custody notification must navigate to lost-status (got ${navigatedTo})`);
  assert(!navigatedTo.includes('claims'), 'Must NOT navigate to claims screen');
});

it('Gadget Resolution: Correctly matches target gadget from message text if gadgetId was omitted', async () => {
  const ctx = createStudentSandbox();
  ctx._mockGadgets = [
    { id: 'g1', brand: 'Apple', model: 'MacBook Air', status: 'REGISTERED' },
    { id: 'g2', brand: 'Sony', model: 'WH-1000XM4', status: 'FOUND_IN_CUSTODY', custodyStatus: 'IN_OSA_CUSTODY' }
  ];
  await ctx.loadMyGadgetsData();

  const notifWithoutId = {
    id: 'n_legacy',
    title: 'Your Gadget is in OSA Custody! 🏢',
    message: 'Turnover confirmed. Device: Sony WH-1000XM4\nCustody Location: OSA Room 1109',
    type: 'GADGET_FOUND'
  };

  const matched = ctx.findGadgetFromNotification(notifWithoutId);
  assert(matched, 'Must resolve gadget from notification message');
  assert.strictEqual(matched.id, 'g2', 'Must resolve the Sony WH-1000XM4 gadget');
});

it('Similar Names: Correctly selects iPhone 13 Pro over iPhone 13 when Pro is specified', async () => {
  const ctx = createStudentSandbox();
  ctx._mockGadgets = [
    { id: 'g_std', brand: 'Apple', model: 'iPhone 13', status: 'FOUND_IN_CUSTODY', custodyStatus: 'IN_OSA_CUSTODY' },
    { id: 'g_pro', brand: 'Apple', model: 'iPhone 13 Pro', status: 'FOUND_IN_CUSTODY', custodyStatus: 'IN_OSA_CUSTODY' }
  ];
  await ctx.loadMyGadgetsData();

  const notifPro = {
    id: 'n_pro',
    title: 'Your Gadget is in OSA Custody! 🏢',
    message: 'Turnover confirmed. Device: Apple iPhone 13 Pro\nCustody Location: OSA Room 1109',
    type: 'GADGET_FOUND'
  };

  const matched = ctx.findGadgetFromNotification(notifPro);
  assert(matched, 'Must resolve gadget');
  assert.strictEqual(matched.id, 'g_pro', 'Must resolve the iPhone 13 Pro, NOT the standard iPhone 13');
});

it('Similar Names: Correctly selects iPhone 13 when iPhone 13 is specified', async () => {
  const ctx = createStudentSandbox();
  ctx._mockGadgets = [
    { id: 'g_std', brand: 'Apple', model: 'iPhone 13', status: 'FOUND_IN_CUSTODY', custodyStatus: 'IN_OSA_CUSTODY' },
    { id: 'g_pro', brand: 'Apple', model: 'iPhone 13 Pro', status: 'FOUND_IN_CUSTODY', custodyStatus: 'IN_OSA_CUSTODY' }
  ];
  await ctx.loadMyGadgetsData();

  const notifStd = {
    id: 'n_std',
    title: 'Your Gadget is in OSA Custody! 🏢',
    message: 'Turnover confirmed. Device: Apple iPhone 13\nCustody Location: OSA Room 1109',
    type: 'GADGET_FOUND'
  };

  const matched = ctx.findGadgetFromNotification(notifStd);
  assert(matched, 'Must resolve gadget');
  assert.strictEqual(matched.id, 'g_std', 'Must resolve the iPhone 13, NOT the iPhone 13 Pro');
});

it('Ambiguity Protection: Returns null when student owns multiple similar devices and notification is ambiguous', async () => {
  const ctx = createStudentSandbox();
  ctx._mockGadgets = [
    { id: 'g1', brand: 'Apple', model: 'iPhone 13', status: 'FOUND_IN_CUSTODY', custodyStatus: 'IN_OSA_CUSTODY' },
    { id: 'g2', brand: 'Apple', model: 'iPhone 13 Pro', status: 'FOUND_IN_CUSTODY', custodyStatus: 'IN_OSA_CUSTODY' }
  ];
  await ctx.loadMyGadgetsData();

  // Non-specific legacy notice mentioning only "Apple iPhone" or no model distinction
  const ambiguousNotif = {
    id: 'n_ambig',
    title: 'Your Gadget is in OSA Custody! 🏢',
    message: 'Turnover confirmed. Device: Apple iPhone\nCustody Location: OSA Room 1109',
    type: 'GADGET_FOUND'
  };

  const matched = ctx.findGadgetFromNotification(ambiguousNotif);
  assert.strictEqual(matched, null, 'Must return null rather than guessing between multiple similar devices');
});

it('Ambiguity Protection: Returns null for duplicate identical models without unique identifiers', async () => {
  const ctx = createStudentSandbox();
  ctx._mockGadgets = [
    { id: 'g_dell1', brand: 'Dell', model: 'Inspiron 15', serialNumber: 'SN-001', status: 'FOUND_IN_CUSTODY' },
    { id: 'g_dell2', brand: 'Dell', model: 'Inspiron 15', serialNumber: 'SN-002', status: 'FOUND_IN_CUSTODY' }
  ];
  await ctx.loadMyGadgetsData();

  const identicalNotif = {
    id: 'n_ident',
    title: 'Your Gadget is in OSA Custody! 🏢',
    message: 'Turnover confirmed. Device: Dell Inspiron 15\nCustody Location: OSA Room 1109',
    type: 'GADGET_FOUND'
  };

  const matched = ctx.findGadgetFromNotification(identicalNotif);
  assert.strictEqual(matched, null, 'Must return null when multiple identical models are owned without serial or ID');
});

it('Serial Disambiguation: Resolves identical models when serial number is included in notification', async () => {
  const ctx = createStudentSandbox();
  ctx._mockGadgets = [
    { id: 'g_dell1', brand: 'Dell', model: 'Inspiron 15', serialNumber: 'SN-001', status: 'FOUND_IN_CUSTODY' },
    { id: 'g_dell2', brand: 'Dell', model: 'Inspiron 15', serialNumber: 'SN-002', status: 'FOUND_IN_CUSTODY' }
  ];
  await ctx.loadMyGadgetsData();

  const serialNotif = {
    id: 'n_sn',
    title: 'Your Gadget is in OSA Custody! 🏢',
    message: 'Turnover confirmed. Device: Dell Inspiron 15 (S/N: SN-002)\nCustody Location: OSA Room 1109',
    type: 'GADGET_FOUND'
  };

  const matched = ctx.findGadgetFromNotification(serialNotif);
  assert(matched, 'Must resolve gadget via serial number');
  assert.strictEqual(matched.id, 'g_dell2', 'Must resolve g_dell2 based on serial SN-002');
});

it('Safe Fallback UI: Ambiguous notification navigates to lost-status and shows fallback banner without opening details modal', async () => {
  const ctx = createStudentSandbox();
  ctx._mockGadgets = [
    { id: 'g_a', brand: 'Apple', model: 'iPhone 13', status: 'FOUND_IN_CUSTODY' },
    { id: 'g_b', brand: 'Apple', model: 'iPhone 14', status: 'FOUND_IN_CUSTODY' }
  ];
  await ctx.loadMyGadgetsData();

  const ambiguousNotif = {
    id: 'notif_ambig_click',
    title: 'Your Gadget is in OSA Custody! 🏢',
    message: 'Turnover confirmed. Device: Apple iPhone\nCustody Location: OSA Room 1109',
    type: 'GADGET_FOUND'
  };
  ctx._mockNotifs = [ambiguousNotif];

  let navigatedTarget = null;
  ctx.navigateStudent = (screen) => { navigatedTarget = screen; };

  let modalOpenedGadgetId = null;
  ctx.openGadgetDetailsModal = (id) => { modalOpenedGadgetId = id; };

  let fallbackBannerShown = false;
  ctx.showCustodyFallbackNotice = () => { fallbackBannerShown = true; };

  // Trigger notification action click
  await ctx.handleNotifActionClick('notif_ambig_click', 'lost-status');

  // Verify navigation was generic 'lost-status' without a specific ID query
  assert.strictEqual(navigatedTarget, 'lost-status', 'Must navigate to generic lost-status screen');
  // Verify NO gadget details modal was opened for another gadget!
  assert.strictEqual(modalOpenedGadgetId, null, 'Must NOT open another gadget details modal when ambiguous');
  // Verify safe fallback banner was triggered
  assert.strictEqual(fallbackBannerShown, true, 'Must display the safe fallback notice banner');
});

it('Preservation: "Gadget Successfully Returned!" notifications remain linked to return receipt', async () => {
  const ctx = createStudentSandbox();
  const returnNotif = {
    id: 'notif_ret_1',
    title: 'Gadget Successfully Returned! 🎉',
    message: 'Your Apple MacBook Air has been officially returned and recorded.',
    type: 'RETURNED_SUCCESS',
    returnId: 'ret_cycle1_ref',
    linkUrl: '/student/#returns?id=ret_cycle1_ref'
  };
  ctx._mockNotifs = [returnNotif];

  const html = ctx.renderNotificationActions(returnNotif);
  assert(html.includes('View Return Receipt'), 'Return notification must display "View Return Receipt"');

  let navigatedTo = null;
  ctx.navigateStudent = (target) => { navigatedTo = target; };
  let receiptOpenedId = null;
  ctx.openStudentReturnReceiptForNotif = async (n, retId) => { receiptOpenedId = retId; };

  await ctx.handleNotifActionClick('notif_ret_1', 'return-receipt');
  assert.strictEqual(navigatedTo, 'claims', 'Return notification navigates to claims / Return History');
  assert.strictEqual(receiptOpenedId, 'ret_cycle1_ref', 'Opens verified return receipt for ret_cycle1_ref');
});

// -------------------------------------------------------------------------
// SECTION 3: LOST GADGET STATUS & MODAL CUSTODY DISPLAY
// -------------------------------------------------------------------------
console.log('\n--- SECTION 3: LOST GADGET STATUS & MODAL CUSTODY DISPLAY ---');

it('Lost Gadget Status Screen: Displays custody card with actual status & OSA pickup instructions', async () => {
  const ctx = createStudentSandbox();
  ctx._mockGadgets = [
    {
      id: 'g_custody_1',
      brand: 'Dell',
      model: 'XPS 15',
      serialNumber: 'SN-DELL-9901',
      category: 'Laptop',
      status: 'FOUND_IN_CUSTODY',
      custodyStatus: 'IN_OSA_CUSTODY',
      custodyLocation: 'Office of Student Affairs (OSA Room 1109) - Vault',
      receivedAtOsaDate: '2026-10-12T10:30:00.000Z',
      receivedByOsaStaffName: 'OSA Officer Santos'
    }
  ];
  await ctx.loadMyGadgetsData();

  await ctx.loadLostStatusScreen();

  const listEl = ctx.document.getElementById('my-active-missing-list');
  const cardHtml = listEl.innerHTML;

  assert(cardHtml.includes('lost-gadget-g_custody_1'), 'Card must have ID lost-gadget-g_custody_1');
  assert(cardHtml.includes('In OSA Custody'), 'Card must display "In OSA Custody"');
  assert(cardHtml.includes('OSA Room 1109'), 'Card must display custody location Room 1109');
  assert(cardHtml.includes('Student ID card'), 'Card must specify physical Student ID card requirement');
  assert(cardHtml.includes('NOT been returned yet') || cardHtml.includes('not yet returned'), 'Card must explicitly state gadget is not yet returned');
  assert(!cardHtml.includes('Cancel Alert'), 'Card must NOT show Cancel Alert button while in custody');
  assert(cardHtml.includes('View Details & Pickup Info'), 'Card must provide View Details & Pickup Info button');
});

it('Gadget Details Modal: Displays comprehensive OSA custody details and pickup instructions', async () => {
  const ctx = createStudentSandbox();
  ctx._mockGadgets = [
    {
      id: 'g_custody_2',
      brand: 'Apple',
      model: 'iPad Pro',
      serialNumber: 'SN-IPAD-7744',
      category: 'Tablet',
      status: 'FOUND_IN_CUSTODY',
      custodyStatus: 'IN_OSA_CUSTODY',
      custodyLocation: 'OSA Lost & Found Locker (Room 1109)',
      receivedAtOsaDate: '2026-10-12T09:15:00.000Z',
      receivedByOsaStaffName: 'OSA Director Navarro'
    }
  ];
  await ctx.loadMyGadgetsData();

  ctx.openGadgetDetailsModal('g_custody_2');

  const actionsEl = ctx.document.getElementById('gmodal-actions');
  const text = actionsEl.innerHTML;

  assert(text.includes('Device Secured in OSA Custody') || text.includes('IN OSA CUSTODY'), 'Modal must announce OSA Custody');
  assert(text.includes('Room 1109'), 'Modal must instruct owner to visit Room 1109');
  assert(text.includes('Student ID card'), 'Modal must instruct bringing physical Student ID card');
  assert(text.includes('NOT yet returned') || text.includes('not yet returned'), 'Modal must declare gadget is not yet returned');
});

// -------------------------------------------------------------------------
// SECTION 4: SERVER TURNOVER NOTIFICATION LINK VERIFICATION
// -------------------------------------------------------------------------
console.log('\n--- SECTION 4: SERVER TURNOVER NOTIFICATION LINK VERIFICATION ---');

it('finderRoutes.js: Verification of intake notification link and gadgetId payload', () => {
  assert(
    finderRoutesJs.includes("linkUrl: `/student/#lost-status?id=${gadget.id}`"),
    'finderRoutes.js must set linkUrl to /student/#lost-status?id=${gadget.id}'
  );
  assert(
    finderRoutesJs.includes("gadgetId: gadget.id"),
    'finderRoutes.js must include gadgetId: gadget.id in turnover notification'
  );
  assert(
    !finderRoutesJs.includes("linkUrl: '/student/#claims'"),
    'finderRoutes.js must no longer set custody linkUrl to /student/#claims'
  );
});

// -------------------------------------------------------------------------
// SECTION 5: LIVE HTTP WORKFLOW INTEGRATION (ISOLATED DATABASE)
// -------------------------------------------------------------------------
console.log('\n--- SECTION 5: LIVE HTTP WORKFLOW INTEGRATION (ISOLATED DATABASE) ---');

const TEST_PORT = 3994;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpRequest(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const postData = options.body ? JSON.stringify(options.body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: urlPath,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        ...(options.headers || {})
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

await itAsync('Live Server: Intake custody turnover generates correct notification link & updates status', async () => {
  // Create isolated temporary data directory
  if (fs.existsSync(TEMP_DATA_DIR)) {
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });

  // Copy current database to temp directory
  fs.copyFileSync(ORIGINAL_DB_PATH, TEMP_DB_PATH);

  console.log(`Starting isolated test server on port ${TEST_PORT}...`);
  const serverProcess = fork(path.join(__dirname, '..', 'server', 'server.js'), [], {
    env: {
      ...process.env,
      PORT: TEST_PORT.toString(),
      DATA_DIR: TEMP_DATA_DIR,
      DATABASE_URL: '',
      POSTGRES_URL: '',
      NODE_ENV: 'test'
    },
    silent: true
  });

  await sleep(1800);

  const dbContent = JSON.parse(fs.readFileSync(ORIGINAL_DB_PATH, 'utf8'));
  const studentUser = dbContent.users.find(u => u.role === 'student');
  const osaUser = dbContent.users.find(u => u.role === 'osa_admin');

  try {
    // 1. Login as OSA Admin
    const osaLogin = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: osaUser.email, password: 'password123' }
    });
    assert.strictEqual(osaLogin.statusCode, 200, 'OSA login succeeded');
    const osaToken = osaLogin.data.token;

    // 2. Login as Student
    const studentLogin = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: studentUser.email, password: 'password123' }
    });
    assert.strictEqual(studentLogin.statusCode, 200, 'Student login succeeded');
    const studentToken = studentLogin.data.token;

    // 3. Student fetches gadgets
    const gadgetsRes = await httpRequest('/api/gadgets/my', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(gadgetsRes.statusCode, 200);
    const testGadget = gadgetsRes.data.gadgets.find(g => g.status === 'REGISTERED') || gadgetsRes.data.gadgets[0];
    assert(testGadget, 'Test gadget located');

    // 4. Report gadget as missing
    const reportRes = await httpRequest('/api/missing/report', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${studentToken}` },
      body: {
        gadgetId: testGadget.id,
        lastSeenLocation: 'Main Library 2nd Floor',
        contactNumber: '09171234567',
        details: 'Left on study desk'
      }
    });
    assert(reportRes.statusCode === 200 || reportRes.statusCode === 201, 'Reported gadget missing');

    // 5. Submit surrender report as finder
    const surrenderRes = await httpRequest('/api/finder/report', {
      method: 'POST',
      body: {
        gadgetToken: testGadget.secureToken,
        finderName: 'Good Samaritan Dan',
        foundLocation: 'Library Study Area',
        turnInMethod: 'OSA',
        message: 'Surrendering to OSA counter'
      }
    });
    assert(surrenderRes.statusCode === 200 || surrenderRes.statusCode === 201, 'Finder submitted surrender report');

    // 6. OSA confirms physical intake into custody
    const intakeRes = await httpRequest(`/api/finder/${testGadget.id}/receive`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${osaToken}` },
      body: {
        custodyLocation: 'Office of Student Affairs (Room 1109) - Safe Locker',
        notes: 'Turned in by Good Samaritan Dan'
      }
    });
    assert.strictEqual(intakeRes.statusCode, 200, 'OSA confirmed intake');
    assert.strictEqual(intakeRes.data.gadget?.status, 'FOUND_IN_CUSTODY', 'Gadget status transitioned to FOUND_IN_CUSTODY');
    assert.strictEqual(intakeRes.data.gadget?.custodyStatus, 'IN_OSA_CUSTODY', 'Custody status is IN_OSA_CUSTODY');

    // 7. Student checks notifications
    const notifsRes = await httpRequest('/api/notifications', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert.strictEqual(notifsRes.statusCode, 200);
    const custodyNotif = notifsRes.data.notifications.find(n => n.title.includes('Custody'));
    assert(custodyNotif, 'Owner received custody notification');
    assert.strictEqual(custodyNotif.linkUrl, `/student/#lost-status?id=${testGadget.id}`, 'Custody notification linkUrl points to lost-status with gadget id');
    assert.strictEqual(custodyNotif.gadgetId, testGadget.id, 'Custody notification carries exact gadgetId');

    // 8. Re-fetch student gadgets and verify dashboard counter calculation
    const updatedGadgetsRes = await httpRequest('/api/gadgets/my', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    const updatedGadgets = updatedGadgetsRes.data.gadgets;

    // Simulate metric calculation logic
    const approvedIds = new Set();
    updatedGadgets.forEach(g => {
      if (g && g.id && g.status !== 'PENDING_APPROVAL' && g.status !== 'PENDING' && g.status !== 'REJECTED') {
        approvedIds.add(g.id);
      }
    });
    assert(approvedIds.has(testGadget.id), 'In-custody gadget is included in approved registered gadgets');
    assert.strictEqual(approvedIds.size, updatedGadgets.length, 'All student approved gadgets are counted');

  } finally {
    serverProcess.kill();
    await sleep(400);
    if (fs.existsSync(TEMP_DATA_DIR)) {
      try {
        fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
      } catch (e) {}
    }
  }
});

// -------------------------------------------------------------------------
// SECTION 6: ZERO MODIFICATION DATABASE CHECKSUM GUARANTEE
// -------------------------------------------------------------------------
console.log('\n--- SECTION 6: DATABASE INTEGRITY AUDIT ---');

it('Final Check: Database checksum strictly matches baseline (No unapproved production changes)', () => {
  const currentChecksum = crypto.createHash('sha256').update(fs.readFileSync(ORIGINAL_DB_PATH)).digest('hex').toUpperCase();
  assert.strictEqual(
    currentChecksum,
    INITIAL_DB_CHECKSUM,
    `Database file was mutated! Expected ${INITIAL_DB_CHECKSUM}, got ${currentChecksum}`
  );
});

console.log('\n========================================================================');
console.log(`TEST RESULTS: ${passedTests} PASSED / ${totalTests - passedTests} FAILED (TOTAL: ${totalTests})`);
console.log('========================================================================\n');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
})();
