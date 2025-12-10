const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { sendMail } = require('../utils/email');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
  let { nombre, apellido, email, password, cedula, telefono, photo } = req.body;
  if (!email || !password || !nombre) return res.status(400).json({ error: 'Missing fields' });

  // Normalize email to lower-case
  email = String(email).trim().toLowerCase();

  const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

  // Create verification token
  const token = crypto.randomBytes(20).toString('hex');
  const tokenExpires = new Date(Date.now() + (24 * 60 * 60 * 1000)); // 24h

  const user = new User({ nombre, apellido, email, passwordHash, cedula, telefono, photo,
    emailVerified: false,
    emailVerificationToken: token,
    emailVerificationExpires: tokenExpires
  });
    const saved = await user.save();

    // Send verification email (best-effort, do not fail registration if email fails)
    (async () => {
      try {
        const base = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT||4000}`;
        const verifyUrl = `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
        const html = `<p>Hola ${escapeHtml(saved.nombre)},</p>
          <p>Gracias por registrarte. Por favor verifica tu correo haciendo clic en el siguiente enlace:</p>
          <p><a href="${verifyUrl}">Verificar correo</a></p>
          <p>Si no solicitaste esto, ignora este correo.</p>`;
        await sendMail({ to: saved.email, subject: 'Verifica tu correo - Tatylu', html });
        console.log('Verification email sent to', saved.email);
      } catch (err) {
        console.error('Failed sending verification email:', err);
      }
    })();

    // Also send a welcome/registration notification (best-effort)
    (async () => {
      try {
        const html = `<p>Hola ${escapeHtml(saved.nombre)},</p><p>Bienvenido a Tatylu. Gracias por registrarte.</p>`;
        await sendMail({ to: saved.email, subject: 'Bienvenido a Tatylu', html });
      } catch (err) {
        console.error('Failed sending welcome email:', err);
      }
    })();

    // Issue token at registration so client can be logged in immediately
    const jwtToken = jwt.sign({ id: saved._id, email: saved.email }, process.env.JWT_SECRET || 'devsecret', { expiresIn: '7d' });

  res.status(201).json({ token: jwtToken, user: { id: saved._id, nombre: saved.nombre, apellido: saved.apellido || '', email: saved.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/verify-email?token=...
router.get('/verify-email', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error: 'Missing token' });
    const user = await User.findOne({ emailVerificationToken: token });
    if (!user) return res.status(404).json({ error: 'Invalid token' });
    if (user.emailVerificationExpires && user.emailVerificationExpires < new Date()) {
      return res.status(400).json({ error: 'Token expired' });
    }
    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();
    // Optionally redirect to a client page
    const redirectTo = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT||4000}`;
    return res.json({ success: true, message: 'Email verified', redirect: redirectTo });
  } catch (err) {
    console.error('verify-email error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Missing email' });
    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.emailVerified) return res.status(400).json({ error: 'Already verified' });
    const token = crypto.randomBytes(20).toString('hex');
    user.emailVerificationToken = token;
    user.emailVerificationExpires = new Date(Date.now() + (24*60*60*1000));
    await user.save();
    const base = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT||4000}`;
    const verifyUrl = `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
    await sendMail({ to: user.email, subject: 'Verifica tu correo - Tatylu', html: `<p>Por favor verifica tu correo: <a href="${verifyUrl}">Verificar</a></p>` });
    res.json({ success: true });
  } catch (err) {
    console.error('resend-verification error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// small helper escapeHtml used in email construction
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\'':'&#39;','"':'&quot;'}[c]||c));
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
  let { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

  email = String(email).trim().toLowerCase();

  const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id, email: user.email }, process.env.JWT_SECRET || 'devsecret', { expiresIn: '7d' });

  res.json({ token, user: { id: user._id, nombre: user.nombre, apellido: user.apellido || '', email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
