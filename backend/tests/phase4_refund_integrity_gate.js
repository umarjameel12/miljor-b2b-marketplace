'use strict';
// Deferred Phase 4 acceptance gate. Isolated financial logic tests use a
// simulated transactional connection and never connect to miljor_db.
const assert = require('node:assert/strict');
const db = require('../src/config/db');
const financial = require('../src/services/financialSettlementService');

async function withFakeConnection(responder, exercise) {
  const original = db.getConnection;
  const trace = [];
  const connection = {
    beginTransaction: async()=>trace.push('BEGIN'),
    commit: async()=>trace.push('COMMIT'),
    rollback: async()=>trace.push('ROLLBACK'),
    release: ()=>trace.push('RELEASE'),
    query: async(sql,params)=>responder(sql,params,trace)
  };
  db.getConnection = async()=>connection;
  try { await exercise(trace); }
  finally { db.getConnection = original; }
}

async function verifyPendingRefundCeiling() {
  await withFakeConnection(async(sql)=>{
    if(sql.includes('JOIN payments p')) return [[{
      id:101,order_code:'ORD-101',buyer_id:5,payment_row_id:31,
      captured_amount:'100.00',subtotal_amount:'100.00',
      delivery_fee:'0.00',buyer_platform_fee:'0.00',
      total_qty:'10.00',unit_price:'10.00'
    }]];
    if(sql.includes('SUM(total_refund_amount)')) {
      assert.match(sql, /'REQUESTED'/);
      assert.match(sql, /'UNDER_REVIEW'/);
      return [[{total_refunded:'80.00'}]];
    }
    throw Error('Unexpected SQL: '+sql);
  }, async(trace)=>{
    await assert.rejects(
      financial.assessRefundObligation({
        orderId:101,refundType:'FULL',actor:{id:5,role:'BUYER'},
        reason:'Goods missing',idempotencyKey:'phase4-test-pending'
      }),
      error=>error.code==='REFUND_EXCEEDS_CAPTURED_AMOUNT'&&error.statusCode===422
    );
    assert.deepEqual(trace,['BEGIN','ROLLBACK','RELEASE']);
  });
}

async function verifyRefundSpecificHold() {
  await withFakeConnection(async(sql,params)=>{
    if(sql.includes('FROM refund_obligations r'))return [[{
      id:23,order_id:101,payment_id:31,status:'REQUESTED',
      assessed_refund_amount:'20.00',total_refund_amount:'20.00',
      refund_type:'PARTIAL'
    }]];
    if(sql.includes('FROM supplier_payables WHERE order_id'))return [[{
      id:44,order_id:101,net_payable_amount:'90.00',
      refund_deduction_amount:'0.00',held_amount:'20.00'
    }]];
    if(sql.includes('FROM financial_holds')) {
      assert.match(sql, /hold_code LIKE/);
      assert.equal(params[2],'HOLD-RFND-23-%');
      // Another order hold must never be forfeited for this refund.
      return [[]];
    }
    throw Error('Unexpected SQL: '+sql);
  },async(trace)=>{
    await assert.rejects(
      financial.approveRefundObligation({refundId:23,actor:{id:2,role:'FINANCE_ADMIN'}}),
      error=>error.code==='REFUND_HOLD_MISMATCH'&&error.statusCode===409
    );
    assert.deepEqual(trace,['BEGIN','ROLLBACK','RELEASE']);
  });
}

(async()=>{
  await verifyPendingRefundCeiling();
  await verifyRefundSpecificHold();
  console.log('Phase 4 refund invariants acceptance gate passed (isolated).');
})().catch(error=>{console.error(error);process.exitCode=1});
