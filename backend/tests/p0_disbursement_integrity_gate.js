'use strict';
// No database mutations. The fake connection records intended SQL and rejects
// any unrecognized statement. Run with NODE_ENV=test and TEST_DB_NAME=miljor_test_db.
process.env.NODE_ENV='test';
process.env.TEST_DB_NAME='miljor_test_db';
const assert=require('node:assert/strict');
const db=require('../src/config/db');
const svc=require('../src/services/financialSettlementService');
const money=require('../src/services/exactDecimal');

function bad(code){return error=>error.code===code&&error.statusCode>=400;}
async function withFake(reply,exercise){
  const saved=db.getConnection,trace=[];
  db.getConnection=async()=>({
    beginTransaction:async()=>trace.push('BEGIN'),
    commit:async()=>trace.push('COMMIT'),
    rollback:async()=>trace.push('ROLLBACK'),
    release:()=>trace.push('RELEASE'),
    query:async(sql,args=[])=>{trace.push(sql.replace(/\s+/g,' ').trim());return reply(sql,args);}
  });
  try{await exercise(trace);}finally{db.getConnection=saved;}
}
const payable={
  id:11,order_id:12,order_code:'ORD-00012',supplier_id:13,payment_id:14,
  supplier_user_verified:1,supplier_profile_status:'VERIFIED',
  fulfillment_status:'BUYER_CONFIRMED',
  status:'ACCRUED',net_payable_amount:'100.00',
  refund_deduction_amount:'0.00',held_amount:'0.00',
  available_amount:'100.00',disbursed_amount:'0.00'
};
const args={
  payableId:11,beneficiaryTitle:'Supplier Store',beneficiaryIban:'PK36SCBL0000001123456702',
  actor:{id:1,role:'FINANCE_ADMIN'},idempotencyKey:'finance-test-123'
};
const prepared={id:99,supplier_payable_id:11,idempotency_key:args.idempotencyKey,
  beneficiary_title:args.beneficiaryTitle,beneficiary_iban:args.beneficiaryIban,
  beneficiary_bank_code:null,amount:'100.00',status:'PREPARED'};
(async()=>{
  // 1. Missing financial authority must reject without requesting DB connection.
  await assert.rejects(svc.prepareSupplierDisbursement({...args,actor:{id:1,role:'BUYER'}}),
    bad('UNAUTHORIZED_ROLE'));
  // 2. Missing idempotency must reject without DB request.
  await assert.rejects(svc.prepareSupplierDisbursement({...args,idempotencyKey:null}),
    bad('IDEMPOTENCY_KEY_REQUIRED'));
  // 3. Replay of same payable and payload remains exactly-once.
  await withFake(async sql=>{
    if(sql.includes('FROM supplier_payables'))return [[payable]];
    if(sql.includes('FROM supplier_disbursement_instructions'))return [[prepared]];
    throw Error('unexpected query '+sql);
  },async trace=>{
    const replay=await svc.prepareSupplierDisbursement(args);
    assert.equal(replay.data.disbursement.id,prepared.id);
    assert.ok(!trace.some(x=>x.includes('INSERT INTO supplier_disbursement_instructions')));
    assert.ok(trace.includes('COMMIT'));
  });
  // 4. A new idempotency key never prepares a second instruction.
  await withFake(async(sql,args)=>{
    if(sql.includes('FROM supplier_payables'))return [[payable]];
    if(sql.includes('WHERE supplier_payable_id'))return [[prepared]];
    if(sql.includes('WHERE idempotency_key'))return [[]];
    throw Error('unexpected query '+sql);
  },async()=>{
    await assert.rejects(svc.prepareSupplierDisbursement({...args,idempotencyKey:'another-key-000'}),
      bad('DISBURSEMENT_ALREADY_EXISTS'));
  });
  // 5. No refund claim may coexist with a newly prepared payout.
  await withFake(async sql=>{
    if(sql.includes('FROM supplier_payables'))return [[payable]];
    if(sql.includes('FROM supplier_disbursement_instructions'))return [[]];
    if(sql.includes('FROM refund_obligations'))return [[{id:61}]];
    throw Error('unexpected query '+sql);
  },async()=>{
    await assert.rejects(svc.prepareSupplierDisbursement(args),
      bad('PENDING_REFUND_DISBURSEMENT_BLOCKED'));
  });
  // 6. Invalid accounting balances cannot be disbursed.
  await withFake(async sql=>{
    if(sql.includes('FROM supplier_payables'))return [[{...payable,available_amount:'120.00'}]];
    if(sql.includes('FROM supplier_disbursement_instructions'))return [[]];
    if(sql.includes('FROM refund_obligations'))return [[]];
    throw Error('unexpected query '+sql);
  },async()=>{
    await assert.rejects(svc.prepareSupplierDisbursement(args),
      bad('PAYABLE_ACCOUNTING_MISMATCH'));
  });
  // 7. Approval cannot proceed after a hold appeared.
  await withFake(async sql=>{
    if(sql.includes('SELECT supplier_payable_id FROM'))return [[{supplier_payable_id:11}]];
    if(sql.includes('FROM supplier_payables'))return [[{...payable,status:'DISBURSEMENT_PREPARED'}]];
    if(sql.includes('FROM supplier_disbursement_instructions d'))return [[{...prepared,order_id:12,payment_id:14}]];
    if(sql.includes('FROM refund_obligations'))return [[]];
    if(sql.includes('FROM financial_holds'))return [[{id:60}]];
    throw Error('unexpected query '+sql);
  },async()=>{
    await assert.rejects(svc.approveSupplierDisbursement({disbursementId:99,actor:args.actor}),
      bad('DISBURSEMENT_REAPPROVAL_REQUIRED'));
  });
  assert.equal(money.exactDecimalEquals('100.00','100.00',2),true);
  console.log('PASS: 7 isolated disbursement hardening scenarios; no DB writes');
})()
  .catch(e=>{console.error(e);process.exitCode=1;})
  .finally(async()=>{
    try { await db.end(); }
    catch (err) { console.error('Failed to close test DB pool:',err.message);process.exitCode=1; }
  });
