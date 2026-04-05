const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    // Razorpay order id — MUST be unique to prevent duplicates
    orderId: {
      type: String,
      required: true,
      index: true,
      unique: true
    },

    // Razorpay payment id — comes after payment success
    paymentId: {
      type: String,
      default: null,
      index: true
    },

    // Razorpay signature for payment verification
    signature: {
      type: String,
      default: null
    },

    amount: {
      type: Number, // in paise
      required: true,
      min: 1
    },

    currency: {
      type: String,
      default: 'INR',
      uppercase: true
    },

    status: {
      type: String,
      enum: ['created', 'paid', 'failed', 'refunded'],
      default: 'created',
      index: true
    },

    plan: {
      type: String,
      enum: ['free', 'premium', 'pro'],
      default: 'premium'
    },

    // Razorpay payment method (card/upi/netbanking/wallet)
    method: {
      type: String,
      default: null
    },

    email: {
      type: String,
      default: null
    },

    contact: {
      type: String,
      default: null
    },

    // Store webhook/raw events
    rawPayload: {
      type: Object,
      default: {},
      // Prevent giant payloads from filling DB
      validate: {
        validator: function (v) {
          try {
            return JSON.stringify(v).length < 50000; // 50KB limit
          } catch {
            return false;
          }
        },
        message: "rawPayload too large"
      }
    },

    // Optional expiry (Razorpay orders expire by default after some time)
    expiresAt: {
      type: Date,
      default: null,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Useful indexes
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1 });

// Virtual: success boolean
paymentSchema.virtual('isPaid').get(function () {
  return this.status === 'paid';
});

paymentSchema.set('toJSON', { virtuals: true });
paymentSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Payment', paymentSchema);
