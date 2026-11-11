'use strict';
// MilJor P0: run ACTUAL financialSettlementService methods in an isolated VM.
// The mocked module loader never imports src/config/db.js and never opens
// a MySQL connection. There are NO migrations, network calls, or real payouts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const exact = require('../src/services/exactDecimal');

const source = fs.readFileSync(
  path.join(__dirname, '../src/services/financialSettlementService.js'), 'utf8'
);
let connect;
const fakeDb = { getConnection: async () => {
  if (!connect) throw new Error('Missing fake connection');
  return connect();
}};
const moduleRef = {exports:{}};
vm.runInNewContext(source, {
  module:moduleRef,
  exports:moduleRef.exports,
  console,
  process:{env:{NODE_ENV:'test'}},
  require(name) {
    if(name==='crypto') return require('node:crypto');
    if(name==='../config/db') return fakeDb;
    if(name==='./exactDecimal') return exact;
    if(name==='./feeService'||name==='./reservationEventService') return {};
    throw Error('Forbidden dependency: '+name);
  }
}, {filename:'financialSettlementService.js',timeout:5000});
const svc = moduleRef.exports;
svc._logAuditEvent = async () => 'TEST-AUDIT-ONLY';

const payable = {
  id:11,order_id:12,order_code:'ORD-00012',supplier_id:13,payment_id:14,
  supplier_user_verified:1,supplier_profile_status:'VERIFIED',
  fulfillment_status:'BUYER_CONFIRMED',status:'ACCRUED',
  net_payable_amount:'100.00',refund_deduction_amount:'0.00',
  held_amount:'0.00',available_amount:'100.00',disbursed_amount:'0.00'
};
const args = {
  payableId:11,beneficiaryTitle:'Supplier Store',
  beneficiaryIban:'PK36SCBL0000001123456702',
  actor:{id:1,role:'FINANCE_ADMIN'},idempotencyKey:'finance-test-123'
};
const prepared = {
  id:99,supplier_payable_id:11,idempotency_key:args.idempotencyKey,
  beneficiary_title:args.beneficiaryTitle,beneficiary_iban:args.beneficiaryIban,
  beneficiary_bank_code:null,amount:'100.00',status:'PREPARED',
  external_execution_status:'DISABLED',supplier_user_verified:1,
  supplier_profile_status:'VERIFIED',fulfillment_status:'BUYER_CONFIRMED',
  order_id:12,payment_id:14
};
let passed=0;
const pass = label => {passed++;console.log('PASS',label);};
const rejects = async (fn,code) => assert.rejects(fn,err=>err.code===code);
async function withFake(respond,exercise) {
  const trace=[];
  connect = async () => ({
    beginTransaction:async()=>trace.push('BEGIN'),
    commit:async()=>trace.push('COMMIT'),
    rollback:async()=>trace.push('ROLLBACK'),
    release:()=>trace.push('RELEASE'),
    query:async(sql,params=[])=>{
      trace.push(sql.replace(/\s+/g,' ').trim());
      return respond(sql,params);
    }
  });
  try {await exercise(trace);}
  finally {connect=null;}
}
const approvalResponder=(overrides={},holds=[])=>async sql=>{
  if(sql.includes('SELECT supplier_payable_id FROM'))return [[{supplier_payable_id:11}]];
  if(sql.includes('FROM supplier_payables'))return [[{...payable,status:'DISBURSEMENT_PREPARED'}]];
  if(sql.includes('FROM supplier_disbursement_instructions d'))return [[{...prepared,...overrides}]];
  if(sql.includes('FROM refund_obligations'))return [[]];
  if(sql.includes('FROM financial_holds'))return [holds];
  throw Error('Unexpected approval SQL: '+sql);
};
async function basicCases(){
  await rejects(()=>svc.prepareSupplierDisbursement({...args,actor:{id:2,role:'BUYER'}}),'UNAUTHORIZED_ROLE');
  pass('role must authorize payout preparation');
  await rejects(()=>svc.prepareSupplierDisbursement({...args,idempotencyKey:null}),'IDEMPOTENCY_KEY_REQUIRED');
  pass('idempotency key required');
  await withFake(async sql=>{
    if(sql.includes('FROM supplier_payables'))return [[payable]];
    if(sql.includes('FROM supplier_disbursement_instructions'))return [[prepared]];
    throw Error('Unexpected replay SQL: '+sql);
  },async trace=>{
    const result=await svc.prepareSupplierDisbursement(args);
    assert.equal(result.data.disbursement.id,99);
    assert.equal(trace.some(s=>s.includes('INSERT INTO supplier_disbursement_instructions')),false);
  });
  pass('identical retry returns one existing instruction');
  await withFake(async sql=>{
    if(sql.includes('FROM supplier_payables'))return [[payable]];
    if(sql.includes('WHERE supplier_payable_id'))return [[prepared]];
    if(sql.includes('WHERE idempotency_key'))return [[]];
    throw Error('Unexpected conflict SQL: '+sql);
  },async trace=>{
    await rejects(()=>svc.prepareSupplierDisbursement({...args,idempotencyKey:'another-key-000'}),
      'DISBURSEMENT_ALREADY_EXISTS');
    assert.ok(trace.includes('ROLLBACK'));
  });
  pass('new key for same payable is rejected and rolled back');
  await withFake(async sql=>{
    if(sql.includes('FROM supplier_payables'))return [[payable]];
    if(sql.includes('FROM supplier_disbursement_instructions'))return [[]];
    if(sql.includes('FROM refund_obligations'))return [[{id:61}]];
    throw Error('Unexpected refund SQL: '+sql);
  },async()=>{
    await rejects(()=>svc.prepareSupplierDisbursement(args),'PENDING_REFUND_DISBURSEMENT_BLOCKED');
  });
  pass('pending refund stops payout');
  await withFake(async sql=>{
    if(sql.includes('FROM supplier_payables'))return [[{...payable,available_amount:'120.00'}]];
    if(sql.includes('FROM supplier_disbursement_instructions'))return [[]];
    if(sql.includes('FROM refund_obligations'))return [[]];
    throw Error('Unexpected accounting SQL: '+sql);
  },async()=>{
    await rejects(()=>svc.prepareSupplierDisbursement(args),'PAYABLE_ACCOUNTING_MISMATCH');
  });
  pass('balance conservation fails closed');
  await withFake(approvalResponder({},[{id:60}]),async()=>{
    await rejects(()=>svc.approveSupplierDisbursement({disbursementId:99,actor:args.actor}),
      'DISBURSEMENT_REAPPROVAL_REQUIRED');
  });
  pass('new hold prevents approval');
  await withFake(approvalResponder({supplier_user_verified:0}),async()=>{
    await rejects(()=>svc.approveSupplierDisbursement({disbursementId:99,actor:args.actor}),
      'DISBURSEMENT_ELIGIBILITY_REVOKED');
  });
  pass('supplier verification rechecked');
  await withFake(approvalResponder({fulfillment_status:'EXCEPTION'}),async()=>{
    await rejects(()=>svc.approveSupplierDisbursement({disbursementId:99,actor:args.actor}),
      'DISBURSEMENT_ELIGIBILITY_REVOKED');
  });
  pass('buyer receipt rechecked');
  await withFake(approvalResponder({external_execution_status:'PROCESSING'}),async()=>{
    await rejects(()=>svc.approveSupplierDisbursement({disbursementId:99,actor:args.actor}),
      'DISBURSEMENT_ELIGIBILITY_REVOKED');
  });
  pass('external execution cannot be enabled by approval');
  await rejects(()=>svc.approveSupplierDisbursement({disbursementId:99,actor:null}),'UNAUTHORIZED_ROLE');
  pass('invalid approval actor rejected');
}

