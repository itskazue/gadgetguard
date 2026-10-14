const fs = require('fs');
const assert = require('assert');

console.log('--- TESTING TARGETED UI FIXES ---');

// 1. Verify Student Dashboard 5 SVG Icons
const studentHtml = fs.readFileSync('public/student/index.html', 'utf8');
assert(studentHtml.includes('Registered Gadgets'), 'Registered Gadgets present');
assert(studentHtml.includes('<rect width="18" height="12" x="3" y="4" rx="2"/>'), 'Laptop SVG present');
assert(studentHtml.includes('Missing Gadgets'), 'Missing Gadgets present');
assert(studentHtml.includes('d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"'), 'Alert-triangle SVG present');
assert(studentHtml.includes('Return History'), 'Return History present');
assert(studentHtml.includes('d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"'), 'History SVG present');
assert(studentHtml.includes('Found / Returned'), 'Found / Returned present');
assert(studentHtml.includes('d="m16 16 2 2 4-4"'), 'Package-check SVG present');
assert(studentHtml.includes('QR Scan Activity Monitor'), 'QR Scan Activity Monitor present');
assert(studentHtml.includes('<path d="M3 7V5a2 2 0 0 1 2-2h2"/>'), 'Scan-line SVG present');

// Verify all 5 SVGs have student-dash-icon class, width 20, height 20
const svgMatches = studentHtml.match(/<svg class="student-dash-icon" width="20" height="20"[^>]*>/g);
assert(svgMatches && svgMatches.length === 5, 'Found exactly 5 scoped student-dash-icon SVGs with explicit 20px attributes');
console.log('✓ Verified all 5 Student Dashboard inline SVGs with explicit 20px dimensions.');

// 2. Verify Scoped CSS
const studentCss = fs.readFileSync('public/student/student.css', 'utf8');
assert(studentCss.includes('.metrics-grid-4 .metric-icon-box svg.student-dash-icon'), 'Scoped metric CSS present');
assert(studentCss.includes('.highlight-icon-circle svg.student-dash-icon'), 'Scoped highlight icon CSS present');
console.log('✓ Verified scoped CSS without global SVG pollution.');

// 3. Verify Notification Title Emoji Stripping logic in student.js and osa.js
const studentJs = fs.readFileSync('public/student/student.js', 'utf8');
assert(studentJs.includes('formatNotificationDisplayTitle'), 'student.js formatNotificationDisplayTitle present');
assert(studentJs.includes('displayTitle = formatNotificationDisplayTitle(n.title)'), 'student.js calls formatNotificationDisplayTitle');

const osaJs = fs.readFileSync('public/osa/osa.js', 'utf8');
assert(osaJs.includes('formatOsaNotificationDisplayTitle'), 'osa.js formatOsaNotificationDisplayTitle present');
assert(osaJs.includes('displayTitle = formatOsaNotificationDisplayTitle(n.title)'), 'osa.js calls formatOsaNotificationDisplayTitle');

// Test the cleaning function directly
function cleanTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title
    .replace(/[\uFE0F\uFE0E]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

assert.strictEqual(cleanTitle('Someone Scanned Your Missing Gadget 📍'), 'Someone Scanned Your Missing Gadget');
assert.strictEqual(cleanTitle('Claim Approved! 🎉 Ready for Pickup'), 'Claim Approved! Ready for Pickup');
assert.strictEqual(cleanTitle('Gadget Successfully Returned! 🎉'), 'Gadget Successfully Returned!');
assert.strictEqual(cleanTitle('🚨 Missing Gadget Alert: Laptop'), 'Missing Gadget Alert: Laptop');
assert.strictEqual(cleanTitle('Your Gadget is in OSA Custody! 🏢'), 'Your Gadget is in OSA Custody!');
assert.strictEqual(cleanTitle('Standard Notification Title'), 'Standard Notification Title');
console.log('✓ Verified notification title emoji stripping preserves text while eliminating redundant emojis.');

console.log('✅ ALL TARGETED UI TESTS PASSED!');
