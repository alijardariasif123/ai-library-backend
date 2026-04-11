// const express = require('express');
// const router = express.Router();

// // ==============================
// // ENV CONFIG
// // ==============================
// const WORKER_URL = process.env.WORKER_URL || 'NOT_SET';
// const REDIS_URL = process.env.REDIS_URL || 'NOT_SET';

// // ==============================
// // GET /api/worker/health
// // ==============================
// router.get('/health', (req, res) => {
//     return res.status(200).json({
//         success: true,
//         message: 'Worker route active ✅',
//         workerUrl: WORKER_URL,
//         redis: REDIS_URL !== 'NOT_SET' ? 'configured' : 'NOT SET ❌',
//         mode: 'BullMQ worker pipeline',
//         note: 'Processing happens in worker service (not via callback)'
//     });
// });

// // ==============================
// // 🔥 DEBUG: QUEUE STATUS
// // ==============================
// router.get('/debug', async (req, res) => {
//     try {
//         const { Queue } = require('bullmq');

//         const queue = new Queue('document-processing', {
//             connection: {
//                 url: process.env.REDIS_URL
//             }
//         });

//         const counts = await queue.getJobCounts();

//         return res.status(200).json({
//             success: true,
//             queue: 'document-processing',
//             counts
//         });

//     } catch (err) {
//         console.error('Queue debug error:', err);

//         return res.status(500).json({
//             success: false,
//             message: 'Failed to fetch queue status',
//             error: err.message
//         });
//     }
// });

// // ==============================
// // ❌ CALLBACK DISABLED
// // ==============================
// router.post('/callback', (req, res) => {
//     return res.status(410).json({
//         success: false,
//         message: 'Callback disabled ❌',
//         solution: 'Use BullMQ worker (queue processor)'
//     });
// });

// // ==============================
// // ROOT ROUTE (optional)
// // ==============================
// router.get('/', (req, res) => {
//     return res.json({
//         success: true,
//         message: 'Worker API is running 🚀',
//         routes: [
//             '/health',
//             '/debug'
//         ]
//     });
// });

// module.exports = router;
const express = require('express');
const router = express.Router();

const { Queue } = require('bullmq');
const IORedis = require('ioredis');

// ==============================
// ENV CONFIG
// ==============================
const WORKER_URL = process.env.WORKER_URL || 'NOT_SET';
const REDIS_URL = process.env.REDIS_URL || 'NOT_SET';

// ==============================
// 🔥 REDIS CONNECTION (STABLE)
// ==============================
const connection = new IORedis(process.env.REDIS_URL, {
  tls: {},
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

// ==============================
// QUEUE INSTANCE (REUSED)
// ==============================
const queue = new Queue('document-processing', { connection });

// ==============================
// GET /api/worker/health
// ==============================
router.get('/health', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Worker route active ✅',
    workerUrl: WORKER_URL,
    redis: REDIS_URL !== 'NOT_SET' ? 'configured' : 'NOT SET ❌',
    mode: 'BullMQ worker pipeline',
    note: 'Processing happens in worker service (not via callback)'
  });
});

// ==============================
// 🔥 DEBUG: QUEUE STATUS
// ==============================
router.get('/debug', async (req, res) => {
  try {
    const counts = await queue.getJobCounts();

    return res.status(200).json({
      success: true,
      queue: 'document-processing',
      counts
    });

  } catch (err) {
    console.error('Queue debug error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch queue status',
      error: err.message
    });
  }
});

// ==============================
// ❌ CALLBACK DISABLED
// ==============================
router.post('/callback', (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Callback disabled ❌',
    solution: 'Use BullMQ worker (queue processor)'
  });
});

// ==============================
// ROOT ROUTE
// ==============================
router.get('/', (req, res) => {
  return res.json({
    success: true,
    message: 'Worker API is running 🚀',
    routes: [
      '/health',
      '/debug'
    ]
  });
});

module.exports = router;