/**
 * In-Memory Sliding Window Rate Limiter for Authentication & Security Endpoints
 * Provides IP and identifier-based rate limiting with standard Retry-After headers.
 */

const rateLimits = new Map();

// Periodic cleanup of expired rate-limit windows (every 60s)
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimits.entries()) {
    if (now > record.resetTime) {
      rateLimits.delete(key);
    }
  }
}, 60 * 1000).unref();

function rateLimiter({ windowMs = 15 * 60 * 1000, max = 5, keyGenerator, keyPrefix = '', message }) {
  return (req, res, next) => {
    const rawKey = keyGenerator 
      ? keyGenerator(req) 
      : (req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown');
    
    if (!rawKey) return next();
    const key = keyPrefix ? `${keyPrefix}:${rawKey}` : rawKey;

    const now = Date.now();
    let record = rateLimits.get(key);

    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      rateLimits.set(key, record);
    } else {
      record.count++;
    }

    const remaining = Math.max(0, max - record.count);
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

    if (record.count > max) {
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        success: false,
        error: message || 'Too many requests. Please try again later.',
        retryAfter
      });
    }

    next();
  };
}

module.exports = {
  rateLimiter,
  rateLimits
};
