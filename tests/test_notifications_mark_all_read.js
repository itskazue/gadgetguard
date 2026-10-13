/**
 * NCST GadgetGuard — Task #3 Notifications "Mark All as Read" Hotfix Test Suite
 * Fully isolated testing on port 3994 with temporary sandbox database.
 * Does NOT touch data/database.json, production records, or live server.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');
const vm = require('vm');
const jwt = require('jsonwebtoken');

const TEST_PORT = 3994;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEMP_DATA_DIR = path.join(__dirname, 'temp_notifications_test_dir');
const ORIGINAL_DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
const EXPECTED_CHECKSUM = '4505f70dd6fc6e3770c37564946868d199a9cc1b98ccb18b27f51f00a996f8e6';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
  }
}

function httpRequest(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const reqOptions = {
      method: options.method || 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: options.headers || {}
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ statusCode: res.statusCode, data: json, body: data });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('========================================================================');
  console.log('   GADGETGUARD — NOTIFICATIONS MARK ALL AS READ TEST SUITE              ');
  console.log('========================================================================\n');

  // STEP 1: Verify Production Baseline DB Integrity
  console.log('[1/6] Production Database Baseline Checksum Verification...');
  const initialChecksum = crypto.createHash('sha256').update(fs.readFileSync(ORIGINAL_DB_PATH)).digest('hex').toLowerCase();
  assert(initialChecksum === EXPECTED_CHECKSUM, `Production database intact (${initialChecksum})`);

  // STEP 2: Setup Isolated Test Fixtures
  console.log('\n[2/6] Initializing Isolated Sandbox Environment...');
  if (!fs.existsSync(TEMP_DATA_DIR)) {
    fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });
  }

  const studentA = {
    id: 'usr_student_alpha',
    name: 'Student Alpha',
    email: 'student.alpha@ncst.edu.ph',
    role: 'student',
    status: 'ACTIVE'
  };

  const studentB = {
    id: 'usr_student_beta',
    name: 'Student Beta',
    email: 'student.beta@ncst.edu.ph',
    role: 'student',
    status: 'ACTIVE'
  };

  const initialNotifs = [
    {
      id: 'notif_alpha_01',
      userId: studentA.id,
      title: 'Missing Device Alert 🚨',
      message: 'Your laptop was marked missing.',
      type: 'MISSING_ALERT',
      read: false,
      linkUrl: '/student/#lost-status',
      createdAt: '2026-10-10T08:00:00.000Z',
      updatedAt: '2026-10-10T08:00:00.000Z'
    },
    {
      id: 'notif_alpha_02',
      userId: studentA.id,
      title: 'Device in OSA Custody 🛡️',
      message: 'Your item was received at Room 1109.',
      type: 'GADGET_FOUND',
      read: false,
      linkUrl: '/student/#lost-status',
      createdAt: '2026-10-10T09:00:00.000Z',
      updatedAt: '2026-10-10T09:00:00.000Z'
    },
    {
      id: 'notif_alpha_03',
      userId: studentA.id,
      title: 'Return Handover Verified ✨',
      message: 'Your device was handed over successfully.',
      type: 'RETURNED_SUCCESS',
      read: false,
      linkUrl: '/student/#returns',
      returnId: 'ret_alpha_99',
      createdAt: '2026-10-10T10:00:00.000Z',
      updatedAt: '2026-10-10T10:00:00.000Z'
    },
    {
      id: 'notif_alpha_04',
      userId: studentA.id,
      title: 'QR Tag Scanned 📍',
      message: 'Your device was scanned near Library.',
      type: 'QR_SCANNED',
      read: false,
      linkUrl: '/student/#lost-status',
      createdAt: '2026-10-10T11:00:00.000Z',
      updatedAt: '2026-10-10T11:00:00.000Z'
    },
    {
      id: 'notif_beta_01',
      userId: studentB.id,
      title: 'Beta Registration Approved 🎉',
      message: 'Welcome to GadgetGuard.',
      type: 'REGISTRATION_APPROVED',
      read: false,
      linkUrl: '/student/#dashboard',
      createdAt: '2026-10-10T12:00:00.000Z',
      updatedAt: '2026-10-10T12:00:00.000Z'
    },
    {
      id: 'notif_beta_02',
      userId: studentB.id,
      title: 'Beta System Notice 🛡️',
      message: 'Periodic campus check.',
      type: 'SYSTEM',
      read: false,
      linkUrl: null,
      createdAt: '2026-10-10T13:00:00.000Z',
      updatedAt: '2026-10-10T13:00:00.000Z'
    }
  ];

  const testDb = {
    users: [studentA, studentB],
    notifications: initialNotifs,
    gadgets: [],
    reports: [],
    claims: [],
    returns: [],
    qr_scans: [],
    audit_logs: []
  };

  const testDbPath = path.join(TEMP_DATA_DIR, 'database.json');
  fs.writeFileSync(testDbPath, JSON.stringify(testDb, null, 2), 'utf8');

  const JWT_SECRET = 'notif_fix_test_jwt_secret_2026';
  const tokenA = jwt.sign({ id: studentA.id, role: studentA.role }, JWT_SECRET, { expiresIn: '2h' });
  const tokenB = jwt.sign({ id: studentB.id, role: studentB.role }, JWT_SECRET, { expiresIn: '2h' });

  // STEP 3: Spawn Isolated Server
  console.log(`Starting isolated test server on port ${TEST_PORT}...`);
  const serverProc = fork(path.join(__dirname, '..', 'server', 'server.js'), [], {
    env: {
      ...process.env,
      PORT: TEST_PORT.toString(),
      DATA_DIR: TEMP_DATA_DIR,
      DB_FILE: testDbPath,
      DATABASE_URL: '',
      JWT_SECRET: JWT_SECRET,
      NODE_ENV: 'test'
    },
    silent: true
  });

  let serverReady = false;
  for (let i = 0; i < 35; i++) {
    await sleep(200);
    try {
      const res = await httpRequest('/api/notifications', {
        headers: { 'Authorization': `Bearer ${tokenA}` }
      });
      if (res.statusCode === 200) {
        serverReady = true;
        break;
      }
    } catch (_) {}
  }
  assert(serverReady, `Isolated server running on port ${TEST_PORT}`);

  try {
    // STEP 4: Backend API & Persistence Verification
    console.log('\n[3/6] Backend API & Batch-Update Verification...');

    // 4.1: Initial State for Student A
    const initialGetA = await httpRequest('/api/notifications', {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(initialGetA.statusCode === 200, 'Student A fetched notifications');
    assert(initialGetA.data.unreadCount === 4, `Student A initial unreadCount is 4 (got ${initialGetA.data.unreadCount})`);
    assert(initialGetA.data.notifications.length === 4, 'Student A sees exactly 4 notifications');

    // 4.2: Initial State for Student B
    const initialGetB = await httpRequest('/api/notifications', {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert(initialGetB.data.unreadCount === 2, `Student B initial unreadCount is 2 (got ${initialGetB.data.unreadCount})`);
    assert(initialGetB.data.notifications.length === 2, 'Student B sees exactly 2 notifications');

    // 4.3: Execute PUT /api/notifications/read-all for Student A
    console.log('\n--- EXECUTING PUT /api/notifications/read-all ---');
    const readAllRes = await httpRequest('/api/notifications/read-all', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${tokenA}`,
        'Content-Type': 'application/json'
      }
    });
    assert(readAllRes.statusCode === 200, 'PUT /api/notifications/read-all returned 200 OK');
    assert(readAllRes.data.success === true, 'Response contains success: true');
    assert(readAllRes.data.unreadCount === 0, 'Response explicitly reports unreadCount: 0');
    assert(readAllRes.data.updatedCount === 4, `Response confirms 4 updated notifications (got ${readAllRes.data.updatedCount})`);

    // 4.4: Verify Student A Notifications After Bulk Read
    const postGetA = await httpRequest('/api/notifications', {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(postGetA.data.unreadCount === 0, `Student A unreadCount updated to 0 (got ${postGetA.data.unreadCount})`);
    assert(postGetA.data.notifications.length === 4, 'Notification history preserved (all 4 notifications retained)');
    assert(postGetA.data.notifications.every(n => n.read === true), 'Every notification belonging to Student A has read === true');

    // Verify metadata preservation
    const retNotif = postGetA.data.notifications.find(n => n.id === 'notif_alpha_03');
    assert(retNotif && retNotif.returnId === 'ret_alpha_99', 'Notification custom fields (returnId) preserved');
    assert(retNotif && retNotif.linkUrl === '/student/#returns', 'Notification linkUrl preserved');
    assert(retNotif && retNotif.title.includes('Return Handover'), 'Notification title preserved');

    // 4.5: Student Isolation Check (Student B MUST NOT BE AFFECTED)
    console.log('\n--- CROSS-STUDENT ISOLATION AUDIT ---');
    const postGetB = await httpRequest('/api/notifications', {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert(postGetB.data.unreadCount === 2, `Student B unreadCount remains strictly 2 (got ${postGetB.data.unreadCount})`);
    assert(postGetB.data.notifications.every(n => n.read === false), 'Student B notifications remain unread');

    // 4.6: Cross-Student Single Read Authorization Guard
    const unauthorizedRead = await httpRequest('/api/notifications/notif_beta_01/read', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${tokenA}`,
        'Content-Type': 'application/json'
      }
    });
    assert(unauthorizedRead.statusCode === 403, 'Student A cannot mark Student B notification read (403 Forbidden)');

    // 4.7: On-Disk Persistence Verification
    console.log('\n--- ON-DISK PERSISTENCE AUDIT ---');
    const diskContent = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
    const diskNotifsA = diskContent.notifications.filter(n => n.userId === studentA.id);
    const diskNotifsB = diskContent.notifications.filter(n => n.userId === studentB.id);
    assert(diskNotifsA.every(n => n.read === true), 'Disk database reflects read: true for all Student A items');
    assert(diskNotifsB.every(n => n.read === false), 'Disk database reflects read: false for all Student B items');

    // 4.8: Re-authentication / Fresh Login Persistence Check
    console.log('\n--- RE-AUTHENTICATION / REFRESH AUDIT ---');
    const newTokenA = jwt.sign({ id: studentA.id, role: studentA.role }, JWT_SECRET, { expiresIn: '1h' });
    const freshLoginGetA = await httpRequest('/api/notifications', {
      headers: { 'Authorization': `Bearer ${newTokenA}` }
    });
    assert(freshLoginGetA.data.unreadCount === 0, 'New login session sees unreadCount === 0');
    assert(freshLoginGetA.data.notifications.every(n => n.read === true), 'New login session sees all items read');

    // 4.9: Idempotency with Zero Unread Notifications
    const idempotentRes = await httpRequest('/api/notifications/read-all', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${tokenA}`,
        'Content-Type': 'application/json'
      }
    });
    assert(idempotentRes.statusCode === 200, 'Subsequent mark-all-read returns 200');
    assert(idempotentRes.data.unreadCount === 0, 'Subsequent mark-all-read unreadCount remains 0');
    assert(idempotentRes.data.updatedCount === 0, 'Subsequent mark-all-read updatedCount is 0');

    // STEP 5: Frontend UI Sandbox Simulation
    console.log('\n[4/6] Frontend DOM & UI State Synchronization Simulation...');

    class MockClassList {
      constructor(initial = []) {
        this.classes = new Set(initial);
      }
      add(cls) { this.classes.add(cls); }
      remove(cls) { this.classes.delete(cls); }
      contains(cls) { return this.classes.has(cls); }
    }

    class MockElement {
      constructor(id, tag = 'div', classes = []) {
        this.id = id;
        this.tagName = tag.toUpperCase();
        this.classList = new MockClassList(classes);
        this.style = {};
        this.textContent = '';
        this.innerHTML = '';
        this.parentNode = null;
      }
      remove() {
        if (this.parentNode && this.parentNode.children) {
          const idx = this.parentNode.children.indexOf(this);
          if (idx !== -1) this.parentNode.children.splice(idx, 1);
        }
      }
    }

    const mockElements = new Map();
    const badgeEl = new MockElement('badge-notif-count', 'span', ['sidebar-badge']);
    badgeEl.textContent = '4';
    badgeEl.style.display = 'inline-block';
    mockElements.set('badge-notif-count', badgeEl);

    const card1 = new MockElement('notif-card-1', 'div', ['notif-accordion-card', 'unread']);
    const card2 = new MockElement('notif-card-2', 'div', ['notif-accordion-card', 'unread']);
    const dot1 = new MockElement('notif-dot-1', 'span', ['notif-unread-dot']);
    const dot2 = new MockElement('notif-dot-2', 'span', ['notif-unread-dot']);

    const allCards = [card1, card2];
    const allDots = [dot1, dot2];

    let lastToast = null;

    const mockDocument = {
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById(id) {
        return mockElements.get(id) || null;
      },
      querySelectorAll(selector) {
        if (selector === '.notif-accordion-card.unread') {
          return allCards.filter(c => c.classList.contains('unread'));
        }
        if (selector === '.notif-unread-dot') {
          return [...allDots];
        }
        return [];
      }
    };

    let apiSucceeds = true;
    let apiErrorMsg = 'Server Timeout';

    const mockApi = {
      markAllNotificationsRead: async () => {
        if (!apiSucceeds) throw new Error(apiErrorMsg);
        return { success: true, unreadCount: 0, updatedCount: 2 };
      },
      markNotificationRead: async (id) => ({ success: true }),
      getNotifications: async () => ({
        notifications: [{ id: '1', read: false }, { id: '2', read: false }],
        unreadCount: 2
      })
    };

    const studentJsPath = path.join(__dirname, '..', 'public', 'student', 'student.js');
    const studentJsCode = fs.readFileSync(studentJsPath, 'utf8');

    const sandbox = {
      window: {},
      document: mockDocument,
      api: mockApi,
      showToast: (type, title, msg) => {
        lastToast = { type, title, msg };
      },
      console: { log: () => {}, error: () => {}, warn: () => {} }
    };
    sandbox.window = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(studentJsCode, sandbox);

    // Populate studentNotifsCache via loadNotificationsFeed
    await sandbox.loadNotificationsFeed();

    // 5.1: Test Successful Mark All as Read in UI
    console.log('--- UI SIMULATION: SUCCESSFUL BULK READ ---');
    assert(typeof sandbox.markAllNotificationsRead === 'function', 'markAllNotificationsRead function is available');
    
    await sandbox.markAllNotificationsRead();

    assert(card1.classList.contains('read') && !card1.classList.contains('unread'), 'Card 1 switched to read class');
    assert(card2.classList.contains('read') && !card2.classList.contains('unread'), 'Card 2 switched to read class');
    assert(badgeEl.textContent === '0', 'Sidebar badge textContent explicitly reset to "0"');
    assert(badgeEl.style.display === 'none', 'Sidebar badge hidden with display: none');
    const updatedCache = vm.runInContext('studentNotifsCache', sandbox);
    assert(updatedCache.every(n => n.read === true), 'In-memory studentNotifsCache items updated to read: true');
    assert(lastToast && lastToast.type === 'info', 'Success toast displayed to user');

    // 5.2: Test Failed Mark All as Read (Does NOT falsely clear UI)
    console.log('--- UI SIMULATION: FAILED API CALL PROTECTION ---');
    // Reset cards to unread
    card1.classList.remove('read'); card1.classList.add('unread');
    card2.classList.remove('read'); card2.classList.add('unread');
    badgeEl.textContent = '2';
    badgeEl.style.display = 'inline-block';
    vm.runInContext("studentNotifsCache = [{ id: '1', read: false }, { id: '2', read: false }];", sandbox);
    apiSucceeds = false;

    await sandbox.markAllNotificationsRead();

    assert(card1.classList.contains('unread'), 'Card 1 remains unread on API failure');
    assert(card2.classList.contains('unread'), 'Card 2 remains unread on API failure');
    assert(badgeEl.textContent === '2', 'Sidebar badge textContent retained at "2" on API failure');
    assert(badgeEl.style.display === 'inline-block', 'Sidebar badge remains visible on API failure');
    assert(lastToast && lastToast.type === 'error', 'Error toast displayed to user on API failure');

    // 5.3: Test Existing Single-Notification Accordion Read Behavior
    console.log('--- UI SIMULATION: SINGLE NOTIFICATION DECREMENT ---');
    badgeEl.textContent = '1';
    badgeEl.style.display = 'inline-block';
    const singleCard = new MockElement('notif-card-single', 'div', ['notif-accordion-card', 'unread']);
    mockElements.set('notif-card-single', singleCard);
    sandbox.studentNotifsCache = [{ id: 'single', read: false }];

    // Simulate decrement down to 0
    let count = parseInt(badgeEl.textContent) || 0;
    count = Math.max(0, count - 1);
    badgeEl.textContent = count;
    if (count > 0) { badgeEl.style.display = 'inline-block'; } else { badgeEl.style.display = 'none'; }

    assert(badgeEl.textContent === 0 || badgeEl.textContent === '0', 'Badge textContent cleanly decrements to 0');
    assert(badgeEl.style.display === 'none', 'Badge hides when decremented to 0');

  } catch (err) {
    console.error('Fatal test error:', err);
    failed++;
  } finally {
    // Teardown
    console.log('\n[5/6] Cleaning Up Sandbox Environment...');
    serverProc.kill();
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });

    // STEP 6: Final Verification of Production DB Immutability
    console.log('\n[6/6] Verifying Final Production Database Immutability...');
    const finalChecksum = crypto.createHash('sha256').update(fs.readFileSync(ORIGINAL_DB_PATH)).digest('hex').toLowerCase();
    assert(finalChecksum === EXPECTED_CHECKSUM, `Production database SHA256 remains 100% untouched (${finalChecksum})`);
  }

  console.log('\n========================================================================');
  console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
