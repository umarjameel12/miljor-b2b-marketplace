'use strict';
// Focused, DB-free cancellation contract test. Does not touch miljor_db.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '../src/services/subscriptionEntitlementService.js');
const source = fs.readFileSync(file, 'utf8');

async function main() {
  const profile = { supplier_id: 7, subscription_plan: 'BUSINESS' };
  let period = { id: 11, plan_code: 'BUSINESS', status: 'ACTIVE',
    pending_plan_code: null, current_period_end: new Date(Date.now() + 86400000) };
  let created = 0, audits = 0;
  const query = async (sql) => {
    if (sql.includes('SELECT supplier_id, subscription_plan FROM supplier_profiles'))
      return [[{ ...profile }]];
    if (sql.includes('SELECT id, plan_code, status, current_period_end, pending_plan_code'))
      return [[{ ...period }]];
    if (sql.includes('SELECT id, plan_code, current_period_end, pending_plan_code, status'))
      return [[{ ...period }]];
    if (sql.includes('SELECT supplier_id FROM supplier_subscriptions WHERE pending_plan_code'))
      return [[{ supplier_id: 7 }]];
    if (sql.includes('UPDATE supplier_subscriptions SET pending_plan_code = \'STARTER\'')) {
      period.pending_plan_code = 'STARTER'; return [{}];
    }
    if (sql.includes('UPDATE supplier_subscriptions SET pending_plan_code = NULL')) {
      period.pending_plan_code = null; period.status = 'CANCELLED'; return [{}];
    }
    if (sql.includes('UPDATE supplier_profiles SET subscription_plan')) {
      profile.subscription_plan = 'STARTER'; return [{}];
    }
    if (sql.includes('INSERT INTO supplier_subscriptions')) {
      created++;
      period = { id: 12, plan_code: 'STARTER', status: 'STARTER_ACTIVE',
        pending_plan_code: null, current_period_end: null };
      return [{}];
    }
    if (sql.includes('INSERT INTO system_audit_logs')) { audits++; return [{}]; }
    throw new Error('Unexpected SQL contract: ' + sql.slice(0, 100));
  };
  const connection = {query, beginTransaction:async()=>{}, commit:async()=>{},
    rollback:async()=>{}, release:()=>{} };
  const db = {query, getConnection: async()=>connection};
  const moduleStub = { exports: {} };
  new Function('require', 'module', 'exports', source)(
    (name)=>{ if(name==='../config/db') return db; throw new Error('Unexpected dependency'); },
    moduleStub, moduleStub.exports
  );
  const service = moduleStub.exports;
  await assert.rejects(
    ()=>service.scheduleStarterAtPeriodEnd(7, {id: 99, role: 'SUPPLIER'}),
    (error)=>error.code==='FORBIDDEN'
  );
  assert.equal(period.pending_plan_code, null);
  const scheduled = await service.scheduleStarterAtPeriodEnd(7, {id:7, role:'SUPPLIER'});
  assert.equal(scheduled.pending_plan_code, 'STARTER');
  assert.equal(profile.subscription_plan, 'BUSINESS', 'Paid access must remain until period end');
  const replay = await service.scheduleStarterAtPeriodEnd(7, {id:7, role:'SUPPLIER'});
  assert.equal(replay.already_scheduled, true);
  assert.equal(audits, 1, 'Duplicate cancellation must not create duplicate audit entries');
  period.current_period_end = new Date(Date.now()-1000);
  const applied = await service.processScheduledStarterChanges();
  assert.equal(applied.processed, 1);
  assert.equal(profile.subscription_plan, 'STARTER');
  assert.equal(created, 1);
  const secondRun = await service.processScheduledStarterChanges();
  assert.equal(secondRun.processed, 0);
  assert.equal(created, 1, 'Worker replay must never double-activate Starter');
  console.log('SUBSCRIPTION_PERIOD_END_CONTRACT_PASS: ownership, scheduled access, replay, period-end, idempotency');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
