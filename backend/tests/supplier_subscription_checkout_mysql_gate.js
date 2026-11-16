'use strict';
/* Real MySQL 8 acceptance using disposable miljor_test_db, synthetic tracker only.
 * Never contacts Safepay, executes money movement, or touches protected DBs. */
process.env.NODE_ENV='test';
const assert=require('node:assert/strict');
const db=require('../src/config/db');
const {SupplierSubscriptionCheckoutService}=require('../src/services/supplierSubscriptionCheckoutService');

async function main() {
  const watchdog=setTimeout(()=>{
    console.error('SUBSCRIPTION_MYSQL_TIMEOUT: previous progress marker identifies blocked stage');
    process.exit(2);
  },90000);
  watchdog.unref();
  const marker=label=>console.log('SUBSCRIPTION_MYSQL_STAGE: '+label);
  if (process.env.DB_NAME!=='miljor_test_db' || process.env.TEST_DB_NAME!=='miljor_test_db' ||
      process.env.ALLOW_EXTERNAL_MONEY_MOVEMENT!=='false' || process.env.SAFEPAY_ENV!=='sandbox') {
    throw new Error('TEST_DB_AND_SANDBOX_GUARD_REQUIRED');
  }
  const now=Date.now();
  let supplierId;
  let paidId;
  const token='track_subscription_ci_'+now;
  let amount='3500.00';
  let state='TRACKER_ENDED';
  let transactionStatus='SUCCESS';
  const fakeProvider={
    createTracker: async ({amount:a,currency})=>{assert.equal(a,3500);assert.equal(currency,'PKR');return {trackerToken:token};},
    constructCheckoutUrl:()=> 'https://sandbox.api.getsafepay.com/checkout/pay?beacon='+token,
    fetchTracker:async key=>({data:{token:key,state,currency:'PKR',amount,transaction:{id:'synthetic_ci',status:transactionStatus}}})
  };
  const svc=new SupplierSubscriptionCheckoutService(db,fakeProvider);
  const email=`supplier_checkout_${now}@miljor.test`;
  try {
    const [u]=await db.query(
      "INSERT INTO users (full_name,email,phone,password_hash,role,verification_status,buyer_trust_status) VALUES (?,?,?,'testhash','SUPPLIER','VERIFIED','CONTACT_VERIFIED')",
      [`Supplier checkout ${now}`,email,'+92303'+String(now).slice(-7)]);
    supplierId=u.insertId;
    await db.query(
      "INSERT INTO supplier_profiles (supplier_id,business_type,verification_status,subscription_plan,subscription_status,max_active_listings) VALUES (?,'WHOLESALER','VERIFIED','STARTER','STARTER_ACTIVE',4)",
      [supplierId]);
    const actor={id:supplierId,role:'SUPPLIER'};
    marker('START_PROVIDER_SESSION');
    const started=await svc.start({actor,planCode:'GROWTH',idempotencyKey:'subscription-ci-123456789'});
    assert.equal(started.attempt.status,'INITIATED');
    const replay=await svc.start({actor,planCode:'GROWTH',idempotencyKey:'subscription-ci-123456789'});
    assert.equal(replay.replay,true);
    const [before]=await db.query('SELECT subscription_plan FROM supplier_profiles WHERE supplier_id=?',[supplierId]);
    assert.equal(before[0].subscription_plan,'STARTER');
    amount='3500.01';
    await assert.rejects(()=>svc.reconcile({actor,attemptId:started.attempt.id}),e=>e.code==='AMOUNT_MISMATCH');
    amount='3500.00';state='TRACKER_PENDING';
    assert.equal((await svc.reconcile({actor,attemptId:started.attempt.id})).reconciled,false);
    state='TRACKER_ENDED';
    transactionStatus='FAILED';
    assert.equal((await svc.reconcile({actor,attemptId:started.attempt.id})).reconciled,false);
    transactionStatus='UNKNOWN';
    assert.equal((await svc.reconcile({actor,attemptId:started.attempt.id})).reconciled,false);
    transactionStatus='';
    assert.equal((await svc.reconcile({actor,attemptId:started.attempt.id})).reconciled,false);
    const [stillStarter]=await db.query(
      'SELECT subscription_plan FROM supplier_profiles WHERE supplier_id=?',[supplierId]);
    assert.equal(stillStarter[0].subscription_plan,'STARTER');
    transactionStatus='SUCCESS';
    marker('VERIFY_POSITIVE_PROVIDER_TRANSACTION');
    const paid=await svc.reconcile({actor,attemptId:started.attempt.id});
    assert.equal(paid.reconciled,true);
    const [after]=await db.query('SELECT subscription_plan,subscription_status,max_active_listings FROM supplier_profiles WHERE supplier_id=?',[supplierId]);
    assert.equal(after[0].subscription_plan,'GROWTH');
    assert.equal(after[0].subscription_status,'ACTIVE');
    assert.equal(after[0].max_active_listings,13);
    const [subs]=await db.query(
      "SELECT id,auto_renew,billing_cycle,status,current_period_end FROM supplier_subscriptions WHERE supplier_id=? AND plan_code='GROWTH'",
      [supplierId]);
    assert.equal(subs.length,1);
    paidId=subs[0].id;
    assert.equal(subs[0].auto_renew,0);
    assert.equal(subs[0].billing_cycle,'MONTHLY');
    assert.equal(subs[0].status,'ACTIVE');
    const [activatedNotices]=await db.query(
      "SELECT id,recipient_id,recipient_role,event_type FROM procurement_notifications WHERE recipient_id=? AND event_type='SUBSCRIPTION_ACTIVATED'",
      [supplierId]);
    assert.equal(activatedNotices.length,1,'Activation requires exactly one supplier-owned notification');
    assert.equal(activatedNotices[0].recipient_role,'SUPPLIER');
    assert.ok(subs[0].current_period_end);
    assert.equal((await svc.reconcile({actor,attemptId:started.attempt.id})).replay,true);
    const [count]=await db.query(
      "SELECT COUNT(*) AS n FROM supplier_subscriptions WHERE supplier_id=? AND plan_code='GROWTH'",[supplierId]);
    assert.equal(count[0].n,1,'reconciliation must be exactly once');
    // Non-renewing paid periods must revert to STARTER at expiry with no charge.
    await db.query("UPDATE supplier_subscriptions SET current_period_end=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE id=?",[paidId]);
    marker('PROCESS_PERIOD_END');
    const expiry=require('../src/services/subscriptionEntitlementService');
    assert.equal((await expiry.processScheduledStarterChanges(20)).processed,1);
    assert.equal((await expiry.processScheduledStarterChanges(20)).processed,0);
    const [final]=await db.query('SELECT subscription_plan FROM supplier_profiles WHERE supplier_id=?',[supplierId]);
    assert.equal(final[0].subscription_plan,'STARTER');
    marker('PASS_ALL_ASSERTIONS');
    console.log('SUPPLIER_SUBSCRIPTION_MYSQL_PASS: real transactions, price proof, exactly-once activation and period expiry');
  } finally {
    marker('CLEANUP_DISPOSABLE_FIXTURE');
    if(supplierId){
      await db.query('DELETE FROM procurement_notifications WHERE recipient_id=?',[supplierId]);
      await db.query('DELETE FROM platform_notifications WHERE user_id=?',[supplierId]);
      await db.query('DELETE FROM supplier_subscription_checkout_attempts WHERE supplier_id=?',[supplierId]);
      await db.query('DELETE FROM supplier_subscriptions WHERE supplier_id=?',[supplierId]);
      await db.query('DELETE FROM system_audit_logs WHERE actor_id=? AND entity_name IN (?,?)',
        [supplierId,'supplier_subscriptions','supplier_profiles']);
      await db.query('DELETE FROM supplier_profiles WHERE supplier_id=?',[supplierId]);
      await db.query('DELETE FROM users WHERE id=?',[supplierId]);
    }
    if (db.end) await db.end();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
