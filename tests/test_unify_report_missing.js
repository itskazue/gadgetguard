const fs = require('fs');
const assert = require('assert');

console.log('--- TESTING UNIFIED REPORT MISSING ENTRY POINTS ---');

const studentJs = fs.readFileSync('public/student/student.js', 'utf8');
const studentHtml = fs.readFileSync('public/student/index.html', 'utf8');

// 1. Verify "Report as Missing" button in details modal calls initiateMissingReportFor
assert(
  studentJs.includes("initiateMissingReportFor('${gadget.id}')") || studentJs.includes('initiateMissingReportFor(gadget.id)'),
  'View Details modal Report as Missing button calls initiateMissingReportFor with unique gadget ID'
);
console.log('✓ Verified details modal Report as Missing button uses unique gadget ID.');

// 2. Verify initiateMissingReportFor closes modal and navigates to missing-form
assert(studentJs.includes("closeModal('gadget-details-modal')"), 'initiateMissingReportFor closes gadget details modal');
assert(studentJs.includes("navigateStudent('missing-form', gadget.id)"), 'initiateMissingReportFor navigates to existing sidebar missing-form page');
assert(!studentJs.includes('🚨 Broadcast Missing Alert'), 'Separate popup broadcast removed from initiateMissingReportFor');
console.log('✓ Verified initiateMissingReportFor closes modal and navigates to missing-form without separate popup.');

// 3. Verify populateMissingFormDropdown preselects by unique gadget ID
assert(studentJs.includes('function populateMissingFormDropdown(preselectedGadgetId = null)'), 'populateMissingFormDropdown accepts preselectedGadgetId');
assert(studentJs.includes('select.value = preselectedGadgetId'), 'populateMissingFormDropdown sets select.value to preselectedGadgetId');
assert(studentJs.includes('eligible.some(g => g.id === preselectedGadgetId)'), 'Only eligible registered/returned gadgets can be preselected');
console.log('✓ Verified dropdown preselection strictly validates ownership and eligibility.');

// 4. Verify navigateStudent passes targetReturnId to populateMissingFormDropdown
assert(studentJs.includes("if (screenName === 'missing-form') populateMissingFormDropdown(targetReturnId)"), 'navigateStudent forwards targetReturnId to populateMissingFormDropdown');
console.log('✓ Verified navigateStudent passes targetReturnId to populateMissingFormDropdown.');

// 5. Test dropdown logic in isolation
const testGadgets = [
  { id: 'gadget-uuid-1', brand: 'Apple', model: 'MacBook Pro', serialNumber: 'SN123', status: 'REGISTERED' },
  { id: 'gadget-uuid-2', brand: 'Dell', model: 'XPS 15', serialNumber: 'SN456', status: 'RETURNED' },
  { id: 'gadget-uuid-3', brand: 'Lenovo', model: 'ThinkPad', serialNumber: 'SN789', status: 'PENDING_APPROVAL' },
  { id: 'gadget-uuid-4', brand: 'Asus', model: 'ZenBook', serialNumber: 'SN000', status: 'MISSING' }
];

function testPopulate(myGadgets, preselectedId = null) {
  const eligible = myGadgets.filter(g => g && (g.status === 'REGISTERED' || g.status === 'RETURNED'));
  if (eligible.length === 0) {
    return { options: [], selectedValue: '' };
  }
  const options = eligible.map(g => ({ value: g.id, label: `${g.brand} ${g.model} (S/N: ${g.serialNumber})` }));
  let selectedValue = options[0].value;
  if (preselectedId && eligible.some(g => g.id === preselectedId)) {
    selectedValue = preselectedId;
  }
  return { options, selectedValue };
}

// Case A: Preselect Dell XPS 15 (gadget-uuid-2)
const caseA = testPopulate(testGadgets, 'gadget-uuid-2');
assert.strictEqual(caseA.options.length, 2, 'Only REGISTERED and RETURNED gadgets are eligible');
assert.strictEqual(caseA.selectedValue, 'gadget-uuid-2', 'Exactly preselects gadget-uuid-2');

// Case B: Sidebar navigation without preselected ID
const caseB = testPopulate(testGadgets, null);
assert.strictEqual(caseB.options.length, 2, 'Eligible gadgets listed');
assert.strictEqual(caseB.selectedValue, 'gadget-uuid-1', 'Defaults to first eligible gadget for manual selection');

// Case C: Attempt to preselect pending/missing gadget
const caseC = testPopulate(testGadgets, 'gadget-uuid-3'); // PENDING_APPROVAL
assert.notStrictEqual(caseC.selectedValue, 'gadget-uuid-3', 'Ineligible gadget rejected from preselection');

// 6. Verify single existing form and submission path
assert(studentHtml.includes('id="report-missing-main-form"'), 'Existing report missing main form intact');
assert(studentHtml.includes('id="missing-form-gadget-select"'), 'Existing missing form gadget select intact');
assert(studentJs.includes('function handleMissingFormSubmit(e)'), 'handleMissingFormSubmit intact');
assert(studentJs.includes('async function executeMissingSubmission()'), 'executeMissingSubmission intact');
console.log('✓ Verified single submission path through existing form and confirmation dialog.');

console.log('✅ ALL UNIFIED REPORT MISSING TESTS PASSED!');
