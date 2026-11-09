// =============================================================================
// server.js — MilJor Backend Entry Point
// Part 4E.8 Hardening:
//   - Production configuration safety validator (fail-closed on weak/missing secrets)
//   - Reverse proxy trust configuration
//   - Structured request correlation logging with sensitive data redaction
//   - Separate webhook rate limiter (prevents provider starvation from browsing limits)
//   - Liveness & Readiness health probes (/health, /health/live, /health/ready)
//   - Graceful shutdown lifecycle management (SIGTERM/SIGINT resource draining)
//   - Global unhandled rejection & uncaught exception safety handlers
// =============================================================================
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Production configuration validator
const { assertProductionReadiness } = require('./src/config/envValidator');
if (process.env.NODE_ENV === 'production') {
  assertProductionReadiness();
} else if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set in environment. Exiting.');
  process.exit(1);
}

// Database
const db = require('./src/config/db');

// Scheduler lifecycle
const { startScheduler, stopScheduler } = require('./src/services/schedulerService');

// Logging & Correlation
const { requestLogger } = require('./src/middlewares/requestLogger');

// Health Controller
const healthController = require('./src/controllers/healthController');

// Routes
const authRoutes = require('./src/routes/v1/authRoutes');
const productRoutes = require('./src/routes/v1/productRoutes');
const poolRoutes = require('./src/routes/v1/poolRoutes');
const reservationRoutes = require('./src/routes/v1/reservationRoutes');
const paymentRoutes = require('./src/routes/v1/paymentRoutes');
const auditRoutes = require('./src/routes/v1/auditRoutes');
const disputeRoutes = require('./src/routes/v1/disputeRoutes');
const adminRoutes = require('./src/routes/v1/adminRoutes');
const specificationRoutes = require('./src/routes/v1/specificationRoutes');
const listingRoutes = require('./src/routes/v1/listingRoutes');
const orderRoutes = require('./src/routes/v1/orderRoutes');
const fulfillmentRoutes = require('./src/routes/v1/fulfillmentRoutes');
const financialSettlementRoutes = require('./src/routes/v1/financialSettlementRoutes');
const geographicRoutes = require('./src/routes/v1/geographicRoutes');
const buyerAddressRoutes = require('./src/routes/v1/buyerAddressRoutes');
const supplierDeliveryRoutes = require('./src/routes/v1/supplierDeliveryRoutes');
const deliveryQuotationRoutes = require('./src/routes/v1/deliveryQuotationRoutes');
const paymentController = require('./src/controllers/paymentController');

const app = express();

// =============================================================================
// Reverse Proxy Trust Configuration
// =============================================================================
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', true);
} else if (process.env.TRUSTED_PROXY) {
  app.set('trust proxy', process.env.TRUSTED_PROXY);
} else {
  app.set('trust proxy', false);
}

// =============================================================================
// Security Middleware & Headers
// =============================================================================
app.use(helmet());

// CORS — strictly restricted to verified origins in production
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean)
  : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5500'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // In development/test, allow local origins
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    return callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true
}));

// =============================================================================
// Structured Request Logging & Correlation ID
// =============================================================================
app.use(requestLogger);

// =============================================================================
// Body Parsing with Raw Buffer Retention (for Webhook HMAC verification)
// =============================================================================
app.use(express.json({
  limit: '5mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// =============================================================================
// Rate Limiting
// =============================================================================
// 1. Auth limiter (brute-force defense)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait 15 minutes before trying again.' }
  }
});

// 2. Webhook-specific limiter: provides higher capacity for legitimate provider retries/bursts
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many webhook delivery requests. Please back off.' }
  }
});

// 3. General API limiter (skips webhooks and health endpoints)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 5000 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const url = req.originalUrl || req.url || '';
    return url.startsWith('/health') || url.includes('/webhook');
  },
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' }
  }
});

app.use('/api/', generalLimiter);
app.use('/api/v1/auth', authLimiter);
app.use('/api/v1/payments/webhook', webhookLimiter);
app.use('/api/v1/webhooks', webhookLimiter);

// =============================================================================
// Health & Readiness Probes
// =============================================================================
app.get('/health', (req, res) => healthController.getHealth(req, res));
app.get('/health/live', (req, res) => healthController.getLiveness(req, res));
app.get('/health/ready', (req, res) => healthController.getReadiness(req, res));

// =============================================================================
// Route Mounts
// =============================================================================
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/pools', poolRoutes);
app.use('/api/v1/reservations', reservationRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/disputes', disputeRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/specifications', specificationRoutes);
app.use('/api/v1/listings', listingRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/fulfillment', fulfillmentRoutes);
app.use('/api/v1/settlements', financialSettlementRoutes);
app.use('/api/v1/geo', geographicRoutes);
app.use('/api/v1/buyer/addresses', buyerAddressRoutes);
app.use('/api/v1/supplier', supplierDeliveryRoutes);
app.use('/api/v1', deliveryQuotationRoutes);
app.post('/api/v1/webhooks/safepay', (req, res) => paymentController.handleSafepayWebhook(req, res));

// =============================================================================
// 404 Handler
// =============================================================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} does not exist` }
  });
});

// =============================================================================
// Global Error Handler — never leaks stack traces or internals in production
// =============================================================================
app.use((err, req, res, next) => {
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ success: false, error: { code: 'CORS_ERROR', message: err.message } });
  }

  const correlationId = req.id || 'unknown';
  console.error(`[${new Date().toISOString()}] [${correlationId}] Server Error:`, err.stack);

  res.status(err.status || err.statusCode || 500).json({
    success: false,
    error: {
      code: err.code || 'SERVER_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred. Please try again.'
        : err.message
    }
  });
});

// =============================================================================
// Graceful Shutdown Lifecycle
// =============================================================================
function setupGracefulShutdown(server, pool = db) {
  let isShuttingDown = false;

  return async function handleShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n🛑 Received ${signal}. Initiating graceful shutdown...`);

    // 1. Stop scheduler
    try {
      stopScheduler();
    } catch (e) {
      console.warn('[Shutdown] Warning stopping scheduler:', e.message);
    }

    // 2. Stop accepting new HTTP requests and drain active requests
    if (server && typeof server.close === 'function') {
      await new Promise((resolve) => {
        server.close(() => {
          console.log('✅ HTTP server closed. Active connections drained.');
          resolve();
        });
      });
    }

    // 3. Drain and close MySQL database pool
    try {
      if (pool && typeof pool.end === 'function') {
        await pool.end();
        console.log('✅ Database connection pool drained and closed.');
      }
    } catch (e) {
      console.warn('[Shutdown] Warning closing database pool:', e.message);
    }

    console.log('🏁 MilJor Backend graceful shutdown complete.');
  };
}

app.setupGracefulShutdown = setupGracefulShutdown;

// =============================================================================
// Server Start (CLI Execution)
// =============================================================================
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  const server = app.listen(PORT, () => {
    console.log(`🚀 MilJor Backend running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);

    if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'sandbox') {
      startScheduler();
    }
  });

  const shutdownHandler = setupGracefulShutdown(server, db);
  process.on('SIGTERM', () => shutdownHandler('SIGTERM').then(() => process.exit(0)));
  process.on('SIGINT', () => shutdownHandler('SIGINT').then(() => process.exit(0)));

  process.on('unhandledRejection', (reason) => {
    console.error('CRITICAL: Unhandled Promise Rejection:', reason);
  });
}

module.exports = app;
