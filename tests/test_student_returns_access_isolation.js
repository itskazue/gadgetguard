/**
 * GadgetGuard — Student Return History API Access & Isolation Test
 * Verifies Check 1:
 * - Logged-in Student can successfully retrieve their OWN return records through the actual API.
 * - Student A CANNOT retrieve Student B's returns, receipts, photos, or private information.
 * - OSA retains authorized access to all return records.
 * - Actual student-facing endpoint tested with authenticated student accounts.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const bcrypt = require('bcryptjs');

const TEST_PORT = 3995;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEMP_DATA_DIR = path.join(__dirname, '..', 'scratch', 'test_isolation_access_dir');
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

async function runCheck1() {
  console.log('======================================================');
  console.log('CHECK 1: STUDENT RETURN HISTORY API ACCESS & ISOLATION');
  console.log('======================================================');

  if (fs.existsSync(TEMP_DATA_DIR)) {
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });

  const salt = bcrypt.genSaltSync(10);
  const passHash = bcrypt.hashSync('SecurePassword@123', salt);

  const studentA = {
    id: 'usr_student_alpha',
    name: 'Alice Reyes',
    email: 'alice.reyes@student.ncst.edu.ph',
    passwordHash: passHash,
    role: 'student',
    idNumber: '2024-10001',
    department: 'BSCS',
    contactNumber: '09170000001'
  };

  const studentB = {
    id: 'usr_student_beta',
    name: 'Bob Tan',
    email: 'bob.tan@student.ncst.edu.ph',
    passwordHash: passHash,
    role: 'student',
    idNumber: '2024-20002',
    department: 'BSIT',
    contactNumber: '09170000002'
  };

  const osaAdmin = {
    id: 'usr_osa_master',
    name: 'Dean OSA Commander',
    email: 'dean.osa@ncst.edu.ph',
    passwordHash: passHash,
    role: 'osa_admin',
    idNumber: 'OSA-EXEC-001',
    department: 'Office of Student Affairs',
    contactNumber: '09179999999'
  };

  const gadgetA = {
    id: 'gdt_alice_macbook',
    userId: studentA.id,
    category: 'Laptop',
    brand: 'Apple',
    model: 'MacBook Air M2',
    color: 'Midnight Blue',
    serialNumber: 'SN-ALICE-1234',
    status: 'FOUND_IN_CUSTODY',
    custodyLocation: 'OSA Locker A-01',
    secureToken: 'token_alice_laptop',
    registrationDate: new Date().toISOString()
  };

  const gadgetB = {
    id: 'gdt_bob_ipad',
    userId: studentB.id,
    category: 'Tablet',
    brand: 'Apple',
    model: 'iPad Pro 12.9',
    color: 'Space Gray',
    serialNumber: 'SN-BOB-9876',
    status: 'FOUND_IN_CUSTODY',
    custodyLocation: 'OSA Locker B-02',
    secureToken: 'token_bob_tablet',
    registrationDate: new Date().toISOString()
  };

  const initialDb = {
    users: [studentA, studentB, osaAdmin],
    gadgets: [gadgetA, gadgetB],
    missing_reports: [],
    found_reports: [],
    claims: [],
    returns: [],
    notifications: [],
    audit_logs: [],
    recovery_chats: [],
    system_settings: { academicYear: '2026-2027', term: 'First Semester' }
  };

  const testDbPath = path.join(TEMP_DATA_DIR, 'database.json');
  fs.writeFileSync(testDbPath, JSON.stringify(initialDb, null, 2), 'utf8');

  // Spawn isolated test server
  console.log(`Starting isolated test server on port ${TEST_PORT}...`);
  const serverProcess = fork(path.join(__dirname, '..', 'server', 'server.js'), [], {
    env: {
      ...process.env,
      PORT: TEST_PORT.toString(),
      DATA_DIR: TEMP_DATA_DIR,
      DB_FILE: testDbPath,
      DATABASE_URL: '',
      JWT_SECRET: 'check1_isolation_secret_key',
      NODE_ENV: 'test'
    },
    silent: true
  });

  await sleep(1500);

  try {
    // 1. Authenticate users
    console.log('\n--- 1. AUTHENTICATING ACCOUNTS ---');
    const authA = await httpRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: studentA.email, password: 'SecurePassword@123' }
    });
    assert(authA.statusCode === 200 && authA.data?.token, 'Student A (Alice) authenticated successfully');
    const tokenA = authA.data.token;

    const authB = await httpRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: studentB.email, password: 'SecurePassword@123' }
    });
    assert(authB.statusCode === 200 && authB.data?.token, 'Student B (Bob) authenticated successfully');
    const tokenB = authB.data.token;

    const authOsa = await httpRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { email: osaAdmin.email, password: 'SecurePassword@123' }
    });
    assert(authOsa.statusCode === 200 && authOsa.data?.token, 'OSA Admin authenticated successfully');
    const tokenOsa = authOsa.data.token;

    // 2. OSA processes Return for Student A's gadget
    console.log('\n--- 2. OSA DISPATCHES RETURN FOR STUDENT A ---');
    const returnARes = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenOsa}`,
        'Content-Type': 'application/json'
      },
      body: {
        gadgetId: gadgetA.id,
        receivedByPersonName: 'Alice Reyes',
        receivedByPersonId: '2024-10001',
        handoverPhotoUrl: 'https://cdn.ncst.edu.ph/proofs/alice_macbook_handover.jpg',
        notes: 'Handover note: Alice private confidential student memo.'
      }
    });
    assert(returnARes.statusCode === 200, 'Return A generated for Student A (200 OK)');
    const returnAId = returnARes.data.returnRecord.id;

    // 3. OSA processes Return for Student B's gadget
    console.log('\n--- 3. OSA DISPATCHES RETURN FOR STUDENT B ---');
    const returnBRes = await httpRequest('/api/osa/return', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenOsa}`,
        'Content-Type': 'application/json'
      },
      body: {
        gadgetId: gadgetB.id,
        receivedByPersonName: 'Bob Tan',
        receivedByPersonId: '2024-20002',
        handoverPhotoUrl: 'https://cdn.ncst.edu.ph/proofs/bob_ipad_handover.jpg',
        notes: 'Handover note: Bob private confidential student memo.'
      }
    });
    assert(returnBRes.statusCode === 200, 'Return B generated for Student B (200 OK)');
    const returnBId = returnBRes.data.returnRecord.id;

    // 4. Student A retrieves return records via actual student-facing API
    console.log('\n--- 4. STUDENT A ACCESSES OWN RETURN RECORDS ---');
    const studentAGetReturns = await httpRequest('/api/osa/returns', {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(studentAGetReturns.statusCode === 200, 'Student A calls GET /api/osa/returns (200 OK)');
    const returnsListA = studentAGetReturns.data.returns || [];
    assert(returnsListA.length === 1, `Student A receives exactly 1 return record (got ${returnsListA.length})`);
    assert(returnsListA[0].id === returnAId, `Student A retrieved their OWN return record (${returnAId})`);
    assert(returnsListA[0].gadget?.model === 'MacBook Air M2', 'Student A retrieved their own gadget specs');

    // 5. Verification: Student A CANNOT access Student B's return, receipt, photo, or private info
    console.log('\n--- 5. VERIFY STUDENT A CANNOT ACCESS STUDENT B DATA ---');
    const rawBodyA = studentAGetReturns.body;
    assert(!rawBodyA.includes(returnBId), "Student A response does NOT contain Student B's return ID");
    assert(!rawBodyA.includes('Bob Tan'), "Student A response does NOT contain Student B's name");
    assert(!rawBodyA.includes('2024-20002'), "Student A response does NOT contain Student B's student ID");
    assert(!rawBodyA.includes('bob_ipad_handover.jpg'), "Student A response does NOT contain Student B's photo proof URL");
    assert(!rawBodyA.includes('Bob private confidential'), "Student A response does NOT contain Student B's handover notes");
    assert(!rawBodyA.includes('SN-BOB-9876'), "Student A response does NOT contain Student B's device serial number");

    // 6. Student B retrieves return records via actual student-facing API
    console.log('\n--- 6. STUDENT B ACCESSES OWN RETURN RECORDS ---');
    const studentBGetReturns = await httpRequest('/api/osa/returns', {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    assert(studentBGetReturns.statusCode === 200, 'Student B calls GET /api/osa/returns (200 OK)');
    const returnsListB = studentBGetReturns.data.returns || [];
    assert(returnsListB.length === 1, `Student B receives exactly 1 return record (got ${returnsListB.length})`);
    assert(returnsListB[0].id === returnBId, `Student B retrieved their OWN return record (${returnBId})`);
    assert(returnsListB[0].gadget?.model === 'iPad Pro 12.9', 'Student B retrieved their own gadget specs');

    // 7. Verification: Student B CANNOT access Student A's return, receipt, photo, or private info
    console.log('\n--- 7. VERIFY STUDENT B CANNOT ACCESS STUDENT A DATA ---');
    const rawBodyB = studentBGetReturns.body;
    assert(!rawBodyB.includes(returnAId), "Student B response does NOT contain Student A's return ID");
    assert(!rawBodyB.includes('Alice Reyes'), "Student B response does NOT contain Student A's name");
    assert(!rawBodyB.includes('2024-10001'), "Student B response does NOT contain Student A's student ID");
    assert(!rawBodyB.includes('alice_macbook_handover.jpg'), "Student B response does NOT contain Student A's photo proof URL");
    assert(!rawBodyB.includes('Alice private confidential'), "Student B response does NOT contain Student A's handover notes");
    assert(!rawBodyB.includes('SN-ALICE-1234'), "Student B response does NOT contain Student A's device serial number");

    // 8. Confirm OSA retains authorized access to all return records
    console.log('\n--- 8. CONFIRM OSA RETAINS AUTHORIZED ACCESS ---');
    const osaGetReturns = await httpRequest('/api/osa/returns', {
      headers: { 'Authorization': `Bearer ${tokenOsa}` }
    });
    assert(osaGetReturns.statusCode === 200, 'OSA Admin calls GET /api/osa/returns (200 OK)');
    const osaReturnsList = osaGetReturns.data.returns || [];
    assert(osaReturnsList.length === 2, `OSA Admin receives all return records across students (got ${osaReturnsList.length})`);
    const osaIds = osaReturnsList.map(r => r.id);
    assert(osaIds.includes(returnAId) && osaIds.includes(returnBId), 'OSA Admin retains access to both Return A and Return B');

    // 9. Negative security check: Unauthenticated access rejected
    console.log('\n--- 9. NEGATIVE SECURITY: UNAUTHENTICATED REQUEST ---');
    const unauthReturns = await httpRequest('/api/osa/returns');
    assert(unauthReturns.statusCode === 401, 'Unauthenticated request to GET /api/osa/returns rejected with 401 Unauthorized');

    // 10. Student role cannot access internal admin claims desk
    console.log('\n--- 10. RBAC: STUDENT REJECTED FROM ADMIN CLAIMS DESK ---');
    const studentClaimsDesk = await httpRequest('/api/claims', {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    assert(studentClaimsDesk.statusCode === 403, 'Student role forbidden from calling GET /api/claims (403 Forbidden)');

  } finally {
    serverProcess.kill('SIGTERM');
    await sleep(500);
    try {
      fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
    } catch (e) {}
  }

  console.log('\n======================================================');
  console.log(`CHECK 1 SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) process.exit(1);
}

runCheck1().catch(err => {
  console.error('Check 1 failure:', err);
  process.exit(1);
});
