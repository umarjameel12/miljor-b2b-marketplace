'use strict';
// Least privilege projection for suppliers viewing post-purchase disputes.
// Removes buyer contact identity, evidence attachments, and freeform timeline
// metadata that can contain out-of-band contact details.
const SAFE_DISPUTE_FIELDS=new Set([
 'id','dispute_code','order_id','supplier_id','order_code',
 'reason','dispute_category','description','expected_quantity',
 'reported_quantity','disputed_quantity','claimed_amount','currency',
 'status','remediation_status','remediation_proposal','remediation_details',
 'supplier_response','supplier_response_at','created_at','updated_at',
 'resolution_reason','closure_reason','closed_at','order_fulfillment_status',
 'order_total_amount','order_unit_price','order_total_qty'
]);
const SAFE_TIMELINE_FIELDS=new Set(['id','event_code','from_status','to_status','action','actor_role','created_at']);
const pick=(input,allow)=>Object.fromEntries(Object.entries(input||{}).filter(([k])=>allow.has(k)));
function redactContact(value){
 if(typeof value!=='string')return value;
 return value
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[contact redacted]')
  .replace(/\b(?:\+?92[-\s]?)?0?3\d{2}[-\s]?\d{7}\b/g,'[contact redacted]')
  .replace(/https?:\/\/\S+/gi,'[external link redacted]');
}
function supplierDisputeRow(row){
 const result=pick(row,SAFE_DISPUTE_FIELDS);
 for(const k of ['description','remediation_details','supplier_response','resolution_reason','closure_reason'])
  if(Object.hasOwn(result,k))result[k]=redactContact(result[k]);
 return result;
}
function supplierDisputeTimeline(rows){return (rows||[]).map(r=>pick(r,SAFE_TIMELINE_FIELDS))}
module.exports={supplierDisputeRow,supplierDisputeTimeline};
