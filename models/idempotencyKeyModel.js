const mongoose = require('mongoose');

const idempotencyKeySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  body_hash: { type: String, required: true },
  status_code: { type: Number, default: 201 },
  response_body: { type: mongoose.Schema.Types.Mixed, required: true },
  created_at: { type: Date, default: Date.now, expires: 86400 },
}, { versionKey: false });

module.exports = mongoose.model('IdempotencyKey', idempotencyKeySchema);
