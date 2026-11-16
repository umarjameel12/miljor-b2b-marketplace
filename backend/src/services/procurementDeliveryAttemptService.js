'use strict';
const crypto=require('node:crypto'),db=require('../config/db'),notifications=require('./notificationService');
const {FulfillmentService}=require('./fulfillmentService');
const {ProcurementDeliveryRunService}=require('./procurementDeliveryRunService');
const exact=require('./exactDecimal');
const fail=(code,message,statusCode=409)=>Object.assign(Error(message),{code,statusCode});
const positive=value=>{if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw fail('INVALID_DELIVERY_ID','Positive identifier required',400);return Number(value);};
const key=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(value))throw fail('INVALID_IDEMPOTENCY_KEY','Stable intent key required',400);return value;};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
class ProcurementDeliveryAttemptService{
 constructor(database=db,notifier=notifications){this.db=database;this.notifications=notifier;this.delivery=new ProcurementDeliveryRunService(database,notifier);}
 async _transaction(action){const conn=await this.db.getConnection();try{await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await conn.beginTransaction();const result=await action(conn);await conn.commit();return result;}catch(error){await conn.rollback();throw error;}finally{conn.release();}}
 async failAttempt(actor,orderId,input,rawKey){
  const oid=positive(orderId),intent=key(rawKey);
  if(actor?.role!=='SUPPLIER')throw fail('DELIVERY_FORBIDDEN','Assigned supplier required',403);
  if(!input||Object.keys(input).some(field=>!['description'].includes(field))||typeof input.description!=='string'||input.description.trim().length<5||input.description.length>2000)throw fail('FAILURE_EVIDENCE_REQUIRED','Describe the actual failed attempt in 5–2000 characters',400);
  const description=input.description.trim(),digest=hash({oid,description});
  return this._transaction(async conn=>{
   await this.delivery._supplier(conn,actor);const order=await this.delivery._order(conn,actor,oid);
   const [old]=await conn.query('SELECT id,failure_hash,status FROM procurement_delivery_attempts WHERE order_id=? AND supplier_key=?',[oid,intent]);
   if(old.length){if(old[0].failure_hash!==digest)throw fail('IDEMPOTENCY_CONFLICT','Failure key belongs to different evidence');return {attempt_id:old[0].id,status:old[0].status,is_replay:true};}
   if(order.fulfillment_status!=='DISPATCHED')throw fail('DISPATCHED_ORDER_REQUIRED','Only an actual dispatched order can have a failed delivery attempt');
   // Compose the canonical exception operation in this transaction. It cannot
   // commit, roll back, or change isolation independently of the attempt record.
   const nested={query:(sql,args)=>/^SET TRANSACTION/i.test(sql)?Promise.resolve([[]]):conn.query(sql,args),beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{}};
   await new FulfillmentService({getConnection:async()=>nested}).recordSupplierFulfillmentException({orderId:oid,actor,reason:'SUPPLIER_LOGISTICS_FAILURE',description,idempotencyKey:'attempt:'+hash(intent).slice(0,48),metadata:{source:'DELIVERY_ATTEMPT'}});
   const [created]=await conn.query("INSERT INTO procurement_delivery_attempts(order_id,attempt_code,failure_reason,failure_description,supplier_key,failure_hash) VALUES (?,?,'SUPPLIER_LOGISTICS_FAILURE',?,?,?)",[oid,'DA-'+crypto.randomUUID(),description,intent,digest]);
   await conn.query("UPDATE procurement_delivery_stops SET status='EXCEPTION' WHERE order_id=? AND is_current=1",[oid]);
   return {attempt_id:created.insertId,status:'FAILED',is_replay:false,creates_refund:false};
  });
 }
 async propose(actor,orderId,attemptId,input,rawKey){
  const oid=positive(orderId),aid=positive(attemptId),intent=key(rawKey);
  if(actor?.role!=='SUPPLIER')throw fail('DELIVERY_FORBIDDEN','Assigned supplier required',403);
  const fields=['start_utc','end_utc','extra_fee','expected_version'];
  if(!input||Object.keys(input).some(field=>!fields.includes(field))||!Number.isSafeInteger(input.expected_version)||input.expected_version<0)throw fail('INVALID_REATTEMPT_PROPOSAL','Exact proposal revision and time window required',400);
  const dates=['start_utc','end_utc'].map(field=>{const value=input[field];if(typeof value!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw fail('INVALID_REATTEMPT_WINDOW','Offset-aware timestamps required',400);return new Date(value);});
  if(dates[0]>=dates[1])throw fail('INVALID_REATTEMPT_WINDOW','End must follow start',400);
  const fee=exact.toCanonical(input.extra_fee,2);if(!exact.exactDecimalGte(fee,'0',2))throw fail('INVALID_REATTEMPT_FEE','Nonnegative exact fee required',400);
  const payload={start_utc:dates[0].toISOString(),end_utc:dates[1].toISOString(),extra_fee:fee,expected_version:input.expected_version},digest=hash(payload);
  return this._transaction(async conn=>{
   await this.delivery._supplier(conn,actor);const order=await this.delivery._order(conn,actor,oid);const attempt=await this._attempt(conn,oid,aid);
   const replay=await this._replay(conn,aid,intent,digest);if(replay)return replay;
   if(order.fulfillment_status!=='EXCEPTION'||order.exception_reason!=='SUPPLIER_LOGISTICS_FAILURE'||!['FAILED','PROPOSED'].includes(attempt.status)||Number(attempt.proposal_version)!==input.expected_version)throw fail('REATTEMPT_STATE_CONFLICT','Refresh the failed attempt before proposing a new slot');
   const [[clock]]=await conn.query('SELECT (? > UTC_TIMESTAMP() AND ?<=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 90 DAY)) live',[dates[0],dates[1]]);if(Number(clock.live)!==1)throw fail('INVALID_REATTEMPT_WINDOW','Future slot within 90 days required');
   const response={attempt_id:aid,status:'PROPOSED',proposal_version:input.expected_version+1,...payload,creates_charge:false};
   await conn.query("UPDATE procurement_delivery_attempts SET status='PROPOSED',proposed_start_utc=?,proposed_end_utc=?,extra_fee=?,proposal_version=?,proposal_snapshot=? WHERE id=?",[...dates,fee,response.proposal_version,JSON.stringify(response),aid]);
   await this._event(conn,aid,actor,'PROPOSED',intent,digest,response);
   await this.notifications.enqueueEvent(conn,{userId:order.buyer_id,role:'BUYER',eventType:'DELIVERY_REATTEMPT_PROPOSED',eventKey:'attempt:'+aid+':v:'+response.proposal_version,entityId:oid});return response;
  });
 }
 async approve(actor,orderId,attemptId,input,rawKey){
  const oid=positive(orderId),aid=positive(attemptId),intent=key(rawKey);
  if(actor?.role!=='BUYER')throw fail('DELIVERY_FORBIDDEN','Owning buyer required',403);
  if(!input||Object.keys(input).some(field=>!['proposal_version','accepted_extra_fee','explicit_consent'].includes(field))||input.explicit_consent!==true||!Number.isSafeInteger(input.proposal_version))throw fail('REATTEMPT_CONSENT_REQUIRED','Explicit approval of the exact slot and fee required',400);
  const payload={proposal_version:input.proposal_version,accepted_extra_fee:exact.toCanonical(input.accepted_extra_fee,2),explicit_consent:true},digest=hash(payload);
  return this._transaction(async conn=>{
   const order=await this.delivery._order(conn,actor,oid),attempt=await this._attempt(conn,oid,aid),replay=await this._replay(conn,aid,intent,digest);if(replay)return replay;
   if(order.fulfillment_status!=='EXCEPTION'||order.exception_reason!=='SUPPLIER_LOGISTICS_FAILURE'||attempt.status!=='PROPOSED'||Number(attempt.proposal_version)!==payload.proposal_version||!exact.exactDecimalEquals(attempt.extra_fee,payload.accepted_extra_fee,2))throw fail('REATTEMPT_CONSENT_STALE','Proposal changed; review its current slot and fee');
   const [[clock]]=await conn.query('SELECT ?>UTC_TIMESTAMP() live',[attempt.proposed_start_utc]);if(Number(clock.live)!==1)throw fail('REATTEMPT_WINDOW_EXPIRED','Proposed slot has expired');
   const status=exact.exactDecimalEquals(attempt.extra_fee,'0',2)?'APPROVED':'APPROVED_PAYMENT_REQUIRED';
   const response={attempt_id:aid,status,proposal:parse(attempt.proposal_snapshot),buyer_id:actor.id,creates_charge:false,external_execution_status:'DISABLED'};
   await conn.query('UPDATE procurement_delivery_attempts SET status=?,buyer_consent_snapshot=? WHERE id=?',[status,JSON.stringify(response),aid]);await this._event(conn,aid,actor,'BUYER_APPROVED',intent,digest,response);return response;
  });
 }
 async resume(actor,orderId,attemptId,rawKey){
  const oid=positive(orderId),aid=positive(attemptId),intent=key(rawKey),digest=hash({oid,aid,action:'RESUME'});
  if(actor?.role!=='SUPPLIER')throw fail('DELIVERY_FORBIDDEN','Assigned supplier required',403);
  return this._transaction(async conn=>{
   await this.delivery._supplier(conn,actor);const order=await this.delivery._order(conn,actor,oid),attempt=await this._attempt(conn,oid,aid),replay=await this._replay(conn,aid,intent,digest);if(replay)return replay;
   if(attempt.status==='APPROVED_PAYMENT_REQUIRED')throw fail('SUPPLEMENTAL_PAYMENT_CONTRACT_REQUIRED','Extra-fee reattempt remains blocked until a separately approved verified payment contract is available');
   if(attempt.status!=='APPROVED'||!exact.exactDecimalEquals(attempt.extra_fee,'0',2)||!attempt.buyer_consent_snapshot||order.fulfillment_status!=='EXCEPTION'||order.exception_reason!=='SUPPLIER_LOGISTICS_FAILURE')throw fail('REATTEMPT_NOT_APPROVED','Exact buyer-approved free reattempt required');
   const [[clock]]=await conn.query('SELECT ?>UTC_TIMESTAMP() live',[attempt.proposed_start_utc]);if(Number(clock.live)!==1)throw fail('REATTEMPT_WINDOW_EXPIRED','Approved slot has expired');
   const [[disputes]]=await conn.query("SELECT COUNT(*) total FROM order_disputes WHERE order_id=? AND status NOT IN ('CLOSED','RESOLVED_REJECTED','SUPPLIER_REMEDIATION_COMPLETED')",[oid]);
   const [[holds]]=await conn.query("SELECT COUNT(*) total FROM financial_holds WHERE order_id=? AND status='ACTIVE'",[oid]);
   const [[receipts]]=await conn.query('SELECT COUNT(*) total FROM procurement_line_receipts WHERE order_id=?',[oid]);
   if(Number(disputes.total)||Number(holds.total)||Number(receipts.total))throw fail('REATTEMPT_FINANCIAL_REVIEW_REQUIRED','Existing dispute, hold or receipt must be resolved through its own workflow');
   const [stops]=await conn.query("SELECT r.status FROM procurement_delivery_stops s JOIN procurement_delivery_runs r ON r.id=s.run_id WHERE s.order_id=? AND s.is_current=1 FOR UPDATE",[oid]);if(stops.some(row=>!['EXCEPTION','CANCELLED'].includes(row.status)))throw fail('PREVIOUS_ROUTE_ACTIVE','Close the failed route with exception evidence before assigning a reattempt');
   await require('./procurementCollectiveCommitmentService').assertFunded(conn,oid);
   await conn.query("UPDATE orders SET fulfillment_status='READY_FOR_DISPATCH',exception_reason=NULL,exception_details=NULL,exception_recorded_at=NULL WHERE id=?",[oid]);
   await conn.query("INSERT INTO order_fulfillment_events(order_id,event_code,from_status,to_status,action,actor_id,actor_role,notes,metadata,idempotency_key) VALUES (?,?,'EXCEPTION','READY_FOR_DISPATCH','APPROVE_DELIVERY_REATTEMPT',?,'SUPPLIER','Buyer approved free reattempt',?,?)",[oid,'DR-'+crypto.randomUUID(),actor.id,JSON.stringify({attempt_id:aid,proposal:parse(attempt.proposal_snapshot)}),'reattempt:'+hash(intent)]);
   await conn.query('UPDATE procurement_delivery_stops SET is_current=0 WHERE order_id=? AND is_current=1',[oid]);
   // A fresh destination/window choice is mandatory; historical choice events remain.
   await conn.query('UPDATE procurement_order_delivery_choices SET terms_snapshot=NULL WHERE order_id=?',[oid]);
   await conn.query("UPDATE procurement_delivery_attempts SET status='RESUMED' WHERE id=?",[aid]);const response={attempt_id:aid,status:'RESUMED',fulfillment_status:'READY_FOR_DISPATCH',new_delivery_choice_required:true,creates_charge:false};
   await this._event(conn,aid,actor,'RESUMED',intent,digest,response);
   for(const [userId,role] of [[order.buyer_id,'BUYER'],[order.supplier_id,'SUPPLIER']])await this.notifications.enqueueEvent(conn,{userId,role,eventType:'DELIVERY_RESCHEDULED',eventKey:'attempt:'+aid+':resumed',entityId:oid});return response;
  });
 }
 async list(actor,orderId){const oid=positive(orderId);if(!actor||!['BUYER','SUPPLIER'].includes(actor.role))throw fail('DELIVERY_FORBIDDEN','Owning party required',403);const field=actor.role==='BUYER'?'buyer_id':'supplier_id';const [orders]=await this.db.query('SELECT id FROM orders WHERE id=? AND '+field+'=?',[oid,positive(actor.id)]);if(!orders.length)throw fail('ORDER_NOT_FOUND','Own order not found',404);return (await this.db.query('SELECT id,status,failure_reason,failure_description,proposal_version,proposal_snapshot,buyer_consent_snapshot,created_at FROM procurement_delivery_attempts WHERE order_id=? ORDER BY id DESC',[oid]))[0].map(row=>({...row,proposal_snapshot:parse(row.proposal_snapshot),buyer_consent_snapshot:parse(row.buyer_consent_snapshot)}));}
 async _attempt(conn,oid,aid){const [rows]=await conn.query('SELECT * FROM procurement_delivery_attempts WHERE id=? AND order_id=? FOR UPDATE',[aid,oid]);if(!rows.length)throw fail('ATTEMPT_NOT_FOUND','Own delivery attempt not found',404);return rows[0];}
 async _replay(conn,aid,intent,digest){const [rows]=await conn.query('SELECT payload_hash,event_snapshot FROM procurement_delivery_attempt_events WHERE attempt_id=? AND event_key=?',[aid,intent]);if(!rows.length)return null;if(rows[0].payload_hash!==digest)throw fail('IDEMPOTENCY_CONFLICT','Intent key belongs to different action');return {...parse(rows[0].event_snapshot),is_replay:true};}
 async _event(conn,aid,actor,type,intent,digest,response){await conn.query('INSERT INTO procurement_delivery_attempt_events(attempt_id,actor_id,event_type,event_key,payload_hash,event_snapshot) VALUES (?,?,?,?,?,?)',[aid,actor.id,type,intent,digest,JSON.stringify(response)]);}
}
module.exports=new ProcurementDeliveryAttemptService();module.exports.ProcurementDeliveryAttemptService=ProcurementDeliveryAttemptService;
