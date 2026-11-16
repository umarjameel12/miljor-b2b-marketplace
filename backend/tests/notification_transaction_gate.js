'use strict';
process.env.NODE_ENV='test';
const assert=require('node:assert/strict');
const dbPath=require.resolve('../src/config/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query:async()=>{throw Error('Global pool must not be used');}}};
const {NotificationService}=require('../src/services/notificationService');
async function main(){
  const service=new NotificationService();
  const writes=[];
  const connection={query:async(sql,args)=>{
    writes.push({sql,args});
    if(sql.includes('FROM users'))return [[{id:7,role:'BUYER'}]];
    return [{insertId:12,affectedRows:1}];
  }};
  await service.enqueueEvent(connection,{userId:7,role:'BUYER',eventType:'REQUEST_CREATED',eventKey:'request:4:created',entityId:4});
  assert.equal(writes.filter(row=>row.sql.includes('INSERT INTO procurement_notifications')).length,1);
  assert.equal(writes.at(-1).args[0],7);
  await assert.rejects(()=>service.enqueueEvent(connection,{userId:7,role:'SUPPLIER',eventType:'REQUEST_CREATED',eventKey:'request:4:created',entityId:4}),/recipient/i);
  await assert.rejects(()=>service.enqueueEvent(connection,{userId:7,role:'BUYER',eventType:'INVENTED_SUCCESS',eventKey:'fake',entityId:4}),/event/i);
  await assert.rejects(()=>service.enqueueEvent(connection,{userId:7,role:'BUYER',eventType:'REQUEST_CREATED',eventKey:'fake',entityId:4,payload:{anotherBuyerEmail:'private'}}),/field/i);
  const failing={query:async(sql)=>{if(sql.includes('FROM users'))return [[{id:7,role:'BUYER'}]];throw Error('outbox unavailable');}};
  await assert.rejects(()=>service.enqueueEvent(failing,{userId:7,role:'BUYER',eventType:'REQUEST_CREATED',eventKey:'request:4:created',entityId:4}),/outbox unavailable/);
  console.log('PASS notification transaction connection, recipient role, event allowlist, private-field rejection and failure propagation');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
