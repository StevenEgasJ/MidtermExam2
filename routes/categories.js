const express = require('express');
const router = express.Router();
const Product = require('../models/Product');

// GET /api/categories - return distinct categories from products collection
router.get('/', async (req, res) => {
  try {
    const cats = await Product.distinct('categoria');
    // Normalize: remove falsy and trim
    const cleaned = (cats || []).filter(c => !!c).map(c => c.toString().trim()).filter(Boolean);
    res.json(cleaned);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
