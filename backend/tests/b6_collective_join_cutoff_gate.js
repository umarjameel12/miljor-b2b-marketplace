'use strict';
// B6-N worker: mock adapter, no DB mutations outside this test or payment.
const assert=require('node:assert/strict');
const {ProcurementCollectiveRecurringService}=require('../src/services/procurementCollectiveRecurringService');
const notifications=require('../src/services/procurementNotificationService');
let passed=0;
const ok=(name,result)=>{assert.ok(result,name);console.log('PASS '+(++passed)+' '+name)};
const state={
 group:{id:8,organizer_buyer_id:11,request_id:71,minimum_buyers:2,status:'FORMING',
   join_deadline:'2026-11-10 12:00:00'},
 cycle:{id:9,cohort_id:10,cycle_key:'2026-11-10',status:'INVITING',
   qualification_snapshot:JSON.stringify({products:[],payments_created:false})},
 request_status:'DRAFT',joined:1,notifications:[],queries:[],commits:0
};
const conn={
 async beginTransaction(){},async commit(){state.commits++},
 async rollback(){},release(){},
 async query(sql,args=[]){
  state.queries.push(sql);
  if(sql.startsWith('SELECT id,organizer_buyer_id,request_id,minimum_buyers,status,join_deadline FROM procurement_collective_groups'))
   return [[{...state.group}]];
  if(sql.includes('AS closed'))return [[{closed:1}]];
  if(sql.startsWith('SELECT id,cohort_id,cycle_key,status,qualification_snapshot FROM procurement_recurring_collective_cycles'))
   return [[{...state.cycle}]];
  if(sql.includes('COUNT(DISTINCT buyer_id)'))return [[{n:state.joined}]];
  if(sql.startsWith("UPDATE procurement_collective_groups")){
   state.group.status='FAILED';return [{affectedRows:1}];
  }
  if(sql.startsWith('UPDATE procurement_recurring_collective_cycles')){
   state.cycle.status='UNQUALIFIED';return [{affectedRows:1}];
  }
  if(sql.startsWith('UPDATE procurement_requests')){
   state.request_status='CANCELLED';return [{affectedRows:1}];
  }
  if(sql.startsWith('SELECT buyer_id FROM procurement_collective_participants'))
   return [[{buyer_id:11},{buyer_id:12}]];
  throw Error('Unexpected SQL '+sql);
 }
};
const database={
 async query(sql,args=[]){
  if(sql.includes('SELECT cy.id AS cycle_id')){
   return [state.group.status==='FORMING'&&state.joined<state.group.minimum_buyers
    ?[{cycle_id:9,group_id:8,request_id:71}]:[]];
  }
  throw Error('Unexpected source query '+sql);
 },
 async getConnection(){return conn}
};
async function main(){
 const original=notifications.enqueue;
 notifications.enqueue=async(_,entry)=>{state.notifications.push(entry);return {notification_id:1}};
 try{
  const svc=new ProcurementCollectiveRecurringService(database);
  const done=await svc.closeExpiredUnderMinimum({limit:20});
  ok('One under-minimum group scanned',done.checked===1);
  ok('Group failed at join cutoff',state.group.status==='FAILED');
  ok('Recurring cycle marked unqualified',state.cycle.status==='UNQUALIFIED');
  ok('Unpaid draft cancelled',state.request_status==='CANCELLED');
  ok('Every member receives own private notice',
   state.notifications.length===2&&state.notifications.every(x=>x.recipient_role==='BUYER'));
  ok('No payment, allocation or order created',
   done.orders_created===0&&done.payments_created===0);
  const replay=await svc.closeExpiredUnderMinimum({limit:20});
  ok('Closed group no longer selected',replay.checked===0&&replay.unqualified===0);
  state.group.status='FORMING';state.joined=2;
  const enough=await svc.closeExpiredUnderMinimum({limit:20});
  ok('Enough buyers are left for J bidding, not force-failed',
   enough.checked===0&&state.group.status==='FORMING');
  await assert.rejects(()=>svc.closeExpiredUnderMinimum({limit:101}),
   e=>e.code==='INVALID_WORKER_LIMIT');
  ok('Unsafe worker batch rejected',true);
  console.log('B6-N JOIN CUTOFF WORKER: '+passed+'/'+passed+' PASS');
 }finally{notifications.enqueue=original}
}
main().catch(e=>{console.error('B6-N JOIN CUTOFF GATE FAIL',e);process.exitCode=1});
