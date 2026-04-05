// backend/middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const DEBUG_AUTH = process.env.DEBUG_AUTH === 'true';

function extractTokenFromRequest(req) {
  const authHeader = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  if (typeof authHeader === 'string' && authHeader.trim()) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
      return parts[1].trim();
    }
  }
  // fallback cookie
  if (req.cookies && req.cookies.token) {
    return String(req.cookies.token).trim();
  }
  return null;
}

async function authMiddleware(req, res, next) {
  try {
    const token = extractTokenFromRequest(req);

    if (DEBUG_AUTH) {
      console.log('--- AUTH DEBUG ---');
      console.log('Auth header present?', !!(req.headers && (req.headers.authorization || req.headers.Authorization)));
      console.log('Cookie token present?', !!(req.cookies && req.cookies.token));
    }

    if (!token) {
      if (DEBUG_AUTH) console.log('AUTH DEBUG: No token extracted.');
      return res.status(401).json({ message: 'Authorization token missing.' });
    }

    if (DEBUG_AUTH) console.log('AUTH DEBUG: token first 40 chars:', token.slice(0, 40));

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
      if (DEBUG_AUTH) console.log('AUTH DEBUG: jwt.verify payload:', payload);
    } catch (e) {
      if (DEBUG_AUTH) console.error('AUTH DEBUG: jwt.verify failed:', e && e.message);
      return res.status(401).json({ message: 'Invalid or expired token.' });
    }

    const userId = payload && (payload.sub || payload.id || payload.userId);
    if (!userId) {
      return res.status(401).json({ message: 'Token payload missing user id.' });
    }

    const user = await User.findById(userId).select('-passwordHash -__v').lean().exec();
    if (!user) {
      return res.status(401).json({ message: 'User not found for this token.' });
    }

    // attach user without sensitive fields
    req.user = user;
    if (DEBUG_AUTH) console.log('AUTH DEBUG: req.user attached, _id present?', !!req.user._id);
    return next();
  } catch (err) {
    console.error('AUTH DEBUG: unexpected error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ message: 'Authentication failed.' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    try {
      if (!req.user || !req.user.role) return res.status(403).json({ message: 'Forbidden: role required.' });
      const role = String(req.user.role).toLowerCase();
      const normalized = allowedRoles.map(r => String(r).toLowerCase());
      if (!normalized.includes(role)) return res.status(403).json({ message: 'Forbidden: insufficient role.' });
      return next();
    } catch (e) {
      console.error('requireRole error:', e);
      return res.status(500).json({ message: 'Role check failed.' });
    }
  };
}

function isAdmin(req, res, next) {
  return requireRole('admin')(req, res, next);
}

module.exports = {
  authMiddleware,
  isAdmin,
  requireRole
};