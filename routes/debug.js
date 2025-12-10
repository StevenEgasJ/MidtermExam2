const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/User');

// Debug route: list recent orders. Only enabled when DEBUG_API env var is truthy.
router.get('/orders', async (req, res) => {
  if (!process.env.DEBUG_API || process.env.DEBUG_API === 'false') {
    return res.status(403).json({ error: 'Debug API disabled' });
  }

  try {
    const email = req.query.email;
    const query = {};

    if (email) {
      // Find user by email and filter by userId
      const user = await User.findOne({ email: String(email).trim().toLowerCase() }).lean();
      if (!user) return res.json({ orders: [] });
      query.userId = user._id;
    }

    const orders = await Order.find(query).sort({ fecha: -1 }).limit(100).lean();

    // Optionally populate user email/name when possible
    const userIds = Array.from(new Set(orders.map(o => String(o.userId)).filter(Boolean)));
    const users = await User.find({ _id: { $in: userIds } }).lean();
    const usersById = users.reduce((acc, u) => { acc[String(u._id)] = u; return acc; }, {});

    const out = orders.map(o => ({
      id: o._id,
      userId: o.userId,
      userEmail: usersById[String(o.userId)] ? usersById[String(o.userId)].email : null,
      resumen: o.resumen,
      items: o.items,
      estado: o.estado,
      fecha: o.fecha
    }));

    res.json({ orders: out });
  } catch (err) {
    console.error('Debug orders error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
