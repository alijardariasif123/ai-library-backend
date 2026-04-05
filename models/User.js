// File: backend/models/User.js
// User model: students + admin
// Backwards-compatible: accepts both 'student' and 'user' role values

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    passwordHash: {
      type: String,
      required: true,
      select: false // don't return by default in queries
    },

    // Accept both 'user' and 'student' so older code won't break.
    role: {
      type: String,
      enum: ['user', 'student', 'admin'],
      default: 'student'
    },

    plan: {
      type: String,
      enum: ['free', 'premium'],
      default: 'free'
    },

    usageStats: {
      totalQueries: {
        type: Number,
        default: 0,
        min: 0
      }
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: docToJSON },
    toObject: { virtuals: true }
  }
);

// Remove sensitive fields when converting to JSON
function docToJSON(doc, ret) {
  // ret is the plain object. remove sensitive fields.
  delete ret.passwordHash;
  delete ret.__v;
  return ret;
}

// Pre-save hook: ensure email is trimmed/lowercased
userSchema.pre('save', function (next) {
  if (this.email) {
    this.email = String(this.email).trim().toLowerCase();
  }
  next();
});

// Instance helper example (use bcrypt to compare real passwords)
// const bcrypt = require('bcrypt');
// userSchema.methods.verifyPassword = function (plain) {
//   return bcrypt.compare(plain, this.passwordHash);
// };

module.exports = mongoose.model('User', userSchema);
