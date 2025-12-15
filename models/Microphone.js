const mongoose = require('mongoose');

const MicrophoneSchema = new mongoose.Schema({
  serialNumber: { type: String },
  id: { type: Number, required: true, unique: true },
  brand: { type: String },
  model: { type: String },
  countryOrigin: { type: String },
  color: { type: String },
  new: { type: Boolean, default: false },
  price: { type: Number }
}, { collection: 'microphone' });

module.exports = mongoose.model('Microphone', MicrophoneSchema);
