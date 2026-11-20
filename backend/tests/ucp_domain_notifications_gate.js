'use strict';
const assert=require('node:assert/strict');
process.env.NODE_ENV='test';
const dbPath=require.resolve('../src/config/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{}};
const writer=require('../src/services/ucpTransactionalNotifications');
const emailPath=require.resolve('../src/services/emailService');
let writes=[],emails=[];
require.cache[emailPath]={id:emailPath,filename:emailPath,loaded:true,exports:{enqueueEmail:async(conn,event)=>{emails.push(event);}}};
const conn={query:async(sql,args)=>{
  if(sql.includes('FROM orders'))return [[{id:42,buyer_id:10,supplier_id:11}]];
  if(sql.includes('FROM users'))return [[{id:args[0],role:args[0]===10?'BUYER':'SUPPLIER',email:'private@example.test'}]];
  writes.push({sql,args});return [{affectedRows:1}];
}};
(async()=>{
  assert.equal(typeof writer.recordOrderOnConnection,'function','domain ownership resolver must exist');
  await writer.recordOrderOnConnection(conn,{orderId:42,type:'PAYMENT.CONFIRMED',transitionId:'paid:2'});
  assert.deepEqual(writes.map(x=>x.args[0]),[10,11],'only persisted order owners receive receipts');
  assert.equal(emails.length,0,'domain mutation stores the durable event; channel projection runs after commit');
  assert.ok(writes.every(event=>event.sql.includes('procurement_notifications')&&!JSON.stringify(event.args).includes('private@')),'durable event excludes private contact data');
  writes=[];emails=[];
  await assert.rejects(()=>writer.recordOrderOnConnection(conn,{orderId:0,type:'PAYMENT.CONFIRMED',transitionId:'paid:2'}),/INVALID_ORDER/);
  const bad={query:async(sql,args)=>sql.includes('FROM orders')?[[{id:42,buyer_id:10,supplier_id:11}]]:sql.includes('FROM users')?[[{id:10,role:'ADMIN'}]]:[{affectedRows:1}]};
  await assert.rejects(()=>writer.recordOrderOnConnection(bad,{orderId:42,type:'PAYMENT.CONFIRMED',transitionId:'paid:2'}),/RECIPIENT_ROLE/);
  assert.equal(writes.length,0);
  console.log('PASS: UCP persisted ownership, durable event outbox and role rejection');
})().catch(e=>{console.error(e);process.exitCode=1;});
