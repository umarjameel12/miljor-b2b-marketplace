'use strict';
const crypto=require('node:crypto'),exact=require('./exactDecimal');
const fail=(code,message,statusCode=409)=>Object.assign(Error(message),{code,statusCode});
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const fingerprint=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const money=value=>{if(!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(String(value)))throw fail('INVALID_REVIEW_AMOUNT','Exact nonnegative money with at most two decimals required',400);return exact.toCanonical(value,2);};
const sum=values=>exact.exactDecimalSum(values,2),sub=(a,b)=>sum([a,'-'+b]);
function reviewAllocation(allocation,input){
 if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['assessment_hash','delivery_refund_amount','processing_refund_amount','approve_disputed_merchandise_refunds','notes'].includes(key))||input.approve_disputed_merchandise_refunds!==true||typeof input.notes!=='string'||input.notes.trim().length<10||input.notes.length>2000)throw fail('REVIEW_CONSENT_REQUIRED','Approve the existing line refund assessment and describe fee responsibility',400);
 if(input.assessment_hash!==fingerprint(allocation))throw fail('ASSESSMENT_CHANGED','Reload the exact current allocation before approval');
 if(allocation.policy_version!=='R4_ACCEPTED_MERCHANDISE_V1')throw fail('REVIEW_POLICY_UNSUPPORTED','Only versioned accepted-merchandise allocations can be reviewed');
 const delivery=money(allocation.delivery_fee_hold),processing=money(allocation.processing_fee_hold),deliveryRefund=money(input.delivery_refund_amount),processingRefund=money(input.processing_refund_amount);
 if(!exact.exactDecimalGte(delivery,deliveryRefund,2)||!exact.exactDecimalGte(processing,processingRefund,2))throw fail('FEE_REFUND_EXCEEDS_CAPTURE','Fee refund cannot exceed its original held component');
 const goodsRefund=money(allocation.disputed_merchandise_hold),supplier=sum([money(allocation.accepted_supplier_net),sub(delivery,deliveryRefund)]),platform=sum([money(allocation.accepted_commission_amount),sub(processing,processingRefund)]),refund=sum([goodsRefund,deliveryRefund,processingRefund]);
 if(sum([supplier,platform,refund])!==money(allocation.captured_amount)||money(allocation.allocated_captured_amount)!==money(allocation.captured_amount))throw fail('REVIEW_CONSERVATION_FAILED','Supplier, platform and refund allocations must equal captured money exactly');
 return {policy_version:allocation.policy_version,assessment_hash:input.assessment_hash,captured_amount:money(allocation.captured_amount),accepted_merchandise_amount:money(allocation.accepted_merchandise_amount),accepted_commission_amount:money(allocation.accepted_commission_amount),merchandise_refund:goodsRefund,delivery_refund:deliveryRefund,processing_refund:processingRefund,delivery_supplier:sub(delivery,deliveryRefund),processing_platform:sub(processing,processingRefund),supplier_entitlement:supplier,platform_entitlement:platform,total_refund:refund,notes:input.notes.trim(),external_execution_status:'DISABLED'};
}
module.exports={fail,fingerprint,money,sum,sub,reviewAllocation};
