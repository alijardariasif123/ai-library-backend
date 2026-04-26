const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { authMiddleware } = require('./middleware/auth');

const app = express();

// ==============================
// 🔥 TRUST PROXY (IMPORTANT)
// ==============================
app.set('trust proxy', 1);

// ==============================
// ✅ CORS
// ==============================
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(cors({
  origin: [FRONTEND_URL],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

app.options('*', cors());

// ==============================
// ✅ GLOBAL MIDDLEWARES
// ==============================
app.use(express.json({ limit: '20mb' })); // 🔥 increased
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ==============================
// ✅ ROOT
// ==============================
app.get('/', (req, res) => {
  res.send('AI Library Backend running 🚀');
});

// ==============================
// ✅ HEALTH
// ==============================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Backend running ✅',
    timestamp: new Date().toISOString()
  });
});

// ==============================
// ✅ API ROUTES
// ==============================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/docs', require('./routes/docs'));

// ==============================
// 🔒 PROTECTED ROUTES
// ==============================
app.use('/api/ai', authMiddleware, require('./routes/ai'));
app.use('/api/admin', authMiddleware, require('./routes/admin'));

// ==============================
// 🔥 PUBLIC ROUTES (IMPORTANT)
// ==============================
app.use('/api/payments', require('./routes/payments')); // webhook safe
app.use('/api/worker', require('./routes/worker'));     // health/debug safe

// ==============================
// 404
// ==============================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found ❌'
  });
});

// ==============================
// GLOBAL ERROR
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