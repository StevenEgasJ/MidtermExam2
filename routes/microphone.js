const express = require('express');
const router = express.Router();
const Microphone = require('../models/Microphone');

// GET /microphone - list all microphones
router.get('/', async (req, res) => {
  try {
    const items = await Microphone.find().sort({ id: 1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /microphone/:id - get microphone by numeric id
router.get('/:id', getMicrophoneById, (req, res) => {
  res.json(res.microphone);
});

// POST /microphone - create a microphone
router.post('/', async (req, res) => {
  const body = req.body;
  const mic = new Microphone({
    serialNumber: body.serialNumber,
    id: body.id,
    brand: body.brand,
    model: body.model,
    countryOrigin: body.countryOrigin,
    color: body.color,
    new: body.new,
    price: body.price
  });

  try {
    const saved = await mic.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /microphone/:id - delete by numeric id
router.delete('/:id', async (req, res) => {
  try {
    const result = await Microphone.deleteOne({ id: Number(req.params.id) });
    if (result.deletedCount === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Middleware to fetch microphone by id (numeric)
async function getMicrophoneById(req, res, next) {
  let mic;
  try {
    mic = await Microphone.findOne({ id: Number(req.params.id) });
    if (!mic) return res.status(404).json({ message: 'Not found' });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
  res.microphone = mic;
  next();
}

module.exports = router;
