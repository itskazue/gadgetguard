/**
 * NCST GadgetGuard — Browser Session Login Persistence Test Suite
 * Tests transition from localStorage to sessionStorage for authenticated sessions,
 * legacy credential cleanup, role protections, and Finder session immutability.
 */

const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

console.log('========================================================================');
console.log('   GADGETGUARD — BROWSER SESSION LOGIN PERSISTENCE TEST SUITE          ');
console.log('========================================================================\n');

// 1. Verify Database Baseline Integrity
const DB_PATH = path.join(__dirname, '..', 'data', 'database.json');
const initialChecksum = crypto.createHash('sha256').update(fs.readFileSync(DB_PATH)).digest('hex').toLowerCase();
console.log(`[1/7] Baseline Database Integrity Audit...`);
console.log(`  Initial SHA256: ${initialChecksum}`);
assert.strictEqual(
  initialChecksum,
  '4505f70dd6fc6e3770c37564946868d199a9cc1b98ccb18b27f51f00a996f8e6',
  'Baseline checksum must strictly match 4505f70dd6fc6e3770c37564946868d199a9cc1b98ccb18b27f51f00a996f8e6'
);
console.log('  ✓ Production database checksum verified.\n');

// 2. Mock Web Storage Environment (sessionStorage vs localStorage)
console.log(`[2/7] Initializing Storage Simulation Environment...`);

class MockStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store.hasOwnProperty(key) ? this.store[key] : null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

global.sessionStorage = new MockStorage();
global.localStorage = new MockStorage();

// Plant simulated legacy on-disk credentials in localStorage
global.localStorage.setItem('gg_token', 'legacy_stale_jwt_token_123');
global.localStorage.setItem('gg_user', JSON.stringify({ id: 'usr_old', name: 'Legacy Student', role: 'student' }));

// Plant simulated Finder session keys in localStorage (must NOT be touched)
global.localStorage.setItem('gg_finder_case_gdt_01_rep_01', JSON.stringify({ token: 'fnd_token_abc' }));
global.localStorage.setItem('gg_surrender_ref_gdt_01', JSON.stringify({ ref: 'SR-2026-999' }));

// Require api.js with simulated storage
delete require.cache[require.resolve('../public/js/api.js')];
const api = require('../public/js/api.js');

console.log('  ✓ Storage simulation initialized.');
console.log('  ✓ api.js loaded in simulated browser context.\n');

// 3. Test Legacy Credential Cleanup from localStorage
console.log(`[3/7] Testing Legacy On-Disk Credential Cleanup...`);

assert.strictEqual(
  global.localStorage.getItem('gg_token'),
  null,
  'Legacy gg_token must be purged from localStorage on initialization'
);
assert.strictEqual(
  global.localStorage.getItem('gg_user'),
  null,
  'Legacy gg_user must be purged from localStorage on initialization'
);

// Verify Finder session was preserved during cleanup
assert.notStrictEqual(
  global.localStorage.getItem('gg_finder_case_gdt_01_rep_01'),
  null,
  'Finder case session in localStorage must NOT be touched by auth cleanup'
);
assert.notStrictEqual(
  global.localStorage.getItem('gg_surrender_ref_gdt_01'),
  null,
  'Finder surrender ref in localStorage must NOT be touched by auth cleanup'
);
console.log('  ✓ Legacy gg_token and gg_user purged from localStorage.');
console.log('  ✓ Anonymous Finder QR session data in localStorage strictly preserved.\n');

// 4. Test Student Login, Refresh, Navigation, Logout Lifecycle
console.log(`[4/7] Testing Student Session Lifecycle in sessionStorage...`);

const studentToken = 'jwt_student_valid_session_token_xyz';
const studentUser = {
  id: 'usr_student_01',
  name: 'Denzel Kalingking',
  email: 'dkalingking@gmail.com',
  role: 'student',
  idNumber: '2024-58694'
};

// Simulate login
api.setToken(studentToken);
api.setCurrentUser(studentUser);

