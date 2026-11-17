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

  // Paid subscriptions explicitly cancelled by suppliers return to STARTER at
  // the end of the verified paid period. No automatic charge or renewal occurs.
  let subscriptionTickRunning = false;
  const subscriptionTask = cron.schedule('*/5 * * * *', async () => {
    if (subscriptionTickRunning) return;
    subscriptionTickRunning = true;
    try {
      await require('./subscriptionEntitlementService').processScheduledStarterChanges(50);
    } catch (error) {
      console.error('[Scheduler] Subscription period-end transition failed:', error.code || error.message);
    } finally {
      subscriptionTickRunning = false;
    }
  });
  activeTasks.push(subscriptionTask);

  // Run bounded Flash expiry recovery only after migration 095 and rollout approval.
  // MySQL advisory lock serializes multiple app instances. No automatic payments.
  if (process.env.UCP_FLASH_RECOVERY_WORKER_ENABLED === 'true' &&
      process.env.UCP_FLASH_RECOVERY_RUNTIME_APPROVED === 'true') {
    let recoveryRunning=false;
    const recoveryTask=cron.schedule('*/5 * * * *',async()=>{
      if(recoveryRunning)return;
      recoveryRunning=true;
      try{
        const result=await require('./ucpRecoveryService').runFlashRecoveryBatch({limit:50});
        if(result.failed)console.error('[UCP recovery] Flash items require review',{failed:result.failed});
      }catch(error){
        console.error('[UCP recovery] Worker failed',{code:error.code||'RECOVERY_ERROR'});
      }finally{recoveryRunning=false;}
    });
    activeTasks.push(recoveryTask);
    console.log('[Scheduler] UCP Flash recovery enabled (no provider payments)');
  }

  // B6-M recurring procurement draft worker, opt-in only.
  // Does NOT create orders, trigger Safepay or authorize standing charges.
  // Locking and retry backoff are maintained in procurementRecurringService.
  if (process.env.B6_RECURRING_WORKER_ENABLED === 'true' &&
      process.env.B6_RECURRING_RUNTIME_APPROVED === 'true') {
    let recurringRunning = false;
    const recurringTask = cron.schedule('*/5 * * * *', async () => {
      if (recurringRunning) return;
      recurringRunning = true;
      try {
        const result = await require('./procurementRecurringService')
          .runDueBatch({limit:20});
        if (result.checked || result.failed) {
          console.log('[Scheduler] Recurring drafts:', {
            checked:result.checked,prepared:result.prepared,
            retried:result.retried,failed:result.failed
          });
        }
      } catch (err) {
        console.error('[Scheduler] Recurring draft generation failed:', err.code||err.message);
      } finally {
        recurringRunning = false;
      }
    });
    activeTasks.push(recurringTask);
    console.log('[Scheduler] B6 recurring draft worker enabled (no automatic payments)');
  }

  // Transactionally project inbox events, then optionally send leased emails.
  // Off by default until migration 092/093, test DB and transport rollout are approved.
  if(process.env.NOTIFICATION_WORKER_ENABLED==='true' &&
     process.env.NOTIFICATION_RUNTIME_APPROVED==='true'){
    let notificationRunning=false;
    const notificationTask=cron.schedule('* * * * *',async()=>{
      if(notificationRunning)return;
      notificationRunning=true;
      try{
        await require('./notificationService').processPending({limit:20});
        if(process.env.NOTIFICATION_EMAIL_DELIVERY_ENABLED==='true')
          await require('./emailService').processOutboxBatch({limit:20});
      }catch(error){
        console.error('[Scheduler] Notification worker requires review',{code:error.code||'NOTIFICATION_WORKER_FAILED'});
      }finally{notificationRunning=false;}
    });
    activeTasks.push(notificationTask);
  }
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
