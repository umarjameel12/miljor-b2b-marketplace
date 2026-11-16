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
  let expiryRunning=false;
  const expiryTask = cron.schedule('*/10 * * * *', async () => {
    if(expiryRunning)return;
    expiryRunning=true;
    console.log(`[Scheduler] Running pool expiry check at ${new Date().toISOString()}`);
    try {
      await poolClosureService.processExpiredPools();
      await require('./ucpRecoveryService').runFlashRecoveryBatch({limit:50});
      await require('./ucpRegularRecoveryService').runRegularRecoveryBatch({limit:50});
    } catch (err) {
      console.error('[Scheduler] Pool expiry job failed:', err.message);
    } finally { expiryRunning=false; }
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

  // Email remains opt-in until transport configuration and runtime acceptance.
  if(process.env.UCP_NOTIFICATION_EMAIL_WORKER_ENABLED==='true' && process.env.NOTIFICATION_WORKER_ENABLED!=='true'){
    let running=false;
    activeTasks.push(cron.schedule('* * * * *',async()=>{
      if(running)return;
      running=true;
      try{await require('./emailService').processOutboxBatch({limit:20});}
      catch(error){console.error('[Scheduler] Notification email delivery requires review');}
      finally{running=false;}
    }));
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

  if(process.env.NOTIFICATION_WORKER_ENABLED==='true'){
    let notificationRunning=false;
    const notificationTask=cron.schedule('* * * * *',async()=>{
      if(notificationRunning)return;
      notificationRunning=true;
      const step=async work=>{try{await work();}catch(error){console.error('[Scheduler] Notification step failed:',error.code||'NOTIFICATION_WORKER_FAILED');}};
      try{
        await step(()=>require('./notificationService').processPending({limit:20}));
        await step(()=>require('./notificationOperationsService').alertExhaustedEvents({limit:20}));
        if(process.env.NOTIFICATION_DIGEST_ENABLED==='true')await step(()=>require('./notificationService').processDigests({limit:20}));
        if(process.env.NOTIFICATION_EMAIL_DELIVERY_ENABLED==='true'||process.env.UCP_NOTIFICATION_EMAIL_WORKER_ENABLED==='true'){
          await step(()=>require('./emailService').processOutboxBatch({limit:20}));
          await step(()=>require('./notificationOperationsService').alertExhaustedEmails({limit:20}));
        }
      }catch(error){console.error('[Scheduler] Notification worker failed:',error.code||'NOTIFICATION_WORKER_FAILED');}
      finally{notificationRunning=false;}
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
