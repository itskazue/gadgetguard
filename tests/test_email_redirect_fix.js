/**
 * Test Suite: Email Button Redirect & Base URL Resolution Verification
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mailer = require('../server/services/mailer');

console.log('--- RUNNING EMAIL REDIRECT & BASE URL RESOLUTION TEST SUITE ---');

// 1. Centralized Base URL Resolver
const defaultBase = mailer.getAppBaseUrl();
assert.strictEqual(defaultBase, 'https://ncstgadgetguard.onrender.com', 'Default base URL must be canonical Render domain');

// 1b. Test localhost isolation when APP_URL is set in local .env
process.env.APP_URL = 'http://localhost:3000';
delete process.env.NODE_ENV;
delete process.env.ALLOW_LOCAL_EMAIL_URLS;
assert.strictEqual(
  mailer.getAppBaseUrl(),
  'https://ncstgadgetguard.onrender.com',
  'Must ignore localhost APP_URL from .env during live email construction'
);

// 1c. Test local offline test mode explicitly
process.env.NODE_ENV = 'test_local';
assert.strictEqual(
  mailer.getAppBaseUrl(),
  'http://localhost:3000',
  'Respects test_local mode when explicitly requested for offline testing'
);
delete process.env.NODE_ENV;
delete process.env.APP_URL;

const customReq = {
  protocol: 'https',
  headers: {
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'campus-portal.ncst.edu.ph'
  }
};
assert.strictEqual(mailer.getAppBaseUrl(customReq), 'https://campus-portal.ncst.edu.ph', 'Respects production custom host headers');

const localhostReq = {
  protocol: 'http',
  headers: {
    host: 'localhost:3000'
  }
};
assert.strictEqual(mailer.getAppBaseUrl(localhostReq), 'https://ncstgadgetguard.onrender.com', 'Safely falls back to canonical domain when localhost is received in non-local environment');

console.log('✅ PASS: getAppBaseUrl resolver verified');

// 2. Student Portal URL Resolver
assert.strictEqual(
  mailer.getStudentPortalUrl(),
  'https://ncstgadgetguard.onrender.com/student/',
  'Default student portal URL must point to /student/'
);

assert.strictEqual(
  mailer.getStudentPortalUrl('https://ncstgadgetguard.onrender.com'),
  'https://ncstgadgetguard.onrender.com/student/',
  'Automatically appends /student/ if root domain is provided'
);

assert.strictEqual(
  mailer.getStudentPortalUrl('https://ncstgadgetguard.onrender.com/student/'),
  'https://ncstgadgetguard.onrender.com/student/',
  'Preserves exact /student/ URL'
);

assert.strictEqual(
  mailer.getStudentPortalUrl('https://ncstgadgetguard.onrender.com/student'),
  'https://ncstgadgetguard.onrender.com/student/',
  'Ensures trailing slash on /student/'
);

assert.strictEqual(
  mailer.getStudentPortalUrl('/student/#gadgets'),
  'https://ncstgadgetguard.onrender.com/student/#gadgets',
  'Resolves relative path with hash correctly'
);

console.log('✅ PASS: getStudentPortalUrl resolver verified');

// 3. Approval Email Template Output Verification
const approvalPayload = mailer.generateApprovalEmailPayload({
  studentEmail: 'student.test@ncst.edu.ph',
  studentName: 'Rosales Frnklynrd',
  studentId: '2024-58694',
  gadgetInfo: {
    brand: 'Apple',
    model: 'MacBook Air M2',
    category: 'Laptop',
    serialNumber: 'C02G8491MD6R'
  }
});

assert(approvalPayload, 'Approval email payload must be generated');
assert.strictEqual(approvalPayload.to, 'student.test@ncst.edu.ph');
assert(approvalPayload.html.includes('Access Student Portal 🚀'), 'Email must contain "Access Student Portal 🚀" CTA');
assert(
  approvalPayload.html.includes('href="https://ncstgadgetguard.onrender.com/student/"'),
  'CTA button href MUST point to https://ncstgadgetguard.onrender.com/student/'
);
assert(!approvalPayload.html.includes('localhost'), 'Approval email must NEVER contain localhost');
assert(!approvalPayload.html.includes('3000'), 'Approval email must NEVER contain port 3000');
console.log('✅ PASS: sendApprovalEmail CTA button verified pointing to live /student/');

// 4. Password Reset Email Template Output Verification
const resetPayload = mailer.generatePasswordResetEmailPayload({
  to: 'student.test@ncst.edu.ph',
  name: 'Rosales Frnklynrd',
  resetUrl: 'https://ncstgadgetguard.onrender.com/reset-password.html?token=test_tok_123',
  role: 'student'
});

assert(resetPayload, 'Password reset email payload must be generated');
assert(resetPayload.html.includes('Reset My Password &rarr;'), 'Email must contain reset password CTA');
assert(
  resetPayload.html.includes('href="https://ncstgadgetguard.onrender.com/reset-password.html?token=test_tok_123"'),
  'Reset CTA button href MUST point to live reset-password.html'
);
assert(!resetPayload.html.includes('localhost'), 'Password reset email must NEVER contain localhost');
console.log('✅ PASS: sendPasswordResetEmail CTA button verified pointing to live domain');

    // 5. Frontend Redirect Invariant Checks
    const studentJs = fs.readFileSync(path.join(__dirname, '../public/student/student.js'), 'utf8');
    assert(
      studentJs.includes('/?login=1&redirect='),
      'student.js must include redirect parameter preservation when unauthenticated'
    );

    const publicJs = fs.readFileSync(path.join(__dirname, '../public/js/public.js'), 'utf8');
    assert(
      publicJs.includes("urlParams.get('redirect')"),
      'public.js must check redirect parameter when user is already logged in or logs in'
    );
    assert(
      publicJs.includes("window.location.href = redirectUrl"),
      'public.js must redirect to destination URL on successful login'
    );
    console.log('✅ PASS: Frontend unauthenticated & post-login redirect flow verified');

console.log('\n======================================================');
console.log('ALL EMAIL REDIRECT & BASE URL CHECKS PASSED (100%)');
console.log('======================================================\n');
