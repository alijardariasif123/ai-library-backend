// // backend/app.js
// // Main Express app configuration for Study Assistant AI
// // - Global middlewares
// // - API routes
// // - Security
// // - Error handling

// const express = require('express');
// const cors = require('cors');
// const cookieParser = require('cookie-parser');
// const path = require('path');

// const { authMiddleware } = require('./middleware/auth');

// const app = express();

// app.use('/uploads', express.static('uploads'));

// // ==============================
// // ✅ CORS (explicit & safe)
// // ==============================
// const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
// app.use(cors({
//   origin: FRONTEND_URL,
//   credentials: true,
//   allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
// }));
// // respond to preflight early
// app.options('*', cors());

// // ==============================
// // ✅ GLOBAL MIDDLEWARES
// // ==============================
// app.use(express.json({ limit: '10mb' }));
// app.use(express.urlencoded({ extended: true }));
// app.use(cookieParser());

// // ==============================
// // ✅ STATIC FILES (UPLOADED FILES)
// // ==============================
// const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
// app.use('/uploads', express.static(UPLOAD_DIR));

// // ==============================
// // ✅ HEALTH CHECK ROUTE
// // ==============================
// app.get('/health', (req, res) => {
//   res.status(200).json({
//     status: 'OK',
//     message: 'Study Assistant AI Backend is running smoothly ✅',
//     timestamp: new Date().toISOString()
//   });
// });

// // ==============================
// // ✅ API ROUTES
// // - Public routes first
// // ==============================
// app.use('/api/auth', require('./routes/auth'));
// app.use('/api/docs', require('./routes/docs'));       // keep public if docs upload needs public access

// // ==============================
// // ✅ Protected / Auth-required routes
// // - Use authMiddleware on routes that must be protected
// // - Note: routes can also apply middleware internally; this is a safe default
// // ==============================
// app.use('/api/ai', authMiddleware, require('./routes/ai'));
// app.use('/api/admin', authMiddleware, require('./routes/admin'));
// app.use('/api/payments', authMiddleware, require('./routes/payments'));
// app.use('/api/worker', authMiddleware, require('./routes/worker'));

// // ==============================
// // ✅ 404 HANDLER
// // ==============================
// app.use((req, res, next) => {
//   res.status(404).json({
//     success: false,
//     message: 'API route not found ❌'
//   });
// });

// // ==============================
// // ✅ GLOBAL ERROR HANDLER
// // ==============================
// app.use((err, req, res, next) => {
//   console.error('🔥 GLOBAL ERROR:', err && err.stack ? err.stack : err);

//   res.status(err.status || 500).json({
//     success: false,
//     message: err.message || 'Internal Server Error',
//     // only show stack in development
//     stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
//   });
// });

// module.exports = app;


// backend/app.js

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { authMiddleware } = require('./middleware/auth');

const app = express();

// ==============================
// ✅ CORS (explicit & safe)
// ==============================
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.options('*', cors());

// ==============================
// ✅ GLOBAL MIDDLEWARES
// ==============================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ==============================
// ✅ ROOT ROUTE (IMPORTANT FIX)
// ==============================
app.get('/', (req, res) => {
  res.send('AI Library Worker API running 🚀');
});

// ==============================
// ✅ HEALTH CHECK
// ==============================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Study Assistant AI Backend is running smoothly ✅',
    timestamp: new Date().toISOString()
  });
});

// ==============================
// ✅ API ROUTES
// ==============================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/docs', require('./routes/docs'));

// ==============================
// ✅ PROTECTED ROUTES
// ==============================
app.use('/api/ai', authMiddleware, require('./routes/ai'));
app.use('/api/admin', authMiddleware, require('./routes/admin'));
app.use('/api/payments', authMiddleware, require('./routes/payments'));
app.use('/api/worker', authMiddleware, require('./routes/worker'));

// ==============================
// ❌ REMOVE LOCAL UPLOADS (Cloudinary use ho raha hai)
// ==============================
// app.use('/uploads', express.static('uploads'));
// app.use('/uploads', express.static(UPLOAD_DIR));

// ==============================
// ✅ 404 HANDLER
// ==============================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found ❌'
  });
});

// ==============================
// ✅ GLOBAL ERROR HANDLER
// ==============================
app.use((err, req, res, next) => {
  console.error('🔥 GLOBAL ERROR:', err?.stack || err);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

module.exports = app;