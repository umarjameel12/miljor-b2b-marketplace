'use strict';
// Actual finance/dispute service methods with deterministic SQL transaction doubles.
// No database connection and no provider calls. Every SQL bind count is checked.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const policy=require('../src/services/procurementLineReceiptPolicy');
function loadService(name,database={}){
 const filename=path.join(__dirname,'../src/services',name);
 const m={exports:{}};
 const localRequire=id=>{
  if(id==='../config/db')return database;
  if(['./feeService','./reservationEventService','./notificationService','./supplierEligibilityPolicy'].includes(id))return {};
  return id.startsWith('.')?require(path.resolve(path.dirname(filename),id)):require(id);
 };
 new Function('require','module','exports',fs.readFileSync(filename,'utf8'))(localRequire,m,m.exports);
 return m.exports;
}
const actor={id:7,role:'BUYER'};
function fixture(){
 const lines=[{id:11,quantity:'100.0000',purchasing_unit:'bag',unit_price:'10.00',subtotal:'1000.00',immutable_sku_snapshot:{}},
  {id:12,quantity:'100.0000',purchasing_unit:'tin',unit_price:'20.00',subtotal:'2000.00',immutable_sku_snapshot:{}}];
 const receipts=lines.map((line,i)=>({...policy.assessLine(line,{award_line_id:line.id,received_quantity:'80',accepted_quantity:'80',disputed_quantity:'20',reason:'QUANTITY_MISMATCH',evidence_notes:'20 units missing'}),id:21+i,order_id:1}));
 const state={order:{id:1,buyer_id:7,supplier_id:8,order_code:'R4-TEST',payment_status:'PAID',fulfillment_status:'EXCEPTION',
  currency:'PKR',subtotal_amount:'3000.00',delivery_fee:'50.00',buyer_platform_fee:'20.00',total_amount:'3070.00',supplier_commission_percent:'2.50'},
  payment:{id:5,amount:'3070.00'},lines,receipts,consents:[{fee_policy_version:policy.FEE_POLICY_VERSION,fee_policy_accepted:1}],
  captures:[{id:5}],payables:[],holds:[],refunds:[],payouts:[],assessments:[],disputes:[{id:31,receiptId:21},{id:32,receiptId:22}],events:[],audit:[],writes:[]};
 const conn={
  async query(raw,args=[]){
   const sql=raw.replace(/\s+/g,' ').trim();
   assert.equal((sql.match(/\?/g)||[]).length,args.length,'SQL bind count: '+sql);
   if(sql==='SELECT * FROM orders WHERE id=? FOR UPDATE')return [[state.order]];
   if(sql.startsWith('SELECT p.*'))return [[state.payment]];
   if(sql.startsWith('SELECT al.*'))return [state.lines];
   if(sql.startsWith('SELECT * FROM procurement_receipt_financial_assessments'))return [state.assessments];
   if(sql.startsWith('SELECT * FROM procurement_line_receipts'))return [state.receipts];
   if(sql.startsWith('SELECT fee_policy_version'))return [state.consents];
   if(sql.startsWith('SELECT id FROM payments'))return [state.captures];
   if(sql.startsWith('SELECT * FROM supplier_payables WHERE order_id'))return [state.payables];
   if(sql.startsWith('SELECT id FROM financial_holds'))return [state.holds];
   if(sql.startsWith('SELECT id FROM refund_obligations'))return [state.refunds];
   if(sql.startsWith('SELECT id FROM supplier_disbursement_instructions'))return [state.payouts];
   if(sql.startsWith('SELECT id FROM order_disputes'))return [state.disputes.filter(row=>row.receiptId===args[0])];
   if(sql.startsWith('SELECT lr.*')){const row=state.receipts.find(row=>row.id===args[0]);return [row?[{...row,...{buyer_id:7,supplier_id:8,payment_status:'PAID'}}]:[]];}
   if(sql.startsWith('SELECT * FROM financial_holds WHERE id'))return [[state.holds[0]]];
   if(sql.startsWith('SELECT r.*, o.order_code'))return [[state.refunds[0]]];
   if(sql.startsWith('SELECT sp.*, o.order_code'))return [[state.payables[0]]];
   if(sql.startsWith('SELECT d.*, sp.order_id'))return [[{id:1,status:'PREPARED',receipt_policy_version:policy.FEE_POLICY_VERSION}]];
   if(sql.startsWith('INSERT')||sql.startsWith('UPDATE')){
    state.writes.push({sql,args});
    if(state.failOn&&sql.includes(state.failOn))throw Error('injected ledger write failure');
   }
   if(sql.startsWith('INSERT INTO supplier_payables')){
    state.payables.push({id:41,gross_amount:args[4],commission_rate_percent:args[5],commission_amount:args[6],
     net_payable_amount:args[7],available_amount:args[8],receipt_policy_version:args[9]});return [{insertId:41}];
   }
   if(sql.startsWith('UPDATE supplier_payables')){Object.assign(state.payables[0],{gross_amount:args[0],commission_rate_percent:args[1],commission_amount:args[2],net_payable_amount:args[3],available_amount:args[4],receipt_policy_version:args[5]});return [{affectedRows:1}];}
   if(sql.startsWith('INSERT INTO financial_holds')){
    const goods=sql.includes('procurement_line_receipt_id');
    const row={id:state.holds.length+51,supplier_payable_id:null,hold_amount:args[goods?3:2],
     procurement_line_receipt_id:goods?args[6]:null,receipt_policy_version:policy.FEE_POLICY_VERSION,status:'ACTIVE'};
    state.holds.push(row);return [{insertId:row.id}];
   }
   if(sql.startsWith('INSERT INTO refund_obligations')){
    const row={id:state.refunds.length+61,procurement_line_receipt_id:args[10],assessed_refund_amount:args[6],
     total_refund_amount:args[7],fee_refund_amount:'0.00',status:'REQUESTED',external_execution_status:'DISABLED'};
    state.refunds.push(row);return [{insertId:row.id}];
   }
   if(sql.startsWith('INSERT INTO procurement_receipt_financial_assessments')){state.assessments.push({id:71,allocation_snapshot:args[4],prior_payable_snapshot:args[5]});return [{insertId:71}];}
   if(sql.startsWith('INSERT INTO financial_audit_events')){state.audit.push(args);return [{insertId:81}];}
   if(sql.startsWith('INSERT INTO order_disputes')){const row={id:state.disputes.length+31,receiptId:args.at(-1)};state.disputes.push(row);return [{insertId:row.id}];}
   if(sql.startsWith('INSERT INTO order_dispute_events')){state.events.push(args);return [{insertId:91}];}
   throw Error('Unexpected SQL: '+sql);
  },async beginTransaction(){},async rollback(){},async commit(){},release(){}
 };
 const finance=loadService('financialSettlementService.js',{getConnection:async()=>conn});
 return {state,conn,finance,disputes:loadService('disputeService.js')};
}
const allocate=f=>f.finance.assessProcurementReceiptsWithinTransaction(f.conn,{orderId:1,actor});
test('actual financial service creates accepted-only payable, line refund reservations and held fees',async()=>{
 const f=fixture(),result=await allocate(f);
 assert.equal(result.accepted_supplier_net,'2340.00');assert.equal(result.accepted_commission_amount,'60.00');
 assert.equal(result.allocated_captured_amount,'3070.00');assert.equal(result.financial_status,'INTERNAL_RECORDED');
 assert.equal(result.settlement_authorized,false);assert.equal(result.hold_applied,true);
 assert.deepEqual(f.state.refunds.map(row=>row.total_refund_amount),['200.00','400.00']);
 assert.deepEqual(f.state.holds.map(row=>row.hold_amount),['200.00','400.00','50.00','20.00']);
 assert.equal(f.state.holds.every(row=>row.supplier_payable_id===null),true);
 assert.equal(f.state.payables[0].gross_amount,'2400.00');assert.equal(f.state.payables[0].commission_amount,'60.00');
 assert.equal(f.state.audit.length,1);assert.equal(f.state.writes.some(row=>/UPDATE (orders|invoices|payments)/.test(row.sql)),false);
 const writes=f.state.writes.length;const replay=await allocate(f);assert.equal(replay.is_replay,true);assert.equal(f.state.writes.length,writes);
});
test('pristine original payable is rebased with append-only prior evidence, not invoice changes',async()=>{
 const f=fixture();f.state.payables=[{id:41,payment_id:5,supplier_id:8,currency:'PKR',status:'ACCRUED',gross_amount:'3000.00',delivery_fee_amount:'50.00',
  commission_rate_percent:'2.50',commission_amount:'75.00',net_payable_amount:'2975.00',available_amount:'2975.00',held_amount:'0.00',refund_deduction_amount:'0.00',disbursed_amount:'0.00'}];
 await allocate(f);assert.equal(JSON.parse(f.state.assessments[0].prior_payable_snapshot).gross_amount,'3000.00');
 assert.equal(f.state.payables[0].gross_amount,'2400.00');
});
test('partial evidence, absent consent and existing reservations block ledger writes',async()=>{
 for(const scenario of ['partial','consent','hold','refund','payout','doublecapture','rate']){
  const f=fixture();
  if(scenario==='partial')f.state.receipts.pop();
  if(scenario==='consent')f.state.consents[0].fee_policy_accepted=0;
  if(scenario==='hold')f.state.holds.push({id:2});
  if(scenario==='refund')f.state.refunds.push({id:2});
  if(scenario==='payout')f.state.payouts.push({id:2});
  if(scenario==='doublecapture')f.state.captures.push({id:6});
  if(scenario==='rate')f.state.order.supplier_commission_percent=null;
  assert.equal((await allocate(f)).financial_status,'BLOCKED',scenario);assert.equal(f.state.writes.length,0,scenario);
 }
});
test('fully accepted undisputed receipts preserve canonical settlement without any ledger writes',async()=>{
 const f=fixture();f.state.receipts=f.state.lines.map((line,i)=>({...policy.assessLine(line,{award_line_id:line.id,
  received_quantity:'100',accepted_quantity:'100',disputed_quantity:'0'}),id:21+i,order_id:1}));
 const result=await allocate(f);
 assert.equal(result.financial_status,'CANONICAL_FULL_RECEIPT');assert.equal(result.hold_applied,false);
 assert.equal(result.delivery_fee_hold,'0.00');assert.equal(result.processing_fee_hold,'0.00');
 assert.equal(result.accepted_supplier_net,'2975.00');assert.equal(result.recognized_buyer_platform_fee,'20.00');
 assert.equal(result.allocated_captured_amount,'3070.00');assert.equal(result.settlement_authorized,false);
 assert.equal(f.state.writes.length,0);assert.equal(f.state.payables.length,0);assert.equal(f.state.assessments.length,0);
});
test('line dispute creation derives owned immutable quantities and is idempotent',async()=>{
 const f=fixture();f.state.disputes=[];
 const id=await f.disputes.recordProcurementLineDisputeWithinTransaction(f.conn,{receiptId:21,actor});
 assert.equal(await f.disputes.recordProcurementLineDisputeWithinTransaction(f.conn,{receiptId:21,actor}),id);
 assert.equal(f.state.disputes.length,1);assert.equal(f.state.events.length,1);
 const args=f.state.writes.find(row=>row.sql.startsWith('INSERT INTO order_disputes')).args;
 assert.equal(args[8],'100.0000');assert.equal(args[10],'20.0000');assert.equal(args[11],'200.00');
 await assert.rejects(f.disputes.recordProcurementLineDisputeWithinTransaction(f.conn,{receiptId:21,actor:{id:99,role:'BUYER'}}),{code:'FORBIDDEN'});
});
test('legacy approval/release/preparation cannot consume receipt-linked money',async()=>{
 const f=fixture();await allocate(f);
 const admin={id:1,role:'ADMIN'};
 await assert.rejects(f.finance.releaseFinancialHold({holdId:51,actor:admin}),{code:'LINE_FINANCIAL_ADMIN_REVIEW_REQUIRED'});
 await assert.rejects(f.finance.approveRefundObligation({refundId:61,actor:admin}),{code:'LINE_FINANCIAL_ADMIN_REVIEW_REQUIRED'});
 await assert.rejects(f.finance.prepareSupplierDisbursement({payableId:41,beneficiaryTitle:'Test Supplier',beneficiaryIban:'PK'+'1'.repeat(22),actor:admin}),{code:'LINE_PARTIAL_RELEASE_VALIDATOR_REQUIRED'});
 await assert.rejects(f.finance.approveSupplierDisbursement({disbursementId:1,actor:admin}),{code:'LINE_FINANCIAL_ADMIN_REVIEW_REQUIRED'});
});
test('audit failure propagates to enclosing receipt transaction; no nested commit',async()=>{
 const f=fixture();let commits=0;f.conn.commit=async()=>{commits++;};f.state.failOn='INSERT INTO financial_audit_events';
 await assert.rejects(allocate(f),/injected ledger write failure/);
 assert.equal(commits,0);
});
