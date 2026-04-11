// File: backend/routes/admin.js
// Admin-only routes: users list, documents list, reprocess document

const express = require('express');
const router = express.Router();

const { authMiddleware, isAdmin } = require('../middleware/auth');
const User = require('../models/User');
const Document = require('../models/Document');
const Chunk = require('../models/Chunk');
const Embedding = require('../models/Embedding');
const { addDocumentProcessingJob } = require('../queue/processor');

// All routes in this file are protected by auth + isAdmin
router.use(authMiddleware, isAdmin);

// ==============================
// GET /api/admin/overview
// Simple stats for admin dashboard tiles
// ==============================
router.get('/overview', async (req, res) => {
  try {
    const [userCount, docCount, readyDocs, processingDocs, errorDocs] = await Promise.all([
      User.countDocuments(),
      Document.countDocuments(),
      Document.countDocuments({ status: 'ready' }),
      Document.countDocuments({ status: 'processing' }),
      Document.countDocuments({ status: 'error' })
    ]);

    return res.status(200).json({
      success: true,
      overview: {
        totalUsers: userCount,
        totalDocuments: docCount,
        readyDocuments: readyDocs,
        processingDocuments: processingDocs,
        errorDocuments: errorDocs
      }
    });
  } catch (error) {
    console.error('Admin overview error:', error && error.stack ? error.stack : error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch admin overview.'
    });
  }
});

// ==============================
// GET /api/admin/users
// Paginated list of users
// ==============================
router.get('/users', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find({})
        .select('-passwordHash')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments()
    ]);

    return res.status(200).json({
      success: true,
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Admin users error:', error && error.stack ? error.stack : error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch users.'
    });
  }
});

// ==============================
// GET /api/admin/documents
// Paginated list of all documents (for admin monitoring)
// ==============================
router.get('/documents', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 200); // admin can request up to 200
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      Document.find({})
        .populate('userId', 'name email plan')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Document.countDocuments()
    ]);

    return res.status(200).json({
      success: true,
      documents: docs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Admin documents error:', error && error.stack ? error.stack : error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch documents.'
    });
  }
});
// ==============================
// POST /api/admin/reprocess/:documentId?force=true&clear=true
// Admin can trigger reprocessing of a document, with options to force and clear existing data
// ==============================
router.post('/reprocess/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const force = String(req.query.force || 'false').toLowerCase() === 'true';
    const clear = String(req.query.clear || 'false').toLowerCase() === 'true';

    const doc = await Document.findById(documentId);
    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Document not found.'
      });
    }

    if (doc.status === 'processing' && !force) {
      return res.status(400).json({
        success: false,
        message: 'Document is already processing. Use ?force=true to override.'
      });
    }

    // Optional cleanup of existing chunks & embeddings
    if (clear) {
      try {
        await Promise.all([
          Chunk.deleteMany({ documentId }),
          Embedding.deleteMany({ documentId })
        ]);
        console.log(`Admin cleared chunks & embeddings for document ${documentId}`);
      } catch (cleanupErr) {
        console.warn('Failed to clear existing chunks/embeddings:', cleanupErr);
        // don't block reprocessing; just warn
      }
    }

    // Set status to processing and clear previous error
    await Document.findByIdAndUpdate(documentId, { status: 'processing', errorMessage: null }).exec();

    // enqueue job
    let job;
    try {
      job = await addDocumentProcessingJob(
        documentId.toString(),
        doc.fileUrl // 🔥 FIXED (was filePath ❌)
      );
    } catch (queueErr) {
      console.error('Failed to enqueue reprocess job:', queueErr && queueErr.stack ? queueErr.stack : queueErr);

      await Document.findByIdAndUpdate(documentId, {
        status: 'error',
        errorMessage: 'Failed to enqueue reprocess job'
      }).exec();

      return res.status(500).json({
        success: false,
        message: 'Failed to start reprocessing (queue error).'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Document reprocessing started.',
      jobId: job && job.id ? job.id : null
    });
  } catch (error) {
    console.error('Admin reprocess error:', error && error.stack ? error.stack : error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reprocess document.'
    });
  }
});

module.exports = router;
