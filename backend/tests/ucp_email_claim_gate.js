'use strict';
const assert=require('node:assert/strict');
const dbPath=require.resolve('../src/config/db');
let attempts=0,sends=0;
const row={id:7,recipient_email:'buyer@example.test',recipient_user_id:1,template_name:'UCP_NOTIFICATION',subject:'Payment confirmed',payload_json:{title:'Payment confirmed',message:'Open your order.'},attempt_count:0};
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query:async(sql,args)=>{
  if(sql.includes('SELECT id, recipient_email'))return [[{...row}]];
  if(sql.includes('SET attempt_count = attempt_count + 1')){
    // Both workers selected the same snapshot. Only a compare-and-swap claim may win.
    const expected=args[1];
    if(expected!==undefined&&expected!==attempts)return [{affectedRows:0}];
    attempts++;return [{affectedRows:1}];
  }
  return [{affectedRows:1}];
}}};
process.env.NODE_ENV='test';
const email=require('../src/services/emailService');
email.transporter={sendMail:async()=>{sends++;return {messageId:'accepted'};}};
(async()=>{
  const results=await Promise.all([email.processOutboxBatch(),email.processOutboxBatch()]);
  assert.equal(sends,1,'concurrent workers must claim one message only once');
  assert.equal(results.reduce((n,r)=>n+r.succeeded,0),1);
  const template=email._renderTemplate('UCP_NOTIFICATION',{title:'<Payment>',message:'<script>alert(1)</script>'});
  assert.match(template.text,/<Payment>/);
  assert.ok(!template.html.includes('<script>'),'notification HTML must escape content');
  console.log('PASS: UCP concurrent email claim and escaped template');
})().catch(e=>{console.error(e);process.exitCode=1;});
