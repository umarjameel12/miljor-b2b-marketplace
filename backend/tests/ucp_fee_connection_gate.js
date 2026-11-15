'use strict';
const assert=require('node:assert/strict');
const dbPath=require.resolve('../src/config/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query:async()=>{throw Error('CONNECTION_POOL_EXHAUSTED');}}};
const fees=require('../src/services/feeService');
(async()=>{
  let reads=0;
  const transaction={query:async()=>{reads++;return [[{fee_percentage:'1.50'}]];}};
  const result=await fees.calculateBuyerFee('2000.00',transaction);
  assert.equal(result.buyer_fee,'30.00');
  assert.equal(reads,1,'fee computation must use the existing locked transaction connection');
  console.log('PASS: fee lookup reuses transaction without requesting a saturated pool connection');
})().catch(error=>{console.error(error);process.exitCode=1;});
