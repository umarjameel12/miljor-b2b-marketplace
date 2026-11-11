'use strict';
// B6-N opt-in recurring collective runner isolated adapter test: NO real DB.
const assert=require('node:assert/strict');
const {ProcurementCollectiveRecurringService}=require('../src/services/procurementCollectiveRecurringService');
let count=0;
const pass=(name,ok)=>{assert.ok(ok,name);console.log('PASS '+(++count)+': '+name)};
const due=[
 {cohort_id:1,organizer_buyer_id:11,organizer_cycle_id:101,cycle_key:'2026-11-16'},
 {cohort_id:2,organizer_buyer_id:22,organizer_cycle_id:202,cycle_key:'2026-11-16'},
 {cohort_id:3,organizer_buyer_id:33,organizer_cycle_id:303,cycle_key:'2026-11-16'}
];
const attempt={id:99,attempt_count:0,status:'RETRY'};
const tx={
 async beginTransaction(){},async commit(){},async rollback(){},release(){},
 async query(sql,args=[]){
  if(sql.includes('FROM procurement_recurring_collectives WHERE id=? FOR UPDATE'))
   return [[{id:args[0],status:'ACTIVE'}]];
  if(sql.includes('INSERT INTO procurement_recurring_collective_attempts'))
   return [{insertId:attempt.id}];
  if(sql.includes('FROM procurement_recurring_collective_attempts WHERE cohort_id=?'))
   return [[attempt]];
  if(sql.includes('UPDATE procurement_recurring_collective_attempts SET')){
   attempt.attempt_count=args[0];attempt.status=args[1];
   attempt.error_code=args[2];return [{affectedRows:1}];
  }
  throw Error('Unexpected SQL '+sql);
 }
};
const database={
 async query(sql){if(sql.includes('SELECT cohort.id AS cohort_id'))return [due];
  throw Error('Unexpected query '+sql);
 },async getConnection(){return tx}
};
async function main(){
 const service=new ProcurementCollectiveRecurringService(database);
 service.prepareCycle=async(_buyer,cohort)=>{
  if(cohort===1)return {status:'INVITING',is_replay:false};
  if(cohort===2)return {status:'UNQUALIFIED',is_replay:false};
  const e=Error('Temporary storage outage');e.code='DB_UNAVAILABLE';throw e;
 };
 const result=await service.runDueCollectiveBatch({limit:20});
 pass('All three eligible due cohorts discovered',result.checked===3);
 pass('One private invitation cycle prepared',result.prepared===1);
 pass('Unqualified cohort produced no order',result.unqualified===1);
 pass('Transient failure persisted for retry',result.retried===1);
 pass('Retry counter persisted',attempt.attempt_count===1&&attempt.status==='RETRY');
 pass('No orders or payments generated',result.orders_created===0&&result.payments_created===0);
 assert.equal(result.outcomes.filter(x=>x.status==='INVITING').length,1);
 pass('Only one successful invitation cycle',true);
 await assert.rejects(()=>service.runDueCollectiveBatch({limit:101}),e=>e.code==='INVALID_WORKER_LIMIT');
 pass('Unbounded worker request rejected',true);
 console.log('B6-N WORKER: '+count+'/'+count+' PASS');
}
main().catch(e=>{console.error('B6-N WORKER FAIL',e);process.exitCode=1});
