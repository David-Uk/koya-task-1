const Booking = require('../models/bookingModel');
const IdempotencyKey = require('../models/idempotencyKeyModel');
const Slot = require('../models/slotModel');
const RateLimit = require('../models/rateLimitModel');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Level 5 - per-email rate limiting
// Sliding window: at most 5 attempts per email per 60 seconds. Stored in
// MongoDB so it is shared by every serverless instance / app replica.
// Failed attempts are recorded before validation, as the spec requires.
// ---------------------------------------------------------------------------
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000;

async function checkAndRecordRateLimit(email) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - WINDOW_MS);

  // Atomic read-modify-write: drop timestamps older than the window, append
  // this attempt, and return the resulting array.
  const update = [
    {
      $set: {
        attempts: {
          $filter: {
            input: { $ifNull: ['$attempts', []] },
            as: 'attempt',
            cond: { $gte: ['$$attempt', cutoff] },
          },
        },
      },
    },
    {
      $set: {
        attempts: { $concatArrays: ['$attempts', [now]] },
        updated_at: now,
      },
    },
  ];

  let doc = null;
  for (let i = 0; i < 3; i += 1) {
    try {
      doc = await RateLimit.findOneAndUpdate({ email }, update, {
        upsert: true,
        returnDocument: 'after',
        projection: { attempts: 1 },
        updatePipeline: true,
      }).lean();
      break;
    } catch (err) {
      // A concurrent first request created the document at the same time.
      if (err && err.code === 11000) continue;
      throw err;
    }
  }

  const attempts = doc && Array.isArray(doc.attempts) ? doc.attempts : [];
  if (attempts.length > MAX_ATTEMPTS) {
    const oldest = new Date(attempts[0]).getTime();
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now.getTime()) / 1000));
    return { limited: true, retryAfter: retryAfterSec };
  }

  return { limited: false };
}

