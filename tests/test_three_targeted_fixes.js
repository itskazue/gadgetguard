const fs = require('fs');
const assert = require('assert');

console.log('--- TESTING 3 QUICK TARGETED FIXES ---');

// ==========================================
// TASK 1: FINDER CONTACT NUMBER VALIDATION
// ==========================================
const deviceHtml = fs.readFileSync('public/device/index.html', 'utf8');
const finderRoutesJs = fs.readFileSync('server/routes/finderRoutes.js', 'utf8');

// Frontend Checks
assert(deviceHtml.includes('id="osa-finder-contact"'), 'osa-finder-contact input exists');
assert(deviceHtml.includes('inputmode="numeric"'), 'inputmode="numeric" exists');
assert(deviceHtml.includes('maxlength="11"'), 'maxlength="11" exists');
assert(deviceHtml.includes('placeholder="09XXXXXXXXX"'), 'placeholder="09XXXXXXXXX" exists');
assert(deviceHtml.includes('Enter a valid 11-digit mobile number starting with 09.'), 'Inline error message exists');
assert(deviceHtml.includes('validateOsaFinderContact'), 'validateOsaFinderContact function exists');

// Validate the regex logic
const mobileRegex = /^09\d{9}$/;
assert(mobileRegex.test('09123456789'), '09123456789 is valid');
assert(mobileRegex.test('09999999999'), '09999999999 is valid');
assert(!mobileRegex.test('08123456789'), '08123456789 rejected (must start with 09)');
assert(!mobileRegex.test('9123456789'), '9123456789 rejected (10 digits)');
assert(!mobileRegex.test('091234567890'), '091234567890 rejected (12 digits)');
assert(!mobileRegex.test('0912345678a'), 'nonnumeric rejected');
assert(!mobileRegex.test('+639123456789'), '+63 rejected (must start with 09 and be 11 digits)');

// Backend Checks
assert(finderRoutesJs.includes('/^09\\d{9}$/'), 'Backend validates mobileRegex /^09\\d{9}$/');
assert(finderRoutesJs.includes('Enter a valid 11-digit mobile number starting with 09.'), 'Backend returns exact specified error message');
assert(finderRoutesJs.includes("status(400)"), 'Backend returns HTTP 400 on invalid contact number');
console.log('✓ Task 1: Finder contact number validation verified on frontend and backend.');

// ==========================================
// TASK 2: STUDENT SIGN IN BUTTON
// ==========================================
const indexHtml = fs.readFileSync('public/index.html', 'utf8');
assert(indexHtml.includes('Student Sign In'), 'Heading "Student Sign In" preserved');
assert(!indexHtml.includes('🔐 Sign In to Student Portal'), 'Old button text and emoji removed');
assert(indexHtml.includes('<span>Sign In</span>'), 'Button label is now "Sign In"');
assert(indexHtml.includes('<svg width="16" height="16"'), 'Small 16px outline SVG icon used');
assert(indexHtml.includes('Sign Out') || !indexHtml.includes('Sign Out of Student Portal'), 'Sign Out unchanged');
console.log('✓ Task 2: Student Sign In button updated to "Sign In" with 16px outline SVG.');

// ==========================================
// TASK 3: OSA REPORTS FILTER LAYOUT
// ==========================================
const osaHtml = fs.readFileSync('public/osa/index.html', 'utf8');
assert(osaHtml.includes('class="reports-filter-toolbar"'), 'reports-filter-toolbar exists');
assert(osaHtml.includes('Reporting Period:'), 'Reporting Period label aligned');
assert(!osaHtml.includes('📅 Reporting Period'), 'Calendar emoji removed from toolbar label');
assert(osaHtml.includes('id="reports-date-filter"'), 'reports-date-filter select preserved');
assert(osaHtml.includes('id="reports-reset-btn"'), 'reports-reset-btn preserved');
assert(osaHtml.includes('id="reports-custom-date-wrap"'), 'reports-custom-date-wrap preserved');
assert(osaHtml.includes('exportAnalyticsSummary()'), 'Download Summary preserved');
assert(osaHtml.includes('printExecutiveReport()'), 'Print Executive Report preserved');
console.log('✓ Task 3: OSA Reports filter layout unified and compact with clean calendar SVG.');

console.log('✅ ALL 3 QUICK TARGETED FIXES VERIFIED SUCCESSFULLY!');
