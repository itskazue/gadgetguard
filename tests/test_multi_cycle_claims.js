/**
 * GadgetGuard — Multi-Cycle Recovery & OSA Claims Regression Test Suite
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
const TEMP_DATA_DIR = path.join(__dirname, '..', 'scratch', 'test_claims_isolated_dir');
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
  console.log('================================================================');
  console.log('GADGETGUARD: MULTI-CYCLE RECOVERY & CLAIMS REGRESSION TEST SUITE');
  console.log('================================================================\n');

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
      },
      {
        id: 'gdt_test_macbook',
        userId: 'usr_test_student',
        category: 'Laptop',
        brand: 'Apple',
        model: 'MacBook Air M2 Test',
        serialNumber: 'SN-TEST-MACBOOK-M2',
        color: 'Space Gray',
        status: 'REGISTERED',
        secureToken: 'gg_token_macbook_m2',
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
      NODE_ENV: 'test'
    },
    stdio: 'pipe'
  });

  serverProcess.stdout.on('data', d => {
    // optionally log server output
  });
  serverProcess.stderr.on('data', d => {
    // optionally log server stderr
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

    console.log('\n--- SCENARIO 1: FIRST RECOVERY CYCLE (Missing -> Custody -> Return) ---');
    // Step 1.1: Student reports iPhone XR missing
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
        details: 'Left on study table during exam.'
      }
    });
    assert(rep1.data?.success, 'Cycle 1: Student successfully reported iPhone XR missing');

    // Step 1.2: Finder surrenders and OSA confirms physical receipt into custody
    const intake1 = await httpRequest('/api/finder/gdt_test_iphone/receive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        custodyLocation: 'OSA Locker A-01',
        notes: 'Handed over by student finder. Device verified in vault.'
      }
    });
    assert(intake1.data?.success, 'Cycle 1: OSA confirmed physical receipt into custody (FOUND_IN_CUSTODY)');

    // Step 1.3: Verify Claims endpoint has active custody item
    const claims1 = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const activeIphone1 = claims1.data?.claims?.find(c => c.gadgetId === 'gdt_test_iphone' && c.isInCustody === true);
    assert(Boolean(activeIphone1), 'Cycle 1: iPhone XR appears in active Claims with isInCustody=true');
    assert(activeIphone1?.id?.startsWith('custody_'), 'Cycle 1: Generated custody claim id is custody_gdt_test_iphone');

    // Step 1.4: Verify OSA Stats
    const stats1 = await httpRequest('/api/osa/stats', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(stats1.data?.stats?.inCustodyGadgets === 1, 'Cycle 1: stats.inCustodyGadgets equals 1');
    assert(stats1.data?.stats?.claimsBadgeCount === 1, 'Cycle 1: stats.claimsBadgeCount equals 1');

    // Step 1.5: Complete Official Return (Handover Photo Proof Required)
    const return1 = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        claimId: activeIphone1.id,
        receivedByPersonName: 'Thirdy Manaog Test',
        receivedByPersonId: '2024-TEST-01',
        notes: 'Cycle 1 return completed with student ID verification.',
        handoverPhotoUrl: '/uploads/test_handover_proof_cycle1.jpg'
      }
    });
    assert(return1.data?.success, 'Cycle 1: Official return completed successfully with handover photo');
    const returnRecordId1 = return1.data?.returnRecord?.id;

    // Step 1.6: Check gadget status restored to REGISTERED
    const gadgetCheck1 = await httpRequest('/api/gadgets', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const iphoneAfterReturn1 = gadgetCheck1.data?.gadgets?.find(g => g.id === 'gdt_test_iphone');
    assert(iphoneAfterReturn1?.status === 'REGISTERED', 'Cycle 1: Gadget status restored to REGISTERED');

    // Step 1.7: Check Claims endpoint after return (Active = 0, Returned History = 1)
    const claimsAfterReturn1 = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const activeClaimsAfter1 = claimsAfterReturn1.data?.claims?.filter(c => c.isInCustody === true);
    const returnedClaimsAfter1 = claimsAfterReturn1.data?.claims?.filter(c => c.status === 'RETURNED' || Boolean(c.returnRecord));
    assert(activeClaimsAfter1.length === 0, 'Cycle 1: Ready for Claim active count dropped to 0 after return');
    assert(returnedClaimsAfter1.length === 1, 'Cycle 1: Returned History retains exactly 1 completed return record');

    console.log('\n--- SCENARIO 2 & 3: SECOND RECOVERY CYCLE (The Core Bug Scenario) ---');
    // Step 2.1: The SAME gadget is reported missing a second time
    const rep2 = await httpRequest('/api/missing/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        lastSeenLocation: 'Cafeteria Room 102',
        lastSeenDate: new Date().toISOString(),
        details: 'Cycle 2: Left in cafeteria during lunch break.'
      }
    });
    assert(rep2.data?.success, 'Cycle 2: Same iPhone XR reported missing a second time');

    // Step 2.2: Finder surrenders and OSA confirms custody again
    const intake2 = await httpRequest('/api/finder/gdt_test_iphone/receive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        custodyLocation: 'OSA Locker B-05',
        notes: 'Cycle 2: Turned in at desk by security guard.'
      }
    });
    assert(intake2.data?.success, 'Cycle 2: OSA confirmed physical receipt into custody again');

    // Step 2.3: Verify Claims endpoint has active custody item DESPITE previous return!
    const claims2 = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const activeIphone2 = claims2.data?.claims?.find(c => c.gadgetId === 'gdt_test_iphone' && c.isInCustody === true);
    assert(Boolean(activeIphone2), 'Cycle 2: iPhone XR appears in active Claims despite historical Cycle 1 return!');
    assert(activeIphone2?.status === 'IN_CUSTODY', 'Cycle 2: Active record has status IN_CUSTODY');
    assert(activeIphone2?.custodyLocation === 'OSA Locker B-05', 'Cycle 2: Active record reflects latest vault locker B-05');

    // Step 2.4: Verify Returned History still contains Cycle 1 return
    const histCycle1 = claims2.data?.claims?.find(c => c.gadgetId === 'gdt_test_iphone' && c.status === 'RETURNED');
    assert(Boolean(histCycle1), 'Cycle 2: Historical Cycle 1 return record remains preserved in Returned History');
    assert(histCycle1?.returnRecord?.handoverPhotoUrl === '/uploads/test_handover_proof_cycle1.jpg', 'Cycle 2: Historical return photo proof remains preserved');

    // Step 2.5: Verify stats and sidebar badge count
    const stats2 = await httpRequest('/api/osa/stats', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(stats2.data?.stats?.inCustodyGadgets === 1, 'Cycle 2: inCustodyGadgets equals 1');
    assert(stats2.data?.stats?.claimsBadgeCount === 1, 'Cycle 2: claimsBadgeCount equals 1');

    console.log('\n--- SCENARIO 4 & 5: THIRD RECOVERY CYCLE & COMPLETE HISTORY PRESERVATION ---');
    // Step 3.1: Complete Cycle 2 return
    const return2 = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        claimId: activeIphone2.id,
        receivedByPersonName: 'Thirdy Manaog Test',
        receivedByPersonId: '2024-TEST-01',
        notes: 'Cycle 2 return completed with signed receipt.',
        handoverPhotoUrl: '/uploads/test_handover_proof_cycle2.jpg'
      }
    });
    assert(return2.data?.success, 'Cycle 2: Return completed successfully');

    // Step 3.2: Enter Cycle 3: Report missing -> Custody intake
    await httpRequest('/api/missing/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        lastSeenLocation: 'Gymnasium Bleachers',
        details: 'Cycle 3: Misplaced after sports tournament.'
      }
    });
    await httpRequest('/api/finder/gdt_test_iphone/receive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        custodyLocation: 'OSA Locker C-10',
        notes: 'Cycle 3: Received at OSA front desk.'
      }
    });

    // Verify Cycle 3 appears in active claims
    const claims3 = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const activeIphone3 = claims3.data?.claims?.find(c => c.gadgetId === 'gdt_test_iphone' && c.isInCustody === true);
    assert(Boolean(activeIphone3), 'Cycle 3: iPhone XR active custody record present in Claims Desk');

    // Step 3.3: Complete Cycle 3 return
    const return3 = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        claimId: activeIphone3.id,
        receivedByPersonName: 'Thirdy Manaog Test',
        receivedByPersonId: '2024-TEST-01',
        notes: 'Cycle 3 handover completed with photo verification.',
        handoverPhotoUrl: '/uploads/test_handover_proof_cycle3.jpg'
      }
    });
    assert(return3.data?.success, 'Cycle 3: Official return completed successfully');

    // Step 3.4: Assert ALL 3 completed historical returns exist and are accessible
    const finalClaims = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const returnedHistoryList = finalClaims.data?.claims?.filter(c => c.status === 'RETURNED' || Boolean(c.returnRecord));
    assert(returnedHistoryList.length === 3, 'Multi-Cycle History: Exactly 3 historical returns preserved in database');
    const returnNotes = returnedHistoryList.map(r => r.claimProofDetails || r.returnRecord?.notes || '');
    assert(returnNotes.some(n => n.includes('Cycle 1')), 'History retains Cycle 1 handover audit trail');
    assert(returnNotes.some(n => n.includes('Cycle 2')), 'History retains Cycle 2 handover audit trail');
    assert(returnNotes.some(n => n.includes('Cycle 3')), 'History retains Cycle 3 handover audit trail');

    console.log('\n--- SCENARIO 6: RECEIPT WITHOUT SEPARATE STUDENT CLAIM ---');
    // Intake MacBook Air M2 directly without student filing a claim
    await httpRequest('/api/finder/gdt_test_macbook/receive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        custodyLocation: 'OSA Vault Room 1109',
        notes: 'Walk-in turnover by facility staff.'
      }
    });

    const macbookClaims = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const activeMacbook = macbookClaims.data?.claims?.find(c => c.gadgetId === 'gdt_test_macbook' && c.isInCustody === true);
    assert(Boolean(activeMacbook), 'MacBook appears in Ready for Claim automatically without separate claim request');
    assert(activeMacbook?.user?.name === 'Thirdy Manaog Test', 'Owner name correctly populated on automatic custody entry');

    console.log('\n--- SCENARIO 7: FINDER SURRENDER INTENT DOES NOT CREATE CUSTODY ---');
    // Report iPhone missing again
    await httpRequest('/api/missing/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        lastSeenLocation: 'Library Room 204',
        details: 'Testing surrender intent isolation'
      }
    });

    // Public finder indicates surrender intent (SUBMITTED_TO_OSA) via POST /api/finder/report
    const surrenderRes = await httpRequest('/api/finder/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        token: 'gg_token_iphone_xr',
        turnInMethod: 'SUBMITTED_TO_OSA',
        finderName: 'Good Samaritan',
        finderContact: '09171112222',
        foundLocation: 'Science Wing Lobby'
      }
    });
    assert(surrenderRes.data?.success, 'Finder surrender decision submitted');

    // Check gadget status: MUST STILL BE MISSING (NOT FOUND_IN_CUSTODY)
    const checkGadgetsSurrender = await httpRequest('/api/gadgets', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const iphoneSurrenderCheck = checkGadgetsSurrender.data?.gadgets?.find(g => g.id === 'gdt_test_iphone');
    assert(iphoneSurrenderCheck?.status === 'MISSING', 'Gadget status remains MISSING after surrender intent');
    assert(iphoneSurrenderCheck?.status !== 'FOUND_IN_CUSTODY', 'Surrender intent alone DOES NOT set FOUND_IN_CUSTODY');

    // Check claims: iPhone XR MUST NOT appear in active claims
    const claimsSurrenderCheck = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const prematureClaim = claimsSurrenderCheck.data?.claims?.find(c => c.gadgetId === 'gdt_test_iphone' && c.isInCustody === true);
    assert(!prematureClaim, 'Premature surrender intent does not appear in Ready for Claim');

    console.log('\n--- SCENARIO 8: SIDEBAR BADGE SYNCHRONIZATION ---');
    // Now officially confirm custody of iPhone
    await httpRequest('/api/finder/gdt_test_iphone/receive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: { custodyLocation: 'Vault Locker D-01' }
    });

    const statsMulti = await httpRequest('/api/osa/stats', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    // Now both MacBook and iPhone are in custody (2 items)
    assert(statsMulti.data?.stats?.inCustodyGadgets === 2, 'Stats reports exactly 2 in-custody gadgets');
    assert(statsMulti.data?.stats?.claimsBadgeCount === 2, 'Stats claimsBadgeCount matches exactly 2 distinct actionable items');

    console.log('\n--- SCENARIO 9: REVIEW CLAIMS TARGETED NAVIGATION ---');
    // Check that public/osa/osa.js contains navigateToClaimsForGadget
    const osaJsContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'osa.js'), 'utf8');
    assert(osaJsContent.includes('function navigateToClaimsForGadget(gadgetId)'), 'navigateToClaimsForGadget defined in public/osa/osa.js');
    assert(osaJsContent.includes("navigateToClaimsForGadget('${g.id}')"), 'Registered Gadgets Review Claims button calls navigateToClaimsForGadget');
    assert(osaJsContent.includes("navigateToClaimsForGadget('${r.gadgetId || r.gadget?.id}')"), 'Missing Gadgets Review Claims button calls navigateToClaimsForGadget');

    console.log('\n--- SCENARIO 10: COMPLETING RETURN REMOVES ACTIVE RECORD WHILE PRESERVING OTHERS ---');
    // Return MacBook, keep iPhone in custody
    await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        gadgetId: 'gdt_test_macbook',
        receivedByPersonName: 'Thirdy Manaog Test',
        notes: 'MacBook returned.',
        handoverPhotoUrl: '/uploads/macbook_return_proof.jpg'
      }
    });

    const claimsAfterMacbookReturn = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const activeRemaining = claimsAfterMacbookReturn.data?.claims?.filter(c => c.isInCustody === true);
    assert(activeRemaining.length === 1, 'Exactly 1 gadget remains in active custody');
    assert(activeRemaining[0]?.gadgetId === 'gdt_test_iphone', 'Remaining active gadget is the iPhone XR');
    const returnedMacbook = claimsAfterMacbookReturn.data?.claims?.find(c => c.gadgetId === 'gdt_test_macbook' && c.status === 'RETURNED');
    assert(Boolean(returnedMacbook), 'Returned MacBook record is safely archived in Returned History');

    console.log('\n--- SCENARIO 11: MULTIPLE GADGETS DISPLAY WITHOUT DUPLICATES ---');
    // Verify distinct count
    const uniqueGadgetIds = new Set(activeRemaining.map(c => c.gadgetId));
    assert(uniqueGadgetIds.size === activeRemaining.length, 'No duplicate rows exist for the same active recovery cycle');

    console.log('\n--- SCENARIO 12: SECURITY, RBAC & PRIVACY PROTECTIONS ---');
    // Unauthorized attempt to access claims endpoint (No Token)
    const unauthClaims = await httpRequest('/api/claims');
    assert(unauthClaims.statusCode === 401, 'Unauthenticated request to GET /api/claims rejected with 401');

    // Forbidden student role attempt to access claims endpoint
    const forbiddenClaims = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${studentToken}` }
    });
    assert(forbiddenClaims.statusCode === 403, 'Student role request to GET /api/claims rejected with 403');

    // Return without handover photo proof rejected
    const missingPhotoReturn = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: {
        gadgetId: 'gdt_test_iphone',
        receivedByPersonName: 'Thirdy Manaog Test'
        // missing handoverPhotoUrl
      }
    });
    assert(missingPhotoReturn.statusCode === 400, 'Handover return without photo proof is strictly rejected with 400');

    // QR scan route privacy test (finder scanning QR does not expose owner password or sensitive fields)
    const qrScanRes = await httpRequest('/api/scan/device/gg_token_iphone_xr', { method: 'GET' });
    assert(qrScanRes.data?.success, 'Public QR token resolves correctly');
    assert(!qrScanRes.data?.gadget?.passwordHash, 'Public QR scan response does not expose student passwordHash');
    assert(qrScanRes.data?.gadget?.brand === 'Apple', 'Public QR scan resolves gadget brand correctly');

  } finally {
    // 3. Gracefully stop isolated test server
    console.log('\n🧹 Shutting down isolated test server on port 3999...');
    serverProcess.kill();
    await new Promise(r => setTimeout(r, 600));

    // 4. Clean up temporary test data directory
    if (fs.existsSync(TEMP_DATA_DIR)) {
      fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
    }
    console.log('🧹 Cleaned up temporary test data directory');

    // 5. Verify original database hash after test
    const finalDbHash = getFileSha256(ORIGINAL_DB_PATH);
    console.log(`🔒 Final original database hash:   ${finalDbHash}`);
    assert(initialDbHash === finalDbHash, 'SAFETY VERIFICATION: Original database.json was 100% UNCHANGED');
  }

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passed} PASSED / ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
