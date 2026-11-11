'use strict';
// B6-N isolated adapter acceptance: no real MySQL or payment.
const assert=require('node:assert/strict');
const {ProcurementCollectiveService}=require('../src/services/procurementCollectiveService');
const notifications=require('../src/services/procurementNotificationService');
let passed=0;
const check=(name,condition)=>{assert.ok(condition,name);console.log('PASS '+(++passed)+' '+name)};
const state={buyer:11,group:8,linked:true,events:[],writes:0,participant:true};
const snapshot={private_join_mapping:[
 {buyer_id:11,planned_lines:[{request_item_id:201,quantity:'2.0000'}]},
 {buyer_id:12,planned_lines:[{request_item_id:202,quantity:'4.0000'}]}
]};
const conn={
 async beginTransaction(){},async commit(){},async rollback(){},release(){},
 async query(sql,args=[]){
  if(sql.includes('FROM procurement_collective_groups g'))return [[{
   id:8,request_id:100,organizer_buyer_id:31,status:'FORMING',
   request_status:'DRAFT',join_deadline:'2030-12-01 00:00:00'}]];
  if(sql.includes("FROM users WHERE id=? AND role='BUYER'"))return [[{id:state.buyer}]];
  if(sql.includes('FROM procurement_collective_participants WHERE group_id=? AND buyer_id=? FOR UPDATE'))
   return [state.participant?[{
    id:777,status:'INVITED',join_idempotency_key:null,
    join_request_hash:null,consent_snapshot:null
   }]:[]];
  if(sql.includes('AS join_open'))return [[{join_open:1}]];
  if(sql.includes('FROM procurement_request_items WHERE request_id=?'))
   return [[{id:201,family_id:4,unit:'bag',requirements:'Grade A',allow_substitutions:0},
    {id:202,family_id:4,unit:'bag',requirements:'Grade B',allow_substitutions:0}]];
  if(sql.includes('FROM procurement_recurring_collective_cycles WHERE group_id=?'))
   return [state.linked?[{status:'INVITING',qualification_snapshot:JSON.stringify(snapshot)}]:[]];
  if(sql.startsWith('INSERT INTO procurement_collective_participant_lines')){
   state.writes++;return [{insertId:state.writes}];
  }
  if(sql.includes('UPDATE procurement_collective_participants'))return [{affectedRows:1}];
  throw Error('Unexpected SQL '+sql);
 }
};
const db={
 async getConnection(){return conn},
 async query(sql,args){
  if(sql.includes('FROM procurement_collective_participants p'))return [[{
   participant_id:777,group_id:8,request_id:100,status:'INVITED',
   group_status:'FORMING'}]];
  if(sql.includes('FROM procurement_request_items WHERE request_id=?'))return [[
   {id:201,family_id:4,quantity:'2.0000',unit:'bag',
    requirements:'Buyer 11 03001234567 test@example.com'},
   {id:202,family_id:4,quantity:'4.0000',unit:'bag',requirements:'Buyer 12'}]];
  if(sql.includes('FROM procurement_recurring_collective_cycles WHERE group_id=?'))
   return [[{qualification_snapshot:JSON.stringify(snapshot)}]];
  throw Error('Unexpected DB SQL '+sql);
 }
};
async function main(){
 const old=notifications.enqueue;
 notifications.enqueue=async(_conn,event)=>{state.events.push(event);return {notification_id:1}};
 try{
  const service=new ProcurementCollectiveService(db);
  const expect=(code,work)=>assert.rejects(work,e=>e.code===code);
  await expect('RECURRING_CYCLE_QUANTITY_MISMATCH',()=>
   service.join(11,8,[{request_item_id:201,quantity:'3'}],'recurring-n-test-001'));
  check('Different recurring quantity rejected',state.writes===0);
  await expect('RECURRING_CYCLE_QUANTITY_MISMATCH',()=>
   service.join(11,8,[{request_item_id:202,quantity:'4'}],'recurring-n-test-002'));
  check('Other buyer recurring product rejected',state.writes===0);
  state.participant=false;
  await expect('COLLECTIVE_INVITATION_REQUIRED',()=>
   service.join(11,8,[{request_item_id:201,quantity:'2'}],'recurring-n-test-003'));
  check('Buyer without private invitation rejected',state.writes===0);
  state.participant=true;
  const accepted=await service.join(11,8,
   [{request_item_id:201,quantity:'2'}],'recurring-n-test-004');
  check('Exact planned line accepted only after explicit join',
   accepted.is_replay===false&&state.writes===1);
  check('No payment authorized by join',
   accepted.consent_snapshot.authorizes_any_price===false);
  check('Only organizer receives non-PII join event',
   state.events.length===1&&state.events[0].recipient_id===31);
  const invited=await service.listMyInvites(11);
  check('Buyer only receives own recurring line',
   invited[0].items.length===1&&invited[0].items[0].id===201);
  check('Own frozen quantity returned',
   invited[0].items[0].scheduled_quantity==='2.0000');
  check('Email removed from requirement text',
   !invited[0].items[0].requirements.includes('test@example.com'));
  check('Phone removed from requirement text',
   !invited[0].items[0].requirements.includes('03001234567'));
  state.linked=false;state.writes=0;
  const ordinary=await service.join(11,8,
   [{request_item_id:201,quantity:'7'}],'ordinary-n-test-005');
  check('Ordinary one-time collective still supports buyer-selected quantity',
   ordinary.consent_snapshot.items[0].quantity==='7.0000');
  console.log('B6-N CYCLE JOIN PRIVACY: '+passed+'/'+passed+' PASS');
 }finally{notifications.enqueue=old}
}
main().catch(error=>{console.error('B6-N CYCLE JOIN GATE FAIL',error);process.exitCode=1});
