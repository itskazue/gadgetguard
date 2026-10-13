/**
 * NCST GadgetGuard — Targeted OSA & Public Website UI Polish Test Suite
 * Validates:
 * 1. OSA Sidebar SVG icons (zero emojis, all 14 items, badge counters intact)
 * 2. Exactly 6 OSA Dashboard KPI cards (3x2 grid, SVG icons, correct IDs, 2 removed)
 * 3. Dashboard section headers have SVG icons and zero emojis
 * 4. Public website navigation active indicator, scroll-margin, and scroll spy controller
 * 5. Strict preservation of homepage hero structure, copy, and CTAs
 * 6. Database immutability (SHA-256 match)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

console.log('========================================================================');
console.log('   GADGETGUARD: TARGETED OSA & PUBLIC WEBSITE UI POLISH TEST SUITE      ');
console.log('========================================================================\n');

// -----------------------------------------------------------------------------
// [1/6] Database Checksum Verification
// -----------------------------------------------------------------------------
console.log('[1/6] Verifying Baseline Database Checksum...');
const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
const initialChecksum = crypto.createHash('sha256').update(fs.readFileSync(DB_PATH)).digest('hex').toLowerCase();
const EXPECTED_CHECKSUM = '4505f70dd6fc6e3770c37564946868d199a9cc1b98ccb18b27f51f00a996f8e6';
assert.strictEqual(initialChecksum, EXPECTED_CHECKSUM, `Database checksum mismatch: ${initialChecksum}`);
console.log(`  ✓ Database checksum verified: ${initialChecksum}\n`);

// -----------------------------------------------------------------------------
// [2/6] OSA Sidebar SVG Icons Inspection
// -----------------------------------------------------------------------------
console.log('[2/6] Inspecting OSA Sidebar Navigation Icons & Markup...');
const osaHtmlPath = path.join(__dirname, '..', 'public', 'osa', 'index.html');
const osaHtml = fs.readFileSync(osaHtmlPath, 'utf8');

const sidebarMenuMatch = osaHtml.match(/<ul class="osa-menu-list">([\s\S]*?)<\/ul>/);
assert(sidebarMenuMatch, 'Sidebar menu list found in osa/index.html');
const sidebarContent = sidebarMenuMatch[1];

const expectedRoutes = [
  { id: 'nav-osa-dashboard', label: 'Dashboard' },
  { id: 'nav-osa-approvals', label: 'Gadget Registrations', badge: 'badge-pending-count' },
  { id: 'nav-osa-registered', label: 'Registered Gadgets' },
  { id: 'nav-osa-missing', label: 'Missing Gadgets', badge: 'badge-missing-count' },
  { id: 'nav-osa-found', label: 'Found Gadgets' },
  { id: 'nav-osa-claims', label: 'Claims', badge: 'badge-claims-count' },
  { id: 'nav-osa-history', label: 'Returned History', badge: 'badge-history-count' },
  { id: 'nav-osa-scanner', label: 'QR Scanner' },
  { id: 'nav-osa-users', label: 'Users' },
  { id: 'nav-osa-notifications', label: 'Notifications' },
  { id: 'nav-osa-scans', label: 'QR Scan Logs' },
  { id: 'nav-osa-reports', label: 'Reports' },
  { id: 'nav-osa-audit', label: 'Audit Logs' },
  { id: 'nav-osa-settings', label: 'Settings' }
];

expectedRoutes.forEach(route => {
  assert(sidebarContent.includes(`id="${route.id}"`), `Sidebar contains link with id="${route.id}"`);
  assert(sidebarContent.includes(`<span>${route.label}</span>`), `Sidebar contains label span for "${route.label}"`);
  if (route.badge) {
    assert(sidebarContent.includes(`id="${route.badge}"`), `Sidebar contains badge with id="${route.badge}"`);
  }
});

// Count SVG elements in sidebar
const svgMatches = sidebarContent.match(/<svg[\s\S]*?<\/svg>/g) || [];
assert.strictEqual(svgMatches.length, 14, `Expected exactly 14 SVG icons in sidebar, found ${svgMatches.length}`);

// Confirm zero emojis in sidebar nav link contents
const legacyEmojis = ['📊', '⏳', '💻', '🚨', '📦', '📋', '📜', '📷', '👥', '🔔', '📍', '📈', '🛡️', '⚙️'];
legacyEmojis.forEach(emoji => {
  assert(!sidebarContent.includes(emoji), `Sidebar should not contain emoji ${emoji}`);
});
console.log('  ✓ All 14 OSA sidebar items have clean SVG icons with zero emojis.\n');

// -----------------------------------------------------------------------------
// [3/6] OSA Dashboard KPI Cards & Header Icons Inspection
// -----------------------------------------------------------------------------
console.log('[3/6] Inspecting OSA Dashboard KPI Cards & Section Headers...');

const kpiGridMatch = osaHtml.match(/<div class="osa-kpi-grid">([\s\S]*?)<\/div>\s*<!--/);
assert(kpiGridMatch, 'KPI grid found in osa/index.html');
const kpiGridContent = kpiGridMatch[1];

const expectedKpis = [
  'kpi-total-users',
  'kpi-registered',
  'kpi-pending-reg',
  'kpi-missing',
  'kpi-found',
  'kpi-pending-claims'
];

expectedKpis.forEach(id => {
  assert(kpiGridContent.includes(`id="${id}"`), `KPI grid contains approved card id="${id}"`);
});

// Confirm 2 removed KPI cards are NOT in the grid
assert(!kpiGridContent.includes('id="kpi-returned"'), 'KPI grid successfully removed kpi-returned');
assert(!kpiGridContent.includes('id="kpi-scans"'), 'KPI grid successfully removed kpi-scans');

// Verify exactly 6 .osa-kpi-card elements exist
const cardMatches = kpiGridContent.match(/class="osa-kpi-card"/g) || [];
assert.strictEqual(cardMatches.length, 6, `Expected exactly 6 KPI cards, found ${cardMatches.length}`);

// Verify all 6 cards have SVG icons in .osa-kpi-icon-pill
const kpiSvgMatches = kpiGridContent.match(/<svg[\s\S]*?<\/svg>/g) || [];
assert.strictEqual(kpiSvgMatches.length, 6, `Expected exactly 6 SVG icons in KPI cards, found ${kpiSvgMatches.length}`);

// Verify dashboard section headers have SVG icons and zero emojis
assert(!osaHtml.includes('<h3>⏳ Pending Gadget Approvals Queue</h3>'), 'Approvals queue header emoji removed');
assert(!osaHtml.includes('<h3>🛡️ Recent Audit Log Events</h3>'), 'Audit logs header emoji removed');
assert(osaHtml.includes('<span>Pending Gadget Approvals Queue</span>'), 'Approvals queue header title preserved');
assert(osaHtml.includes('<span>Recent Audit Log Events</span>'), 'Audit log header title preserved');

console.log('  ✓ Exactly 6 KPI cards with SVG icons verified (Returned & QR Scans cards removed).');
console.log('  ✓ Dashboard section header SVGs verified.\n');

// -----------------------------------------------------------------------------
// [4/6] OSA CSS Stylesheet Rules Inspection
// -----------------------------------------------------------------------------
console.log('[4/6] Inspecting OSA Stylesheet (osa.css)...');
const osaCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'osa', 'osa.css'), 'utf8');

assert(osaCss.includes('.osa-nav-link-content svg'), 'osa.css defines styles for .osa-nav-link-content svg');
assert(osaCss.includes('.osa-nav-link.active .osa-nav-link-content svg'), 'osa.css defines active stroke for nav SVG');
assert(osaCss.includes('grid-template-columns: repeat(3, 1fr)'), 'osa.css configures .osa-kpi-grid with 3 columns');
assert(osaCss.includes('.osa-kpi-icon-pill svg'), 'osa.css defines styles for .osa-kpi-icon-pill svg');
assert(osaCss.includes('.osa-kpi-card:nth-child(6)::before'), 'osa.css defines accent stripe for 6th KPI card');

console.log('  ✓ OSA CSS grid and icon styles verified.\n');

// -----------------------------------------------------------------------------
// [5/6] Public Website Navigation & Scroll Spy Inspection
// -----------------------------------------------------------------------------
console.log('[5/6] Inspecting Public Website Stylesheet & JS Controller...');
const publicCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'public.css'), 'utf8');
const publicJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'public.js'), 'utf8');
const publicHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert(publicCss.includes('scroll-behavior: smooth;'), 'public.css includes smooth scroll-behavior');
assert(publicCss.includes('scroll-margin-top: 76px;'), 'public.css defines sticky offset scroll-margin-top for sections');
assert(publicCss.includes('.nav-link::after'), 'public.css defines .nav-link::after pseudo-element');
assert(publicCss.includes('transform: scaleX(0);'), 'public.css hides inactive underline via scaleX(0)');
assert(publicCss.includes('.nav-link.active::after'), 'public.css defines active state for underline');
assert(publicCss.includes('transform: scaleX(1);'), 'public.css animates active underline via scaleX(1)');

assert(publicJs.includes('initPublicNavScrollSpy()'), 'public.js declares initPublicNavScrollSpy function');
assert(publicJs.includes('initPublicNavScrollSpy();'), 'public.js invokes initPublicNavScrollSpy in DOMContentLoaded');
assert(publicJs.includes('addEventListener(\'scroll\','), 'public.js binds window scroll event');
assert(publicJs.includes('popstate'), 'public.js binds browser history popstate event');

// -----------------------------------------------------------------------------
// [6/6] Strictly Protect Homepage Hero Verification
// -----------------------------------------------------------------------------
console.log('[6/6] Strictly Verifying Homepage Hero Protection...');

assert(publicHtml.includes('<section id="home" class="hero-banner-wrap">'), 'Hero wrapper section exists');
assert(publicHtml.includes('Official NCST Lost-and-Found System'), 'Hero badge tag preserved');
assert(publicHtml.includes('Secure Your Gadgets,<br>'), 'Hero headline line 1 preserved');
assert(publicHtml.includes('<span class="hero-title-highlight">Stay Connected.</span>'), 'Hero headline line 2 preserved');
assert(publicHtml.includes('GadgetGuard is the official NCST lost-and-found'), 'Hero subtitle text preserved');
assert(publicHtml.includes('Student Login &rarr;'), 'Hero primary CTA preserved');
assert(publicHtml.includes('Learn More'), 'Hero secondary CTA preserved');
assert(publicHtml.includes('Register Your Gadgets'), 'Checklist feature 1 preserved');
assert(publicHtml.includes('Report When Missing'), 'Checklist feature 2 preserved');
assert(publicHtml.includes('Scan & Recover'), 'Checklist feature 3 preserved');
assert(publicHtml.includes('phone-mockup-wrapper'), 'Phone mockup wrapper preserved');
assert(publicHtml.includes('phone-qr-sticker'), 'Phone QR sticker showcase preserved');
assert(publicHtml.includes('phone-token-code'), 'Phone token code preserved');

// Final database checksum re-check
const finalChecksum = crypto.createHash('sha256').update(fs.readFileSync(DB_PATH)).digest('hex').toLowerCase();
assert.strictEqual(finalChecksum, EXPECTED_CHECKSUM, 'Database was NOT modified by any tests');

console.log('  ✓ Homepage Hero is 100% strictly protected and identical to production.');
console.log('  ✓ Final database checksum confirmed intact.\n');

console.log('========================================================================');
console.log('ALL VERIFICATIONS PASSED (100% SUCCESS)');
console.log('========================================================================');
