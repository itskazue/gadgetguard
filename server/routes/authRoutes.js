const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { hashPassword, comparePassword, validatePasswordStrength, generateToken, authMiddleware, requireRole } = require('../auth');
const db = require('../db');
const { sendPasswordResetEmail } = require('../services/mailer');
const { rateLimiter } = require('../services/rateLimiter');

// Rate limiters for security endpoints
const forgotPasswordIpLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  keyPrefix: 'forgot_ip',
  message: 'Too many password reset requests from this network. Please try again after 15 minutes.'
});

const forgotPasswordEmailLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 3,
  keyPrefix: 'forgot_email',
  keyGenerator: (req) => {
    const email = req.body && req.body.email ? String(req.body.email).trim().toLowerCase() : '';
    return email ? `pwd_email_${email}` : (req.ip || 'unknown');
  },
  message: 'Too many reset requests for this account. Please wait 15 minutes before requesting another link.'
});

const resetPasswordLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyPrefix: 'reset_ip',
  message: 'Too many password reset attempts. Please wait 15 minutes before trying again.'
});

/**
 * NCST Student Information System (SIS) Integration Helper
 * Ready for future REST / LDAP / OAuth sync with NCST Official Student Database
 */
async function syncOrFetchNCSTStudent(identifier) {
  return null;
}

// GET /api/auth/demo-accounts
// Returns active accounts list for testing; demoPassword exposure removed for security
router.get('/demo-accounts', (req, res) => {
  const users = db.get('users').map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    idNumber: u.idNumber,
    role: u.role,
    department: u.department,
    status: u.status
  }));
  res.json({ success: true, accounts: users });
});

// POST /api/auth/register
// Student self-registration is decommissioned in favor of official NCST Student Portal authentication.
router.post('/register', async (req, res) => {
  return res.status(403).json({
    success: false,
    error: 'Student self-registration is disabled. All student accounts are pre-provisioned via the official NCST Student Information System (SIS). Please log in using your student credentials.'
  });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Student ID / Email and password are required.' });
    }

    const cleanInput = email.trim().toLowerCase();
    
    // Look up by Email OR Student ID OR Staff ID
    let user = db.findOne('users', u => 
      (u.email && u.email.toLowerCase() === cleanInput) ||
      (u.idNumber && u.idNumber.toLowerCase() === cleanInput)
    );

    // If still not found, check external NCST SIS hook
    if (!user) {
      const sisStudent = await syncOrFetchNCSTStudent(cleanInput);
      if (sisStudent) {
        user = db.insert('users', {
          id: 'usr_' + Date.now().toString(36),
          name: sisStudent.name,
          email: sisStudent.email.toLowerCase(),
          passwordHash: hashPassword(password),
          role: 'student',
          idNumber: sisStudent.idNumber,
          department: sisStudent.course || 'College',
          contactNumber: sisStudent.contactNumber || '',
          status: 'ACTIVE',
          avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(sisStudent.name)}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    }

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid Student ID / Email or password.' });
    }

    const cleanPass = password.trim();

    // Verify password hash strictly with bcrypt
    const isPasswordCorrect = comparePassword(cleanPass, user.passwordHash);

    if (!isPasswordCorrect) {
      return res.status(401).json({ success: false, error: 'Invalid Student ID / Email or password.' });
    }

    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ success: false, error: 'This account is suspended. Please visit the Office of Student Affairs.' });
    }

    db.addAuditLog({
      userId: user.id,
      userRole: user.role,
      action: 'USER_LOGIN',
      targetType: 'user',
      targetId: user.id,
      details: `User login: ${user.name} (${user.role}, ID: ${user.idNumber})`,
      ipAddress: req.ip
    });

    const token = generateToken(user);
    const { passwordHash, ...userSafe } = user;

    return res.json({
      success: true,
      message: 'Login successful!',
      token,
      user: userSafe,
      mustChangePassword: !!user.mustChangePassword
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, error: 'Server error during authentication.' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const { passwordHash, ...userSafe } = req.user;
  res.json({ success: true, user: userSafe });
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, (req, res) => {
  try {
    const { name, department, contactNumber, avatarUrl } = req.body;
    const updates = {};
    if (name) updates.name = name.trim();
    if (department) updates.department = department.trim();
    if (contactNumber) updates.contactNumber = contactNumber.trim();
    if (avatarUrl) updates.avatarUrl = avatarUrl.trim();

    const updatedUser = db.update('users', req.user.id, updates);
    const { passwordHash, ...userSafe } = updatedUser;

    res.json({ success: true, message: 'Profile updated!', user: userSafe });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Error updating profile.' });
  }
});

// POST /api/auth/forgot-password
// Dispatches 15-minute expiring reset token; returns generic response to prevent account enumeration
router.post('/forgot-password', forgotPasswordIpLimiter, forgotPasswordEmailLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Registered email address is required.' });
    }

    const cleanInput = email.trim().toLowerCase();

    // Look up by email (or Student ID fallback)
    const user = db.findOne('users', u => 
      (u.email && u.email.toLowerCase() === cleanInput) ||
      (u.idNumber && u.idNumber.toLowerCase() === cleanInput)
    );

    // If active user found, generate secure reset token
    if (user && user.status === 'ACTIVE') {
      // Cryptographically secure 32-byte (64 hex char) random token
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      // Invalidate any existing active tokens for this user
      const existingActive = db.find('password_resets', r => r.userId === user.id && !r.used);
      for (const t of existingActive) {
        db.update('password_resets', t.id, { used: true, invalidatedAt: new Date().toISOString() });
      }

      // 15-minute expiration
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const resetRecord = {
        id: 'rst_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'),
        userId: user.id,
        email: user.email,
        tokenHash,
        expiresAt,
        used: false,
        usedAt: null,
        createdAt: new Date().toISOString(),
        ipAddress: req.ip
      };

      db.insert('password_resets', resetRecord);

      // Build reset URL
      const host = req.get('host');
      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const baseUrl = process.env.APP_URL || `${protocol}://${host}`;
      const resetUrl = `${baseUrl}/reset-password.html?token=${rawToken}`;

      // Dispatch branded reset email (never log rawToken or resetUrl)
      sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
        role: user.role
      }).catch(err => {
        console.warn('⚠️ [Forgot Password] Email delivery dispatch failed:', err.message);
      });

      db.addAuditLog({
        userId: user.id,
        userRole: user.role,
        action: 'REQUEST_PASSWORD_RESET',
        targetType: 'user',
        targetId: user.id,
        details: `Password reset link requested for ${user.email}`,
        ipAddress: req.ip
      });

      if (process.env.NODE_ENV === 'test') {
        res.setHeader('X-Test-Reset-Token', rawToken);
      }
    }

    // Generic response returned for both found and non-existent accounts to prevent enumeration
    const emailsEnabled = process.env.SEND_RESET_EMAILS === 'true';
    const message = emailsEnabled
      ? 'If an active account with that email exists, password reset instructions have been sent.'
      : 'Password reset request received. Automated email delivery is temporarily disabled. If an active account with that email exists, please visit the Office of Student Affairs (Cubicle 8, Multipurpose Building) for assisted credential recovery.';

    return res.json({
      success: true,
      emailDeliveryDisabled: !emailsEnabled,
      message
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ success: false, error: 'Server error processing password reset request.' });
  }
});

