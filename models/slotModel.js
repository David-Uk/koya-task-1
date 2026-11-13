const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  provider: { type: String, required: true },
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  available: { type: Boolean, default: true },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Slot', slotSchema);
