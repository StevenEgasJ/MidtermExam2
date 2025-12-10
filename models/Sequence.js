const mongoose = require('mongoose');

const sequenceSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  value: { type: Number, default: 29 }
});

module.exports = mongoose.model('Sequence', sequenceSchema);
