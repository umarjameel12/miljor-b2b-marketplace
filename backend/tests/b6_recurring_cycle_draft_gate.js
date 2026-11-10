'use strict';
// B6-M due-cycle -> unpaid procurement draft. Only miljor_test_db fixtures.
process.env.NODE_ENV='test';process.env.TEST_DB_NAME='miljor_test_db';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const db=require('../src/config/db');
const requests=require('../src/services/procurementRequestService');
const recurring=require('../src/services/procurementRecurringService');
let templateId=null,generatedId=null,contractId=null,count=0;
const pass=(label,ok)=>{assert.ok(ok,label);console.log('PASS '+(++count)+': '+label)};
const deny=async(fn,code)=>assert.rejects(fn,e=>e.code===code);
async function main(){
 const [[identity]]=await db.query('SELECT DATABASE() AS db_name');
 assert.equal(identity.db_name,'miljor_test_db','Protected DB execution refused');
 pass('Isolated test database',true);
 const [columns]=await db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='procurement_recurring_cycles' AND COLUMN_NAME='generated_request_id'");
 assert.equal(columns.length,1,'Migration 045 is missing');
 pass('Recurring generated request migration applied',true);
 const [[ordersBefore]]=await db.query('SELECT COUNT(*) AS n FROM orders');
 const [[paymentsBefore]]=await db.query('SELECT COUNT(*) AS n FROM payments');
 const [buyers]=await db.query("SELECT id FROM users WHERE role='BUYER' AND is_verified=1 AND verification_status='VERIFIED' AND buyer_trust_status<>'SUSPENDED' LIMIT 2");
 const [families]=await db.query("SELECT f.id FROM catalog_product_families f JOIN catalog_categories cat ON cat.id=f.category_id AND cat.is_active=1 AND cat.approval_status='APPROVED' WHERE f.is_active=1 AND f.approval_status='APPROVED' AND JSON_CONTAINS(f.allowed_purchasing_units, JSON_QUOTE('bag')) ORDER BY f.id LIMIT 1");
 if(!buyers.length||!families.length)throw Error('BLOCKED: verified buyer/family fixtures missing');
 const tag=crypto.randomUUID();
 const buyer=buyers[0].id;
 const template=await requests.createDraft(buyer,{
  ownership:'SINGLE_BUYER',frequency:'WEEKLY',
  delivery_area:'Johar Town, Lahore',
  items:[{family_id:families[0].id,quantity:'1',unit:'bag',requirements:'Monthly-safe requested grade'}]
 },'b6m-template-'+tag);
 templateId=template.request.id;
 const schedule=await recurring.createDraft(buyer,templateId,{
  cadence:'WEEKLY',weekday_number:1,local_run_time:'09:00',
  timezone_name:'Asia/Karachi',starts_on:new Date(Date.now()+86400000).toISOString().slice(0,10),
  payment_policy:'EXPLICIT_PER_CYCLE',pricing_policy:'REQUOTE_EACH_CYCLE'
 },'b6m-contract-'+tag);
 contractId=schedule.contract.id;
 await recurring.changeStatus(buyer,contractId,'ACTIVATE',1,true);
 const first=await recurring.scheduleUpcomingForBuyer(buyer,contractId,{limit:2});
 pass('Scheduled two recurring proposals without payment',
  first.cycles.length===2&&first.created_payments===0&&first.generated_orders===0);
 const repeat=await recurring.scheduleUpcomingForBuyer(buyer,contractId,{limit:2});
 pass('Unique cycles survive schedule retries',
  JSON.stringify(first.cycles.map(x=>x.cycle_id))===JSON.stringify(repeat.cycles.map(x=>x.cycle_id)));
 const cycleId=first.cycles[0].cycle_id;
 await deny(()=>recurring.prepareDueCycle(buyer,contractId,cycleId),'CYCLE_NOT_DUE');
 pass('Buyer cannot prepare future cycle early',true);
 // Fast-forward ONLY a test-owned future cycle; never alter a paid/commercial record.
 await db.query('UPDATE procurement_recurring_cycles SET due_at_utc=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=? AND contract_id=?',[cycleId,contractId]);
 const prepared=await recurring.prepareDueCycle(buyer,contractId,cycleId);
 generatedId=prepared.request_id;
 pass('Due cycle generates a separate editable buyer draft',
  prepared.status==='AWAITING_BUYER_APPROVAL'&&generatedId>0);
 const [made]=await db.query('SELECT status,ownership,frequency,buyer_id FROM procurement_requests WHERE id=?',[generatedId]);
 pass('Generated draft is one-time, individually owned, not published',
  made[0].status==='DRAFT'&&made[0].ownership==='SINGLE_BUYER'&&
  made[0].frequency==='ONE_TIME'&&Number(made[0].buyer_id)===Number(buyer));
 const [lines]=await db.query('SELECT family_id,quantity,unit FROM procurement_request_items WHERE request_id=?',[generatedId]);
 pass('Buyer items preserved in freshly generated cycle',lines.length===1&&String(lines[0].quantity).startsWith('1'));
 const replay=await recurring.prepareDueCycle(buyer,contractId,cycleId);
 pass('Repeat processing returns exact original generated draft',
  replay.is_replay===true&&Number(replay.request_id)===Number(generatedId));
 if(buyers.length>1){
  await deny(()=>recurring.prepareDueCycle(buyers[1].id,contractId,cycleId),'CONTRACT_NOT_FOUND');
  pass('Other buyer cannot claim recurring cycle',true);
 }
 const [[ordersAfter]]=await db.query('SELECT COUNT(*) AS n FROM orders');
 const [[paymentsAfter]]=await db.query('SELECT COUNT(*) AS n FROM payments');
 pass('No order and no payment created',
  String(ordersBefore.n)===String(ordersAfter.n)&&String(paymentsBefore.n)===String(paymentsAfter.n));
 console.log('B6 RECURRING DUE CYCLE GATE: '+count+'/'+count+' PASS');
}
main().catch(e=>{console.error('B6 RECURRING DUE GATE FAIL:',e.stack||e);process.exitCode=1})
.finally(async()=>{
 try{
  const [[identity]]=await db.query('SELECT DATABASE() AS db_name');
  assert.equal(identity.db_name,'miljor_test_db');
  if(contractId){
   await db.query('DELETE FROM procurement_recurring_cycle_events WHERE cycle_id IN (SELECT id FROM procurement_recurring_cycles WHERE contract_id=?)',[contractId]);
   await db.query('DELETE FROM procurement_recurring_cycles WHERE contract_id=?',[contractId]);
   await db.query('DELETE FROM procurement_recurring_contracts WHERE id=?',[contractId]);
  }
  for(const rid of [generatedId,templateId]){
   if(!rid)continue;
   await db.query('DELETE FROM procurement_request_mutations WHERE request_id=?',[rid]);
   await db.query('DELETE FROM procurement_request_items WHERE request_id=?',[rid]);
   await db.query('DELETE FROM procurement_requests WHERE id=?',[rid]);
  }
 }catch(e){console.error('Recurring cleanup failed:',e);process.exitCode=1}
 await db.end();
});
