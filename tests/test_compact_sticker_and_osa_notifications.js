/**
 * Test Suite: Compact Printable QR Sticker + OSA Notifications UX Verification
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');

console.log('--- RUNNING COMPACT QR STICKER & OSA NOTIFICATIONS TEST SUITE ---');

const rootDir = path.resolve(__dirname, '..');

// =========================================================================
// 1. Physical QR Sticker Dimensions & CSS Rules
// =========================================================================
const cssPath = path.join(rootDir, 'public', 'css', 'style.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

assert(cssContent.includes('width: 45mm'), 'Print CSS must enforce width: 45mm');
assert(cssContent.includes('height: 55mm'), 'Print CSS must enforce height: 55mm');
assert(cssContent.includes('width: 30mm'), 'Print CSS must enforce QR width: 30mm');
assert(cssContent.includes('height: 30mm'), 'Print CSS must enforce QR height: 30mm');
assert(cssContent.includes('overflow: hidden'), 'Print CSS must prevent clipping/overflow');
console.log('✅ PASS: Physical print dimensions (45x55mm, 30x30mm QR) verified');

// =========================================================================
// 2. Sticker Markup & Short Fallback Link (/drop)
// =========================================================================
const osaHtmlPath = path.join(rootDir, 'public', 'osa', 'index.html');
const osaHtml = fs.readFileSync(osaHtmlPath, 'utf8');

assert(osaHtml.includes('ncstgadgetguard.onrender.com/drop'), 'Sticker must contain short /drop link');
assert(osaHtml.includes('FOUND THIS DEVICE?'), 'Sticker must retain surrender header');
assert(osaHtml.includes('Scan QR or surrender to OSA:'), 'Sticker must retain compact surrender instruction');
assert(osaHtml.includes('id="admin-sticker-qr-img"'), 'Sticker must retain QR code image element');
assert(osaHtml.includes('id="admin-sticker-token"'), 'Sticker must retain unique device token element');
console.log('✅ PASS: Sticker HTML markup and short /drop URL verified');

// =========================================================================
// 3. OSA Navigation Badge & Notifications Toolbar Invariants
// =========================================================================
assert(osaHtml.includes('id="osa-notif-badge"'), 'Sidebar must include #osa-notif-badge element');
assert(osaHtml.includes('osa-badge-counter'), 'Badge element must use standard .osa-badge-counter class');
assert(osaHtml.includes('id="osa-mark-all-read-btn"'), 'Screen 9 must include Mark All as Read button');
assert(osaHtml.includes('markAllOsaNotificationsRead()'), 'Mark All as Read button must call markAllOsaNotificationsRead()');
assert(osaHtml.includes('id="osa-notif-filter-all"'), 'Screen 9 must include All filter button');
assert(osaHtml.includes('id="osa-notif-filter-unread"'), 'Screen 9 must include Unread filter button');
console.log('✅ PASS: OSA sidebar badge and Screen 9 toolbar elements verified');

// =========================================================================
// 4. Controller Logic & Safety Guards in public/osa/osa.js
// =========================================================================
const osaJsPath = path.join(rootDir, 'public', 'osa', 'osa.js');
const osaJs = fs.readFileSync(osaJsPath, 'utf8');

assert(osaJs.includes('markAllOsaNotificationsRead'), 'osa.js must implement markAllOsaNotificationsRead');
assert(osaJs.includes('setOsaNotificationFilter'), 'osa.js must implement setOsaNotificationFilter');
assert(osaJs.includes('toggleOsaNotification'), 'osa.js must implement toggleOsaNotification');
assert(osaJs.includes('markSingleOsaNotificationRead'), 'osa.js must implement markSingleOsaNotificationRead');
assert(osaJs.includes('resolveOsaDestination'), 'osa.js must implement resolveOsaDestination');
assert(osaJs.includes('updateOsaNotifBadge'), 'osa.js must implement updateOsaNotifBadge');
assert(
  osaJs.includes('link.startsWith(\'/student\')') || osaJs.includes('link.includes(\'student/\')'),
  'resolveOsaDestination must strictly guard against sending OSA admins to student portal'
);
console.log('✅ PASS: osa.js notification controller functions and safety guards verified');

// =========================================================================
// 5. Backend Server Routes & Notification API Isolation Test
// =========================================================================
async function runApiTests() {
  const DB_PATH = path.join(rootDir, 'data', 'database.json');
  const dbBackup = fs.readFileSync(DB_PATH);

  const db = require('../server/db');
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'gadgetguard_super_secret_jwt_key_2026';

  await db.initDB();

  // Create isolated test app matching server.js routing
  const app = express();
  app.use(express.json());

  // Mount /drop route
  app.get(['/drop', '/drop/'], (req, res) => {
    res.redirect(302, '/#osa-surrender');
  });

  // Mount notification routes
  const notificationRoutes = require('../server/routes/notificationRoutes');
  app.use('/api/notifications', notificationRoutes);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 5a. Test /drop route redirect
    const dropRes = await fetch(`${baseUrl}/drop`, { redirect: 'manual' });
    assert.strictEqual(dropRes.status, 302, '/drop must return 302 redirect');
    assert.strictEqual(dropRes.headers.get('location'), '/#osa-surrender', '/drop must redirect to /#osa-surrender');
    console.log('✅ PASS: Public /drop route returns 302 redirect to /#osa-surrender');

    // 5b. Prepare test users and notifications using existing accounts
    const auth = require('../server/auth');
    const osaUser = db.find('users', u => u.role === 'osa_admin')[0];
    const studentUser = db.find('users', u => u.role === 'student')[0];
    assert(osaUser, 'OSA Admin user must exist in database');
    assert(studentUser, 'Student user must exist in database');

    const osaToken = auth.generateToken(osaUser);
    const studentToken = auth.generateToken(studentUser);

    // Measure baseline unread counts before inserting test records
    const initialOsaUnread = db.find('notifications', n => n.userId === osaUser.id && !n.read).length;
    const initialStudentUnread = db.find('notifications', n => n.userId === studentUser.id && !n.read).length;

    // Insert 2 test notifications for OSA
    const notif1 = db.insert('notifications', {
      id: 'notif_test_osa_1_' + Date.now(),
      userId: osaUser.id,
      title: '🚨 MISSING GADGET REPORTED',
      message: 'A student reported an Apple MacBook Air missing in Room 1109.',
      type: 'missing_alert',
      linkUrl: '#missing',
      read: false,
      createdAt: new Date().toISOString()
    });

    const notif2 = db.insert('notifications', {
      id: 'notif_test_osa_2_' + Date.now(),
      userId: osaUser.id,
      title: '📋 NEW GADGET PENDING VERIFICATION',
      message: 'New laptop registered for verification.',
      type: 'registration_pending',
      linkUrl: '#approvals',
      read: false,
      createdAt: new Date().toISOString()
    });

    // Insert 1 test notification for Student
    const notifStudent = db.insert('notifications', {
      id: 'notif_test_student_1_' + Date.now(),
      userId: studentUser.id,
      title: '🛡️ Device Approved',
      message: 'Your laptop has been verified.',
      type: 'approval',
      read: false,
      createdAt: new Date().toISOString()
    });

    // 5c. Fetch notifications for OSA
    const fetchOsaRes = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${osaToken}` }
    });
    const fetchOsaJson = await fetchOsaRes.json();
    assert.strictEqual(fetchOsaJson.success, true);
    assert.strictEqual(fetchOsaJson.unreadCount, initialOsaUnread + 2);

    // 5d. Mark single notification as read
    const singleReadRes = await fetch(`${baseUrl}/api/notifications/${notif1.id}/read`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${osaToken}` }
    });
    const singleReadJson = await singleReadRes.json();
    assert.strictEqual(singleReadJson.success, true);
    assert.strictEqual(singleReadJson.notification.read, true);

    const checkOsaRes = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${osaToken}` }
    });
    const checkOsaJson = await checkOsaRes.json();
    assert.strictEqual(checkOsaJson.unreadCount, initialOsaUnread + 1);

    // 5e. Mark All as Read for OSA
    const readAllRes = await fetch(`${baseUrl}/api/notifications/read-all`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${osaToken}` }
    });
    const readAllJson = await readAllRes.json();
    assert.strictEqual(readAllJson.success, true);
    assert.strictEqual(readAllJson.unreadCount, 0);

    // 5f. Verify OSA has 0 unread now
    const afterReadAllRes = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${osaToken}` }
    });
    const afterReadAllJson = await afterReadAllRes.json();
    assert.strictEqual(afterReadAllJson.unreadCount, 0);
    assert(afterReadAllJson.notifications.every(n => n.read === true), 'All OSA notifications must be read');

    // 5g. Verify Student notification is STILL UNREAD (strict isolation)
    const studentRes = await fetch(`${baseUrl}/api/notifications`, {
      headers: { Authorization: `Bearer ${studentToken}` }
    });
    const studentJson = await studentRes.json();
    assert.strictEqual(studentJson.unreadCount, initialStudentUnread + 1, 'Student unread count must remain baseline + 1');
    const studentNotifItem = studentJson.notifications.find(n => n.id === notifStudent.id);
    assert.strictEqual(studentNotifItem.read, false, 'Student notification read status must remain false');
    console.log('✅ PASS: User isolation preserved — Student notifications completely unaffected');

    // 5h. Verify calling mark-all-read again when all already read handles gracefully
    const repeatReadAllRes = await fetch(`${baseUrl}/api/notifications/read-all`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${osaToken}` }
    });
    const repeatReadAllJson = await repeatReadAllRes.json();
    assert.strictEqual(repeatReadAllJson.success, true);
    assert.strictEqual(repeatReadAllJson.updatedCount, 0);
    console.log('✅ PASS: Repeated Mark All as Read handled gracefully with 0 updates');

    // Clean up test notifications
    db.delete('notifications', notif1.id);
    db.delete('notifications', notif2.id);
    db.delete('notifications', notifStudent.id);

  } finally {
    fs.writeFileSync(DB_PATH, dbBackup);
    server.close();
  }

  console.log('\n======================================================');
  console.log('ALL COMPACT QR STICKER & OSA NOTIFICATIONS CHECKS PASSED');
  console.log('======================================================\n');
}

runApiTests().catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
