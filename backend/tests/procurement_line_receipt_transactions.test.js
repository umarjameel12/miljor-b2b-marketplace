'use strict';
// Deterministic transaction-double tests. No MySQL connection or fixtures.
// Real InnoDB/HTTP integration remains a separate gate after reviewed migration 097.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ProcurementLineReceiptService}=require('../src/services/procurementLineReceiptService');
const feePolicy={version:require('../src/services/procurementLineReceiptPolicy').FEE_POLICY_VERSION,accepted:true};
const actor={id:7,role:'BUYER'};
const line=(id,unit='bag',price='10.00')=>({id,quantity:'100.0000',purchasing_unit:unit,
 unit_price:price,subtotal:price==='10.00'?'1000.00':'2000.00',immutable_sku_snapshot:{}});
const claim=(id)=>({award_line_id:id,received_quantity:'80',accepted_quantity:'80',disputed_quantity:'20',reason:'QUANTITY_MISMATCH',evidence_notes:'20 units absent'});
function fixture(){
 const state={order:{id:1,buyer_id:7,supplier_id:19,payment_status:'PAID',fulfillment_status:'SUPPLIER_DELIVERED',currency:'PKR',subtotal_amount:'3000.00',total_amount:'3100.00'},
  payment:{id:5,amount:'3100.00'},lines:[line(11),line(12,'tin','20.00')],submissions:[],receipts:[],queries:[],rollbacks:0,releases:0};
 let queue=Promise.resolve();
 const database={async getConnection(){
  let unlock,snapshot,locked=false;
  const conn={
   async beginTransaction(){},
   async query(sql,args=[]){
    sql=sql.replace(/\s+/g,' ').trim();state.queries.push(sql);
    if(sql==='SELECT * FROM orders WHERE id=? FOR UPDATE'){
     const previous=queue;queue=new Promise(resolve=>{unlock=resolve;});await previous;locked=true;
     snapshot=structuredClone({order:state.order,submissions:state.submissions,receipts:state.receipts});
     return [[state.order]];
    }
    if(sql.startsWith('SELECT payload_hash'))return [state.submissions.filter(x=>x.key===args[2])];
    if(sql.startsWith('SELECT p.* FROM payments'))return [state.payment?[state.payment]:[]];
    if(sql.startsWith('SELECT al.*'))return [state.lines];
    if(sql.startsWith('SELECT * FROM procurement_line_receipts'))return [state.receipts];
    if(sql.startsWith('SELECT allocation_snapshot'))return [[]];
    if(sql.startsWith('INSERT INTO procurement_line_receipt_submissions')){
     state.submissions.push({key:args[3],payload_hash:args[4],response_snapshot:null});return [{insertId:state.submissions.length}];
    }
    if(sql.startsWith('UPDATE procurement_line_receipt_submissions')){state.submissions[args[1]-1].response_snapshot=args[0];return [{affectedRows:1}];}
    if(sql.startsWith('INSERT INTO procurement_line_receipts')){
     if(state.failInsert)throw Error('simulated evidence write failure');
     state.receipts.push({award_line_id:args[2],accepted_quantity:args[5],disputed_quantity:args[6],refund_assessment_amount:args[10]});return [{insertId:state.receipts.length}];
    }
    if(sql.startsWith('UPDATE orders SET')){
     if(state.failException)throw Error('simulated exception write failure');
     state.order.fulfillment_status='EXCEPTION';state.order.order_status='DISPUTED';return [{affectedRows:1}];
    }
    throw Error('Unexpected query: '+sql);
   },
   async commit(){if(locked){locked=false;unlock();}},
   async rollback(){state.rollbacks++;if(snapshot)Object.assign(state,snapshot);if(locked){locked=false;unlock();}},
   release(){state.releases++;}
  };return conn;
 }};
 return {state,service:new ProcurementLineReceiptService(database,{
  notifications:{async enqueueEvent(conn,event){state.notificationEvents??=[];state.notificationEvents.push(event);}},
  disputes:{async recordProcurementLineDisputeWithinTransaction(){return 1;}},
  finance:{async assessProcurementReceiptsWithinTransaction(){if(state.failFinancial)throw Error('simulated financial write failure');return {financial_status:'BLOCKED',financial_block_reason:'TEST_BOUNDARY_DOUBLE',refund_obligation_created:false,hold_applied:false,settlement_authorized:false,external_execution_status:'DISABLED'};}}
 })};
}
const request=(overrides={})=>({orderId:1,actor,lines:[claim(11),claim(12)],feePolicy,idempotencyKey:'receipt-1',...overrides});
test('mixed package lines remain separate; blocked assessment has no ledger/provider write',async()=>{
 const {state,service}=fixture();const {receipt}=await service.recordBuyerReceipt(request());
 assert.deepEqual(receipt.lines.map(x=>x.refund_assessment_amount),['200.00','400.00']);
 assert.equal(receipt.financial_status,'BLOCKED');assert.equal(receipt.hold_applied,false);
 assert.equal(receipt.refund_obligation_created,false);assert.equal(receipt.external_execution_status,'DISABLED');
 assert.equal(state.order.fulfillment_status,'EXCEPTION');assert.equal(state.receipts.length,2);
 assert.deepEqual(state.notificationEvents.map(event=>[event.userId,event.role,event.eventType,event.entityId]),[[7,'BUYER','PARTIAL_DELIVERY',1],[7,'BUYER','DISPUTE_OPENED',1],[19,'SUPPLIER','PARTIAL_DELIVERY',1],[19,'SUPPLIER','DISPUTE_OPENED',1]]);
 assert.equal(state.queries.some(sql=>/^(INSERT INTO|UPDATE) (refund_obligations|financial_holds|payments|supplier_payables)/.test(sql)),false);
 assert.match(state.queries[0],/orders .*FOR UPDATE/);
});
test('identical replay returns exact persisted response; changed evidence conflicts',async()=>{
 const {state,service}=fixture();const first=await service.recordBuyerReceipt(request());
 const replay=await service.recordBuyerReceipt(request());assert.equal(replay.is_replay,true);assert.deepEqual(replay.receipt,first.receipt);
 await assert.rejects(service.recordBuyerReceipt(request({lines:[{...claim(11),evidence_notes:'changed'},claim(12)]})),{code:'IDEMPOTENCY_PAYLOAD_MISMATCH'});
 assert.equal(state.receipts.length,2);
});
test('second key cannot create a duplicate claim or obligation',async()=>{
 const {state,service}=fixture();await service.recordBuyerReceipt(request());
 await assert.rejects(service.recordBuyerReceipt(request({idempotencyKey:'other'})),{code:'FINAL_LINE_RECEIPT_ALREADY_RECORDED'});
 assert.equal(state.receipts.length,2);assert.equal(state.submissions.length,1);
});
test('wrong buyer, wrong role, foreign line, unpaid and no provider evidence rejected',async()=>{
 for(const scenario of ['owner','role','foreign','unpaid','provider','early','overreceipt','capture','subtotal']){
  const {state,service}=fixture();const input=request();
  if(scenario==='owner')input.actor={...actor,id:8};
  if(scenario==='role')input.actor={...actor,role:'SUPPLIER'};
  if(scenario==='foreign')input.lines=[claim(999)];
  if(scenario==='unpaid')state.order.payment_status='PENDING';
  if(scenario==='provider')state.payment=null;
  if(scenario==='early')state.order.fulfillment_status='PREPARING';
  if(scenario==='overreceipt')input.lines=[{...claim(11),received_quantity:'101'}];
  if(scenario==='capture')state.payment.amount='1.00';
  if(scenario==='subtotal')state.order.subtotal_amount='1.00';
  await assert.rejects(service.recordBuyerReceipt(input),undefined,scenario);
  assert.equal(state.receipts.length,0,scenario);assert.equal(state.submissions.length,0,scenario);
 }
});
test('evidence and exception write failures roll back the entire receipt',async()=>{
 for(const flag of ['failInsert','failException','failFinancial']){
  const {state,service}=fixture();state[flag]=true;
  await assert.rejects(service.recordBuyerReceipt(request()),/simulated/);
  assert.equal(state.receipts.length,0);assert.equal(state.submissions.length,0);
  assert.equal(state.order.fulfillment_status,'SUPPLIER_DELIVERED');assert.equal(state.rollbacks,1);assert.equal(state.releases,1);
 }
});
test('concurrent same key serializes to one submission and one replay',async()=>{
 const {state,service}=fixture();const results=await Promise.all([service.recordBuyerReceipt(request()),service.recordBuyerReceipt(request())]);
 assert.deepEqual(results.map(x=>x.is_replay).sort(),[false,true]);assert.equal(state.submissions.length,1);assert.equal(state.receipts.length,2);
});
test('concurrent different keys cannot finalize the same line twice',async()=>{
 const {state,service}=fixture();const results=await Promise.allSettled([service.recordBuyerReceipt(request()),service.recordBuyerReceipt(request({idempotencyKey:'other'}))]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(state.submissions.length,1);
 assert.equal(results.find(x=>x.status==='rejected').reason.code,'FINAL_LINE_RECEIPT_ALREADY_RECORDED');
});
test('disjoint partial submissions append; full-acceptance hook rejects disputed or missing lines',async()=>{
 const {state,service}=fixture();await service.recordBuyerReceipt(request({lines:[claim(11)]}));
 await service.recordBuyerReceipt(request({lines:[claim(12)],idempotencyKey:'second'}));
 assert.equal(state.receipts.length,2);
 const conn=await service.db.getConnection();await conn.beginTransaction();await service._order(conn,1,7);
 await assert.rejects(service.assertFullyAcceptedWithinTransaction(conn,1),{code:'LINE_RECEIPTS_NOT_FULLY_ACCEPTED'});
 await conn.rollback();conn.release();
 const result=await service.getBuyerReceipts({orderId:1,actor});assert.equal(result.lines.length,2);
 await assert.rejects(service.getBuyerReceipts({orderId:1,actor:{...actor,id:99}}),{code:'ORDER_NOT_FOUND'});
});
test('all accepted receipts permit physical acceptance only, never settlement',async()=>{
 const {state,service}=fixture();const input=request({lines:[11,12].map(award_line_id=>({award_line_id,received_quantity:'100',accepted_quantity:'100',disputed_quantity:'0'}))});
 await service.recordBuyerReceipt(input);assert.equal(state.order.fulfillment_status,'SUPPLIER_DELIVERED');
 const conn=await service.db.getConnection();await conn.beginTransaction();await service._order(conn,1,7);
 const result=await service.assertFullyAcceptedWithinTransaction(conn,1);
 assert.equal(result.physical_receipts_accepted,true);assert.equal(result.settlement_authorized,false);
 await conn.commit();conn.release();
});
