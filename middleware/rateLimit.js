const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per IP per window
  message: { error: 'Too many order attempts. Please try again later.' },
});

module.exports = limiter;