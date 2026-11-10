'use strict';
// B6-M worker unit gate: mock DB, NEVER payment or a real database.
const assert=require('node:assert/strict');
const {ProcurementRecurringService}=require('../src/services/procurementRecurringService');
let passed=0;
const ok=(name,condition)=>{assert.ok(condition,name);passed++;console.log('PASS '+passed+' '+name)};
const cycles=[
  {id:1,contract_id:11,buyer_id:101,attempt_count:0,status:'SCHEDULED'},
  {id:2,contract_id:12,buyer_id:102,attempt_count:0,status:'SCHEDULED'},
  {id:3,contract_id:13,buyer_id:103,attempt_count:4,status:'SCHEDULED'}
];
const events=[];
const conn={
  async beginTransaction(){},async commit(){},async rollback(){},release(){},
  async query(sql,params=[]){
    if(sql.includes('FROM procurement_recurring_contracts WHERE id=? FOR UPDATE'))
      return [[{id:params[0]}]];
    if(sql.includes('FROM procurement_recurring_cycles WHERE id=? AND contract_id=? FOR UPDATE'))
      return [cycles.filter(x=>x.id===params[0]&&x.contract_id===params[1])];
    if(sql.includes('UPDATE procurement_recurring_cycles SET')){
      const row=cycles.find(x=>x.id===params[5]);
      row.attempt_count=params[0];row.failure_code=params[1];row.status=params[2];
      row.retry_after_utc=params[3]?null:'DEFERRED';
      return [{affectedRows:1}];
    }
    if(sql.includes('INSERT INTO procurement_recurring_cycle_events')){
      events.push(params);return [{insertId:events.length}];
    }
    throw Error('Unexpected worker SQL: '+sql);
  }
};
const db={
  async query(sql,params=[]){
    if(sql.includes('FROM procurement_recurring_cycles cy'))
      return [cycles.filter(x=>x.status==='SCHEDULED')];
    throw Error('Unexpected DB query: '+sql);
  },
  async getConnection(){return conn}
};
async function main(){
  const svc=new ProcurementRecurringService(db);
  svc.prepareDueCycle=async(_buyer,_contract,id)=>{
    if(id===1){cycles[0].status='AWAITING_BUYER_APPROVAL';
      return {request_id:123,status:'AWAITING_BUYER_APPROVAL',is_replay:false};}
    if(id===2){cycles[1].status='AWAITING_BUYER_APPROVAL';
      return {request_id:124,status:'AWAITING_BUYER_APPROVAL',is_replay:true};}
    const e=Error('Database temporarily unavailable');e.code='TEMPORARY_DB_FAILURE';throw e;
  };
  const result=await svc.runDueBatch({limit:20});
  ok('Three due cycles discovered',result.checked===3);
  ok('One fresh draft created',result.prepared===1);
  ok('Already processed cycle safely replayed',result.replayed===1);
  ok('Fifth failed attempt reaches terminal FAILED',result.failed===1&&cycles[2].status==='FAILED');
  ok('No order created',result.created_orders===0);
  ok('No payment created',result.created_payments===0);
  ok('One durable retry/terminal event recorded',events.length===1);
  await assert.rejects(()=>svc.runDueBatch({limit:101}),e=>e.code==='INVALID_WORKER_LIMIT');
  ok('Unbounded worker batch rejected',true);
  console.log('B6 RECURRING WORKER GATE: '+passed+'/'+passed+' PASS');
}
main().catch(e=>{console.error('B6 WORKER GATE FAIL',e);process.exitCode=1});
