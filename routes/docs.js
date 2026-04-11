// const express = require('express');
// const multer = require('multer');
// const cloudinary = require('cloudinary').v2;
// const fs = require('fs');

// const { authMiddleware } = require('../middleware/auth');
// const Document = require('../models/Document');
// const { addDocumentProcessingJob } = require('../queue/processor');

// const router = express.Router();

// // ==============================
// // CLOUDINARY CONFIG
// // ==============================
// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET
// });

// // ==============================
// // MULTER (LOCAL TEMP STORAGE)
// // ==============================
// const upload = multer({
//   dest: 'uploads/', // 🔥 temp storage
//   limits: {
//     fileSize: parseInt(process.env.MAX_UPLOAD_SIZE || String(50 * 1024 * 1024), 10)
//   },
//   fileFilter: (req, file, cb) => {
//     const allowed = ['application/pdf', 'image/png', 'image/jpeg'];
//     if (allowed.includes(file.mimetype)) {
//       cb(null, true);
//     } else {
//       cb(new Error('Invalid file type'));
//     }
//   }
// });

// // ==============================
// // POST /upload
// // ==============================
// router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: 'No file uploaded.'
//       });
//     }
//     console.log("hi");
//     console.log("📩 Upload route hit");
//     console.log("FILE DATA:", req.file);

//     // 🔥 Upload to Cloudinary manually (FINAL FIX)
//     const result = await cloudinary.uploader.upload(req.file.path, {
//       folder: "documents",
//       resource_type: "image",
//       type: "upload",
//       // 🔥 THIS IS THE REAL FIX
//       access_mode: "public",
//       // 🔥 ADD THIS (CRITICAL FIX)
//       format: req.file.mimetype === 'application/pdf' ? 'pdf' : undefined
//     });

//     const fileUrl = cloudinary.url(result.public_id, {
//       resource_type: "image",
//       type: "upload",
//       sign_url: true,
//       secure: true
//     });

//     console.log("✅ SIGNED URL:", fileUrl);

//     console.log("✅ FINAL FILE URL:", fileUrl);

//     // 🧹 delete local temp file
//     fs.unlink(req.file.path, (err) => {
//       if (err) console.error("Temp file delete error:", err);
//     });

//     // Save document
//     const newDoc = await Document.create({
//       userId: req.user._id,
//       filename: req.file.originalname,
//       fileUrl: fileUrl,
//       mimeType: req.file.mimetype,
//       size: req.file.size,
//       status: 'processing'
//     });

//     // Queue job
//     try {
//       await addDocumentProcessingJob(newDoc._id.toString(), fileUrl);
//     } catch (queueErr) {
//       console.error('Queue error:', queueErr);

//       await Document.findByIdAndUpdate(newDoc._id, {
//         status: 'error',
//         errorMessage: 'Queue failed'
//       });

//       return res.status(500).json({
//         success: false,
//         message: 'Upload done but processing failed.'
//       });
//     }

//     res.status(201).json({
//       success: true,
//       message: 'Uploaded & processing started',
//       document: newDoc
//     });

//   } catch (err) {
//     console.error('Upload error:', err);

//     res.status(500).json({
//       success: false,
//       message: 'Upload failed'
//     });
//   }
// });

// // ==============================
// // GET all docs
// // ==============================
// router.get('/', authMiddleware, async (req, res) => {
//   try {
//     const docs = await Document.find({ userId: req.user._id })
//       .sort({ createdAt: -1 })
//       .lean();

//     res.json({
//       success: true,
//       documents: docs
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false });
//   }
// });

// // ==============================
// // GET single doc
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
//         message: 'Not found'
//       });
//     }

//     res.json({
//       success: true,
//       document: doc
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false });
//   }
// });

// // ==============================
// // DELETE doc
// // ==============================
// router.delete('/:id', authMiddleware, async (req, res) => {
//   try {
//     const doc = await Document.findOneAndDelete({
//       _id: req.params.id,
//       userId: req.user._id
//     });

//     if (!doc) {
//       return res.status(404).json({
//         success: false,
//         message: 'Not found'
//       });
//     }

//     res.json({
//       success: true,
//       message: 'Deleted'
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ success: false });
//   }
// });

// module.exports = router;

const express = require('express');
const multer = require('multer');
const fs = require('fs');

const supabase = require('../utils/supabase'); // ✅ NEW

const { authMiddleware } = require('../middleware/auth');
const Document = require('../models/Document');
const { addDocumentProcessingJob } = require('../queue/processor');

const router = express.Router();

// ==============================
// MULTER (LOCAL TEMP STORAGE)
// ==============================
const upload = multer({
  dest: 'uploads/',
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

    // ======================
    // 🔥 SUPABASE UPLOAD
    // ======================
    const fileBuffer = fs.readFileSync(req.file.path);
    const fileName = `${Date.now()}-${req.file.originalname}`;

    const { error } = await supabase.storage
      .from('documents')
      .upload(fileName, fileBuffer, {
        contentType: req.file.mimetype
      });

    if (error) {
      throw error;
    }

    // ✅ PUBLIC URL
    const { data: publicData } = supabase.storage
      .from('documents')
      .getPublicUrl(fileName);

    const fileUrl = publicData.publicUrl;

    console.log("✅ SUPABASE URL:", fileUrl);

    // 🧹 delete temp file
    fs.unlink(req.file.path, () => {});

    // ======================
    // SAVE DOCUMENT
    // ======================
    const newDoc = await Document.create({
      userId: req.user._id,
      filename: req.file.originalname,
      fileUrl,
      mimeType: req.file.mimetype,
      size: req.file.size,
      status: 'processing'
    });

    // ======================
    // QUEUE JOB
    // ======================
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

    return res.status(201).json({
      success: true,
      message: 'Uploaded & processing started',
      document: newDoc
    });

  } catch (err) {
    console.error('Upload error:', err);

    return res.status(500).json({
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