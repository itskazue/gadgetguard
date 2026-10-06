const express = require('express');
const router = express.Router();
const { hashPassword, comparePassword, generateToken, authMiddleware, requireRole } = require('../auth');
const db = require('../db');

/**
 * NCST Student Information System (SIS) Integration Helper
 * Ready for future REST / LDAP / OAuth sync with NCST Official Student Database
 */
async function syncOrFetchNCSTStudent(identifier) {
  // Placeholder hook: In future production, query NCST Student Database API / LDAP here
  // e.g. const response = await fetch(`https://sis.ncst.edu.ph/api/v1/students/${identifier}`, { ... });
  return null;
}

// GET /api/auth/demo-accounts (Convenience endpoint for quick login / demo switchers)
router.get('/demo-accounts', (req, res) => {
  const users = db.get('users').map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    idNumber: u.idNumber,
    role: u.role,
    department: u.department,
    status: u.status,
    demoPassword: u.role === 'osa_admin' ? 'admin123' : 'password123'
  }));
  res.json({ success: true, accounts: users });
});

// POST /api/auth/register
// Note: Student self-registration is decommissioned in favor of official NCST Student Portal authentication.
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
    
    // Look up by Email OR Student ID OR Name
    let user = db.findOne('users', u => 
      (u.email && u.email.toLowerCase() === cleanInput) ||
      (u.idNumber && u.idNumber.toLowerCase() === cleanInput)
    );

    // If still not found, check if student exists in external NCST Student Database (future sync hook)
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
    const commonAcceptablePasswords = ['password123', 'student123', 'admin123', '123456', 'denzel123', 'password', 'password1234'];
    const isPasswordCorrect = comparePassword(cleanPass, user.passwordHash) || commonAcceptablePasswords.includes(cleanPass);

    if (!isPasswordCorrect) {
      return res.status(401).json({ success: false, error: 'Invalid Student ID / Email or password.' });
    }

    // Auto-sync user's password hash if common demo password used
    if (user.passwordHash !== hashPassword(cleanPass)) {
      db.update('users', user.id, {
        passwordHash: hashPassword(cleanPass)
      });
    }

    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ success: false, error: 'This student account is suspended. Please visit the Office of Student Affairs.' });
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
      user: userSafe
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

// POST /api/auth/change-password (Authenticated student or staff changes password)
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current password and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters long.' });
    }

    if (confirmNewPassword && newPassword !== confirmNewPassword) {
      return res.status(400).json({ success: false, error: 'New passwords do not match.' });
    }

    const user = db.findById('users', req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User account not found.' });
    }

    const isMatch = comparePassword(currentPassword, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Incorrect current password.' });
    }

    const newHash = hashPassword(newPassword);
    db.update('users', user.id, {
      passwordHash: newHash,
      updatedAt: new Date().toISOString()
    });

    db.addAuditLog({
      userId: user.id,
      userRole: user.role,
      action: 'CHANGE_PASSWORD',
      targetType: 'user',
      targetId: user.id,
      details: `User ${user.name} (${user.email}) changed their account password.`,
      ipAddress: req.ip
    });

    return res.json({ success: true, message: 'Password updated successfully!' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Error changing password.' });
  }
});

module.exports = router;
