'use strict';
const exact=require('./exactDecimal');
const FEE_POLICY_VERSION='R4_ACCEPTED_MERCHANDISE_V1';
const fail=(code,message,statusCode=422)=>Object.assign(new Error(message),{code,statusCode});
const discrete=new Set(['bag','tin','carton','sack','bundle','pack','bucket','drum','jerrycan']);
const loose=new Set(['kg','g','l','ml','litre']);
const reasons=new Set(['QUANTITY_MISMATCH','DAMAGED_GOODS','WRONG_PRODUCT','DELIVERY_NOT_RECEIVED']);
function id(value){
 if(!/^[1-9]\d*$/.test(String(value??''))||!Number.isSafeInteger(Number(value)))
  throw fail('INVALID_RECEIPT_ID','A positive integer ID is required.',400);
 return Number(value);
}
function decimal(value,scale=4){
 if(!['string','number'].includes(typeof value)||
  !new RegExp('^(?:0|[1-9]\\d{0,'+(scale===4?7:11)+'})(?:\\.\\d{1,'+scale+'})?$').test(String(value)))
  throw fail('INVALID_RECEIPT_QUANTITY','Use an exact nonnegative decimal within supported precision.');
 return exact.toCanonical(value,scale);
}
function units(value){return BigInt(decimal(value).replace('.',''));}
function format(value){return (value/10000n)+'.'+(value%10000n).toString().padStart(4,'0');}
function normalizeSubmission(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>k!=='lines')||
   !Array.isArray(payload.lines)||payload.lines.length<1||payload.lines.length>50)
  throw fail('INVALID_RECEIPT_LINES','Provide 1–50 line receipts.',400);
 const seen=new Set();
 return {lines:payload.lines.map(line=>{
  const fields=new Set(['award_line_id','received_quantity','accepted_quantity','disputed_quantity','reason','evidence_notes']);
  if(!line||typeof line!=='object'||Array.isArray(line)||Object.keys(line).some(k=>!fields.has(k)))
   throw fail('INVALID_RECEIPT_LINE','Unsupported receipt fields.',400);
  const key=id(line.award_line_id);
  if(seen.has(key))throw fail('DUPLICATE_RECEIPT_LINE','A line may appear only once.',400);
  seen.add(key);
  const notes=line.evidence_notes??null;
  if(notes!==null&&(typeof notes!=='string'||notes.trim().length>2000))
   throw fail('INVALID_RECEIPT_EVIDENCE','Evidence notes must be at most 2000 characters.',400);
  const reason=line.reason??null;
  if(reason!==null&&!reasons.has(reason))throw fail('INVALID_RECEIPT_REASON','Unsupported receipt dispute reason.');
  return {award_line_id:key,received_quantity:decimal(line.received_quantity),
   accepted_quantity:decimal(line.accepted_quantity),disputed_quantity:decimal(line.disputed_quantity),
   reason,evidence_notes:notes===null?null:notes.trim()||null};
 }).sort((a,b)=>a.award_line_id-b.award_line_id)};
}
function assessLine(line,raw){
 const claim=normalizeSubmission({lines:[raw]}).lines[0];
 if(id(line.id)!==claim.award_line_id)throw fail('FOREIGN_AWARD_LINE','Receipt line does not belong to this order.',403);
 const ordered=units(line.quantity),received=units(claim.received_quantity),accepted=units(claim.accepted_quantity);
 const disputed=units(claim.disputed_quantity);
 if(ordered<=0n||received>ordered||accepted>received||disputed!==ordered-accepted)
  throw fail('RECEIPT_QUANTITY_CONSERVATION','Require accepted <= received <= ordered and disputed = ordered - accepted.');
 const unit=String(line.purchasing_unit||'').toLowerCase();
 const snapshot=typeof line.immutable_sku_snapshot==='string'?JSON.parse(line.immutable_sku_snapshot):line.immutable_sku_snapshot;
 let step;
 if(discrete.has(unit))step=10000n;
 else if(loose.has(unit)){
  if(!snapshot?.step_size)throw fail('RECEIPT_INCREMENT_SNAPSHOT_REQUIRED','Immutable loose-unit increment is missing; reconciliation required.',409);
  step=units(snapshot.step_size);
 }else throw fail('UNSUPPORTED_RECEIPT_UNIT','Unsupported purchasing unit.');
 if(step<=0n||[ordered,received,accepted,disputed].some(v=>v%step!==0n))
  throw fail('INDIVISIBLE_RECEIPT_QUANTITY','Every quantity must conform to the immutable purchasing increment.');
 if(disputed>0n&&(!claim.reason||!claim.evidence_notes))
  throw fail('RECEIPT_DISPUTE_EVIDENCE_REQUIRED','A reason and evidence notes are required for disputed units.');
 if(claim.reason==='DELIVERY_NOT_RECEIVED'&&received!==0n)
  throw fail('RECEIPT_REASON_MISMATCH','Delivery not received requires zero received units.');
 const price=decimal(line.unit_price,2),subtotal=decimal(line.subtotal,2);
 if(price==='0.00'||exact.exactMultiplyRound(format(ordered),price,2)!==subtotal)
  throw fail('AWARD_LINE_PRICE_INTEGRITY_ERROR','Immutable line quantity, price and subtotal do not reconcile.',409);
 // Allocate the rounded line subtotal once: accepted value first, contested
 // value as the residual. Independently rounding both halves can create a cent.
 const acceptedValue=exact.exactMultiplyRound(format(accepted),price,2);
 const bounded=exact.exactDecimalSum([subtotal,'-'+acceptedValue],2);
 return {...claim,ordered_quantity:format(ordered),purchasing_unit:unit,unit_price:price,subtotal,
  short_quantity:format(ordered-received),rejected_quantity:format(received-accepted),
  accepted_merchandise_amount:acceptedValue,
  refund_assessment_amount:bounded,hold_assessment_amount:bounded,fee_refund_assessment_amount:'0.00'};
}
function assertFeePolicyConsent(consent){
 if(!consent||typeof consent!=='object'||Array.isArray(consent)||
  Object.keys(consent).some(k=>!['version','accepted'].includes(k))||
  consent.version!==FEE_POLICY_VERSION||consent.accepted!==true)
  throw fail('RECEIPT_FEE_POLICY_ACCEPTANCE_REQUIRED','Explicit acceptance of '+FEE_POLICY_VERSION+' is required.',409);
 return {version:FEE_POLICY_VERSION,accepted:true};
}
function assessFinancialAllocation(order,captured,receipts){
 if(!Array.isArray(receipts)||!receipts.length)throw fail('LINE_RECEIPTS_REQUIRED','Final line receipts are required.',409);
 const money=v=>decimal(v,2),add=values=>exact.exactDecimalSum(values,2);
 const subtract=(a,b)=>add([a,'-'+b]);
 const total=money(order.subtotal_amount),delivery=money(order.delivery_fee),processing=money(order.buyer_platform_fee);
 const rate=money(order.supplier_commission_percent);
 if(!exact.exactDecimalGte('100.00',rate,2))throw fail('INVALID_COMMISSION_SNAPSHOT','Original commission percent must be between zero and 100.',409);
 const disputed=add(receipts.map(row=>{
  const subtotal=money(row.subtotal),refund=money(row.refund_assessment_amount);
  if(!exact.exactDecimalGte(subtotal,refund,2))throw fail('LINE_REFUND_EXCEEDS_SUBTOTAL','Line refund exceeds its contractual value.',409);
  return refund;
 }));
 if(add(receipts.map(row=>money(row.subtotal)))!==total||!exact.exactDecimalGte(total,disputed,2)||
  add([total,delivery,processing])!==money(captured)||money(order.total_amount)!==money(captured))
  throw fail('CAPTURED_FUNDS_RECONCILIATION_REQUIRED','Captured money, fee snapshots and final receipt subtotals must reconcile exactly.',409);
 const accepted=subtract(total,disputed),basisPoints=BigInt(rate.replace('.',''));
 const multiplier=(basisPoints/10000n)+'.'+(basisPoints%10000n).toString().padStart(4,'0');
 const commission=exact.exactMultiplyRound(accepted,multiplier,2);
 const hasDispute=receipts.some(row=>row.disputed_quantity===undefined
  ?exact.exactDecimalGte(row.refund_assessment_amount,'0.01',2)
  :exact.exactDecimalGte(row.disputed_quantity,'0.0001',4));
 const net=hasDispute?subtract(accepted,commission):add([subtract(accepted,commission),delivery]);
 const deliveryHold=hasDispute?delivery:'0.00',processingHold=hasDispute?processing:'0.00';
 const recognizedProcessing=hasDispute?'0.00':processing;
 const allocated=add([net,commission,disputed,deliveryHold,processingHold,recognizedProcessing]);
 if(allocated!==money(captured))throw fail('CAPTURED_FUNDS_RECONCILIATION_REQUIRED','Financial allocation does not conserve captured funds.',409);
 return {policy_version:FEE_POLICY_VERSION,captured_amount:money(captured),original_commission_percent:rate,
  accepted_merchandise_amount:accepted,accepted_commission_amount:commission,accepted_supplier_net:net,
  disputed_merchandise_hold:disputed,delivery_fee_hold:deliveryHold,processing_fee_hold:processingHold,
  recognized_buyer_platform_fee:recognizedProcessing,canonical_full_settlement_required:!hasDispute,
  allocated_captured_amount:allocated,fees_held_for_admin_review:hasDispute,
  fee_basis:'ORIGINAL_ORDER_DELIVERY_AND_BUYER_PLATFORM_FEE',
  rounding_policy:'ROUND_ACCEPTED_THEN_RESIDUAL_DISPUTE',
  refund_reservation_overlaps_merchandise_hold:true,external_execution_status:'DISABLED'};
}
module.exports={fail,id,decimal,normalizeSubmission,assessLine,FEE_POLICY_VERSION,assertFeePolicyConsent,assessFinancialAllocation};
