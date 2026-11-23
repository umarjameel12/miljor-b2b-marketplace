'use strict';
const assert=require('node:assert/strict');
const dbPath=require.resolve('../src/config/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{}};
const noticesPath=require.resolve('../src/services/ucpTransactionalNotifications');
require.cache[noticesPath]={id:noticesPath,filename:noticesPath,loaded:true,exports:{recordOrderOnConnection:async()=>{}}};
const flash=require('../src/services/flashPoolService');
let mutations=0;
const connection={query:async(sql)=>{
  if(sql.includes('SELECT h.id,h.quantity'))return [[{id:9,order_id:42,status:'PAYMENT_PENDING',quantity:'1.00'}]];
  if(sql.includes('SELECT payment_status,order_status'))return [[{payment_status:'AWAITING_PAYMENT',order_status:'AWAITING_PAYMENT'}]];
  if(sql.includes('FROM payments'))return [[]];
  if(sql.includes('FROM payment_attempts')){
    // A stale INITIATED payment remains an unknown provider outcome, regardless
    // of local age. The old age filter hides it and incorrectly releases stock.
    return [sql.includes('created_at >')?[]:[{id:8}]];
  }
  if(sql.trim().startsWith('UPDATE'))mutations++;
  return [{affectedRows:1}];
}};
(async()=>{
  const result=await flash.reclaimExpiredUninitiatedHolds(1,connection);
  assert.equal(result.released,0,'unknown provider outcome must retain stock until authoritative reconciliation');
  assert.equal(mutations,0,'late callback race cannot cancel order or release held stock');
  console.log('PASS: aged initiated Safepay checkout retains stock and order');
})().catch(e=>{console.error(e);process.exitCode=1;});
