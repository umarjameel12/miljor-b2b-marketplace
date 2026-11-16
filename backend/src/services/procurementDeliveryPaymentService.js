'use strict';
const crypto=require('node:crypto'),db=require('../config/db'),adapter=require('./safepayAdapter'),notification=require('./notificationService'),exact=require('./exactDecimal');
const {fail,money,sum,sub,fingerprint}=require('./procurementSettlementReviewPolicy'),{id}=require('./procurementLineReceiptPolicy');
const {initializationDisposition}=require('./procurementDeliveryPaymentPolicy');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
class ProcurementDeliveryPaymentService{
 constructor(database=db,provider=adapter,notifier=notification){this.db=database;this.provider=provider;this.notifier=notifier;}
 _gate(){if(process.env.B6_FINANCIAL_GATE_ENABLED!=='true'||process.env.B6_B5_INVENTORY_RECONCILED!=='true'||process.env.B6_TAX_POLICY_APPROVED!=='true')throw fail('B6_FINANCIAL_GATE_BLOCKED','Existing B6 inventory, tax and financial gates must be approved',503);if(!['test','sandbox'].includes(process.env.NODE_ENV)||(process.env.NODE_ENV==='test'&&process.env.DB_NAME!=='miljor_test_db'))throw fail('B6_FINANCIAL_ENVIRONMENT_BLOCKED','Only approved isolated test/sandbox financial runtime is allowed',503);this.provider.validateConfig();}
 _buyer(actor){if(actor?.role!=='BUYER')throw fail('BUYER_REQUIRED','Owning buyer required',403);return id(actor.id);}
 async _transaction(action){const conn=await this.db.getConnection();try{await conn.beginTransaction();const result=await action(conn);await conn.commit();return result;}catch(error){await conn.rollback();throw error;}finally{conn.release();}}
 async get(actor,orderId,attemptId){const buyer=this._buyer(actor),oid=id(orderId),aid=id(attemptId);const [rows]=await this.db.query('SELECT c.id,c.contract_code,c.amount,c.currency,c.status,c.proposal_version,c.review_snapshot,pa.checkout_url,pa.status AS payment_attempt_status FROM procurement_delivery_payment_contracts c JOIN orders o ON o.id=c.order_id LEFT JOIN payment_attempts pa ON pa.procurement_delivery_contract_id=c.id WHERE c.order_id=? AND c.delivery_attempt_id=? AND c.buyer_id=? AND o.buyer_id=c.buyer_id ORDER BY c.proposal_version DESC,pa.id DESC LIMIT 1',[oid,aid,buyer]);return rows[0]||null;}
 async initiate(actor,orderId,attemptId,input,rawKey,{mockClient=null}={}){
  const buyer=this._buyer(actor),oid=id(orderId),aid=id(attemptId);this._gate();
  if(!input||Object.keys(input).some(field=>!['proposal_version','accepted_extra_fee','explicit_payment_consent'].includes(field))||input.explicit_payment_consent!==true||!Number.isSafeInteger(input.proposal_version)||typeof rawKey!=='string'||!/^[A-Za-z0-9:_-]{12,100}$/.test(rawKey))throw fail('SUPPLEMENTAL_CONSENT_REQUIRED','Approve exact proposed fee and use a stable payment intent',400);
  const fee=money(input.accepted_extra_fee);
  const staged=await this._transaction(async conn=>{
   const [orders]=await conn.query('SELECT * FROM orders WHERE id=? AND buyer_id=? FOR UPDATE',[oid,buyer]);const order=orders[0];if(!order)throw fail('ORDER_NOT_FOUND','Own order not found',404);
   await require('./procurementRecurringService')._verified(conn,buyer);
   const [attempts]=await conn.query('SELECT * FROM procurement_delivery_attempts WHERE id=? AND order_id=? FOR UPDATE',[aid,oid]);const attempt=attempts[0];
   if(!attempt||attempt.status!=='APPROVED_PAYMENT_REQUIRED'||Number(attempt.proposal_version)!==input.proposal_version||money(attempt.extra_fee)!==fee||fee==='0.00'||Number(parse(attempt.buyer_consent_snapshot)?.buyer_id)!==buyer||order.payment_status!=='PAID'||order.fulfillment_status!=='EXCEPTION'||order.exception_reason!=='SUPPLIER_LOGISTICS_FAILURE')throw fail('SUPPLEMENTAL_CONSENT_STALE','Current owning-buyer approved failed-delivery fee is required');
   const [existing]=await conn.query('SELECT c.*,pa.id AS payment_attempt_id,pa.checkout_url,pa.status AS latest_attempt_status FROM procurement_delivery_payment_contracts c LEFT JOIN payment_attempts pa ON pa.procurement_delivery_contract_id=c.id WHERE c.delivery_attempt_id=? AND c.proposal_version=? ORDER BY pa.id DESC LIMIT 1 FOR UPDATE',[aid,input.proposal_version]);
   if(existing.length&&!(existing[0].status==='APPROVED'&&existing[0].latest_attempt_status==='FAILED'))return {existing:existing[0]};
   const [[clock]]=await conn.query('SELECT ?>UTC_TIMESTAMP() live',[attempt.proposed_start_utc]);if(Number(clock.live)!==1)throw fail('REATTEMPT_WINDOW_EXPIRED','The approved delivery slot has expired');
   const consent={...input,buyer_id:buyer,delivery_attempt_id:aid,proposal:parse(attempt.proposal_snapshot),intent_key:rawKey,order_money_unchanged:true};
   let contractId=existing[0]?.id;
   if(contractId)await conn.query("UPDATE procurement_delivery_payment_contracts SET status='INITIALIZING' WHERE id=? AND status='APPROVED'",[contractId]);
   else{const [contract]=await conn.query("INSERT INTO procurement_delivery_payment_contracts(contract_code,order_id,delivery_attempt_id,proposal_version,buyer_id,supplier_id,amount,currency,consent_snapshot,status) VALUES (?,?,?,?,?,?,?,'PKR',?,'INITIALIZING')",['DP-'+crypto.randomUUID(),oid,aid,input.proposal_version,buyer,order.supplier_id,fee,JSON.stringify(consent)]);contractId=contract.insertId;}
   const [paymentAttempt]=await conn.query("INSERT INTO payment_attempts(attempt_code,order_id,buyer_id,provider,environment,amount,currency,status,idempotency_key,procurement_delivery_contract_id) VALUES (?,?,?,'SAFEPAY','sandbox',?,'PKR','INITIATED',?,?)",['DA-'+crypto.randomUUID().slice(0,30),oid,buyer,fee,rawKey,contractId]);
   return {contract_id:contractId,payment_attempt_id:paymentAttempt.insertId,order_code:order.order_code};
  });
  if(staged.existing)return {contract_id:staged.existing.id,status:staged.existing.status,checkout_url:staged.existing.checkout_url||null,is_replay:true,original_order_changed:false};
  let knownTracker=null,knownCheckoutUrl=null;
  try{
   const tracker=await this.provider.createTracker({amount:Number(fee),currency:'PKR',orderCode:'DELIVERY-'+staged.contract_id,mockClient});
   knownTracker=tracker.trackerToken;
   const front=process.env.APP_FRONTEND_URL||process.env.FRONTEND_URL||'http://localhost:3000';
   const checkoutUrl=this.provider.constructCheckoutUrl({trackerToken:tracker.trackerToken,orderCode:'DELIVERY-'+staged.contract_id,redirectUrl:front+'/orders?delivery_contract='+staged.contract_id,cancelUrl:front+'/orders?delivery_contract='+staged.contract_id});
   knownCheckoutUrl=checkoutUrl;
   await this._transaction(async conn=>{
    const [attempts]=await conn.query('SELECT * FROM payment_attempts WHERE id=? FOR UPDATE',[staged.payment_attempt_id]);if(attempts[0]?.status!=='INITIATED')throw fail('PAYMENT_ATTEMPT_CHANGED','Payment attempt changed while provider session was created');
    await conn.query('UPDATE payment_attempts SET provider_tracker_token=?,checkout_url=? WHERE id=?',[tracker.trackerToken,checkoutUrl,staged.payment_attempt_id]);
    await conn.query("UPDATE procurement_delivery_payment_contracts SET status='PAYMENT_PENDING' WHERE id=? AND status='INITIALIZING'",[staged.contract_id]);
    await this.notifier.enqueueEvent(conn,{userId:buyer,role:'BUYER',eventType:'PAYMENT_INITIATED',eventKey:'delivery-contract:'+staged.contract_id+':initiated',entityId:oid});
   });return {contract_id:staged.contract_id,status:'PAYMENT_PENDING',checkout_url:checkoutUrl,is_replay:false,original_order_changed:false};
  }catch(error){
   await this._transaction(async conn=>{
    await conn.query('SELECT id FROM payment_attempts WHERE id=? FOR UPDATE',[staged.payment_attempt_id]);
    if(knownTracker)await conn.query("UPDATE payment_attempts SET provider_tracker_token=COALESCE(provider_tracker_token,?),checkout_url=COALESCE(checkout_url,?) WHERE id=? AND status='INITIATED'",[knownTracker,knownCheckoutUrl,staged.payment_attempt_id]);
    const disposition=initializationDisposition(error,knownTracker);
    if(disposition==='DEFINITELY_REJECTED'){
      await conn.query("UPDATE payment_attempts SET status='FAILED' WHERE id=? AND status='INITIATED' AND provider_tracker_token IS NULL",[staged.payment_attempt_id]);
      await conn.query("UPDATE procurement_delivery_payment_contracts SET status='APPROVED' WHERE id=? AND status='INITIALIZING'",[staged.contract_id]);
    }else await conn.query("UPDATE procurement_delivery_payment_contracts SET status='RECONCILIATION_REQUIRED' WHERE id=? AND status IN ('INITIALIZING','PAYMENT_PENDING')",[staged.contract_id]);
    await require('./financialSettlementService')._logAuditEvent(conn,{orderId:oid,entityType:'DELIVERY_PAYMENT',entityId:staged.contract_id,eventType:'TRACKER_INITIALIZATION_FAILED',actorRole:'BUYER',actorId:buyer,toStatus:disposition,metadata:{payment_attempt_id:staged.payment_attempt_id,provider_http_status:error.providerStatusCode||null,known_tracker_retained:!!knownTracker},notes:'Rejected requests may retry; uncertain provider outcomes require reconciliation without creating another charge'});
   });
   if(initializationDisposition(error,knownTracker)==='DEFINITELY_REJECTED')throw Object.assign(new Error('Provider rejected initialization without creating a tracker; a fresh explicit retry is safe.'),{code:'SUPPLEMENTAL_INITIALIZATION_REJECTED',statusCode:502});
   throw error;
  }
 }
 // Called exclusively after existing Safepay raw HMAC/timestamp verification,
 // or after an authenticated server-to-provider tracker fetch. No client claim.
 async captureWithinTransaction(conn,{attempt,providerAmount,providerCurrency,eventId,eventType,signature,timestamp,rawPayload}){
  if(attempt.provider!=='SAFEPAY'||attempt.environment!=='sandbox'||!attempt.procurement_delivery_contract_id)throw fail('SUPPLEMENTAL_PAYMENT_INVALID','Sandbox contract-linked attempt required');
  const [orders]=await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE',[attempt.order_id]);const order=orders[0];
  const [contracts]=await conn.query('SELECT * FROM procurement_delivery_payment_contracts WHERE id=? FOR UPDATE',[attempt.procurement_delivery_contract_id]);const contract=contracts[0];
  if(!order||!contract||Number(contract.order_id)!==Number(order.id)||Number(contract.buyer_id)!==Number(order.buyer_id)||Number(attempt.buyer_id)!==Number(contract.buyer_id)||Number(contract.supplier_id)!==Number(order.supplier_id)||money(attempt.amount)!==money(contract.amount)||order.payment_status!=='PAID')throw fail('SUPPLEMENTAL_PAYMENT_INVALID','Captured payment does not match its immutable contract');
  if(providerCurrency!==contract.currency)throw fail('CURRENCY_MISMATCH','Supplemental currency differs from contract',422);
  if(money(providerAmount)!==money(contract.amount))throw fail('AMOUNT_MISMATCH','Supplemental amount differs from approved contract',422);
  const [previous]=await conn.query('SELECT * FROM payments WHERE procurement_delivery_contract_id=? FOR UPDATE',[contract.id]);
  if(previous.length){if(previous.length!==1||money(previous[0].amount)!==money(contract.amount)||String(previous[0].transaction_ref)!==String(attempt.provider_tracker_token))throw fail('SUPPLEMENTAL_PAYMENT_INVALID','Conflicting capture requires financial reconciliation');await this._event(conn,{attempt,eventId,eventType,signature,timestamp,rawPayload,status:'IGNORED_DUPLICATE'});return {success:true,is_duplicate:true,delivery_contract_id:contract.id,original_order_changed:false};}
  if(attempt.status!=='INITIATED'||!['PAYMENT_PENDING','INITIALIZING','RECONCILIATION_REQUIRED'].includes(contract.status))throw fail('SUPPLEMENTAL_PAYMENT_INVALID','Contract cannot accept a new capture');
  const [payment]=await conn.query("INSERT INTO payments(payment_code,order_id,buyer_id,amount,buyer_fee,payment_method,status,escrow_status,transaction_ref,provider_response,paid_at,procurement_delivery_contract_id) VALUES (?,?,?,?,0.00,'CARD','PAID','HELD_IN_ESCROW',?,?,NOW(),?)",['DPP-'+contract.id,order.id,contract.buyer_id,contract.amount,attempt.provider_tracker_token,JSON.stringify({provider:'SAFEPAY',tracker_token:attempt.provider_tracker_token,event_id:eventId,delivery_contract_id:contract.id}),contract.id]);
  const [hold]=await conn.query("INSERT INTO financial_holds(hold_code,order_id,hold_amount,currency,reason,status,placed_by_role,placed_by_id,notes,receipt_policy_version) VALUES (?,?,?,'PKR','FULFILLMENT_EXCEPTION','ACTIVE','SYSTEM',?,'Supplemental delivery fee held until fulfillment and administrator review','R6_DELIVERY_FEE_V1')",['DPH-'+contract.id,order.id,contract.amount,contract.buyer_id]);
  await conn.query("UPDATE payment_attempts SET status='COMPLETED' WHERE id=?",[attempt.id]);
  const [deliveryAttempts]=await conn.query('SELECT proposed_start_utc FROM procurement_delivery_attempts WHERE id=?',[contract.delivery_attempt_id]);const [[clock]]=await conn.query('SELECT ?>UTC_TIMESTAMP() live',[deliveryAttempts[0]?.proposed_start_utc]);const status=Number(clock.live)===1?'PAID':'RECONCILIATION_REQUIRED';
  await conn.query('UPDATE procurement_delivery_payment_contracts SET payment_id=?,financial_hold_id=?,status=? WHERE id=?',[payment.insertId,hold.insertId,status,contract.id]);
  await this._event(conn,{attempt,eventId,eventType,signature,timestamp,rawPayload,status:'PROCESSED'});
  await require('./financialSettlementService')._logAuditEvent(conn,{orderId:order.id,paymentId:payment.insertId,entityType:'DELIVERY_PAYMENT',entityId:contract.id,eventType:'SUPPLEMENTAL_FEE_CAPTURED',actorRole:'SYSTEM',actorId:contract.buyer_id,toStatus:status,amountDelta:contract.amount,metadata:{contract_id:contract.id,hold_id:hold.insertId,original_order_changed:false},notes:'Separate buyer-consented fee captured; no original order, invoice, stock or commission change'});
  await this.notifier.enqueueEvent(conn,{userId:contract.buyer_id,role:'BUYER',eventType:'PAYMENT_VERIFIED',eventKey:'delivery-contract:'+contract.id+':verified',entityId:order.id});return {success:true,delivery_contract_id:contract.id,status,original_order_changed:false};
 }
 async _event(conn,{attempt,eventId,eventType,signature,timestamp,rawPayload,status}){await conn.query('INSERT INTO payment_webhook_events(event_id,provider,event_type,order_id,attempt_id,provider_tracker_token,signature,timestamp_header,raw_payload,processed_status) VALUES (?,\'SAFEPAY\',?,?,?,?,?,?,?,?)',[eventId,eventType,attempt.order_id,attempt.id,attempt.provider_tracker_token,signature,String(timestamp),JSON.stringify(rawPayload),status]);}
 async verifiedForResume(conn,orderId,attempt){
  const [rows]=await conn.query("SELECT c.*,p.amount AS payment_amount,p.transaction_ref,pa.provider_tracker_token,pa.status AS attempt_status FROM procurement_delivery_payment_contracts c JOIN payments p ON p.id=c.payment_id AND p.procurement_delivery_contract_id=c.id AND p.status='PAID' JOIN payment_attempts pa ON pa.procurement_delivery_contract_id=c.id AND pa.provider='SAFEPAY' AND pa.environment='sandbox' AND pa.status='COMPLETED' WHERE c.order_id=? AND c.delivery_attempt_id=? AND c.proposal_version=? AND c.status='PAID' FOR UPDATE",[orderId,attempt.id,attempt.proposal_version]);
  const contract=rows[0];if(rows.length!==1||contract.attempt_status!=='COMPLETED'||money(contract.payment_amount)!==money(attempt.extra_fee)||String(contract.transaction_ref)!==String(contract.provider_tracker_token))throw fail('SUPPLEMENTAL_PAYMENT_REQUIRED','Verified payment of the exact separate approved fee is required');
  const [events]=await conn.query("SELECT id FROM payment_webhook_events WHERE provider_tracker_token=? AND processed_status='PROCESSED' AND event_type IN ('payment.succeeded','payment.completed','payment.reconciled','payment:succeeded','payment:completed','payment.settled','payment:settled') LIMIT 1",[contract.provider_tracker_token]);if(!events.length)throw fail('SUPPLEMENTAL_PAYMENT_REQUIRED','Authoritative provider event required');return contract;
 }
 async reconcile(actor,orderId,attemptId,{mockClient=null}={}){
  const contract=await this.get(actor,orderId,attemptId);if(!contract)throw fail('DELIVERY_CONTRACT_NOT_FOUND','Own delivery payment contract not found',404);
  if(['PAID','REVIEWED'].includes(contract.status))return {contract_id:contract.id,status:contract.status,is_replay:true};
  const [attempts]=await this.db.query('SELECT * FROM payment_attempts WHERE procurement_delivery_contract_id=? ORDER BY id DESC LIMIT 1',[contract.id]);const attempt=attempts[0];if(!attempt?.provider_tracker_token)throw fail('TRACKER_RECONCILIATION_REQUIRED','Provider tracker initialization must be reconciled before retrying');
  const response=await this.provider.fetchTracker(attempt.provider_tracker_token,{mockClient}),tracker=response?.data;
  if(tracker?.token!==attempt.provider_tracker_token)throw fail('TRACKER_MISMATCH','Provider returned a different tracker',502);
  if(!['TRACKER_ENDED','COMPLETED','PAID'].includes(tracker.state)||!tracker.transaction)return {contract_id:contract.id,status:contract.status,provider_state:tracker.state};
  return this._transaction(async conn=>{const [locked]=await conn.query('SELECT * FROM payment_attempts WHERE id=? FOR UPDATE',[attempt.id]);return this.captureWithinTransaction(conn,{attempt:locked[0],providerAmount:tracker.amount??tracker.transaction.amount,providerCurrency:tracker.currency||tracker.transaction.currency,eventId:'delivery-reconcile:'+attempt.id,eventType:'payment.reconciled',signature:'AUTHENTICATED_PROVIDER_FETCH',timestamp:Date.now(),rawPayload:{source:'provider_fetch',tracker_token:attempt.provider_tracker_token}});});
 }
 async pendingReview(actor){await require('./procurementSettlementReviewService')._admin(this.db,actor);return (await this.db.query("SELECT c.id,c.order_id,c.contract_code,c.amount,c.status,o.order_code FROM procurement_delivery_payment_contracts c JOIN orders o ON o.id=c.order_id WHERE c.status IN ('PAID','RECONCILIATION_REQUIRED') AND c.payment_id IS NOT NULL ORDER BY c.id LIMIT 100"))[0];}
 async reviewPreview(actor,contractId){await require('./procurementSettlementReviewService')._admin(this.db,actor);const [rows]=await this.db.query('SELECT id,order_id,contract_code,amount,currency,consent_snapshot,status,review_snapshot FROM procurement_delivery_payment_contracts WHERE id=?',[id(contractId)]);if(!rows.length)throw fail('DELIVERY_CONTRACT_NOT_FOUND','Delivery fee contract not found',404);const value=rows[0];return {...value,consent_snapshot:parse(value.consent_snapshot),review_snapshot:parse(value.review_snapshot),contract_hash:fingerprint({contract_id:value.id,amount:money(value.amount),consent:parse(value.consent_snapshot)})};}
 async reviewFee(actor,contractId,input,rawKey){
  if(!input||Object.keys(input).some(field=>!['contract_hash','refund_amount','notes'].includes(field))||typeof input.notes!=='string'||input.notes.trim().length<10||input.notes.length>2000||typeof rawKey!=='string'||!/^[A-Za-z0-9:_-]{12,100}$/.test(rawKey))throw fail('DELIVERY_FEE_REVIEW_REQUIRED','Exact contract, fee refund amount and review reason required',400);
  const refundAmount=money(input.refund_amount),payloadHash=fingerprint(input);
  return this._transaction(async conn=>{
   await require('./procurementSettlementReviewService')._admin(conn,actor);const [lookup]=await conn.query('SELECT order_id FROM procurement_delivery_payment_contracts WHERE id=?',[id(contractId)]);if(!lookup.length)throw fail('DELIVERY_CONTRACT_NOT_FOUND','Delivery contract not found',404);
   const [orders]=await conn.query('SELECT * FROM orders WHERE id=? FOR UPDATE',[lookup[0].order_id]),order=orders[0];
   const [contracts]=await conn.query('SELECT * FROM procurement_delivery_payment_contracts WHERE id=? FOR UPDATE',[id(contractId)]),contract=contracts[0];
   if(contract.status==='REVIEWED'){const previous=parse(contract.review_snapshot);if(previous.payload_hash!==payloadHash||previous.intent_key!==rawKey||Number(contract.reviewed_by)!==Number(actor.id))throw fail('DELIVERY_FEE_REVIEW_FINAL','Delivery fee review is immutable');return {...previous,is_replay:true};}
   if(!contract.payment_id||!['PAID','RECONCILIATION_REQUIRED'].includes(contract.status)||input.contract_hash!==fingerprint({contract_id:contract.id,amount:money(contract.amount),consent:parse(contract.consent_snapshot)})||!exact.exactDecimalGte(contract.amount,refundAmount,2))throw fail('DELIVERY_FEE_REVIEW_INVALID','Captured contract or fee refund allocation changed');
   const [payments]=await conn.query("SELECT p.*,pa.status AS provider_status,pa.provider_tracker_token FROM payments p JOIN payment_attempts pa ON pa.procurement_delivery_contract_id=p.procurement_delivery_contract_id WHERE p.id=? AND p.procurement_delivery_contract_id=? AND p.status='PAID' AND pa.provider='SAFEPAY' AND pa.environment='sandbox' AND pa.status='COMPLETED' FOR UPDATE",[contract.payment_id,contract.id]);
   if(payments.length!==1||payments[0].provider_status!=='COMPLETED'||money(payments[0].amount)!==money(contract.amount)||String(payments[0].transaction_ref)!==String(payments[0].provider_tracker_token))throw fail('DELIVERY_FEE_REVIEW_INVALID','Verified supplemental capture required');
   const [holds]=await conn.query("SELECT * FROM financial_holds WHERE id=? AND order_id=? AND status='ACTIVE' FOR UPDATE",[contract.financial_hold_id,order.id]);if(holds.length!==1||money(holds[0].hold_amount)!==money(contract.amount)||holds[0].receipt_policy_version!=='R6_DELIVERY_FEE_V1')throw fail('DELIVERY_FEE_REVIEW_INVALID','Captured fee hold changed');
   const supplierAmount=sub(money(contract.amount),refundAmount);
   if(supplierAmount!=='0.00'){
    const [receipts]=await conn.query('SELECT lr.id FROM procurement_line_receipts lr WHERE lr.order_id=?',[order.id]),[[lineCount]]=await conn.query('SELECT COUNT(*) total FROM procurement_award_lines al JOIN procurement_award_orders ao ON ao.id=al.award_order_id WHERE ao.order_id=?',[order.id]);
    if(!order.supplier_delivered_at||receipts.length!==Number(lineCount.total)||!receipts.length)throw fail('DELIVERY_FEE_FULFILLMENT_REQUIRED','Supplier-reported delivery and final buyer receipts are required to retain a reattempt fee');
   }
   const [instructions]=await conn.query('SELECT id FROM supplier_disbursement_instructions WHERE order_id=? FOR UPDATE',[order.id]);if(instructions.length)throw fail('DELIVERY_FEE_PAYOUT_RESERVED','Existing supplier instruction must be reconciled before changing entitlement');
   const [oldPayables]=await conn.query('SELECT * FROM supplier_payables WHERE order_id=? FOR UPDATE',[order.id]);let payable=oldPayables[0];
   if(supplierAmount!=='0.00'){
    if(payable?.receipt_policy_version&&!payable.procurement_settlement_review_id)throw fail('PARTIAL_REVIEW_REQUIRED','Review original partial-receipt allocation before retaining an additional fee');
    if(!payable){if(!['BUYER_CONFIRMED','COMPLETED'].includes(order.fulfillment_status))throw fail('BUYER_RECEIPT_REQUIRED','Buyer confirmation required before a new canonical supplier entitlement');await require('./financialSettlementService').accrueSupplierPayable({orderId:order.id,actor,idempotencyKey:'delivery-accrue:'+contract.id,clientConnection:conn});payable=(await conn.query('SELECT * FROM supplier_payables WHERE order_id=? FOR UPDATE',[order.id]))[0][0];}
    if(payable.policy_status!=='APPROVED'||money(payable.disbursed_amount)!=='0.00')throw fail('DELIVERY_FEE_PAYABLE_CONFLICT','Supplier entitlement must be approved and unspent');
    await conn.query('UPDATE supplier_payables SET delivery_fee_amount=?,net_payable_amount=?,available_amount=? WHERE id=?',[sum([payable.delivery_fee_amount,supplierAmount]),sum([payable.net_payable_amount,supplierAmount]),sum([payable.available_amount,supplierAmount]),payable.id]);
   }
   let refundId=null;if(refundAmount!=='0.00'){const [refund]=await conn.query("INSERT INTO refund_obligations(refund_code,order_id,payment_id,buyer_id,assessed_refund_amount,fee_refund_amount,total_refund_amount,refund_type,status,external_execution_status,approved_by,approved_at,idempotency_key,audit_notes,procurement_delivery_contract_id) VALUES (?,?,?,?,0.00,?,?,?,'APPROVED','DISABLED',?,NOW(),?,?,?)",['DPR-'+contract.id,order.id,contract.payment_id,contract.buyer_id,refundAmount,refundAmount,refundAmount===money(contract.amount)?'FULL':'PARTIAL',actor.id,'delivery-refund:'+contract.id,input.notes.trim(),contract.id]);refundId=refund.insertId;}
   await conn.query('UPDATE financial_holds SET status=?,released_by_id=?,released_at=NOW() WHERE id=?',[supplierAmount==='0.00'?'FORFEITED_TO_REFUND':'RELEASED',actor.id,holds[0].id]);
   const reviewed={contract_id:contract.id,amount:money(contract.amount),supplier_amount:supplierAmount,refund_amount:refundAmount,refund_obligation_id:refundId,prior_payable:payable?{id:payable.id,delivery_fee_amount:payable.delivery_fee_amount,net_payable_amount:payable.net_payable_amount,available_amount:payable.available_amount}:null,payload_hash:payloadHash,intent_key:rawKey,notes:input.notes.trim(),external_execution_status:'DISABLED'};
   await conn.query("UPDATE procurement_delivery_payment_contracts SET status='REVIEWED',reviewed_by=?,review_snapshot=? WHERE id=?",[actor.id,JSON.stringify(reviewed),contract.id]);
   if(supplierAmount==='0.00')await conn.query("UPDATE procurement_delivery_attempts SET status='FAILED' WHERE id=? AND status='APPROVED_PAYMENT_REQUIRED' AND proposal_version=?",[contract.delivery_attempt_id,contract.proposal_version]);
   await require('./financialSettlementService')._logAuditEvent(conn,{orderId:order.id,paymentId:contract.payment_id,entityType:'DELIVERY_FEE_REVIEW',entityId:contract.id,eventType:'SUPPLEMENTAL_FEE_ALLOCATED',actorRole:actor.role,actorId:actor.id,toStatus:'REVIEWED',amountDelta:contract.amount,metadata:reviewed,notes:reviewed.notes});
   if(refundId)await this.notifier.enqueueEvent(conn,{userId:contract.buyer_id,role:'BUYER',eventType:'REFUND_APPROVED_PENDING',eventKey:'delivery-contract:'+contract.id+':refund-approved',entityId:order.id});
   await this.notifier.enqueueEvent(conn,{userId:contract.supplier_id,role:'SUPPLIER',eventType:'SETTLEMENT_PENDING',eventKey:'delivery-contract:'+contract.id+':fee-reviewed',entityId:order.id});return reviewed;
  });
 }
}
module.exports=new ProcurementDeliveryPaymentService();module.exports.ProcurementDeliveryPaymentService=ProcurementDeliveryPaymentService;
