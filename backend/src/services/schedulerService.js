// =============================================================================
// src/services/schedulerService.js
// BUG-14 FIX: Pool closure service scheduled via node-cron.
// Hardening: Supports clean stop/cancellation for graceful shutdown.
// =============================================================================
const cron = require('node-cron');
const poolClosureService = require('./poolClosureService');

let activeTasks = [];

function startScheduler() {
  if (activeTasks.length > 0) {
    console.log('[Scheduler] Scheduler already running, skipping duplicate initialization.');
    return;
  }

  console.log('⏰ MilJor Scheduler starting...');

  // ---------------------------------------------------------------------------
  // Every 10 minutes: Process expired pools & flash pools
  // ---------------------------------------------------------------------------
  const expiryTask = cron.schedule('*/10 * * * *', async () => {
    console.log(`[Scheduler] Running pool expiry check at ${new Date().toISOString()}`);
    try {
      await poolClosureService.processExpiredPools();
      await poolClosureService.processExpiredFlashPools();
    } catch (err) {
      console.error('[Scheduler] Pool expiry job failed:', err.message);
    }
  });
  activeTasks.push(expiryTask);

  // ---------------------------------------------------------------------------
  // Every hour: Clean old idempotency records (older than 24h)
  // ---------------------------------------------------------------------------
  const cleanupTask = cron.schedule('0 * * * *', async () => {
    try {
      await poolClosureService.cleanOldIdempotencyRecords();
    } catch (err) {
      console.error('[Scheduler] Idempotency cleanup failed:', err.message);
    }
  });
  activeTasks.push(cleanupTask);

  console.log('✅ Scheduler active: Pool expiry every 10 min | Cleanup every hour');
}

function stopScheduler() {
  if (activeTasks.length === 0) {
    return;
  }
  console.log('⏹️ Stopping MilJor Scheduler tasks...');
  for (const task of activeTasks) {
    try {
      task.stop();
    } catch (e) {
      console.warn('[Scheduler] Error stopping task:', e.message);
    }
  }
  activeTasks = [];
  console.log('✅ All scheduler tasks stopped.');
}

module.exports = { startScheduler, stopScheduler };
