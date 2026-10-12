/**
 * GadgetGuard — OSA Transaction Duplication & Frontend Error Hotfix Test Suite
 * Strictly isolated test running on port 3997 with temporary test database.
 * Does NOT touch data/database.json, localhost:3000, or the deployed website.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const TEST_PORT = 3997;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEMP_DATA_DIR = path.join(__dirname, '..', 'scratch', 'test_hotfix_isolated_dir');
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

function getFileSha256(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
}

async function run() {
  console.log('========================================================================');
  console.log('GADGETGUARD: OSA TRANSACTION & DUPLICATION HOTFIX REGRESSION TEST SUITE');
  console.log('========================================================================\n');

  const initialDbHash = getFileSha256(ORIGINAL_DB_PATH);
  console.log(`🔒 Initial original database hash: ${initialDbHash}`);

  // Setup isolated test directory
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
        idNumber: '2024-50001',
        department: 'College of Computer Studies',
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
        model: 'iPhone XR',
        serialNumber: 'DX3TEST001',
        color: 'Coral',
        status: 'REGISTERED',
        secureToken: 'gg_token_iphone_xr',
        photoUrl: 'https://images.unsplash.com/photo-test.jpg',
        createdAt: new Date().toISOString()
      }
    ],
    missing_reports: [],
    found_reports: [],
    claims: [],
    returns: [],
    qr_scans: [],
    notifications: [],
    audit_logs: [
      {
        id: 'log_init',
        timestamp: new Date().toISOString(),
        userId: 'usr_test_admin',
        userRole: 'osa_admin',
        action: 'SYSTEM_INITIALIZATION',
        targetType: 'system',
        targetId: 'all',
        details: 'System initialized for isolated test.',
        ipAddress: '127.0.0.1'
      }
    ],
    recovery_chats: [],
    system_settings: { academicYear: '2026-2027', term: 'First Semester' }
  };

  const testDbPath = path.join(TEMP_DATA_DIR, 'database.json');
  fs.writeFileSync(testDbPath, JSON.stringify(initialTestDb, null, 2), 'utf8');

  // Launch isolated server on TEST_PORT
  const serverProcess = fork(path.join(__dirname, '..', 'server', 'server.js'), [], {
    env: {
      ...process.env,
      PORT: TEST_PORT.toString(),
      DATA_DIR: TEMP_DATA_DIR,
      DB_FILE: testDbPath,
      DATABASE_URL: '', // strictly local file isolation
      NODE_ENV: 'test'
    },
    silent: true
  });

  // Wait for server online
  await new Promise(r => setTimeout(r, 1500));

  try {
    // 1. Authenticate Admin and Student
    console.log('--- TEST STEP 1: AUTHENTICATION ---');
    const adminLoginRes = await httpRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'admin.test@univ.edu', password: 'testpass123' }
    });
    assert(adminLoginRes.statusCode === 200 && adminLoginRes.data?.token, 'Admin authenticated successfully');
    const adminToken = adminLoginRes.data?.token;

    const studentLoginRes = await httpRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: 'student.test@univ.edu', password: 'testpass123' }
    });
    assert(studentLoginRes.statusCode === 200 && studentLoginRes.data?.token, 'Student authenticated successfully');
    const studentToken = studentLoginRes.data?.token;

    // 2. Student reports gadget missing
    console.log('\n--- TEST STEP 2: REPORT MISSING ---');
    const missingRes = await httpRequest('/api/missing/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        lastSeenLocation: 'Library 3rd Floor',
        lastSeenDate: new Date().toISOString(),
        details: 'Left on study table',
        contactPhone: '09170000000'
      }
    });
    assert(missingRes.data?.success, 'Student reported iPhone XR missing');

    // 3. Finder surrenders gadget to OSA
    console.log('\n--- TEST STEP 3: FINDER SURRENDER ---');
    const foundRes = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_token_iphone_xr',
        finderName: 'Good Samaritan',
        finderContact: '09181112222',
        foundLocation: 'Library 3rd Floor Table 4',
        turnInMethod: 'OSA_OFFICE',
        itemCondition: 'Good'
      }
    });
    assert(foundRes.statusCode === 200, 'Finder submitted found report with OSA surrender intent');
    const foundReportId = foundRes.data?.report?.id;

    // 4. Confirm OSA Receipt ONCE
    console.log('\n--- TEST STEP 4: CONFIRM OSA RECEIPT ONCE ---');
    const receiveRes1 = await httpRequest(`/api/finder/${foundReportId}/receive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        custodyLocation: 'OSA Locker A-01',
        notes: 'Turned over by Good Samaritan'
      }
    });
    assert(receiveRes1.statusCode === 200, 'Confirm OSA Receipt succeeded (200 OK)');
    assert(receiveRes1.data?.gadget?.status === 'FOUND_IN_CUSTODY', 'Gadget transitioned to FOUND_IN_CUSTODY');
    assert(receiveRes1.data?.gadget?.custodyStatus === 'IN_OSA_CUSTODY', 'Custody progression updated to IN_OSA_CUSTODY');

    // Verify DB records for OSA Receipt
    let dbState = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
    const receiptLogs = dbState.audit_logs.filter(l => l.action === 'RECEIVE_INTO_CUSTODY');
    assert(receiptLogs.length === 1, 'Exactly ONE RECEIVE_INTO_CUSTODY audit log created in database');

    // 5. Backend Idempotency Protection for OSA Receipt: Call /receive AGAIN (simulate retry or double submit)
    console.log('\n--- TEST STEP 5: OSA RECEIPT BACKEND IDEMPOTENCY PROTECTION ---');
    const receiveRes2 = await httpRequest(`/api/finder/${foundReportId}/receive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        custodyLocation: 'OSA Locker A-01',
        notes: 'Turned over by Good Samaritan'
      }
    });
    assert(receiveRes2.statusCode === 200, 'Repeated /receive call handled cleanly and idempotently (200 OK)');
    dbState = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
    const receiptLogsAfterRetry = dbState.audit_logs.filter(l => l.action === 'RECEIVE_INTO_CUSTODY');
    assert(receiptLogsAfterRetry.length === 1, 'Audit logs STILL contain exactly ONE RECEIVE_INTO_CUSTODY log (no duplicate created)');
    const foundReportsCount = dbState.found_reports.length;
    assert(foundReportsCount === 1, 'Found reports STILL contain exactly ONE found report (no duplicate created)');

    // 6. Check Claims desk: exactly 1 actionable claim
    console.log('\n--- TEST STEP 6: CLAIMS SYNCHRONIZATION ---');
    const claimsRes = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(claimsRes.statusCode === 200, 'GET /api/claims returns 200 OK');
    const activeClaims = claimsRes.data?.claims?.filter(c => c.gadgetId === 'gdt_test_iphone') || [];
    assert(activeClaims.length === 1, 'Exactly ONE active claim entry for this gadget in Claims Desk');
    assert(activeClaims[0].isInCustody === true, 'Claim status is active isInCustody=true');

    // 7. Student submits claim
    console.log('\n--- TEST STEP 7: STUDENT SUBMITS CLAIM ---');
    const claimSubRes = await httpRequest('/api/claims/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        claimProofDetails: 'Coral color case with dog wallpaper',
        verificationIdType: 'Student ID',
        verificationIdNumber: '2024-50001'
      }
    });
    assert(claimSubRes.statusCode === 201, 'Student claim submission recorded (201 Created)');
    const claimId = claimSubRes.data?.claim?.id;

    // 8. Process Return ONCE with photo proof
    console.log('\n--- TEST STEP 8: PROCESS RETURN ONCE WITH PHOTO PROOF ---');
    const returnRes1 = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        claimId: claimId,
        receivedByPersonName: 'Thirdy Manaog Test',
        receivedByPersonId: '2024-50001',
        notes: 'Face-to-face verification completed',
        handoverPhotoUrl: 'https://images.unsplash.com/photo-handover-cycle1.jpg'
      }
    });
    assert(returnRes1.statusCode === 200, 'Process Return succeeded (200 OK)');
    const returnId1 = returnRes1.data?.returnRecord?.id;
    assert(returnId1 && returnId1.startsWith('ret_'), 'Generated valid return receipt: ' + returnId1);

    // Verify DB records for Process Return
    dbState = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
    assert(dbState.returns.length === 1, 'Exactly ONE record in returns table');
    const returnLogs1 = dbState.audit_logs.filter(l => l.action === 'RETURN_GADGET');
    assert(returnLogs1.length === 1, 'Exactly ONE RETURN_GADGET audit log in database');

    const updatedGadget = dbState.gadgets.find(g => g.id === 'gdt_test_iphone');
    assert(updatedGadget.status === 'REGISTERED', 'Gadget status restored to active REGISTERED');
    assert(updatedGadget.custodyStatus === 'RETURNED_TO_OWNER', 'Custody status is RETURNED_TO_OWNER');
    assert(updatedGadget.lastReturnId === returnId1, 'Gadget records lastReturnId=' + returnId1);

    // 9. Backend Protection: Attempt to call /return AGAIN on already-returned gadget
    console.log('\n--- TEST STEP 9: PROCESS RETURN BACKEND PROTECTION AGAINST DUPLICATES ---');
    const returnRes2 = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        claimId: claimId,
        receivedByPersonName: 'Thirdy Manaog Test',
        receivedByPersonId: '2024-50001',
        notes: 'Duplicate attempt test',
        handoverPhotoUrl: 'https://images.unsplash.com/photo-handover-cycle1.jpg'
      }
    });
    assert(returnRes2.statusCode === 400, 'Repeated /return call rejected with 400 Bad Request');
    assert(returnRes2.data?.error?.includes('already been completed') || returnRes2.data?.error?.includes('not currently in custody'),
      'Backend returns clear rejection: ' + returnRes2.data?.error);

    dbState = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
    assert(dbState.returns.length === 1, 'Returns table STILL contains exactly ONE record (no duplicate created)');
    const returnLogsAfterAttempt = dbState.audit_logs.filter(l => l.action === 'RETURN_GADGET');
    assert(returnLogsAfterAttempt.length === 1, 'Audit logs STILL contain exactly ONE RETURN_GADGET log (no duplicate created)');

    // 10. Check Returned History API (GET /api/osa/returns)
    console.log('\n--- TEST STEP 10: RETURNED HISTORY API RESPONSES ---');
    const returnsApiRes = await httpRequest('/api/osa/returns', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(returnsApiRes.statusCode === 200, 'GET /api/osa/returns succeeded');
    assert(returnsApiRes.data?.returns?.length === 1, 'GET /api/osa/returns returns exactly ONE return record (no duplicates)');
    assert(returnsApiRes.data?.returns[0]?.gadget?.id === 'gdt_test_iphone', 'Enriched return record contains gadget ID');
    assert(returnsApiRes.data?.returns[0]?.gadget?.color === 'Coral', 'Enriched return record contains gadget color');

    // 11. Check Audit Logs API (GET /api/osa/audit-logs)
    console.log('\n--- TEST STEP 11: AUDIT LOGS API RESPONSES ---');
    const auditLogsApiRes = await httpRequest('/api/osa/audit-logs', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(auditLogsApiRes.statusCode === 200, 'GET /api/osa/audit-logs succeeded');
    const gadgetLogsInApi = auditLogsApiRes.data?.logs?.filter(l => l.targetId === 'gdt_test_iphone') || [];
    const returnLogsInApi = gadgetLogsInApi.filter(l => l.action === 'RETURN_GADGET');
    const receiveLogsInApi = gadgetLogsInApi.filter(l => l.action === 'RECEIVE_INTO_CUSTODY');
    assert(returnLogsInApi.length === 1, 'Audit Logs API response contains exactly ONE RETURN_GADGET entry');
    assert(receiveLogsInApi.length === 1, 'Audit Logs API response contains exactly ONE RECEIVE_INTO_CUSTODY entry');

    // 12. MULTI-CYCLE TEST: Legitimate second recovery cycle must succeed cleanly!
    console.log('\n--- TEST STEP 12: MULTI-CYCLE LEGITIMATE SECOND INCIDENT ---');
    // Student reports missing again
    const missingResCycle2 = await httpRequest('/api/missing/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        lastSeenLocation: 'Gymnasium Bleachers',
        lastSeenDate: new Date().toISOString(),
        details: 'Left behind during basketball game',
        contactPhone: '09170000000'
      }
    });
    assert(missingResCycle2.data?.success, 'Cycle 2: Reported missing a second time');

    // Found and surrendered
    const foundResCycle2 = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_token_iphone_xr',
        finderName: 'Second Finder',
        finderContact: '09193334444',
        foundLocation: 'Gym Bleachers',
        turnInMethod: 'OSA_OFFICE',
        itemCondition: 'Good'
      }
    });
    assert(foundResCycle2.statusCode === 200, 'Cycle 2: Finder submitted found report');
    const foundReportId2 = foundResCycle2.data?.report?.id;

    // Confirm OSA Receipt for Cycle 2
    const receiveResCycle2 = await httpRequest(`/api/finder/${foundReportId2}/receive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        custodyLocation: 'OSA Locker B-15',
        notes: 'Turned over by Second Finder'
      }
    });
    assert(receiveResCycle2.statusCode === 200, 'Cycle 2: Confirm OSA Receipt succeeded');

    // Process Return for Cycle 2
    const returnResCycle2 = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        receivedByPersonName: 'Thirdy Manaog Test',
        receivedByPersonId: '2024-50001',
        notes: 'Cycle 2 return complete',
        handoverPhotoUrl: 'https://images.unsplash.com/photo-handover-cycle2.jpg'
      }
    });
    assert(returnResCycle2.statusCode === 200, 'Cycle 2: Process Return succeeded');
    const returnId2 = returnResCycle2.data?.returnRecord?.id;
    assert(returnId2 && returnId2 !== returnId1, 'Cycle 2 generated distinct return receipt: ' + returnId2);

    // Verify multi-cycle history preserved
    dbState = JSON.parse(fs.readFileSync(testDbPath, 'utf8'));
    assert(dbState.returns.length === 2, 'Database now preserves exactly TWO legitimate return records across incidents');
    const ret1 = dbState.returns.find(r => r.id === returnId1);
    const ret2 = dbState.returns.find(r => r.id === returnId2);
    assert(ret1 && ret1.handoverPhotoUrl.includes('cycle1'), 'Cycle 1 return record and photo proof remain intact');
    assert(ret2 && ret2.handoverPhotoUrl.includes('cycle2'), 'Cycle 2 return record and photo proof remain intact');

    // 13. Frontend Code Static Analysis
    console.log('\n--- TEST STEP 13: FRONTEND CODE INTEGRITY (osa.js) ---');
    const osaJsContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'osa.js'), 'utf8');

    // Check no undefined loader references exist
    assert(!osaJsContent.includes('loadMissingGadgets()'), 'ZERO calls to undefined loadMissingGadgets() in osa.js');
    assert(!osaJsContent.includes('loadRegisteredGadgets()'), 'ZERO calls to undefined loadRegisteredGadgets() in osa.js');
    assert(!osaJsContent.includes('loadPendingApprovals()'), 'ZERO calls to undefined loadPendingApprovals() in osa.js');
    assert(!osaJsContent.includes('loadDashboardData()'), 'ZERO calls to undefined loadDashboardData() in osa.js');

    // Check correct loader references are called
    assert(osaJsContent.includes('loadMissingIncidents()'), 'Calls declared loadMissingIncidents()');
    assert(osaJsContent.includes('loadRegisteredVault()'), 'Calls declared loadRegisteredVault()');
    assert(osaJsContent.includes('loadApprovalsQueue()'), 'Calls declared loadApprovalsQueue()');
    assert(osaJsContent.includes('loadOsaDashboardStats()'), 'Calls declared loadOsaDashboardStats()');

    // Check in-flight lock variables exist
    assert(osaJsContent.includes('isReceivingCustodyInFlight'), 'handleReceiveCustodySubmit contains in-flight submission lock');
    assert(osaJsContent.includes('isDispatchingReturnInFlight'), 'handleDispatchReturnSubmit contains in-flight submission lock');

    // Check Returned History uses api.getReturns
    assert(osaJsContent.includes('api.getReturns()'), 'loadReturnedHistory queries official api.getReturns()');

  } finally {
    serverProcess.kill();
    if (fs.existsSync(TEMP_DATA_DIR)) {
      fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
    }
  }

  const finalDbHash = getFileSha256(ORIGINAL_DB_PATH);
  console.log(`\n🔒 Final original database hash:   ${finalDbHash}`);
  assert(initialDbHash === finalDbHash, 'SAFETY VERIFICATION: Original database.json was 100% UNCHANGED');

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
