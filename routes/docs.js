// // File: backend/routes/docs.js
// // Routes for document upload, listing, status, and deletion
// // Improved: safer multer handling, MIME basic validation, robust queueing, async file ops.

// const express = require('express');
// const multer = require('multer');
// const path = require('path');
// const fs = require('fs').promises;
// const fsSync = require('fs');

// const { authMiddleware } = require('../middleware/auth');
// const Document = require('../models/Document');
// const { addDocumentProcessingJob } = require('../queue/processor');

// const router = express.Router();

// // Config via env (sensible defaults)
// const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
// const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE || String(50 * 1024 * 1024), 10); // default 50MB
// const ALLOWED_MIMETYPES = (process.env.ALLOWED_MIMETYPES || 'application/pdf,image/png,image/jpeg').split(',');

// // ensure upload dir exists (sync during startup)
// if (!fsSync.existsSync(UPLOAD_DIR)) {
//   fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });
// }

// // Multer storage
// const storage = multer.diskStorage({
//   destination: function (req, file, cb) {
//     cb(null, UPLOAD_DIR);
//   },
//   filename: function (req, file, cb) {
//     // Keep original extension but generate safe unique name
//     const ext = path.extname(file.originalname).toLowerCase();
//     const safeBase = Date.now() + '-' + Math.round(Math.random() * 1e9);
//     cb(null, safeBase + ext);
//   }
// });

// const upload = multer({
//   storage,
//   limits: {
//     fileSize: MAX_UPLOAD_SIZE
//   },
//   fileFilter: function (req, file, cb) {
//     // basic MIME check (not bulletproof, but reduces bad uploads)
//     if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
//       return cb(null, true);
//     }
//     const err = new Error('Invalid file type');
//     err.code = 'INVALID_MIME';
//     return cb(err);
//   }
// });

// // Middleware wrapper to handle multer errors gracefully
// function multerHandler(fieldName) {
//   return (req, res, next) => {
//     const handler = upload.single(fieldName);
//     handler(req, res, (err) => {
//       if (err) {
//         console.error('Multer upload error:', err);
//         if (err.code === 'LIMIT_FILE_SIZE') {
//           return res.status(413).json({ success: false, message: 'File too large.' });
//         }
//         if (err.code === 'INVALID_MIME') {
//           return res.status(400).json({ success: false, message: 'Invalid file type.' });
//         }
//         return res.status(400).json({ success: false, message: 'File upload failed.' });
//       }
//       next();
//     });
//   };
// }

// // Utility: return a safe doc object for responses
// function safeDocumentPayload(doc) {
//   if (!doc) return null;
//   const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
//   // remove any fields you don't want to send back (none sensitive here)
//   return plain;
// }

// // ==============================
// // POST /api/docs/upload
// // Upload a new document and push to OCR queue
// // ==============================
// router.post('/upload', authMiddleware, multerHandler('file'), async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: 'No file uploaded.'
//       });
//     }

//    // 🔥 Build public file URL (VERY IMPORTANT)
// const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

// // Persist document record
// const newDoc = await Document.create({
//   userId: req.user._id,
//   filename: req.file.originalname,
//   filePath: path.resolve(req.file.path), // local backup (optional)
//   fileUrl: fileUrl, // 🔥 NEW (important for worker)
//   mimeType: req.file.mimetype,
//   size: req.file.size,
//   status: 'processing'
// });

// // Push job to BullMQ OCR queue — handle queue errors gracefully
// try {
//   // 🔥 send fileUrl instead of filePath
//   await addDocumentProcessingJob(newDoc._id.toString(), fileUrl);

// } catch (queueErr) {
//   console.error('Failed to enqueue OCR job:', queueErr);

//   await Document.findByIdAndUpdate(newDoc._id, {
//     status: 'error',
//     errorMessage: 'Failed to enqueue OCR job'
//   }).exec();

//   return res.status(500).json({
//     success: false,
//     message: 'Uploaded but failed to start processing. Admin will be notified.'
//   });
// }
//     return res.status(201).json({
//       success: true,
//       message: 'Document uploaded successfully. Processing started.',
//       document: safeDocumentPayload(newDoc)
//     });
//   } catch (err) {
//     console.error('Upload error:', err);

//     // If multer wrote file but DB failed, try to cleanup file asynchronously
//     if (req.file && req.file.path) {
//       try {
//         await fs.unlink(path.resolve(req.file.path));
//       } catch (e) {
//         console.warn('Failed to cleanup uploaded file after DB error:', e);
//       }
//     }

