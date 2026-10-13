/**
 * Test Suite: Defense Demo Logins & Optional Password Change Verification
 * Tests:
 * 1. Surname passwords work for all 3 presentation accounts:
 *    - Frnklynrd Rosales (2024-58694) -> "Rosales"
 *    - Rogelio III Manaog (2024-58135) -> "Manaog"
 *    - Carlos Mendoza (OSA-12345) -> "Mendoza"
 * 2. Login response returns mustChangePassword: false
 * 3. Direct access to dashboards without 403 blocking
 * 4. Optional Change Password endpoint in Profile/Settings remains functional
 * 5. Role and session isolation remains intact
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { fork } = require('child_process');

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

const TEST_PORT = 3295;
const ROOT_DIR = path.resolve(__dirname, '..');
const TEMP_DATA_DIR = path.join(__dirname, 'temp_demo_test_data');

function httpRequest(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const postData = options.body ? JSON.stringify(options.body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: urlPath,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        ...(options.headers || {})
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ statusCode: res.statusCode, data: json, raw: data });
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
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

async function runTests() {
  console.log('\n========================================================================');
  console.log('GADGETGUARD: DEFENSE DEMO LOGIN & AUTHENTICATION VERIFICATION SUITE');
  console.log('========================================================================\n');

  // Setup isolated test data directory
  if (fs.existsSync(TEMP_DATA_DIR)) {
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });

  const testDb = {
    users: [
      {
        id: 'usr_admin_01',
        name: 'Carlos Mendoza',
        email: 'mrconsonants@gmail.com',
        idNumber: 'OSA-12345',
        role: 'osa_admin',
        department: 'Office of Student Affairs',
        contactNumber: '+63 917 555 4234',
        status: 'ACTIVE',
        passwordHash: bcrypt.hashSync('Mendoza', 10),
        mustChangePassword: false,
        passwordChangedAt: new Date().toISOString()
      },
      {
        id: 'usr_student_01',
        name: 'Frnklynrd Rosales',
        email: 'rosales.frnklynrd@ncst.edu.ph',
        idNumber: '2024-58694',
        role: 'student',
        department: 'College - BS Information Technology',
        contactNumber: '09925792602',
        status: 'ACTIVE',
        passwordHash: bcrypt.hashSync('Rosales', 10),
        mustChangePassword: false,
        passwordChangedAt: new Date().toISOString()
      },
      {
        id: 'usr_student_02',
        name: 'Rogelio III Manaog',
        email: 'manaog.rogelio@ncst.edu.ph',
        idNumber: '2024-58135',
        role: 'student',
        department: 'College - BS Information Technology',
        contactNumber: '09773955453',
        status: 'ACTIVE',
        passwordHash: bcrypt.hashSync('Manaog', 10),
        mustChangePassword: false,
        passwordChangedAt: new Date().toISOString()
      }
    ],
    gadgets: [
      {
        id: 'gdt_demo_01',
        userId: 'usr_student_01',
        brand: 'Apple',
        model: 'MacBook Pro 14',
        category: 'Laptop',
        serialNumber: 'SN-DEMO-001',
        status: 'REGISTERED',
        secureToken: 'tok_demo_mbp_14'
      }
    ],
    missing_reports: [],
    found_reports: [],
    claims: [],
    returns: [],
    qr_scans: [],
    notifications: [],
    audit_logs: [],
    recovery_chats: [],
    uploaded_files: [],
    password_resets: [],
    settings: {
      system_settings: {
        institutionName: 'National College of Science and Technology',
        osaEmail: 'mrconsonants@gmail.com'
      }
    }
  };

  fs.writeFileSync(path.join(TEMP_DATA_DIR, 'database.json'), JSON.stringify(testDb, null, 2), 'utf8');

  // Spawn test server
  const env = {
    ...process.env,
    PORT: TEST_PORT.toString(),
    DATA_DIR: TEMP_DATA_DIR,
    PERSISTENT_DIR: TEMP_DATA_DIR,
    DATABASE_URL: '',
    POSTGRES_URL: '',
    NODE_ENV: 'test',
    JWT_SECRET: 'test_defense_jwt_secret_key_123456789'
  };

  const serverProcess = fork(path.join(ROOT_DIR, 'server', 'server.js'), [], {
    env,
    stdio: 'ignore'
  });

  const online = await waitForServer();
  assert(online, `Test server online on port ${TEST_PORT}`);

  try {
    console.log('\n[1/4] Testing Presentation Account Logins by Surname Passwords...');

    // 1. Student 1: Frnklynrd Rosales
    const s1Res = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: '2024-58694', password: 'Rosales' }
    });
    assert(s1Res.statusCode === 200, 'Student 1 login succeeds with Student ID and surname password "Rosales"');
    assert(s1Res.data && s1Res.data.user && s1Res.data.user.name === 'Frnklynrd Rosales', 'Student 1 user profile returned correctly');
    assert(s1Res.data.mustChangePassword === false, 'Student 1 mustChangePassword is false');
    assert(!!s1Res.data.token, 'Student 1 session token issued');
    const s1Token = s1Res.data.token;

    // 2. Student 2: Rogelio III Manaog
    const s2Res = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: '2024-58135', password: 'Manaog' }
    });
    assert(s2Res.statusCode === 200, 'Student 2 login succeeds with Student ID and surname password "Manaog"');
    assert(s2Res.data && s2Res.data.user && s2Res.data.user.name === 'Rogelio III Manaog', 'Student 2 user profile returned correctly');
    assert(s2Res.data.mustChangePassword === false, 'Student 2 mustChangePassword is false');
    assert(!!s2Res.data.token, 'Student 2 session token issued');
    const s2Token = s2Res.data.token;

    // 3. OSA Admin: Carlos Mendoza
    const osaRes = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'OSA-12345', password: 'Mendoza' }
    });
    assert(osaRes.statusCode === 200, 'OSA Admin login succeeds with Staff ID and surname password "Mendoza"');
    assert(osaRes.data && osaRes.data.user && osaRes.data.user.name === 'Carlos Mendoza', 'OSA Admin user profile returned correctly');
    assert(osaRes.data.mustChangePassword === false, 'OSA Admin mustChangePassword is false');
    assert(!!osaRes.data.token, 'OSA Admin session token issued');
    const osaToken = osaRes.data.token;

    // Email-based logins also work
    const s1EmailRes = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'rosales.frnklynrd@ncst.edu.ph', password: 'Rosales' }
    });
    assert(s1EmailRes.statusCode === 200, 'Student 1 login also succeeds using institutional email address');

    const osaEmailRes = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'mrconsonants@gmail.com', password: 'Mendoza' }
    });
    assert(osaEmailRes.statusCode === 200, 'OSA Admin login also succeeds using email address');

    console.log('\n[2/4] Testing Direct Dashboard Access Without 403 Blocking...');

    // Student 1 can access gadgets without mandatory password change
    const myGadgetsRes = await httpRequest('/api/gadgets/my', {
      headers: { Authorization: `Bearer ${s1Token}` }
    });
    assert(myGadgetsRes.statusCode === 200, 'Student 1 can directly access /api/gadgets/my without 403 blocking');
    assert(Array.isArray(myGadgetsRes.data.gadgets), 'Student 1 receives registered gadgets array');

    // OSA Admin can access OSA dashboard endpoints directly
    const osaUsersRes = await httpRequest('/api/auth/users', {
      headers: { Authorization: `Bearer ${osaToken}` }
    });
    assert(osaUsersRes.statusCode === 200, 'OSA Admin can directly access /api/auth/users without 403 blocking');
    assert(osaUsersRes.data.users.length === 3, 'OSA Admin sees all 3 registered users in system');

    console.log('\n[3/4] Testing Optional Change Password in Profile/Settings...');

    // Student 1 changes password optionally
    const changePwdRes = await httpRequest('/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${s1Token}` },
      body: {
        currentPassword: 'Rosales',
        newPassword: 'NewPassword2026',
        confirmNewPassword: 'NewPassword2026'
      }
    });
    assert(changePwdRes.statusCode === 200, 'Optional change password succeeds for Student 1');
    assert(changePwdRes.data.success === true, 'Change password returns success: true');

    // Student 1 old session token is revoked
    const postChangeAccess = await httpRequest('/api/gadgets/my', {
      headers: { Authorization: `Bearer ${s1Token}` }
    });
    assert(postChangeAccess.statusCode === 401, 'Old session token revoked upon password update');

    // Student 1 can log in with new password
    const newLoginRes = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: '2024-58694', password: 'NewPassword2026' }
    });
    assert(newLoginRes.statusCode === 200, 'Login with updated password succeeds');

    // Old surname password now rejected
    const oldLoginRes = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: '2024-58694', password: 'Rosales' }
    });
    assert(oldLoginRes.statusCode === 401, 'Old surname password now rejected after update');

    console.log('\n[4/4] Testing Persistence and Isolation Invariants...');

    // Demo gadget is intact
    const allGadgets = await httpRequest('/api/gadgets', {
      headers: { Authorization: `Bearer ${osaToken}` }
    });
    assert(allGadgets.statusCode === 200, 'OSA can retrieve all campus gadgets');
    assert(allGadgets.data.gadgets.length >= 1, 'Demo gadget Apple MacBook Pro 14 persists in database');

    // Role enforcement: Student cannot access OSA users
    const studentBlocked = await httpRequest('/api/auth/users', {
      headers: { Authorization: `Bearer ${s2Token}` }
    });
    assert(studentBlocked.statusCode === 403, 'Role isolation preserved: Student blocked from OSA management endpoint');

  } finally {
    serverProcess.kill();
    if (fs.existsSync(TEMP_DATA_DIR)) {
      fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
    }
  }

  console.log('\n========================================================================');
  console.log(`SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
