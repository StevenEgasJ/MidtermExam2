const express = require('express');
const { Types } = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Product = require('../models/Product');
const Review = require('../models/Review');
const Order = require('../models/Order');
const Supplier = require('../models/Supplier');

const router = express.Router();
const SAFE_USER_FIELDS = '-passwordHash -emailVerificationToken -emailVerificationExpires';
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const TRUE_FLAG_VALUES = new Set(['true', '1', 1, true]);

function normalizeId(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function sanitizeUser(userDoc) {
  if (!userDoc) return null;
  const plain = userDoc.toObject ? userDoc.toObject({ virtuals: true }) : { ...userDoc };
  const preferredId = plain.id || (plain._id ? plain._id.toString() : undefined);
  plain.id = preferredId;
  delete plain.passwordHash;
  delete plain.emailVerificationToken;
  delete plain.emailVerificationExpires;
  return plain;
}

function parseLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

function classifyIdentifier(identifier) {
  if (Types.ObjectId.isValid(identifier)) return { mode: 'objectId', value: identifier };
  const asNumber = Number(identifier);
  if (Number.isInteger(asNumber) && asNumber > 0) return { mode: 'index', value: asNumber };
  return { mode: 'invalid' };
}

async function fetchByIdentifier({ Model, identifier, select, sortField, lean = true, customIdField }) {
  const normalized = identifier === undefined || identifier === null ? '' : String(identifier).trim();

  if (customIdField && normalized) {
    let customQuery = Model.findOne({ [customIdField]: normalized });
    if (select) customQuery = customQuery.select(select);
    if (lean) customQuery = customQuery.lean({ virtuals: true });
    const customDoc = await customQuery.exec();
    if (customDoc) return { doc: customDoc };
  }

  const classification = classifyIdentifier(normalized);
  if (classification.mode === 'invalid') {
    return { error: 'Identifier must be a Mongo ObjectId or a positive integer index.' };
  }

  if (classification.mode === 'objectId') {
    let query = Model.findById(classification.value);
    if (select) query = query.select(select);
    if (lean) query = query.lean({ virtuals: true });
    const doc = await query.exec();
    return { doc };
  }

  let query = Model.find()
    .sort({ [sortField]: 1, _id: 1 })
    .skip(classification.value - 1)
    .limit(1);
  if (select) query = query.select(select);
  if (lean) query = query.lean({ virtuals: true });
  const docs = await query.exec();
  return { doc: docs[0], usedIndex: true };
}

async function queryUserByCustomId(value, { select, lean = true } = {}) {
  if (!value) return null;
  let query = User.findOne({ id: value });
  if (select) query = query.select(select);
  if (lean) query = query.lean({ virtuals: true });
  return query.exec();
}

async function resolveUserByIdentifier(identifier, { select, lean = true } = {}) {
  const normalized = normalizeId(identifier);
  if (!normalized) return { error: 'Identifier must be provided' };

  const byCustomId = await queryUserByCustomId(normalized, { select, lean });
  if (byCustomId) return { doc: byCustomId };

  return fetchByIdentifier({
    Model: User,
    identifier: normalized,
    select,
    sortField: 'fechaRegistro',
    lean
  });
}

// Users listing available at /user or /users
router.get(['/user', '/users'], async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const users = await User.find()
      .select(SAFE_USER_FIELDS)
      .sort({ fechaRegistro: -1, _id: -1 })
      .limit(limit)
      .lean({ virtuals: true });
    res.json(users.map(sanitizeUser));
  } catch (err) {
    console.error('Public users list failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /user (alias /users) - create a new user document
router.post(['/user', '/users'], async (req, res) => {
  try {
    const nombre = (req.body.nombre || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password;
    const requestedId = normalizeId(req.body.id);

    if (!nombre || !email || !password || !requestedId) {
      return res.status(400).json({ error: 'id, nombre, email, and password are required' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const idExists = await User.findOne({ id: requestedId }).select('_id');
    if (idExists) {
      return res.status(409).json({ error: 'id already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = new User({
      id: requestedId,
      nombre,
      apellido: req.body.apellido,
      email,
      passwordHash,
      telefono: req.body.telefono,
      cedula: req.body.cedula,
      photo: req.body.photo,
      isAdmin: TRUE_FLAG_VALUES.has(req.body.isAdmin)
    });

    const saved = await newUser.save();
    res.status(201).json(sanitizeUser(saved));
  } catch (err) {
    console.error('Public user create failed:', err);
    res.status(400).json({ error: 'Invalid user payload' });
  }
});

// Support /user/:identifier (alias /users/:identifier)
router.get(['/user/:identifier', '/users/:identifier'], async (req, res) => {
  try {
    const { doc, error } = await resolveUserByIdentifier(req.params.identifier, {
      select: SAFE_USER_FIELDS,
      lean: true
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'User not found' });
    res.json(sanitizeUser(doc));
  } catch (err) {
    console.error('Public user lookup failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /user/:identifier (alias /users/:identifier)
router.put(['/user/:identifier', '/users/:identifier'], async (req, res) => {
  try {
    const { doc, error } = await resolveUserByIdentifier(req.params.identifier, {
      select: '_id id',
      lean: false
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'User not found' });

    const updates = {};
    const fieldsToTrim = ['nombre', 'apellido', 'telefono', 'cedula', 'photo'];
    fieldsToTrim.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        const value = req.body[field] == null ? '' : String(req.body[field]).trim();
        updates[field] = value;
      }
    });

    if (Object.prototype.hasOwnProperty.call(req.body, 'email')) {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'Email cannot be empty' });
      const emailOwner = await User.findOne({ email, _id: { $ne: doc._id } }).select('_id');
      if (emailOwner) return res.status(409).json({ error: 'Email already registered' });
      updates.email = email;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'id')) {
      const newId = normalizeId(req.body.id);
      if (!newId) return res.status(400).json({ error: 'id cannot be empty' });
      const idOwner = await User.findOne({ id: newId, _id: { $ne: doc._id } }).select('_id');
      if (idOwner) return res.status(409).json({ error: 'id already registered' });
      updates.id = newId;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'isAdmin')) {
      updates.isAdmin = TRUE_FLAG_VALUES.has(req.body.isAdmin);
    }

    if (req.body.password) {
      const salt = await bcrypt.genSalt(10);
      updates.passwordHash = await bcrypt.hash(req.body.password, salt);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    updates.fechaModificacion = new Date();

    const updated = await User.findByIdAndUpdate(doc._id, { $set: updates }, { new: true, runValidators: true });
    res.json(sanitizeUser(updated));
  } catch (err) {
    console.error('Public user update failed:', err);
    res.status(400).json({ error: 'Invalid update payload' });
  }
});

// DELETE /user/:identifier (alias /users/:identifier)
router.delete(['/user/:identifier', '/users/:identifier'], async (req, res) => {
  try {
    const { doc, error } = await resolveUserByIdentifier(req.params.identifier, {
      select: '_id',
      lean: false
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'User not found' });

    await User.findByIdAndDelete(doc._id);
    res.json({ success: true });
  } catch (err) {
    console.error('Public user delete failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /user (alias /users) by providing id in body or query
router.delete(['/user', '/users'], async (req, res) => {
  try {
    const identifier = normalizeId(req.body && req.body.id ? req.body.id : req.query && req.query.id);
    if (!identifier) return res.status(400).json({ error: 'id is required' });

    const { doc, error } = await resolveUserByIdentifier(identifier, {
      select: '_id',
      lean: false
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'User not found' });

    await User.findByIdAndDelete(doc._id);
    res.json({ success: true });
  } catch (err) {
    console.error('Public user delete-by-id failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Products listing available at /products?limit=12
router.get('/products', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const products = await Product.find()
      .sort({ fechaCreacion: -1, _id: -1 })
      .limit(limit)
      .lean();
    res.json(products);
  } catch (err) {
    console.error('Public products list failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Support /products/:identifier similar to users route
router.get('/products/:identifier', async (req, res) => {
  try {
    const { doc, error } = await fetchByIdentifier({
      Model: Product,
      identifier: req.params.identifier,
      select: undefined,
      sortField: 'fechaCreacion'
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'Product not found' });
    res.json(doc);
  } catch (err) {
    console.error('Public product lookup failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /products - create a new product
router.post('/products', async (req, res) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    const precio = Number(req.body.precio);
    if (!nombre) return res.status(400).json({ error: 'nombre is required' });
    if (!Number.isFinite(precio) || precio < 0) return res.status(400).json({ error: 'precio must be a non-negative number' });

    const product = new Product({
      nombre,
      precio,
      categoria: req.body.categoria,
      stock: Number.isFinite(Number(req.body.stock)) ? Number(req.body.stock) : undefined,
      descuento: Number.isFinite(Number(req.body.descuento)) ? Number(req.body.descuento) : undefined,
      imagen: req.body.imagen,
      descripcion: req.body.descripcion
    });

    const saved = await product.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error('Public product create failed:', err);
    res.status(400).json({ error: 'Invalid product payload' });
  }
});

// PUT /products/:identifier - update a product
router.put('/products/:identifier', async (req, res) => {
  try {
    const { doc, error } = await fetchByIdentifier({
      Model: Product,
      identifier: req.params.identifier,
      select: '_id',
      sortField: 'fechaCreacion',
      lean: false
    });
    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'Product not found' });

    const updates = {};
    ['nombre', 'categoria', 'imagen', 'descripcion'].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field] == null ? '' : String(req.body[field]).trim();
      }
    });

    if (Object.prototype.hasOwnProperty.call(req.body, 'precio')) {
      const precio = Number(req.body.precio);
      if (!Number.isFinite(precio) || precio < 0) return res.status(400).json({ error: 'precio must be a non-negative number' });
      updates.precio = precio;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'stock')) {
      const stock = Number(req.body.stock);
      if (!Number.isInteger(stock) || stock < 0) return res.status(400).json({ error: 'stock must be a non-negative integer' });
      updates.stock = stock;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'descuento')) {
      const descuento = Number(req.body.descuento);
      if (!Number.isFinite(descuento) || descuento < 0) return res.status(400).json({ error: 'descuento must be a non-negative number' });
      updates.descuento = descuento;
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No updatable fields provided' });
    updates.fechaModificacion = new Date();

    const updated = await Product.findByIdAndUpdate(doc._id, { $set: updates }, { new: true, runValidators: true });
    res.json(updated);
  } catch (err) {
    console.error('Public product update failed:', err);
    res.status(400).json({ error: 'Invalid update payload' });
  }
});

// DELETE /products/:identifier
router.delete('/products/:identifier', async (req, res) => {
  try {
    const { doc, error } = await fetchByIdentifier({
      Model: Product,
      identifier: req.params.identifier,
      select: '_id',
      sortField: 'fechaCreacion',
      lean: false
    });
    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'Product not found' });

    await Product.findByIdAndDelete(doc._id);
    res.json({ success: true });
  } catch (err) {
    console.error('Public product delete failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /products by providing id in body or query
router.delete('/products', async (req, res) => {
  try {
    const identifier = normalizeId(req.body && req.body.id ? req.body.id : req.query && req.query.id);
    if (!identifier) return res.status(400).json({ error: 'id is required' });

    const { doc, error } = await fetchByIdentifier({
      Model: Product,
      identifier,
      select: '_id',
      sortField: 'fechaCreacion',
      lean: false
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'Product not found' });

    await Product.findByIdAndDelete(doc._id);
    res.json({ success: true });
  } catch (err) {
    console.error('Public product delete-by-id failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reviews listing available at /review or /reviews
router.get(['/review', '/reviews'], async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const reviews = await Review.find()
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
    res.json(reviews);
  } catch (err) {
    console.error('Public reviews list failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /review (alias /reviews) - create a new review
router.post(['/review', '/reviews'], async (req, res) => {
  try {
    const productId = normalizeId(req.body.productId);
    const rating = Number(req.body.rating);

    if (!productId) {
      return res.status(400).json({ error: 'productId is required' });
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
    }

    // Verify product exists
    if (!Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Invalid productId format' });
    }

    const product = await Product.findById(productId).select('_id');
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const newReview = new Review({
      productId,
      userId: req.body.userId ? Types.ObjectId(req.body.userId) : undefined,
      name: req.body.name,
      email: req.body.email,
      rating,
      title: req.body.title,
      body: req.body.body,
      approved: TRUE_FLAG_VALUES.has(req.body.approved)
    });

    const saved = await newReview.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error('Public review create failed:', err);
    res.status(400).json({ error: 'Invalid review payload' });
  }
});

// GET /reviews/product/:productId - get all reviews for a specific product
router.get('/reviews/product/:productId', async (req, res) => {
  try {
    const productId = normalizeId(req.params.productId);
    
    if (!productId || !Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Invalid productId format' });
    }

    const limit = parseLimit(req.query.limit);
    const reviews = await Review.find({ productId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
    
    res.json(reviews);
  } catch (err) {
    console.error('Public reviews by product failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /review/:identifier (alias /reviews/:identifier)
router.put(['/review/:identifier', '/reviews/:identifier'], async (req, res) => {
  try {
    const { doc, error } = await fetchByIdentifier({
      Model: Review,
      identifier: req.params.identifier,
      select: '_id',
      sortField: 'createdAt',
      lean: false
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'Review not found' });

    const updates = {};
    const fieldsToTrim = ['name', 'email', 'title', 'body'];
    fieldsToTrim.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        const value = req.body[field] == null ? '' : String(req.body[field]).trim();
        updates[field] = value;
      }
    });

    if (Object.prototype.hasOwnProperty.call(req.body, 'rating')) {
      const rating = Number(req.body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
      }
      updates.rating = rating;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'approved')) {
      updates.approved = TRUE_FLAG_VALUES.has(req.body.approved);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'productId')) {
      const productId = normalizeId(req.body.productId);
      if (!productId || !Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ error: 'Invalid productId format' });
      }
      const product = await Product.findById(productId).select('_id');
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      updates.productId = productId;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    const updated = await Review.findByIdAndUpdate(doc._id, { $set: updates }, { new: true, runValidators: true });
    res.json(updated);
  } catch (err) {
    console.error('Public review update failed:', err);
    res.status(400).json({ error: 'Invalid update payload' });
  }
});

// DELETE /review/:identifier (alias /reviews/:identifier)
router.delete(['/review/:identifier', '/reviews/:identifier'], async (req, res) => {
  try {
    const { doc, error } = await fetchByIdentifier({
      Model: Review,
      identifier: req.params.identifier,
      select: '_id',
      sortField: 'createdAt',
      lean: false
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'Review not found' });

    await Review.findByIdAndDelete(doc._id);
    res.json({ success: true });
  } catch (err) {
    console.error('Public review delete failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /reviews/product/:productId - delete all reviews for a specific product
router.delete('/reviews/product/:productId', async (req, res) => {
  try {
    const productId = normalizeId(req.params.productId);
    
    if (!productId || !Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Invalid productId format' });
    }

    const result = await Review.deleteMany({ productId });
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('Public reviews delete by product failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Orders listing available at /orders
router.get('/orders', async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const orders = await Order.find()
      .sort({ fecha: -1, _id: -1 })
      .limit(limit)
      .lean({ virtuals: true });
    res.json(orders);
  } catch (err) {
    console.error('Public orders list failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /orders/:identifier
router.get('/orders/:identifier', async (req, res) => {
  try {
    const { doc, error } = await fetchByIdentifier({
      Model: Order,
      identifier: req.params.identifier,
      select: undefined,
      sortField: 'fecha',
      lean: true,
      customIdField: 'id'
    });
    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'Order not found' });
    res.json(doc);
  } catch (err) {
    console.error('Public order lookup failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /orders - create a new order
router.post('/orders', async (req, res) => {
  try {
    let userId;
    if (req.body.userId) {
      if (!Types.ObjectId.isValid(req.body.userId)) return res.status(400).json({ error: 'Invalid userId format' });
      userId = Types.ObjectId(req.body.userId);
    }

    const order = new Order({
      userId,
      items: Array.isArray(req.body.items) ? req.body.items : [],
      resumen: req.body.resumen || {},
      estado: req.body.estado || undefined
    });

    const saved = await order.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error('Public order create failed:', err);
    res.status(400).json({ error: 'Invalid order payload' });
  }
});

// PUT /orders/:identifier - update an order
router.put('/orders/:identifier', async (req, res) => {
  try {
    const { doc, error } = await fetchByIdentifier({
      Model: Order,
      identifier: req.params.identifier,
      select: '_id',
      sortField: 'fecha',
      lean: false,
      customIdField: 'id'
    });
    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'Order not found' });

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(req.body, 'items')) {
      if (!Array.isArray(req.body.items)) return res.status(400).json({ error: 'items must be an array' });
      updates.items = req.body.items;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'resumen')) {
      updates.resumen = req.body.resumen || {};
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'estado')) {
      updates.estado = String(req.body.estado || '').trim();
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'userId')) {
      if (!req.body.userId || !Types.ObjectId.isValid(req.body.userId)) return res.status(400).json({ error: 'Invalid userId format' });
      updates.userId = Types.ObjectId(req.body.userId);
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No updatable fields provided' });

    const updated = await Order.findByIdAndUpdate(doc._id, { $set: updates }, { new: true, runValidators: true });
    res.json(updated);
  } catch (err) {
    console.error('Public order update failed:', err);
    res.status(400).json({ error: 'Invalid update payload' });
  }
});

// DELETE /orders/:identifier
router.delete('/orders/:identifier', async (req, res) => {
  try {
    const { doc, error } = await fetchByIdentifier({
      Model: Order,
      identifier: req.params.identifier,
      select: '_id',
      sortField: 'fecha',
      lean: false,
      customIdField: 'id'
    });
    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'Order not found' });

    await Order.findByIdAndDelete(doc._id);
    res.json({ success: true });
  } catch (err) {
    console.error('Public order delete failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /orders by providing id in body or query
router.delete('/orders', async (req, res) => {
  try {
    const identifier = normalizeId(req.body && req.body.id ? req.body.id : req.query && req.query.id);
    if (!identifier) return res.status(400).json({ error: 'id is required' });

    const { doc, error } = await fetchByIdentifier({
      Model: Order,
      identifier,
      select: '_id',
      sortField: 'fecha',
      lean: false,
      customIdField: 'id'
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'Order not found' });

    await Order.findByIdAndDelete(doc._id);
    res.json({ success: true });
  } catch (err) {
    console.error('Public order delete-by-id failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Suppliers listing available at /supplier or /suppliers
router.get(['/supplier', '/suppliers'], async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const suppliers = await Supplier.find()
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
    res.json(suppliers);
  } catch (err) {
    console.error('Public suppliers list failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /supplier (alias /suppliers) - create a new supplier
router.post(['/supplier', '/suppliers'], async (req, res) => {
  try {
    const proveedor = (req.body.proveedor || '').trim();

    if (!proveedor) {
      return res.status(400).json({ error: 'proveedor is required' });
    }

    const newSupplier = new Supplier({
      proveedor,
      contacto: req.body.contacto,
      celular: req.body.celular,
      categorias: Array.isArray(req.body.categorias) ? req.body.categorias : [],
      rating: req.body.rating ? Number(req.body.rating) : 0,
      pedidos: req.body.pedidos ? Number(req.body.pedidos) : 0
    });

    const saved = await newSupplier.save();
    res.status(201).json(saved);
  } catch (err) {
    console.error('Public supplier create failed:', err);
    res.status(400).json({ error: 'Invalid supplier payload' });
  }
});

// GET /supplier/:identifier (alias /suppliers/:identifier)
router.get(['/supplier/:identifier', '/suppliers/:identifier'], async (req, res) => {
  try {
    const { doc, error } = await fetchByIdentifier({
      Model: Supplier,
      identifier: req.params.identifier,
      select: undefined,
      sortField: 'createdAt',
      lean: true
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'Supplier not found' });
    res.json(doc);
  } catch (err) {
    console.error('Public supplier lookup failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /supplier/:identifier (alias /suppliers/:identifier)
router.put(['/supplier/:identifier', '/suppliers/:identifier'], async (req, res) => {
  try {
    const { doc, error } = await fetchByIdentifier({
      Model: Supplier,
      identifier: req.params.identifier,
      select: '_id',
      sortField: 'createdAt',
      lean: false
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'Supplier not found' });

    const updates = {};
    const fieldsToTrim = ['proveedor', 'contacto', 'celular'];
    fieldsToTrim.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        const value = req.body[field] == null ? '' : String(req.body[field]).trim();
        updates[field] = value;
      }
    });

    if (Object.prototype.hasOwnProperty.call(req.body, 'categorias')) {
      updates.categorias = Array.isArray(req.body.categorias) ? req.body.categorias : [];
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'rating')) {
      const rating = Number(req.body.rating);
      if (rating < 0 || rating > 5) {
        return res.status(400).json({ error: 'rating must be between 0 and 5' });
      }
      updates.rating = rating;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'pedidos')) {
      updates.pedidos = Number(req.body.pedidos) || 0;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    updates.updatedAt = new Date();

    const updated = await Supplier.findByIdAndUpdate(doc._id, { $set: updates }, { new: true, runValidators: true });
    res.json(updated);
  } catch (err) {
    console.error('Public supplier update failed:', err);
    res.status(400).json({ error: 'Invalid update payload' });
  }
});

// DELETE /supplier/:identifier (alias /suppliers/:identifier)
router.delete(['/supplier/:identifier', '/suppliers/:identifier'], async (req, res) => {
  try {
    const { doc, error } = await fetchByIdentifier({
      Model: Supplier,
      identifier: req.params.identifier,
      select: '_id',
      sortField: 'createdAt',
      lean: false
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'Supplier not found' });

    await Supplier.findByIdAndDelete(doc._id);
    res.json({ success: true });
  } catch (err) {
    console.error('Public supplier delete failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Cart endpoints - Working directly with users.cart field

// GET /cart or /carts - get all carts from all users
router.get(['/cart', '/carts'], async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    const users = await User.find({ 'cart.0': { $exists: true } })
      .select('_id id nombre email cart')
      .sort({ fechaRegistro: -1, _id: -1 })
      .limit(limit)
      .lean();
    
    // Poblar información completa de productos en cada carrito
    const cartsWithDetails = await Promise.all(
      users.map(async (user) => {
        const itemsWithDetails = await Promise.all(
          (user.cart || []).map(async (item) => {
            const product = await Product.findById(item.id).lean();
            return {
              id: item.id,
              nombre: product?.nombre || item.nombre || '',
              precio: product?.precio || item.precio || 0,
              descripcion: product?.descripcion || product?.mililitros || '',
              imagen: product?.imagen || item.imagen || '',
              cantidad: item.cantidad
            };
          })
        );
        return {
          userId: user._id,
          userInfo: {
            id: user.id,
            nombre: user.nombre,
            email: user.email
          },
          items: itemsWithDetails
        };
      })
    );
    
    res.json(cartsWithDetails);
  } catch (err) {
    console.error('Public carts list failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /cart/:userId - get cart for a specific user
router.get('/cart/:userId', async (req, res) => {
  try {
    const { doc, error } = await resolveUserByIdentifier(req.params.userId, {
      select: '_id id nombre email cart',
      lean: true
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'User not found' });

    // Poblar la información completa de cada producto en el carrito
    const cartWithDetails = await Promise.all(
      (doc.cart || []).map(async (item) => {
        const product = await Product.findById(item.id).lean();
        return {
          id: item.id,
          nombre: product?.nombre || item.nombre || '',
          precio: product?.precio || item.precio || 0,
          descripcion: product?.descripcion || product?.mililitros || '',
          imagen: product?.imagen || item.imagen || '',
          cantidad: item.cantidad
        };
      })
    );

    res.json({
      userId: doc._id,
      userInfo: {
        id: doc.id,
        nombre: doc.nombre,
        email: doc.email
      },
      items: cartWithDetails
    });
  } catch (err) {
    console.error('Public cart lookup failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /cart/:userId/item - add product to user's cart
router.post('/cart/:userId/item', async (req, res) => {
  try {
    const productId = normalizeId(req.body.productId);
    const cantidad = Number(req.body.cantidad) || 1;

    if (!productId || !Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Invalid productId format' });
    }

    if (cantidad < 1) {
      return res.status(400).json({ error: 'cantidad must be at least 1' });
    }

    const { doc, error } = await resolveUserByIdentifier(req.params.userId, {
      select: '_id id nombre email cart',
      lean: false
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'User not found' });

    // Obtener información del producto
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Inicializar cart si no existe
    if (!doc.cart) {
      doc.cart = [];
    }

    // Verificar si el producto ya está en el carrito
    const existingItemIndex = doc.cart.findIndex(item => item.id === productId);
    
    if (existingItemIndex > -1) {
      // Si existe, actualizar la cantidad
      doc.cart[existingItemIndex].cantidad += cantidad;
      // Actualizar también la info del producto por si cambió
      doc.cart[existingItemIndex].nombre = product.nombre;
      doc.cart[existingItemIndex].precio = product.precio;
      doc.cart[existingItemIndex].descripcion = product.descripcion || product.mililitros || '';
      doc.cart[existingItemIndex].imagen = product.imagen;
    } else {
      // Si no existe, agregar el nuevo item con toda la info del producto
      doc.cart.push({
        id: productId,
        nombre: product.nombre,
        precio: product.precio,
        descripcion: product.descripcion || product.mililitros || '',
        imagen: product.imagen,
        cantidad
      });
    }

    await doc.save();

    res.json({
      success: true,
      userId: doc._id,
      userInfo: {
        id: doc.id,
        nombre: doc.nombre,
        email: doc.email
      },
      items: doc.cart
    });
  } catch (err) {
    console.error('Public cart add item failed:', err);
    res.status(400).json({ error: 'Invalid cart item payload' });
  }
});

// PUT /cart/:userId/item/:productId - update product quantity in user's cart
router.put('/cart/:userId/item/:productId', async (req, res) => {
  try {
    const productId = normalizeId(req.params.productId);
    const cantidad = Number(req.body.cantidad);

    if (!productId || !Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Invalid productId format' });
    }

    if (!cantidad || cantidad < 1) {
      return res.status(400).json({ error: 'cantidad must be at least 1' });
    }

    const { doc, error } = await resolveUserByIdentifier(req.params.userId, {
      select: '_id id nombre email cart',
      lean: false
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'User not found' });

    if (!doc.cart || doc.cart.length === 0) {
      return res.status(404).json({ error: 'Cart is empty' });
    }

    const itemIndex = doc.cart.findIndex(item => item.id === productId);
    if (itemIndex === -1) {
      return res.status(404).json({ error: 'Product not found in cart' });
    }

    // Actualizar la cantidad
    doc.cart[itemIndex].cantidad = cantidad;

    // Actualizar nombre, precio y descripción del producto por si cambió
    const product = await Product.findById(productId);
    if (product) {
      doc.cart[itemIndex].nombre = product.nombre;
      doc.cart[itemIndex].precio = product.precio;
      doc.cart[itemIndex].descripcion = product.descripcion || product.mililitros || '';
      doc.cart[itemIndex].imagen = product.imagen;
    }

    await doc.save();

    res.json({
      success: true,
      userId: doc._id,
      userInfo: {
        id: doc.id,
        nombre: doc.nombre,
        email: doc.email
      },
      items: doc.cart
    });
  } catch (err) {
    console.error('Public cart update item failed:', err);
    res.status(400).json({ error: 'Invalid update payload' });
  }
});

// DELETE /cart/:userId/item/:productId - remove product from user's cart
router.delete('/cart/:userId/item/:productId', async (req, res) => {
  try {
    const productId = normalizeId(req.params.productId);

    if (!productId || !Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ error: 'Invalid productId format' });
    }

    const { doc, error } = await resolveUserByIdentifier(req.params.userId, {
      select: '_id id nombre email cart',
      lean: false
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'User not found' });

    if (!doc.cart || doc.cart.length === 0) {
      return res.status(404).json({ error: 'Cart is empty' });
    }

    const itemIndex = doc.cart.findIndex(item => item.id === productId);
    if (itemIndex === -1) {
      return res.status(404).json({ error: 'Product not found in cart' });
    }

    // Eliminar el producto del carrito
    doc.cart.splice(itemIndex, 1);
    await doc.save();

    res.json({
      success: true,
      userId: doc._id,
      userInfo: {
        id: doc.id,
        nombre: doc.nombre,
        email: doc.email
      },
      items: doc.cart
    });
  } catch (err) {
    console.error('Public cart delete item failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /cart/:userId - clear entire cart for a user
router.delete('/cart/:userId', async (req, res) => {
  try {
    const { doc, error } = await resolveUserByIdentifier(req.params.userId, {
      select: '_id id nombre email',
      lean: false
    });

    if (error) return res.status(400).json({ error });
    if (!doc) return res.status(404).json({ error: 'User not found' });

    doc.cart = [];
    await doc.save();

    res.json({ success: true, message: 'Cart cleared' });
  } catch (err) {
    console.error('Public cart clear failed:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
