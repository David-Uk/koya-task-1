const Slot = require('../models/slotModel');
const Booking = require('../models/bookingModel');

// GET /slots - List all slots (optionally filtered by provider), sorted by start earliest first
const getSlots = async (req, res) => {
  try {
    const provider = req.query.provider;
    const filter = {};
    if (provider !== undefined && provider !== '') {
      filter.provider = String(provider);
    }

    const slots = await Slot.find(filter).sort({ start: 1 });

    // Retrieve active confirmed bookings to determine availability accurately
    const confirmedBookings = await Booking.find({ status: 'confirmed' }, 'slot_id');
    const bookedSlotIds = new Set(confirmedBookings.map(b => b.slot_id));

    const result = slots.map(s => ({
      id: s.id,
      provider: s.provider,
      start: s.start instanceof Date ? s.start.toISOString() : new Date(s.start).toISOString(),
      end: s.end instanceof Date ? s.end.toISOString() : new Date(s.end).toISOString(),
      available: !bookedSlotIds.has(s.id),
    }));

    return res.status(200).json({ slots: result });
  } catch (err) {
    console.error('getSlots error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
};

module.exports = { getSlots };
