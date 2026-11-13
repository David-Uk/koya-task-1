const path = require('path');

// On Vercel the environment variables are injected by the platform. Locally we
// load .env relative to this file so the app works from any directory.
if (process.env.VERCEL !== '1') {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
}

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');

const app = express();

// ---------------------------------------------------------------------------
// Security / server hardening
// ---------------------------------------------------------------------------
app.disable('x-powered-by');
app.set('trust proxy', 1);

// CSP is disabled because the single-page frontend uses inline styles/scripts.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(bodyParser.json({ limit: '100kb' }));

// Reject malformed JSON with the same error envelope the spec uses.
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'invalid JSON format' });
  }
  return next(err);
});

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_ATLAS ||
  'mongodb://127.0.0.1:27017/clinic-booking';

let connectionPromise = null;

function connectToDatabase() {
  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
      .then(() => {
        console.log('Connected to MongoDB');
        return mongoose.connection;
      })
      .catch((err) => {
        // Allow a later request to retry after a failed cold start.
        connectionPromise = null;
        throw err;
      });
  }
  return connectionPromise;
}

const dbReady = connectToDatabase();
// Avoid an unhandled rejection when the initial connection fails; requests
// still receive a 503 from the middleware below.
dbReady.catch(() => {});

// Keep indexes in sync so the partial unique index used for Level 3 and the
// rate-limit index always exist, even on an older database.
mongoose.connection.once('open', async () => {
  try {
    const Booking = require('../models/bookingModel');
    const Slot = require('../models/slotModel');
    const RateLimit = require('../models/rateLimitModel');
    await Promise.all([
      Booking.syncIndexes(),
      Slot.syncIndexes(),
      RateLimit.syncIndexes(),
    ]);
    console.log('Indexes synchronized');
  } catch (err) {
    console.error('Index sync error:', err.message);
  }
});

// Wait for the database before touching API routes (important on cold starts).
app.use(async (req, res, next) => {
  try {
    await dbReady;
    return next();
  } catch (err) {
    console.error('Database unavailable:', err.message);
    return res.status(503).json({ error: 'database unavailable' });
  }
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const apiRoutes = require('../routes/apiRoutes');

// The spec documents the endpoints at the root (/slots, /bookings, ...).
// /api is kept as a convenience alias for direct callers and for Vercel's
// rewrite rules.
app.use('/', apiRoutes);
app.use('/api', apiRoutes);

// Static frontend (the spec-compliant booking page).
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// JSON 404 for anything that is not an API route or a static asset.
app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// Central error handler: never leak stack traces to clients.
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  if (res.headersSent) return next(err);
  return res.status(err.status || 500).json({ error: 'internal server error' });
});

// ---------------------------------------------------------------------------
// Server (skipped when running as a Vercel serverless function)
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 4000;
let server = null;

if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(
      `Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`
    );
    console.log(`Frontend available at http://localhost:${PORT}`);
  });
}

module.exports = { app, server };
