'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {recordInAppOnConnection,recordReservationEventOnConnection,sanitizePayload} = require('../src/services/ucpTransactionalNotifications');
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
  const projected=[];
  const seen=new Set();
  const reservationConn={query:async(sql,params=[])=>{
    if(sql.includes('SELECT supplier_id FROM pools'))return [[{supplier_id:20}]];
    if(sql.includes('SELECT buyer_id FROM reservations WHERE id=? AND pool_id=?'))return [[{buyer_id:10}]];
    if(sql.includes('SELECT id,role FROM users WHERE id=?'))return [[{id:params[0],role:Number(params[0])===10?'BUYER':'SUPPLIER'}]];
    if(sql.includes('INSERT INTO platform_notifications')){
      const key=String(params[0])+':'+String(params[3]);
      const fresh=!seen.has(key);seen.add(key);projected.push(params);
      return [{affectedRows:fresh?1:0}];
    }
    throw Error('Unexpected reservation notification SQL '+sql);
  }};
  const reservationEvent={event_id:'EVT-RESERVATION-CREATED-001',event_type:'RESERVATION_CREATED',pool_id:5,reservation_id:7};
  const first=await recordReservationEventOnConnection(reservationConn,reservationEvent);
  assert.equal(first.inserted,2,'buyer and supplier each receive the reservation receipt');
  assert.deepEqual(projected.map(x=>x[0]).sort(),[10,20]);
  const replay=await recordReservationEventOnConnection(reservationConn,reservationEvent);
  assert.equal(replay.inserted,0,'same durable event cannot duplicate recipient notices');
  const ucp=fs.readFileSync(path.resolve(__dirname,'../src/services/reservationEventService.js'),'utf8');
  assert.match(ucp,/recordReservationEventOnConnection\(conn,eventData\)/,'reservation outbox is projected in the same transaction');
  console.log('PASS: transactional notification writer, reservation event projection and routes source gates');

})().catch(err=>{console.error(err);process.exitCode=1});
