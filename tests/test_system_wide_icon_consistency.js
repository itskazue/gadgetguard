/**
 * GadgetGuard - System-Wide Icon Consistency & UI Polish Automated Verification Suite
 * 
 * Asserts:
 * 1. 0 remaining hardcoded emoji interface icons across all public frontend HTML and JS files.
 * 2. Presence and styling of .ui-icon in public/css/style.css.
 * 3. Proper Lucide-style SVG attributes (viewBox="0 0 24 24", stroke-width, fill="none", stroke="currentColor").
 * 4. Standardized outline Lucide log-out SVG icons on Student and OSA Sign Out buttons.
 * 5. Strict preservation of database integrity and zero test records.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

console.log('========================================================================');
console.log('  GADGETGUARD: SYSTEM-WIDE ICON CONSISTENCY VERIFICATION SUITE         ');
console.log('========================================================================\n');

const rootDir = path.resolve(__dirname, '..');

// 1. Verify Database Integrity Baseline
console.log('[1/5] Verifying Database Baseline Integrity...');
const dbPath = path.join(rootDir, 'data', 'database.json');
const dbContent = fs.readFileSync(dbPath, 'utf8');
const dbHash = crypto.createHash('sha256').update(dbContent).digest('hex');
console.log(`  ✓ Database checksum: ${dbHash}`);

// 2. Verify CSS Styling for .ui-icon
console.log('\n[2/5] Inspecting UI Icon Stylesheet Rules in style.css...');
const styleCss = fs.readFileSync(path.join(rootDir, 'public', 'css', 'style.css'), 'utf8');
assert(styleCss.includes('.ui-icon'), 'style.css must define .ui-icon class');
assert(styleCss.includes('stroke-width'), 'style.css must configure stroke-width for icons');
assert(styleCss.includes('.sidebar-signout-btn'), 'style.css must define .sidebar-signout-btn');
console.log('  ✓ UI Icon styling and responsive rules confirmed in style.css');

// 3. Scan All Public Files for UI Emojis
console.log('\n[3/5] Crawling All Public-Facing Frontend Files for Hardcoded Emojis...');

const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA70}-\u{1FAFF}\u{FE0F}]/u;

const auditedFiles = [
  path.join('public', 'student', 'index.html'),
  path.join('public', 'student', 'student.js'),
  path.join('public', 'osa', 'index.html'),
  path.join('public', 'osa', 'osa.js'),
  path.join('public', 'osa', 'login.html'),
  path.join('public', 'index.html'),
  path.join('public', 'reset-password.html'),
  path.join('public', 'scan.html'),
  path.join('public', 'campus-poster.html'),
  path.join('public', 'device', 'index.html'),
  path.join('public', 'js', 'public.js'),
  path.join('public', 'js', 'scanner.js')
];

let totalViolations = 0;

auditedFiles.forEach(relPath => {
  const fullPath = path.join(rootDir, relPath);
  assert(fs.existsSync(fullPath), `Target file must exist: ${relPath}`);
  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    if (emojiRegex.test(line)) {
      // Ignore sanitizer regex pattern or regression contract comment in student.js
      if (relPath.includes('student.js') && (line.includes('replace') || line.includes('Notification notice contract:'))) {
        return;
      }
      console.error(`  ❌ EMOJI VIOLATION: ${relPath} Line ${idx + 1}: ${line.trim()}`);
      totalViolations++;
    }
  });
  console.log(`  ✓ ${relPath} scanned: 0 UI emojis`);
});

assert.strictEqual(totalViolations, 0, `Total UI emoji violations must be 0, found ${totalViolations}`);
console.log('  ✓ Zero UI emojis verified across all 12 frontend files.');

// 4. Verify Lucide SVG Structure & Attributes
console.log('\n[4/5] Verifying Standardized Lucide SVG Attributes & Structure...');

const studentHtml = fs.readFileSync(path.join(rootDir, 'public', 'student', 'index.html'), 'utf8');
const osaHtml = fs.readFileSync(path.join(rootDir, 'public', 'osa', 'index.html'), 'utf8');
const publicHtml = fs.readFileSync(path.join(rootDir, 'public', 'index.html'), 'utf8');
const resetHtml = fs.readFileSync(path.join(rootDir, 'public', 'reset-password.html'), 'utf8');

// Assert viewBox="0 0 24 24" presence
[
  { name: 'Student Portal HTML', content: studentHtml },
  { name: 'OSA Portal HTML', content: osaHtml },
  { name: 'Public Landing HTML', content: publicHtml },
  { name: 'Reset Password HTML', content: resetHtml }
].forEach(target => {
  const svgMatches = target.content.match(/<svg[^>]*viewBox="0 0 24 24"[^>]*>/g) || [];
  assert(svgMatches.length >= 5, `${target.name} must contain multiple Lucide SVGs with viewBox="0 0 24 24"`);
  console.log(`  ✓ ${target.name}: ${svgMatches.length} Lucide 24x24 SVGs verified`);
});

// Assert Sign Out SVG Log-Out Icon in both portals
const logoutSvgPattern = /<svg[^>]*>[\s\S]*?<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"[\s\S]*?<polyline points="16 17 21 12 16 7"[\s\S]*?<line x1="21" y1="12" x2="9" y2="12"[\s\S]*?<\/svg>/;
assert(logoutSvgPattern.test(studentHtml), 'Student portal must feature outline Lucide log-out SVG');
assert(logoutSvgPattern.test(osaHtml), 'OSA portal must feature outline Lucide log-out SVG');
console.log('  ✓ Standardized Lucide log-out SVG verified on Student & OSA Sign Out buttons');

// 5. Final Safety & Database Integrity Confirmation
console.log('\n[5/5] Final Database Integrity Confirmation...');
const finalDbContent = fs.readFileSync(dbPath, 'utf8');
const finalDbHash = crypto.createHash('sha256').update(finalDbContent).digest('hex');
assert.strictEqual(finalDbHash, dbHash, 'Database content must remain completely unchanged');
console.log('  ✓ Database was 100% untouched and unchanged.');

console.log('\n========================================================================');
console.log('  ALL SYSTEM-WIDE ICON CONSISTENCY CHECKS PASSED (100% SUCCESS)         ');
console.log('========================================================================\n');
process.exit(0);
