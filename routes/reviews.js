const express = require('express');
const router = express.Router();
const Review = require('../models/Review');
// Admin moderation endpoints are intentionally public per user request (no auth)

// POST /api/reviews - submit a review (public)
router.post('/', async (req, res) => {
  try {
    const { productId, name, email, rating, title, body } = req.body || {};
    if (!productId || !body) return res.status(400).json({ error: 'productId and body are required' });

    const review = new Review({ productId, name: name || '', email: email || '', rating: Number(rating) || 5, title: title || '', body });
    await review.save();
    // Do not approve automatically to allow moderation
    return res.status(201).json({ success: true, review: { id: review._id, approved: review.approved } });
  } catch (err) {
    console.error('Error creating review:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reviews?productId=... - list approved reviews for product (public)
router.get('/', async (req, res) => {
  try {
    const productId = req.query.productId;
    if (!productId) return res.status(400).json({ error: 'productId is required' });
    const reviews = await Review.find({ productId: productId, approved: true }).sort({ createdAt: -1 }).lean();
    return res.json(reviews);
  } catch (err) {
    console.error('Error listing reviews:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ADMIN: GET all reviews (including pending) - public by request
router.get('/admin/all', async (req, res) => {
  try {
    const reviews = await Review.find().sort({ createdAt: -1 }).lean();
    return res.json(reviews);
  } catch (err) {
    console.error('Error admin listing reviews:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ADMIN: approve/unapprove review (public by request)
router.put('/admin/:id/approve', async (req, res) => {
  try {
    const id = req.params.id;
    const r = await Review.findById(id);
    if (!r) return res.status(404).json({ error: 'Review not found' });
    r.approved = !!req.body.approved;
    await r.save();
    return res.json({ success: true, review: r });
  } catch (err) {
    console.error('Error approving review:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ADMIN: delete review (public by request)
router.delete('/admin/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await Review.findByIdAndDelete(id);
    return res.json({ success: true });
  } catch (err) {
    console.error('Error deleting review:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
