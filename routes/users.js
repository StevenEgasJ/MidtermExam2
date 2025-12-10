const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');

// GET /api/users - list all users
router.get('/', async (req, res) => {
  try {
    const users = await User.find().select('-passwordHash').sort({ nombre: 1 }).lean();
    res.json(users);
  } catch (err) {
    console.error('Error listing users:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/:id - get user by id (supports custom 'id' field or MongoDB '_id')
router.get('/:id', async (req, res) => {
  try {
    const searchId = req.params.id;
    let user = null;

    // Try to find by custom 'id' field (as string or number)
    user = await User.findOne({ id: searchId }).select('-passwordHash').lean();
    
    // If not found, try with id as number
    if (!user && !isNaN(searchId)) {
      user = await User.findOne({ id: Number(searchId) }).select('-passwordHash').lean();
    }

    // If not found by custom id, try MongoDB _id (only if it looks like a valid ObjectId)
    if (!user && searchId.match(/^[0-9a-fA-F]{24}$/)) {
      user = await User.findById(searchId).select('-passwordHash').lean();
    }

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users - create new user
router.post('/', async (req, res) => {
  try {
    const { nombre, apellido, email, password, cedula, telefono, photo } = req.body;
    if (!email || !password || !nombre) {
      return res.status(400).json({ error: 'Missing required fields (nombre, email, password)' });
    }

    const existing = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = new User({
      nombre,
      apellido,
      email: String(email).trim().toLowerCase(),
      passwordHash,
      cedula,
      telefono,
      photo
    });
    const saved = await user.save();

    // Return user without passwordHash
    const userObj = saved.toObject();
    delete userObj.passwordHash;
    res.status(201).json(userObj);
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/users/:id - update user (supports custom 'id' field or MongoDB '_id')
router.put('/:id', async (req, res) => {
  try {
    const searchId = req.params.id;
    const update = { ...req.body, fechaModificacion: new Date() };
    delete update.passwordHash;

    let updated = null;

    // First try by custom 'id' field as string
    updated = await User.findOneAndUpdate({ id: searchId }, update, { new: true }).select('-passwordHash');

    // Try as number
    if (!updated && !isNaN(searchId)) {
      updated = await User.findOneAndUpdate({ id: Number(searchId) }, update, { new: true }).select('-passwordHash');
    }

    // If not found, try MongoDB _id
    if (!updated && searchId.match(/^[0-9a-fA-F]{24}$/)) {
      updated = await User.findByIdAndUpdate(searchId, update, { new: true }).select('-passwordHash');
    }

    if (!updated) return res.status(404).json({ error: 'User not found' });
    res.json(updated);
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(400).json({ error: 'Invalid update' });
  }
});

// DELETE /api/users/:id (supports custom 'id' field or MongoDB '_id')
router.delete('/:id', async (req, res) => {
  try {
    const searchId = req.params.id;
    let deleted = null;

    // First try by custom 'id' field as string
    deleted = await User.findOneAndDelete({ id: searchId });

    // Try as number
    if (!deleted && !isNaN(searchId)) {
      deleted = await User.findOneAndDelete({ id: Number(searchId) });
    }

    // If not found, try MongoDB _id
    if (!deleted && searchId.match(/^[0-9a-fA-F]{24}$/)) {
      deleted = await User.findByIdAndDelete(searchId);
    }

    if (!deleted) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
