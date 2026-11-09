// =============================================================================
// src/middlewares/requestLogger.js
// MilJor Part 4E.8: Structured Logging, Correlation IDs & Sensitive Data Redaction
// Enforces:
//   - Request correlation ID (propagates or generates sanitized X-Request-ID)
//   - ISO UTC timestamping and millisecond duration tracking
//   - Sensitive field redaction (passwords, tokens, Safepay secrets, full IBANs)
//   - Header injection prevention (sanitizes incoming request IDs)
// =============================================================================

const crypto = require('crypto');

const SENSITIVE_KEY_REGEX = /^(authorization|cookie|set-cookie|password|token|secret|jwt|apikey|api_key|x-sfpy-signature|x-safepay-signature|beneficiary_iban|iban|account_number|card_number|cvv|security_code)$/i;

/**
 * Deeply redacts sensitive keys from plain objects and arrays.
 * Returns a clean copy with sensitive fields replaced with '[REDACTED]'.
 *
 * @param {any} target
 * @param {number} [depth=0]
 * @returns {any}
 */
function redactSensitiveData(target, depth = 0) {
  if (depth > 8 || target === null || target === undefined) {
    return target;
  }

  if (typeof target === 'string') {
    // Check if string looks like a JWT or Bearer token
    if (target.startsWith('Bearer ') || target.split('.').length === 3 && target.length > 50) {
      return '[REDACTED_TOKEN]';
    }
    return target;
  }

  if (Array.isArray(target)) {
    return target.map(item => redactSensitiveData(item, depth + 1));
  }

  if (typeof target === 'object') {
    const redacted = {};
    for (const [key, value] of Object.entries(target)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        if (typeof value === 'string' && key.toLowerCase().includes('iban') && value.length >= 10) {
          // Mask IBAN partially (e.g. PK36...1234)
          redacted[key] = `${value.slice(0, 4)}...${value.slice(-4)} [MASKED]`;
        } else {
          redacted[key] = '[REDACTED]';
        }
      } else if (typeof value === 'object' && value !== null) {
        redacted[key] = redactSensitiveData(value, depth + 1);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  return target;
}

/**
 * Sanitizes an incoming request ID against header/log injection.
 * 
 * @param {string} rawId
 * @returns {string|null}
 */
function sanitizeRequestId(rawId) {
  if (!rawId || typeof rawId !== 'string') return null;
  const trimmed = rawId.trim();
  // Allow only alphanumeric, hyphens, and underscores, up to 64 chars
  if (/^[a-zA-Z0-9_\-]{8,64}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Request logging and correlation middleware.
 */
function requestLogger(req, res, next) {
  const incomingId = sanitizeRequestId(req.headers['x-request-id'] || req.headers['x-correlation-id']);
  const correlationId = incomingId || `req_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  
  req.id = correlationId;
  res.setHeader('X-Request-ID', correlationId);

  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const safePath = (req.originalUrl || req.url || '').split('?')[0];

    // Exclude noisy health polls from console in test/development if requested
    if (safePath === '/health' && process.env.NODE_ENV === 'test') {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      correlationId,
      method: req.method,
      path: safePath,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip || req.socket?.remoteAddress || 'unknown'
    };

    if (res.statusCode >= 500) {
      logEntry.level = 'ERROR';
      console.error(`[${logEntry.timestamp}] [${logEntry.correlationId}] ${logEntry.method} ${logEntry.path} -> ${logEntry.statusCode} (${logEntry.durationMs}ms)`);
    } else if (res.statusCode >= 400) {
      logEntry.level = 'WARN';
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[${logEntry.timestamp}] [${logEntry.correlationId}] ${logEntry.method} ${logEntry.path} -> ${logEntry.statusCode} (${logEntry.durationMs}ms)`);
      }
    } else if (process.env.ENABLE_VERBOSE_LOGS === 'true') {
      logEntry.level = 'INFO';
      console.log(`[${logEntry.timestamp}] [${logEntry.correlationId}] ${logEntry.method} ${logEntry.path} -> ${logEntry.statusCode} (${logEntry.durationMs}ms)`);
    }
  });

  next();
}

module.exports = {
  requestLogger,
  redactSensitiveData,
  sanitizeRequestId
};
