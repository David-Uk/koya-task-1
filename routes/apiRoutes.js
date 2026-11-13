const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const slotController = require('../controllers/slotController');
const bookingController = require('../controllers/bookingController');

const VALID_API_KEY =
  process.env.API_KEY || 'koya-secret-key-2026';

// Constant-time comparison so the key check does not leak length/content.
function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// Level 2: every endpoint requires the X-API-Key header.
const apiKeyValidator = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !safeEqual(apiKey, VALID_API_KEY)) {
    return res.status(401).json({ error: 'invalid or missing API key' });
  }
  return next();
};

// Level 1: replace all slots and clear all bookings.
router.post('/reset', apiKeyValidator, bookingController.resetDatabase);

// Level 1: list slots (optionally filtered by provider).
router.get('/slots', apiKeyValidator, slotController.getSlots);

// Levels 1-5: book a slot.
router.post('/bookings', apiKeyValidator, bookingController.bookSlot);

// Level 4: list a person's bookings (cursor pagination).
router.get('/bookings', apiKeyValidator, bookingController.getUserBookings);

// Level 1: look up a single booking.
router.get('/bookings/:id', apiKeyValidator, bookingController.getBooking);

// Level 3: cancel a booking.
router.delete('/bookings/:id', apiKeyValidator, bookingController.cancelBooking);

module.exports = router;
