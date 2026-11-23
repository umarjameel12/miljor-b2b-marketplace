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
      // Flash expiry must remain inside leased transactional UCP recovery.
      // A bulk status update would strand over-limit/failed recovery offers.
      await require('./procurementCollectiveCommitmentService').releaseExpiredBatch({limit:20});
    } catch (err) {
      console.error('[Scheduler] Pool expiry job failed:', err.message);
    } finally { expiryRunning=false; }
  });
  activeTasks.push(expiryTask);

  // Collective per-buyer stock leases expire independently of group quote deadlines.
  // Provider-started attempts are retained for reconciliation (never released on timeout).
  let collectiveHoldTickRunning = false;
  const collectiveHoldTask = cron.schedule('*/5 * * * *', async () => {
    if (collectiveHoldTickRunning) return;
    collectiveHoldTickRunning = true;
    try {
      const result = await require('./collectivePaymentHoldService').processExpiredBatch(100);
      if (result.checked) console.log('[Scheduler] Collective payment holds:', result);
    } catch (err) {
      console.error('[Scheduler] Collective payment hold expiry failed:', err.code || err.message);
    } finally {
      collectiveHoldTickRunning = false;
    }
  });
  activeTasks.push(collectiveHoldTask);

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

  // ---------------------------------------------------------------------------
  // Every 15 minutes: Supplier subscription period-end, grace, and expiry transitions
  // Never executes external charges; uses SKIP LOCKED for idempotency.
  // ---------------------------------------------------------------------------
  let subscriptionTickRunning = false;
  const subscriptionTask = cron.schedule('*/15 * * * *', async () => {
    if (subscriptionTickRunning) return;
    subscriptionTickRunning = true;
    try {
      await require('./supplierSubscriptionLifecycleService').processDueSubscriptionTransitions();
    } catch (err) {
      console.error('[Scheduler] Subscription lifecycle tick failed:', err.code || err.message);
    } finally {
      subscriptionTickRunning = false;
    }
  });
  activeTasks.push(subscriptionTask);

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
        await require('./procurementRecurringService').runReminderBatch({limit:20});
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
