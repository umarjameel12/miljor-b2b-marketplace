'use strict';
const assert=require('node:assert/strict');
const {getPreorderPolicy,assertPreorderEnabled}=require('../src/services/procurementPreorderPolicy');
const {sanitizePayload,ProcurementNotificationService}=require('../src/services/procurementNotificationService');
let count=0;const pass=(label,ok)=>{assert.ok(ok,label);console.log('PASS '+(++count)+': '+label)};
const rejects=(code,fn)=>assert.throws(fn,e=>e.code===code);
async function main(){
 const pre=getPreorderPolicy();
 pass('Preorders stay deferred',pre.status==='DEFERRED');
 pass('No production deposit enabled',pre.deposits_enabled===false);
 pass('No ready-stock allocation enabled',pre.inventory_ready_stock_allocation_enabled===false);
 pass('Missing commercial terms identified',pre.missing_policy_decisions.length>=8);
 rejects('PREORDER_POLICY_NOT_APPROVED',()=>assertPreorderEnabled());
 pass('Preorder activation refuses all callers',true);
 const data=sanitizePayload({order_id:15,run_id:4,status_code:'DISPATCHED'});
 pass('Notification payload only uses fixed IDs and statuses',data.order_id===15&&data.run_id===4);
 rejects('PRIVATE_NOTIFICATION_FIELD',()=>sanitizePayload({buyer_phone:'03001234567'}));
 pass('Phone number field rejected',true);
 rejects('PRIVATE_NOTIFICATION_FIELD',()=>sanitizePayload({full_address:'Johar Town'}));
 pass('Buyer street address field rejected',true);
 rejects('INVALID_NOTICE_FIELD',()=>sanitizePayload({order_id:{nested:'private'}}));
 pass('Nested untrusted payload rejected',true);
 let lastQuery=null;
 const database={async query(sql,params){
   lastQuery={sql,params};
   if(sql.startsWith('SELECT id,event_type'))return [[{
     id:1,event_type:'DELIVERY_RUN_PLANNED',payload:'{"order_id":15}',
     is_read:0,created_at:'2026-11-11T00:00:00Z'}]];
   if(sql.startsWith('UPDATE procurement_notifications'))return [{affectedRows:1}];
   throw Error('Unsupported SQL '+sql);
 }};
 const service=new ProcurementNotificationService(database);
 const items=await service.inbox(31,'BUYER');
 pass('Private inbox scopes query to actor and role',
   lastQuery.params[0]===31&&lastQuery.params[1]==='BUYER');
 pass('Private JSON payload decoded',items[0].payload.order_id===15);
 await service.markRead(31,'BUYER',1);
 pass('Mark read enforces actor role + notification ID',
   lastQuery.params[0]===1&&lastQuery.params[1]===31&&lastQuery.params[2]==='BUYER');
 console.log('B6-P/Q POLICY: '+count+'/'+count+' PASS');
}
main().then(()=>process.exit(0)).catch(e=>{console.error('B6-P/Q GATE FAIL',e);process.exitCode=1});
