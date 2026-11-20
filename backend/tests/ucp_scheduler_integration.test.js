'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('scheduler preserves bounded Flash recovery backlog and retries instead of bulk expiring it',async()=>{
 const callbacks=[],offers=Array.from({length:52},(_,i)=>({id:i+1,status:'ACTIVE',events:0}));
 let failedOnce=false;
 const mod={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/schedulerService'),'utf8'),{
  module:mod,exports:mod.exports,process:{env:{}},console:{log(){},error(){},warn(){}},Date,
  require(name){
   if(name==='node-cron')return {schedule:(_,cb)=>{callbacks.push(cb);return {stop(){}}}};
   if(name==='./poolClosureService')return {processExpiredPools:async()=>{},processExpiredFlashPools:async()=>{for(const p of offers)if(p.status==='ACTIVE')p.status='EXPIRED'},cleanOldIdempotencyRecords:async()=>{}};
   if(name==='./ucpRecoveryService')return {runFlashRecoveryBatch:async({limit})=>{for(const p of offers.filter(x=>x.status==='ACTIVE').slice(0,limit)){if(p.id===1&&!failedOnce){failedOnce=true;continue;}p.status='EXPIRED';p.events++;}}};
   if(name==='./ucpRegularRecoveryService')return {runRegularRecoveryBatch:async()=>{}};
   if(name==='./procurementCollectiveCommitmentService')return {releaseExpiredBatch:async()=>{}};
   throw Error('Unexpected dependency '+name);
  }
 });
 mod.exports.startScheduler();
 try {await callbacks[0]();await callbacks[0]();assert.equal(offers.filter(x=>x.events===1).length,52,'failed and over-limit offers must remain eligible for the next recovery tick');}
 finally{mod.exports.stopScheduler();}
});
