const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const bcrypt = require('bcryptjs');
const authMiddleware = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const { sendMail } = require('../utils/email');

// POST /api/admin/send-promo - UNAUTHENTICATED ACCESS (removed auth by request)
// WARNING: Authentication checks were intentionally removed here per explicit request.
// This endpoint now accepts unauthenticated requests and will send promotional emails.
// Be very careful: leaving this enabled on a public server can lead to abuse.
router.post('/send-promo', async (req, res) => {
  try {
    console.warn('UNAUTHENTICATED send-promo called from', req.ip, '- AUTH REMOVED BY REQUEST');

    const { subject, html, target = 'all', emails } = req.body || {};
    if (!subject || !html) return res.status(400).json({ error: 'Missing subject or html' });

    // Determine recipients
    let recipients = [];
    if (target === 'emails' && Array.isArray(emails) && emails.length > 0) {
      recipients = await User.find({ email: { $in: emails.map(e => String(e).trim().toLowerCase()) } }).select('email nombre').lean();
    } else {
      recipients = await User.find({}).select('email nombre').lean();
    }

    // Send first email synchronously so we can return a preview URL when using Ethereal
    let previewUrl = null;
    if (recipients.length > 0) {
      try {
        const r = recipients[0];
        const personalized = String(html).replace(/{{\s*name\s*}}/gi, (r.nombre || r.email || ''));
        const result = await sendMail({ to: r.email, subject, html: personalized });
        if (result && result.preview) previewUrl = result.preview;
      } catch (err) {
        console.error('Failed to send first promo (preview):', err);
      }
    }

    // Send remaining emails in background (best-effort)
    (async () => {
      const start = previewUrl ? 1 : 0;
      for (let i = start; i < recipients.length; i++) {
        const r = recipients[i];
        try {
          const personalized = String(html).replace(/{{\s*name\s*}}/gi, (r.nombre || r.email || ''));
          await sendMail({ to: r.email, subject, html: personalized });
        } catch (err) {
          console.error('Failed to send promo to', r.email, err);
        }
      }
    })();

    return res.json({ success: true, queued: recipients.length, unauth: true, preview: previewUrl });
  } catch (err) {
    console.error('send-promo error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/create-admin - create or promote an admin user
router.post('/create-admin', async (req, res) => {
  try {
    const { nombre, apellido, email, password, cedula, telefono, photo } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const normalizedEmail = String(email).trim().toLowerCase();

    let user = await User.findOne({ email: normalizedEmail });
    if (user) {
      // Promote existing user to admin
      user.isAdmin = true;
      // If a password was provided and user has no passwordHash, set it
      if (!user.passwordHash && password) {
        const salt = await bcrypt.genSalt(10);
        user.passwordHash = await bcrypt.hash(password, salt);
      }
      await user.save();
      return res.json({ message: 'User promoted to admin', user: { id: user._id, email: user.email, nombre: user.nombre, isAdmin: true } });
    }

    // Create new admin user
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = new User({
      nombre: nombre || 'Administrador',
      apellido: apellido || '',
      email: normalizedEmail,
      passwordHash,
      cedula: cedula || '',
      telefono: telefono || '',
      photo: photo || '',
      isAdmin: true
    });

    const saved = await newUser.save();
    return res.status(201).json({ message: 'Admin user created', user: { id: saved._id, email: saved.email, nombre: saved.nombre, isAdmin: true } });
  } catch (err) {
    console.error('Error in /api/create-admin:', err);
    return res.status(500).json({ error: 'Server error creating admin' });
  }
});

// GET /api/dbstatus - quick status of DB: connection state and collection counts
router.get('/dbstatus', async (req, res) => {
  try {
    const state = mongoose.connection.readyState; // 0 disconnected, 1 connected, 2 connecting, 3 disconnecting
    const productsCount = await Product.countDocuments().catch(() => null);
    const usersCount = await User.countDocuments().catch(() => null);
    const ordersCount = await Order.countDocuments().catch(() => null);

    // sample products (first 10)
    const sampleProducts = await Product.find().limit(10).lean().select('nombre precio stock imagen categoria').catch(() => []);

    res.json({
      state,
      productsCount,
      usersCount,
      ordersCount,
      sampleProducts
    });
  } catch (err) {
    console.error('Error in /api/dbstatus:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
