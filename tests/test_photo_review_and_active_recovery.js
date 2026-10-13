/**
 * test_photo_review_and_active_recovery.js
 * 
 * Comprehensive validation for the FINAL Gadget Photo Workflow:
 * 1. Direct Student Add/Change/Remove photo (photo is optional, directly saved).
 * 2. NO separate OSA photo approval workflow (no review modals, queues, or endpoints).
 * 3. Strict ownership enforcement (Student B cannot update Student A -> 403 Forbidden).
 * 4. Preservation of lifecycle & QR tokens (REGISTERED, MISSING, FOUND_IN_CUSTODY, RETURNED).
 * 5. Direct OSA viewing of uploaded photos without modifying registration state.
 * 6. Strict database immutability verification on data/database.json.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { fork } = require('child_process');

const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
const EXPECTED_HASH = '4505f70dd6fc6e3770c37564946868d199a9cc1b98ccb18b27f51f00a996f8e6';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ${GREEN}✓${RESET} ${message}`);
  } else {
    failedTests++;
    console.error(`  ${RED}✗ FAIL:${RESET} ${message}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async function runSuite() {
  console.log(`${CYAN}========================================================================${RESET}`);
  console.log(`${CYAN} GADGETGUARD: DIRECT PHOTO WORKFLOW & ACTIVE STATUS TEST SUITE          ${RESET}`);
  console.log(`${CYAN}========================================================================${RESET}\n`);

  // -------------------------------------------------------------
  // CHECK 1: Database Baseline Integrity Check
  // -------------------------------------------------------------
  console.log(`${CYAN}[1/4] Baseline Database Checksum Audit...${RESET}`);
  const initialDbBuffer = fs.readFileSync(DB_PATH);
  const initialHash = crypto.createHash('sha256').update(initialDbBuffer).digest('hex');
  assert(initialHash === EXPECTED_HASH, `data/database.json SHA256 is strictly ${EXPECTED_HASH}`);

  // -------------------------------------------------------------
  // CHECK 2: Static Code Audits - Verify Clean Direct Workflow
  // -------------------------------------------------------------
  console.log(`\n${CYAN}[2/4] Verifying Removal of Obsolete Review Artifacts & Direct UI...${RESET}`);
  const osaHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'index.html'), 'utf8');
  const osaJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'osa.js'), 'utf8');
  const studentHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'student', 'index.html'), 'utf8');
  const studentJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'student', 'student.js'), 'utf8');
  const apiJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');
  const gadgetRoutes = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'gadgetRoutes.js'), 'utf8');

  // 2.1 No obsolete OSA photo review queues or modals
  assert(!osaHtml.includes('id="review-photo-modal"'), 'osa/index.html excludes separate #review-photo-modal');
  assert(!osaHtml.includes('value="PHOTO_PENDING"'), 'osa/index.html approvals filter excludes PHOTO_PENDING option');
  assert(!osaJs.includes("statusFilter === 'PHOTO_PENDING'"), 'osa.js excludes PHOTO_PENDING filter handling');
  assert(!gadgetRoutes.includes("router.post('/:id/photo/approve'"), 'gadgetRoutes.js excludes POST /:id/photo/approve');
  assert(!gadgetRoutes.includes("router.post('/:id/photo/reject'"), 'gadgetRoutes.js excludes POST /:id/photo/reject');

  // 2.2 Student UI has no obsolete photo review references
  assert(!studentJs.includes('hasPendingPhoto'), 'student.js excludes hasPendingPhoto check');
  assert(!studentJs.includes('Photo Review Pending'), 'student.js excludes "Photo Review Pending" badge');
  assert(!studentJs.includes('gmodal-pending-photo-alert'), 'student.js excludes nonexistent gmodal-pending-photo-alert');
  assert(!studentJs.includes("btnSave.textContent = 'Submit for OSA Review'"), 'student.js excludes "Submit for OSA Review" button label');
  assert(!studentJs.includes('Photo Submitted for OSA Review!'), 'student.js excludes "Photo Submitted for OSA Review!" dialog');

  // 2.3 Direct Photo Update UI & API connections exist
  assert(studentHtml.includes('id="update-photo-modal"'), 'student/index.html includes #update-photo-modal');
  assert(studentJs.includes('openUpdatePhotoModal'), 'student.js defines openUpdatePhotoModal');
  assert(studentJs.includes('handleUpdatePhotoSubmit'), 'student.js defines handleUpdatePhotoSubmit');
  assert(studentJs.includes('handleRemovePhotoSubmit'), 'student.js defines handleRemovePhotoSubmit');
  assert(apiJs.includes('updateGadgetPhoto(id, photoUrl, removePhoto = false)'), 'api.js defines updateGadgetPhoto client method');
  assert(gadgetRoutes.includes("router.patch('/:id/photo'"), 'gadgetRoutes.js provides PATCH /:id/photo');
  assert(osaJs.includes('previewOsaDevicePhoto'), 'osa.js defines previewOsaDevicePhoto for direct photo inspection');

  // -------------------------------------------------------------
  // CHECK 3: Live Isolated HTTP Lifecycle Tests for Active Recovery Statuses
  // -------------------------------------------------------------
  console.log(`\n${CYAN}[3/4] Live Isolated HTTP Lifecycle Tests (Direct Save, Ownership, Status Preservation)...${RESET}`);

  const TEST_PORT = 5127;
  const TEMP_DIR = path.join(__dirname, '..', 'scratch', 'test_photo_direct_' + Date.now());
  const TEMP_DB = path.join(TEMP_DIR, 'database.json');

  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const tempDbData = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const studentAUser = tempDbData.users.find(u => u.role === 'student');

  // Seed test devices across lifecycle states
  tempDbData.gadgets.push(
    {
      id: 'test-gdt-missing-active',
      userId: studentAUser.id,
      brand: 'Apple',
      model: 'iPad Pro 11',
      category: 'Tablet',
      serialNumber: 'IPAD-PRO-MISSING-SN',
      status: 'MISSING',
      photoUrl: 'https://example.com/photos/verified-ipad.jpg',
      secureToken: 'token-missing-ipad-999',
      qrCodeDataUrl: 'data:image/png;base64,mockqr',
      registrationDate: new Date().toISOString()
    },
    {
      id: 'test-gdt-custody-active',
      userId: studentAUser.id,
      brand: 'Lenovo',
      model: 'ThinkPad X1 Carbon',
      category: 'Laptop',
      serialNumber: 'X1-CARBON-CUSTODY-SN',
      status: 'FOUND_IN_CUSTODY',
      custodyStatus: 'IN_OSA_CUSTODY',
      custodyLocation: 'Office of Student Affairs (OSA Room 1109)',
      receivedByOsaStaffName: 'OSA Officer Santos',
      photoUrl: 'https://example.com/photos/verified-thinkpad.jpg',
      secureToken: 'token-custody-x1-888',
      qrCodeDataUrl: 'data:image/png;base64,mockqr',
      registrationDate: new Date().toISOString()
    },
    {
      id: 'test-gdt-returned-active',
      userId: studentAUser.id,
      brand: 'Sony',
      model: 'WH-1000XM5',
      category: 'Earbuds',
      serialNumber: 'SONY-XM5-RETURNED-SN',
      status: 'RETURNED',
      photoUrl: 'https://example.com/photos/verified-sony.jpg',
      secureToken: 'token-returned-sony-777',
      registrationDate: new Date().toISOString()
    }
  );

  fs.writeFileSync(TEMP_DB, JSON.stringify(tempDbData, null, 2));

  function httpRequest(urlPath, options = {}) {
    return new Promise((resolve, reject) => {
      const postData = options.body ? JSON.stringify(options.body) : null;
      const req = http.request({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api' + urlPath,
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
            resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
          } catch (e) {
            resolve({ status: res.statusCode, data });
          }
        });
      });
      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  const serverProc = fork(path.join(__dirname, '..', 'server', 'server.js'), [], {
    env: {
      ...process.env,
      PORT: TEST_PORT.toString(),
      DATA_DIR: TEMP_DIR,
      DATABASE_URL: '',
      POSTGRES_URL: '',
      NODE_ENV: 'test'
    },
    silent: true
  });

  await sleep(1800);

  try {
    const rawDb = JSON.parse(fs.readFileSync(TEMP_DB, 'utf8'));
    const studentA = rawDb.users.find(u => u.role === 'student');
    const studentB = rawDb.users.find(u => u.role === 'student' && u.id !== studentA.id);
    const osaUser = rawDb.users.find(u => u.role === 'osa_admin');

    // Login
    const loginOsa = await httpRequest('/auth/login', {
      method: 'POST',
      body: { email: osaUser.email, password: 'password123' }
    });
    const tokenOsa = loginOsa.data?.token;

    const loginStudentA = await httpRequest('/auth/login', {
      method: 'POST',
      body: { email: studentA.email, password: 'password123' }
    });
    const tokenStudentA = loginStudentA.data?.token;

    const loginStudentB = await httpRequest('/auth/login', {
      method: 'POST',
      body: { email: studentB.email, password: 'password123' }
    });
    const tokenStudentB = loginStudentB.data?.token;

    assert(Boolean(tokenOsa), 'Authenticated OSA Staff');
    assert(Boolean(tokenStudentA), 'Authenticated Student A');
    assert(Boolean(tokenStudentB), 'Authenticated Student B');

    // ---------------------------------------------------------
    // TEST 3.1: Direct Photo Update on REGISTERED Gadget
    // ---------------------------------------------------------
    console.log(`\n  --- Sub-Test 1: Direct Photo Update on REGISTERED Gadget ---`);
    const regGadget = rawDb.gadgets.find(g => g.userId === studentA.id && g.status === 'REGISTERED');
    assert(regGadget !== undefined, `Identified Student A REGISTERED device (${regGadget?.brand} ${regGadget?.model})`);

    const originalToken = regGadget.secureToken;
    const newPhotoDirect = 'https://example.com/photos/new-direct-laptop.jpg';

    const resRegReq = await httpRequest(`/gadgets/${regGadget.id}/photo`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenStudentA}` },
      body: { photoUrl: newPhotoDirect }
    });

    assert(resRegReq.status === 200, 'Student A updated photo directly (200 OK)');
    assert(resRegReq.data?.success === true, 'Response indicates direct update success');
    assert(resRegReq.data?.requiresReview === undefined, 'No separate OSA review flag returned');

    const dbAfterReg = JSON.parse(fs.readFileSync(TEMP_DB, 'utf8'));
    const regCheck = dbAfterReg.gadgets.find(g => g.id === regGadget.id);
    assert(regCheck.photoUrl === newPhotoDirect, 'photoUrl updated immediately in database');
    assert(regCheck.status === 'REGISTERED', 'CRITICAL: Lifecycle status remains REGISTERED (no reset to pending)');
    assert(regCheck.secureToken === originalToken, 'secureToken preserved untouched');

    // Security: Student B cannot update Student A device
    const resForbidden = await httpRequest(`/gadgets/${regGadget.id}/photo`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenStudentB}` },
      body: { photoUrl: 'https://attacker.com/fake.jpg' }
    });
    assert(resForbidden.status === 403, 'Unauthorized student request blocked (403 Forbidden)');

    // Security & Role Isolation: OSA cannot use the student photo-update endpoint
    const resOsaDenied = await httpRequest(`/gadgets/${regGadget.id}/photo`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenOsa}` },
      body: { photoUrl: 'https://example.com/photos/osa-override-attempt.jpg' }
    });
    assert(resOsaDenied.status === 403, 'OSA cannot modify student gadget photo via photo-update endpoint (403 Forbidden)');

    const resOsaRemoveDenied = await httpRequest(`/gadgets/${regGadget.id}/photo`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenOsa}` },
      body: { removePhoto: true }
    });
    assert(resOsaRemoveDenied.status === 403, 'OSA cannot remove student gadget photo via photo-update endpoint (403 Forbidden)');

    // ---------------------------------------------------------
    // TEST 3.2: Direct Photo Update on MISSING Device
    // ---------------------------------------------------------
    console.log(`\n  --- Sub-Test 2: Photo Update on MISSING Device ---`);
    const missingGadgetId = 'test-gdt-missing-active';
    const newPhotoMissing = 'https://example.com/photos/clearer-missing-proof.jpg';

    const resMissing = await httpRequest(`/gadgets/${missingGadgetId}/photo`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenStudentA}` },
      body: { photoUrl: newPhotoMissing }
    });

    assert(resMissing.status === 200, 'Student A updated photo on MISSING device (200 OK)');
    const dbAfterMissing = JSON.parse(fs.readFileSync(TEMP_DB, 'utf8'));
    const missingCheck = dbAfterMissing.gadgets.find(g => g.id === missingGadgetId);
    assert(missingCheck.status === 'MISSING', 'CRITICAL: Device status strictly preserved as MISSING');
    assert(missingCheck.photoUrl === newPhotoMissing, 'photoUrl updated to clearer proof');

    // ---------------------------------------------------------
    // TEST 3.3: Direct Photo Update on FOUND_IN_CUSTODY Device
    // ---------------------------------------------------------
    console.log(`\n  --- Sub-Test 3: Photo Update on FOUND_IN_CUSTODY Device ---`);
    const custodyGadgetId = 'test-gdt-custody-active';
    const newPhotoCustody = 'https://example.com/photos/additional-proof-custody.jpg';

    const resCustody = await httpRequest(`/gadgets/${custodyGadgetId}/photo`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenStudentA}` },
      body: { photoUrl: newPhotoCustody }
    });

    assert(resCustody.status === 200, 'Student A updated photo on FOUND_IN_CUSTODY device (200 OK)');
    const dbAfterCustody = JSON.parse(fs.readFileSync(TEMP_DB, 'utf8'));
    const custodyCheck = dbAfterCustody.gadgets.find(g => g.id === custodyGadgetId);
    assert(custodyCheck.status === 'FOUND_IN_CUSTODY', 'CRITICAL: Status strictly preserved as FOUND_IN_CUSTODY');
    assert(custodyCheck.custodyStatus === 'IN_OSA_CUSTODY', 'custodyStatus preserved as IN_OSA_CUSTODY');
    assert(custodyCheck.custodyLocation === 'Office of Student Affairs (OSA Room 1109)', 'Custody location preserved');
    assert(custodyCheck.photoUrl === newPhotoCustody, 'photoUrl updated directly');

    // ---------------------------------------------------------
    // TEST 3.4: Direct Photo Update on RETURNED Device & Removal
    // ---------------------------------------------------------
    console.log(`\n  --- Sub-Test 4: Photo Removal on RETURNED Device ---`);
    const returnedGadgetId = 'test-gdt-returned-active';

    const resRemove = await httpRequest(`/gadgets/${returnedGadgetId}/photo`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenStudentA}` },
      body: { removePhoto: true }
    });

    assert(resRemove.status === 200, 'Student A removed photo on RETURNED device (200 OK)');
    const dbAfterRemove = JSON.parse(fs.readFileSync(TEMP_DB, 'utf8'));
    const retCheck = dbAfterRemove.gadgets.find(g => g.id === returnedGadgetId);
    assert(retCheck.status === 'RETURNED', 'CRITICAL: Status strictly preserved as RETURNED');
    assert(retCheck.photoUrl === null, 'photoUrl safely set to null on removal');

    // ---------------------------------------------------------
    // TEST 3.5: OSA Can View Updated Device Details
    // ---------------------------------------------------------
    console.log(`\n  --- Sub-Test 5: OSA Views Updated Photo ---`);
    const resOsaView = await httpRequest(`/gadgets`, {
      headers: { Authorization: `Bearer ${tokenOsa}` }
    });
    assert(resOsaView.status === 200, 'OSA retrieved gadget list (200 OK)');
    const viewedReg = resOsaView.data?.gadgets?.find(g => g.id === regGadget.id);
    assert(viewedReg?.photoUrl === newPhotoDirect, 'OSA directly sees updated photo URL');

  } finally {
    serverProc.kill();
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  }

  // -------------------------------------------------------------
  // CHECK 4: Final Production Database Immutability Check
  // -------------------------------------------------------------
  console.log(`\n${CYAN}[4/4] Verifying Final Database SHA256 Immutability...${RESET}`);
  const finalDbBuffer = fs.readFileSync(DB_PATH);
  const finalHash = crypto.createHash('sha256').update(finalDbBuffer).digest('hex');
  assert(finalHash === EXPECTED_HASH, `data/database.json SHA256 remains strictly ${EXPECTED_HASH} (Zero bytes altered)`);

  console.log(`\n${CYAN}========================================================================${RESET}`);
  console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${GREEN}${passedTests}${RESET} | FAILED: ${failedTests > 0 ? RED + failedTests + RESET : '0'}`);
  console.log(`${CYAN}========================================================================${RESET}`);

  if (failedTests > 0) {
    process.exit(1);
  }
})();