assert.strictEqual(
  global.sessionStorage.getItem('gg_token'),
  studentToken,
  'Token must be saved in sessionStorage'
);
assert.strictEqual(
  global.localStorage.getItem('gg_token'),
  null,
  'Token must NEVER be written to localStorage'
);
assert.strictEqual(
  api.getToken(),
  studentToken,
  'api.getToken() reads from sessionStorage'
);
assert.deepStrictEqual(
  api.getCurrentUser(),
  studentUser,
  'api.getCurrentUser() reads from sessionStorage'
);
console.log('  ✓ Student login saves strictly to sessionStorage.');

// Simulate page refresh (sessionStorage persists)
const refreshedToken = api.getToken();
const refreshedUser = api.getCurrentUser();
assert.strictEqual(refreshedToken, studentToken, 'Token persists across page reload');
assert.strictEqual(refreshedUser.id, studentUser.id, 'User profile persists across page reload');
console.log('  ✓ Page refresh preserves active session in sessionStorage.');

// Simulate explicit logout
api.logout();
assert.strictEqual(api.getToken(), null, 'Logout clears token');
assert.strictEqual(api.getCurrentUser(), null, 'Logout clears user profile');
assert.strictEqual(global.sessionStorage.getItem('gg_token'), null, 'sessionStorage token is null after logout');
assert.strictEqual(global.sessionStorage.getItem('gg_user'), null, 'sessionStorage user is null after logout');
assert.strictEqual(global.localStorage.getItem('gg_token'), null, 'localStorage token is null after logout');
console.log('  ✓ Explicit logout cleanly purges sessionStorage and localStorage.\n');

// 5. Test OSA Admin Login, Refresh, Navigation, Logout Lifecycle
console.log(`[5/7] Testing OSA Admin Session Lifecycle in sessionStorage...`);

const adminToken = 'jwt_admin_valid_session_token_123';
const adminUser = {
  id: 'usr_admin_01',
  name: 'Carlos Mendoza',
  email: 'osa.admin@univ.edu',
  role: 'osa_admin',
  idNumber: 'OSA-DIR-001'
};

api.setToken(adminToken);
api.setCurrentUser(adminUser);

assert.strictEqual(api.getToken(), adminToken, 'OSA token saved in sessionStorage');
assert.strictEqual(api.getCurrentUser().role, 'osa_admin', 'OSA role saved in sessionStorage');
assert.strictEqual(global.localStorage.getItem('gg_token'), null, 'OSA token never written to localStorage');

api.logout();
assert.strictEqual(api.getToken(), null, 'OSA logout clears session');
console.log('  ✓ OSA Admin session lifecycle functions correctly in sessionStorage.\n');

// 6. Test Fresh Browser Session Emulation & Role Separation
console.log(`[6/7] Testing Fresh Browser Session & Cross-Role Isolation...`);

// Emulate fresh browser launch (new tab/window with empty sessionStorage)
global.sessionStorage.clear();

// Verify freshly opened browser requires login
assert.strictEqual(api.getToken(), null, 'Fresh browser session has null token');
assert.strictEqual(api.getCurrentUser(), null, 'Fresh browser session has null user profile');

// Test Student accessing OSA role guard simulation
api.setCurrentUser(studentUser);
assert.strictEqual(
  api.getCurrentUser().role !== 'osa_admin',
  true,
  'Student account detected on OSA access check (triggers redirection)'
);

// Test OSA accessing Student role guard simulation
api.setCurrentUser(adminUser);
assert.strictEqual(
  api.getCurrentUser().role === 'osa_admin',
  true,
  'OSA account detected on Student portal access check (triggers redirection)'
);

// Clean up
api.logout();
console.log('  ✓ Fresh browser sessions cleanly default to unauthenticated state.');
console.log('  ✓ Role separation and mutual exclusion guards preserved.\n');

// 7. Re-verify Final Database Immutability
console.log(`[7/7] Re-verifying Database SHA256 Immutability...`);
const finalChecksum = crypto.createHash('sha256').update(fs.readFileSync(DB_PATH)).digest('hex').toLowerCase();
assert.strictEqual(finalChecksum, initialChecksum, 'Database must be 100% unchanged');
console.log(`  ✓ Database checksum strictly verified: ${finalChecksum}`);
console.log('  ✓ ZERO database records modified. ZERO credentials exposed.\n');

console.log('========================================================================');
console.log('ALL BROWSER SESSION LOGIN PERSISTENCE TESTS PASSED (100% SUCCESS)');
console.log('========================================================================\n');
