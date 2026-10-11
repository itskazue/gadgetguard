/**
 * GadgetGuard — Finder & Owner Chat Multi-Cycle & Surrender Transition Test Suite
 * Strictly isolated test running on port 3999 with temporary test database.
 * Does NOT touch data/database.json, localhost:3000, or the deployed website.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const TEST_PORT = 3999;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEMP_DATA_DIR = path.join(__dirname, '..', 'scratch', 'test_finder_chat_isolated_dir');
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

async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await httpRequest('/api/health');
      if (res.statusCode === 200 || res.statusCode === 404) return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return false;
}

function getFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
}

async function run() {
  console.log('========================================================================');
  console.log('GADGETGUARD: FINDER & OWNER CHAT MULTI-CYCLE & SURRENDER REGRESSION TEST');
  console.log('========================================================================\n');

  // Verify original database hash before test
  const initialDbHash = getFileSha256(ORIGINAL_DB_PATH);
  console.log(`🔒 Initial original database hash: ${initialDbHash}`);

  // 1. Prepare temporary isolated test directory and database
  if (fs.existsSync(TEMP_DATA_DIR)) {
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync('testpass123', salt);

  const initialTestDb = {
    users: [
      {
        id: 'usr_test_admin',
        name: 'Carlos Mendoza Test',
        email: 'admin.test@univ.edu',
        passwordHash: passwordHash,
        role: 'osa_admin',
        idNumber: 'OSA-TEST-001',
        department: 'Office of Student Affairs',
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
      },
      {
        id: 'usr_test_student',
        name: 'Thirdy Manaog Test',
        email: 'student.test@univ.edu',
        passwordHash: passwordHash,
        role: 'student',
        idNumber: '2024-TEST-01',
        department: 'College - BS-IT',
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
      }
    ],
    gadgets: [
      {
        id: 'gdt_test_iphone',
        userId: 'usr_test_student',
        category: 'Smartphone',
        brand: 'Apple',
        model: 'iPhone XR Test',
        serialNumber: 'SN-TEST-IPHONE-XR',
        color: 'Yellow',
        status: 'REGISTERED',
        secureToken: 'gg_token_iphone_xr',
        registrationDate: new Date().toISOString(),
        createdAt: new Date().toISOString()
      }
    ],
    missing_reports: [],
    qr_scans: [],
    found_reports: [],
    claims: [],
    returns: [],
    notifications: [],
    audit_logs: [],
    recovery_chats: [],
    uploaded_files: [],
    revoked_tokens: [],
    system_settings: {
      schoolName: "NCST Test Campus",
      campusName: "Main Campus",
      osaOfficeLocation: "Room 1109",
      osaContactPhone: "0917-000-0000",
      osaEmail: "osa.test@univ.edu",
      operatingHours: "8:00 AM - 5:00 PM"
    }
  };

  fs.writeFileSync(path.join(TEMP_DATA_DIR, 'database.json'), JSON.stringify(initialTestDb, null, 2), 'utf8');
  console.log(`📁 Isolated test database prepared in ${TEMP_DATA_DIR}\n`);

  // 2. Launch isolated server on port 3999
  console.log(`🚀 Launching isolated test server on port ${TEST_PORT}...`);
  const serverProcess = fork(path.join(__dirname, '..', 'server', 'server.js'), [], {
    env: {
      ...process.env,
      PORT: TEST_PORT.toString(),
      DATA_DIR: TEMP_DATA_DIR,
      DATABASE_URL: '',
      POSTGRES_URL: '',
      PG_CONNECTION_STRING: '',
      NODE_ENV: 'test'
    },
    stdio: 'pipe'
  });

  const isReady = await waitForServer();
  assert(isReady, `Isolated test server online on port ${TEST_PORT}`);

  try {
    // Authenticate Admin and Student
    const adminLoginRes = await httpRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'admin.test@univ.edu', password: 'testpass123' }
    });
    assert(adminLoginRes.data?.success && adminLoginRes.data?.token, 'OSA Admin authenticated successfully');
    const adminToken = adminLoginRes.data?.token;

    const studentLoginRes = await httpRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'student.test@univ.edu', password: 'testpass123' }
    });
    assert(studentLoginRes.data?.success && studentLoginRes.data?.token, 'Student authenticated successfully');
    const studentToken = studentLoginRes.data?.token;

    console.log('\n--- BUG 1 TEST: MULTI-INCIDENT REPEATED QR SCANNING & SESSION BINDING ---');

    // 1.1 Cycle 1: Student reports iPhone missing
    const rep1 = await httpRequest('/api/missing/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        lastSeenLocation: 'Library 2nd Floor',
        lastSeenDate: new Date().toISOString(),
        details: 'Cycle 1: Left on desk during finals.'
      }
    });
    assert(rep1.data?.success, 'Cycle 1: Student reported iPhone XR missing');
    const cycle1MissingId = rep1.data?.report?.id;
    assert(Boolean(cycle1MissingId), `Cycle 1 missing report ID recorded: ${cycle1MissingId}`);

    // 1.2 Cycle 1: Finder scans QR code for the first time
    const scan1 = await httpRequest('/api/scan/device/gg_token_iphone_xr');
    assert(scan1.data?.success, 'Cycle 1: Public QR scan succeeds');
    assert(scan1.data?.gadget?.status === 'MISSING', 'Cycle 1: Public QR shows device is MISSING');
    assert(scan1.data?.missingReport?.id === cycle1MissingId, 'Cycle 1: Public QR scan exposes current missingReport.id');
    assert(!scan1.data?.owner, 'Privacy: Public QR scan does not expose owner object');

    // 1.3 Cycle 1: Finder chooses "I Will Keep the Gadget Safe"
    const fndRep1 = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_token_iphone_xr',
        gadgetId: 'gdt_test_iphone',
        finderName: 'Maria Santos',
        contactNumber: '09181234567',
        foundLocation: 'Library Study Area',
        turnInMethod: 'KEPT_SAFE',
        message: 'Hello, I have your iPhone in the library.'
      }
    });
    assert(fndRep1.data?.success, 'Cycle 1: Finder submitted Keep Safe report');
    const cycle1ChatId = fndRep1.data?.chat?.id;
    const cycle1FinderSessionToken = fndRep1.data?.chat?.finderSessionToken;
    const cycle1FoundReportId = fndRep1.data?.report?.id;
    assert(Boolean(cycle1ChatId), `Cycle 1: Recovery chat created: ${cycle1ChatId}`);
    assert(Boolean(cycle1FinderSessionToken), 'Cycle 1: Finder session token issued');
    assert(fndRep1.data?.chat?.missingReportId === cycle1MissingId, 'Cycle 1: Chat is bound to Cycle 1 missingReportId');

    // 1.4 Cycle 1: Exchange messages
    const finderMsg1 = await httpRequest(`/api/chat/${cycle1ChatId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': cycle1FinderSessionToken
      },
      body: {
        text: 'Where can we meet?'
      }
    });
    assert(finderMsg1.data?.success, 'Cycle 1: Finder sent chat message');

    const ownerMsg1 = await httpRequest(`/api/chat/${cycle1ChatId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: {
        text: 'Thank you! Let us meet at OSA Room 1109.'
      }
    });
    assert(ownerMsg1.data?.success, 'Cycle 1: Owner sent chat message');

    // 1.5 Cycle 1: Handover to OSA & Return to Owner (Cycle 1 Complete)
    const intake1 = await httpRequest('/api/finder/gdt_test_iphone/receive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        custodyLocation: 'OSA Vault A-1',
        notes: 'Turned in by Maria Santos at desk.'
      }
    });
    assert(intake1.data?.success, 'Cycle 1: OSA confirmed custody intake');

    const return1 = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        receivedByPersonName: 'Thirdy Manaog Test',
        notes: 'Returned to student.',
        handoverPhotoUrl: '/uploads/cycle1_proof.jpg'
      }
    });
    assert(return1.data?.success, 'Cycle 1: Device returned to student');

    // Verify gadget restored to REGISTERED and Cycle 1 chat is CLOSED
    const gadgetCycle1Done = await httpRequest('/api/gadgets', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const g1 = gadgetCycle1Done.data?.gadgets?.find(g => g.id === 'gdt_test_iphone');
    assert(g1?.status === 'REGISTERED', 'Cycle 1 Complete: Gadget status restored to REGISTERED');

    // 1.6 Cycle 2: Month later, same gadget reported missing AGAIN
    console.log('\n--- STARTING CYCLE 2 FOR THE SAME GADGET ---');
    const rep2 = await httpRequest('/api/missing/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        lastSeenLocation: 'Gymnasium Bleachers',
        lastSeenDate: new Date().toISOString(),
        details: 'Cycle 2: Left in gymnasium after basketball game.'
      }
    });
    assert(rep2.data?.success, 'Cycle 2: Student reported same gadget missing a second time');
    const cycle2MissingId = rep2.data?.report?.id;
    assert(Boolean(cycle2MissingId) && cycle2MissingId !== cycle1MissingId, `Cycle 2 missing report ID generated: ${cycle2MissingId}`);

    // 1.7 Cycle 2: Finder with the SAME browser / device (carrying Cycle 1 session token) scans the QR code
    // The query param simulates a browser presenting its existing session token
    const scan2 = await httpRequest(`/api/scan/device/gg_token_iphone_xr?finderToken=${cycle1FinderSessionToken}`);
    assert(scan2.data?.success, 'Cycle 2: QR scan succeeds with old finder session token');
    assert(scan2.data?.missingReport?.id === cycle2MissingId, 'Cycle 2: Scan returns new incident missingReport.id');
    assert(scan2.data?.activeFinderSession === null, 'Cycle 2: Old Cycle 1 session does NOT lock the finder into an active session for Cycle 2!');

    // 1.8 Cycle 2: Same finder can submit a NEW found report for Cycle 2
    const fndRep2 = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_token_iphone_xr',
        gadgetId: 'gdt_test_iphone',
        finderName: 'Maria Santos',
        foundLocation: 'Gym Bleachers Row 3',
        turnInMethod: 'KEPT_SAFE',
        message: 'Found your iPhone again in the gym!'
      }
    });
    assert(fndRep2.data?.success, 'Cycle 2: Finder successfully created a NEW found report without getting stuck');
    const cycle2ChatId = fndRep2.data?.chat?.id;
    const cycle2FinderSessionToken = fndRep2.data?.chat?.finderSessionToken;
    const cycle2FoundReportId = fndRep2.data?.report?.id;

    assert(Boolean(cycle2ChatId) && cycle2ChatId !== cycle1ChatId, `Cycle 2: Distinct recovery chat created: ${cycle2ChatId}`);
    assert(Boolean(cycle2FoundReportId) && cycle2FoundReportId !== cycle1FoundReportId, `Cycle 2: Distinct found report created: ${cycle2FoundReportId}`);
    assert(fndRep2.data?.chat?.missingReportId === cycle2MissingId, 'Cycle 2: Chat correctly bound to cycle 2 missingReportId');

    // 1.9 Database Check: Verify Cycle 1 report and chat are still intact and uncorrupted
    const dbRaw = JSON.parse(fs.readFileSync(path.join(TEMP_DATA_DIR, 'database.json'), 'utf8'));
    const oldFoundReport = dbRaw.found_reports.find(f => f.id === cycle1FoundReportId);
    const newFoundReport = dbRaw.found_reports.find(f => f.id === cycle2FoundReportId);
    assert(Boolean(oldFoundReport), 'DB Preservation: Cycle 1 found report remains intact');
    assert(Boolean(newFoundReport), 'DB Preservation: Cycle 2 found report exists alongside Cycle 1');
    assert(oldFoundReport.missingReportId === cycle1MissingId, 'DB Preservation: Cycle 1 report retained original missingReportId');
    assert(newFoundReport.missingReportId === cycle2MissingId, 'DB Preservation: Cycle 2 report has new missingReportId');

    const oldChatInDb = dbRaw.recovery_chats.find(c => c.id === cycle1ChatId);
    const newChatInDb = dbRaw.recovery_chats.find(c => c.id === cycle2ChatId);
    assert(Boolean(oldChatInDb), 'DB Preservation: Cycle 1 chat remains intact');
    assert(Boolean(newChatInDb), 'DB Preservation: Cycle 2 chat exists independently');

    console.log('\n--- BUG 2 TEST: KEEP SAFE -> SURRENDER TRANSITION & WARNING FLOW ---');

    // 2.1 Owner checks gadgets before surrender transition
    const ownerGadgetsBefore = await httpRequest('/api/gadgets/my', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    const gBeforeSurrender = ownerGadgetsBefore.data?.gadgets?.find(g => g.id === 'gdt_test_iphone');
    assert(Boolean(gBeforeSurrender?.finderInfo), 'Before Transition: Owner sees active finderInfo');
    assert(gBeforeSurrender?.finderInfo?.chatId === cycle2ChatId, 'Before Transition: finderInfo points to Cycle 2 active chat');
    assert(gBeforeSurrender?.surrenderInfo === null, 'Before Transition: surrenderInfo is null');

    // 2.2 Verify client confirmation behavior contract:
    // In public/device/index.html:
    // - confirmSurrenderTransition() prompts SweetAlert with warning
    // - Cancel returns false and leaves chat completely unchanged
    // - Confirm triggers executeSurrenderToOsaSubmission()
    const deviceHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'device', 'index.html'), 'utf8');
    assert(deviceHtml.includes('confirmSurrenderTransition()'), 'UI Contract: confirmSurrenderTransition function present in device/index.html');
    assert(deviceHtml.includes('permanently close your conversation'), 'UI Contract: Confirmation modal has warning about permanent chat closure');
    assert(deviceHtml.includes('Cancel (Keep Chat Active)'), 'UI Contract: Modal offers explicit cancel option to keep chat active');
    assert(deviceHtml.includes('handleKeepSafeToSurrenderTransition'), 'UI Contract: handleKeepSafeToSurrenderTransition wired up');
    assert(deviceHtml.includes('id="finder-chat-surrender-option"'), 'UI Contract: Surrender button option exists inside finder chat modal');

    // 2.3 Finder confirms transition to Surrender: Calls /api/finder/report with SUBMITTED_TO_OSA
    const surrenderTransitionRes = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_token_iphone_xr',
        gadgetId: 'gdt_test_iphone',
        finderSessionToken: cycle2FinderSessionToken,
        chatId: cycle2ChatId,
        finderName: 'Maria Santos',
        foundLocation: 'Gym Bleachers Row 3',
        turnInMethod: 'SUBMITTED_TO_OSA',
        message: 'Decided to leave device with guard/OSA instead.'
      }
    });
    assert(surrenderTransitionRes.data?.success, 'Transition: Surrender report successfully submitted');
    const surrenderRef = surrenderTransitionRes.data?.surrenderReference;
    assert(Boolean(surrenderRef) && surrenderRef.startsWith('SRF-'), `Transition: Surrender reference issued: ${surrenderRef}`);

    // 2.4 Verify backend state after surrender transition
    const dbAfterSurrender = JSON.parse(fs.readFileSync(path.join(TEMP_DATA_DIR, 'database.json'), 'utf8'));
    const cycle2ChatAfter = dbAfterSurrender.recovery_chats.find(c => c.id === cycle2ChatId);
    assert(cycle2ChatAfter?.status === 'CLOSED', 'Transition: Recovery chat status is CLOSED');
    assert(cycle2ChatAfter?.closedReason === 'SURRENDERED_TO_OSA', 'Transition: Recovery chat closedReason is SURRENDERED_TO_OSA');
    
    // Check system message added to chat
    const sysMsg = cycle2ChatAfter?.messages?.find(m => m.senderRole === 'SYSTEM');
    assert(Boolean(sysMsg), 'Transition: System message added to chat audit log');
    assert(sysMsg?.messageText?.includes('Awaiting OSA Handover'), 'Transition: System message specifies Awaiting OSA Handover');

    // Check gadget status: Device remains MISSING, custody status is PENDING_OSA_TURNOVER
    const gadgetAfterTransition = dbAfterSurrender.gadgets.find(g => g.id === 'gdt_test_iphone');
    assert(gadgetAfterTransition?.status === 'MISSING', 'Custody Safety: Gadget status remains MISSING (not recovered)');
    assert(gadgetAfterTransition?.custodyStatus === 'PENDING_OSA_TURNOVER', 'Custody Safety: custodyStatus is PENDING_OSA_TURNOVER');
    assert(gadgetAfterTransition?.surrenderStatus === 'WILL_SURRENDER_TO_OSA', 'Custody Safety: surrenderStatus is WILL_SURRENDER_TO_OSA');
    assert(gadgetAfterTransition?.surrenderInfo?.status === 'AWAITING OSA HANDOVER', 'Custody Safety: surrenderInfo status is AWAITING OSA HANDOVER');

    console.log('\n--- BUG 3 TEST: OWNER CHAT UI / MESSAGING & CLOSED HISTORY ---');

    // 3.1 Owner fetches /api/gadgets/my
    const ownerGadgetsAfter = await httpRequest('/api/gadgets/my', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    const gAfter = ownerGadgetsAfter.data?.gadgets?.find(g => g.id === 'gdt_test_iphone');

    // Chat must be removed from owner's active chats
    assert(gAfter?.finderInfo === null, 'Owner View: finderInfo is NULL (chat removed from active chats)');
    
    // Surrender info is present with AWAITING OSA HANDOVER
    assert(Boolean(gAfter?.surrenderInfo), 'Owner View: surrenderInfo is populated');
    assert(gAfter?.surrenderInfo?.status === 'AWAITING OSA HANDOVER', 'Owner View: surrender status is AWAITING OSA HANDOVER');

    // Closed chat info is present for viewing closed history
    assert(Boolean(gAfter?.closedChatInfo), 'Owner View: closedChatInfo is populated for historical access');
    assert(gAfter?.closedChatInfo?.chatId === cycle2ChatId, 'Owner View: closedChatInfo references Cycle 2 chat');
    assert(gAfter?.closedChatInfo?.closedReason === 'SURRENDERED_TO_OSA', 'Owner View: closedChatInfo closedReason is SURRENDERED_TO_OSA');

    // 3.2 Owner checks chat details via GET /api/chat/by-gadget/:gadgetId
    const chatByGadgetRes = await httpRequest('/api/chat/by-gadget/gdt_test_iphone', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert(chatByGadgetRes.data?.success, 'Owner Chat: GET /api/chat/by-gadget succeeds');
    assert(chatByGadgetRes.data?.chat?.isClosed === true, 'Owner Chat: isClosed is true');
    assert(chatByGadgetRes.data?.chat?.closedReason === 'SURRENDERED_TO_OSA', 'Owner Chat: closedReason is SURRENDERED_TO_OSA');

    // 3.3 Owner attempts to send a message to the surrendered chat
    const ownerSendAttempt = await httpRequest(`/api/chat/${cycle2ChatId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: { text: 'Can you still meet me?' }
    });
    assert(ownerSendAttempt.statusCode === 400, 'Messaging: Owner message to surrendered chat rejected with 400');
    assert(
      ownerSendAttempt.data?.error === 'The finder has decided to surrender your gadget to OSA. Awaiting physical handover.',
      `Messaging: Exact required error returned: "${ownerSendAttempt.data?.error}"`
    );

    // 3.4 Finder attempts to send a message to the surrendered chat
    const finderSendAttempt = await httpRequest(`/api/chat/${cycle2ChatId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': cycle2FinderSessionToken
      },
      body: {
        text: 'Where are you?'
      }
    });
    assert(finderSendAttempt.statusCode === 400, 'Messaging: Finder message to surrendered chat rejected with 400');
    assert(
      finderSendAttempt.data?.error === 'The finder has decided to surrender your gadget to OSA. Awaiting physical handover.',
      `Messaging: Exact required error returned to finder: "${finderSendAttempt.data?.error}"`
    );

    // 3.5 Check student UI code for exact messaging and NO misleading "Recovered" / "Returned" statements
    const studentJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'student', 'student.js'), 'utf8');
    assert(
      studentJs.includes('The finder has decided to surrender your gadget to OSA. Awaiting physical handover.'),
      'UI Verification: student.js includes exact required message'
    );
    assert(
      studentJs.includes('View Closed Conversation (Read-Only)'),
      'UI Verification: student.js offers read-only access to closed conversation'
    );
    assert(
      studentJs.includes('🔒 The finder has decided to surrender your gadget to OSA. Awaiting physical handover.'),
      'UI Verification: owner chat banner shows exact required handover warning'
    );

    // Check student/index.html banner fallback
    const studentHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'student', 'index.html'), 'utf8');
    assert(!studentHtml.includes('🔒 This recovery conversation is closed because the gadget has been marked recovered or returned.'), 'UI Verification: Static HTML fallback does not prematurely claim gadget was recovered or returned');

    console.log('\n--- TASK 1 & 2 UI CLEANUP REGRESSION TESTS ---');
    // Task 1: Confirm duplicate Safety Notice is removed from Student Portal Lost Status page
    assert(!studentJs.includes('<!-- Safety & Liability Notice (Section G & H) -->'), 'Task 1: Duplicate Safety & Liability Notice removed from loadLostStatusScreen in student.js');
    assert(studentHtml.includes('Safety &amp; Liability Notice'), 'Task 1: Safety & Liability Notice preserved inside the Finder–Owner Chat modal');

    // Task 2: Confirm Campus Hotspots & Telemetry section is completely removed from OSA Reports
    const osaHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'index.html'), 'utf8');
    const reportsSection = osaHtml.substring(osaHtml.indexOf('id="osa-screen-reports"'), osaHtml.indexOf('id="osa-screen-audit"'));
    assert(!reportsSection.includes('Verified Campus Recovery Hotspots & Telemetry'), 'Task 2: Hotspots section heading completely removed from OSA Reports');
    assert(!reportsSection.includes('High-traffic recovery zones monitored by NCST campus security officers'), 'Task 2: Hotspots description removed');
    assert(!reportsSection.includes('100% Recovery Rate'), 'Task 2: Section-specific 100% Recovery Rate badge removed');
    assert(!reportsSection.includes('University Library') && !reportsSection.includes('Student Pavilion') && !reportsSection.includes('Gymnasium Bleachers') && !reportsSection.includes('Computer Science Labs'), 'Task 2: Predefined campus zones table completely removed from reports');
    
    // Task 2: Confirm legitimate reporting and print/export functions remain intact
    assert(reportsSection.includes('Campus Asset Security Analytics & Recovery Report'), 'Task 2: Analytics & Recovery Report title intact');
    assert(reportsSection.includes('Device Inventory by Category'), 'Task 2: Category breakdown chart intact');
    assert(reportsSection.includes('Asset Recovery Status Breakdown'), 'Task 2: Status breakdown chart intact');
    assert(reportsSection.includes('exportAnalyticsSummary()'), 'Task 2: Export Summary button intact');
    assert(reportsSection.includes('window.print()'), 'Task 2: Print Executive Report button intact');
    assert(reportsSection.includes('report-certified-footer'), 'Task 2: Official Institutional Certification Footer intact');

    // 3.6 Verify OSA claims desk does NOT prematurely show item before OSA physical intake
    const claimsBeforeIntake = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const prematureClaim = claimsBeforeIntake.data?.claims?.find(c => c.gadgetId === 'gdt_test_iphone' && c.isInCustody === true);
    assert(prematureClaim === undefined, 'Custody Safety: Gadget is NOT in Ready for Claim before OSA physical intake');

    console.log('\n--- OSA CONFIRMS PHYSICAL RECEIPT & COMPLETES CYCLE 2 ---');
    // 3.7 OSA physically intakes gadget into custody
    const intake2 = await httpRequest('/api/finder/gdt_test_iphone/receive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        custodyLocation: 'OSA Locker C-05',
        notes: 'Maria Santos turned in gadget at OSA counter.'
      }
    });
    assert(intake2.data?.success, 'OSA physical intake succeeds');

    // 3.8 Gadget now appears in Claims desk
    const claimsAfterIntake = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const activeClaim2 = claimsAfterIntake.data?.claims?.find(c => c.gadgetId === 'gdt_test_iphone' && c.isInCustody === true);
    assert(Boolean(activeClaim2), 'Claims: Gadget now legitimately appears in Ready for Claim');
    assert(activeClaim2?.custodyLocation === 'OSA Locker C-05', 'Claims: Vault location matches Locker C-05');

    // 3.9 Complete Cycle 2 return
    const return2 = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        claimId: activeClaim2.id,
        receivedByPersonName: 'Thirdy Manaog Test',
        receivedByPersonId: '2024-TEST-01',
        notes: 'Cycle 2 return complete with photo verification.',
        handoverPhotoUrl: '/uploads/cycle2_proof.jpg'
      }
    });
    assert(return2.data?.success, 'Return: Cycle 2 handover return completed successfully');

    // 3.10 Final Audit: Both cycles have preserved historical returns and chats
    const finalClaims = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const returnedItems = finalClaims.data?.claims?.filter(c => c.status === 'RETURNED' || Boolean(c.returnRecord));
    assert(returnedItems.length === 2, 'History Preservation: Both Cycle 1 and Cycle 2 returns preserved in Returned History');

    const finalDb = JSON.parse(fs.readFileSync(path.join(TEMP_DATA_DIR, 'database.json'), 'utf8'));
    assert(finalDb.recovery_chats.length === 2, 'History Preservation: Both Cycle 1 and Cycle 2 chats preserved in database');
    assert(finalDb.found_reports.length === 2, 'History Preservation: Both Cycle 1 and Cycle 2 found reports preserved in database');

  } finally {
    // Gracefully stop isolated test server
    console.log('\n🧹 Shutting down isolated test server on port 3999...');
    serverProcess.kill();
    await new Promise(r => setTimeout(r, 600));

    // Clean up temporary test data directory
    if (fs.existsSync(TEMP_DATA_DIR)) {
      fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
    }
    console.log('🧹 Cleaned up temporary test data directory');

    // Verify original database hash after test
    const finalDbHash = getFileSha256(ORIGINAL_DB_PATH);
    console.log(`🔒 Final original database hash:   ${finalDbHash}`);
    assert(initialDbHash === finalDbHash, 'SAFETY VERIFICATION: Original database.json was 100% UNCHANGED');
  }

  console.log('\n========================================================================');
  console.log(`TEST RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
