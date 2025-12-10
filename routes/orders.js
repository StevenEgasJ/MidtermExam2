const express = require('express');
const router = express.Router();
const Order = require('../models/Order');

// GET /api/orders - list recent orders (admin)
router.get('/', async (req, res) => {
  try {
    const orders = await Order.find().sort({ fecha: -1 }).limit(200).lean();
    res.json(orders);
  } catch (err) {
    console.error('Error listing orders:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/orders/:id
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).lean();
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/orders/:id - update order (e.g., change status)
router.put('/:id', async (req, res) => {
  try {
    const update = req.body || {};
    update.fechaModificacion = new Date();
    const updated = await Order.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updated) return res.status(404).json({ error: 'Order not found' });
    res.json(updated);
  } catch (err) {
    console.error('Error updating order:', err);
    res.status(400).json({ error: 'Invalid update' });
  }
});

// DELETE /api/orders/:id
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Order.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Order not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
