// File: backend/models/Document.js
// Enhanced Mongoose model for uploaded study documents

const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    filename: {
      type: String,
      required: true,
      trim: true
    },

    filePath: {
      type: String,
      required: true,
      trim: true
    },

    mimeType: {
      type: String,
      required: true,
      trim: true
    },

    size: {
      type: Number, // bytes
      default: 0,
      min: 0
    },

    status: {
      type: String,
      enum: ['uploaded', 'processing', 'ready', 'error'],
      default: 'uploaded',
      index: true
    },

    pages: {
      type: Number,
      default: 0,
      min: 0
    },

    language: {
      type: String,
      default: 'unknown',
      trim: true
    },

    errorMessage: {
      type: String,
      default: null,
      maxlength: 2000 // prevent storing oversized logs
    },

    // Optional: soft delete support
    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Helpful indexes
documentSchema.index({ userId: 1, createdAt: -1 });

// Virtual: Automatically get file extension
documentSchema.virtual('extension').get(function () {
  if (!this.filename) return '';
  const parts = this.filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
});

// Ensure virtuals appear in JSON output
documentSchema.set('toJSON', { virtuals: true });
documentSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Document', documentSchema);