//     return res.status(500).json({
//       success: false,
//       message: 'Failed to upload document.'
//     });
//   }
// });

// // ==============================
// // GET /api/docs
// // List all documents for logged-in user
// // ==============================
// router.get('/', authMiddleware, async (req, res) => {
//   try {
//     const docs = await Document.find({ userId: req.user._id })
//       .sort({ createdAt: -1 })
//       .lean()
//       .exec();

//     return res.status(200).json({
//       success: true,
//       documents: docs
//     });
//   } catch (err) {
//     console.error('List docs error:', err);
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to fetch documents.'
//     });
//   }
// });

// // ==============================
// // GET /api/docs/:id
// // Get single document details
// // ==============================
// router.get('/:id', authMiddleware, async (req, res) => {
//   try {
//     const doc = await Document.findOne({
//       _id: req.params.id,
//       userId: req.user._id
//     }).lean();

//     if (!doc) {
//       return res.status(404).json({
//         success: false,
//         message: 'Document not found.'
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       document: doc
//     });
//   } catch (err) {
//     console.error('Get doc error:', err);
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to fetch document.'
//     });
//   }
// });

// // ==============================
// // DELETE /api/docs/:id
// // Delete document + file
// // ==============================
// router.delete('/:id', authMiddleware, async (req, res) => {
//   try {
//     const doc = await Document.findOneAndDelete({
//       _id: req.params.id,
//       userId: req.user._id
//     }).exec();

//     if (!doc) {
//       return res.status(404).json({
//         success: false,
//         message: 'Document not found.'
//       });
//     }

//     // Delete file from disk asynchronously (don't block response)
//     if (doc.filePath) {
//       (async () => {
//         try {
//           const fp = path.resolve(doc.filePath);
//           if (fsSync.existsSync(fp)) {
//             await fs.unlink(fp);
//             console.log('Deleted file:', fp);
//           }
//         } catch (e) {
//           console.warn('Failed deleting file for document', doc._id, e);
//         }
//       })();
//     }

//     return res.status(200).json({
//       success: true,
//       message: 'Document deleted successfully.'
//     });
//   } catch (err) {
//     console.error('Delete doc error:', err);
//     return res.status(500).json({
//       success: false,
//       message: 'Failed to delete document.'
//     });
//   }
// });

// module.exports = router;


// File: backend/routes/docs.js

const express = require('express');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

const { authMiddleware } = require('../middleware/auth');
const Document = require('../models/Document');
const { addDocumentProcessingJob } = require('../queue/processor');

const router = express.Router();

// ==============================
// CLOUDINARY CONFIG
// ==============================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ==============================
// MULTER (CLOUD STORAGE)
// ==============================
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'documents',
    resource_type: 'raw', // 🔥 PDFs support
    public_id: (req, file) => Date.now() + '-' + file.originalname
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_UPLOAD_SIZE || String(50 * 1024 * 1024), 10)
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/png', 'image/jpeg'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// ==============================
// POST /upload
// ==============================
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded.'
      });
    }
    console.log("📩 Upload route hit");
    console.log("FILE DATA:", req.file);
    
    // ✅ Cloudinary URL
    const fileUrl = req.file.path;

    // Save document
    const newDoc = await Document.create({
      userId: req.user._id,
      filename: req.file.originalname,
      fileUrl: fileUrl,
      mimeType: req.file.mimetype,
      size: req.file.size,
      status: 'processing'
    });

    // Queue job
    try {
      await addDocumentProcessingJob(newDoc._id.toString(), fileUrl);
    } catch (queueErr) {
      console.error('Queue error:', queueErr);

      await Document.findByIdAndUpdate(newDoc._id, {
        status: 'error',
        errorMessage: 'Queue failed'
      });

      return res.status(500).json({
        success: false,
        message: 'Upload done but processing failed.'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Uploaded & processing started',
      document: newDoc
    });

  } catch (err) {
    console.error('Upload error:', err);

    res.status(500).json({
      success: false,
      message: 'Upload failed'
    });
  }
});

// ==============================
// GET all docs
// ==============================
router.get('/', authMiddleware, async (req, res) => {
  try {
    const docs = await Document.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      documents: docs
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// ==============================
// GET single doc
// ==============================
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

    res.json({
      success: true,
      document: doc
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// ==============================
// DELETE doc
// ==============================
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

    // optional: later cloudinary delete

    res.json({
      success: true,
      message: 'Deleted'
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

module.exports = router;