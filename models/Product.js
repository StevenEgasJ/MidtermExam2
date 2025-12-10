const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  precio: { type: Number, required: true, default: 0 },
  categoria: { type: String, default: 'electrodomesticos' },
  stock: { type: Number, default: 0 },
  // descuento: porcentaje numérico aplicado al precio, por ejemplo 10 = 10%
  descuento: { type: Number, default: 0 },
  imagen: { type: String },
  descripcion: { type: String },
  fechaCreacion: { type: Date, default: Date.now },
  fechaModificacion: { type: Date }
});

// Add virtual `id` field so API consumers can rely on `product.id` (maps to MongoDB _id)
productSchema.virtual('id').get(function() {
  return this._id ? this._id.toString() : undefined;
});

// Ensure virtuals are included when converting documents to JSON or Objects
productSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: function (doc, ret) {
    // remove _id to avoid duplication if you prefer
    // keep _id if needed by other parts of the app
    return ret;
  }
});

module.exports = mongoose.model('Product', productSchema);
