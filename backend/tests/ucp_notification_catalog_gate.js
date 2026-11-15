'use strict';
const assert=require('node:assert/strict');
const {definitions,getEventDefinition,buildEventKey,CHANNELS}=require('../src/services/ucpNotificationEventCatalog');
const events=Object.keys(definitions);
assert.ok(events.length>=70,'critical UCP action coverage');
assert.equal(new Set(events).size,events.length,'unique event names');
for(const event of events){
 const d=getEventDefinition(event);
 assert.equal(d.type,event);
 assert.ok(d.channels.includes(CHANNELS.IN_APP),'Every event gets in-app');
 if(d.priority==='CRITICAL')assert.ok(d.channels.includes(CHANNELS.EMAIL),'Critical events require email');
 assert.equal(d.transactional,true,'Business event must be committed transactionally');
}
assert.throws(()=>getEventDefinition('UCP.NOT_REAL'),/UNKNOWN_NOTIFICATION_EVENT/);
assert.throws(()=>buildEventKey({type:'UCP.ORDER_CONFIRMED',aggregateId:4,aggregateVersion:0}),/INVALID_NOTIFICATION_EVENT_IDENTITY/);
const args={type:'UCP.ORDER_CONFIRMED',aggregateId:'opaque-order-17',aggregateVersion:3,transitionId:'attempt-1'};
assert.equal(buildEventKey(args),buildEventKey({...args}),'retry uses same key');
assert.notEqual(buildEventKey(args),buildEventKey({...args,aggregateVersion:4}),'new version gets distinct key');
assert.notEqual(buildEventKey(args),buildEventKey({...args,transitionId:'attempt-2'}),'new transition gets distinct key');
console.log('UCP NOTIFICATION CATALOG SOURCE TEST: PASS ('+events.length+' events)');
// NOTE: This tests ONLY registry behavior. Real notification delivery requires SQL transaction,
// outbox integration, recipient isolation, email sandbox and browser tests.
