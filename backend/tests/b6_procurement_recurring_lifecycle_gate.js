'use strict';
// B6-L/M recurring contract and scheduled-proposal gate; miljor_test_db ONLY.
process.env.NODE_ENV='test';process.env.TEST_DB_NAME='miljor_test_db';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const db=require('../src/config/db');
const requests=require('../src/services/procurementRequestService');
const recurring=require('../src/services/procurementRecurringService');
let requestId=null,contractId=null,n=0;
const check=(name,ok)=>{assert.ok(ok,name);console.log('PASS '+(++n)+': '+name)};
const fail=async(code,fn)=>assert.rejects(fn,e=>e.code===code);
async function main(){
 const [[identity]]=await db.query('SELECT DATABASE() AS db_name');
 assert.equal(identity.db_name,'miljor_test_db');
 check('Isolated test database',true);
 for(const t of ['procurement_recurring_contracts','procurement_recurring_cycles',
  'procurement_recurring_cycle_events']){
  const [rows]=await db.query(
   'SELECT ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[t]);
  assert.equal(rows.length,1,'Migration 042 missing '+t);assert.equal(rows[0].ENGINE,'InnoDB');
 }
 check('Migration 042 schema transactional',true);
 const [buyers]=await db.query(
  `SELECT id FROM users WHERE role='BUYER' AND is_verified=1
   AND verification_status='VERIFIED' AND buyer_trust_status<>'SUSPENDED' LIMIT 1`);
 if(!buyers.length)throw Error('BLOCKED: verified buyer fixture missing');
 const [families]=await db.query(
  `SELECT id,allowed_purchasing_units FROM catalog_product_families
   WHERE is_active=1 AND approval_status='APPROVED' ORDER BY id LIMIT 1`);
 if(!families.length)throw Error('BLOCKED: approved family fixture missing');
 const id=buyers[0].id,tag=crypto.randomUUID();
 const draft=await requests.createDraft(id,{
  ownership:'SINGLE_BUYER',frequency:'WEEKLY',delivery_area:'Lahore',
  items:[{family_id:families[0].id,quantity:'1',unit:'bag'}]
 },'b6rec-draft-'+tag);
 requestId=draft.request.id;
 check('Recurring one-product template stored as DRAFT',draft.request.frequency==='WEEKLY'&&draft.request.status==='DRAFT');
 const start=new Date(Date.now()+86400000).toISOString().slice(0,10);
 const schedule={cadence:'WEEKLY',weekday_number:1,local_run_time:'09:00',
  timezone_name:'Asia/Karachi',starts_on:start,
  payment_policy:'EXPLICIT_PER_CYCLE',pricing_policy:'REQUOTE_EACH_CYCLE'};
 const created=await recurring.createDraft(id,requestId,schedule,'b6rec-contract-'+tag);
 contractId=created.contract.id;
 check('Recurring contract starts unactivated',created.contract.status==='DRAFT');
 const replay=await recurring.createDraft(id,requestId,schedule,'b6rec-contract-'+tag);
 check('Contract key returns original immutable response',replay.is_replay===true&&
  Number(replay.contract.id)===Number(contractId));
 await fail('EXPLICIT_RECURRING_CONSENT_REQUIRED',()=>recurring.changeStatus(
  id,contractId,'ACTIVATE',1,false));
 check('Cannot activate without buyer consent',true);
 const active=await recurring.changeStatus(id,contractId,'ACTIVATE',1,true);
 check('Buyer activation raises version',active.status==='ACTIVE'&&Number(active.version_number)===2);
 const future=await recurring.previewUpcoming(id,contractId);
 check('Upcoming cycles are not automatic payments',
  future.upcoming.length>0&&future.payment_authorized===false);
 const first=await recurring.prepareUpcoming(contractId,{limit:2});
 check('Two scheduled proposals created with no charges',
  first.cycles.length===2&&first.generated_orders===0&&first.created_payments===0);
 const second=await recurring.prepareUpcoming(contractId,{limit:2});
 check('Repeated scheduler call uses same unique cycle keys',
  JSON.stringify(first.cycles.map(x=>x.cycle_id))===JSON.stringify(second.cycles.map(x=>x.cycle_id)));
 const skipped=await recurring.skipCycle(id,contractId,first.cycles[0].cycle_id);
 check('Buyer skips future cycle before cutoff',skipped.status==='SKIPPED');
 const skippedAgain=await recurring.skipCycle(id,contractId,first.cycles[0].cycle_id);
 check('Skip is idempotent',skippedAgain.is_replay===true);
 const paused=await recurring.changeStatus(id,contractId,'PAUSE',2,false);
 check('Buyer can pause',paused.status==='PAUSED');
 await fail('CONTRACT_NOT_ACTIVE',()=>recurring.prepareUpcoming(contractId,{limit:1}));
 check('Paused contract cannot prepare cycles',true);
 const resumed=await recurring.changeStatus(id,contractId,'RESUME',3,false);
 check('Buyer resumes with optimistic version',resumed.status==='ACTIVE');
 const cancelled=await recurring.changeStatus(id,contractId,'CANCEL',4,false);
 check('Cancellation stops future proposals only',cancelled.status==='CANCELLED');
 const [[paid]]=await db.query(
  "SELECT COUNT(*) AS n FROM procurement_recurring_cycles WHERE contract_id=? AND status='PAID'",[contractId]);
 check('No paid cycle manufactured',Number(paid.n)===0);
 console.log('B6 RECURRING LIFECYCLE: '+n+'/'+n+' PASS');
}
main().catch(e=>{console.error('B6 RECURRING LIFECYCLE FAIL:',e.stack||e);process.exitCode=1;})
.finally(async()=>{
 try{
  const [[identity]]=await db.query('SELECT DATABASE() AS db_name');
  assert.equal(identity.db_name,'miljor_test_db');
  if(contractId){
   await db.query(
    'DELETE FROM procurement_recurring_cycle_events WHERE cycle_id IN (SELECT id FROM procurement_recurring_cycles WHERE contract_id=?)',[contractId]);
   await db.query('DELETE FROM procurement_recurring_cycles WHERE contract_id=?',[contractId]);
   await db.query('DELETE FROM procurement_recurring_contracts WHERE id=?',[contractId]);
  }
  if(requestId){
   await db.query('DELETE FROM procurement_request_mutations WHERE request_id=?',[requestId]);
   await db.query('DELETE FROM procurement_request_items WHERE request_id=?',[requestId]);
   await db.query('DELETE FROM procurement_requests WHERE id=?',[requestId]);
  }
 }catch(e){console.error('Recurring test cleanup failed:',e);process.exitCode=1;}
 await db.end();
});