// Simulate lock ordering (SELECT payable FOR UPDATE), two transactions and a
// shared unique record. This proves application sequencing under a mocked
// row lock, NOT MySQL InnoDB lock/DDL or real HTTP concurrency.
async function concurrentCases(){
  const dbState={payable:{...payable},instructions:[],insertAttempts:0,commits:0,
    rollbacks:0,nextId:120,locked:false,waiters:[]};
  async function lock(){
    if(!dbState.locked){dbState.locked=true;return;}
    await new Promise(resolve=>dbState.waiters.push(resolve));
  }
  function unlock(){
    const next=dbState.waiters.shift();
    if(next)next();else dbState.locked=false;
  }
  connect=async()=>{
    let hasLock=false,uncommitted=null;
    return {
      beginTransaction:async()=>{},
      query:async(sql,params=[])=>{
        if(sql.includes('FROM supplier_payables sp')&&sql.includes('FOR UPDATE')){
          await lock();hasLock=true;return [[{...dbState.payable}]];
        }
        if(sql.includes('FROM supplier_disbursement_instructions')&&
           sql.includes('WHERE supplier_payable_id'))return [[...dbState.instructions]];
        if(sql.includes('FROM supplier_disbursement_instructions')&&
           sql.includes('WHERE idempotency_key'))
          return [dbState.instructions.filter(x=>x.idempotency_key===params[0])];
        if(sql.includes('FROM refund_obligations'))return [[]];
        if(sql.includes('INSERT INTO supplier_disbursement_instructions')){
          dbState.insertAttempts++;
          uncommitted={
            id:dbState.nextId++,supplier_payable_id:11,
            beneficiary_title:params[4],beneficiary_iban:params[5],
            beneficiary_bank_code:params[6],amount:params[7],
            idempotency_key:params[8],status:'PREPARED'
          };
          await new Promise(resolve=>setTimeout(resolve,5));
          return [{insertId:uncommitted.id}];
        }
        if(sql.includes('UPDATE supplier_payables'))return [{affectedRows:1}];
        if(sql.includes('SELECT * FROM supplier_disbursement_instructions WHERE id = ?'))
          return [[dbState.instructions.find(x=>x.id===params[0])]];
        throw Error('Unexpected concurrency SQL: '+sql);
      },
      commit:async()=>{
        dbState.commits++;
        if(uncommitted){
          dbState.instructions.push(uncommitted);
          dbState.payable.status='DISBURSEMENT_PREPARED';
        }
        if(hasLock){unlock();hasLock=false;}
      },
      rollback:async()=>{
        dbState.rollbacks++;
        uncommitted=null;
        if(hasLock){unlock();hasLock=false;}
      },
      release:()=>{}
    };
  };
  try{
    const outcomes=await Promise.allSettled([
      svc.prepareSupplierDisbursement({...args,idempotencyKey:'parallel-first-key'}),
      svc.prepareSupplierDisbursement({...args,idempotencyKey:'parallel-second-key'})
    ]);
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(outcomes.filter(r=>r.status==='rejected' &&
      r.reason.code==='DISBURSEMENT_ALREADY_EXISTS').length,1);
    assert.equal(dbState.insertAttempts,1);
    assert.equal(dbState.instructions.length,1);
    assert.equal(dbState.commits,1);
    assert.equal(dbState.rollbacks,1);
    pass('two concurrent keys create exactly one instruction');
    const original=dbState.instructions[0];
    const replay=await svc.prepareSupplierDisbursement({
      ...args,idempotencyKey:'parallel-first-key'
    });
    assert.equal(replay.data.disbursement.id,original.id);
    assert.equal(dbState.insertAttempts,1);
    pass('retry after concurrent commit reuses original instruction');
  }finally{connect=null;}
}
(async()=>{
  await basicCases();
  await concurrentCases();
  console.log('P0 isolated financial gate PASS:',passed,'assertion scenarios');
})().catch(e=>{console.error('P0 isolated financial gate FAIL',e);process.exitCode=1;});
