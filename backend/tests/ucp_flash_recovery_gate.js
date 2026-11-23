'use strict';
const assert=require('node:assert/strict');
const {runFlashRecoveryBatch}=require('../src/services/ucpRecoveryService');
let released=0,unlocked=0,reclaimed=[],closed=[];
function database(lock=1){return {getConnection:async()=>({query:async(sql)=>{
  if(sql.includes('DATABASE()'))return [[{name:'miljor_test_db'}]];
  if(sql.includes('GET_LOCK'))return [[{acquired:lock}]];
  if(sql.includes('RELEASE_LOCK')){unlocked++;return [[{}]];}
  if(sql.includes('SELECT last_flash_id'))return [[]];
  return [[{id:1,supplier_id:2,expired:0},{id:2,supplier_id:3,expired:1}]];
},release:()=>released++})};}
(async()=>{
  const flashService={reclaimExpiredUninitiatedHolds:async id=>reclaimed.push(id),expireOfferForRecovery:async id=>closed.push(id)};
  await runFlashRecoveryBatch({database:database(0),flashService});
  assert.deepEqual(reclaimed,[],'peer lease prevents duplicate sweep');
  const result=await runFlashRecoveryBatch({database:database(),flashService});
  assert.deepEqual(reclaimed,[1]);assert.deepEqual(closed,[2]);assert.equal(result.processed,2);
  const failed=await runFlashRecoveryBatch({database:database(),flashService:{...flashService,expireOfferForRecovery:async()=>{throw Error('fail')}}});
  assert.equal(failed.failed,1);assert.equal(released,3);assert.equal(unlocked,2,'leases released after partial failure');
  await assert.rejects(()=>runFlashRecoveryBatch({limit:1000}),/INVALID_RECOVERY_LIMIT/);
  console.log('PASS: UCP bounded Flash recovery, peer lease, failure release');
})().catch(e=>{console.error(e);process.exitCode=1;});
