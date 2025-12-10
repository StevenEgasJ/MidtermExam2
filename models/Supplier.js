const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema({
  proveedor: { type: String, required: true, trim: true },
  contacto: { type: String, trim: true },
  celular: { type: String, trim: true },
  categorias: [{ type: String, trim: true }],
  rating: { type: Number, min: 0, max: 5, default: 0 },
  pedidos: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update the updatedAt field before saving
SupplierSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Supplier', SupplierSchema);
