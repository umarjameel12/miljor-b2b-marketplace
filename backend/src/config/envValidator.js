// =============================================================================
// src/config/envValidator.js
// MilJor Part 4E.8: Production Configuration Safety & Environment Validator
// Enforces:
//   - Strong JWT secrets (rejects placeholders/defaults in production)
//   - Prohibits blank database passwords in production
//   - Prohibits wildcard or missing CORS in production
//   - Fails fast on startup if critical production requirements are violated
// =============================================================================

const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'secret',
  'jwt_secret',
  'changeme',
  'password',
  '123456',
  'YOUR_STRONG_RANDOM_JWT_SECRET_HERE_MIN_32_CHARS',
  'YOUR_STRONG_RANDOM_JWT_SECRET_HERE',
  'development_secret_key_miljor_b2b_lahore_2026',
  'miljor_test_secret_key_2026',
  'miljor_secret',
  'test_secret'
]);

/**
 * Validates environment configuration against security and operational policies.
 * 
 * @param {Object} [env=process.env]
 * @returns {{ isValid: boolean, errors: string[], warnings: string[] }}
 */
function validateEnvironment(env = process.env) {
  const errors = [];
  const warnings = [];
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  // 1. JWT Secret Validation
  const jwtSecret = env.JWT_SECRET || '';
  if (!jwtSecret) {
    errors.push('JWT_SECRET is missing from environment.');
  } else if (isProduction) {
    if (jwtSecret.length < 32) {
      errors.push(`JWT_SECRET must be at least 32 characters long in production (current length: ${jwtSecret.length}).`);
    }
    if (KNOWN_PLACEHOLDER_SECRETS.has(jwtSecret.trim())) {
      errors.push('JWT_SECRET uses a known insecure placeholder/default value. Must be set to a cryptographically strong random secret.');
    }
  }

  // 2. Database Password & User in Production
  if (isProduction) {
    if (!env.DB_PASSWORD || env.DB_PASSWORD.trim() === '') {
      errors.push('DB_PASSWORD cannot be blank or unset in production environment.');
    }
    if (!env.DB_USER || env.DB_USER.toLowerCase() === 'root') {
      warnings.push('DB_USER is configured as root in production. A dedicated least-privilege application user (e.g. miljor_app) is strongly recommended.');
    }
    if (!env.DB_HOST || env.DB_HOST === 'localhost' || env.DB_HOST === '127.0.0.1') {
      warnings.push('DB_HOST is set to localhost in production. Ensure production database is on a managed, isolated private subnet.');
    }
  }

  // 3. CORS & Allowed Origins Validation
  if (isProduction) {
    const allowedOrigins = env.ALLOWED_ORIGINS || '';
    if (!allowedOrigins.trim()) {
      errors.push('ALLOWED_ORIGINS must be explicitly configured in production (cannot be empty).');
    } else {
      const origins = allowedOrigins.split(',').map(o => o.trim());
      if (origins.includes('*')) {
        errors.push('ALLOWED_ORIGINS cannot contain wildcard (*) in production environment.');
      }
    }
  }

  // 4. Safepay Sandbox vs Production Enclosure
  const safepayEnv = env.SAFEPAY_ENV || 'sandbox';
  if (safepayEnv === 'production') {
    // Under Part 4E.8, live money movement remains disabled
    if (env.ALLOW_EXTERNAL_MONEY_MOVEMENT !== 'true') {
      warnings.push('SAFEPAY_ENV is set to production, but external money movement is disabled. Safe sandbox or mock adapters should be used until commercial approval.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Asserts production readiness and throws a detailed error if validation fails.
 * 
 * @param {Object} [env=process.env]
 * @throws {Error}
 */
function assertProductionReadiness(env = process.env) {
  const result = validateEnvironment(env);
  if (!result.isValid) {
    const message = `[FATAL CONFIGURATION ERROR] Environment validation failed with ${result.errors.length} error(s):\n  - ${result.errors.join('\n  - ')}`;
    const err = new Error(message);
    err.code = 'INVALID_CONFIGURATION';
    err.errors = result.errors;
    throw err;
  }
  return true;
}

module.exports = {
  validateEnvironment,
  assertProductionReadiness,
  KNOWN_PLACEHOLDER_SECRETS
};
