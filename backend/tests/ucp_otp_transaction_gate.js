'use strict';
const assert=require('node:assert/strict');
process.env.NODE_ENV='test';
const dbPath=require.resolve('../src/config/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query:async()=>{throw Error('GLOBAL_POOL_FORBIDDEN');}}};
const email=require('../src/services/emailService');
function transaction({expired=false}={}){
  const writes=[];
  return {writes,query:async(sql,args)=>{
    if(sql.includes('FROM email_verifications'))return [[{id:7,email:'fixture@example.test',otp_hash:email.hashOtp('123456'),expires_at:'2026-11-17',attempts_count:0,is_expired:0}]];
    if(sql.includes('AS is_expired'))return [[{is_expired:expired?1:0}]];
    writes.push({sql,args});return [{affectedRows:1}];
  }};
}
(async()=>{
  const success=transaction();
  assert.equal(await email.verifyAndConsumeOtp({userId:1,otp:'123456',connection:success}),true);
  assert.equal(success.writes.length,2);
  const invalid=transaction();
  await assert.rejects(()=>email.verifyAndConsumeOtp({userId:1,otp:'999999',connection:invalid}),
    error=>error.code==='INVALID_OTP'&&error.otpAttemptRecorded===true);
  assert.equal(invalid.writes.length,1,'invalid OTP records an attempt without consuming the valid challenge');
  const expired=transaction({expired:true});
  await assert.rejects(()=>email.verifyAndConsumeOtp({userId:1,otp:'123456',connection:expired}),error=>error.code==='OTP_EXPIRED');
  assert.equal(expired.writes.length,0,'fresh clock after the lock blocks expired OTP');
  console.log('PASS: caller transaction OTP, retained failed-attempt signal, fresh expiry revalidation');
})().catch(error=>{console.error(error);process.exitCode=1;});