// GET /api/auth/verify-reset-token
// Verifies whether a token is valid, unused, and within the 15-minute window
router.get('/verify-reset-token', (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ success: false, valid: false, error: 'Reset token is required.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const resetRecord = db.findOne('password_resets', r => r.tokenHash === tokenHash);

    if (!resetRecord) {
      return res.status(400).json({ success: false, valid: false, error: 'Invalid or expired password reset link.' });
    }

    if (resetRecord.used) {
      return res.status(400).json({ success: false, valid: false, error: 'This password reset link has already been used. Please request a new one.' });
    }

    if (new Date(resetRecord.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ success: false, valid: false, error: 'This password reset link has expired. Please request a new one.' });
    }

    return res.json({
      success: true,
      valid: true,
      email: resetRecord.email
    });
  } catch (err) {
    return res.status(500).json({ success: false, valid: false, error: 'Server error verifying reset token.' });
  }
});

// Test-only endpoint to safely simulate token expiration in automated tests
if (process.env.NODE_ENV === 'test') {
  router.post('/test-expire-token', (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ success: false, error: 'Token is required.' });
      const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
      const resetRecord = db.findOne('password_resets', r => r.tokenHash === tokenHash);
      if (!resetRecord) return res.status(404).json({ success: false, error: 'Token record not found.' });
      db.update('password_resets', resetRecord.id, {
        expiresAt: new Date(Date.now() - 60 * 1000).toISOString()
      });
      return res.json({ success: true, message: 'Token expired for test.' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });
}

