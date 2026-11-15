'use strict';
// Source-isolated recovery invariants, no protected database writes.
const test=require('node:test');
const assert=require('node:assert/strict');
process.env.NODE_ENV='test';
const dbPath=require.resolve('../src/config/db');
const database={};
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:database};
const noticesPath=require.resolve('../src/services/ucpExpiryNotificationService');
require.cache[noticesPath]={id:noticesPath,filename:noticesPath,loaded:true,exports:{recordFlashExpiryOnConnection:async()=>{}}};
const recovery=require('../src/services/ucpRecoveryService');
test('unchanged low-ID offers cannot starve later recovery batches',async()=>{
  let cursor=0;
  const visited=[];
  const offers=[1,2,3].map(id=>({id,supplier_id:4,expired:0}));
  const db={getConnection:async()=>({release(){},query:async(sql,args)=>{
    if(sql.includes('DATABASE()'))return [[{name:'miljor_test_db'}]];
    if(sql.includes('GET_LOCK'))return [[{acquired:1}]];
    if(sql.includes('SELECT last_flash_id'))return [[{last_flash_id:cursor}]];
    if(sql.includes('INSERT INTO ucp_recovery_cursors')){cursor=args[0];return [{affectedRows:1}];}
    if(sql.includes('FROM flash_pools fp')){
      const rows=sql.includes('fp.id<=?')?offers.filter(x=>x.id>args[0]).concat(offers.filter(x=>x.id<=args[0])):offers;
      return [rows.slice(0,1)];
    }
    return [[{}]];
  }})};
  const flashService={reclaimExpiredUninitiatedHolds:async id=>visited.push(id)};
  await recovery.runFlashRecoveryBatch({database:db,flashService,limit:1});
  await recovery.runFlashRecoveryBatch({database:db,flashService,limit:1});
  assert.deepEqual(visited,[1,2]);
});
test('system expiry works for a suspended supplier and preserves committed stock',async()=>{
  const updates=[];
  const pool={id:1,supplier_id:4,status:'ACTIVE',expiry_time:'2020-01-01',held_stock:'3.00',committed_stock:'2.00'};
  database.getConnection=async()=>({beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},query:async(sql,args)=>{
    if(sql.includes('FROM supplier_profiles'))return [[{role:'SUPPLIER',verification_status:'BLOCKED',is_verified:0,profile_verification:'REJECTED'}]];
    if(sql.includes('SELECT * FROM flash_pools'))return [[pool]];
    if(sql.includes('SELECT h.id,h.quantity'))return [[]];
    if(sql.includes('AS expired'))return [[{expired:1}]];
    if(sql.trim().startsWith('UPDATE'))updates.push({sql,args});
    return [{affectedRows:1}];
  }});
  const flash=require('../src/services/flashPoolService');
  assert.equal(typeof flash.expireOfferForRecovery,'function');
  const result=await flash.expireOfferForRecovery(1);
  assert.equal(result.status,'EXPIRED');
  assert.equal(result.preserved_unsettled_quantity,'5.00');
  assert.ok(updates.some(x=>x.sql.includes('supplier_inventory_allocations')&&x.args[0]==='5.00'));
  await assert.rejects(()=>flash.closeExpiredOffer(4,1),error=>error.code==='SUPPLIER_NOT_VERIFIED','supplier-facing operation still checks verification');
});
