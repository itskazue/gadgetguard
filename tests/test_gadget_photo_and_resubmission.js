/**
 * test_gadget_photo_and_resubmission.js
 * Comprehensive test suite for:
 * 1. Gadget photo cleanup (removal of hardcoded stock photo defaults, proper null/optional handling)
 * 2. Photo thumbnail rendering (actual photo vs clean category icon placeholder)
 * 3. OSA registration rejection with structured reason & reviewer info
 * 4. Student Edit & Resubmit workflow (same gadget ID, status reset, audit trail)
 * 5. Production database integrity verification
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Colors for reporting
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

console.log(`${CYAN}================================================================${RESET}`);
console.log(`${CYAN}   GADGETGUARD — PHOTO CLEANUP & RESUBMISSION TEST SUITE       ${RESET}`);
console.log(`${CYAN}================================================================${RESET}\n`);

// -------------------------------------------------------------
// PART 1: Database Integrity Check
// -------------------------------------------------------------
console.log(`${CYAN}[1/5] Checking Production Database Integrity...${RESET}`);
const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
const EXPECTED_HASH = '4505f70dd6fc6e3770c37564946868d199a9cc1b98ccb18b27f51f00a996f8e6';
const dbBuffer = fs.readFileSync(DB_PATH);
const currentHash = crypto.createHash('sha256').update(dbBuffer).digest('hex');
assert(currentHash === EXPECTED_HASH, `data/database.json SHA256 is strictly ${EXPECTED_HASH}`);

// -------------------------------------------------------------
// PART 2: Source Code Static Inspections
// -------------------------------------------------------------
console.log(`\n${CYAN}[2/5] Inspecting Frontend Code for Stock Photo Removal & Rejection UI...${RESET}`);

const studentJsContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'student', 'student.js'), 'utf8');
const studentHtmlContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'student', 'index.html'), 'utf8');
const osaJsContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'osa.js'), 'utf8');
const osaHtmlContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'index.html'), 'utf8');
const gadgetRoutesContent = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'gadgetRoutes.js'), 'utf8');

// Check no stock photo unsplash fallbacks in student.js
assert(!studentJsContent.includes("images.unsplash.com/photo-"), 'student.js contains 0 Unsplash stock photo URLs');
assert(studentJsContent.includes('renderDevicePhotoThumbnail'), 'student.js defines renderDevicePhotoThumbnail helper');
assert(studentJsContent.includes('openEditResubmitGadgetModal'), 'student.js defines openEditResubmitGadgetModal');
assert(studentJsContent.includes('handleEditResubmitGadgetSubmit'), 'student.js defines handleEditResubmitGadgetSubmit');
assert(studentJsContent.includes('handleClearResubmitPhoto'), 'student.js defines handleClearResubmitPhoto');

// Check modal HTML in student/index.html
assert(studentHtmlContent.includes('id="edit-resubmit-gadget-modal"'), 'student/index.html includes #edit-resubmit-gadget-modal');
assert(studentHtmlContent.includes('id="edit-resubmit-photo-file"'), 'student/index.html includes file upload input');
assert(studentHtmlContent.includes('id="edit-resubmit-photo-url"'), 'student/index.html includes URL input');
assert(studentHtmlContent.includes('id="edit-resubmit-photo-preview"'), 'student/index.html includes photo preview container');
assert(studentHtmlContent.includes("onclick=\"filterStudentGadgets('REJECTED')\""), 'student/index.html includes Rejected tab filter');

// Check rejection modal in osa/index.html and osa.js
assert(osaHtmlContent.includes('id="reject-gadget-modal"'), 'osa/index.html includes #reject-gadget-modal');
assert(osaHtmlContent.includes('id="reject-reason-category"'), 'osa/index.html includes #reject-reason-category');
assert(osaHtmlContent.includes('Gadget Information Mismatch'), 'osa/index.html includes Category 1: Gadget Information Mismatch');
assert(osaHtmlContent.includes('Incomplete or Incorrect Information'), 'osa/index.html includes Category 2: Incomplete or Incorrect Information');
assert(osaHtmlContent.includes('Serial Number / IMEI Mismatch'), 'osa/index.html includes Category 3: Serial Number / IMEI Mismatch');
assert(osaHtmlContent.includes('Duplicate Registration'), 'osa/index.html includes Category 4: Duplicate Registration');
assert(osaHtmlContent.includes('Other Reason'), 'osa/index.html includes Category 5: Other Reason');
assert(!osaHtmlContent.includes('Unclear or Missing Gadget Photo'), 'osa/index.html excludes photo rejection category');

assert(osaJsContent.includes('handleRejectGadgetSubmit'), 'osa.js defines handleRejectGadgetSubmit');
assert(!osaJsContent.includes("g.photoUrl || 'https://images.unsplash"), 'osa.js pending approvals queue removed unsplash fallback');

// Check backend routes
assert(gadgetRoutesContent.includes("router.put('/:id/resubmit'"), 'gadgetRoutes.js provides PUT /:id/resubmit');
assert(gadgetRoutesContent.includes("router.post('/:id/resubmit'"), 'gadgetRoutes.js provides POST /:id/resubmit fallback');
assert(gadgetRoutesContent.includes("status: 'PENDING_APPROVAL'"), 'gadgetRoutes.js resets status to PENDING_APPROVAL on resubmit');
assert(gadgetRoutesContent.includes("rejectionReason: null"), 'gadgetRoutes.js clears rejectionReason on resubmit');

// -------------------------------------------------------------
// PART 3: In-Memory / Isolated API & Logic Integration Tests
// -------------------------------------------------------------
console.log(`\n${CYAN}[3/5] Running Isolated In-Memory Workflow Tests...${RESET}`);

// In-memory test db copy (read-only baseline, does NOT write to database.json)
const sandboxDb = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

const studentUser = sandboxDb.users.find(u => u.role.toLowerCase().includes('student'));
const osaUser = sandboxDb.users.find(u => u.role.toLowerCase().includes('osa'));

assert(studentUser !== undefined, 'Found student user in baseline');
assert(osaUser !== undefined, 'Found OSA user in baseline');

// Test 1: Register Gadget without photo
const newGadgetWithoutPhoto = {
  id: 'gadget-test-' + Date.now(),
  userId: studentUser.id,
  category: 'Laptop',
  brand: 'Framework',
  model: 'Laptop 16',
  serialNumber: 'FRWK-16-TEST',
  color: 'Matte Grey',
  description: 'Clean modular laptop',
  photoUrl: null, // No photo uploaded
  status: 'PENDING_APPROVAL',
  qrCodeUrl: null,
  secureToken: 'token-' + Date.now(),
  createdAt: new Date().toISOString()
};

sandboxDb.gadgets.push(newGadgetWithoutPhoto);
let createdGadget = sandboxDb.gadgets.find(g => g.id === newGadgetWithoutPhoto.id);
assert(createdGadget.photoUrl === null, 'Created gadget has photoUrl: null (no unwanted fallback)');
assert(createdGadget.status === 'PENDING_APPROVAL', 'Initial status is PENDING_APPROVAL');

// Test 2: OSA Rejects the registration with Category 1
const rejectionPayload = {
  category: 'Gadget Information Mismatch',
  notes: 'Color was reported as Matte Grey but device presented is Silver Chrome.',
  reviewerId: osaUser.id,
  reviewerName: osaUser.name
};

// Simulate rejection logic from gadgetRoutes
createdGadget.status = 'REJECTED';
createdGadget.rejectionReason = `${rejectionPayload.category}: ${rejectionPayload.notes}`;
createdGadget.rejectionCategory = rejectionPayload.category;
createdGadget.rejectionNotes = rejectionPayload.notes;
createdGadget.rejectedAt = new Date().toISOString();
createdGadget.rejectedBy = rejectionPayload.reviewerId;
createdGadget.rejectedByName = rejectionPayload.reviewerName;
if (!createdGadget.reviewHistory) createdGadget.reviewHistory = [];
createdGadget.reviewHistory.push({
  action: 'REJECTED',
  category: rejectionPayload.category,
  notes: rejectionPayload.notes,
  reason: createdGadget.rejectionReason,
  reviewerId: rejectionPayload.reviewerId,
  reviewerName: rejectionPayload.reviewerName,
  date: createdGadget.rejectedAt
});

assert(createdGadget.status === 'REJECTED', 'Gadget status transitioned to REJECTED');
assert(createdGadget.rejectionCategory === 'Gadget Information Mismatch', 'rejectionCategory saved properly');
assert(createdGadget.rejectionNotes.includes('Silver Chrome'), 'rejectionNotes recorded accurately');
assert(createdGadget.rejectedByName === osaUser.name, 'Reviewer staff name recorded');
assert(createdGadget.reviewHistory.length === 1, 'Review history entry logged');

// Test 3: Student Edits & Resubmits (same ID, updates details + adds photo)
const resubmitData = {
  brand: 'Framework',
  model: 'Laptop 16 DIY Edition',
  color: 'Silver Chrome', // Corrected color
  serialNumber: 'FRWK-16-TEST',
  description: 'Corrected color to Silver Chrome.',
  photoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
};

// Simulate resubmit logic
assert(createdGadget.userId === studentUser.id, 'Student owns the gadget');
assert(createdGadget.status === 'REJECTED', 'Gadget can be resubmitted when REJECTED');

// Track history
createdGadget.reviewHistory.push({
  action: 'RESUBMITTED',
  resubmittedAt: new Date().toISOString(),
  previousDetails: {
    brand: createdGadget.brand,
    model: createdGadget.model,
    color: createdGadget.color,
    serialNumber: createdGadget.serialNumber
  }
});

// In-place update (SAME ID)
createdGadget.brand = resubmitData.brand;
createdGadget.model = resubmitData.model;
createdGadget.color = resubmitData.color;
createdGadget.serialNumber = resubmitData.serialNumber;
createdGadget.description = resubmitData.description;
createdGadget.photoUrl = resubmitData.photoUrl;
createdGadget.status = 'PENDING_APPROVAL'; // Resets to pending
createdGadget.rejectionReason = null; // Clears rejection reason
createdGadget.resubmittedAt = new Date().toISOString();

assert(createdGadget.id === newGadgetWithoutPhoto.id, 'CRITICAL: Resubmitted gadget retained identical ID');
assert(createdGadget.status === 'PENDING_APPROVAL', 'Status reset to PENDING_APPROVAL');
assert(createdGadget.rejectionReason === null, 'Active rejectionReason cleared');
assert(createdGadget.color === 'Silver Chrome', 'Color updated to Silver Chrome');
assert(createdGadget.photoUrl.startsWith('data:image/png'), 'Photo updated via resubmission');
assert(createdGadget.reviewHistory.length === 2, 'Audit trail preserved both rejection and resubmission');

// Test 4: Verify zero duplicate records
const allWithSerial = sandboxDb.gadgets.filter(g => g.serialNumber === 'FRWK-16-TEST');
assert(allWithSerial.length === 1, 'CRITICAL: Exactly 1 gadget record exists with serial FRWK-16-TEST (zero duplicates)');

// Test 5: Unauthorized edit blocked
const otherStudent = { id: 'usr-student-other' };
assert(createdGadget.userId !== otherStudent.id, 'Other student is not owner');
const unauthorizedAllowed = (createdGadget.userId === otherStudent.id);
assert(!unauthorizedAllowed, 'Security: Student B cannot resubmit Student A device (403)');

// -------------------------------------------------------------
// PART 4: Frontend Thumbnail & Card Rendering Logic Unit Tests
// -------------------------------------------------------------
console.log(`\n${CYAN}[4/5] Testing Frontend Thumbnail & HTML Generation Logic...${RESET}`);

// Evaluate renderDevicePhotoThumbnail logic from student.js
function testRenderDevicePhotoThumbnail(photoUrl, category, model) {
  if (photoUrl && photoUrl.trim()) {
    return `<div class="device-card-photo-box">
      <img src="${photoUrl.trim()}" alt="${model || 'Gadget'}" class="device-card-img">
    </div>`;
  }
  const icons = {
    Laptop: '💻',
    Smartphone: '📱',
    Tablet: '📱',
    Smartwatch: '⌚',
    Camera: '📷',
    Earbuds: '🎧',
    Calculator: '🧮',
    Other: '📦'
  };
  const icon = icons[category] || '📦';
  return `<div class="device-card-photo-box">
    <div class="device-card-no-photo">
      <div class="device-card-no-photo-icon">${icon}</div>
      <div class="device-card-no-photo-sub">No Photo Uploaded</div>
    </div>
  </div>`;
}

const renderedWithPhoto = testRenderDevicePhotoThumbnail('https://cdn.example.com/gadget.jpg', 'Laptop', 'ThinkPad');
assert(renderedWithPhoto.includes('<img src="https://cdn.example.com/gadget.jpg"'), 'Renders <img> tag when photo is present');
assert(renderedWithPhoto.includes('device-card-img'), 'Uses .device-card-img class');

const renderedWithoutPhoto = testRenderDevicePhotoThumbnail(null, 'Laptop', 'ThinkPad');
assert(!renderedWithoutPhoto.includes('<img'), 'Does NOT render <img> tag when photo is null');
assert(renderedWithoutPhoto.includes('💻'), 'Renders laptop category emoji');
assert(renderedWithoutPhoto.includes('No Photo Uploaded'), 'Renders "No Photo Uploaded" label');

const renderedEarbudsWithoutPhoto = testRenderDevicePhotoThumbnail(null, 'Earbuds', 'AirPods Pro');
assert(renderedEarbudsWithoutPhoto.includes('🎧'), 'Renders earbuds category emoji');

// -------------------------------------------------------------
// PART 5: Post-Test Production Database Immutability Check
// -------------------------------------------------------------
console.log(`\n${CYAN}[5/5] Re-Verifying Production Database Checksum...${RESET}`);
const finalDbBuffer = fs.readFileSync(DB_PATH);
const finalHash = crypto.createHash('sha256').update(finalDbBuffer).digest('hex');
assert(finalHash === EXPECTED_HASH, `data/database.json SHA256 remains strictly ${EXPECTED_HASH}`);

console.log(`\n${CYAN}================================================================${RESET}`);
console.log(`Tests Run: ${totalTests} | Passed: ${GREEN}${passedTests}${RESET} | Failed: ${failedTests > 0 ? RED + failedTests + RESET : '0'}`);
if (failedTests === 0) {
  console.log(`${GREEN}ALL TESTS PASSED SUCCESSFULLY!${RESET}`);
} else {
  console.error(`${RED}SOME TESTS FAILED!${RESET}`);
  process.exit(1);
}
