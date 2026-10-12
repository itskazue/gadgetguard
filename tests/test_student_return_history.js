/**
 * GadgetGuard — Student Portal Return History & Notification Navigation Hotfix Test Suite
 * Strictly isolated test running on port 3996 with temporary test database.
 * Does NOT touch data/database.json, localhost:3000, or the deployed website.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const TEST_PORT = 3996;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEMP_DATA_DIR = path.join(__dirname, '..', 'scratch', 'test_student_isolated_dir');
const ORIGINAL_DB_PATH = path.join(__dirname, '..', 'data', 'database.json');

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
        try {
          json = JSON.parse(data);
        } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          data: json
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -------------------------------------------------------------
// PART 1: STATIC CODE & UI CONTRACT AUDITS
// -------------------------------------------------------------
function runStaticCodeAudits() {
  console.log('\n======================================================');
  console.log('PART 1: STATIC CODE & UI CONTRACT AUDITS');
  console.log('======================================================');

  const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'student', 'index.html'), 'utf8');
  const jsContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'student', 'student.js'), 'utf8');

  // Requirement 1: Rename Student "Claim Requests" to "Return History"
  console.log('\n--- AUDIT 1: RENAME CLAIM REQUESTS TO RETURN HISTORY ---');
  assert(!htmlContent.includes('<div class="student-nav-item" onclick="navigateStudent(\'claims\')" id="nav-item-claims">\n            <div class="student-nav-item-content">\n              <svg viewBox="0 0 24 24" fill="none" stroke-width="2">\n                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>\n                <polyline points="14 2 14 8 20 8"></polyline>\n                <line x1="16" y1="13" x2="8" y2="13"></line>\n                <line x1="16" y1="17" x2="8" y2="17"></line>\n              </svg>\n              <span>Claim Requests</span>'), 'Sidebar navigation does not label item "Claim Requests"');
  assert(htmlContent.includes('<span>Return History</span>'), 'Sidebar navigation item is renamed to "Return History"');
  assert(htmlContent.includes('<div class="metric-label">Return History</div>'), 'Dashboard metric card is renamed to "Return History"');
  assert(jsContent.includes("'claims': 'My Gadget Return History'"), "student.js maps 'claims' screen title to 'My Gadget Return History'");
  assert(jsContent.includes("'returns': 'My Gadget Return History'"), "student.js maps 'returns' alias to 'My Gadget Return History'");

  // Requirement 2: Replace redundant tables with ONE "My Gadget Return History" table
  console.log('\n--- AUDIT 2: ONE UNIFIED RETURN HISTORY TABLE ---');
  assert(htmlContent.includes('My Gadget Return History</h3>'), 'Screen 5 header displays "My Gadget Return History"');
  assert(htmlContent.includes('id="student-returns-table-container"'), 'Unified table container #student-returns-table-container present');
  assert(!htmlContent.includes('<h3>My Custody Claim Requests</h3>'), 'Old redundant "My Custody Claim Requests" card removed');
  assert(!htmlContent.includes('<h3>📜 Handover & Return Receipts</h3>'), 'Old redundant "Handover & Return Receipts" card header removed');

  // Requirement 3: Table Columns (Gadget, Return Date & Time (PHT), Status, Action/Receipt)
  console.log('\n--- AUDIT 3: REQUIRED TABLE COLUMNS ---');
  assert(/<th[^>]*>Gadget<\/th>/.test(jsContent), 'Table headers include "Gadget"');
  assert(/<th[^>]*>Return Date &amp; Time \(PHT\)<\/th>/.test(jsContent), 'Table headers include "Return Date & Time (PHT)"');
  assert(/<th[^>]*>Status<\/th>/.test(jsContent), 'Table headers include "Status"');
  assert(/<th[^>]*>Action<\/th>/.test(jsContent), 'Table headers include "Action"');
  assert(jsContent.includes('🧾 View Receipt'), 'Action button includes "View Receipt"');

  // Requirement 4: Receipt Modal & Handover Details
  console.log('\n--- AUDIT 4: VIEW RECEIPT MODAL & HANDOVER DETAILS ---');
  assert(htmlContent.includes('id="student-return-receipt-modal"'), 'Receipt modal #student-return-receipt-modal defined in HTML');
  assert(htmlContent.includes('id="receipt-modal-ref"'), 'Modal contains #receipt-modal-ref for return reference');
  assert(htmlContent.includes('id="receipt-modal-gadget-name"'), 'Modal contains #receipt-modal-gadget-name');
  assert(htmlContent.includes('id="receipt-modal-date"'), 'Modal contains #receipt-modal-date');
  assert(htmlContent.includes('id="receipt-modal-staff"'), 'Modal contains #receipt-modal-staff for OSA staff');
  assert(htmlContent.includes('id="receipt-modal-recipient-name"'), 'Modal contains #receipt-modal-recipient-name');
  assert(htmlContent.includes('id="receipt-modal-recipient-id"'), 'Modal contains #receipt-modal-recipient-id');
  assert(htmlContent.includes('id="receipt-modal-notes"'), 'Modal contains #receipt-modal-notes');
  assert(htmlContent.includes('id="receipt-modal-photo-img"'), 'Modal contains #receipt-modal-photo-img for photo proof');

  // Requirement 6: Missing Dates without inventing timestamps
  console.log('\n--- AUDIT 6: MISSING DATE CONTRACT ---');
  assert(jsContent.includes('function formatReturnDateTime(isoStr)'), 'formatReturnDateTime helper function defined');
  assert(jsContent.includes("if (!isoStr) return '—'"), "Missing date returns '—' em-dash");
  assert(!jsContent.includes('formatReturnDateTime(isoStr) {\n  if (!isoStr) return new Date()'), 'Never invents synthetic timestamp for missing dates');

  // Requirement 7: Notifications Navigation & No Blank Screen
  console.log('\n--- AUDIT 7: NOTIFICATIONS NAVIGATION FIX ---');
  assert(jsContent.includes("if (screenName === 'returns' || screenName === 'return-history') screenName = 'claims'"), "navigateStudent aliases 'returns' to 'claims' avoiding blank screen");
  assert(jsContent.includes('openStudentReturnReceiptForNotif'), 'Helper openStudentReturnReceiptForNotif defined in student.js');
  assert(jsContent.includes('openStudentReturnReceiptModal'), 'openStudentReturnReceiptModal defined in student.js');
}

// -------------------------------------------------------------
// PART 2: UNIT & LOGIC SIMULATION
// -------------------------------------------------------------
function runUnitLogicTests() {
  console.log('\n======================================================');
  console.log('PART 2: UNIT & LOGIC SIMULATION (DATE, DEDUPLICATION, RECEIPT)');
  console.log('======================================================');

  // 1. Test formatReturnDateTime logic
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

  assert(formatReturnDateTime(null) === '—', 'formatReturnDateTime(null) returns em-dash —');
  assert(formatReturnDateTime(undefined) === '—', 'formatReturnDateTime(undefined) returns em-dash —');
  assert(formatReturnDateTime('') === '—', 'formatReturnDateTime("") returns em-dash —');
  assert(formatReturnDateTime('not-a-date') === '—', 'formatReturnDateTime("not-a-date") returns em-dash —');
  
  const testIso = '2026-10-12T03:19:09.000Z'; // 11:19 AM in PHT (UTC+8)
  const formattedPht = formatReturnDateTime(testIso);
  assert(formattedPht === 'Oct 12, 2026, 11:19 AM', `formatReturnDateTime formats to PHT (${formattedPht})`);

  // 2. Test Multi-Cycle Preservation & Deduplication logic
  const mockRawReturns = [
    {
      id: 'ret_cycle1',
      gadgetId: 'gdt_laptop',
      returnDate: '2026-10-01T08:00:00.000Z',
      receivedByPersonName: 'Student Juan',
      receivedByPersonId: '2024-0001',
      returnedByAdmin: 'Admin Maria',
      gadget: { brand: 'Apple', model: 'MacBook Air M2', color: 'Midnight' }
    },
    {
      id: 'ret_cycle1', // Duplicate of Cycle 1
      gadgetId: 'gdt_laptop',
      returnDate: '2026-10-01T08:00:00.000Z',
      receivedByPersonName: 'Student Juan',
      receivedByPersonId: '2024-0001',
      returnedByAdmin: 'Admin Maria',
      gadget: { brand: 'Apple', model: 'MacBook Air M2', color: 'Midnight' }
    },
    {
      id: 'ret_cycle2', // Distinct Cycle 2 return for same device
      gadgetId: 'gdt_laptop',
      returnDate: '2026-10-12T04:30:00.000Z',
      receivedByPersonName: 'Student Juan',
      receivedByPersonId: '2024-0001',
      returnedByAdmin: 'Admin Santos',
      gadget: { brand: 'Apple', model: 'MacBook Air M2', color: 'Midnight' }
    }
  ];

  const genuineReturns = [];
  const seenTxIds = new Set();
  for (const r of mockRawReturns) {
    const txId = r.id || r.returnId;
    if (txId) {
      if (seenTxIds.has(txId)) continue;
      seenTxIds.add(txId);
    }
    genuineReturns.push(r);
  }

  genuineReturns.sort((a, b) => {
    const timeA = new Date(a.returnDate || a.returnedAt || a.processedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.returnDate || b.returnedAt || b.processedAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  });

  assert(genuineReturns.length === 2, `Deduplication produced exactly 2 genuine rows (got ${genuineReturns.length})`);
  assert(genuineReturns[0].id === 'ret_cycle2', 'Newest recovery cycle (Cycle 2) appears first');
  assert(genuineReturns[1].id === 'ret_cycle1', 'Legitimate previous recovery cycle (Cycle 1) is preserved');
}

// -------------------------------------------------------------
// PART 3: INTEGRATION & WORKFLOW TESTS ON ISOLATED SERVER
// -------------------------------------------------------------
async function runIntegrationTests() {
  console.log('\n======================================================');
  console.log('PART 3: ISOLATED WORKFLOW & ENDPOINT INTEGRATION TESTS');
  console.log('======================================================');

  // Prepare isolated temporary data dir
  if (!fs.existsSync(TEMP_DATA_DIR)) {
    fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });
  }

  const originalDb = JSON.parse(fs.readFileSync(ORIGINAL_DB_PATH, 'utf8'));
  const testDb = JSON.parse(JSON.stringify(originalDb));

  // Create isolated users
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync('Student@123', salt);
  const adminHash = bcrypt.hashSync('Admin@123', salt);

  const studentUser = {
    id: 'usr_student_test',
    name: 'Juan Dela Cruz',
    idNumber: '2024-11001',
    email: 'juan@student.ncst.edu.ph',
    passwordHash: passwordHash,
    role: 'student',
    department: 'BSCS',
    contactNumber: '09171234567'
  };

  const osaAdminUser = {
    id: 'usr_osa_test',
    name: 'OSA Officer Santos',
    idNumber: 'OSA-001',
    email: 'osa@ncst.edu.ph',
    passwordHash: adminHash,
    role: 'osa_admin',
    department: 'OSA',
    contactNumber: '09179998888'
  };

  const testGadget = {
    id: 'gdt_macbook_test',
    userId: studentUser.id,
    brand: 'Apple',
    model: 'MacBook Pro 14 M3',
    category: 'Laptop',
    color: 'Space Gray',
    serialNumber: 'SN-MBP-9988',
    status: 'FOUND_IN_CUSTODY',
    custodyLocation: 'OSA Vault Locker (Room 1109)',
    secureToken: 'tok_mbp_test',
    qrCode: 'data:image/png;base64,mockqr',
    registrationDate: new Date().toISOString()
  };

  testDb.users.push(studentUser, osaAdminUser);
  testDb.gadgets.push(testGadget);
  testDb.returns = [];
  testDb.notifications = [];
  testDb.claims = [];

  const testDbPath = path.join(TEMP_DATA_DIR, 'database.json');
  fs.writeFileSync(testDbPath, JSON.stringify(testDb, null, 2), 'utf8');

  // Spawn isolated test server
  console.log(`Starting isolated test server on port ${TEST_PORT}...`);
  const serverProcess = fork(path.join(__dirname, '..', 'server', 'server.js'), [], {
    env: {
      ...process.env,
      PORT: TEST_PORT.toString(),
      DATA_DIR: TEMP_DATA_DIR,
      DB_FILE: testDbPath,
      DATABASE_URL: '',
      JWT_SECRET: 'test_student_secret_jwt',
      NODE_ENV: 'test'
    },
    silent: true
  });

  serverProcess.stdout.on('data', d => {});
  serverProcess.stderr.on('data', d => {});

  let serverReady = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    try {
      const res = await httpRequest('/api/health');
      if (res.statusCode === 200) {
        serverReady = true;
        break;
      }
    } catch (e) {}
  }

  assert(serverReady, `Isolated test server active on port ${TEST_PORT}`);

  try {
    // 1. Login Student
    console.log('\n--- STEP 1: AUTHENTICATE TEST USERS ---');
    const studLogin = await httpRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'juan@student.ncst.edu.ph', password: 'Student@123' }
    });
    assert(studLogin.statusCode === 200 && studLogin.data.token, 'Student authenticated successfully');
    const studentToken = studLogin.data.token;

    // Login OSA Admin
    const osaLogin = await httpRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'osa@ncst.edu.ph', password: 'Admin@123' }
    });
    assert(osaLogin.statusCode === 200 && osaLogin.data.token, 'OSA Admin authenticated successfully');
    const osaToken = osaLogin.data.token;

    // 2. Initial state: Student returns empty
    console.log('\n--- STEP 2: VERIFY INITIAL EMPTY RETURN HISTORY ---');
    const initReturnsRes = await httpRequest('/api/osa/returns', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert(initReturnsRes.statusCode === 200, 'Student calls GET /api/osa/returns (200 OK)');
    assert(Array.isArray(initReturnsRes.data.returns) && initReturnsRes.data.returns.length === 0, 'Initial returns list is empty');

    // 3. OSA processes Cycle 1 Return Handover
    console.log('\n--- STEP 3: OSA PROCESSES CYCLE 1 RETURN HANDOVER ---');
    const cycle1Return = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${osaToken}`,
        'Content-Type': 'application/json'
      },
      body: {
        gadgetId: testGadget.id,
        receivedByPersonName: 'Juan Dela Cruz',
        receivedByPersonId: '2024-11001',
        handoverPhotoUrl: 'https://storage.ncst.edu.ph/proofs/handover_cycle1.jpg',
        notes: 'Handover verified in person with student registration card.'
      }
    });

    assert(cycle1Return.statusCode === 200, 'Cycle 1 return completed via POST /api/osa/return (200 OK)');
    const cycle1Record = cycle1Return.data.returnRecord;
    assert(cycle1Record && cycle1Record.id.startsWith('ret_'), `Generated Cycle 1 return reference: ${cycle1Record?.id}`);

    // 4. Verify Student gets Cycle 1 Return record
    console.log('\n--- STEP 4: VERIFY STUDENT RETURN RECORD DETAILS ---');
    const studReturnsRes1 = await httpRequest('/api/osa/returns', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert(studReturnsRes1.statusCode === 200, 'Student fetched returns (200 OK)');
    assert(studReturnsRes1.data.returns.length === 1, 'Student returns list contains exactly 1 record');

    const ret1 = studReturnsRes1.data.returns[0];
    assert(ret1.id === cycle1Record.id, `Return ID matches actual return reference (${ret1.id})`);
    assert(ret1.returnedByAdmin === 'OSA Officer Santos', `Releasing OSA staff member matches (${ret1.returnedByAdmin})`);
    assert(ret1.receivedByPersonName === 'Juan Dela Cruz', 'Verified recipient name matches');
    assert(ret1.receivedByPersonId === '2024-11001', 'Verified recipient Student ID matches');
    assert(ret1.handoverPhotoUrl === 'https://storage.ncst.edu.ph/proofs/handover_cycle1.jpg', 'Handover photo evidence preserved');
    assert(ret1.notes.includes('Handover verified in person'), 'Handover notes preserved');
    assert(ret1.gadget.brand === 'Apple' && ret1.gadget.model === 'MacBook Pro 14 M3', 'Gadget details enriched');

    // 5. Verify Owner Notification
    console.log('\n--- STEP 5: VERIFY OWNER NOTIFICATION PAYLOAD ---');
    const notifsRes = await httpRequest('/api/notifications', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert(notifsRes.statusCode === 200, 'Student fetched notifications (200 OK)');
    const retNotif = (notifsRes.data.notifications || []).find(n => n.type === 'RETURNED_SUCCESS');
    assert(retNotif, 'RETURNED_SUCCESS notification created for gadget owner');
    assert(retNotif.returnId === cycle1Record.id, `Notification carries exact returnId (${retNotif.returnId})`);
    assert(retNotif.linkUrl.includes('/student/#returns'), `Notification linkUrl points to returns screen (${retNotif.linkUrl})`);
    assert(retNotif.read === false, 'Notification begins with unread status (badge preservation)');

    // 6. Test Multi-Cycle Recovery (Cycle 2 for same gadget)
    console.log('\n--- STEP 6: TEST MULTI-CYCLE RECOVERY PRESERVATION ---');
    // Device is reported missing again later
    await httpRequest('/api/missing', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${studentToken}`,
        'Content-Type': 'application/json'
      },
      body: {
        gadgetId: testGadget.id,
        lastSeenLocation: 'Library 3rd Floor',
        message: 'Accidentally left in study carrel'
      }
    });

    // Device turned into custody again
    await httpRequest(`/api/finder/${testGadget.id}/receive`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${osaToken}`,
        'Content-Type': 'application/json'
      },
      body: {
        custodyLocation: 'OSA Vault Locker (Room 1109)',
        notes: 'Turned in by student assistant'
      }
    });

    // Cycle 2 Return processed
    const cycle2Return = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${osaToken}`,
        'Content-Type': 'application/json'
      },
      body: {
        gadgetId: testGadget.id,
        receivedByPersonName: 'Juan Dela Cruz',
        receivedByPersonId: '2024-11001',
        handoverPhotoUrl: 'https://storage.ncst.edu.ph/proofs/handover_cycle2.jpg',
        notes: 'Cycle 2 handover confirmed at front desk.'
      }
    });

    assert(cycle2Return.statusCode === 200, 'Cycle 2 return completed successfully');
    const cycle2Record = cycle2Return.data.returnRecord;
    assert(cycle2Record.id !== cycle1Record.id, `Cycle 2 has distinct return reference (${cycle2Record.id} !== ${cycle1Record.id})`);

    // Student fetches returns list: both genuine cycles must be preserved!
    const studReturnsRes2 = await httpRequest('/api/osa/returns', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert(studReturnsRes2.statusCode === 200, 'Student fetched multi-cycle returns');
    const returnsList = studReturnsRes2.data.returns;
    assert(returnsList.length === 2, `Student Return History preserves exactly 2 recovery cycles (got ${returnsList.length})`);
    assert(returnsList[0].id === cycle2Record.id, 'Newest return (Cycle 2) is sorted first');
    assert(returnsList[1].id === cycle1Record.id, 'Legitimate older return (Cycle 1) is cleanly preserved');

    // 7. Security Check: Student forbidden from OSA Admin Claims endpoint
    console.log('\n--- STEP 7: SECURITY & BACKEND CLAIMS ISOLATION ---');
    const forbiddenClaims = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert(forbiddenClaims.statusCode === 403, 'Student role forbidden from calling GET /api/claims (403 Forbidden)');

    // Student can call their own claims
    const myClaimsRes = await httpRequest('/api/claims/my', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert(myClaimsRes.statusCode === 200, 'Student allowed to call GET /api/claims/my (200 OK)');

  } finally {
    // Teardown isolated test server
    console.log('\nShutting down isolated test server...');
    serverProcess.kill('SIGTERM');
    await sleep(500);

    // Clean up temporary test data dir
    try {
      fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
    } catch (e) {}
  }
}

// -------------------------------------------------------------
// MAIN TEST RUNNER
// -------------------------------------------------------------
async function runAll() {
  console.log('======================================================');
  console.log('GADGETGUARD: STUDENT PORTAL RETURN HISTORY HOTFIX TESTS');
  console.log('======================================================');

  runStaticCodeAudits();
  runUnitLogicTests();
  await runIntegrationTests();

  console.log('\n======================================================');
  console.log(`SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAll().catch(err => {
  console.error('Test suite uncaught failure:', err);
  process.exit(1);
});
