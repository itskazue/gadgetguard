/**
 * GadgetGuard — Phase 4: Reports & Analytics Improvements Test Suite
 * Comprehensive automated verification for Reports & Analytics module:
 * 1. Date Range Filter Controls & PHT inclusive boundaries
 * 2. Accurate Database-Driven Analytics (zero-incident handling, no hardcoded 100% or <24h)
 * 3. Report Charts & Category / Status census as Current Inventory Snapshots
 * 4. Export Summary content & privacy protection
 * 5. Print Executive Report layout rules
 * 6. RBAC & Data safety (read-only verification, zero database mutation)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { fork } = require('child_process');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

// Read and extract helper functions from public/osa/osa.js for unit testing
const osaJsPath = path.join(__dirname, '..', 'public', 'osa', 'osa.js');
const osaJsContent = fs.readFileSync(osaJsPath, 'utf8');

function extractFunction(name) {
  const regex = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\r?\\n\\}`, 'm');
  const match = osaJsContent.match(regex);
  if (!match) {
    throw new Error(`Could not extract function ${name} from osa.js`);
  }
  return match[0];
}

console.log('\n============================================================');
console.log('--- TEST SUITE 1: DOM & HTML STRUCTURE IN public/osa/index.html ---');
console.log('============================================================');

const indexHtmlPath = path.join(__dirname, '..', 'public', 'osa', 'index.html');
const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

// Date range filter toolbar
assert(indexHtmlContent.includes('id="reports-date-filter"'), 'Date range filter select exists');
assert(indexHtmlContent.includes('value="ALL"'), 'Date filter includes ALL preset');
assert(indexHtmlContent.includes('value="TODAY"'), 'Date filter includes TODAY preset');
assert(indexHtmlContent.includes('value="WEEK"'), 'Date filter includes WEEK preset');
assert(indexHtmlContent.includes('value="MONTH"'), 'Date filter includes MONTH preset');
assert(indexHtmlContent.includes('value="YEAR"'), 'Date filter includes YEAR preset');
assert(indexHtmlContent.includes('value="CUSTOM"'), 'Date filter includes CUSTOM preset');
assert(indexHtmlContent.includes('id="reports-custom-date-wrap"'), 'Custom date inputs wrapper exists');
assert(indexHtmlContent.includes('id="reports-date-from"'), 'Start date picker input exists');
assert(indexHtmlContent.includes('id="reports-date-to"'), 'End date picker input exists');
assert(indexHtmlContent.includes('id="reports-apply-btn"'), 'Apply Filter button exists');
assert(indexHtmlContent.includes('id="reports-reset-btn"'), 'Reset Filter button exists');

// Period indicator banner
assert(indexHtmlContent.includes('id="reports-period-indicator"'), 'Period indicator banner exists');
assert(indexHtmlContent.includes('id="reports-period-label"'), 'Period label text container exists');
assert(indexHtmlContent.includes('Database-Verified Records'), 'Database verification badge exists');

// 4 Accurate KPI Cards
assert(indexHtmlContent.includes('id="report-recovery-rate"'), 'Recovery Success Rate value element exists');
assert(indexHtmlContent.includes('id="report-recovery-rate-sub"'), 'Recovery Success Rate subtext label exists');
assert(indexHtmlContent.includes('id="report-avg-time"'), 'Avg Resolution Speed value element exists');
assert(indexHtmlContent.includes('id="report-avg-time-sub"'), 'Avg Resolution Speed subtext label exists');
assert(indexHtmlContent.includes('id="report-total-cases"'), 'Total Lifecycle Assets value element exists');
assert(indexHtmlContent.includes('id="report-total-cases-sub"'), 'Total Lifecycle Assets snapshot label exists');
assert(indexHtmlContent.includes('id="report-active-stickers"'), 'Active QR Security Tags value element exists');
assert(indexHtmlContent.includes('id="report-active-stickers-sub"'), 'Active QR Security Tags snapshot label exists');

// Charts labeled as Current Inventory Snapshot
assert(indexHtmlContent.includes('id="cat-total-label"'), 'Category chart subtitle exists');
assert(indexHtmlContent.includes('id="status-total-label"'), 'Status chart subtitle exists');
assert(indexHtmlContent.includes('Current Inventory Snapshot'), 'Explicit snapshot disclaimer present on charts');

// Action buttons
assert(indexHtmlContent.includes('onclick="exportAnalyticsSummary()"'), 'Export summary button trigger exists');
assert(indexHtmlContent.includes('onclick="printExecutiveReport()"'), 'Print executive report button trigger exists');

// Certification Footer
assert(indexHtmlContent.includes('class="report-certified-footer"'), 'Certification footer exists');
assert(indexHtmlContent.includes('Prepared by: Office of Student Affairs'), 'Neutral Prepared by label exists in HTML footer');
assert(indexHtmlContent.includes('Status: For Review / Not Yet Officially Certified'), 'Status explicitly labeled as For Review / Not Yet Officially Certified');
assert(!indexHtmlContent.includes('Dean Carlos Mendoza, OSA Director'), 'No unverified school official name or fake signatory title in reports footer');


console.log('\n============================================================');
console.log('--- TEST SUITE 2: PRINT STYLESHEET IN public/osa/osa.css ---');
console.log('============================================================');

const osaCssPath = path.join(__dirname, '..', 'public', 'osa', 'osa.css');
const osaCssContent = fs.readFileSync(osaCssPath, 'utf8');

assert(osaCssContent.includes('@media print'), 'Print media query exists');
assert(osaCssContent.includes('size: portrait'), 'Print page layout set to portrait');
assert(osaCssContent.includes('print-color-adjust: exact'), 'Exact print color adjustment configured');
assert(osaCssContent.includes('.osa-sidebar'), 'Hides sidebar during print');
assert(osaCssContent.includes('.osa-top-bar'), 'Hides top bar during print');
assert(osaCssContent.includes('.reports-filter-toolbar'), 'Hides filter toolbar during print');
assert(osaCssContent.includes('.reports-header-actions'), 'Hides action buttons during print');
assert(osaCssContent.includes('#osa-screen-reports'), 'Explicit print styling for reports screen');


console.log('\n============================================================');
console.log('--- TEST SUITE 3: TIME & DURATION UNIT TESTS (PHT UTC+8) ---');
console.log('============================================================');

const vm = require('vm');
const sandbox = {
  window: {},
  document: { getElementById: () => null },
  console
};

const osaFns = `
  ${extractFunction('matchesPhtDateRange')}
  ${extractFunction('formatDurationHuman')}
  ${extractFunction('formatPeriodDisplay')}
`;
vm.createContext(sandbox);
vm.runInContext(osaFns, sandbox);

const { matchesPhtDateRange, formatDurationHuman, formatPeriodDisplay } = sandbox;

// Test duration formatter
assert(formatDurationHuman(null) === 'N/A', 'formatDurationHuman(null) returns N/A');
assert(formatDurationHuman(undefined) === 'N/A', 'formatDurationHuman(undefined) returns N/A');
assert(formatDurationHuman(NaN) === 'N/A', 'formatDurationHuman(NaN) returns N/A');
assert(formatDurationHuman(30000) === '30s', 'formatDurationHuman(30000) returns 30s');
assert(formatDurationHuman(120000) === '2 mins', 'formatDurationHuman(120000) returns 2 mins');
assert(formatDurationHuman(7200000) === '2.0 hrs', 'formatDurationHuman(7200000) returns 2.0 hrs');
assert(formatDurationHuman(172800000) === '2.0 days', 'formatDurationHuman(172800000) returns 2.0 days');

// Test period display formatter
assert(formatPeriodDisplay({ range: 'ALL' }).includes('All Time'), 'formatPeriodDisplay ALL includes All Time');
assert(formatPeriodDisplay({ range: 'TODAY' }).includes('Today'), 'formatPeriodDisplay TODAY includes Today');
assert(formatPeriodDisplay({ range: 'WEEK' }).includes('Monday – Sunday'), 'formatPeriodDisplay WEEK includes Monday – Sunday');
assert(formatPeriodDisplay({ range: 'MONTH' }).includes('This Month'), 'formatPeriodDisplay MONTH includes This Month');
assert(formatPeriodDisplay({ range: 'YEAR' }).includes('This Year'), 'formatPeriodDisplay YEAR includes This Year');
assert(formatPeriodDisplay({ range: 'CUSTOM', from: '2026-10-01', to: '2026-10-10' }).includes('2026-10-01'), 'formatPeriodDisplay CUSTOM formats start and end dates');

// Test matchesPhtDateRange
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
const nowUtc = Date.now();
const nowPht = new Date(nowUtc + PHT_OFFSET_MS);
const year = nowPht.getUTCFullYear();
const month = nowPht.getUTCMonth();
const date = nowPht.getUTCDate();

const todayNoonUtc = Date.UTC(year, month, date, 4, 0, 0); // 12:00 PHT
const todayStartUtc = Date.UTC(year, month, date) - PHT_OFFSET_MS;
const todayEndUtc = todayStartUtc + (24 * 60 * 60 * 1000) - 1;
const yesterdayEndUtc = todayStartUtc - 1;
const tomorrowStartUtc = todayStartUtc + (24 * 60 * 60 * 1000);

assert(matchesPhtDateRange(new Date(todayNoonUtc).toISOString(), 'ALL'), 'ALL matches today noon');
assert(matchesPhtDateRange(new Date(todayStartUtc).toISOString(), 'TODAY'), 'TODAY matches inclusive start of day 00:00:00.000 PHT');
assert(matchesPhtDateRange(new Date(todayEndUtc).toISOString(), 'TODAY'), 'TODAY matches inclusive end of day 23:59:59.999 PHT');
assert(!matchesPhtDateRange(new Date(yesterdayEndUtc).toISOString(), 'TODAY'), 'TODAY excludes yesterday');
assert(!matchesPhtDateRange(new Date(tomorrowStartUtc).toISOString(), 'TODAY'), 'TODAY excludes tomorrow');

// Philippine Calendar Week test (Monday to Sunday)
const dayOfWeek = nowPht.getUTCDay();
const daysSinceMonday = (dayOfWeek + 6) % 7;
const weekStartUtc = todayStartUtc - (daysSinceMonday * 24 * 60 * 60 * 1000);
const weekEndUtc = weekStartUtc + (7 * 24 * 60 * 60 * 1000) - 1;
assert(matchesPhtDateRange(new Date(weekStartUtc).toISOString(), 'WEEK'), 'WEEK matches Monday 00:00:00.000 PHT');
assert(matchesPhtDateRange(new Date(weekEndUtc).toISOString(), 'WEEK'), 'WEEK matches Sunday 23:59:59.999 PHT');
assert(!matchesPhtDateRange(new Date(weekStartUtc - 1).toISOString(), 'WEEK'), 'WEEK excludes previous Sunday 23:59:59.999 PHT');
assert(!matchesPhtDateRange(new Date(weekEndUtc + 1).toISOString(), 'WEEK'), 'WEEK excludes next Monday 00:00:00.000 PHT');

// YEAR test
const yearStartUtc = Date.UTC(year, 0, 1) - PHT_OFFSET_MS;
const yearEndUtc = Date.UTC(year + 1, 0, 1) - PHT_OFFSET_MS - 1;
assert(matchesPhtDateRange(new Date(yearStartUtc).toISOString(), 'YEAR'), 'YEAR matches Jan 1 00:00:00.000 PHT');
assert(matchesPhtDateRange(new Date(yearEndUtc).toISOString(), 'YEAR'), 'YEAR matches Dec 31 23:59:59.999 PHT');
assert(!matchesPhtDateRange(new Date(yearStartUtc - 1).toISOString(), 'YEAR'), 'YEAR excludes previous year');
assert(!matchesPhtDateRange(new Date(yearEndUtc + 1).toISOString(), 'YEAR'), 'YEAR excludes next year');


console.log('\n============================================================');
console.log('--- TEST SUITE 4: SYNTHETIC RECOVERY RATE & DURATION UNIT CALCULATION ---');
console.log('============================================================');

function testCalculationLogic() {
  const t0 = new Date('2026-10-05T08:00:00.000Z').getTime();
  const t1 = new Date('2026-10-05T11:30:00.000Z').getTime(); // 3.5 hrs later (12,600,000 ms)

  const mockMissingReports = [
    { id: 'm1', gadgetId: 'g1', status: 'RESOLVED', reportedAt: new Date(t0).toISOString(), resolvedAt: new Date(t1).toISOString() },
    { id: 'm2', gadgetId: 'g2', status: 'ACTIVE', reportedAt: new Date(t0).toISOString() }
  ];

  const totalIncidents = mockMissingReports.length;
  const recovered = mockMissingReports.filter(m => m.status === 'RESOLVED');
  const recoveryRate = Math.round((recovered.length / totalIncidents) * 1000) / 10;
  const durations = [t1 - t0];
  const avgDurationMs = durations[0];

  assert(recoveryRate === 50, 'Recovery rate with 1 of 2 recovered is exactly 50.0%');
  assert(avgDurationMs === 12600000, 'Resolution duration matches 12,600,000 ms');
  assert(formatDurationHuman(avgDurationMs) === '3.5 hrs', 'formatDurationHuman correctly formats 12,600,000 ms as 3.5 hrs');
}

testCalculationLogic();


console.log('\n============================================================');
console.log('--- TEST SUITE 5: ISOLATED BACKEND SERVER INTEGRATION & RBAC ---');
console.log('============================================================');

const TEST_PORT = 3998;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEMP_DATA_DIR = path.join(__dirname, '..', 'scratch', 'test_reports_isolated_dir');
const ORIGINAL_DB_PATH = path.join(__dirname, '..', 'data', 'database.json');

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

async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await httpRequest('/api/health');
      if (res.statusCode === 200) return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return false;
}

async function runIsolatedServerTests() {
  const initialDbHash = crypto.createHash('sha256').update(fs.readFileSync(ORIGINAL_DB_PATH)).digest('hex').toUpperCase();

  if (fs.existsSync(TEMP_DATA_DIR)) {
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync('testpass123', salt);

  // Setup isolated database with:
  // 3 gadgets: 1 laptop (registered), 1 phone (in custody), 1 tablet (returned)
  // 2 missing reports:
  // - m1: reported 4 hours ago, resolved 1 hour ago (duration: 3 hours)
  // - m2: reported 2 hours ago, still active
  const tNow = Date.now();
  const t4hAgo = new Date(tNow - (4 * 3600 * 1000)).toISOString();
  const t1hAgo = new Date(tNow - (1 * 3600 * 1000)).toISOString();
  const t2hAgo = new Date(tNow - (2 * 3600 * 1000)).toISOString();

  const testDb = {
    users: [
      {
        id: 'usr_admin',
        name: 'Dean Carlos Mendoza',
        email: 'osa.admin@ncst.edu.ph',
        passwordHash,
        role: 'osa_admin',
        status: 'ACTIVE'
      },
      {
        id: 'usr_student',
        name: 'Juan Dela Cruz',
        email: 'juan@ncst.edu.ph',
        passwordHash,
        role: 'student',
        status: 'ACTIVE'
      }
    ],
    gadgets: [
      { id: 'gdt_01', userId: 'usr_student', category: 'Smartphone', brand: 'Samsung', model: 'Galaxy S23', status: 'MISSING', secureToken: 'token_01' },
      { id: 'gdt_02', userId: 'usr_student', category: 'Laptop', brand: 'Apple', model: 'MacBook Air M2', status: 'REGISTERED', secureToken: 'token_02' },
      { id: 'gdt_03', userId: 'usr_student', category: 'Tablet', brand: 'Apple', model: 'iPad Air', status: 'RETURNED', secureToken: 'token_03' },
      { id: 'gdt_04', userId: 'usr_student', category: 'Laptop', brand: 'Asus', model: 'ROG Zephyrus G14', status: 'REGISTERED', secureToken: 'token_04' },
      { id: 'gdt_pending', userId: 'usr_student', category: 'Laptop', brand: 'HP', model: 'Pavilion', status: 'PENDING_APPROVAL', secureToken: null }
    ],
    missing_reports: [
      { id: 'm1', gadgetId: 'gdt_03', status: 'RESOLVED', reportedAt: t4hAgo, resolvedAt: t1hAgo },
      { id: 'm2', gadgetId: 'gdt_01', status: 'ACTIVE', reportedAt: t2hAgo }
    ],
    returns: [
      { id: 'r1', gadgetId: 'gdt_03', returnDate: t1hAgo }
    ],
    found_reports: [],
    claims: [],
    qr_scans: [],
    notifications: [],
    audit_logs: [],
    recovery_chats: [],
    uploaded_files: [],
    revoked_tokens: [],
    system_settings: { schoolName: 'NCST Test Campus' }
  };

  fs.writeFileSync(path.join(TEMP_DATA_DIR, 'database.json'), JSON.stringify(testDb, null, 2), 'utf8');

  // Launch isolated server process
  const serverProcess = fork(path.join(__dirname, '..', 'server', 'server.js'), [], {
    env: {
      ...process.env,
      PORT: TEST_PORT.toString(),
      DATA_DIR: TEMP_DATA_DIR,
      NODE_ENV: 'test'
    },
    stdio: 'pipe'
  });

  const isOnline = await waitForServer();
  assert(isOnline, `Isolated test server online on port ${TEST_PORT}`);

  try {
    const jwtSecret = process.env.JWT_SECRET || 'gadgetguard_super_secret_jwt_key_2026';
    const adminToken = jwt.sign({ id: 'usr_admin', role: 'osa_admin', email: 'osa.admin@ncst.edu.ph' }, jwtSecret, { expiresIn: '1h' });
    const studentToken = jwt.sign({ id: 'usr_student', role: 'student', email: 'juan@ncst.edu.ph' }, jwtSecret, { expiresIn: '1h' });

    // 1. RBAC Test: Unauthenticated
    const resUnauth = await httpRequest('/api/osa/reports');
    assert(resUnauth.statusCode === 401, 'GET /api/osa/reports unauthenticated rejected with 401');

    // 2. RBAC Test: Student role
    const resStudent = await httpRequest('/api/osa/reports', {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    assert(resStudent.statusCode === 403, 'GET /api/osa/reports with student token rejected with 403 Forbidden');

    // 3. RBAC Test: OSA Admin
    const resAdmin = await httpRequest('/api/osa/reports?range=ALL', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resAdmin.statusCode === 200, 'GET /api/osa/reports with osa_admin token accepted with 200 OK');
    assert(resAdmin.data && resAdmin.data.success === true, 'Response payload success is true');

    const kpis = resAdmin.data.kpis;
    assert(kpis.totalMissingIncidents === 2, 'Reports accurately counted 2 missing incidents in period');
    assert(kpis.recoveredIncidentsCount === 1, 'Reports accurately counted 1 recovered incident in period');
    assert(kpis.recoverySuccessRate === 50, 'Recovery Success Rate accurately computed as 50.0% (1/2)');
    assert(kpis.timedIncidentsCount === 1, 'Timed incidents count is 1');
    assert(Math.round(kpis.avgResolutionSpeedMs / (3600 * 1000)) === 3, 'Average resolution speed computed as ~3 hours (10,800,000 ms)');
    assert(kpis.totalLifecycleAssets === 5, 'Total Lifecycle Assets matches 5 items');
    assert(kpis.activeQrTags === 4, 'Active QR Tags matches 4 approved gadgets including missing device');

    // 4. Charts verification
    const charts = resAdmin.data.charts;
    assert(charts.totalAssets === 5, 'charts.totalAssets is 5');
    assert(charts.categoryCensus.Laptop === 3, 'charts category Laptop is 3');
    assert(charts.categoryCensus.Smartphone === 1, 'charts category Smartphone is 1');
    assert(charts.categoryCensus.Tablet === 1, 'charts category Tablet is 1');
    assert(charts.statusCensus.registered === 2, 'charts status registered is 2');
    assert(charts.statusCensus.missing === 1, 'charts status missing is 1');
    assert(charts.statusCensus.returned === 1, 'charts status returned is 1');
    assert(charts.statusCensus.pending === 1, 'charts status pending is 1');

    // 5. Presets testing
    const resToday = await httpRequest('/api/osa/reports?range=TODAY', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resToday.statusCode === 200 && resToday.data.period.range === 'TODAY', 'Endpoint accepts range=TODAY');

    const resWeek = await httpRequest('/api/osa/reports?range=WEEK', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resWeek.statusCode === 200 && resWeek.data.period.range === 'WEEK', 'Endpoint accepts range=WEEK');

    const resMonth = await httpRequest('/api/osa/reports?range=MONTH', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resMonth.statusCode === 200 && resMonth.data.period.range === 'MONTH', 'Endpoint accepts range=MONTH');

    const resYear = await httpRequest('/api/osa/reports?range=YEAR', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resYear.statusCode === 200 && resYear.data.period.range === 'YEAR', 'Endpoint accepts range=YEAR');

    const resCustom = await httpRequest('/api/osa/reports?range=CUSTOM&from=2026-10-01&to=2026-10-31', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resCustom.statusCode === 200 && resCustom.data.period.range === 'CUSTOM', 'Endpoint accepts range=CUSTOM with from & to');

    // 6. Zero-incidents period testing
    const resEmptyPeriod = await httpRequest('/api/osa/reports?range=CUSTOM&from=2020-01-01&to=2020-01-02', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert(resEmptyPeriod.statusCode === 200, 'Empty historical period request succeeds');
    assert(resEmptyPeriod.data.kpis.totalMissingIncidents === 0, 'Empty period reports 0 missing incidents');
    assert(resEmptyPeriod.data.kpis.recoverySuccessRate === null, 'Empty period recoverySuccessRate is null (displays N/A)');
    assert(resEmptyPeriod.data.kpis.avgResolutionSpeedMs === null, 'Empty period avgResolutionSpeedMs is null (displays N/A)');
    assert(resEmptyPeriod.data.kpis.totalLifecycleAssets === 5, 'Current inventory snapshot total assets still 5');

  } finally {
    serverProcess.kill('SIGKILL');
  }

  // Verify production database file remains pristine
  const postTestDbHash = crypto.createHash('sha256').update(fs.readFileSync(ORIGINAL_DB_PATH)).digest('hex').toUpperCase();
  assert(initialDbHash === postTestDbHash, 'Original production database file untouched (SHA-256 identical)');

  // Clean up temporary test directory
  if (fs.existsSync(TEMP_DATA_DIR)) {
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  }
}

runIsolatedServerTests().then(() => {
  console.log('\n============================================================');
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed.`);
  console.log('============================================================\n');
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}).catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
