// File: backend/models/Chunk.js
// Mongoose model for text chunks created from OCR-extracted document content
// Improved: adds lightweight validation and text index for search

const mongoose = require('mongoose');

const chunkSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true
    },
    chunkIndex: {
      type: Number,
      required: true,
      min: 0
    },
    text: {
      type: String,
      required: true,
      trim: true
    },
    pageNo: {
      type: Number,
      default: 1,
      min: 1
    }
  },
  {
    timestamps: true
  }
);

// Unique compound index to prevent duplicate chunk numbers for same document
chunkSchema.index({ documentId: 1, chunkIndex: 1 }, { unique: true });

// Optional: text index to support full-text search on chunk text
// Uncomment if you plan to use MongoDB text search or $text queries
// chunkSchema.index({ text: 'text' }, { default_language: 'english' });

module.exports = mongoose.model('Chunk', chunkSchema);
