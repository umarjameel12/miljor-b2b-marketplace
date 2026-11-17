'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {recordInAppOnConnection,sanitizePayload} = require('../src/services/ucpTransactionalNotifications');
(async () => {
  let queries = [];
  const db = {query:async (sql,params) => {
    queries.push({sql,params});
    return [{affectedRows:1}];
  }};
  const event={type:'UCP.ORDER_CONFIRMED',aggregateId:'order-42',aggregateVersion:2,transitionId:'confirm-1',
    recipients:[{userId:10,role:'BUYER'},{userId:10,role:'BUYER'},{userId:11,role:'SUPPLIER'}],
    title:'Order confirmed',message:'Your order has been confirmed',payload:{order_id:42,status:'CONFIRMED'}};
  const r=await recordInAppOnConnection(db,event);
  assert.equal(r.inserted,2,'recipient duplicate suppressed');
  assert.equal(queries.length,2);
  assert.equal(queries[0].params[0],10);
  assert.equal(queries[1].params[0],11);
  assert.equal(queries[0].params[3],queries[1].params[3],'same stable event identity');
  assert.ok(queries[0].sql.includes('ON DUPLICATE KEY'),'DB dedupe protection');
  assert.throws(()=>sanitizePayload({password:'secret'}),/UNSAFE_NOTIFICATION_PAYLOAD_KEY/);
  assert.throws(()=>sanitizePayload({notification_path:{url:'nested'}}),/INVALID_NOTIFICATION_PAYLOAD_VALUE/);
  await assert.rejects(()=>recordInAppOnConnection(db,{...event,recipients:[{userId:0,role:'BUYER'}]}),/INVALID_NOTIFICATION_RECIPIENT/);
  await assert.rejects(()=>recordInAppOnConnection(db,{...event,recipients:[{userId:10,role:'GUEST'}]}),/INVALID_NOTIFICATION_RECIPIENT/);
  await assert.rejects(()=>recordInAppOnConnection(db,{...event,type:'FAKE.EVENT'}),/UNKNOWN_NOTIFICATION_EVENT/);
  const route=fs.readFileSync(path.resolve(__dirname,'../src/routes/v1/notificationRoutes.js'),'utf8');
  assert.match(route,/markAsRead\(req\.user\.id, notificationId\)/,'ownership order fixed');
  assert.match(route,/Number\.isSafeInteger\(notificationId\)/,'invalid notification IDs rejected');
  console.log('PASS: transactional notification writer mock and routes source gate');
})().catch(err=>{console.error(err);process.exitCode=1});
