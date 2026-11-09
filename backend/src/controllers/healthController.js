// =============================================================================
// src/controllers/healthController.js
// MilJor Part 4E.8: Health, Liveness & Readiness Probes
// Enforces:
//   - Liveness probe: Process availability without external dependency coupling
//   - Readiness probe: Bounded SELECT 1 check against active MySQL connection pool
//   - Safe status codes (200 OK vs 503 Service Unavailable)
//   - No sensitive database credentials, hosts or internal topology exposed
//   - Backward compatibility for legacy /health consumers
// =============================================================================

const db = require('../config/db');

class HealthController {

  /**
   * GET /health
   * Legacy backward-compatible health check endpoint.
   */
  getHealth(req, res) {
    return res.status(200).json({
      success: true,
      message: 'MilJor Backend is running',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * GET /health/live
   * Kubernetes / Container Liveness probe. Confirms process is responsive.
   */
  getLiveness(req, res) {
    return res.status(200).json({
      status: 'UP',
      service: 'miljor-backend',
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * GET /health/ready
   * Kubernetes / Load Balancer Readiness probe. Confirms database connectivity.
   */
  async getReadiness(req, res) {
    const timeoutMs = 2000;
    let timeoutHandle;

    try {
      const queryPromise = db.query('/* readiness_probe */ SELECT 1 AS alive');
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const timeoutErr = new Error('Database ping timed out');
          timeoutErr.code = 'DB_TIMEOUT';
          reject(timeoutErr);
        }, timeoutMs);
      });

      await Promise.race([queryPromise, timeoutPromise]);
      clearTimeout(timeoutHandle);

      return res.status(200).json({
        status: 'READY',
        database: 'CONNECTED',
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      
      return res.status(503).json({
        status: 'NOT_READY',
        database: 'DISCONNECTED',
        timestamp: new Date().toISOString()
      });
    }
  }
}

module.exports = new HealthController();
