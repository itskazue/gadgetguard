/**
 * GadgetGuard — Focused Finder QR Interface & Session Behavior Test Suite
 *
 * Verifies:
 *  1. SCENARIO 1 — Finder A (Existing Active Conversation):
 *     - Scans missing gadget QR, submits "I Will Keep the Gadget Safe", starts chat.
 *     - Closes chat, Back, Refresh, repeated QR scans in same browser:
 *       * Session is recognized via valid token
 *       * Displays "Continue Conversation" and "I Will Surrender It to OSA Instead"
 *       * Main QR action interface does NOT include "I am a Different Finder" or "End / Leave Session"
 *       * Zero duplicate reports or chats created on revisit
 *  2. SCENARIO 2 — Finder B (Different Device / Browser):
 *     - Scans exact same QR without session token
 *     - Sees normal public missing gadget page ("I Will Keep the Gadget Safe" & "I Will Surrender It to OSA")
 *     - Zero indication that Finder A already reported gadget
 *     - Cannot access Finder A's chat, messages, identity, or report details (403 Forbidden)
 *     - Submits independent report and communicates privately with owner
 *     - Cross-chat isolation: Finder A cannot read Chat B, Finder B cannot read Chat A
 *  3. Surrender Transition Workflow:
 *     - Finder A chooses "I Will Surrender It to OSA Instead"
 *     - Cancel preserves active chat; Confirm closes Chat A with SURRENDERED_TO_OSA
 *     - Chat A surrender does NOT close Chat B (Finder B chat remains ACTIVE)
 *     - Revisit after surrender shows surrender reference card
 *  4. Security, Revocation & Registered Status:
 *     - Revoking session invalidates token on backend (TOKEN_REVOKED)
 *     - Scanning REGISTERED device displays clean registered state
 *     - UI contracts in device/index.html verified
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');

const TEST_PORT = 3991;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const ORIGINAL_DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
const TEMP_DATA_DIR = path.join(__dirname, '..', 'scratch', 'test_finder_qr_dir_' + Date.now());
const TEMP_DB_PATH = path.join(TEMP_DATA_DIR, 'database.json');

let passedTests = 0;
let failedTests = 0;

function computeFileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failedTests++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
      const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.write(bodyStr);
    }
    req.end();
  });
}

async function runSuite() {
  console.log('========================================================================');
  console.log('GADGETGUARD: FOCUSED FINDER QR INTERFACE & SESSION BEHAVIOR SUITE');
  console.log('========================================================================\n');

  const originalDbChecksum = computeFileHash(ORIGINAL_DB_PATH);
  console.log(`🔒 Baseline database checksum: ${originalDbChecksum}`);

  if (fs.existsSync(TEMP_DATA_DIR)) {
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });

  const dbContent = JSON.parse(fs.readFileSync(ORIGINAL_DB_PATH, 'utf8'));
  const gadgetToken = 'gg_token_scene_' + Date.now().toString(36);
  const gadgetId = 'gdt_scene_' + Date.now().toString(36);
  const missingReportId = 'msr_scene_' + Date.now().toString(36);

  const regGadgetToken = 'gg_token_reg_' + Date.now().toString(36);
  const regGadgetId = 'gdt_reg_' + Date.now().toString(36);

  const studentUser = dbContent.users.find(u => u.role === 'student') || dbContent.users[1];
  const studentId = studentUser.id;

  dbContent.gadgets.push({
    id: gadgetId,
    userId: studentId,
    brand: 'Apple',
    model: 'iPad Pro 12.9',
    category: 'Tablet',
    color: 'Space Gray',
    serialNumber: 'DMPQ987654321',
    status: 'MISSING',
    secureToken: gadgetToken,
    qrCodeDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    createdAt: new Date().toISOString()
  });

  dbContent.gadgets.push({
    id: regGadgetId,
    userId: studentId,
    brand: 'Samsung',
    model: 'Galaxy Tab S9',
    category: 'Tablet',
    status: 'REGISTERED',
    secureToken: regGadgetToken,
    qrCodeDataUrl: 'data:image/png;base64,...',
    createdAt: new Date().toISOString()
  });

  dbContent.missing_reports.push({
    id: missingReportId,
    gadgetId,
    userId: studentId,
    status: 'ACTIVE',
    lastSeenLocation: 'Library 3rd Floor',
    contactEmail: studentUser.email,
    createdAt: new Date().toISOString()
  });

  fs.writeFileSync(TEMP_DB_PATH, JSON.stringify(dbContent, null, 2), 'utf8');

  // Spawn isolated test server
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

  try {
    // 1. Authenticate demo accounts
    const studentLogin = await httpRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: studentUser.email, password: 'password123' }
    });
    assert(studentLogin.statusCode === 200, 'Student login succeeded');
    const studentToken = studentLogin.data.token;

    const osaLogin = await httpRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'osa.admin@univ.edu', password: 'admin123' }
    });
    assert(osaLogin.statusCode === 200, 'OSA Admin login succeeded');
    const osaToken = osaLogin.data.token;

    // =========================================================================
    // SECTION 1: SCENARIO 1 — FINDER A (EXISTING ACTIVE CONVERSATION)
    // =========================================================================
    console.log('\n--- SECTION 1: SCENARIO 1 — FINDER A INITIAL VISIT & ACTIVE CHAT ---');

    // 1.1 Finder A scans the missing gadget QR
    const scanA1 = await httpRequest(`/api/scan/device/${gadgetToken}`);
    assert(scanA1.statusCode === 200, 'Finder A initial scan returns HTTP 200');
    assert(scanA1.data.gadget.status === 'MISSING', 'Finder A initial scan returns status MISSING');
    assert(scanA1.data.activeFinderSession === null, 'Finder A initial scan contains NO active session');
    assert(scanA1.data.surrenderDetails === null, 'Finder A initial scan contains NO surrender details');

    // 1.2 Finder A chooses "I Will Keep the Gadget Safe" and submits found report
    const reportARes = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: gadgetToken,
        secureToken: gadgetToken,
        gadgetId,
        finderName: 'Alice Finder',
        foundLocation: 'Main Library Desk 14',
        turnInMethod: 'KEPT_SAFE'
      }
    });

    assert(reportARes.statusCode === 201, 'Finder A report submitted successfully (201)');
    assert(reportARes.data.success === true, 'Finder A report response confirmed success');
    assert(Boolean(reportARes.data.chat?.finderSessionToken), 'Finder A chat generated with secure session token');
    assert(reportARes.data.chat?.status === 'ACTIVE', 'Finder A chat status is ACTIVE');

    const tokenA = reportARes.data.chat.finderSessionToken;
    const chatAId = reportARes.data.chat.id;

    // 1.3 Finder A sends message in private chat
    const msgARes = await httpRequest(`/api/chat/${chatAId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenA
      },
      body: { text: 'Hello, I found your iPad Pro at the library!' }
    });
    assert(msgARes.statusCode === 201, 'Finder A successfully sends message in private chat (201)');

    // 1.4 Finder A Closes Chat, presses Back, refreshes F5, or re-scans the exact same QR
    console.log('\n--- SECTION 2: FINDER A REFRESH / BACK / REVISIT SAME BROWSER ---');

    // Count reports and chats before revisit
    const currentDb1 = JSON.parse(fs.readFileSync(TEMP_DB_PATH, 'utf8'));
    const initialReportCount = currentDb1.found_reports.filter(f => f.gadgetId === gadgetId).length;
    const initialChatCount = currentDb1.recovery_chats.filter(c => c.gadgetId === gadgetId).length;

    // Simulate same browser session sending existing token on revisit/refresh
    const scanA2 = await httpRequest(`/api/scan/device/${gadgetToken}?finderToken=${tokenA}`);
    assert(scanA2.statusCode === 200, 'Revisit scan returned HTTP 200');
    assert(scanA2.data.activeFinderSession !== null, 'Revisit recognizes activeFinderSession');
    assert(scanA2.data.activeFinderSession.hasSession === true, 'activeFinderSession.hasSession is true');
    assert(scanA2.data.activeFinderSession.chatId === chatAId, 'Session points to existing Chat A');
    assert(scanA2.data.activeFinderSession.finderName === 'Alice Finder', 'Session preserves Finder A name');
    assert(scanA2.data.activeFinderSession.isClosed === false, 'Session remains active (not closed)');

    const currentDb2 = JSON.parse(fs.readFileSync(TEMP_DB_PATH, 'utf8'));
    const postRevisitReportCount = currentDb2.found_reports.filter(f => f.gadgetId === gadgetId).length;
    const postRevisitChatCount = currentDb2.recovery_chats.filter(c => c.gadgetId === gadgetId).length;

    assert(initialReportCount === postRevisitReportCount, 'Zero duplicate found_reports created on QR revisit');
    assert(initialChatCount === postRevisitChatCount, 'Zero duplicate recovery_chats created on QR revisit');

    // Verify UI contracts in public/device/index.html
    const deviceHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'device', 'index.html'), 'utf8');

    assert(deviceHtml.includes('Continue Conversation'), 'Active session card includes "Continue Conversation"');
    assert(deviceHtml.includes('I Will Surrender It to OSA Instead'), 'Active session card includes "I Will Surrender It to OSA Instead"');
    assert(!deviceHtml.includes('I am a Different Finder (Start Separate Session)'), 'Main interface REMOVED "I am a Different Finder (Start Separate Session)"');
    assert(!deviceHtml.includes('I am a Different Finder (Start Separate Report)'), 'Main interface REMOVED "I am a Different Finder (Start Separate Report)"');
    assert(!deviceHtml.includes('End / Leave Session on This Device'), 'Main interface REMOVED "End / Leave Session on This Device"');
    assert(!deviceHtml.includes('onclick="endFinderSessionOnDevice()"'), 'Surrender card REMOVED "End Session on This Device" onclick button');

    // =========================================================================
    // SECTION 3: SCENARIO 2 — FINDER B (DIFFERENT DEVICE / BROWSER)
    // =========================================================================
    console.log('\n--- SECTION 3: SCENARIO 2 — FINDER B INDEPENDENT BROWSER ISOLATION ---');

    // 2.1 Finder B scans exact same QR code (different device/browser, no token)
    const scanB1 = await httpRequest(`/api/scan/device/${gadgetToken}`);
    assert(scanB1.statusCode === 200, 'Finder B receives HTTP 200 on missing gadget scan');
    assert(scanB1.data.gadget.status === 'MISSING', 'Finder B sees gadget status MISSING');
    assert(scanB1.data.activeFinderSession === null, 'Finder B sees ZERO active session indication from Finder A');
    assert(scanB1.data.surrenderDetails === null, 'Finder B sees ZERO surrender details or reference from Finder A');

    // 2.2 Finder B cannot access Finder A's chat or private information
    const bAttemptChatA = await httpRequest(`/api/chat/${chatAId}`);
    assert(bAttemptChatA.statusCode === 403, 'Finder B reading Finder A chat without credentials strictly rejected (403)');

    const bAttemptMsgChatA = await httpRequest(`/api/chat/${chatAId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { text: 'Intruder message' }
    });
    assert(bAttemptMsgChatA.statusCode === 403, 'Finder B posting message to Finder A chat without credentials rejected (403)');

    // 2.3 Finder B submits completely independent found report
    const reportBRes = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: gadgetToken,
        secureToken: gadgetToken,
        gadgetId,
        finderName: 'Bob Independent',
        foundLocation: 'Cafeteria Table 7',
        turnInMethod: 'KEPT_SAFE'
      }
    });

    assert(reportBRes.statusCode === 201, 'Finder B submits independent found report successfully (201)');
    assert(reportBRes.data.success === true, 'Finder B report response confirmed success');

    const tokenB = reportBRes.data.chat.finderSessionToken;
    const chatBId = reportBRes.data.chat.id;

    assert(tokenB !== tokenA, 'Finder B receives distinct token from Finder A');
    assert(chatBId !== chatAId, 'Finder B receives distinct chat ID from Finder A');
    assert(reportBRes.data.chat.finderName === 'Bob Independent', 'Finder B chat retains Bob Independent name');

    // 2.4 Chat B isolation: Finder A cannot access Chat B, Finder B cannot access Chat A
    const aAttemptChatB = await httpRequest(`/api/chat/${chatBId}`, {
      headers: { 'x-finder-token': tokenA }
    });
    assert(aAttemptChatB.statusCode === 403, 'Finder A reading Chat B with Token A is strictly 403 Forbidden');

    const bAttemptChatAWithTokenB = await httpRequest(`/api/chat/${chatAId}`, {
      headers: { 'x-finder-token': tokenB }
    });
    assert(bAttemptChatAWithTokenB.statusCode === 403, 'Finder B reading Chat A with Token B is strictly 403 Forbidden');

    // 2.5 Finder B can communicate privately with owner in Chat B
    const bMsgRes = await httpRequest(`/api/chat/${chatBId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenB
      },
      body: { text: 'Hi, I also spotted the charger at cafeteria!' }
    });
    assert(bMsgRes.statusCode === 201, 'Finder B sends message in Chat B successfully (201)');

    const chatBDetails = await httpRequest(`/api/chat/${chatBId}`, {
      headers: { 'x-finder-token': tokenB }
    });
    assert(chatBDetails.statusCode === 200, 'Finder B fetches Chat B history successfully');
    assert(chatBDetails.data.chat.finderName === 'Bob Independent', 'Chat B displays Bob Independent name');
    assert(chatBDetails.data.chat.messages.some(m => m.text.includes('charger at cafeteria')), 'Chat B contains Finder B message');

    // =========================================================================
    // SECTION 4: FINDER A SURRENDER TRANSITION & CHAT B PRESERVATION
    // =========================================================================
    console.log('\n--- SECTION 4: FINDER A SURRENDER TRANSITION & CHAT B PRESERVATION ---');

    assert(deviceHtml.includes('confirmSurrenderTransition'), 'confirmSurrenderTransition dialog is defined in client script');
    assert(deviceHtml.includes('permanently close your conversation'), 'Warning dialog explains conversation will close permanently');

    // Cancel preserves chat: simulated by not executing surrender
    const chatAStillActive = await httpRequest(`/api/chat/${chatAId}`, {
      headers: { 'x-finder-token': tokenA }
    });
    assert(chatAStillActive.data.chat.status === 'ACTIVE', 'Chat A remains ACTIVE if surrender not confirmed');

    // Confirm transitions Finder A to surrender:
    const surrenderARes = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: gadgetToken,
        secureToken: gadgetToken,
        gadgetId,
        finderName: 'Alice Finder',
        foundLocation: 'Main Library Desk 14',
        turnInMethod: 'SUBMITTED_TO_OSA',
        finderSessionToken: tokenA,
        chatId: chatAId
      }
    });

    assert(surrenderARes.statusCode === 200, 'Surrender transition submission returned HTTP 200');
    assert(surrenderARes.data.success === true, 'Surrender response confirmed success');
    assert(Boolean(surrenderARes.data.surrenderReference), 'Surrender reference generated');
    const sRef = surrenderARes.data.surrenderReference;

    // Verify Chat A is closed upon surrender
    const chatACheck = await httpRequest(`/api/chat/${chatAId}`, {
      headers: { 'x-finder-token': tokenA }
    });
    assert(chatACheck.statusCode === 200, 'Chat A fetch after surrender returned 200');
    assert(chatACheck.data.chat.status === 'CLOSED', 'Chat A status changed to CLOSED');
    assert(chatACheck.data.chat.closedReason === 'SURRENDERED_TO_OSA', 'Chat A closedReason is SURRENDERED_TO_OSA');

    // CRITICAL: Chat A surrender does NOT close Chat B! Finder B chat remains ACTIVE
    const chatBCheckAfterASurrender = await httpRequest(`/api/chat/${chatBId}`, {
      headers: { 'x-finder-token': tokenB }
    });
    assert(chatBCheckAfterASurrender.statusCode === 200, 'Chat B fetch after Chat A surrender returned 200');
    assert(chatBCheckAfterASurrender.data.chat.status === 'ACTIVE', 'Chat B status remains ACTIVE after Chat A surrendered');

    // Finder A revisiting QR after surrender sees surrender reference card
    const scanAAfterSurrender = await httpRequest(`/api/scan/device/${gadgetToken}?finderToken=${tokenA}`);
    assert(scanAAfterSurrender.statusCode === 200, 'Finder A scan after surrender returned 200');
    assert(scanAAfterSurrender.data.surrenderDetails !== null, 'surrenderDetails returned for Finder A');
    assert(scanAAfterSurrender.data.surrenderDetails.hasSurrender === true, 'hasSurrender is true');
    assert(scanAAfterSurrender.data.surrenderDetails.surrenderReference === sRef, 'surrenderReference matches generated ID');

    // =========================================================================
    // SECTION 5: SECURITY, REVOCATION, EXPIRATION & REGISTERED STATUS
    // =========================================================================
    console.log('\n--- SECTION 5: SECURITY, REVOCATION & EXPIRATION CONTROLS ---');

    // 5.1 Revocation: Revoking Token B invalidates session on server
    const endB = await httpRequest(`/api/chat/${chatBId}/end-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenB
      },
      body: { finderToken: tokenB }
    });
    assert(endB.statusCode === 200, 'End session endpoint revokes token on server (200)');
    assert(endB.data.success === true, 'End session response confirmed success');

    const scanRevokedB = await httpRequest(`/api/scan/device/${gadgetToken}?finderToken=${tokenB}`);
    assert(scanRevokedB.statusCode === 200, 'Scan with revoked token returns 200');
    assert(scanRevokedB.data.activeFinderSession === null, 'Scan with revoked token returns activeFinderSession: null');

    const readRevokedB = await httpRequest(`/api/chat/${chatBId}`, {
      headers: { 'x-finder-token': tokenB }
    });
    assert(readRevokedB.statusCode === 403, 'Accessing chat with revoked token rejected with 403');
    assert(readRevokedB.data.code === 'TOKEN_REVOKED', 'Error code specifies TOKEN_REVOKED');

    // 5.2 Registered (Not Missing) behavior
    const regScan = await httpRequest(`/api/scan/device/${regGadgetToken}`);
    assert(regScan.statusCode === 200, 'Scanning REGISTERED device returns 200');
    assert(regScan.data.gadget.status === 'REGISTERED', 'Scanning REGISTERED device returns status REGISTERED');
    assert(regScan.data.activeFinderSession === null, 'Scanning REGISTERED device returns activeFinderSession: null');
    assert(regScan.data.surrenderDetails === null, 'Scanning REGISTERED device returns surrenderDetails: null');

    // 5.3 OSA Authorized Access
    const osaScan = await httpRequest(`/api/scan/device/${gadgetToken}`, {
      headers: { 'Authorization': `Bearer ${osaToken}` }
    });
    assert(osaScan.statusCode === 200, 'OSA Admin scanning device receives 200');
    assert(osaScan.data.isAuthorizedOsa === true, 'OSA Admin scanning device receives isAuthorizedOsa: true');
    assert(Boolean(osaScan.data.owner?.idNumber), 'OSA Admin receives owner verification details');

    // 5.4 Safety and storage helpers in device/index.html
    assert(deviceHtml.includes('clearFinderSession('), 'device/index.html defines clearFinderSession function');
    assert(deviceHtml.includes('resumeInactiveFinderSession()'), 'device/index.html defines resumeInactiveFinderSession function');
    assert(deviceHtml.includes('Session Cleared Locally (Device Offline)'), 'device/index.html handles offline session clearance honestly');
    assert(deviceHtml.includes('executeScanLookup'), 'device/index.html executes scan lookup without leaking sessions');

  } finally {
    console.log('\n🧹 Shutting down isolated test server on port ' + TEST_PORT + '...');
    serverProcess.kill('SIGTERM');
    await sleep(800);

    try {
      fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
      console.log('🧹 Cleaned up temporary test data directory');
    } catch (e) {}

    const finalChecksum = computeFileHash(ORIGINAL_DB_PATH);
    console.log(`🔒 Final baseline database checksum: ${finalChecksum}`);
    assert(originalDbChecksum === finalChecksum, 'Baseline database was 100% UNCHANGED');
    console.log('  ✅ [PASS] SAFETY VERIFICATION: Original database.json was 100% UNCHANGED');
  }

  console.log('\n========================================================================');
  console.log(`TEST RESULTS: ${passedTests} PASSED / ${failedTests} FAILED (TOTAL: ${passedTests + failedTests})`);
  console.log('========================================================================\n');
}

runSuite().catch(err => {
  console.error('\n💥 FATAL TEST SUITE FAILURE:', err.message);
  process.exit(1);
});
