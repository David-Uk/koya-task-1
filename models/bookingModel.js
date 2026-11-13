const mongoose = require('mongoose');
const crypto = require('crypto');

const bookingSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    default: () => 'b_' + crypto.randomBytes(6).toString('hex')
  },
  slot_id: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
  created_at: { type: Date, default: Date.now },
}, { versionKey: false });

// Partial unique index: ensures only ONE confirmed booking exists for a slot.
// Cancelled bookings are excluded from this index, allowing the slot to be booked again.
bookingSchema.index(
  { slot_id: 1 },
  { unique: true, partialFilterExpression: { status: 'confirmed' } }
);

module.exports = mongoose.model('Booking', bookingSchema);
