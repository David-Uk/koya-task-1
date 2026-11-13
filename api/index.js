// Vercel serverless entry point. The Express app is exported as the handler.
const { app } = require('../server/app');

module.exports = app;
