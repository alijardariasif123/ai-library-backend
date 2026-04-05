// File: backend/middleware/auth_pro.js
// ✔ Secure JWT Authentication System
// ✔ DB verification included
// ✔ Works perfectly with your AI routes, admin routes, payments, etc.

const jwt = require('jsonwebtoken');
const User = require('../models/User');

const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES || "1h";   // recommended 1h
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES || "7d";

// -----------------------------------------------------
// Generate Access Token
// -----------------------------------------------------
const generateAccessToken = (user) => {
    return jwt.sign(
        {
            sub: user._id.toString(),
            role: user.role,
            plan: user.plan
        },
        process.env.JWT_SECRET,
        { expiresIn: ACCESS_EXPIRES_IN }
    );
};

// -----------------------------------------------------
// Generate Refresh Token
// -----------------------------------------------------
const generateRefreshToken = (user) => {
    return jwt.sign(
        {
            sub: user._id.toString()
        },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: REFRESH_EXPIRES_IN }
    );
};

// -----------------------------------------------------
// Authentication Middleware
// -----------------------------------------------------
const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;

        if (!token) {
            return res.status(401).json({ message: "Access token required" });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            if (err.name === "TokenExpiredError") {
                return res.status(401).json({ message: "Token expired" });
            }
            return res.status(403).json({ message: "Invalid token" });
        }

        // IMPORTANT SECURITY FIX:
        // Fetch user from DB (token alone is not trusted)
        const user = await User.findById(decoded.sub).lean();
        if (!user) {
            return res.status(401).json({ message: "User not found or deleted" });
        }

        // Attach full user object to request
        req.user = user;
        next();

    } catch (err) {
        console.error("Auth Middleware Error:", err);
        return res.status(500).json({ message: "Authentication failed" });
    }
};

// -----------------------------------------------------
// Admin Guard
// -----------------------------------------------------
const isAdmin = (req, res, next) => {
    if (req.user?.role === "admin") {
        return next();
    }
    return res.status(403).json({ message: "Admin access required" });
};

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    authMiddleware,
    isAdmin
};
