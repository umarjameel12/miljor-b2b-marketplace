'use strict';
const assert=require('node:assert/strict');
const dbPath=require.resolve('../src/config/db');
// Shared engine contention/lease/crash assertions now run in the stronger
// email_outbox_queue_gate.js; retain compatibility template coverage here.
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{}};
process.env.NODE_ENV='test';
const email=require('../src/services/emailService');
(()=>{
  const template=email._renderTemplate('UCP_NOTIFICATION',{title:'<Payment>',message:'<script>alert(1)</script>'});
  assert.match(template.text,/<Payment>/);
  assert.ok(!template.html.includes('<script>'),'notification HTML must escape content');
  console.log('PASS: escaped UCP compatibility template; shared concurrency gate runs separately');
})();
