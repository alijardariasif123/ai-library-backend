// File: backend/routes/payments.js
// Razorpay payments: create order + handle webhook and upgrade user plan
// Improvements: use raw body for webhook signature verification, timing-safe signature compare,
// defensive checks and clearer logs.

const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');

const { authMiddleware } = require('../middleware/auth');
const Payment = require('../models/Payment');
const User = require('../models/User');

const router = express.Router();

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || RAZORPAY_KEY_SECRET; // prefer separate secret in prod

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.warn(
    '⚠️ Razorpay keys are not set. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your .env file to enable payments.'
  );
}

// Create Razorpay instance (safe even if keys absent; calls will fail)
const razorpayInstance = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET
});

// Utility: create a short unique receipt (<= 40 chars)
function makeShortReceipt(userId) {
  try {
    const uid = String(userId || '').replace(/[^a-zA-Z0-9]/g, '');
    const part1 = uid.slice(-6); // last 6 chars of id
    const part2 = Date.now().toString().slice(-7); // last 7 digits of timestamp
    let r = `r_${part1}_${part2}`;
    if (r.length > 40) r = r.slice(0, 40);
    return r;
  } catch (e) {
    return `r_${Date.now().toString().slice(-10)}`;
  }
}

// ==============================
// POST /api/payments/create-order
// ==============================
router.post('/create-order', authMiddleware, async (req, res) => {
  try {
    if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'Payments not configured on server. Missing Razorpay keys.'
      });
    }

    const { amount } = req.body || {};
    const finalAmount = Number.isFinite(amount) && amount > 0 ? amount : 19900;
    const receipt = makeShortReceipt(req.user._id);

    const options = {
      amount: finalAmount,
      currency: 'INR',
      receipt,
      payment_capture: 1
    };

    let order;
    try {
      order = await razorpayInstance.orders.create(options);
    } catch (razorErr) {
      console.error('Razorpay order creation failed:', razorErr && razorErr.error ? razorErr.error : razorErr);
      const errBody = razorErr?.error || razorErr;
      return res.status(400).json({
        success: false,
        message: 'Failed to create payment order.',
        error: errBody
      });
    }

    // Persist a local payment record (orderId unique index should prevent duplicates)
    const payment = await Payment.create({
      userId: req.user._id,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      status: 'created',
      plan: 'premium',
      receipt
    });

    console.log('Razorpay order created', { orderId: order.id, receipt });

    return res.status(201).json({
      success: true,
      message: 'Order created successfully.',
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt
      },
      paymentId: payment._id,
      razorpayKeyId: RAZORPAY_KEY_ID
    });
  } catch (error) {
    console.error('Create order error:', error && error.stack ? error.stack : error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create payment order.'
    });
  }
});

// ==============================
// POST /api/payments/webhook
// Razorpay webhook: use raw body to verify signature
// IMPORTANT: configure your server to use this route with express.raw middleware (below).
// ==============================
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }), // use raw body buffer for signature verification
  async (req, res) => {
    try {
      const secret = RAZORPAY_WEBHOOK_SECRET;
      if (!secret) {
        console.error('Razorpay webhook secret is not configured.');
        return res.status(500).send('Webhook secret not configured');
      }

      const signature = req.headers['x-razorpay-signature'];
      const rawBody = req.body; // Buffer when using express.raw
      if (!signature || !rawBody) {
        console.warn('Webhook missing signature or body');
        return res.status(400).send('Bad Request');
      }

      // compute expected signature
      const expectedSignature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

      // timing-safe compare
      const sigBuf = Buffer.from(signature, 'utf8');
      const expBuf = Buffer.from(expectedSignature, 'utf8');
      let signatureValid = false;
      if (sigBuf.length === expBuf.length) {
        signatureValid = crypto.timingSafeEqual(sigBuf, expBuf);
      }

      if (!signatureValid) {
        console.error('⚠️ Invalid Razorpay webhook signature.');
        return res.status(400).send('Invalid signature');
      }

      // parse JSON payload AFTER verifying signature
      let payload;
      try {
        payload = JSON.parse(rawBody.toString('utf8'));
      } catch (e) {
        console.error('Failed to parse webhook JSON body:', e);
        return res.status(400).send('Invalid JSON');
      }

      const event = payload.event;
      console.log('Razorpay webhook event:', event);

      // We're primarily interested in payment captured or order paid events
      if (event === 'payment.captured' || event === 'order.paid' || event === 'payment.authorized' || event === 'payment.failed') {
        const p = payload.payload || {};

        // payload may contain different structures — try payment.entity first
        const paymentEntity = p.payment?.entity || p.order?.entity || null;

        const orderId = paymentEntity?.order_id || paymentEntity?.id;
        const paymentId = paymentEntity?.id;
        const status = paymentEntity?.status;

        if (!orderId || !paymentId) {
          console.warn('Webhook missing orderId/paymentId', { event, sample: paymentEntity ? { id: paymentEntity.id, order_id: paymentEntity.order_id, status: paymentEntity.status } : null });
        } else {
          const paymentDoc = await Payment.findOne({ orderId }).exec();

          if (paymentDoc) {
            paymentDoc.paymentId = paymentId;
            paymentDoc.signature = signature;
            paymentDoc.status = status === 'captured' || status === 'paid' ? 'paid' : (status === 'failed' ? 'failed' : paymentDoc.status);
            // store only a trimmed raw payload to avoid giant documents
            try {
              paymentDoc.rawPayload = payload;
            } catch (_) {
              // ignore if payload too large to stringify in schema (we added a validator earlier)
              paymentDoc.rawPayload = {};
            }
            await paymentDoc.save();

            if (paymentDoc.status === 'paid' && paymentDoc.userId) {
              try {
                await User.findByIdAndUpdate(paymentDoc.userId, { plan: 'premium' }).exec();
                console.log('Upgraded user plan for userId:', paymentDoc.userId.toString());
              } catch (uErr) {
                console.error('Failed to upgrade user plan after payment:', uErr);
              }
            }
          } else {
            console.warn('Payment record not found for orderId:', orderId);
          }
        }
      } else {
        console.log('Unhandled Razorpay event (ignored):', event);
      }

      // respond 200 quickly
      return res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error('Razorpay webhook error:', error && error.stack ? error.stack : error);
      return res.status(500).send('Webhook error');
    }
  }
);

module.exports = router;
