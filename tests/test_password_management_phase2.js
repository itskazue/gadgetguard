/**
 * GadgetGuard — Password Management Phase 2 Automated Verification Suite
 * Tests all requirements for secure password management:
 * 1. Static UI & DOM markup checks
 * 2. Rate limiting & generic responses preventing enumeration
 * 3. 15-minute expiring single-use reset tokens with SHA-256 storage
 * 4. Password reset execution with strong password validation
 * 5. Single-use and expiration enforcement (wrong, used, expired tokens)
 * 6. Authenticated Change Password with strong validation
 * 7. Server-enforced mustChangePassword middleware protection
 * 8. Legacy login compatibility & backdoor elimination
 * 9. Zero mutation of original database
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { fork } = require('child_process');
const bcrypt = require('bcryptjs');

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

const ROOT_DIR = path.resolve(__dirname, '..');
const ORIGINAL_DB_PATH = path.join(ROOT_DIR, 'data', 'database.json');
const TEMP_DATA_DIR = path.join(ROOT_DIR, 'tests', 'temp_pwd_data');
const TEST_PORT = 3288;

function httpRequest(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const postData = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null;
    const headers = options.headers || {};
    if (postData && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (postData) {
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: urlPath,
      method: options.method || 'GET',
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          data: json
        });
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

async function runAllTests() {
  console.log('\n========================================================================');
  console.log('   GADGETGUARD: PASSWORD MANAGEMENT PHASE 2 VERIFICATION SUITE         ');
  console.log('========================================================================\n');

  // ---------------------------------------------------------
  // [PART 1]: Static File & DOM Structure Assertions
  // ---------------------------------------------------------
  console.log('[1/8] Verifying UI Markup & Security Templates...');

  // 1.1 Password Reset HTML page
  const resetHtmlPath = path.join(ROOT_DIR, 'public', 'reset-password.html');
  assert(fs.existsSync(resetHtmlPath), 'public/reset-password.html exists');
  const resetHtml = fs.readFileSync(resetHtmlPath, 'utf8');
  assert(resetHtml.includes('id="new-password"'), 'Reset page has new-password input');
  assert(resetHtml.includes('id="confirm-password"'), 'Reset page has confirm-password input');
  assert(resetHtml.includes('Cubicle 8, Multipurpose Building'), 'Reset page includes Cubicle 8 student assistance notice');
  assert(resetHtml.includes('api.verifyResetToken'), 'Reset page calls api.verifyResetToken on load');
  assert(resetHtml.includes('api.resetPassword'), 'Reset page calls api.resetPassword on submit');

  // 1.2 Public Index HTML (Student Forgot Password)
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
  assert(indexHtml.includes('id="forgot-password-modal"'), 'public/index.html includes forgot-password-modal');
  assert(indexHtml.includes('openForgotPasswordModal()'), 'Login modal links to openForgotPasswordModal()');
  assert(indexHtml.includes('Cubicle 8, Multipurpose Building'), 'Student forgot password modal includes Cubicle 8 notice');

  // 1.3 OSA Login HTML
  const osaLoginHtml = fs.readFileSync(path.join(ROOT_DIR, 'public', 'osa', 'login.html'), 'utf8');
  assert(osaLoginHtml.includes('openOsaForgotPasswordModal()'), 'public/osa/login.html has Forgot password trigger');
  assert(osaLoginHtml.includes('api.forgotPassword'), 'OSA forgot password trigger dispatches via api.forgotPassword');

  // 1.4 OSA Settings & Profile Card
  const osaIndexHtml = fs.readFileSync(path.join(ROOT_DIR, 'public', 'osa', 'index.html'), 'utf8');
  assert(osaIndexHtml.includes('id="osa-profile-name"'), 'OSA Settings includes Staff Profile Name');
  assert(osaIndexHtml.includes('id="osa-profile-email"'), 'OSA Settings includes Staff Profile Email');
  assert(osaIndexHtml.includes('id="osa-pwd-current"'), 'OSA Settings includes Change Password Current field');
  assert(osaIndexHtml.includes('id="osa-pwd-new"'), 'OSA Settings includes Change Password New field');
  assert(osaIndexHtml.includes('handleOsaChangePassword'), 'OSA Settings form calls handleOsaChangePassword');

  // 1.5 Client API Methods
  const apiJs = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'api.js'), 'utf8');
  assert(apiJs.includes('async forgotPassword('), 'api.js implements forgotPassword method');
  assert(apiJs.includes('async verifyResetToken('), 'api.js implements verifyResetToken method');
  assert(apiJs.includes('async resetPassword('), 'api.js implements resetPassword method');
  assert(apiJs.includes('async changePassword('), 'api.js implements changePassword method');
  assert(apiJs.includes('async promptInitialPasswordChange('), 'api.js implements promptInitialPasswordChange method');

  // 1.6 Student Change Password Markup & Script
  const studentIndexHtml = fs.readFileSync(path.join(ROOT_DIR, 'public', 'student', 'index.html'), 'utf8');
  assert(studentIndexHtml.includes('id="student-new-password"') && studentIndexHtml.includes('minlength="8"'), 'Student portal enforces minlength 8 in HTML');
  const studentJs = fs.readFileSync(path.join(ROOT_DIR, 'public', 'student', 'student.js'), 'utf8');
  assert(studentJs.includes('newPassword.length < 8'), 'student.js script validates 8-character password length');
  assert(resetHtml.includes('history.replaceState'), 'reset-password.html purges token from browser address bar');

  // 1.7 Demo Password Exposure Disabled
  const authRoutesSrc = fs.readFileSync(path.join(ROOT_DIR, 'server', 'routes', 'authRoutes.js'), 'utf8');
  assert(!authRoutesSrc.includes('demoPassword:'), 'authRoutes.js does NOT expose demoPassword in demo-accounts');
  assert(!authRoutesSrc.includes('commonAcceptablePasswords'), 'authRoutes.js has removed commonAcceptablePasswords backdoor array');

  // ---------------------------------------------------------
  // [PART 2]: Isolated API & Server Execution
  // ---------------------------------------------------------
  console.log('\n[2/8] Setting Up Isolated Test Environment...');
  const initialDbHash = crypto.createHash('sha256').update(fs.readFileSync(ORIGINAL_DB_PATH)).digest('hex').toUpperCase();

  if (fs.existsSync(TEMP_DATA_DIR)) {
    fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DATA_DIR, { recursive: true });

  const salt = bcrypt.genSaltSync(10);
  const studentInitialPass = 'password123';
  const osaInitialPass = 'admin123';
  const studentHash = bcrypt.hashSync(studentInitialPass, salt);
  const osaHash = bcrypt.hashSync(osaInitialPass, salt);

  const testDb = {
    users: [
      {
        id: 'usr_test_admin',
        name: 'Dean Carlos Mendoza',
        email: 'osa.admin@univ.edu',
        passwordHash: osaHash,
        role: 'osa_admin',
        idNumber: 'OSA-DIR-001',
        department: 'Office of Student Affairs',
        status: 'ACTIVE'
      },
      {
        id: 'usr_test_student',
        name: 'Frnklynrd Rosales',
        email: 'rosales.frnklynrd@ncst.edu.ph',
        passwordHash: studentHash,
        role: 'student',
        idNumber: '2024-58694',
        department: 'College - BS Information Technology',
        status: 'ACTIVE'
      },
      {
        id: 'usr_test_firstlogin',
        name: 'New Student Temp',
        email: 'temp.student@ncst.edu.ph',
        passwordHash: studentHash,
        role: 'student',
        idNumber: '2024-99999',
        department: 'College - BS Computer Science',
        status: 'ACTIVE',
        mustChangePassword: true
      },
      {
        id: 'usr_test_osa_firstlogin',
        name: 'Staff Temp OSA',
        email: 'temp.osa@ncst.edu.ph',
        passwordHash: osaHash,
        role: 'osa_admin',
        idNumber: 'OSA-TEMP-99',
        department: 'Office of Student Affairs',
        status: 'ACTIVE',
        mustChangePassword: true
      },
      {
        id: 'usr_test_legacy_osa',
        name: 'Legacy Admin OSA',
        email: 'legacy.osa@ncst.edu.ph',
        passwordHash: osaHash,
        role: 'osa_admin',
        idNumber: 'OSA-LEGACY-01',
        department: 'Office of Student Affairs',
        status: 'ACTIVE'
      },
      {
        id: 'usr_test_student_custom',
        name: 'Custom Pass Student',
        email: 'custom.student@ncst.edu.ph',
        passwordHash: bcrypt.hashSync('StudentCustomPass2026!', salt),
        role: 'student',
        idNumber: '2024-11111',
        department: 'College - BS Information Technology',
        status: 'ACTIVE'
      },
      {
        id: 'usr_test_osa_custom',
        name: 'Custom Pass OSA Staff',
        email: 'custom.osa@ncst.edu.ph',
        passwordHash: bcrypt.hashSync('OsaCustomPass2026!', salt),
        role: 'osa_admin',
        idNumber: 'OSA-CUSTOM-01',
        department: 'Office of Student Affairs',
        status: 'ACTIVE'
      }
    ],
    gadgets: [
      {
        id: 'gdt_test_01',
        userId: 'usr_test_student',
        brand: 'Apple',
        model: 'MacBook Air',
        status: 'REGISTERED',
        secureToken: 'token_pwd_01'
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
    system_settings: {
      schoolName: 'National College of Science and Technology (NCST)',
      osaOfficeLocation: 'OSA Room 1109'
    }
  };

  fs.writeFileSync(path.join(TEMP_DATA_DIR, 'database.json'), JSON.stringify(testDb, null, 2), 'utf8');

  function startTestServer() {
    return fork(path.join(ROOT_DIR, 'server', 'server.js'), [], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: TEST_PORT,
        DATA_DIR: TEMP_DATA_DIR,
        PERSISTENT_DIR: TEMP_DATA_DIR,
        DATABASE_URL: '',
        POSTGRES_URL: '',
        SEND_RESET_EMAILS: 'false' // Do not send real external emails during tests
      },
      stdio: 'pipe'
    });
  }

  // Spawn isolated server with NODE_ENV = test
  let serverProcess = startTestServer();

  const isOnline = await waitForServer();
  assert(isOnline, `Isolated test server active on port ${TEST_PORT}`);

  try {
    // ---------------------------------------------------------
    // [PART 3]: Generic Responses & Account Enumeration Prevention
    // ---------------------------------------------------------
    console.log('\n[3/8] Testing Forgot Password Generic Responses...');

    // 3.1 Non-existent email
    const resUnknown = await httpRequest('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'nonexistent.user.999@univ.edu' }
    });
    assert(resUnknown.statusCode === 200, 'Non-existent email returns HTTP 200 generic response');
    assert(resUnknown.data && resUnknown.data.success === true, 'Response success is true');
    assert(resUnknown.data.message.includes('If an active account with that email exists'), 'Message prevents account enumeration');

    // 3.2 Student email request
    const resStudentForgot = await httpRequest('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'rosales.frnklynrd@ncst.edu.ph' }
    });
    assert(resStudentForgot.statusCode === 200, 'Student email returns HTTP 200 generic response');
    assert(resStudentForgot.data.message.includes('If an active account with that email exists'), 'Student message matches generic pattern');
    const studentRawToken = resStudentForgot.headers['x-test-reset-token'];
    assert(studentRawToken && studentRawToken.length === 64, 'Generated 64-character raw reset token received in test environment');

    // 3.3 OSA Admin email request
    const resOsaForgot = await httpRequest('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'osa.admin@univ.edu' }
    });
    assert(resOsaForgot.statusCode === 200, 'OSA email returns HTTP 200 generic response');
    assert(resOsaForgot.data.message.includes('If an active account with that email exists'), 'OSA message matches generic pattern');
    const osaRawToken = resOsaForgot.headers['x-test-reset-token'];
    assert(osaRawToken && osaRawToken.length === 64, 'OSA raw reset token received in test environment');

    // ---------------------------------------------------------
    // [PART 4]: Cryptographic Token Model & Expiration
    // ---------------------------------------------------------
    console.log('\n[4/8] Inspecting Token Model & Database Security...');
    const currentTempDb = JSON.parse(fs.readFileSync(path.join(TEMP_DATA_DIR, 'database.json'), 'utf8'));
    const resets = currentTempDb.password_resets;

    assert(resets.length >= 2, 'Password reset records created in database');
    const studentReset = resets.find(r => r.userId === 'usr_test_student');
    assert(studentReset, 'Student reset record located in password_resets');
    assert(studentReset.tokenHash && studentReset.tokenHash.length === 64, 'Token is stored as 64-character SHA-256 hash (never raw token)');
    assert(studentReset.used === false, 'New reset token is initialized as used = false');

    // Confirm tokenHash matches SHA-256 of studentRawToken
    const expectedHash = crypto.createHash('sha256').update(studentRawToken).digest('hex');
    assert(studentReset.tokenHash === expectedHash, 'Database tokenHash exactly matches SHA-256 digest of raw token');

    const createdTime = new Date(studentReset.createdAt).getTime();
    const expiresTime = new Date(studentReset.expiresAt).getTime();
    const expiryDiffMin = Math.round((expiresTime - createdTime) / (60 * 1000));
    assert(expiryDiffMin === 15, `Token expires in exactly 15 minutes (calculated: ${expiryDiffMin} mins)`);

    // ---------------------------------------------------------
    // [PART 5]: Token Verification Endpoint
    // ---------------------------------------------------------
    console.log('\n[5/8] Testing Token Verification & Invalidation...');

    // 5.1 Wrong token
    const resWrongVerify = await httpRequest('/api/auth/verify-reset-token?token=completely_fake_token_123');
    assert(resWrongVerify.statusCode === 400, 'Wrong token rejected with HTTP 400');
    assert(resWrongVerify.data && resWrongVerify.data.valid === false, 'Valid flag is false for wrong token');

    // 5.2 Valid token
    const resValidVerify = await httpRequest(`/api/auth/verify-reset-token?token=${studentRawToken}`);
    assert(resValidVerify.statusCode === 200, 'Valid token verified with HTTP 200');
    assert(resValidVerify.data && resValidVerify.data.valid === true, 'Valid flag is true for valid token');
    assert(resValidVerify.data.email === 'rosales.frnklynrd@ncst.edu.ph', 'Associated email returned on token verification');

    // ---------------------------------------------------------
    // [PART 6]: Reset Password Execution & Strong Password Policy
    // ---------------------------------------------------------
    console.log('\n[6/8] Testing Password Reset Execution...');

    // 6.1 Weak password rejected (too short)
    const resWeak = await httpRequest('/api/auth/reset-password', {
      method: 'POST',
      body: { token: studentRawToken, newPassword: 'short', confirmPassword: 'short' }
    });
    assert(resWeak.statusCode === 400, 'Weak short password rejected with HTTP 400');
    assert(resWeak.data.error.includes('8 characters'), 'Error informs minimum 8 characters');

    // 6.2 Password without numbers rejected
    const resNoNum = await httpRequest('/api/auth/reset-password', {
      method: 'POST',
      body: { token: studentRawToken, newPassword: 'allletterslong', confirmPassword: 'allletterslong' }
    });
    assert(resNoNum.statusCode === 400, 'Password without numbers rejected with HTTP 400');

    // 6.3 Mismatched passwords rejected
    const resMismatch = await httpRequest('/api/auth/reset-password', {
      method: 'POST',
      body: { token: studentRawToken, newPassword: 'ValidPass2026', confirmPassword: 'DifferentPass2026' }
    });
    assert(resMismatch.statusCode === 400, 'Mismatched passwords rejected with HTTP 400');

    // Obtain pre-reset session token
    const resPreResetLogin = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'rosales.frnklynrd@ncst.edu.ph', password: studentInitialPass }
    });
    const preResetToken = resPreResetLogin.data.token;
    assert(preResetToken, 'Pre-reset session token obtained');
    // Allow 1 second delta so passwordChangedAt timestamp is strictly greater than preResetToken iat
    await new Promise(r => setTimeout(r, 1050));

    // 6.4 Successful reset with strong password
    const newStudentPass = 'NCSTSecure2026!';
    const resSuccessReset = await httpRequest('/api/auth/reset-password', {
      method: 'POST',
      body: { token: studentRawToken, newPassword: newStudentPass, confirmPassword: newStudentPass }
    });
    assert(resSuccessReset.statusCode === 200, 'Valid reset completed with HTTP 200');
    assert(resSuccessReset.data && resSuccessReset.data.success === true, 'Reset response success is true');

    // 6.5 Session Revocation: Pre-reset session token must be revoked
    const resRevoked = await httpRequest('/api/auth/me', {
      headers: { Authorization: `Bearer ${preResetToken}` }
    });
    assert(resRevoked.statusCode === 401, 'Pre-reset session token rejected with HTTP 401');
    assert(resRevoked.data.code === 'SESSION_REVOKED', 'Session rejection code is SESSION_REVOKED');

    // 6.6 Verify new password can log in
    const resNewLogin = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'rosales.frnklynrd@ncst.edu.ph', password: newStudentPass }
    });
    assert(resNewLogin.statusCode === 200, 'Login with newly reset password succeeded');
    const studentNewToken = resNewLogin.data.token;
    assert(studentNewToken, 'Valid JWT token issued for new password login');

    // 6.7 Verify old password no longer works
    const resOldLogin = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'rosales.frnklynrd@ncst.edu.ph', password: studentInitialPass }
    });
    assert(resOldLogin.statusCode === 401, 'Old password strictly rejected after reset');

    // 6.8 Single-Use Token: Reusing same token rejected
    const resReuse = await httpRequest('/api/auth/reset-password', {
      method: 'POST',
      body: { token: studentRawToken, newPassword: 'AnotherPass2026!', confirmPassword: 'AnotherPass2026!' }
    });
    assert(resReuse.statusCode === 400, 'Reused token strictly rejected with HTTP 400');
    assert(resReuse.data.error.includes('already been used'), 'Error explains token has already been used');

    // 6.9 Simultaneous concurrent reset requests: only one can succeed
    const [resConc1, resConc2] = await Promise.all([
      httpRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { token: osaRawToken, newPassword: 'ConcurrentPass1A!', confirmPassword: 'ConcurrentPass1A!' }
      }),
      httpRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { token: osaRawToken, newPassword: 'ConcurrentPass2B!', confirmPassword: 'ConcurrentPass2B!' }
      })
    ]);
    const successCount = (resConc1.statusCode === 200 ? 1 : 0) + (resConc2.statusCode === 200 ? 1 : 0);
    const failureCount = (resConc1.statusCode === 400 ? 1 : 0) + (resConc2.statusCode === 400 ? 1 : 0);
    assert(successCount === 1, 'Exactly one simultaneous reset request succeeds with HTTP 200');
    assert(failureCount === 1, 'Competing simultaneous reset request is rejected with HTTP 400');

    // 6.10 Expired Token test via test helper
    // Request a new token for student
    const resSecondForgot = await httpRequest('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: 'rosales.frnklynrd@ncst.edu.ph' }
    });
    const secondRawToken = resSecondForgot.headers['x-test-reset-token'];
    assert(secondRawToken, 'Second reset token generated');

    // Expire it using test helper
    const resExpireHelper = await httpRequest('/api/auth/test-expire-token', {
      method: 'POST',
      body: { token: secondRawToken }
    });
    assert(resExpireHelper.statusCode === 200, 'Token successfully expired via test helper');

    const resExpired = await httpRequest('/api/auth/reset-password', {
      method: 'POST',
      body: { token: secondRawToken, newPassword: 'FreshPass2026!', confirmPassword: 'FreshPass2026!' }
    });
    assert(resExpired.statusCode === 400, 'Expired token strictly rejected with HTTP 400');
    assert(resExpired.data.error.includes('expired'), 'Error explains token has expired');

    // ---------------------------------------------------------
    // [PART 7]: Authenticated Change Password & mustChangePassword
    // ---------------------------------------------------------
    console.log('\n[7/8] Testing Authenticated Change Password & Server mustChangePassword...');

    // 7.1 Unauthenticated change password rejected
    const resUnauthChange = await httpRequest('/api/auth/change-password', {
      method: 'POST',
      body: { currentPassword: newStudentPass, newPassword: 'EvenNewerPass2026!' }
    });
    assert(resUnauthChange.statusCode === 401, 'Unauthenticated change password rejected with 401');

    // 7.2 Incorrect current password rejected
    const resWrongCurrent = await httpRequest('/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentNewToken}` },
      body: { currentPassword: 'WrongPassword999', newPassword: 'EvenNewerPass2026!', confirmNewPassword: 'EvenNewerPass2026!' }
    });
    assert(resWrongCurrent.statusCode === 400, 'Wrong current password rejected with HTTP 400');

    // 7.3 Same password rejected
    const resSamePass = await httpRequest('/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentNewToken}` },
      body: { currentPassword: newStudentPass, newPassword: newStudentPass, confirmNewPassword: newStudentPass }
    });
    assert(resSamePass.statusCode === 400, 'Same current and new password rejected with HTTP 400');

    // 7.4 Valid password change
    const newerPass = 'EvenNewerPass2026!';
    const resValidChange = await httpRequest('/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentNewToken}` },
      body: { currentPassword: newStudentPass, newPassword: newerPass, confirmNewPassword: newerPass }
    });
    assert(resValidChange.statusCode === 200, 'Valid password change succeeded with HTTP 200');

    // 7.5 Server-enforced mustChangePassword middleware
    // Login as user with mustChangePassword = true
    const resFirstLogin = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'temp.student@ncst.edu.ph', password: 'password123' }
    });
    assert(resFirstLogin.statusCode === 200, 'First-login user can log in');
    assert(resFirstLogin.data.mustChangePassword === true, 'Response indicates mustChangePassword is true');
    const firstLoginToken = resFirstLogin.data.token;

    // Access protected resource before changing password -> blocked by middleware!
    const resBlocked = await httpRequest('/api/gadgets/my', {
      headers: { Authorization: `Bearer ${firstLoginToken}` }
    });
    assert(resBlocked.statusCode === 403, 'Access to protected resource blocked with 403 before initial password change');
    assert(resBlocked.data.code === 'MUST_CHANGE_PASSWORD', 'Error code MUST_CHANGE_PASSWORD returned');

    // User changes password via /api/auth/change-password -> permitted!
    const freshPass = 'InitChangedPass2026!';
    const resInitChange = await httpRequest('/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${firstLoginToken}` },
      body: { currentPassword: 'password123', newPassword: freshPass, confirmNewPassword: freshPass }
    });
    assert(resInitChange.statusCode === 200, 'Initial password change allowed with HTTP 200');

    const freshStudentToken = resInitChange.data.token || firstLoginToken;

    // Now protected resource is unlocked!
    const resUnlocked = await httpRequest('/api/gadgets/my', {
      headers: { Authorization: `Bearer ${freshStudentToken}` }
    });
    assert(resUnlocked.statusCode === 200, 'Protected student resource successfully unlocked after initial password change');

    // 7.6 Server-enforced mustChangePassword: OSA Administrator First-Login
    const resOsaFirstLogin = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'temp.osa@ncst.edu.ph', password: 'admin123' }
    });
    assert(resOsaFirstLogin.statusCode === 200, 'First-login OSA staff can log in');
    assert(resOsaFirstLogin.data.mustChangePassword === true, 'OSA response indicates mustChangePassword is true');
    const osaFirstLoginToken = resOsaFirstLogin.data.token;

    // Access protected administrative resource -> blocked by server middleware!
    const resOsaBlocked = await httpRequest('/api/auth/users', {
      headers: { Authorization: `Bearer ${osaFirstLoginToken}` }
    });
    assert(resOsaBlocked.statusCode === 403, 'OSA access to users management blocked with 403 before initial password change');
    assert(resOsaBlocked.data.code === 'MUST_CHANGE_PASSWORD', 'Error code MUST_CHANGE_PASSWORD returned for OSA');

    // Permitted endpoint: /api/auth/me works for OSA
    const resOsaMe = await httpRequest('/api/auth/me', {
      headers: { Authorization: `Bearer ${osaFirstLoginToken}` }
    });
    assert(resOsaMe.statusCode === 200, 'Permitted endpoint /api/auth/me works for OSA while mustChangePassword is true');

    // OSA staff changes password
    const osaFreshPass = 'OsaAdminSecure2026!';
    const resOsaInitChange = await httpRequest('/api/auth/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${osaFirstLoginToken}` },
      body: { currentPassword: 'admin123', newPassword: osaFreshPass, confirmNewPassword: osaFreshPass }
    });
    assert(resOsaInitChange.statusCode === 200, 'OSA initial password change allowed with HTTP 200');
    const freshOsaToken = resOsaInitChange.data.token || osaFirstLoginToken;

    // Now protected administrative resource is unlocked!
    const resOsaUnlocked = await httpRequest('/api/auth/users', {
      headers: { Authorization: `Bearer ${freshOsaToken}` }
    });
    assert(resOsaUnlocked.statusCode === 200, 'Protected OSA users management resource unlocked after password change');

    // ---------------------------------------------------------
    // [PART 8]: Legacy Compatibility, Rate Limiting & Backdoors
    // ---------------------------------------------------------
    console.log('\n[8/8] Verifying Backdoor Elimination, Rate Limiting & Original DB Integrity...');

    // Arbitrary backdoor passwords must fail for all users
    const backdoors = ['123456', 'denzel123', 'student123', 'password', 'password1234'];
    for (const bd of backdoors) {
      const resBd = await httpRequest('/api/auth/login', {
        method: 'POST',
        body: { email: 'legacy.osa@ncst.edu.ph', password: bd }
      });
      assert(resBd.statusCode === 401, `Backdoor password '${bd}' strictly rejected`);
    }

    // Legitimate OSA admin password still works for unmigrated user
    const resOsaLegit = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'legacy.osa@ncst.edu.ph', password: 'admin123' }
    });
    assert(resOsaLegit.statusCode === 200, 'Legitimate OSA Admin credentials accepted');

    // Rate Limiting: sending repeated reset requests triggers HTTP 429
    console.log('  Testing rate limiter threshold...');
    let hitRateLimit = false;
    for (let i = 0; i < 6; i++) {
      const r = await httpRequest('/api/auth/forgot-password', {
        method: 'POST',
        body: { email: `rapid_test_${i}@ncst.edu.ph` }
      });
      if (r.statusCode === 429) {
        hitRateLimit = true;
        assert(r.headers['retry-after'], 'Rate limited response contains Retry-After header');
        break;
      }
    }
    assert(hitRateLimit, 'Rate limiter successfully triggered HTTP 429 on excessive requests');

    // ---------------------------------------------------------
    // [PART 9]: Final Authentication Security Blocker Regressions
    // ---------------------------------------------------------
    console.log('\n[9/9] Testing Final Authentication Security Blocker Invariants...');

    // REGRESSION TEST 1: A wrong password is rejected even when passwordChangedAt is missing
    const resWrongStudentMissingChangedAt = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'custom.student@ncst.edu.ph', password: 'CompletelyWrongPassword999!' }
    });
    assert(resWrongStudentMissingChangedAt.statusCode === 401, 'Student: wrong password rejected even when passwordChangedAt is missing');
    assert(resWrongStudentMissingChangedAt.data && resWrongStudentMissingChangedAt.data.success === false, 'Student: response success is false on wrong password');

    const resWrongOsaMissingChangedAt = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'custom.osa@ncst.edu.ph', password: 'CompletelyWrongPassword999!' }
    });
    assert(resWrongOsaMissingChangedAt.statusCode === 401, 'OSA: wrong password rejected even when passwordChangedAt is missing');
    assert(resWrongOsaMissingChangedAt.data && resWrongOsaMissingChangedAt.data.success === false, 'OSA: response success is false on wrong password');

    // REGRESSION TEST 2: An OSA account cannot be entered with admin123 unless its OWN bcrypt hash matches admin123
    const resOsaAdmin123Fail = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'custom.osa@ncst.edu.ph', password: 'admin123' }
    });
    assert(resOsaAdmin123Fail.statusCode === 401, 'OSA account CANNOT be entered with admin123 when its own bcrypt hash is custom');

    const resOsaCustomPassSuccess = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'custom.osa@ncst.edu.ph', password: 'OsaCustomPass2026!' }
    });
    assert(resOsaCustomPassSuccess.statusCode === 200, 'OSA account login succeeds ONLY when password matches its OWN bcrypt hash');

    const resOsaOwnHashMatchesAdmin123 = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'legacy.osa@ncst.edu.ph', password: 'admin123' }
    });
    assert(resOsaOwnHashMatchesAdmin123.statusCode === 200, 'OSA account whose OWN bcrypt hash matches admin123 succeeds');

    // REGRESSION TEST 3: A student cannot be entered with password123 unless their OWN bcrypt hash matches password123
    const resStudentPass123Fail = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'custom.student@ncst.edu.ph', password: 'password123' }
    });
    assert(resStudentPass123Fail.statusCode === 401, 'Student account CANNOT be entered with password123 when its own bcrypt hash is custom');

    const resStudentCustomPassSuccess = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'custom.student@ncst.edu.ph', password: 'StudentCustomPass2026!' }
    });
    assert(resStudentCustomPassSuccess.statusCode === 200, 'Student account login succeeds ONLY when password matches their OWN bcrypt hash');

    // REGRESSION TEST 4: Previously changed passwords cannot be bypassed by any old default
    // usr_test_firstlogin previously changed password to 'InitChangedPass2026!'
    const resBypassStudentOld1 = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'temp.student@ncst.edu.ph', password: 'password123' }
    });
    assert(resBypassStudentOld1.statusCode === 401, 'Previously changed student password cannot be bypassed with password123');

    const resBypassStudentOld2 = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'temp.student@ncst.edu.ph', password: 'admin123' }
    });
    assert(resBypassStudentOld2.statusCode === 401, 'Previously changed student password cannot be bypassed with admin123');

    // usr_test_osa_firstlogin previously changed password to 'OsaAdminSecure2026!'
    const resBypassOsaOld1 = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'temp.osa@ncst.edu.ph', password: 'admin123' }
    });
    assert(resBypassOsaOld1.statusCode === 401, 'Previously changed OSA password cannot be bypassed with admin123');

    const resBypassOsaOld2 = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'temp.osa@ncst.edu.ph', password: 'password123' }
    });
    assert(resBypassOsaOld2.statusCode === 401, 'Previously changed OSA password cannot be bypassed with password123');

    // rosales.frnklynrd@ncst.edu.ph reset password and then changed password to EvenNewerPass2026!
    const resBypassResetStudentOld = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'rosales.frnklynrd@ncst.edu.ph', password: 'password123' }
    });
    assert(resBypassResetStudentOld.statusCode === 401, 'Reset student account cannot be bypassed with old password123');

    // REGRESSION TEST 5: Removed passwords do not become accepted again after a server restart
    console.log('  Testing persistence layer across server restart...');
    // Kill the current test server
    serverProcess.kill();
    await new Promise(r => setTimeout(r, 600));

    // Spin up a fresh server process reading from the persisted test directory
    serverProcess = startTestServer();
    const isRestartOnline = await waitForServer();
    assert(isRestartOnline, 'Test server cleanly restarted from persisted data');

    // 5.1 After restart: Old student password is STILL rejected
    const resRestartStudentOld = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'temp.student@ncst.edu.ph', password: 'password123' }
    });
    assert(resRestartStudentOld.statusCode === 401, 'Removed student password remains rejected after server restart');

    // 5.2 After restart: Changed student password is STILL accepted
    const resRestartStudentNew = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'temp.student@ncst.edu.ph', password: 'InitChangedPass2026!' }
    });
    assert(resRestartStudentNew.statusCode === 200, 'Changed student password remains accepted after server restart');

    // 5.3 After restart: Old OSA password is STILL rejected
    const resRestartOsaOld = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'temp.osa@ncst.edu.ph', password: 'admin123' }
    });
    assert(resRestartOsaOld.statusCode === 401, 'Removed OSA password remains rejected after server restart');

    // 5.4 After restart: Changed OSA password is STILL accepted
    const resRestartOsaNew = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'temp.osa@ncst.edu.ph', password: 'OsaAdminSecure2026!' }
    });
    assert(resRestartOsaNew.statusCode === 200, 'Changed OSA password remains accepted after server restart');

    // 5.5 After restart: Custom accounts with no passwordChangedAt still reject default passwords
    const resRestartCustomOsaFail = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'custom.osa@ncst.edu.ph', password: 'admin123' }
    });
    assert(resRestartCustomOsaFail.statusCode === 401, 'Custom OSA account still rejects admin123 after server restart');

    const resRestartCustomStudentFail = await httpRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'custom.student@ncst.edu.ph', password: 'password123' }
    });
    assert(resRestartCustomStudentFail.statusCode === 401, 'Custom student account still rejects password123 after server restart');

  } finally {
    // Kill test server
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
    }
    await new Promise(r => setTimeout(r, 400));

    // Clean up temporary data directory
    if (fs.existsSync(TEMP_DATA_DIR)) {
      fs.rmSync(TEMP_DATA_DIR, { recursive: true, force: true });
    }
  }

  // Final verification: Original database is 100% untouched
  const finalDbHash = crypto.createHash('sha256').update(fs.readFileSync(ORIGINAL_DB_PATH)).digest('hex').toUpperCase();
  assert(finalDbHash === initialDbHash, `Original data/database.json is strictly intact (SHA256: ${finalDbHash.substring(0, 16)}...)`);

  console.log('\n========================================================================');
  console.log(`TOTAL ASSERTIONS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