async function clearRateLimits() {
  await RateLimit.deleteMany({});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function hashRequestBody(body) {
  const sorted = {};
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    Object.keys(body)
      .sort()
      .forEach((key) => {
        sorted[key] = body[key];
      });
  }
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

function serializeBooking(booking) {
  return {
    id: booking.id,
    slot_id: booking.slot_id,
    name: booking.name,
    email: booking.email,
    status: booking.status,
    created_at:
      booking.created_at instanceof Date
        ? booking.created_at.toISOString()
        : new Date(booking.created_at).toISOString(),
  };
}

function replayStoredResponse(stored, bodyHash, res) {
  if (stored.body_hash !== bodyHash) {
    return res.status(422).json({ error: 'Idempotency-Key reused with a different body' });
  }
  return res.status(stored.status_code || 201).json(stored.response_body);
}

// A concurrent request with the same Idempotency-Key may still be finishing.
// Give it a short grace period before declaring a conflict.
async function waitForIdempotencyRecord(key) {
  for (let i = 0; i < 20; i += 1) {
    const stored = await IdempotencyKey.findOne({ key }).lean();
    if (stored) return stored;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /bookings/:id - Level 1
// ---------------------------------------------------------------------------
const getBooking = async (req, res) => {
  try {
    const booking = await Booking.findOne({ id: req.params.id }).lean();
    if (!booking) {
      return res.status(404).json({ error: 'no booking with that id' });
    }
    return res.status(200).json(serializeBooking(booking));
  } catch (err) {
    console.error('getBooking error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
};

// ---------------------------------------------------------------------------
// DELETE /bookings/:id - Level 3
// ---------------------------------------------------------------------------
const cancelBooking = async (req, res) => {
  try {
    // Atomic transition so two concurrent cancels cannot both succeed.
    const updated = await Booking.findOneAndUpdate(
      { id: req.params.id, status: 'confirmed' },
      { $set: { status: 'cancelled' } },
      { returnDocument: 'after' }
    ).lean();

    if (!updated) {
      const existing = await Booking.findOne({ id: req.params.id }).lean();
      if (!existing) {
        return res.status(404).json({ error: 'no booking with that id' });
      }
      return res.status(409).json({ error: 'already cancelled' });
    }

    // Free the slot so it can be booked again.
    await Slot.updateOne({ id: updated.slot_id }, { $set: { available: true } });

    return res.status(200).json(serializeBooking(updated));
  } catch (err) {
    console.error('cancelBooking error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
};

// ---------------------------------------------------------------------------
// POST /bookings - Levels 1-5
// ---------------------------------------------------------------------------
const bookSlot = async (req, res) => {
  try {
    const body = req.body || {};
    const { slot_id, name, email } = body;

    // ---- Level 4: idempotency is checked first, so a retry of an already
    // successful request does not consume the caller's rate-limit budget.
    const rawKey = req.headers['idempotency-key'];
    const idempotencyKey = typeof rawKey === 'string' ? rawKey.trim() : '';
    let bodyHash = null;

    if (idempotencyKey) {
      bodyHash = hashRequestBody(body);
      const existingKey = await IdempotencyKey.findOne({ key: idempotencyKey }).lean();
      if (existingKey) {
        return replayStoredResponse(existingKey, bodyHash, res);
      }
    }

    // ---- Level 2: email must exist before it can be used as a rate-limit key.
    const trimmedEmail = normalizeEmail(email);
    if (!trimmedEmail) {
      return res.status(400).json({ error: 'email is required' });
    }

    // ---- Level 5: every attempt for this email counts, including failures.
    const rateCheck = await checkAndRecordRateLimit(trimmedEmail);
    if (rateCheck.limited) {
      res.set('Retry-After', String(rateCheck.retryAfter));
      return res.status(429).json({ error: 'too many attempts for this email' });
    }

    // ---- Level 2: remaining required fields.
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      return res.status(400).json({ error: 'name is required' });
    }

    const trimmedSlotId = typeof slot_id === 'string' ? slot_id.trim() : '';
    if (!trimmedSlotId) {
      return res.status(400).json({ error: 'slot_id is required' });
    }

    // ---- Level 2: email format.
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return res.status(400).json({ error: 'invalid email format' });
    }

    // ---- Level 2: slot must exist and must not have started.
    const slot = await Slot.findOne({ id: trimmedSlotId }).lean();
    if (!slot) {
      return res.status(404).json({ error: 'slot not found' });
    }

    const slotStart = new Date(slot.start).getTime();
    if (Number.isNaN(slotStart) || slotStart <= Date.now()) {
      return res.status(400).json({ error: 'slot has already started' });
    }

    // ---- Level 3: fast path check; the unique index is the real guarantee.
    const alreadyBooked = await Booking.exists({
      slot_id: trimmedSlotId,
      status: 'confirmed',
    });
    if (alreadyBooked) {
      return res.status(409).json({ error: 'slot already booked' });
    }

    // ---- Level 1/3: create the confirmed booking. The partial unique index
    // on { slot_id } where status = "confirmed" makes this race-safe.
    let booking;
    try {
      booking = await Booking.create({
        id: 'b_' + crypto.randomBytes(12).toString('hex'),
        slot_id: trimmedSlotId,
        name: trimmedName,
        email: trimmedEmail,
        status: 'confirmed',
        created_at: new Date(),
      });
    } catch (createErr) {
      if (createErr && createErr.code === 11000) {
        // Another request won the race. If it was the same idempotent request,
        // return its stored response rather than a misleading 409.
        if (idempotencyKey) {
          const stored = await waitForIdempotencyRecord(idempotencyKey);
          if (stored) return replayStoredResponse(stored, bodyHash, res);
        }
        return res.status(409).json({ error: 'slot already booked' });
      }
      throw createErr;
    }

    await Slot.updateOne({ id: trimmedSlotId }, { $set: { available: false } });

    const bookingResponse = serializeBooking(booking);

    // ---- Level 4: persist the idempotent result.
    if (idempotencyKey) {
      try {
        await IdempotencyKey.create({
          key: idempotencyKey,
          body_hash: bodyHash,
          status_code: 201,
          response_body: bookingResponse,
        });
      } catch (idempErr) {
        if (idempErr && idempErr.code === 11000) {
          // A concurrent request stored the key first - replay it.
          const stored = await IdempotencyKey.findOne({ key: idempotencyKey }).lean();
          if (stored) return replayStoredResponse(stored, bodyHash, res);
        } else {
          console.error('Error storing idempotency key:', idempErr);
        }
      }
    }

    return res.status(201).json(bookingResponse);
  } catch (err) {
    console.error('bookSlot error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
};

// ---------------------------------------------------------------------------
// GET /bookings?email=&limit=&cursor= - Level 4
// ---------------------------------------------------------------------------
const getUserBookings = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'email query parameter is required' });
    }

    // limit: integer 1-50, default 10. Anything else is a 400.
    let limit = 10;
    if (req.query.limit !== undefined) {
      const limitStr = String(req.query.limit).trim();
      if (!/^\d+$/.test(limitStr)) {
        return res.status(400).json({ error: 'invalid limit' });
      }
      limit = Number.parseInt(limitStr, 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return res.status(400).json({ error: 'invalid limit' });
      }
    }

    const query = { email: normalizeEmail(email) };

    // Cursor pagination, oldest first.
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : '';
    if (cursor) {
      const cursorDoc = await Booking.findOne({ id: cursor }).lean();
      if (cursorDoc) {
        query.$or = [
          { created_at: { $gt: cursorDoc.created_at } },
          { created_at: cursorDoc.created_at, _id: { $gt: cursorDoc._id } },
        ];
      }
    }

    const bookings = await Booking.find(query)
      .sort({ created_at: 1, _id: 1 })
      .limit(limit + 1)
      .lean();

    const hasNext = bookings.length > limit;
    const page = hasNext ? bookings.slice(0, limit) : bookings;
    const nextCursor = hasNext ? page[page.length - 1].id : null;

    return res.status(200).json({
      bookings: page.map(serializeBooking),
      next_cursor: nextCursor,
    });
  } catch (err) {
    console.error('getUserBookings error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
};

// ---------------------------------------------------------------------------
// POST /reset - Level 1
// ---------------------------------------------------------------------------
const resetDatabase = async (req, res) => {
  try {
    const { slots } = req.body || {};
    if (!Array.isArray(slots)) {
      return res.status(400).json({ error: 'slots is required and must be an array' });
    }

    const seen = new Set();
    const slotDocs = [];

    for (const slot of slots) {
      if (!slot || typeof slot !== 'object') {
        return res.status(400).json({ error: 'invalid slot' });
      }

      const { id, provider, start, end } = slot;
      if (
        typeof id !== 'string' ||
        !id.trim() ||
        typeof provider !== 'string' ||
        !provider.trim() ||
        !start ||
        !end
      ) {
        return res.status(400).json({ error: 'invalid slot' });
      }

      if (seen.has(id.trim())) {
        return res.status(400).json({ error: 'duplicate slot id' });
      }
      seen.add(id.trim());

      const startDate = new Date(start);
      const endDate = new Date(end);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return res.status(400).json({ error: 'invalid slot dates' });
      }

      slotDocs.push({
        id: id.trim(),
        provider: provider.trim(),
        start: startDate,
        end: endDate,
        available: true,
      });
    }

    // Replace everything atomically enough for the assessment contract.
    await Booking.deleteMany({});
    await IdempotencyKey.deleteMany({});
    await Slot.deleteMany({});
    await clearRateLimits();

    if (slotDocs.length > 0) {
      await Slot.insertMany(slotDocs, { ordered: true });
    }

    return res.status(200).json({ done: true });
  } catch (err) {
    console.error('resetDatabase error:', err);
    return res.status(500).json({ error: 'internal server error' });
  }
};

module.exports = {
  getBooking,
  cancelBooking,
  bookSlot,
  getUserBookings,
  resetDatabase,
  clearRateLimits,
};
