// File: backend/routes/auth.js
// Auth routes: register, login, refresh

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/User');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret';

// expiries configurable via env (examples: "1h", "7d")
const JWT_ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '1h';
const JWT_REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

// bcrypt rounds configurable
const BCRYPT_ROUNDS = Math.max(4, parseInt(process.env.BCRYPT_ROUNDS || '10', 10));

// ✅ Token helpers
function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: JWT_ACCESS_EXPIRES }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString()
    },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES }
  );
}

// Utility: safe user shape for responses (no passwordHash)
function safeUserPayload(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    plan: user.plan,
    usageStats: user.usageStats
  };
}

// ==============================
// POST /api/auth/register
// ==============================
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({
        message: 'Name, email and password are required.'
      });
    }

    const cleanEmail = String(email).toLowerCase().trim();

    const existing = await User.findOne({ email: cleanEmail }).lean();
    if (existing) {
      return res.status(400).json({
        message: 'An account with this email already exists.'
      });
    }

    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);

    // Create user
    const user = await User.create({
      name: String(name).trim(),
      email: cleanEmail,
      passwordHash
    });

    // create tokens
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    return res.status(201).json({
      user: safeUserPayload(user),
      accessToken, // top-level for convenience (frontend compatibility)
      refreshToken,
      tokens: {
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    console.error('Register error:', error && error.stack ? error.stack : error);
    return res.status(500).json({
      message: 'Failed to register user.'
    });
  }
});

// ==============================
// POST /api/auth/login
// ==============================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        message: 'Email and password are required.'
      });
    }

    const cleanEmail = String(email).toLowerCase().trim();

    // IMPORTANT: passwordHash may be `select: false` in the model — explicitly request it
    const user = await User.findOne({ email: cleanEmail }).select('+passwordHash').exec();
    if (!user) {
      // avoid revealing which part is wrong
      return res.status(401).json({
        message: 'Invalid email or password.'
      });
    }

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) {
      return res.status(401).json({
        message: 'Invalid email or password.'
      });
    }

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    return res.status(200).json({
      user: safeUserPayload(user),
      accessToken, // top-level
      refreshToken,
      tokens: {
        accessToken,
        refreshToken
      }
    });
  } catch (error) {
    console.error('Login error:', error && error.stack ? error.stack : error);
    return res.status(500).json({
      message: 'Failed to login.'
    });
  }
});

// ==============================
// POST /api/auth/refresh
// ==============================
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};

    if (!refreshToken) {
      return res.status(400).json({
        message: 'Refresh token is required.'
      });
    }

    let payload;
    try {
      payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid refresh token.' });
    }

    // Optionally: verify refresh token is still valid (if you store server-side)
    // e.g., check a token blacklist or token store to support logout / rotation

    const user = await User.findById(payload.sub).lean();
    if (!user) {
      return res.status(401).json({ message: 'User not found for this token.' });
    }

    const newAccessToken = signAccessToken(user);

    // (Optional) rotate refresh token — uncomment to issue a new refresh token:
    // const newRefreshToken = signRefreshToken(user);

    return res.status(200).json({
      accessToken: newAccessToken,
      // refreshToken: newRefreshToken, // if rotating
      tokens: {
        accessToken: newAccessToken
        // refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    console.error('Refresh token error:', error && error.stack ? error.stack : error);
    return res.status(500).json({
      message: 'Failed to refresh token.'
    });
  }
});

module.exports = router;

