const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const authMiddleware = require('../middleware/auth');

const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const { sendMail } = require('../utils/email');

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]); });
}

// POST /api/checkout - purchase cart items atomically
router.post('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { items, resumen, shipping } = req.body; // items: [{ id, cantidad }]

  // Debug logging: incoming checkout payload and authenticated user
  try {
    console.log('Incoming checkout request:', {
      userId: userId || null,
      hasAuthHeader: !!req.headers.authorization,
      itemsCount: Array.isArray(items) ? items.length : 0,
      resumenPresent: !!resumen,
      shippingPresent: !!shipping
    });
  } catch (e) {
    console.warn('Could not log checkout debug info', e);
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  // Try the transaction with retries on transient errors (write conflicts, transient transaction errors)
  const MAX_TX_RETRIES = 3;
  let attempt = 0;
  let finalErr = null;
  let committedOrder = null;
  let committedUser = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  while (attempt < MAX_TX_RETRIES) {
    attempt += 1;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Validate and decrement stock for each item
        for (const it of items) {
          const prodId = it.id;
          const qty = parseInt(it.cantidad || it.cant || it.quantity || it.cantidad, 10) || 0;
          if (qty <= 0) throw new Error('Invalid quantity');
          // Try to find product by ObjectId, and fallback to name/code if necessary
          let product = null;
          try {
            if (mongoose.Types.ObjectId.isValid(prodId)) {
              product = await Product.findById(prodId).session(session);
            }
          } catch (e) {
            // ignore cast errors and fallback
          }

          if (!product) {
            product = await Product.findOne({ $or: [{ nombre: prodId }, { codigo: prodId }] }).session(session);
          }

          if (!product) throw new Error(`Product not found: ${prodId}`);
          if ((product.stock || 0) < qty) throw new Error(`Insufficient stock for ${product.nombre}`);

          // Decrement stock
          product.stock = product.stock - qty;
          await product.save({ session });
        }

        // Create order
        const order = new Order({
          userId,
          items,
          resumen: resumen || {},
          estado: 'confirmado',
          fecha: new Date()
        });

        await order.save({ session });

        // Attach order to user and clear user's cart
        const user = await User.findById(userId).session(session);
        if (user) {
          user.orders = user.orders || [];
          user.orders.push({ orderId: order._id, codigo: order.id, fecha: order.fecha, resumen: order.resumen });
          user.cart = [];
          await user.save({ session });
        }

        // store references to use after commit
        committedOrder = order;
        committedUser = user;
      });

      // If we reach here, transaction committed successfully
      session.endSession();

      try {
        console.log('Order saved to DB', { orderId: committedOrder._id.toString(), userId });
      } catch (e) {
        console.warn('Could not log saved order info', e);
      }

      // Send invoice email to user (best-effort, do not block response)
      (async () => {
        try {
          if (committedUser && committedUser.email) {
            const base = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT||4000}`;
            const invoiceLink = `${base}/confirmacion.html?orderId=${committedOrder._id}`;
            const html = `<p>Hola ${escapeHtml(committedUser.nombre || committedUser.email)},</p>
              <p>Gracias por tu compra. Puedes ver tu factura en el siguiente enlace:</p>
              <p><a href="${invoiceLink}">Ver factura</a></p>`;
            const result = await sendMail({ to: committedUser.email, subject: 'Tu compra en Tatylu - Factura', html });
            if (!result.ok) console.error('Invoice email failed', result.error);
          }
        } catch (e) {
          console.error('Error sending invoice email:', e);
        }
      })();

      return res.json({ success: true, orderId: committedOrder._id, orderCode: committedOrder.id });
    } catch (err) {
      // Abort this session and check if we should retry
      try { await session.abortTransaction(); } catch (e) { /* ignore */ }
      session.endSession();
      finalErr = err;
      console.error(`Checkout attempt ${attempt} failed:`, err && (err.message || err));
      // Determine if the error is transient and eligible for retry
      const isTransient = (err && typeof err.hasErrorLabel === 'function' && (err.hasErrorLabel('UnknownTransactionCommitResult') || err.hasErrorLabel('TransientTransactionError')))
        || (err && err.message && err.message.includes('Write conflict'));
      if (isTransient && attempt < MAX_TX_RETRIES) {
        // backoff a bit and retry
        const backoffMs = 100 * attempt;
        console.warn(`Transient transaction error detected, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${MAX_TX_RETRIES})`);
        await sleep(backoffMs);
        continue;
      }
      break;
    }
  }

  // If we arrive here, all attempts failed
  console.error('Checkout failed after retries:', finalErr && (finalErr.message || finalErr));
  if (finalErr && finalErr.stack) console.error('Checkout final error stack:', finalErr.stack);
  try {
    console.error('Checkout request metadata:', {
      hasAuthHeader: !!req.headers.authorization,
      itemsCount: Array.isArray(items) ? items.length : 0,
      resumenPresent: !!resumen
    });
  } catch (e) {
    console.warn('Could not log checkout request metadata', e);
  }
  res.status(400).json({ error: (finalErr && finalErr.message) || 'Checkout failed' });
});

module.exports = router;
