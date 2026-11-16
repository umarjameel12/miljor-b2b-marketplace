'use strict';
const crypto=require('node:crypto');
const exact=require('./exactDecimal');
const fail=(code,message)=>Object.assign(new Error(message),{code,statusCode:409});
const pickupSnapshot=point=>({id:Number(point.id),point_name:point.point_name,address_line:point.address_line,operating_hours:point.operating_hours,collection_instructions:point.collection_instructions});
function snapshotDeliveryTerms(row){
  if(!row||!['STANDARD_CLUSTERED','PICKUP','EXPRESS'].includes(row.mode))throw fail('INVALID_DELIVERY_TERMS','Unsupported delivery terms');
  const number=value=>{
    if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw fail('INVALID_DELIVERY_TERMS','Invalid delivery identifier');
    return Number(value);
  };
  const fee=exact.toCanonical(row.quoted_delivery_fee_pkr,2);
  if(!exact.exactDecimalGte(fee,'0.00',2))throw fail('INVALID_DELIVERY_TERMS','Invalid delivery fee');
  const expires=row.expires_at instanceof Date?row.expires_at.toISOString():String(row.expires_at).replace(' ','T').replace(/(?<!Z)$/,'Z');
  if(!Number.isFinite(Date.parse(expires)))throw fail('INVALID_DELIVERY_TERMS','Invalid delivery expiry');
  const raw=row.destination_address_snapshot;
  const address=typeof raw==='string'?JSON.parse(raw):raw;
  const pickup=typeof row.procurement_pickup_snapshot==='string'?JSON.parse(row.procurement_pickup_snapshot):row.procurement_pickup_snapshot;
  if(row.mode!=='PICKUP'&&(!address?.address_id||!row.destination_fingerprint))throw fail('VERIFIED_DELIVERY_DESTINATION_REQUIRED','Delivery requires a saved destination');
  if(row.mode!=='PICKUP'&&Number(address.cluster_id)!==Number(row.cluster_id))throw fail('VERIFIED_DELIVERY_DESTINATION_REQUIRED','Saved address must match the delivery cluster');
  if(row.mode!=='PICKUP'&&address.geographic_match_status!=='VERIFIED')throw fail('VERIFIED_DELIVERY_DESTINATION_REQUIRED','Delivery destination must be geographically verified');
  number(row.buyer_id);
  const terms={schema_version:1,quote_code:String(row.quote_code),
    supplier_id:number(row.supplier_id),mode:row.mode,cluster_id:number(row.cluster_id),fee,
    pickup_point_id:row.mode==='PICKUP'?number(row.pickup_point_id):null,
    pickup_snapshot:row.mode==='PICKUP'&&pickup?pickupSnapshot(pickup):null,
    address_id:row.mode==='PICKUP'?null:number(row.address_id||address?.address_id),
    destination_fingerprint:row.mode==='PICKUP'?null:row.destination_fingerprint,
    address_revision:row.mode==='PICKUP'?null:number(address?.revision),
    supplier_config_version:number(row.supplier_config_version),expires_at:expires};
  if(row.mode!=='PICKUP'&&(!/^[a-f0-9]{64}$/.test(String(terms.destination_fingerprint))))
    throw fail('VERIFIED_DELIVERY_DESTINATION_REQUIRED','Delivery requires an immutable destination fingerprint');
  return {...terms,hash:crypto.createHash('sha256').update(JSON.stringify(terms)).digest('hex')};
}
function assertDeliveryConsent(terms,acceptedHash){
  if(terms&&terms.hash!==acceptedHash)throw fail('DELIVERY_REAPPROVAL_REQUIRED','Review and approve the exact supplier delivery terms');
}
module.exports={snapshotDeliveryTerms,assertDeliveryConsent,pickupSnapshot};
