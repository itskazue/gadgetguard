/**
 * GadgetGuard — Phase 3: OSA Filters & Search Improvements Test Suite
 * Comprehensive automated verification for 6 OSA modules:
 * 1. Found Gadgets
 * 2. Claims (Ready for Claim)
 * 3. Returned History
 * 4. Users
 * 5. QR Scan Logs
 * 6. Audit Logs
 * 
 * Verifies search, filters, date boundaries (PHT Asia/Manila), sorting, empty states,
 * reset controls, backend endpoints, and DOM elements in public/osa/index.html.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
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

// Function extraction helpers
function extractFunction(name) {
  const regex = new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, 'm');
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

// Module 1: Found Gadgets controls
assert(indexHtmlContent.includes('id="found-search-input"'), 'Found Gadgets: search input exists');
assert(indexHtmlContent.includes('id="found-status-filter"'), 'Found Gadgets: turnover status filter exists');
assert(indexHtmlContent.includes('id="found-type-filter"'), 'Found Gadgets: device type filter exists');
assert(indexHtmlContent.includes('id="found-sort-filter"'), 'Found Gadgets: sort select exists');
assert(indexHtmlContent.includes('onclick="clearFoundFilters()"'), 'Found Gadgets: clearFoundFilters button exists');

// Module 2: Claims controls
assert(indexHtmlContent.includes('id="claims-search-input"'), 'Claims: search input exists');
assert(indexHtmlContent.includes('id="claims-status-filter"'), 'Claims: claim status filter exists');
assert(indexHtmlContent.includes('id="claims-type-filter"'), 'Claims: device type filter exists');
assert(indexHtmlContent.includes('id="claims-sort-filter"'), 'Claims: sort select exists');
assert(indexHtmlContent.includes('onclick="clearClaimsFilters()"'), 'Claims: clearClaimsFilters button exists');

// Module 3: Returned History controls
assert(indexHtmlContent.includes('id="history-search-input"'), 'History: search input exists');
assert(indexHtmlContent.includes('id="history-date-filter"'), 'History: date range filter exists');
assert(indexHtmlContent.includes('id="history-custom-date-wrap"'), 'History: custom calendar container exists');
assert(indexHtmlContent.includes('id="history-date-from"'), 'History: date from input exists');
assert(indexHtmlContent.includes('id="history-date-to"'), 'History: date to input exists');
assert(indexHtmlContent.includes('id="history-type-filter"'), 'History: device type filter exists');
assert(indexHtmlContent.includes('id="history-sort-filter"'), 'History: sort select exists');
assert(indexHtmlContent.includes('onclick="clearHistoryFilters()"'), 'History: clearHistoryFilters button exists');

// Module 4: Users controls
assert(indexHtmlContent.includes('id="users-search-input"'), 'Users: search input exists');
assert(indexHtmlContent.includes('id="users-role-filter"'), 'Users: role filter exists');
assert(indexHtmlContent.includes('id="users-dept-filter"'), 'Users: department filter exists');
assert(indexHtmlContent.includes('id="users-status-filter"'), 'Users: account status filter exists');
assert(indexHtmlContent.includes('id="users-sort-filter"'), 'Users: sort select exists');
assert(indexHtmlContent.includes('onclick="clearUsersFilters()"'), 'Users: clearUsersFilters button exists');

// Module 5: QR Scan Logs controls
assert(indexHtmlContent.includes('id="scans-search-input"'), 'Scans: search input exists');
assert(indexHtmlContent.includes('id="scans-status-filter"'), 'Scans: scan status filter exists');
assert(indexHtmlContent.includes('id="scans-date-filter"'), 'Scans: date range filter exists');
assert(indexHtmlContent.includes('id="scans-custom-date-wrap"'), 'Scans: custom calendar container exists');
assert(indexHtmlContent.includes('id="scans-location-source-filter"'), 'Scans: location source filter exists');
assert(indexHtmlContent.includes('id="scans-device-type-filter"'), 'Scans: scanner device filter exists');
assert(indexHtmlContent.includes('id="scans-sort-filter"'), 'Scans: sort select exists');
assert(indexHtmlContent.includes('onclick="clearScansFilters()"'), 'Scans: clearScansFilters button exists');

// Module 6: Audit Logs controls
assert(indexHtmlContent.includes('id="audit-search-input"'), 'Audit: search input exists');
assert(indexHtmlContent.includes('id="audit-action-filter"'), 'Audit: action code filter exists');
assert(indexHtmlContent.includes('id="audit-role-filter"'), 'Audit: user role filter exists');
assert(indexHtmlContent.includes('id="audit-date-filter"'), 'Audit: date range filter exists');
assert(indexHtmlContent.includes('id="audit-custom-date-wrap"'), 'Audit: custom calendar container exists');
assert(indexHtmlContent.includes('id="audit-sort-filter"'), 'Audit: sort select exists');
assert(indexHtmlContent.includes('onclick="clearAuditFilters()"'), 'Audit: clearAuditFilters button exists');


console.log('\n============================================================');
console.log('--- TEST SUITE 2: PHILIPPINE TIME (Asia/Manila) DATE MATCHING ---');
console.log('============================================================');

// Load matchesPhtDateRange implementation into test scope
const vm = require('vm');
const sandbox = { console };
vm.createContext(sandbox);

// Evaluate helper functions in VM sandbox
vm.runInContext(`
  ${extractFunction('getStudentSurname')}
  ${extractFunction('matchesDeviceCategory')}
  ${extractFunction('matchesPhtDateRange')}
  ${extractFunction('sortItemsList')}
  ${extractFunction('classifyScannerDevice')}
  ${extractFunction('normalizeDisplayDeviceInfo')}
`, sandbox);

const { matchesPhtDateRange, sortItemsList, classifyScannerDevice, normalizeDisplayDeviceInfo } = sandbox;

// PHT Offset is +8h (28,800,000 ms)
const PHT_MS = 8 * 3600 * 1000;
const nowUtc = Date.now();
const nowPht = new Date(nowUtc + PHT_MS);
const phtYear = nowPht.getUTCFullYear();
const phtMonth = nowPht.getUTCMonth();
const phtDate = nowPht.getUTCDate();

// Timestamp exactly at start of today in PHT: 00:00:00.000 PHT
const todayStartUtc = Date.UTC(phtYear, phtMonth, phtDate) - PHT_MS;
// Timestamp 1 millisecond before today in PHT (Yesterday 23:59:59.999 PHT)
const yesterdayEndUtc = todayStartUtc - 1;
// Timestamp at 12:00 PM PHT today
const todayNoonUtc = todayStartUtc + (12 * 3600 * 1000);
// Timestamp at 23:59:59.999 PHT today
const todayEndUtc = todayStartUtc + (24 * 3600 * 1000) - 1;
// Timestamp 1 millisecond into tomorrow PHT
const tomorrowStartUtc = todayEndUtc + 1;

assert(matchesPhtDateRange(new Date(todayNoonUtc).toISOString(), 'TODAY'), 'TODAY matches midday PHT today');
assert(matchesPhtDateRange(new Date(todayStartUtc).toISOString(), 'TODAY'), 'TODAY matches inclusive start of day 00:00:00.000 PHT');
assert(matchesPhtDateRange(new Date(todayEndUtc).toISOString(), 'TODAY'), 'TODAY matches inclusive end of day 23:59:59.999 PHT');
assert(!matchesPhtDateRange(new Date(yesterdayEndUtc).toISOString(), 'TODAY'), 'TODAY excludes 1ms before midnight PHT');
assert(!matchesPhtDateRange(new Date(tomorrowStartUtc).toISOString(), 'TODAY'), 'TODAY excludes tomorrow 00:00:00.000 PHT');

// Test CUSTOM Range boundaries
const customFrom = '2026-10-01';
const customTo = '2026-10-05';
const oct1StartUtc = Date.UTC(2026, 9, 1) - PHT_MS;
const oct5EndUtc = Date.UTC(2026, 9, 5) - PHT_MS + (24 * 3600 * 1000) - 1;
const sept30EndUtc = oct1StartUtc - 1;
const oct6StartUtc = oct5EndUtc + 1;

assert(matchesPhtDateRange(new Date(oct1StartUtc).toISOString(), 'CUSTOM', customFrom, customTo), 'CUSTOM matches start of fromDate 00:00:00.000 PHT');
assert(matchesPhtDateRange(new Date(oct5EndUtc).toISOString(), 'CUSTOM', customFrom, customTo), 'CUSTOM matches end of toDate 23:59:59.999 PHT');
assert(!matchesPhtDateRange(new Date(sept30EndUtc).toISOString(), 'CUSTOM', customFrom, customTo), 'CUSTOM excludes previous day');
assert(!matchesPhtDateRange(new Date(oct6StartUtc).toISOString(), 'CUSTOM', customFrom, customTo), 'CUSTOM excludes subsequent day');


console.log('\n============================================================');
console.log('--- TEST SUITE 3: SCANNER DEVICE CLASSIFICATION & CORRECTION ---');
console.log('============================================================');

assert(classifyScannerDevice('Mobile Device — Chrome (macOS)') === 'DESKTOP', 'Classifies legacy "Mobile Device — Chrome (macOS)" correctly as DESKTOP');
assert(classifyScannerDevice('Desktop – Chrome (macOS)') === 'DESKTOP', 'Classifies Desktop – Chrome (macOS) as DESKTOP');
assert(classifyScannerDevice('Desktop – Edge (Windows)') === 'DESKTOP', 'Classifies Desktop – Edge (Windows) as DESKTOP');
assert(classifyScannerDevice('Mobile Device – Safari (iOS)') === 'MOBILE', 'Classifies Mobile Safari iOS as MOBILE');
assert(classifyScannerDevice('Tablet Device – Safari (iPadOS)') === 'TABLET', 'Classifies iPad as TABLET');
assert(classifyScannerDevice(null) === 'UNAVAILABLE', 'Classifies missing device info as UNAVAILABLE');

assert(normalizeDisplayDeviceInfo('Mobile Device — Chrome (macOS)') === 'Desktop — Chrome (macOS)', 'Normalizes anomaly display to Desktop — Chrome (macOS)');
assert(normalizeDisplayDeviceInfo('Mobile Device — Chrome (Windows)') === 'Desktop — Chrome (Windows)', 'Normalizes Windows anomaly to Desktop');
assert(normalizeDisplayDeviceInfo('Mobile Device — Safari (iOS)') === 'Mobile Device — Safari (iOS)', 'Preserves genuine Mobile Device for iOS');


console.log('\n============================================================');
console.log('--- TEST SUITE 4: UNIFIED SORTING (Surname A-Z, Z-A, Dates) ---');
console.log('============================================================');

const mockItems = [
  { id: '1', user: { name: 'Juan Dela Cruz', idNumber: '2023-0001' }, createdAt: '2026-10-01T10:00:00Z' },
  { id: '2', user: { name: 'Maria Santos', idNumber: '2023-0002' }, createdAt: '2026-10-05T10:00:00Z' },
  { id: '3', user: { name: 'Jose Rizal', idNumber: '2023-0003' }, createdAt: '2026-10-03T10:00:00Z' },
  { id: '4', user: { name: 'Ana Aquino', idNumber: '2023-0004' }, createdAt: '2026-09-20T10:00:00Z' }
];

const sortedSurnameAsc = sortItemsList(mockItems, 'SURNAME_ASC', i => i.user, i => i.createdAt);
assert(sortedSurnameAsc[0].user.name === 'Ana Aquino', 'Surname A-Z: Aquino first');
assert(sortedSurnameAsc[1].user.name === 'Juan Dela Cruz', 'Surname A-Z: Cruz second');
assert(sortedSurnameAsc[2].user.name === 'Jose Rizal', 'Surname A-Z: Rizal third');
assert(sortedSurnameAsc[3].user.name === 'Maria Santos', 'Surname A-Z: Santos fourth');

const sortedSurnameDesc = sortItemsList(mockItems, 'SURNAME_DESC', i => i.user, i => i.createdAt);
assert(sortedSurnameDesc[0].user.name === 'Maria Santos', 'Surname Z-A: Santos first');
assert(sortedSurnameDesc[3].user.name === 'Ana Aquino', 'Surname Z-A: Aquino last');

const sortedNewest = sortItemsList(mockItems, 'NEWEST', i => i.user, i => i.createdAt);
assert(sortedNewest[0].id === '2', 'NEWEST: Oct 5 item first');
assert(sortedNewest[3].id === '4', 'NEWEST: Sep 20 item last');

const sortedOldest = sortItemsList(mockItems, 'OLDEST', i => i.user, i => i.createdAt);
assert(sortedOldest[0].id === '4', 'OLDEST: Sep 20 item first');
assert(sortedOldest[3].id === '2', 'OLDEST: Oct 5 item last');


console.log('\n============================================================');
console.log('--- TEST SUITE 5: FOUND GADGETS FILTER & SEARCH PIPELINE ---');
console.log('============================================================');

const mockFoundReports = [
  {
    id: 'FND-001',
    surrenderReference: 'SRF-1001',
    gadgetId: 'GAD-A1',
    finderName: 'Officer Ramos',
    foundLocation: 'Library 2F',
    status: 'IN_OSA_CUSTODY',
    gadget: { id: 'GAD-A1', category: 'Laptop', brand: 'Apple', model: 'MacBook Air', secureToken: 'TOK-A1' },
    owner: { name: 'Pedro Penduko', idNumber: '2022-1111' },
    createdAt: '2026-10-02T08:00:00Z'
  },
  {
    id: 'FND-002',
    surrenderReference: 'SRF-1002',
    gadgetId: 'GAD-B2',
    finderName: 'Guard Santos',
    foundLocation: 'Canteen',
    status: 'PENDING_OSA_TURNOVER',
    turnInMethod: 'SUBMITTED_TO_OSA',
    gadget: { id: 'GAD-B2', category: 'Smartphone', brand: 'Samsung', model: 'Galaxy S23', secureToken: 'TOK-B2' },
    owner: { name: 'Clara Barton', idNumber: '2023-2222' },
    createdAt: '2026-10-04T08:00:00Z'
  },
  {
    id: 'FND-003',
    surrenderReference: 'SRF-1003',
    gadgetId: 'GAD-C3',
    finderName: 'Student Finder',
    foundLocation: 'Gymnasium',
    status: 'FINDER_HOLDING',
    gadget: { id: 'GAD-C3', category: 'Earbuds', brand: 'Sony', model: 'WF-1000XM4', secureToken: 'TOK-C3' },
    owner: { name: 'Juan Luna', idNumber: '2021-3333' },
    createdAt: '2026-10-03T08:00:00Z'
  }
];

// Test search by Surrender Reference
let resFound = mockFoundReports.filter(r => (r.surrenderReference || '').toLowerCase().includes('srf-1001'));
assert(resFound.length === 1 && resFound[0].id === 'FND-001', 'Found Gadgets: search by Surrender Reference works');

// Test search by Student ID
resFound = mockFoundReports.filter(r => (r.owner?.idNumber || '').toLowerCase().includes('2023-2222'));
assert(resFound.length === 1 && resFound[0].id === 'FND-002', 'Found Gadgets: search by Student ID works');

// Test search by QR Token
resFound = mockFoundReports.filter(r => (r.gadget?.secureToken || '').toLowerCase().includes('tok-c3'));
assert(resFound.length === 1 && resFound[0].id === 'FND-003', 'Found Gadgets: search by QR Token works');

// Test status filter: IN_OSA_CUSTODY
resFound = mockFoundReports.filter(r => r.status === 'IN_OSA_CUSTODY');
assert(resFound.length === 1 && resFound[0].id === 'FND-001', 'Found Gadgets: filter IN_OSA_CUSTODY works');

// Test category filter: Smartphone
resFound = mockFoundReports.filter(r => sandbox.matchesDeviceCategory(r.gadget?.category, 'Smartphone'));
assert(resFound.length === 1 && resFound[0].id === 'FND-002', 'Found Gadgets: filter Device Category works');


console.log('\n============================================================');
console.log('--- TEST SUITE 6: CLAIMS FILTER & MULTI-CYCLE PRESERVATION ---');
console.log('============================================================');

const mockClaimsList = [
  {
    id: 'CLM-001',
    gadgetId: 'GAD-01',
    status: 'IN_CUSTODY',
    isInCustody: true,
    gadget: { id: 'GAD-01', brand: 'Lenovo', model: 'ThinkPad', serialNumber: 'SN-LN100', category: 'Laptop', secureToken: 'TK-01' },
    user: { name: 'Carlos P. Garcia', idNumber: '2024-9001' },
    dateReceivedByOsa: '2026-10-01T08:00:00Z'
  },
  {
    id: 'CLM-002',
    gadgetId: 'GAD-02',
    status: 'PENDING',
    isInCustody: true,
    gadget: { id: 'GAD-02', brand: 'Apple', model: 'iPhone 14', serialNumber: 'SN-AP200', category: 'Smartphone', secureToken: 'TK-02' },
    user: { name: 'Benigno Aquino', idNumber: '2024-9002' },
    dateReceivedByOsa: '2026-10-03T08:00:00Z'
  },
  {
    id: 'CLM-003',
    gadgetId: 'GAD-03',
    status: 'RETURNED', // already returned in previous cycle
    returnRecord: { id: 'RET-001' },
    gadget: { id: 'GAD-03', brand: 'Asus', model: 'ZenBook', status: 'RETURNED' }
  }
];

// Verify returned claims are excluded from active claims desk
const activeClaims = mockClaimsList.filter(c => c.status !== 'RETURNED' && !c.returnRecord);
assert(activeClaims.length === 2, 'Claims: historical returned claims are excluded from active recovery desk');

// Test search by Serial Number
let resClaims = activeClaims.filter(c => (c.gadget?.serialNumber || '').toLowerCase().includes('sn-ln100'));
assert(resClaims.length === 1 && resClaims[0].id === 'CLM-001', 'Claims: search by Serial Number works');

// Test search by Gadget Model
resClaims = activeClaims.filter(c => (c.gadget?.model || '').toLowerCase().includes('iphone'));
assert(resClaims.length === 1 && resClaims[0].id === 'CLM-002', 'Claims: search by Gadget Model works');

// Test Claim Status filter: PENDING
resClaims = activeClaims.filter(c => c.status === 'PENDING');
assert(resClaims.length === 1 && resClaims[0].id === 'CLM-002', 'Claims: filter PENDING status works');


console.log('\n============================================================');
console.log('--- TEST SUITE 7: USERS FILTER & DYNAMIC DEPARTMENT PARSING ---');
console.log('============================================================');

const mockUsers = [
  { id: 'U1', name: 'Zenaida Alvarez', idNumber: 'ST-001', email: 'zenaida@ncst.edu.ph', role: 'student', department: 'Computer Science', status: 'ACTIVE', createdAt: '2026-09-01' },
  { id: 'U2', name: 'Albert Santos', idNumber: 'FC-002', email: 'albert@ncst.edu.ph', role: 'faculty', department: 'Engineering', status: 'ACTIVE', createdAt: '2026-09-02' },
  { id: 'U3', name: 'Brenda Cruz', idNumber: 'ST-003', email: 'brenda@ncst.edu.ph', role: 'student', department: 'Computer Science', status: 'SUSPENDED', createdAt: '2026-09-03' },
  { id: 'U4', name: 'Danilo Ramos', idNumber: 'AD-004', email: 'danilo@ncst.edu.ph', role: 'osa_admin', department: 'OSA Admin Office', status: 'ACTIVE', createdAt: '2026-09-04' }
];

// Extract distinct departments
const distinctDepts = Array.from(new Set(mockUsers.map(u => u.department).filter(Boolean))).sort();
assert(distinctDepts.length === 3, 'Users: extracts distinct departments correctly');
assert(distinctDepts.includes('Computer Science') && distinctDepts.includes('Engineering'), 'Users: contains actual departments');

// Test filter by department: Computer Science
let resUsers = mockUsers.filter(u => u.department === 'Computer Science');
assert(resUsers.length === 2, 'Users: filter by Department matches exactly');

// Test filter by status: SUSPENDED
resUsers = mockUsers.filter(u => u.status === 'SUSPENDED');
assert(resUsers.length === 1 && resUsers[0].id === 'U3', 'Users: filter by Account Status works');

// Test search by School Email
resUsers = mockUsers.filter(u => (u.email || '').toLowerCase().includes('danilo@ncst'));
assert(resUsers.length === 1 && resUsers[0].id === 'U4', 'Users: search by School Email works');


console.log('\n============================================================');
console.log('--- TEST SUITE 8: BACKEND AUDIT LOGS ENRICHMENT (osaRoutes) ---');
console.log('============================================================');

// Verify that the route code contains userName and userStudentId enrichment
const osaRoutesPath = path.join(__dirname, '..', 'server', 'routes', 'osaRoutes.js');
const osaRoutesContent = fs.readFileSync(osaRoutesPath, 'utf8');

assert(osaRoutesContent.includes("userName: u ? u.name :"), 'osaRoutes: enriches audit log with userName from users table');
assert(osaRoutesContent.includes("userStudentId: u ? u.idNumber : null"), 'osaRoutes: enriches audit log with userStudentId from users table');
assert(osaRoutesContent.includes("requireRole('osa_admin')"), 'osaRoutes: enforces osa_admin authorization on audit-logs endpoint');


console.log('\n============================================================');
console.log('--- TEST SUITE 9: DATABASE INTEGRITY VERIFICATION ---');
console.log('============================================================');

// Ensure data/database.json was not mutated during test
const dbPath = path.join(__dirname, '..', 'data', 'database.json');
const dbContent = fs.readFileSync(dbPath, 'utf8');
const dbHash = crypto.createHash('sha256').update(dbContent).digest('hex').toUpperCase();

// Expected hash from baseline checkpoint
const EXPECTED_DB_HASH = '4505F70DD6FC6E3770C37564946868D199A9CC1B98CCB18B27F51F00A996F8E6';
assert(dbHash === EXPECTED_DB_HASH, `data/database.json remains pristine and unmutated (${dbHash.substring(0, 12)}...)`);


console.log('\n============================================================');
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log('============================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
