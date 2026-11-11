'use strict';
// Deferred targeted financial acceptance: isolated mocks only, never real DB.
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const fees = require('../src/services/feeService');
const settlement = require('../src/services/financialSettlementService');

async function withConnection(responder,work) {
  const original=db.getConnection;
  const log=[];
  db.getConnection=async()=>({
    beginTransaction:async()=>log.push('BEGIN'),
    rollback:async()=>log.push('ROLLBACK'),
    commit:async()=>log.push('COMMIT'),
    release:()=>log.push('RELEASE'),
    query:async(sql,params)=>responder(sql,params,log)
  });
  try{await work(log);}finally{db.getConnection=original;}
}
const paidOrder={
  id:101,order_code:'ORD-101',supplier_id:21,buyer_id:5,
  payment_status:'PAID',order_status:'PAID',
  subtotal_amount:'1000.00',delivery_fee:'0.00',
  total_amount:'1030.00',buyer_platform_fee:'30.00',
  total_qty:'10.00',unit_price:'100.00',
  payment_row_id:9,captured_amount:'1030.00'
};
async function testMissingCommission() {
  await withConnection(async(sql)=>{
    if(sql.includes('FROM orders o')&&sql.includes('supplier_profiles'))return [[{
      ...paidOrder,locked_supplier_commission_percent:null,
      current_supplier_commission_percent:'2.50'
    }]];
    if(sql.includes('FROM payments'))return [[{id:9,status:'PAID'}]];
    if(sql.includes('FROM supplier_payables'))return [[]];
    throw Error('Unexpected query: '+sql);
  },async(log)=>{
    await assert.rejects(
      settlement.accrueSupplierPayable({orderId:101,actor:{id:1,role:'FINANCE_ADMIN'}}),
      e=>e.code==='LOCKED_SUPPLIER_COMMISSION_REQUIRED'&&e.statusCode===409
    );
    assert.deepEqual(log,['BEGIN','ROLLBACK','RELEASE']);
  });
}
async function testFeeProfileMissingRate() {
  const original=db.query;
  db.query=async()=>[[{transaction_fee_percent:null}]];
  try{
    await assert.rejects(
      fees.calculateSupplierFeeExact(21,'1000.00'),
      e=>e.code==='SUPPLIER_COMMISSION_UNCONFIGURED'&&e.statusCode===409
    );
  }finally{db.query=original;}
}
async function testRefundRoleAndPartialEligibility() {
  await withConnection(async(sql)=>{
    if(sql.includes('JOIN payments p')) {
      assert.match(sql,/PARTIALLY_REFUNDED/);
      return [[{...paidOrder,payment_row_status:'PARTIALLY_REFUNDED'}]];
    }
    throw Error('Unexpected query: '+sql);
  },async(log)=>{
    await assert.rejects(
      settlement.assessRefundObligation({
        orderId:101,refundType:'PARTIAL',disputedQuantity:'1.00',
        actor:{id:25,role:'INVESTIGATOR'},reason:'damaged'
      }),e=>e.code==='UNAUTHORIZED_ROLE'&&e.statusCode===403
    );
    assert.deepEqual(log,['BEGIN','ROLLBACK','RELEASE']);
  });
}
async function testUnverifiedExternalRefund() {
  await assert.rejects(
    settlement.recordManualConfirmedRefund({
      refundId:99,externalReference:'SF-REF-UNVERIFIED',
      actor:{id:1,role:'FINANCE_ADMIN'}
    }),e=>e.code==='PROVIDER_REFUND_VERIFICATION_REQUIRED'&&e.statusCode===409
  );
  await assert.rejects(
    settlement.recordManualConfirmedRefund({
      refundId:99,externalReference:'SF-REF-UNVERIFIED',
      actor:{id:21,role:'SUPPLIER'}
    }),e=>e.code==='UNAUTHORIZED_ROLE'&&e.statusCode===403
  );
}
(async()=>{
  await testMissingCommission();
  await testFeeProfileMissingRate();
  await testRefundRoleAndPartialEligibility();
  await testUnverifiedExternalRefund();
  console.log('PASS: isolated financial safety gate');
})().catch(e=>{console.error('Financial safety gate failed:',e);process.exitCode=1;});
