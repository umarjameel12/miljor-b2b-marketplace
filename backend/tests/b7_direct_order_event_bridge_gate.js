'use strict';
const assert=require('node:assert/strict');
const notifications=require('../src/services/procurementNotificationService');
const {appendDirectAwardNotice}=require('../src/services/b7PostpurchaseEventBridge');
let n=0;
const pass=(name,check)=>{assert.ok(check,name);console.log('PASS '+(++n)+': '+name)};
const order={id:91,pool_id:null,notes:'SMART_PROCUREMENT_BASKET',
 buyer_id:5,supplier_id:2};
const events=[];
const original=notifications.enqueue;
notifications.enqueue=async(conn,event)=>{events.push(event);return {notification_id:events.length}};
async function main(){
 try{
  const pooled=await appendDirectAwardNotice(null,{
   order:{...order,pool_id:11},eventId:'EVT-POOL-TEST',statusCode:'ORDER_DISPATCHED'
  });
  pass('Existing pooled orders stay on original legacy outbox',pooled===false&&events.length===0);
  const handled=await appendDirectAwardNotice(null,{
   order,eventId:'EVT-ORDER-TEST',statusCode:'ORDER_SUPPLIER_DELIVERED'
  });
  pass('Direct B6 paid award uses private outbox',handled===true&&events.length===2);
  pass('Buyer and supplier notified separately, role-scoped',
   events[0].recipient_role==='BUYER'&&events[0].recipient_id===5&&
   events[1].recipient_role==='SUPPLIER'&&events[1].recipient_id===2);
  pass('Safe event payload never contains buyer PII or payment amount',
   events.every(e=>Object.keys(e.payload).join(',')==='order_id,status_code'&&
    e.event_type==='DELIVERY_STATUS_CHANGED'));
  pass('Unique recipient+event dedupe key stable and bounded',
   events[0].event_key!==events[1].event_key&&
   events.every(e=>e.event_key.length<=120));
  await assert.rejects(()=>appendDirectAwardNotice(null,{
   order:{...order,notes:'FLASH_ORDER'},eventId:'EVT-OTHER',statusCode:'ORDER_DISPATCHED'
  }),e=>e.code==='POSTPURCHASE_SOURCE_NOT_SUPPORTED');
  pass('Unknown direct order sources fail closed',true);
  await assert.rejects(()=>appendDirectAwardNotice(null,{
   order,eventId:'unsafe key?',statusCode:'ORDER_DISPATCHED'
  }),e=>e.code==='POSTPURCHASE_EVENT_INVALID');
  pass('Unsafe event identifier rejected',true);
  notifications.enqueue=async()=>{throw Error('Outbox temporarily unavailable')};
  await assert.rejects(()=>appendDirectAwardNotice(null,{
   order,eventId:'EVT-FAIL-TEST',statusCode:'ORDER_DISPUTE_CREATED'
  }),/Outbox temporarily unavailable/);
  pass('Failed outbox insert bubbles up to caller transaction rollback',true);
  console.log('B7 DIRECT ORDER OUTBOX: '+n+'/'+n+' PASS');
 }finally{notifications.enqueue=original}
}
main().then(()=>process.exit(0)).catch(e=>{console.error('B7 BRIDGE GATE FAILED',e);process.exit(1)});
