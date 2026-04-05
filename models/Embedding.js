// File: backend/models/Embedding.js
// Mongoose model for vector embeddings stored in MongoDB
// Each record links one chunk of a document to its embedding vector.

const mongoose = require('mongoose');

const embeddingSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true
    },
    chunkId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Chunk',
      required: true,
      index: true
    },

    // Embedding as array of numbers (floats). Keep as Number because MongoDB stores JS numbers as double.
    embedding: {
      type: [Number],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'embedding must be a non-empty array of numbers'
      }
    },

    // Optional: store dimension to quickly validate / sanity check at read time
    dim: {
      type: Number,
      required: false,
      min: 1
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

// Index to speed up similarity search per document
embeddingSchema.index({ documentId: 1 });

// Prevent inserting duplicate embedding documents for same document+chunk
embeddingSchema.index({ documentId: 1, chunkId: 1 }, { unique: true });

// convenience virtual: embedding length (not persisted)
embeddingSchema.virtual('length').get(function () {
  return Array.isArray(this.embedding) ? this.embedding.length : 0;
});

embeddingSchema.set('toJSON', { virtuals: true });
embeddingSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Embedding', embeddingSchema);
