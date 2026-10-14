const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- RUNNING SIGN OUT BUTTON STANDARDIZATION VERIFICATION ---');

const rootDir = path.resolve(__dirname, '..');

const studentHtml = fs.readFileSync(path.join(rootDir, 'public', 'student', 'index.html'), 'utf8');
const osaHtml = fs.readFileSync(path.join(rootDir, 'public', 'osa', 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(rootDir, 'public', 'css', 'style.css'), 'utf8');
const studentCss = fs.readFileSync(path.join(rootDir, 'public', 'student', 'student.css'), 'utf8');
const osaCss = fs.readFileSync(path.join(rootDir, 'public', 'osa', 'osa.css'), 'utf8');

// 1. Emoji checks: No emoji door icons in either portal
assert(!studentHtml.includes('🚪'), 'Student portal should not contain 🚪 emoji');
assert(!osaHtml.includes('🚪'), 'OSA portal should not contain 🚪 emoji');

// 2. Student Portal: Exactly one Sign Out button
const studentButtonMatches = (studentHtml.match(/class="sidebar-signout-btn"/g) || []);
assert.strictEqual(studentButtonMatches.length, 1, `Student portal should have exactly 1 signout button, found ${studentButtonMatches.length}`);
const studentLogoutCalls = (studentHtml.match(/logoutCurrentSession\(\)/g) || []);
assert.strictEqual(studentLogoutCalls.length, 1, `Student portal should have exactly 1 logoutCurrentSession() call, found ${studentLogoutCalls.length}`);

// Student sidebar footer contains the button
assert(studentHtml.includes('class="sidebar-signout-btn"'), 'Student portal must use .sidebar-signout-btn');
assert(studentHtml.includes('onclick="logoutCurrentSession()"'), 'Student portal must call logoutCurrentSession()');
assert(studentHtml.includes('<span>Sign Out</span>'), 'Student portal must have exact label "Sign Out"');

// Student profile card has no Sign Out button
assert(!studentHtml.includes('<button class="btn btn-danger btn-sm" onclick="logoutCurrentSession()">Sign Out</button>'), 'Student profile card must not contain duplicate red Sign Out button');

// 3. OSA Portal: Exactly one Sign Out button
const osaButtonMatches = (osaHtml.match(/class="sidebar-signout-btn"/g) || []);
assert.strictEqual(osaButtonMatches.length, 1, `OSA portal should have exactly 1 signout button, found ${osaButtonMatches.length}`);
const osaLogoutCalls = (osaHtml.match(/logoutCurrentSession\(\)/g) || []);
assert.strictEqual(osaLogoutCalls.length, 1, `OSA portal should have exactly 1 logoutCurrentSession() call, found ${osaLogoutCalls.length}`);

// OSA sidebar footer contains the button
assert(osaHtml.includes('class="sidebar-signout-btn"'), 'OSA portal must use .sidebar-signout-btn');
assert(osaHtml.includes('onclick="logoutCurrentSession()"'), 'OSA portal must call logoutCurrentSession()');
assert(osaHtml.includes('<span>Sign Out</span>'), 'OSA portal must have exact label "Sign Out"');

// OSA top bar has no Sign Out button
const topBarSection = osaHtml.split('<header class="osa-top-bar">')[1].split('</header>')[0];
assert(!topBarSection.includes('Sign Out'), 'OSA top bar must not contain Sign Out button');
assert(!topBarSection.includes('logoutCurrentSession()'), 'OSA top bar must not call logoutCurrentSession()');

// 4. SVG outline icon check in both portals
const svgRegex = /<svg[^>]*>[\s\S]*?<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"[\s\S]*?<polyline points="16 17 21 12 16 7"[\s\S]*?<line x1="21" y1="12" x2="9" y2="12"[\s\S]*?<\/svg>/;

assert(svgRegex.test(studentHtml), 'Student portal must have valid outline Lucide log-out SVG icon');
assert(svgRegex.test(osaHtml), 'OSA portal must have valid outline Lucide log-out SVG icon');

// 5. CSS checks: footer pinned to bottom on both desktop and mobile
assert(styleCss.includes('.sidebar-signout-btn'), 'style.css must define .sidebar-signout-btn');
assert(styleCss.includes('.sidebar-signout-btn:hover'), 'style.css must define hover state');
assert(studentCss.includes('.student-sidebar-footer') && studentCss.includes('margin-top: auto;') && studentCss.includes('flex-shrink: 0;'), '.student-sidebar-footer must have margin-top: auto and flex-shrink: 0');
assert(osaCss.includes('.osa-sidebar-footer') && osaCss.includes('margin-top: auto;') && osaCss.includes('flex-shrink: 0;'), '.osa-sidebar-footer must have margin-top: auto and flex-shrink: 0');

console.log('✅ ALL SIGN OUT BUTTON STANDARDIZATION TESTS PASSED!');
process.exit(0);
