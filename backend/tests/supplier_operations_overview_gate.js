'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const dbPath=require.resolve('../src/config/db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{}};
const {SupplierOperationsService}=require('../src/services/supplierOperationsService');
function fixture(){
  const trace=[];
  const connection={release(){},async query(sql,args){
    trace.push({sql,args});
    if(sql.includes('FROM users u'))return [[{id:args[0],role:'SUPPLIER',is_verified:1,verification_status:'VERIFIED',profile_verification_status:'VERIFIED'}]];
    assert.ok(args.every(value=>value===11||value===12));
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/.test(sql));
    return [[{generated_at:new Date('2026-11-15T10:00:00Z'),rfq_invitations:args[0]===11?'3':'0',
      collective_requests:'1',numeric_decisions:'2',delivery_choices:'1',expiring_quotes:'4',
      paid_to_fulfill:'5',awaiting_buyer_receipt:'1',fulfillment_exceptions:'1',unread_notifications:'7'}]];
  }};
  return {trace,service:new SupplierOperationsService({getConnection:async()=>connection})};
}
test('supplier dashboard reads exact own counts, no writes or foreign identifiers',async()=>{
  const state=fixture();const result=await state.service.get({id:11,role:'SUPPLIER'});
  assert.equal(result.counts.rfq_invitations,3);assert.equal(result.counts.numeric_decisions,2);
  assert.equal(result.counts.paid_to_fulfill,5);assert.equal(result.counts.unread_notifications,7);
  assert.equal(result.financial_execution_enabled,false);
  const other=await state.service.get({id:12,role:'SUPPLIER'});assert.equal(other.counts.rfq_invitations,0);
  assert.ok(state.trace.every(entry=>!entry.sql.includes('SELECT *')));
});
test('role and identifier denial happens before dashboard data query',async()=>{
  const state=fixture();
  await assert.rejects(()=>state.service.get({id:11,role:'BUYER'}),error=>error.statusCode===403);
  await assert.rejects(()=>state.service.get({id:'11 OR 1=1',role:'SUPPLIER'}),error=>error.statusCode===400);
  assert.equal(state.trace.length,0);
});
