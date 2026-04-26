const express = require('express');
const multer = require('multer');
const fs = require('fs');

const supabase = require('../utils/supabase');

const { authMiddleware } = require('../middleware/auth');
const Document = require('../models/Document');
const Chunk = require('../models/Chunk');
const Embedding = require('../models/Embedding');
const { addDocumentProcessingJob } = require('../queue/processor');

const router = express.Router();

/**
 * ==============================
 * CONFIG
 * ==============================
 */
const MAX_UPLOAD_SIZE = parseInt(
  process.env.MAX_UPLOAD_SIZE || String(50 * 1024 * 1024),
  10
);

const MAX_ACTIVE_PROCESSING = parseInt(
  process.env.MAX_ACTIVE_PROCESSING || '1',
  10
);

/**
 * ==============================
 * MULTER
 * ==============================
 */
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: MAX_UPLOAD_SIZE
  },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/png',
      'image/jpeg'
    ];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

/**
 * ==============================
 * HELPERS
 * ==============================
 */
async function removeTemp(path) {
  if (!path) return;

  fs.unlink(path, () => {});
}

async function hasActiveProcessing(userId) {
  const count = await Document.countDocuments({
    userId,
    status: { $in: ['processing', 'queued'] }
  });

  return count >= MAX_ACTIVE_PROCESSING;
}

/**
 * ==============================
 * POST /upload
 * ==============================
 */
router.post(
  '/upload',
  authMiddleware,
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded.'
        });
      }

      /**
       * Prevent spam uploads
       */
      const busy = await hasActiveProcessing(req.user._id);

      if (busy) {
        await removeTemp(req.file.path);

        return res.status(429).json({
          success: false,
          message:
            'One file is already processing. Please wait.'
        });
      }

      console.log('📩 Upload route hit');
      console.log('FILE:', req.file.originalname);

      /**
       * ======================
       * SUPABASE UPLOAD
       * ======================
       */
      const fileBuffer = fs.readFileSync(req.file.path);

      const safeName =
        `${Date.now()}-${req.file.originalname}`
          .replace(/\s+/g, '-')
          .replace(/[^\w.-]/g, '');

      const { error } = await supabase.storage
        .from('documents')
        .upload(safeName, fileBuffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

      await removeTemp(req.file.path);

      if (error) {
        throw error;
      }

      const { data: publicData } = supabase.storage
        .from('documents')
        .getPublicUrl(safeName);

      const fileUrl = publicData.publicUrl;

      /**
       * ======================
       * SAVE DOC
       * ======================
       */
      const newDoc = await Document.create({
        userId: req.user._id,
        filename: req.file.originalname,
        fileUrl,
        mimeType: req.file.mimetype,
        size: req.file.size,
        status: 'queued',
        errorMessage: null
      });

      /**
       * ======================
       * QUEUE JOB
       * ======================
       */
      try {
        await addDocumentProcessingJob(
          newDoc._id.toString(),
          fileUrl
        );
      } catch (queueErr) {
        console.error('Queue error:', queueErr);

        await Document.findByIdAndUpdate(newDoc._id, {
          status: 'error',
          errorMessage: 'Queue failed'
        });

        return res.status(500).json({
          success: false,
          message:
            'Upload successful but processing queue failed.'
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Uploaded successfully.',
        document: newDoc
      });

    } catch (err) {
      console.error('Upload error:', err);

      await removeTemp(req.file?.path);

      return res.status(500).json({
        success: false,
        message: err.message || 'Upload failed'
      });
    }
  }
);

/**
 * ==============================
 * GET ALL DOCS
 * ==============================
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const docs = await Document.find({
      userId: req.user._id
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      documents: docs
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false
    });
  }
});

/**
 * ==============================
 * GET SINGLE DOC
 * ==============================
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const doc = await Document.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Not found'
      });
    }

    return res.json({
      success: true,
      document: doc
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false
    });
  }
});

/**
 * ==============================
 * DELETE DOC
 * ==============================
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const doc = await Document.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Not found'
      });
    }

    await Chunk.deleteMany({
      documentId: req.params.id
    });

    await Embedding.deleteMany({
      documentId: req.params.id
    });

    return res.json({
      success: true,
      message: 'Deleted'
    });

  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false
    });
  }
});

module.exports = router;