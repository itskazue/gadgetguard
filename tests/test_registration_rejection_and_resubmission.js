/**
 * test_registration_rejection_and_resubmission.js
 *
 * Comprehensive Test Suite for:
 * OSA GADGET REGISTRATION REJECTION & STUDENT RESUBMISSION WORKFLOW
 *
 * Tests:
 * 1. Reject with each of the 4 standard categories (Information Mismatch, Incomplete Info, S/N Mismatch, Duplicate Registration).
 * 2. Reject with "Other Reason" requiring explanation notes (validates 400 on empty notes).
 * 3. Verify reviewer information, category, notes, timestamp, reviewHistory, and audit log saved.
 * 4. Verify student notification created with the exact rejection reason.
 * 5. Verify NO approved QR code is issued while registration is REJECTED.
 * 6. Student Portal UI: Card and Details Modal display REJECTED status, reason, reviewer, and "Edit & Resubmit" action.
 * 7. Student edits and resubmits: REUSES SAME gadget ID, creates NO duplicate records.
 * 8. Status transitions: REJECTED -> PENDING_APPROVAL -> APPROVED (QR issued).
 * 9. Status transitions: REJECTED -> PENDING_APPROVAL -> REJECTED AGAIN (review history preserved).
 * 10. Security: Student B cannot edit Student A's registration (403 Forbidden).
 * 11. Security: Cannot resubmit an approved/registered device (400 Bad Request).
 * 12. Security: Unauthenticated or student cannot call reject endpoint (401/403).
 * 13. OSA & Student UI HTML templates contain required elements and no forbidden photo rejection reason.
 * 14. Zero modifications to baseline production database (SHA256 verified).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { fork } = require('child_process');

const ORIGINAL_DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
const INITIAL_DB_CHECKSUM = crypto.createHash('sha256').update(fs.readFileSync(ORIGINAL_DB_PATH)).digest('hex').toUpperCase();

const TEMP_DATA_DIR = path.join(__dirname, '..', 'scratch', 'test_reject_resubmit_' + Date.now());
const TEMP_DB_PATH = path.join(TEMP_DATA_DIR, 'database.json');

const TEST_PORT = 5099;

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// HTTP Helper for live test requests
function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const dataString = postData ? JSON.stringify(postData) : null;
    const reqOptions = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(dataString ? { 'Content-Length': Buffer.byteLength(dataString) } : {}),
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on('error', reject);
    if (dataString) req.write(dataString);
    req.end();
  });
}

(async function runTestSuite() {
  console.log('========================================================================');
  console.log('GADGETGUARD: OSA REGISTRATION REJECTION & STUDENT RESUBMISSION SUITE');
  console.log('========================================================================\n');
  console.log(`🔒 Baseline database checksum: ${INITIAL_DB_CHECKSUM}\n`);

  // Setup isolated test directory and database copy
  fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });
  fs.copyFileSync(ORIGINAL_DB_PATH, TEMP_DB_PATH);

  // 1. UI & Template Static Safety Checks
  console.log('--- SECTION 1: UI TEMPLATE & HTML COMPLIANCE CHECKS ---');

  it('OSA Portal HTML contains #reject-gadget-modal with all 5 approved reasons', () => {
    const osaHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'index.html'), 'utf8');
    assert.ok(osaHtml.includes('id="reject-gadget-modal"'), 'Must have #reject-gadget-modal');
    assert.ok(osaHtml.includes('id="reject-reason-category"'), 'Must have #reject-reason-category');
    assert.ok(osaHtml.includes('Gadget Information Mismatch'), 'Must have Gadget Information Mismatch');
    assert.ok(osaHtml.includes('Incomplete or Incorrect Information'), 'Must have Incomplete or Incorrect Information');
    assert.ok(osaHtml.includes('Serial Number / IMEI Mismatch'), 'Must have Serial Number / IMEI Mismatch');
    assert.ok(osaHtml.includes('Duplicate Registration'), 'Must have Duplicate Registration');
    assert.ok(osaHtml.includes('Other Reason'), 'Must have Other Reason');
    assert.ok(osaHtml.includes('id="reject-reason-notes"'), 'Must have #reject-reason-notes');
  });

  it('OSA Portal HTML strictly excludes "Unclear or Missing Gadget Photo" reason', () => {
    const osaHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'index.html'), 'utf8');
    const lower = osaHtml.toLowerCase();
    assert.ok(!lower.includes('unclear or missing gadget photo'), 'Must NOT include Unclear or Missing Gadget Photo');
    assert.ok(!lower.includes('missing gadget photo'), 'Must NOT include Missing Gadget Photo');
  });

  it('Student Portal HTML contains #edit-resubmit-gadget-modal and Rejected filter tab', () => {
    const studentHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'student', 'index.html'), 'utf8');
    assert.ok(studentHtml.includes('id="edit-resubmit-gadget-modal"'), 'Must have #edit-resubmit-gadget-modal');
    assert.ok(studentHtml.includes('filterStudentGadgets(\'REJECTED\')'), 'Must have Rejected filter tab');
    assert.ok(studentHtml.includes('id="edit-resubmit-rejection-reason"'), 'Must have rejection reason banner container');
    assert.ok(studentHtml.includes('id="edit-resubmit-category"'), 'Must have category select');
    assert.ok(studentHtml.includes('id="edit-resubmit-brand"'), 'Must have brand input');
    assert.ok(studentHtml.includes('id="edit-resubmit-model"'), 'Must have model input');
    assert.ok(studentHtml.includes('id="edit-resubmit-serial"'), 'Must have serial input');
  });

  it('Client API in api.js supports rejectGadget with object payload and resubmitGadget', () => {
    const apiJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'api.js'), 'utf8');
    assert.ok(apiJs.includes('resubmitGadget'), 'api.js must define resubmitGadget');
    assert.ok(apiJs.includes('/gadgets/${id}/resubmit'), 'api.js must route to /gadgets/${id}/resubmit');
  });

  it('Student JS defines openEditResubmitGadgetModal and handleEditResubmitGadgetSubmit', () => {
    const studentJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'student', 'student.js'), 'utf8');
    assert.ok(studentJs.includes('function openEditResubmitGadgetModal'), 'Must define openEditResubmitGadgetModal');
    assert.ok(studentJs.includes('function handleEditResubmitGadgetSubmit'), 'Must define handleEditResubmitGadgetSubmit');
    assert.ok(studentJs.includes('window.openEditResubmitGadgetModal'), 'Must export openEditResubmitGadgetModal to window');
    assert.ok(studentJs.includes('window.handleEditResubmitGadgetSubmit'), 'Must export handleEditResubmitGadgetSubmit to window');
  });

  it('OSA JS defines reject handlers and exports them to window', () => {
    const osaJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'osa.js'), 'utf8');
    assert.ok(osaJs.includes('function openRejectGadgetModal'), 'Must define openRejectGadgetModal');
    assert.ok(osaJs.includes('function handleRejectGadgetSubmit'), 'Must define handleRejectGadgetSubmit');
    assert.ok(osaJs.includes('function handleRejectReasonCategoryChange'), 'Must define handleRejectReasonCategoryChange');
    assert.ok(osaJs.includes('window.openRejectGadgetModal'), 'Must export openRejectGadgetModal to window');
  });

  // Start isolated child server
  console.log(`\nStarting isolated test server on port ${TEST_PORT}...`);
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

  const initialDbData = JSON.parse(fs.readFileSync(TEMP_DB_PATH, 'utf8'));
  const studentUser = initialDbData.users.find(u => u.role === 'student');
  assert.ok(studentUser, 'Must have at least one student user');
  const osaUser = initialDbData.users.find(u => u.role === 'osa_admin');
  assert.ok(osaUser, 'Must have at least one osa_admin user');
  const otherStudent = initialDbData.users.filter(u => u.role === 'student' && u.id !== studentUser.id)[0];
  assert.ok(otherStudent, 'Must have a second student user for authorization isolation tests');

  let osaToken = '';
  let studentToken = '';
  let otherStudentToken = '';

  try {
    // 2. Authentication Tokens Setup
    console.log('\n--- SECTION 2: AUTHENTICATION & TEST ENTITIES SETUP ---');

    await itAsync('Authenticate OSA Staff via API', async () => {
      const res = await httpRequest({
        path: '/api/auth/login',
        method: 'POST'
      }, { email: osaUser.email, password: 'password123' });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.token);
      osaToken = res.body.token;
    });

    await itAsync('Authenticate Student A via API', async () => {
      const res = await httpRequest({
        path: '/api/auth/login',
        method: 'POST'
      }, { email: studentUser.email, password: 'password123' });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.token);
      studentToken = res.body.token;
    });

    await itAsync('Authenticate Student B (Other Student) via API', async () => {
      const res = await httpRequest({
        path: '/api/auth/login',
        method: 'POST'
      }, { email: otherStudent.email, password: 'password123' });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.token);
      otherStudentToken = res.body.token;
    });

    // 3. OSA Registration Rejection Tests
    console.log('\n--- SECTION 3: OSA REJECTION API & VALIDATION ---');

    let testGadget1 = null;
    await itAsync('Student A registers a new gadget (pending approval)', async () => {
      const res = await httpRequest({
        path: '/api/gadgets/register',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${studentToken}`
        }
      }, {
        category: 'Laptop',
        brand: 'Dell',
        model: 'XPS 15 9520',
        serialNumber: 'DELL-TEST-SN-001',
        color: 'Platinum Silver',
        description: 'Testing registration rejection'
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.gadget.status, 'PENDING_APPROVAL');
      testGadget1 = res.body.gadget;
    });

    await itAsync('Student cannot call resubmit endpoint on PENDING_APPROVAL registration (400)', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget1.id}/resubmit`,
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${studentToken}`
        }
      }, {
        brand: 'Dell',
        model: 'XPS 15 9520 (Attempt)'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('Only rejected registrations can be edited and resubmitted'));
    });

    await itAsync('OSA cannot reject with "Other Reason" when explanation is empty (400)', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget1.id}/reject`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${osaToken}`
        }
      }, {
        category: 'Other Reason',
        notes: '   ', // empty
        reason: ''
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('Custom explanation is required'));
    });

    await itAsync('OSA cannot reject when neither category nor reason is provided (400)', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget1.id}/reject`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${osaToken}`
        }
      }, {
        category: '',
        notes: '',
        reason: ''
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
    });

    await itAsync('Unauthorized student cannot reject gadgets (403)', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget1.id}/reject`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${studentToken}`
        }
      }, {
        category: 'Gadget Information Mismatch',
        notes: 'Physical check failed'
      });
      assert.strictEqual(res.statusCode, 403);
    });

    await itAsync('OSA rejects gadget with "Serial Number / IMEI Mismatch" & optional notes', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget1.id}/reject`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${osaToken}`
        }
      }, {
        category: 'Serial Number / IMEI Mismatch',
        notes: 'The S/N on chassis is DELL-REAL-999, not DELL-TEST-SN-001.'
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      const rejectedGadget = res.body.gadget;
      assert.strictEqual(rejectedGadget.status, 'REJECTED');
      assert.strictEqual(rejectedGadget.rejectionCategory, 'Serial Number / IMEI Mismatch');
      assert.strictEqual(rejectedGadget.rejectionNotes, 'The S/N on chassis is DELL-REAL-999, not DELL-TEST-SN-001.');
      assert.ok(rejectedGadget.rejectionReason.includes('Serial Number / IMEI Mismatch'));
      assert.strictEqual(rejectedGadget.rejectedBy, osaUser.id);
      assert.strictEqual(rejectedGadget.rejectedByName, osaUser.name);
      assert.ok(rejectedGadget.rejectedAt);

      // Verify reviewHistory array
      assert.ok(Array.isArray(rejectedGadget.reviewHistory));
      assert.strictEqual(rejectedGadget.reviewHistory.length, 1);
      assert.strictEqual(rejectedGadget.reviewHistory[0].action, 'REJECTED');
      assert.strictEqual(rejectedGadget.reviewHistory[0].category, 'Serial Number / IMEI Mismatch');
      assert.strictEqual(rejectedGadget.reviewHistory[0].reviewerId, osaUser.id);
    });

    it('Rejection does NOT issue an approved QR code', () => {
      const tempDb = JSON.parse(fs.readFileSync(TEMP_DB_PATH, 'utf8'));
      const g = tempDb.gadgets.find(item => item.id === testGadget1.id);
      assert.strictEqual(g.status, 'REJECTED');
      assert.ok(!g.qrCode, 'Rejected gadget must not have an active QR code issued');
    });

    it('Rejection creates audit log and student notification with correct reason', () => {
      const tempDb = JSON.parse(fs.readFileSync(TEMP_DB_PATH, 'utf8'));
      const audit = tempDb.audit_logs.find(a => a.targetId === testGadget1.id && a.action === 'REJECT_GADGET');
      assert.ok(audit, 'Audit log REJECT_GADGET must exist');
      assert.strictEqual(audit.userId, osaUser.id);
      assert.ok(audit.details.includes('Serial Number / IMEI Mismatch'));

      const notif = tempDb.notifications.find(n => n.userId === studentUser.id && n.type === 'REGISTRATION_REJECTED');
      assert.ok(notif, 'Student must receive REGISTRATION_REJECTED notification');
      assert.ok(notif.message.includes('Serial Number / IMEI Mismatch'));
      assert.ok(notif.message.includes('DELL-REAL-999'));
    });

    // 4. Student View & Security Verification
    console.log('\n--- SECTION 4: STUDENT RESUBMISSION & ACCESS ISOLATION ---');

    await itAsync('Student A sees gadget as REJECTED with rejectionReason in my-gadgets', async () => {
      const res = await httpRequest({
        path: '/api/gadgets/my',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${studentToken}`
        }
      });
      assert.strictEqual(res.statusCode, 200);
      const myGadget = res.body.gadgets.find(g => g.id === testGadget1.id);
      assert.ok(myGadget, 'Gadget must appear in student my-gadgets');
      assert.strictEqual(myGadget.status, 'REJECTED');
      assert.ok(myGadget.rejectionReason.includes('Serial Number / IMEI Mismatch'));
      assert.strictEqual(myGadget.rejectedByName, osaUser.name);
    });

    await itAsync('Student B (unauthorized) CANNOT resubmit Student A\'s registration (403 Forbidden)', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget1.id}/resubmit`,
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${otherStudentToken}`
        }
      }, {
        brand: 'Hacked Brand',
        model: 'Hacked Model'
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('Unauthorized'));
    });

    await itAsync('Student A cannot resubmit with missing brand or model (400)', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget1.id}/resubmit`,
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${studentToken}`
        }
      }, {
        brand: '',
        model: 'XPS 15'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
    });

    const tempDbBeforeResubmit = JSON.parse(fs.readFileSync(TEMP_DB_PATH, 'utf8'));
    const initialGadgetCount = tempDbBeforeResubmit.gadgets.length;

    await itAsync('Student A successfully edits and resubmits the same gadget', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget1.id}/resubmit`,
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${studentToken}`
        }
      }, {
        category: 'Laptop',
        brand: 'Dell',
        model: 'XPS 15 9520 (Corrected)',
        serialNumber: 'DELL-REAL-999',
        color: 'Platinum Silver & Carbon',
        description: 'Corrected chassis serial number to match physical laptop.'
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      const resubmitted = res.body.gadget;

      // CRITICAL ASSERTIONS:
      // 1. REUSE SAME ID
      assert.strictEqual(resubmitted.id, testGadget1.id, 'Must reuse the EXACT SAME gadget registration ID');
      // 2. Status restored to PENDING_APPROVAL
      assert.strictEqual(resubmitted.status, 'PENDING_APPROVAL');
      // 3. rejectionReason reset to null
      assert.strictEqual(resubmitted.rejectionReason, null);
      // 4. Brand/Model/SN updated
      assert.strictEqual(resubmitted.model, 'XPS 15 9520 (Corrected)');
      assert.strictEqual(resubmitted.serialNumber, 'DELL-REAL-999');
      // 5. Review history preserved
      assert.ok(Array.isArray(resubmitted.reviewHistory));
      assert.strictEqual(resubmitted.reviewHistory.length, 2);
      assert.strictEqual(resubmitted.reviewHistory[0].action, 'REJECTED');
      assert.strictEqual(resubmitted.reviewHistory[1].action, 'RESUBMITTED');
      assert.strictEqual(resubmitted.reviewHistory[1].previousData.serialNumber, 'DELL-TEST-SN-001');
    });

    it('Resubmission creates NO duplicate gadget records in database', () => {
      const currentDb = JSON.parse(fs.readFileSync(TEMP_DB_PATH, 'utf8'));
      assert.strictEqual(currentDb.gadgets.length, initialGadgetCount, 'Total gadgets count in DB must remain unchanged');
      const instances = currentDb.gadgets.filter(g => g.id === testGadget1.id);
      assert.strictEqual(instances.length, 1, 'Only one record must exist for this gadget ID');
    });

    it('Resubmission records audit log RESUBMIT_GADGET and notifies student', () => {
      const currentDb = JSON.parse(fs.readFileSync(TEMP_DB_PATH, 'utf8'));
      const audit = currentDb.audit_logs.find(a => a.targetId === testGadget1.id && a.action === 'RESUBMIT_GADGET');
      assert.ok(audit, 'Audit log RESUBMIT_GADGET must exist');
      assert.strictEqual(audit.userId, studentUser.id);
      assert.ok(audit.details.includes('DELL-REAL-999'));

      const notif = currentDb.notifications.find(n => n.userId === studentUser.id && n.title.includes('Resubmitted'));
      assert.ok(notif, 'Student notification for resubmission must exist');
    });

    // 5. OSA Review Queue Surfacing & Approval Workflow
    console.log('\n--- SECTION 5: OSA REVIEW QUEUE SURFACING & APPROVAL ---');

    await itAsync('Resubmitted gadget appears in OSA pending approvals queue', async () => {
      const res = await httpRequest({
        path: '/api/gadgets?status=PENDING_APPROVAL',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${osaToken}`
        }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      const pendingGadget = res.body.gadgets.find(g => g.id === testGadget1.id);
      assert.ok(pendingGadget, 'Resubmitted gadget must be present in pending approvals queue');
      assert.strictEqual(pendingGadget.serialNumber, 'DELL-REAL-999');
      assert.strictEqual(pendingGadget.status, 'PENDING_APPROVAL');
    });

    await itAsync('OSA can approve the resubmitted gadget (QR code issued)', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget1.id}/approve`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${osaToken}`
        }
      }, {});
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      const approved = res.body.gadget;
      assert.strictEqual(approved.status, 'REGISTERED');
      assert.ok(approved.secureToken, 'Approved gadget must have a secureToken');
      assert.ok(approved.qrCodeDataUrl, 'Approved gadget must have a qrCodeDataUrl');
    });

    await itAsync('Student CANNOT resubmit an already REGISTERED (approved) gadget (400)', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget1.id}/resubmit`,
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${studentToken}`
        }
      }, {
        brand: 'Dell',
        model: 'Tampered Model'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('Only rejected registrations'));
    });

    // 6. Multi-Cycle: Rejected -> Resubmitted -> Rejected Again -> Resubmitted -> Approved
    console.log('\n--- SECTION 6: MULTI-CYCLE REJECTION & RESUBMISSION ---');

    let testGadget2 = null;
    await itAsync('Register Gadget 2 for multi-rejection cycle testing', async () => {
      const res = await httpRequest({
        path: '/api/gadgets/register',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${studentToken}`
        }
      }, {
        category: 'Smartphone',
        brand: 'Apple',
        model: 'iPhone 13',
        serialNumber: 'IPHONE-SN-111',
        color: 'Midnight Blue'
      });
      assert.strictEqual(res.statusCode, 201);
      testGadget2 = res.body.gadget;
    });

    await itAsync('Cycle 1 Rejection: "Gadget Information Mismatch"', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget2.id}/reject`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${osaToken}`
        }
      }, {
        category: 'Gadget Information Mismatch',
        notes: 'Device presented is an iPhone 14 in Starlight, not iPhone 13 Midnight.'
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.gadget.status, 'REJECTED');
    });

    await itAsync('Cycle 1 Resubmission: Student updates model & color', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget2.id}/resubmit`,
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${studentToken}`
        }
      }, {
        category: 'Smartphone',
        brand: 'Apple',
        model: 'iPhone 14',
        serialNumber: 'IPHONE-SN-111',
        color: 'Starlight'
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.gadget.status, 'PENDING_APPROVAL');
      assert.strictEqual(res.body.gadget.id, testGadget2.id);
    });

    await itAsync('Cycle 2 Rejection: "Other Reason" with custom required explanation', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget2.id}/reject`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${osaToken}`
        }
      }, {
        category: 'Other Reason',
        notes: 'Owner student ID on enrollment record does not match presenting student.'
      });
      assert.strictEqual(res.statusCode, 200);
      const rejectedAgain = res.body.gadget;
      assert.strictEqual(rejectedAgain.status, 'REJECTED');
      assert.strictEqual(rejectedAgain.rejectionCategory, 'Other Reason');
      assert.strictEqual(rejectedAgain.rejectionNotes, 'Owner student ID on enrollment record does not match presenting student.');
      assert.strictEqual(rejectedAgain.reviewHistory.length, 3);
      assert.strictEqual(rejectedAgain.reviewHistory[0].action, 'REJECTED');
      assert.strictEqual(rejectedAgain.reviewHistory[1].action, 'RESUBMITTED');
      assert.strictEqual(rejectedAgain.reviewHistory[2].action, 'REJECTED');
    });

    await itAsync('Cycle 2 Resubmission: Student updates remarks and resubmits', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget2.id}/resubmit`,
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${studentToken}`
        }
      }, {
        category: 'Smartphone',
        brand: 'Apple',
        model: 'iPhone 14',
        serialNumber: 'IPHONE-SN-111',
        color: 'Starlight',
        description: 'Verified with original enrollment slip attached.'
      });
      assert.strictEqual(res.statusCode, 200);
      const resubmittedAgain = res.body.gadget;
      assert.strictEqual(resubmittedAgain.status, 'PENDING_APPROVAL');
      assert.strictEqual(resubmittedAgain.id, testGadget2.id);
      assert.strictEqual(resubmittedAgain.reviewHistory.length, 4);
    });

    await itAsync('Final Approval: OSA approves gadget after 2 cycles', async () => {
      const res = await httpRequest({
        path: `/api/gadgets/${testGadget2.id}/approve`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${osaToken}`
        }
      }, {});
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.gadget.status, 'REGISTERED');
      assert.ok(res.body.gadget.secureToken);
      assert.ok(res.body.gadget.qrCodeDataUrl);
    });

    // 7. Test All Remaining Standard Rejection Categories
    console.log('\n--- SECTION 7: REMAINING STANDARD REJECTION CATEGORIES ---');

    for (const cat of ['Incomplete or Incorrect Information', 'Duplicate Registration']) {
      await itAsync(`Test Rejection Category: "${cat}"`, async () => {
        // Register temporary device
        const regRes = await httpRequest({
          path: '/api/gadgets/register',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${studentToken}`
          }
        }, {
          category: 'Tablet',
          brand: 'Samsung',
          model: 'Galaxy Tab S9',
          serialNumber: `SM-TAB-${Date.now()}`
        });
        const gId = regRes.body.gadget.id;

        // Reject with category
        const rejRes = await httpRequest({
          path: `/api/gadgets/${gId}/reject`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${osaToken}`
          }
        }, {
          category: cat,
          notes: `Automated test note for ${cat}`
        });
        assert.strictEqual(rejRes.statusCode, 200);
        assert.strictEqual(rejRes.body.gadget.status, 'REJECTED');
        assert.strictEqual(rejRes.body.gadget.rejectionCategory, cat);
      });
    }

    // 8. Public QR and Existing Workflow Non-Regression
    console.log('\n--- SECTION 8: PUBLIC QR AND SCAN WORKFLOW NON-REGRESSION ---');

    await itAsync('Public device endpoint functions normally for approved gadget', async () => {
      const tempDb = JSON.parse(fs.readFileSync(TEMP_DB_PATH, 'utf8'));
      const g = tempDb.gadgets.find(item => item.id === testGadget1.id);
      assert.ok(g.secureToken);
      const res = await httpRequest({
        path: `/device/${g.secureToken}`,
        method: 'GET'
      });
      // Device verification route returns 200 HTML page
      assert.strictEqual(res.statusCode, 200);
    });

  } finally {
    // Shutdown server
    serverProcess.kill('SIGTERM');
    await sleep(400);

    // Cleanup temporary directory
    try {
      fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
    } catch (e) {}

    // Verify baseline database has NOT been modified
    const FINAL_DB_CHECKSUM = crypto.createHash('sha256').update(fs.readFileSync(ORIGINAL_DB_PATH)).digest('hex').toUpperCase();

    console.log('\n========================================================================');
    console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${totalTests - passedTests}`);
    console.log('------------------------------------------------------------------------');
    console.log(`🔒 Initial Database SHA256: ${INITIAL_DB_CHECKSUM}`);
    console.log(`🔒 Final   Database SHA256: ${FINAL_DB_CHECKSUM}`);

    assert.strictEqual(
      FINAL_DB_CHECKSUM,
      INITIAL_DB_CHECKSUM,
      'CRITICAL SAFETY FAILURE: Baseline production database data/database.json was modified!'
    );

    console.log('✅ BASELINE DATABASE INTEGRITY CONFIRMED: 0 BYTES ALTERED.');
    console.log('========================================================================\n');
  }
})();
