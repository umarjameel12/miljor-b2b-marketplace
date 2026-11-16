'use strict';
// Real SQL inside caller's outer rollback. Synthetic HMACs are not provider proof.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fingerprint,sum}=require('../src/services/procurementSettlementReviewPolicy');
const intent=()=>crypto.randomUUID(),denied=(action,code)=>assert.rejects(action,error=>error.code===code);
async function financeAdmin(conn){const [user]=await conn.query("INSERT INTO users(full_name,email,role,is_verified,verification_status) VALUES ('Rollback financial reviewer',?,'FINANCE_ADMIN',1,'VERIFIED')",['closing-'+intent()+'@example.invalid']);return {id:user.insertId,role:'FINANCE_ADMIN'};}
async function withDatabase(db,adapter,action){const query=db.query,get=db.getConnection;db.query=adapter.query;db.getConnection=adapter.getConnection;try{return await action();}finally{db.query=query;db.getConnection=get;}}
exports.individualPricing=async({conn,oid,buyerId,supplierId,addressId,clusterId,pass})=>{
 const settings=require('../src/services/supplierDeliveryService'),engine=require('../src/services/deliveryEligibilityService'),binding=require('../src/services/procurementDeliveryBindingService');
 const payload={standard_delivery_enabled:true,pickup_enabled:false,express_enabled:false,individual_delivery_enabled:false,cluster_rates:[{cluster_id:clusterId,mode:'INDIVIDUAL',fee_pkr:'345.67',is_eligible:true}]},params={supplier_id:supplierId,cluster_id:clusterId,address_id:addressId};
 await settings.updateSupplierSettings(supplierId,payload,conn);
 assert.equal((await engine.getDeliveryOptions(buyerId,params,conn,{procurement:true})).eligible_modes.some(row=>row.mode==='INDIVIDUAL'),false);
 await settings.updateSupplierSettings(supplierId,{...payload,individual_delivery_enabled:true},conn);
 assert.equal((await engine.getDeliveryOptions(buyerId,params,conn)).eligible_modes.some(row=>row.mode==='INDIVIDUAL'),false);
 const available=await engine.getDeliveryOptions(buyerId,params,conn,{procurement:true});assert.equal(String(available.eligible_modes.find(row=>row.mode==='INDIVIDUAL').fee_pkr),'345.67');
 const quote=await engine.createAuthoritativeQuote(buyerId,{...params,mode:'INDIVIDUAL'},conn,{procurement:true});
 const [[source]]=await conn.query('SELECT a.request_id,al.quote_id FROM procurement_award_orders ao JOIN procurement_awards a ON a.id=ao.award_id JOIN procurement_award_lines al ON al.award_order_id=ao.id WHERE ao.order_id=? LIMIT 1',[oid]);
 await conn.query('UPDATE delivery_quotes SET procurement_request_id=?,procurement_quote_id=? WHERE quote_code=?',[source.request_id,source.quote_id,quote.quote_code]);
 const input={buyerId,supplierId,requestId:source.request_id,quoteId:source.quote_id,code:quote.quote_code,fee:'345.67'};
 assert.equal((await binding.validate(conn,input)).mode,'INDIVIDUAL');await denied(()=>binding.validate(conn,{...input,fee:'0'}),'DELIVERY_FEE_MISMATCH');
 await conn.query("UPDATE supplier_delivery_cluster_rates SET version=version+1 WHERE supplier_id=? AND cluster_id=? AND mode='INDIVIDUAL'",[supplierId,clusterId]);await denied(()=>binding.validate(conn,input),'DELIVERY_REAPPROVAL_REQUIRED');
 pass('R6 real SQL: opt-in individual cluster pricing, procurement-only quote, saved address/rate locks and changed fee/version rejection');
};
exports.supplemental=async({conn,db,adapter,oid,attemptId,buyer,supplier,receipts,attempts,pass})=>{
 await conn.query('SAVEPOINT supplemental_scenario');
 try{
  const {ProcurementDeliveryPaymentService}=require('../src/services/procurementDeliveryPaymentService');
  const fakeProvider={validateConfig(){},async createTracker(){return {trackerToken:'track_supplemental_'+intent(),rawResponse:{synthetic:true}};},constructCheckoutUrl({trackerToken}){return 'https://sandbox.api.getsafepay.com/checkout/pay?tracker='+trackerToken;}};
  const payments=new ProcurementDeliveryPaymentService(adapter,fakeProvider),body={proposal_version:1,accepted_extra_fee:'10.00',explicit_payment_consent:true},paymentKey=intent(),admin=await financeAdmin(conn);
  const before=(await conn.query('SELECT subtotal_amount,delivery_fee,buyer_platform_fee,total_amount,supplier_commission_percent,payment_status FROM orders WHERE id=?',[oid]))[0][0];
  const savedFlag=process.env.B6_FINANCIAL_GATE_ENABLED;process.env.B6_FINANCIAL_GATE_ENABLED='false';await denied(()=>payments.initiate(buyer,oid,attemptId,body,paymentKey),'B6_FINANCIAL_GATE_BLOCKED');process.env.B6_FINANCIAL_GATE_ENABLED=savedFlag;
  for(const kind of ['definite','uncertain','outbox']){
   await conn.query('SAVEPOINT init_recovery');let calls=0;
   const provider={...fakeProvider,async createTracker(){calls++;if(kind==='outbox')return {trackerToken:'track_recovery_'+intent()};throw Object.assign(Error('Synthetic initialization '+kind),{code:'SAFEPAY_API_ERROR',providerStatusCode:kind==='definite'?401:undefined});}};
   const recovery=new ProcurementDeliveryPaymentService(adapter,provider,kind==='outbox'?{enqueueEvent:async()=>{throw Error('init outbox failed');}}:undefined);
   await assert.rejects(()=>recovery.initiate(buyer,oid,attemptId,body,intent()));
   const failed=await payments.get(buyer,oid,attemptId);assert.equal(failed.status,kind==='definite'?'APPROVED':'RECONCILIATION_REQUIRED');
   if(kind==='definite'){const retry=await payments.initiate(buyer,oid,attemptId,body,intent());assert.equal(retry.status,'PAYMENT_PENDING');const [history]=await conn.query('SELECT status FROM payment_attempts WHERE procurement_delivery_contract_id=? ORDER BY id',[retry.contract_id]);assert.deepEqual(history.map(row=>row.status),['FAILED','INITIATED']);}
   else if(kind==='uncertain'){assert.equal((await recovery.initiate(buyer,oid,attemptId,body,intent())).is_replay,true);assert.equal(calls,1);}
   else{const [[retained]]=await conn.query('SELECT provider_tracker_token FROM payment_attempts WHERE procurement_delivery_contract_id=?',[failed.id]);assert.match(retained.provider_tracker_token,/^track_recovery_/);}
   await conn.query('ROLLBACK TO SAVEPOINT init_recovery');await conn.query('RELEASE SAVEPOINT init_recovery');
  }
  await denied(()=>payments.initiate(supplier,oid,attemptId,body,paymentKey),'BUYER_REQUIRED');
  await denied(()=>payments.initiate(buyer,oid,attemptId,{...body,accepted_extra_fee:'1'},paymentKey),'SUPPLEMENTAL_CONSENT_STALE');
  const staged=await payments.initiate(buyer,oid,attemptId,body,paymentKey);assert.equal(staged.status,'PAYMENT_PENDING');assert.equal((await payments.initiate(buyer,oid,attemptId,body,paymentKey)).contract_id,staged.contract_id);
  const [[attempt]]=await conn.query('SELECT * FROM payment_attempts WHERE procurement_delivery_contract_id=?',[staged.contract_id]);
  const gateway=require('../src/services/safepayAdapter'),originalSecret=gateway.webhookSecret;gateway.webhookSecret='rollback-only-hmac-'+intent();
  try{await withDatabase(db,adapter,async()=>{
   const send=async(amount,eventId='supplemental-'+intent(),signatureOverride=null)=>{const payload={type:'payment.succeeded',data:{tracker:{token:attempt.provider_tracker_token,amount:Number(amount),currency:'PKR'}}},raw=JSON.stringify(payload);return require('../src/services/safepayCheckoutService').processWebhookEvent({rawBody:raw,signature:signatureOverride||crypto.createHmac('sha512',gateway.webhookSecret).update(raw).digest('hex'),timestamp:new Date().toISOString(),eventId,eventType:payload.type});};
   await denied(()=>send('10.00',undefined,'invalid'),'INVALID_WEBHOOK_SIGNATURE');await denied(()=>send('9.99'),'AMOUNT_MISMATCH');
   const eventId='supplemental-'+intent();const captured=await send('10.00',eventId);assert.equal(captured.status,'PAID');assert.equal((await send('10.00',eventId)).is_duplicate,true);assert.equal((await send('10.00')).is_duplicate,true);
  });}finally{gateway.webhookSecret=originalSecret;}
  assert.equal((await conn.query('SELECT COUNT(*) n FROM payments WHERE procurement_delivery_contract_id=?',[staged.contract_id]))[0][0].n,1);
  assert.deepEqual((await conn.query('SELECT subtotal_amount,delivery_fee,buyer_platform_fee,total_amount,supplier_commission_percent,payment_status FROM orders WHERE id=?',[oid]))[0][0],before);
  const contract=await payments.get(buyer,oid,attemptId);assert.equal(contract.status,'PAID');await attempts.resume(supplier,oid,attemptId,intent());
  await denied(()=>payments.reviewFee(admin,contract.id,{contract_hash:'bad',refund_amount:'0',notes:'Test review after real receipt'},intent()),'DELIVERY_FEE_REVIEW_INVALID');
  const preview=await payments.reviewPreview(admin,contract.id);
  await denied(()=>payments.reviewFee(admin,contract.id,{contract_hash:preview.contract_hash,refund_amount:'0',notes:'Retain fee after fulfillment evidence'},intent()),'DELIVERY_FEE_FULFILLMENT_REQUIRED');
  await conn.query("UPDATE orders SET fulfillment_status='SUPPLIER_DELIVERED',supplier_delivered_at=UTC_TIMESTAMP() WHERE id=?",[oid]);
  await conn.query('SAVEPOINT partial_supplement');
  const originalLines=await receipts.getBuyerReceipts({orderId:oid,actor:buyer});
  await receipts.recordBuyerReceipt({orderId:oid,actor:buyer,idempotencyKey:intent(),feePolicy:{version:'R4_ACCEPTED_MERCHANDISE_V1',accepted:true},lines:originalLines.lines.map(line=>({award_line_id:line.award_line_id,received_quantity:'1',accepted_quantity:'1',disputed_quantity:'1',reason:'QUANTITY_MISMATCH',evidence_notes:'Partial receipt after separately paid reattempt'}))});
  const {ProcurementSettlementReviewService}=require('../src/services/procurementSettlementReviewService'),partialReview=new ProcurementSettlementReviewService(adapter),partialPreview=await partialReview.preview(admin,oid);
  const partialDecision=await partialReview.approve(admin,oid,{assessment_hash:partialPreview.assessment_hash,delivery_refund_amount:'0',processing_refund_amount:'0',approve_disputed_merchandise_refunds:true,notes:'Accepted one bag after paid reattempt; original disputed merchandise reserved'},intent());
  await payments.reviewFee(admin,contract.id,{contract_hash:preview.contract_hash,refund_amount:'0',notes:'Retain approved reattempt fee after final partial receipt'},intent());
  await withDatabase(db,adapter,async()=>{const payable=(await conn.query('SELECT * FROM supplier_payables WHERE order_id=?',[oid]))[0][0];const prepared=await require('../src/services/financialSettlementService').prepareSupplierDisbursement({payableId:payable.id,beneficiaryTitle:'Rollback Supplier',beneficiaryIban:'PK'+'1'.repeat(22),actor:admin,idempotencyKey:intent()});assert.equal(prepared.data.disbursement.amount,sum([partialDecision.supplier_entitlement,'10.00']));await require('../src/services/financialSettlementService').approveSupplierDisbursement({disbursementId:prepared.data.disbursement.id,actor:admin});});
  await conn.query('ROLLBACK TO SAVEPOINT partial_supplement');await conn.query('RELEASE SAVEPOINT partial_supplement');
  const lines=await receipts.getBuyerReceipts({orderId:oid,actor:buyer});await receipts.recordBuyerReceipt({orderId:oid,actor:buyer,idempotencyKey:intent(),feePolicy:{version:'R4_ACCEPTED_MERCHANDISE_V1',accepted:true},lines:lines.lines.map(line=>({award_line_id:line.award_line_id,received_quantity:line.ordered_quantity,accepted_quantity:line.ordered_quantity,disputed_quantity:'0'}))});
  await new (require('../src/services/fulfillmentService').FulfillmentService)(adapter).confirmBuyerReceipt({orderId:oid,actor:buyer,idempotencyKey:intent()});
  const reviewInput={contract_hash:preview.contract_hash,refund_amount:'2.00',notes:'Delivered reattempt verified; refund two rupees of fee'},reviewKey=intent();
  const reviewed=await payments.reviewFee(admin,contract.id,reviewInput,reviewKey);assert.equal(reviewed.supplier_amount,'8.00');assert.equal(reviewed.refund_amount,'2.00');assert.equal((await payments.reviewFee(admin,contract.id,reviewInput,reviewKey)).is_replay,true);
  const [payables]=await conn.query('SELECT * FROM supplier_payables WHERE order_id=?',[oid]);assert.equal(payables.length,1);assert.equal(payables[0].delivery_fee_amount,sum([before.delivery_fee,'8.00']));
  await withDatabase(db,adapter,async()=>{const finance=require('../src/services/financialSettlementService'),input={payableId:payables[0].id,beneficiaryTitle:'Rollback Full Supplier',beneficiaryIban:'PK'+'2'.repeat(22),actor:admin,idempotencyKey:intent()};const prepared=await finance.prepareSupplierDisbursement(input);assert.equal((await finance.prepareSupplierDisbursement(input)).is_replay,true);await denied(()=>finance.prepareSupplierDisbursement({...input,idempotencyKey:intent()}),'DISBURSEMENT_ALREADY_RESERVED');await finance.approveSupplierDisbursement({disbursementId:prepared.data.disbursement.id,actor:admin});});
  const audit=await withDatabase(db,adapter,()=>require('../src/services/financialConservationService').getOrderIntegrity({orderId:oid,actor:admin}));assert.equal(audit.status,'PASS',JSON.stringify(audit.checks.filter(row=>!row.passed)));
  pass('R6 real SQL: B6-gated separate fee, actual HMAC rejection/capture/replay, original money unchanged, paid reattempt recovery, final fee review and conservation');
 }finally{await conn.query('ROLLBACK TO SAVEPOINT supplemental_scenario');await conn.query('RELEASE SAVEPOINT supplemental_scenario');}
};
exports.partialReview=async({conn,db,adapter,oid,buyer,pass})=>{
 const {ProcurementSettlementReviewService}=require('../src/services/procurementSettlementReviewService'),service=new ProcurementSettlementReviewService(adapter),admin=await financeAdmin(conn),finance=require('../src/services/financialSettlementService');
 const preview=await service.preview(admin,oid),input={assessment_hash:preview.assessment_hash,delivery_refund_amount:'5.00',processing_refund_amount:'0.00',approve_disputed_merchandise_refunds:true,notes:'Reviewed accepted product value and failed delivery fee evidence'},key=intent();
 await denied(()=>service.approve(buyer,oid,input,key),'FINANCIAL_ADMIN_REQUIRED');
 await denied(()=>service.approve(admin,oid,{...input,assessment_hash:'bad'},key),'ASSESSMENT_CHANGED');
 await denied(()=>service.approve(admin,oid,{...input,delivery_refund_amount:'9999'},key),'FEE_REFUND_EXCEEDS_CAPTURE');
 const bad=new ProcurementSettlementReviewService(adapter,{enqueueEvent:async()=>{throw Error('review outbox rollback');}});await assert.rejects(()=>bad.approve(admin,oid,input,intent()),/review outbox rollback/);
 assert.equal((await conn.query('SELECT COUNT(*) n FROM procurement_settlement_reviews WHERE order_id=?',[oid]))[0][0].n,0);
 assert.ok((await conn.query('SELECT status FROM financial_holds WHERE order_id=?',[oid]))[0].every(row=>row.status==='ACTIVE'));
 const reviewed=await service.approve(admin,oid,input,key);assert.equal((await service.approve(admin,oid,input,key)).is_replay,true);await denied(()=>service.approve(admin,oid,{...input,notes:'Changed evidence should not replace review'},key),'REVIEW_ALREADY_FINAL');
 assert.equal(sum([reviewed.supplier_entitlement,reviewed.platform_entitlement,reviewed.total_refund]),reviewed.captured_amount);
 const payable=(await conn.query('SELECT * FROM supplier_payables WHERE order_id=?',[oid]))[0][0];
 const payout={payableId:payable.id,beneficiaryTitle:'Rollback Supplier',beneficiaryIban:'PK'+'1'.repeat(22),actor:admin,idempotencyKey:intent()};
 await withDatabase(db,adapter,async()=>{
  const prepared=await finance.prepareSupplierDisbursement(payout);assert.equal(prepared.data.disbursement.amount,reviewed.supplier_entitlement);assert.equal(prepared.data.disbursement.external_execution_status,'DISABLED');
  assert.equal((await finance.prepareSupplierDisbursement(payout)).is_replay,true);await denied(()=>finance.prepareSupplierDisbursement({...payout,idempotencyKey:intent()}),'REVIEW_DISBURSEMENT_ALREADY_RESERVED');
  const approved=await finance.approveSupplierDisbursement({disbursementId:prepared.data.disbursement.id,actor:admin});assert.equal(approved.data.disbursement.status,'APPROVED');assert.equal((await finance.approveSupplierDisbursement({disbursementId:prepared.data.disbursement.id,actor:admin})).is_replay,true);
  const audit=await require('../src/services/financialConservationService').getOrderIntegrity({orderId:oid,actor:admin});assert.equal(audit.status,'PASS',JSON.stringify(audit.checks.filter(row=>!row.passed)));
 });
 assert.equal((await conn.query('SELECT fulfillment_status FROM orders WHERE id=?',[oid]))[0][0].fulfillment_status,'EXCEPTION');
 pass('R6 real SQL: finance-only exact partial fee review, outbox/ledger rollback, immutable decision, bounded one-time payout reservation/approval and conservation; external execution DISABLED');
};