// POST /api/auth/reset-password
// Consumes single-use reset token and sets new password
router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token || typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ success: false, error: 'Reset token is required.' });
    }

    if (!newPassword) {
      return res.status(400).json({ success: false, error: 'New password is required.' });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'New passwords do not match.' });
    }

    // Strong password validation (at least 8 chars, letters and numbers)
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      return res.status(400).json({ success: false, error: strength.error });
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const resetRecord = db.findOne('password_resets', r => r.tokenHash === tokenHash);

    if (!resetRecord) {
      return res.status(400).json({ success: false, error: 'Invalid or expired password reset link.' });
    }

    if (resetRecord.used) {
      return res.status(400).json({ success: false, error: 'This password reset link has already been used. Please request a new one.' });
    }

    if (new Date(resetRecord.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ success: false, error: 'This password reset link has expired. Please request a new one.' });
    }

    // Immediate synchronous check-and-set claim to prevent in-process concurrency race conditions
    const nowIso = new Date().toISOString();
    resetRecord.used = true;
    resetRecord.usedAt = nowIso;
    db.update('password_resets', resetRecord.id, {
      used: true,
      usedAt: nowIso
    });

    const user = db.findById('users', resetRecord.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User account associated with this token no longer exists.' });
    }

    // Update password hash, clear mustChangePassword, record change timestamp
    const newHash = hashPassword(newPassword);

    db.update('users', user.id, {
      passwordHash: newHash,
      mustChangePassword: false,
      passwordChangedAt: nowIso,
      updatedAt: nowIso
    });

    // Invalidate all remaining tokens for this user
    const otherTokens = db.find('password_resets', r => r.userId === user.id && !r.used);
    for (const t of otherTokens) {
      db.update('password_resets', t.id, { used: true, invalidatedAt: nowIso });
    }

    db.addAuditLog({
      userId: user.id,
      userRole: user.role,
      action: 'RESET_PASSWORD_SUCCESS',
      targetType: 'user',
      targetId: user.id,
      details: `Password reset successfully via verified token for ${user.email}`,
      ipAddress: req.ip
    });

    return res.json({
      success: true,
      message: 'Your password has been successfully reset. You may now log in with your new password.'
    });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ success: false, error: 'Server error resetting password.' });
  }
});

// POST /api/auth/change-password (Authenticated student or staff changes password)
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required.' });
    }

    // Strong password validation
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      return res.status(400).json({ success: false, error: strength.error });
    }

    if (confirmNewPassword && newPassword !== confirmNewPassword) {
      return res.status(400).json({ success: false, error: 'New passwords do not match.' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, error: 'New password cannot be the same as your current password.' });
    }

    const user = db.findById('users', req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User account not found.' });
    }

    // Verify current password strictly with bcrypt
    const isMatch = comparePassword(currentPassword, user.passwordHash);

    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Incorrect current password.' });
    }

    const newHash = hashPassword(newPassword);
    const nowIso = new Date().toISOString();

    db.update('users', user.id, {
      passwordHash: newHash,
      mustChangePassword: false,
      passwordChangedAt: nowIso,
      updatedAt: nowIso
    });

    // Invalidate any active password reset tokens for this user
    const pendingTokens = db.find('password_resets', r => r.userId === user.id && !r.used);
    for (const t of pendingTokens) {
      db.update('password_resets', t.id, { used: true, invalidatedAt: nowIso });
    }

    db.addAuditLog({
      userId: user.id,
      userRole: user.role,
      action: 'CHANGE_PASSWORD',
      targetType: 'user',
      targetId: user.id,
      details: `User ${user.name} (${user.email}) changed their account password.`,
      ipAddress: req.ip
    });

    const updatedUser = db.findById('users', user.id);
    const newToken = generateToken(updatedUser);

    return res.json({
      success: true,
      message: 'Password updated successfully!',
      token: newToken
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error changing password.' });
  }
});

// GET /api/auth/users (OSA Admin only)
router.get('/users', authMiddleware, requireRole('osa_admin'), (req, res) => {
  const users = db.get('users').map(u => {
    const { passwordHash, ...safe } = u;
    const gadgetCount = db.find('gadgets', g => g.userId === u.id).length;
    return { ...safe, gadgetCount };
  });
  res.json({ success: true, users });
});

// PUT /api/auth/users/:id/status (OSA Admin toggle status)
router.put('/users/:id/status', authMiddleware, requireRole('osa_admin'), (req, res) => {
  const { status } = req.body;
  if (!['ACTIVE', 'SUSPENDED', 'PENDING_APPROVAL'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status.' });
  }

  const updated = db.update('users', req.params.id, { status });
  if (!updated) {
    return res.status(404).json({ success: false, error: 'User not found.' });
  }

  db.addAuditLog({
    userId: req.user.id,
    userRole: req.user.role,
    action: 'UPDATE_USER_STATUS',
    targetType: 'user',
    targetId: req.params.id,
    details: `Updated status of user ${updated.name} to ${status}`,
    ipAddress: req.ip
  });

  res.json({ success: true, message: `User status changed to ${status}`, user: updated });
});

// Test helper: expire token for testing (only available when NODE_ENV === 'test')
if (process.env.NODE_ENV === 'test') {
  router.post('/test-expire-token', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false });
    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    const rec = db.findOne('password_resets', r => r.tokenHash === tokenHash);
    if (rec) {
      db.update('password_resets', rec.id, {
        expiresAt: new Date(Date.now() - 60000).toISOString()
      });
      return res.json({ success: true, expired: true });
    }
    return res.status(404).json({ success: false });
  });
}

module.exports = router;

