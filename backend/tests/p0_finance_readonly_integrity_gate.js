'use strict';
// No DB or gateway connection: finance-only integrity contract and negative cases.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const exact=require('../src/services/exactDecimal');
const code=fs.readFileSync(path.join(__dirname,'../src/services/financialConservationService.js'),'utf8');
let fixture,queries=0,updates=0;
const mockDb={getConnection:async()=>({
  beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},
  query:async(sql)=>{
    queries++;
    if(/^\s*SET TRANSACTION ISOLATION LEVEL/.test(sql))return [[]];
    if(/\b(UPDATE|DELETE|INSERT|ALTER|DROP|TRUNCATE)\b/i.test(sql)){updates++;throw Error('READ_ONLY_CONTRACT_VIOLATION')}
    const m=sql.match(/FROM (orders|payments|supplier_payables|financial_holds|refund_obligations|supplier_disbursement_instructions)/i);
    if(!m)throw Error('Unexpected SQL '+sql);
    const name={orders:'orders',payments:'payments',supplier_payables:'payables',financial_holds:'holds',refund_obligations:'refunds',supplier_disbursement_instructions:'instructions'}[m[1]];
    return [fixture[name]];
  }
})};
const m={exports:{}};
vm.runInNewContext(code,{module:m,exports:m.exports,require:name=>{
  if(name==='../config/db')return mockDb;
  if(name==='./exactDecimal')return exact;
  throw Error('Unexpected import: '+name);
},BigInt,console},{timeout:5000});
const audit=m.exports;
const actor={id:1,role:'FINANCE_ADMIN'};
function reset(){
  fixture={
    orders:[{id:1,order_code:'P0-FIN-READ',total_amount:'113.00',subtotal_amount:'100.00',delivery_fee:'10.00',buyer_platform_fee:'3.00',supplier_commission_percent:'2.50',payment_status:'PAID'}],
    payments:[{id:5,amount:'113.00',status:'PAID',transaction_ref:'track_p0'}],
    payables:[{id:7,order_id:1,payment_id:5,gross_amount:'100.00',delivery_fee_amount:'10.00',commission_rate_percent:'2.50',commission_amount:'2.50',net_payable_amount:'107.50',refund_deduction_amount:'0.00',held_amount:'0.00',available_amount:'107.50',disbursed_amount:'0.00',status:'ACCRUED'}],
    holds:[],refunds:[],instructions:[]
  };
}
async function main(){
  reset();queries=0;
  await assert.rejects(()=>audit.getOrderIntegrity({orderId:1,actor:{id:2,role:'BUYER'}}),e=>e.code==='FINANCIAL_AUDIT_FORBIDDEN');
  assert.equal(queries,0,'Unauthorized request must never touch database');
  await assert.rejects(()=>audit.getOrderIntegrity({orderId:'not-an-id',actor}),e=>e.code==='INVALID_ORDER_ID');
  let r=await audit.getOrderIntegrity({orderId:1,actor});
  assert.equal(r.status,'PASS',JSON.stringify(r.checks.filter(x=>!x.passed)));
  assert.ok(r.checks.length>=12);
  reset();fixture.orders[0].buyer_platform_fee='4.00';
  r=await audit.getOrderIntegrity({orderId:1,actor});
  assert.equal(r.status,'RECONCILIATION_REQUIRED');
  assert.equal(r.checks.find(x=>x.name==='BUYER_ORDER_COMPONENTS').passed,false);
  reset();fixture.orders[0].supplier_commission_percent=null;
  r=await audit.getOrderIntegrity({orderId:1,actor});
  assert.equal(r.checks.find(x=>x.name==='IMMUTABLE_SUPPLIER_COMMISSION').passed,false);
  reset();fixture.payables[0].available_amount='400.00';
  r=await audit.getOrderIntegrity({orderId:1,actor});
  assert.equal(r.checks.find(x=>x.name==='PAYABLE_CONSERVATION').passed,false);
  reset();fixture.refunds=[{id:9,payment_id:5,total_refund_amount:'120.00',assessed_refund_amount:'120.00',fee_refund_amount:'0.00',status:'CONFIRMED',currency:'PKR'}];
  r=await audit.getOrderIntegrity({orderId:1,actor});
  assert.equal(r.checks.find(x=>x.name==='CAPTURED_REFUND_CEILING').passed,false);
  reset();fixture.instructions=[{id:3,supplier_payable_id:7,external_execution_status:'EXECUTED',amount:'107.50',status:'APPROVED'}];
  r=await audit.getOrderIntegrity({orderId:1,actor});
  assert.equal(r.checks.find(x=>x.name==='NO_EXTERNAL_PAYOUT_EXECUTION').passed,false);
  assert.equal(updates,0,'Audit must never mutate any financial data');
  console.log('PASS FINANCE READ-ONLY CONTRACT: role denial, valid conservation, fee, commission, payable, refund, payout discrepancy; zero DB writes');
}
main().catch(e=>{console.error('FAIL FINANCE READ-ONLY CONTRACT',e.stack||e);process.exitCode=1});
