const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'gadgetguard_super_secret_jwt_key_2026';

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      idNumber: user.idNumber,
      pwdAt: user.passwordChangedAt || 'initial'
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required. Please login.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.findById('users', decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User account no longer exists.' });
    }
    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ success: false, error: 'Your account has been suspended by OSA.' });
    }

    // Invalidate sessions issued prior to password change/reset
    if (user.passwordChangedAt) {
      // Direct timestamp matching ensures microsecond precision regardless of unix-second rounding
      if (decoded.pwdAt && decoded.pwdAt !== user.passwordChangedAt) {
        return res.status(401).json({
          success: false,
          error: 'Your password was recently changed. Please log in with your new password.',
          code: 'SESSION_REVOKED'
        });
      }
      // Backward compatibility for tokens signed prior to pwdAt claim
      if (!decoded.pwdAt && decoded.iat) {
        const changedAtSec = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
        if (decoded.iat < changedAtSec) {
          return res.status(401).json({
            success: false,
            error: 'Your password was recently changed. Please log in with your new password.',
            code: 'SESSION_REVOKED'
          });
        }
      }
    }


    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session token.' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        error: `Access denied. Requires one of roles: [${allowedRoles.join(', ')}]` 
      });
    }
    next();
  };
}

function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required.' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return { valid: false, error: 'Password must contain both letters and numbers.' };
  }
  return { valid: true };
}

module.exports = {
  hashPassword,
  comparePassword,
  validatePasswordStrength,
  generateToken,
  authMiddleware,
  requireRole,
  JWT_SECRET
};

