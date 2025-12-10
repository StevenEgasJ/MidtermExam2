const mongoose = require('mongoose');
const Sequence = require('./Sequence');

const orderSchema = new mongoose.Schema({
  id: { type: String, trim: true, unique: true, sparse: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  items: { type: Array, default: [] },
  resumen: { type: Object, default: {} },
  estado: { type: String, default: 'pendiente' },
  fecha: { type: Date, default: Date.now }
});

async function getNextOrderId() {
  const updated = await Sequence.findOneAndUpdate(
    { name: 'order-id' },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (updated.value < 30) {
    const corrected = await Sequence.findOneAndUpdate(
      { name: 'order-id' },
      { $set: { value: 30 } },
      { new: true }
    );
    return corrected.value;
  }
  return updated.value;
}

orderSchema.pre('save', async function(next) {
  if (!this.isNew || this.id) return next();
  try {
    const nextId = await getNextOrderId();
    this.id = String(nextId);
    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model('Order', orderSchema);
