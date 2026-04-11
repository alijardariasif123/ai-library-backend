const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ================= ENV SAFETY =================
if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET not set");
}

const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES || "1h";
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES || "7d";

// ================= TOKEN GENERATORS =================
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

const generateRefreshToken = (user) => {
    return jwt.sign(
        { sub: user._id.toString() },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: REFRESH_EXPIRES_IN }
    );
};

// ================= AUTH MIDDLEWARE =================
const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization || '';

        const tokenFromHeader = authHeader.startsWith("Bearer ")
            ? authHeader.split(" ")[1]
            : null;

        // ✅ header + cookie support (merged feature)
        const token = tokenFromHeader || req.cookies?.token || null;

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

        // ✅ DB verification (security)
        const user = await User.findById(decoded.sub).lean();

        if (!user) {
            return res.status(401).json({ message: "User not found or deleted" });
        }

        req.user = user;
        next();

    } catch (err) {
        console.error("Auth Middleware Error:", err);
        return res.status(500).json({ message: "Authentication failed" });
    }
};

// ================= ADMIN GUARD =================
const isAdmin = (req, res, next) => {
    if (String(req.user?.role).toLowerCase() === "admin") {
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