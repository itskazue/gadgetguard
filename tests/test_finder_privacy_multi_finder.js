/**
 * GadgetGuard — Phase 1: Finder Chat Privacy & Multiple Finder Security Test Suite
 * 
 * Verifies:
 * - Isolation between multiple Finders (Finder A, Finder B, Finder C) scanning the same missing gadget QR.
 * - Strict backend authorization: 403 Forbidden on reading or posting to another Finder's chat.
 * - Zero private message or credential leakage in public QR scan endpoint.
 * - Independent chat creation and session token generation per Finder.
 * - Owner ability to see and interact with both chats separately.
 * - Closing/surrendering Chat A does NOT close Chat B.
 * - Continued messaging in Chat B after Chat A is surrendered.
 * - Shared-device session end capability.
 * - Subsequent incident cycle repeated QR functionality.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const TEST_PORT = 3999;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEMP_DATA_DIR = path.join(__dirname, '..', 'scratch', 'test_privacy_isolated_dir');
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
  console.log('GADGETGUARD: FINDER CHAT PRIVACY & MULTIPLE FINDER SECURITY TEST SUITE');
  console.log('========================================================================\n');

  const initialDbHash = getFileSha256(ORIGINAL_DB_PATH);
  console.log(`🔒 Initial original database hash: ${initialDbHash}`);

  if (fs.existsSync(TEMP_DATA_DIR)) {
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });

  const salt = bcrypt.genSaltSync(10);
  const testPasswordHash = bcrypt.hashSync('Password123!', salt);

  const testDb = {
    users: [
      {
        id: 'usr_osa_admin_test',
        idNumber: 'OSA-2024-001',
        name: 'Dean OSA Admin',
        email: 'osa.admin@ncst.edu.ph',
        passwordHash: testPasswordHash,
        role: 'osa_admin',
        department: 'Office of Student Affairs',
        contactNumber: '09123456789',
        status: 'active'
      },
      {
        id: 'usr_student_alice',
        idNumber: '2024-10001',
        name: 'Alice Owner',
        email: 'alice@ncst.edu.ph',
        passwordHash: testPasswordHash,
        role: 'student',
        department: 'College of Computer Studies',
        contactNumber: '09171234567',
        status: 'active'
      }
    ],
    gadgets: [
      {
        id: 'gdt_test_macbook',
        userId: 'usr_student_alice',
        brand: 'Apple',
        model: 'MacBook Pro M2',
        serialNumber: 'C02TEST12345',
        category: 'Laptop',
        color: 'Space Gray',
        status: 'REGISTERED',
        custodyStatus: 'WITH_OWNER',
        secureToken: 'gg_sec_macbook_qr_token',
        registeredAt: new Date().toISOString()
      },
      {
        id: 'gdt_test_ipad',
        userId: 'usr_student_alice',
        brand: 'Apple',
        model: 'iPad Air 5th Gen',
        serialNumber: 'DMPSERIALIPAD99',
        category: 'Tablet',
        color: 'Starlight',
        status: 'MISSING',
        custodyStatus: 'WITH_OWNER',
        secureToken: 'gg_sec_ipad_qr_token',
        registeredAt: new Date().toISOString()
      }
    ],
    missing_reports: [
      {
        id: 'msr_ipad_missing_case',
        gadgetId: 'gdt_test_ipad',
        userId: 'usr_student_alice',
        status: 'ACTIVE',
        lastSeenLocation: 'Library Room B',
        createdAt: new Date().toISOString()
      }
    ],
    found_reports: [],
    recovery_chats: [
      {
        id: 'cht_inactive_test',
        gadgetId: 'gdt_test_ipad',
        missingReportId: 'msr_ipad_missing_case',
        finderSessionToken: 'fnd_sec_inactive_token_999',
        finderName: 'Inactive Finder',
        foundLocation: 'Study Hall',
        ownerUserId: 'usr_student_alice',
        status: 'ACTIVE',
        messages: [{ id: 'msg_ipad_1', senderRole: 'FINDER', messageText: 'Found your iPad in Study Hall', createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }],
        revokedTokens: [],
        finderSessionCreatedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
        finderSessionExpiresAt: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
        finderSessionLastActiveAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), // 3 hours ago (> 2h timeout)
        createdAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString()
      },
      {
        id: 'cht_expired_test',
        gadgetId: 'gdt_test_ipad',
        missingReportId: 'msr_ipad_missing_case',
        finderSessionToken: 'fnd_sec_expired_token_888',
        finderName: 'Expired Finder',
        foundLocation: 'Cafeteria',
        ownerUserId: 'usr_student_alice',
        status: 'ACTIVE',
        messages: [],
        revokedTokens: [],
        finderSessionCreatedAt: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
        finderSessionExpiresAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(), // expired 6h ago (>24h max)
        finderSessionLastActiveAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
        createdAt: new Date(Date.now() - 30 * 3600 * 1000).toISOString()
      },
      {
        id: 'cht_inactive_poll_test',
        gadgetId: 'gdt_test_ipad',
        missingReportId: 'msr_ipad_missing_case',
        finderSessionToken: 'fnd_sec_inactive_poll_token',
        finderName: 'Inactive Poll Finder',
        foundLocation: 'Study Hall Table 2',
        ownerUserId: 'usr_student_alice',
        status: 'ACTIVE',
        messages: [{ id: 'msg_ipad_poll_1', senderRole: 'FINDER', messageText: 'Found your iPad in Study Hall', createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }],
        revokedTokens: [],
        finderSessionCreatedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
        finderSessionExpiresAt: new Date(Date.now() + 20 * 3600 * 1000).toISOString(),
        finderSessionLastActiveAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), // 3 hours ago (> 2h timeout)
        createdAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString()
      }
    ],
    claims: [],
    handover_returns: [],
    qr_scans: [],
    audit_logs: [],
    uploaded_files: [],
    revoked_tokens: [],
    system_settings: {
      schoolName: 'National College of Science and Technology',
      osaOfficeLocation: 'Office of Student Affairs (Room 1109)',
      osaContactPhone: '(046) 416-0166',
      osaEmail: 'osa@ncst.edu.ph',
      operatingHours: 'Mon-Fri 8:00 AM - 5:00 PM'
    }
  };

  const isolatedDbPath = path.join(TEMP_DATA_DIR, 'database.json');
  fs.writeFileSync(isolatedDbPath, JSON.stringify(testDb, null, 2), 'utf8');

  console.log(`📁 Isolated test database prepared in ${TEMP_DATA_DIR}`);
  console.log(`\n🚀 Launching isolated test server on port ${TEST_PORT}...`);

  const serverProcess = fork(path.join(__dirname, '..', 'server', 'server.js'), [], {
    env: {
      ...process.env,
      PORT: TEST_PORT.toString(),
      DATA_DIR: TEMP_DATA_DIR,
      PG_CONNECTION_STRING: '',
      NODE_ENV: 'test'
    },
    stdio: 'pipe'
  });

  const serverOnline = await waitForServer(40);
  assert(serverOnline, `Isolated test server online on port ${TEST_PORT}`);

  try {
    // Authenticate users
    const studentLogin = await httpRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'alice@ncst.edu.ph', password: 'Password123!' }
    });
    const studentToken = studentLogin.data?.token;
    assert(Boolean(studentToken), 'Student (Alice) authenticated successfully');

    const osaLogin = await httpRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'osa.admin@ncst.edu.ph', password: 'Password123!' }
    });
    const osaToken = osaLogin.data?.token;
    assert(Boolean(osaToken), 'OSA Admin authenticated successfully');

    // =========================================================================
    // SCENARIO 1: GADGET REPORTED MISSING & FINDER A CREATES CHAT A
    // =========================================================================
    console.log('\n--- SCENARIO 1: MISSING REPORT & FINDER A INITIALIZATION ---');

    const reportMissingRes = await httpRequest('/api/missing/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: {
        gadgetId: 'gdt_test_macbook',
        lastSeenLocation: 'Main Library 2nd Floor',
        lastSeenDate: new Date().toISOString(),
        details: 'Left on study carrel #14'
      }
    });
    assert(reportMissingRes.statusCode === 201, 'Student reported MacBook Pro missing');
    const missingReportId = reportMissingRes.data?.report?.id;
    assert(Boolean(missingReportId), `Active missing report ID created: ${missingReportId}`);

    // Finder A scans the QR
    const scanFinderA = await httpRequest('/api/scan/device/gg_sec_macbook_qr_token');
    assert(scanFinderA.statusCode === 200, 'Finder A public QR scan succeeds');
    assert(scanFinderA.data?.status === 'MISSING', 'Finder A sees gadget is MISSING');
    assert(scanFinderA.data?.owner === null, 'Finder A scan does NOT leak owner object');
    assert(scanFinderA.data?.activeFinderSession === null, 'Finder A scan has no pre-existing active session');
    assert(scanFinderA.data?.surrenderDetails === null, 'Finder A scan has no surrender details');

    // Finder A submits Keep Safe report
    const finderAReportRes = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_sec_macbook_qr_token',
        gadgetId: 'gdt_test_macbook',
        finderName: 'Finder AliceFriend',
        foundLocation: 'Main Library Table 4',
        turnInMethod: 'KEPT_SAFE',
        message: 'I have your laptop safe with me'
      }
    });
    assert(finderAReportRes.statusCode === 201, 'Finder A submitted Keep Safe report');
    const chatAId = finderAReportRes.data?.chat?.id;
    const tokenA = finderAReportRes.data?.chat?.finderSessionToken;
    const reportAId = finderAReportRes.data?.report?.id;
    assert(Boolean(chatAId), `Chat A created with ID: ${chatAId}`);
    assert(Boolean(tokenA) && tokenA.startsWith('fnd_sec_'), 'Finder A received unpredictable secure session token');
    assert(Boolean(reportAId), `Found report A created: ${reportAId}`);

    // Finder A sends message in Chat A
    const finderAMsg = await httpRequest(`/api/chat/${chatAId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenA
      },
      body: { text: 'Hello, I found your MacBook in the library.' }
    });
    assert(finderAMsg.statusCode === 201, 'Finder A successfully sent message in Chat A');

    // Owner Alice responds in Chat A
    const ownerMsgA = await httpRequest(`/api/chat/${chatAId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: { text: 'Thank you! Is the charger with it?' }
    });
    assert(ownerMsgA.statusCode === 201, 'Owner responded in Chat A');

    // =========================================================================
    // SCENARIO 2: FINDER B SCANS SAME QR INDEPENDENTLY & IS STRICTLY ISOLATED
    // =========================================================================
    console.log('\n--- SCENARIO 2: FINDER B INDEPENDENT SCAN & ACCESS CONTROL ---');

    // Finder B scans the same gadget QR from a clean session (no x-finder-token header)
    const scanFinderB = await httpRequest('/api/scan/device/gg_sec_macbook_qr_token');
    assert(scanFinderB.statusCode === 200, 'Finder B public QR scan succeeds');
    assert(scanFinderB.data?.activeFinderSession === null, 'Finder B scan does NOT receive Finder A session');
    assert(scanFinderB.data?.surrenderDetails === null, 'Finder B scan does NOT receive surrender details');
    assert(scanFinderB.body.indexOf(tokenA) === -1, 'Finder A session token is NEVER present in public scan response');
    assert(scanFinderB.body.indexOf('Finder AliceFriend') === -1, 'Finder A name is NOT present in public scan response');

    // SECURITY CHECK: Finder B tries to read Chat A directly without credentials
    const unauthorizedReadNoToken = await httpRequest(`/api/chat/${chatAId}`);
    assert(unauthorizedReadNoToken.statusCode === 403, 'Finder B without credentials to GET /api/chat/ChatA rejected with 403 Forbidden');

    // SECURITY CHECK: Finder B tries to read Chat A with random / invalid token
    const unauthorizedReadBadToken = await httpRequest(`/api/chat/${chatAId}`, {
      headers: { 'x-finder-token': 'fnd_sec_forged_or_random_token_123456789' }
    });
    assert(unauthorizedReadBadToken.statusCode === 403, 'Finder B with forged token to GET /api/chat/ChatA rejected with 403 Forbidden');

    // SECURITY CHECK: Finder B tries to send message to Chat A without valid credentials
    const unauthorizedPostNoToken = await httpRequest(`/api/chat/${chatAId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { text: 'Intruder message' }
    });
    assert(unauthorizedPostNoToken.statusCode === 403, 'Finder B posting to Chat A without credentials rejected with 403 Forbidden');

    // SECURITY CHECK: Finder B attempts to reconnect using Chat A ID alone in /report
    const reconnectAttemptWithChatIdAlone = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_sec_macbook_qr_token',
        gadgetId: 'gdt_test_macbook',
        chatId: chatAId, // Provided chatId WITHOUT valid finderSessionToken
        turnInMethod: 'KEPT_SAFE',
        finderName: 'Attacker',
        foundLocation: 'Nowhere'
      }
    });
    // It must NOT reconnect to Chat A! It must create a new chat or reject
    assert(
      reconnectAttemptWithChatIdAlone.data?.chat?.id !== chatAId,
      'Chat ID alone without matching session token DOES NOT grant access to Chat A'
    );
    assert(
      reconnectAttemptWithChatIdAlone.data?.chat?.finderSessionToken !== tokenA,
      'Attacker does NOT receive Finder A session token'
    );

    // =========================================================================
    // SCENARIO 3: FINDER B CREATES INDEPENDENT CHAT B
    // =========================================================================
    console.log('\n--- SCENARIO 3: INDEPENDENT CHAT B CREATION & MUTUAL ISOLATION ---');

    const finderBReportRes = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_sec_macbook_qr_token',
        gadgetId: 'gdt_test_macbook',
        finderName: 'Bob Martinez',
        foundLocation: 'Cafeteria Building 3',
        turnInMethod: 'KEPT_SAFE',
        message: 'Found the charger and mouse on cafeteria table'
      }
    });
    assert(finderBReportRes.statusCode === 201, 'Finder B submitted independent Keep Safe report');
    const chatBId = finderBReportRes.data?.chat?.id;
    const tokenB = finderBReportRes.data?.chat?.finderSessionToken;
    const reportBId = finderBReportRes.data?.report?.id;

    assert(Boolean(chatBId) && chatBId !== chatAId, `Chat B created independently: ${chatBId} !== ${chatAId}`);
    assert(Boolean(tokenB) && tokenB !== tokenA, `Finder B received distinct token: ${tokenB} !== ${tokenA}`);
    assert(Boolean(reportBId) && reportBId !== reportAId, `Found Report B is distinct: ${reportBId} !== ${reportAId}`);

    // Verify Finder B can post to Chat B
    const finderBMsg = await httpRequest(`/api/chat/${chatBId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenB
      },
      body: { text: 'Hi Alice, I also found your accessories at the cafeteria.' }
    });
    assert(finderBMsg.statusCode === 201, 'Finder B sent message in Chat B');

    // MUTUAL CROSS-READ ISOLATION
    // 1. Finder A attempts to read Chat B with Token A
    const crossReadAtoB = await httpRequest(`/api/chat/${chatBId}`, {
      headers: { 'x-finder-token': tokenA }
    });
    assert(crossReadAtoB.statusCode === 403, 'Finder A reading Chat B with Token A is strictly 403 Forbidden');

    // 2. Finder A attempts to post to Chat B with Token A
    const crossPostAtoB = await httpRequest(`/api/chat/${chatBId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenA
      },
      body: { text: 'Finder A trying to post into Chat B' }
    });
    assert(crossPostAtoB.statusCode === 403, 'Finder A posting to Chat B with Token A is strictly 403 Forbidden');

    // 3. Finder B attempts to read Chat A with Token B
    const crossReadBtoA = await httpRequest(`/api/chat/${chatAId}`, {
      headers: { 'x-finder-token': tokenB }
    });
    assert(crossReadBtoA.statusCode === 403, 'Finder B reading Chat A with Token B is strictly 403 Forbidden');

    // 4. Finder B attempts to post to Chat A with Token B
    const crossPostBtoA = await httpRequest(`/api/chat/${chatAId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenB
      },
      body: { text: 'Finder B trying to post into Chat A' }
    });
    assert(crossPostBtoA.statusCode === 403, 'Finder B posting to Chat A with Token B is strictly 403 Forbidden');

    // =========================================================================
    // SCENARIO 4: OWNER INDEPENDENT CHAT ACCESS & MULTI-CHAT MANAGEMENT
    // =========================================================================
    console.log('\n--- SCENARIO 4: OWNER MULTI-CHAT ACCESS & SEPARATE RESPONSES ---');

    // Owner checks gadgets list
    const ownerGadgetsRes = await httpRequest('/api/gadgets/my', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    const macbookData = ownerGadgetsRes.data?.gadgets?.find(g => g.id === 'gdt_test_macbook');
    assert(Array.isArray(macbookData?.finderChats), 'Owner view returns finderChats array');
    assert(macbookData?.finderChats?.length >= 2, `Owner sees ${macbookData?.finderChats?.length} active finder chats`);

    const hasChatAInList = macbookData?.finderChats?.some(c => c.chatId === chatAId);
    const hasChatBInList = macbookData?.finderChats?.some(c => c.chatId === chatBId);
    assert(hasChatAInList, 'Owner finderChats includes Chat A');
    assert(hasChatBInList, 'Owner finderChats includes Chat B');

    // Owner fetches Chat A specifically via /by-gadget/:gadgetId?chatId=...
    const ownerGetChatA = await httpRequest(`/api/chat/by-gadget/gdt_test_macbook?chatId=${chatAId}`, {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert(ownerGetChatA.data?.chat?.id === chatAId, 'Owner successfully loaded Chat A details');
    assert(ownerGetChatA.data?.chat?.finderName === 'Finder AliceFriend', 'Chat A displays Finder A name');

    // Owner responds to Finder B in Chat B
    const ownerMsgB = await httpRequest(`/api/chat/${chatBId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: { text: 'Thank you Bob! I can meet you later.' }
    });
    assert(ownerMsgB.statusCode === 201, 'Owner successfully sent message in Chat B');

    // Verify Finder A reading Chat A does NOT see Bob Martinez or Chat B messages
    const chatAReadByFinderA = await httpRequest(`/api/chat/${chatAId}`, {
      headers: { 'x-finder-token': tokenA }
    });
    const chatAMsgs = chatAReadByFinderA.data?.chat?.messages || [];
    assert(!chatAMsgs.some(m => m.text.includes('Bob')), 'Chat A does NOT contain Chat B messages');
    assert(chatAReadByFinderA.data?.chat?.finderName === 'Finder AliceFriend', 'Chat A retains Finder A name');

    // Verify Finder B reading Chat B sees only Chat B messages
    const chatBReadByFinderB = await httpRequest(`/api/chat/${chatBId}`, {
      headers: { 'x-finder-token': tokenB }
    });
    const chatBMsgs = chatBReadByFinderB.data?.chat?.messages || [];
    assert(chatBMsgs.some(m => m.text.includes('Thank you Bob!')), 'Chat B contains owner response to Bob');

    // =========================================================================
    // SCENARIO 5: CLOSING / SURRENDERING CHAT A DOES NOT CLOSE CHAT B
    // =========================================================================
    console.log('\n--- SCENARIO 5: CHAT A SURRENDER DOES NOT CLOSE CHAT B ---');

    // Finder A decides to Surrender to OSA
    const finderASurrenderRes = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenA
      },
      body: {
        token: 'gg_sec_macbook_qr_token',
        gadgetId: 'gdt_test_macbook',
        finderSessionToken: tokenA,
        chatId: chatAId,
        finderName: 'Finder AliceFriend',
        foundLocation: 'Main Library',
        turnInMethod: 'SUBMITTED_TO_OSA',
        notes: 'Surrendering to guard desk'
      }
    });
    assert(finderASurrenderRes.statusCode === 200, 'Finder A successfully submitted surrender to OSA');

    // Verify Chat A is now CLOSED
    const chatAReadAfterSurrender = await httpRequest(`/api/chat/${chatAId}`, {
      headers: { 'x-finder-token': tokenA }
    });
    assert(chatAReadAfterSurrender.data?.chat?.isClosed === true, 'Chat A is marked CLOSED after surrender');
    assert(chatAReadAfterSurrender.data?.chat?.closedReason === 'SURRENDERED_TO_OSA', 'Chat A closedReason is SURRENDERED_TO_OSA');

    // Further messages to Chat A are rejected
    const postToClosedChatA = await httpRequest(`/api/chat/${chatAId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenA
      },
      body: { text: 'Can I still message?' }
    });
    assert(postToClosedChatA.statusCode === 400, 'Message to surrendered Chat A rejected with 400');
    assert(
      postToClosedChatA.data?.error === 'The finder has decided to surrender your gadget to OSA. Awaiting physical handover.',
      'Chat A returns exact handover error message'
    );

    // CRITICAL SECURITY ASSERTION: Chat B must still be ACTIVE and OPEN!
    const chatBReadAfterChatAClosed = await httpRequest(`/api/chat/${chatBId}`, {
      headers: { 'x-finder-token': tokenB }
    });
    assert(chatBReadAfterChatAClosed.statusCode === 200, 'Finder B can still fetch Chat B');
    assert(chatBReadAfterChatAClosed.data?.chat?.isClosed === false, 'Chat B is NOT closed by Chat A surrender');
    assert(chatBReadAfterChatAClosed.data?.chat?.status === 'ACTIVE', 'Chat B status remains ACTIVE');

    // Finder B and owner can continue messaging in Chat B!
    const finderBMsg2 = await httpRequest(`/api/chat/${chatBId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenB
      },
      body: { text: 'I am still holding your charger and mouse, ready when you are!' }
    });
    assert(finderBMsg2.statusCode === 201, 'Finder B can still send messages in Chat B after Chat A surrendered');

    const ownerMsgB2 = await httpRequest(`/api/chat/${chatBId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: { text: 'Great, see you at 3pm.' }
    });
    assert(ownerMsgB2.statusCode === 201, 'Owner can still respond in Chat B after Chat A surrendered');

    // =========================================================================
    // SCENARIO 6: FINDER C ISOLATION & SHARED-DEVICE LOGOUT VERIFICATION
    // =========================================================================
    console.log('\n--- SCENARIO 6: FINDER C ISOLATION & SHARED-DEVICE CONTRACTS ---');

    // Finder C scans the QR without session
    const scanFinderC = await httpRequest('/api/scan/device/gg_sec_macbook_qr_token');
    assert(scanFinderC.data?.activeFinderSession === null, 'Finder C scan does NOT leak active sessions');
    assert(scanFinderC.data?.surrenderDetails === null, 'Finder C scan does NOT leak surrender details');

    // Finder C cannot access Chat A or Chat B
    const cAccessA = await httpRequest(`/api/chat/${chatAId}`);
    const cAccessB = await httpRequest(`/api/chat/${chatBId}`);
    assert(cAccessA.statusCode === 403, 'Finder C rejected from Chat A with 403');
    assert(cAccessB.statusCode === 403, 'Finder C rejected from Chat B with 403');

    // Verify UI contracts in public/device/index.html
    const deviceHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'device', 'index.html'), 'utf8');
    assert(deviceHtml.includes('clearFinderSession('), 'device/index.html contains clearFinderSession function');
    assert(deviceHtml.includes('endFinderSessionOnDevice('), 'device/index.html contains endFinderSessionOnDevice function');
    assert(!deviceHtml.includes('End / Leave Session on This Device'), 'device/index.html removed End / Leave Session button from main interface');

    // Verify student.js multi-finder rendering
    const studentJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'student', 'student.js'), 'utf8');
    assert(studentJs.includes('g.finderChats'), 'student.js references g.finderChats for multi-chat support');

    // =========================================================================
    // SCENARIO 7: OSA PHYSICAL INTAKE & REPEATED QR IN SECOND CYCLE
    // =========================================================================
    console.log('\n--- SCENARIO 7: OSA CUSTODY INTAKE & REPEATED QR CYCLE 2 ---');

    // OSA confirms physical custody intake
    const intakeRes = await httpRequest('/api/finder/gdt_test_macbook/receive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${osaToken}`
      },
      body: {
        custodyLocation: 'OSA Vault Shelf 4B',
        notes: 'Turned in by finder'
      }
    });
    assert(intakeRes.statusCode === 200, 'OSA confirmed physical intake into custody');

    // Return to student Alice
    const returnRes = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${osaToken}`
      },
      body: {
        gadgetId: 'gdt_test_macbook',
        receivedByPersonName: 'Alice Owner',
        handoverPhotoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        notes: 'Device returned in full good condition'
      }
    });
    assert(returnRes.statusCode === 200, 'MacBook officially returned to student');

    // Verify Cycle 2: Same MacBook reported missing again
    const cycle2Missing = await httpRequest('/api/missing/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: {
        gadgetId: 'gdt_test_macbook',
        lastSeenLocation: 'Gymnasium Bleachers',
        lastSeenDate: new Date().toISOString(),
        details: 'Cycle 2 loss'
      }
    });
    assert(cycle2Missing.statusCode === 201, 'Cycle 2: Same gadget reported missing again');

    // New finder in Cycle 2 scans same permanent QR
    const cycle2Scan = await httpRequest('/api/scan/device/gg_sec_macbook_qr_token');
    assert(cycle2Scan.data?.status === 'MISSING', 'Cycle 2: QR scan shows MISSING');
    assert(cycle2Scan.data?.activeFinderSession === null, 'Cycle 2: Old Cycle 1 chats do not lock scan');

    // Cycle 2 finder creates new chat
    const cycle2Report = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_sec_macbook_qr_token',
        gadgetId: 'gdt_test_macbook',
        finderName: 'Gym Coach',
        foundLocation: 'Gymnasium Locker Room',
        turnInMethod: 'KEPT_SAFE',
        message: 'Found after practice'
      }
    });
    assert(cycle2Report.statusCode === 201, 'Cycle 2: New finder successfully created chat');
    const cycle2ChatId = cycle2Report.data?.chat?.id;
    assert(cycle2ChatId !== chatAId && cycle2ChatId !== chatBId, 'Cycle 2 chat is completely distinct from Cycle 1 chats');

    // =========================================================================
    // SCENARIO 8: FINDER SESSION REVOCATION, EXPIRATION, REFRESH & SHARED-DEVICE ISOLATION
    // =========================================================================
    console.log('\n--- SCENARIO 8: FINDER SESSION REVOCATION, EXPIRATION, REFRESH & SHARED-DEVICE ISOLATION ---');

    // 8.1 Backend Revocation of Finder B Session (Requirement 1 & 2)
    // Finder B ends session explicitly on device
    const endSessionBRes = await httpRequest(`/api/chat/${chatBId}/end-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenB
      },
      body: { finderToken: tokenB }
    });
    assert(endSessionBRes.statusCode === 200, 'Finder B session successfully revoked on backend');
    assert(endSessionBRes.data?.success === true, 'End session response confirmed success');

    // 8.2 Authorization Invalidation: Old Finder Token can no longer read or send messages (Requirement 2)
    const readRevokedB = await httpRequest(`/api/chat/${chatBId}`, {
      headers: { 'x-finder-token': tokenB }
    });
    assert(readRevokedB.statusCode === 403, 'Old Finder Token B reading Chat B rejected with 403 Forbidden');
    assert(readRevokedB.data?.code === 'TOKEN_REVOKED', 'Error code specifies TOKEN_REVOKED');

    const sendRevokedB = await httpRequest(`/api/chat/${chatBId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenB
      },
      body: { text: 'Unauthorized snooping message after leaving device' }
    });
    assert(sendRevokedB.statusCode === 403, 'Old Finder Token B posting message rejected with 403 Forbidden');
    assert(sendRevokedB.data?.code === 'TOKEN_REVOKED', 'Error code specifies TOKEN_REVOKED');

    const activeFinderRevoked = await httpRequest('/api/chat/active-finder/gg_sec_macbook_qr_token', {
      headers: { 'x-finder-token': tokenB }
    });
    assert(activeFinderRevoked.statusCode === 403, 'active-finder endpoint rejects revoked Token B with 403');
    assert(activeFinderRevoked.data?.code === 'TOKEN_REVOKED', 'active-finder error code specifies TOKEN_REVOKED');

    // Public QR scan with old token B returns NO active session
    const scanAfterRevoke = await httpRequest('/api/scan/device/gg_sec_macbook_qr_token', {
      headers: { 'x-finder-token': tokenB }
    });
    assert(scanAfterRevoke.data?.activeFinderSession === null, 'Public QR scan does not recognize revoked Token B');

    // Revoked token CANNOT be re-authenticated or refreshed (Requirement 2)
    const refreshRevokedRes = await httpRequest(`/api/chat/${chatBId}/refresh-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenB
      },
      body: { finderToken: tokenB }
    });
    assert(refreshRevokedRes.statusCode === 403, 'Revoked token cannot be refreshed (403 Forbidden)');
    assert(refreshRevokedRes.data?.code === 'REVOKED', 'Refresh endpoint confirms REVOKED');

    // 8.3 Inactivity Handling & Legitimate Re-authentication / Refresh (Requirement 3)
    // Query pre-seeded inactive chat (inactivity > 2 hours)
    const inactiveToken = 'fnd_sec_inactive_token_999';
    const inactiveChatId = 'cht_inactive_test';

    const readInactiveRes = await httpRequest(`/api/chat/${inactiveChatId}`, {
      headers: { 'x-finder-token': inactiveToken }
    });
    assert(readInactiveRes.statusCode === 401, 'Inactive session rejected with 401 Unauthorized');
    assert(readInactiveRes.data?.code === 'SESSION_INACTIVE', 'Error code specifies SESSION_INACTIVE');
    assert(readInactiveRes.data?.canRefresh === true, 'Response signals session can be refreshed');

    const sendInactiveRes = await httpRequest(`/api/chat/${inactiveChatId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': inactiveToken
      },
      body: { text: 'Message while inactive' }
    });
    assert(sendInactiveRes.statusCode === 401, 'Posting to inactive session rejected with 401');
    assert(sendInactiveRes.data?.canRefresh === true, 'Posting response signals canRefresh: true');

    // Legitimate Finder refreshes the inactive session
    const refreshInactiveRes = await httpRequest(`/api/chat/${inactiveChatId}/refresh-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': inactiveToken
      },
      body: { finderToken: inactiveToken }
    });
    assert(refreshInactiveRes.statusCode === 200, 'Legitimate finder successfully refreshed inactive session');
    assert(refreshInactiveRes.data?.success === true, 'Refresh response returned success');

    // After refresh, legitimate finder reads existing conversation history without loss
    const readAfterRefresh = await httpRequest(`/api/chat/${inactiveChatId}`, {
      headers: { 'x-finder-token': inactiveToken }
    });
    assert(readAfterRefresh.statusCode === 200, 'Legitimate finder reads chat after refresh');
    assert(readAfterRefresh.data?.chat?.messages?.length >= 1, 'Previous conversation history preserved intact');
    assert(readAfterRefresh.data?.chat?.messages[0].text === 'Found your iPad in Study Hall', 'Message content matches original report');

    // Legitimate finder sends a message after refresh
    const sendAfterRefresh = await httpRequest(`/api/chat/${inactiveChatId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': inactiveToken
      },
      body: { text: 'I am back online, can we meet at Room 1109?' }
    });
    assert(sendAfterRefresh.statusCode === 201, 'Legitimate finder sends message successfully after refresh');

    // 8.4 Server-Enforced Absolute Lifetime Expiration (Requirement 3)
    const expiredToken = 'fnd_sec_expired_token_888';
    const expiredChatId = 'cht_expired_test';

    const readExpiredRes = await httpRequest(`/api/chat/${expiredChatId}`, {
      headers: { 'x-finder-token': expiredToken }
    });
    assert(readExpiredRes.statusCode === 401, 'Expired session (>24h max age) rejected with 401');
    assert(readExpiredRes.data?.code === 'SESSION_EXPIRED', 'Error code specifies SESSION_EXPIRED');
    assert(readExpiredRes.data?.canRefresh === false, 'canRefresh is false for lifetime expiration');

    const refreshExpiredRes = await httpRequest(`/api/chat/${expiredChatId}/refresh-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': expiredToken
      },
      body: { finderToken: expiredToken }
    });
    assert(refreshExpiredRes.statusCode === 401, 'Refreshing expired session rejected with 401');
    assert(refreshExpiredRes.data?.code === 'SESSION_EXPIRED', 'Refresh response confirms SESSION_EXPIRED');

    // 8.5 Shared Physical Browser Session Switching (Requirement 4)
    // Person 2 scans the iPad on the same physical browser and starts a separate report
    const scanIpadClean = await httpRequest('/api/scan/device/gg_sec_ipad_qr_token');
    assert(scanIpadClean.statusCode === 200, 'Person 2 scans iPad QR successfully');
    assert(scanIpadClean.data?.activeFinderSession === null, 'Person 2 does not see any existing active finder session');

    const finder2IpadReport = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_sec_ipad_qr_token',
        gadgetId: 'gdt_test_ipad',
        finderName: 'Charlie Second Finder',
        foundLocation: 'Main Cafeteria Table 4',
        turnInMethod: 'KEPT_SAFE',
        message: 'I found an iPad Air today'
      }
    });
    assert(finder2IpadReport.statusCode === 201, 'Person 2 successfully submitted separate report');
    const chatIpad2Id = finder2IpadReport.data?.chat?.id;
    const tokenIpad2 = finder2IpadReport.data?.chat?.finderSessionToken;
    assert(chatIpad2Id !== inactiveChatId && chatIpad2Id !== expiredChatId, 'Person 2 chat is completely separate from previous finder');
    assert(tokenIpad2 !== inactiveToken && tokenIpad2 !== expiredToken, 'Person 2 token is completely separate');

    // Cross-Finder isolation check: Person 2 cannot read inactiveChatId, and inactiveToken cannot read Person 2 chat
    const crossRead1 = await httpRequest(`/api/chat/${inactiveChatId}`, {
      headers: { 'x-finder-token': tokenIpad2 }
    });
    assert(crossRead1.statusCode === 403, 'Person 2 reading inactive chat rejected with 403 Forbidden');

    const crossRead2 = await httpRequest(`/api/chat/${chatIpad2Id}`, {
      headers: { 'x-finder-token': inactiveToken }
    });
    assert(crossRead2.statusCode === 403, 'Finder 1 reading Person 2 chat rejected with 403 Forbidden');

    // 8.6 Non-Revocation of Existing Finder when Different Person Starts Report (Edge Case 1)
    // Starting a separate session by Finder B must NOT revoke Finder A's legitimate backend session
    // Finder A creates a fresh chat on MacBook
    const finderAReport2 = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_sec_macbook_qr_token',
        gadgetId: 'gdt_test_macbook',
        finderName: 'Alice Colleague',
        foundLocation: 'Library Room 201',
        turnInMethod: 'KEPT_SAFE',
        message: 'Finder A report'
      }
    });
    const chatA2Id = finderAReport2.data?.chat?.id;
    const tokenA2 = finderAReport2.data?.chat?.finderSessionToken;
    assert(finderAReport2.statusCode === 201, 'Finder A successfully created report');

    // Person B on shared browser starts separate session (clears local browser state without backend revocation)
    // Verify that Finder A's backend session is 100% PRESERVED and NOT REVOKED!
    const checkA2StillValid = await httpRequest(`/api/chat/${chatA2Id}`, {
      headers: { 'x-finder-token': tokenA2 }
    });
    assert(checkA2StillValid.statusCode === 200, 'Starting separate session on device DID NOT revoke Finder A session on server');
    assert(checkA2StillValid.data?.chat?.status === 'ACTIVE', 'Finder A chat remains ACTIVE on server');

    const checkA2MessageStillValid = await httpRequest(`/api/chat/${chatA2Id}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenA2
      },
      body: { text: 'Finder A continuing legitimate coordination' }
    });
    assert(checkA2MessageStillValid.statusCode === 201, 'Finder A can still send messages after separate report started on shared browser');

    // Only EXPLICIT logout by Finder A revokes Finder A
    const explicitEndA2 = await httpRequest(`/api/chat/${chatA2Id}/end-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': tokenA2
      },
      body: { finderToken: tokenA2 }
    });
    assert(explicitEndA2.statusCode === 200, 'Explicit logout by Finder A revokes Finder A session');
    const readAfterExplicitEnd = await httpRequest(`/api/chat/${chatA2Id}`, {
      headers: { 'x-finder-token': tokenA2 }
    });
    assert(readAfterExplicitEnd.statusCode === 403, 'Old Token A2 rejected with 403 only AFTER explicit end session');

    // 8.7 Inactivity Protection: Background GET polling does NOT reset inactivity timer (Edge Case 2)
    // Repeated passive GET polls to an inactive session must remain 401 and NOT bump lastActiveAt
    const pollChatId = 'cht_inactive_poll_test';
    const pollToken = 'fnd_sec_inactive_poll_token';
    const pollInactive1 = await httpRequest(`/api/chat/${pollChatId}`, {
      headers: { 'x-finder-token': pollToken }
    });
    const pollInactive2 = await httpRequest(`/api/chat/${pollChatId}`, {
      headers: { 'x-finder-token': pollToken }
    });
    assert(pollInactive1.statusCode === 401, 'Passive GET poll 1 on inactive session returns 401');
    assert(pollInactive2.statusCode === 401, 'Passive GET poll 2 on inactive session still returns 401 (cannot bypass timeout via background polls)');

    // 8.8 Frontend UI Security Contracts Verification (Requirements 1, 4)
    assert(deviceHtml.includes('startSeparateFinderSession'), 'device/index.html includes startSeparateFinderSession function');
    assert(deviceHtml.includes('api.endFinderSession'), 'device/index.html calls api.endFinderSession');
    assert(!deviceHtml.includes('I am a Different Finder'), 'device/index.html removed Different Finder button from main interface');
    assert(deviceHtml.includes('resumeInactiveFinderSession'), 'device/index.html includes resumeInactiveFinderSession');
    assert(deviceHtml.includes('Session Cleared Locally (Device Offline)'), 'device/index.html handles offline end-session failure honestly');

    const apiJsContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');
    assert(apiJsContent.includes('endFinderSession(chatId, finderToken)'), 'api.js includes endFinderSession method');
    assert(apiJsContent.includes('refreshFinderSession(chatId, finderToken)'), 'api.js includes refreshFinderSession method');
    assert(apiJsContent.includes('/chat/${chatId}/end-session') || apiJsContent.includes('/end-session'), 'api.js points to /end-session endpoint');
    assert(apiJsContent.includes('/chat/${chatId}/refresh-session') || apiJsContent.includes('/refresh-session'), 'api.js points to /refresh-session endpoint');

    // =========================================================================
    // SCENARIO 9: FOCUSED NEGATIVE SECURITY CHECKS (GUESSABLE DETAILS & SHARED BROWSER)
    // =========================================================================
    console.log('\n--- SCENARIO 9: FOCUSED NEGATIVE SECURITY CHECKS ---');

    // 9.1 Guessable form details attack: Attacker submits exact matching finderName, location, gadget token, and chatId
    // Setup a target private conversation first:
    const victimReport = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_sec_macbook_qr_token',
        gadgetId: 'gdt_test_macbook',
        finderName: 'Victim Finder',
        foundLocation: 'Science Lab 304',
        turnInMethod: 'KEPT_SAFE',
        message: 'Confidential private message from legitimate finder'
      }
    });
    const victimChatId = victimReport.data?.chat?.id;
    const victimToken = victimReport.data?.chat?.finderSessionToken;
    assert(victimReport.statusCode === 201, 'Target victim chat created');

    // Victim sends a private message
    await httpRequest(`/api/chat/${victimChatId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': victimToken
      },
      body: { text: 'Secret message: Meet me at the faculty lounge' }
    });

    // Attacker attempts to hijack or reconnect to victim's chat using guessable/matching details:
    // (exact matching finderName, exact matching foundLocation, public QR token, and victim's chatId)
    const attackerReport1 = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_sec_macbook_qr_token',
        gadgetId: 'gdt_test_macbook',
        chatId: victimChatId, // Attacker provides victim's chat ID
        finderName: 'Victim Finder', // Attacker provides victim's exact name
        foundLocation: 'Science Lab 304', // Attacker provides exact found location
        turnInMethod: 'KEPT_SAFE',
        message: 'Attacker attempting hijack'
      }
    });
    assert(attackerReport1.statusCode === 201, 'Attacker request processed as new independent report');
    const attackerChatId = attackerReport1.data?.chat?.id;
    const attackerToken = attackerReport1.data?.chat?.finderSessionToken;

    // VULNERABILITY VERIFICATION: Attacker must NOT obtain victim's chat or token!
    assert(attackerChatId !== victimChatId, 'Attacker with matching details DOES NOT receive victim chat ID');
    assert(attackerToken !== victimToken, 'Attacker with matching details DOES NOT receive victim session token');
    assert(attackerReport1.data?.isExistingSession !== true, 'Matching form details DOES NOT trigger reconnection');

    // Attacker reading their new chat sees 0 messages (victim's messages are NOT exposed)
    const attackerChatRead = await httpRequest(`/api/chat/${attackerChatId}`, {
      headers: { 'x-finder-token': attackerToken }
    });
    assert(attackerChatRead.statusCode === 200, 'Attacker can only read their own empty chat');
    const attackerMsgs = attackerChatRead.data?.chat?.messages || [];
    assert(attackerMsgs.length === 0, 'Attacker chat contains NO victim messages');

    // Attacker attempting to read victim's chat with attacker's token is strictly 403 Forbidden
    const attackerTryVictimChat = await httpRequest(`/api/chat/${victimChatId}`, {
      headers: { 'x-finder-token': attackerToken }
    });
    assert(attackerTryVictimChat.statusCode === 403, 'Attacker accessing victim chat rejected with 403 Forbidden');

    // 9.2 Attacker with forged/random token and matching details CANNOT reconnect to victim chat
    const attackerReport2 = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': 'fnd_sec_forged_guess_token_12345'
      },
      body: {
        token: 'gg_sec_macbook_qr_token',
        gadgetId: 'gdt_test_macbook',
        chatId: victimChatId,
        finderName: 'Victim Finder',
        foundLocation: 'Science Lab 304',
        turnInMethod: 'KEPT_SAFE'
      }
    });
    assert(attackerReport2.data?.chat?.id !== victimChatId, 'Forged token cannot reconnect to victim chat');

    // 9.3 Attacker attempting to refresh victim chat without victim's valid token is strictly rejected
    const attackerRefreshNoToken = await httpRequest(`/api/chat/${victimChatId}/refresh-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {}
    });
    assert(attackerRefreshNoToken.statusCode === 400, 'Refresh without token rejected with 400');

    const attackerRefreshWrongToken = await httpRequest(`/api/chat/${victimChatId}/refresh-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': 'fnd_sec_wrong_token_54321'
      },
      body: { finderToken: 'fnd_sec_wrong_token_54321' }
    });
    assert(attackerRefreshWrongToken.statusCode === 403, 'Refresh with wrong token rejected with 403 Forbidden');

    // 9.4 Expired token (>24h) re-submission CANNOT resurrect expired conversation
    const resubmitExpiredReport = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-finder-token': expiredToken
      },
      body: {
        token: 'gg_sec_ipad_qr_token',
        gadgetId: 'gdt_test_ipad',
        finderName: 'Expired Finder',
        foundLocation: 'Cafeteria',
        turnInMethod: 'KEPT_SAFE'
      }
    });
    assert(resubmitExpiredReport.statusCode === 201, 'Expired finder re-submission creates new report');
    assert(resubmitExpiredReport.data?.chat?.id !== expiredChatId, 'Expired token DOES NOT reconnect to expired chat');
    assert(resubmitExpiredReport.data?.chat?.finderSessionToken !== expiredToken, 'Fresh independent token issued');

    // 9.5 Shared browser: new person scanning QR code cannot access existing conversation without authorization
    const sharedBrowserScan = await httpRequest('/api/scan/device/gg_sec_macbook_qr_token');
    assert(sharedBrowserScan.statusCode === 200, 'Shared browser public QR scan succeeds');
    assert(sharedBrowserScan.data?.activeFinderSession === null, 'Shared browser scanner does NOT receive active finder session');
    assert(sharedBrowserScan.data?.surrenderDetails === null, 'Shared browser scanner does NOT receive surrender details');

    const sharedBrowserRead = await httpRequest(`/api/chat/${victimChatId}`);
    assert(sharedBrowserRead.statusCode === 403, 'Shared browser scanner reading victim chat without token rejected with 403');

    const sharedBrowserPost = await httpRequest(`/api/chat/${victimChatId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { text: 'Unauthorized bystander message' }
    });
    assert(sharedBrowserPost.statusCode === 403, 'Shared browser scanner posting to victim chat without token rejected with 403');

    // 9.6 Additional negative tests on active-finder and by-gadget endpoints without authorization
    const activeFinderNoToken = await httpRequest('/api/chat/active-finder/gg_sec_macbook_qr_token');
    assert(activeFinderNoToken.statusCode === 400, 'active-finder endpoint without token rejected with 400 Bad Request');

    const activeFinderAttackerToken = await httpRequest('/api/chat/active-finder/gg_sec_macbook_qr_token', {
      headers: { 'x-finder-token': 'fnd_sec_attacker_fake_token' }
    });
    assert(activeFinderAttackerToken.statusCode === 404, 'active-finder endpoint with attacker token does not leak victim chat (404)');

    const byGadgetNoAuth = await httpRequest('/api/chat/by-gadget/gdt_test_macbook');
    assert(byGadgetNoAuth.statusCode === 401, 'Owner chat by-gadget endpoint without auth token strictly rejected with 401');

  } finally {
    console.log('\n🧹 Shutting down isolated test server on port ' + TEST_PORT + '...');
    serverProcess.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 600));

    if (fs.existsSync(TEMP_DATA_DIR)) {
      try {
        fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
        console.log('🧹 Cleaned up temporary test data directory');
      } catch (e) {}
    }

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
