const mongoose = require('mongoose');

// Level 5 rate limiting persisted in MongoDB so it works across serverless
// instances (Vercel) and multiple app replicas.
const rateLimitSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    attempts: { type: [Date], default: [] },
    updated_at: { type: Date, default: Date.now, expires: 3600 },
  },
  { versionKey: false }
);

module.exports = mongoose.model('RateLimit', rateLimitSchema);
