'use strict';

// B6-I/J/K collective qualification: aggregate only consented compatible
// supplier-owned physical SKUs. Does not create a payment or buyer commitment.
const exact=require('./exactDecimal');
const error=(code,message)=>Object.assign(new Error(message),{code,statusCode:400});
const id=(raw,label)=>{
  if(raw==null||typeof raw==='boolean'||!/^[1-9]\d*$/.test(String(raw))||
     !Number.isSafeInteger(Number(raw)))throw error('INVALID_COLLECTIVE_ID',label+' must be a positive ID.');
  return Number(raw);
};
const quantity=(raw,unit)=>{
  let q;
  try{
    q=exact.toCanonical(raw,4);
    if(!exact.exactDecimalGte(q,'0.0001',4)||q.split('.')[0].length>8)
      throw Error('range');
    if(['bag','tin','carton','sack','bundle','pack'].includes(unit)&&!/^[0-9]+\.0000$/.test(q))
      throw Error('indivisible');
  }catch{throw error('INVALID_COLLECTIVE_QUANTITY','Quantity must be positive and packaged units whole.');}
  return q;
};
const safeUnit=raw=>{
  const value=String(raw||'').toLowerCase().trim();
  if(!['kg','g','l','ml','bag','tin','carton','sack','bundle','pack'].includes(value))
    throw error('INVALID_COLLECTIVE_UNIT','Unexpected product purchasing unit.');
  return value;
};
/**
 * Inputs are trusted server-side identities (participant_id, buyer_id,
 * product_spec_id, supplier_sku_id) plus participant-approved item snapshots.
 * Result deliberately does not include buyer_id, addresses or private notes.
 */
function aggregateCollectiveDemand({participants,minimumBuyers=2}){
  if(!Number.isInteger(minimumBuyers)||minimumBuyers<2||minimumBuyers>1000)
    throw error('INVALID_COLLECTIVE_MINIMUM','Group minimum must be 2–1000 buyers.');
  if(!Array.isArray(participants)||participants.length>1000)
    throw error('INVALID_COLLECTIVE_PARTICIPANTS','Invalid group participants.');
  const included=[],seenBuyer=new Set(),lines=new Map();
  for(const participant of participants){
    const buyer=id(participant?.buyer_id,'Buyer');
    if(seenBuyer.has(buyer))throw error('DUPLICATE_COLLECTIVE_BUYER','Buyer may join once.');
    seenBuyer.add(buyer);
    if(!['JOINED','LOCKED'].includes(participant.status))continue;
    if(participant.consent_confirmed!==true || !Array.isArray(participant.lines)||
       participant.lines.length===0)
      throw error('BUYER_CONSENT_REQUIRED','All counted buyers require explicit approved quantity snapshots.');
    const selected=new Set();
    for(const row of participant.lines){
      const requestItem=id(row.request_item_id,'Shopping-list item');
      if(selected.has(requestItem))throw error('DUPLICATE_COLLECTIVE_LINE','Buyer item appears twice.');
      selected.add(requestItem);
      const family=id(row.family_id,'Product family');
      const sku=id(row.supplier_sku_id,'Supplier-owned SKU');
      const spec=id(row.product_spec_id,'Immutable physical specification');
      const unit=safeUnit(row.purchasing_unit);
      const count=quantity(row.quantity,unit);
      const key=[requestItem,family,sku,spec,unit].join(':');
      let group=lines.get(key);
      if(!group){
        group={request_item_id:requestItem,family_id:family,
          supplier_sku_id:sku,product_spec_id:spec,purchasing_unit:unit,
          total_quantity:'0.0000',buyer_count:0};
        lines.set(key,group);
      }
      group.total_quantity=exact.exactDecimalSum([group.total_quantity,count],4);
      group.buyer_count++;
    }
    included.push(buyer);
  }
  const groups=[...lines.values()].sort((a,b)=>a.request_item_id-b.request_item_id||
    a.supplier_sku_id-b.supplier_sku_id||a.product_spec_id-b.product_spec_id);
  return {qualified_participant_count:included.length,
    minimum_buyers:minimumBuyers,
    minimum_buyers_met:included.length>=minimumBuyers,
    group_lines:groups,
    contains_private_buyer_identity:false,
    ready_for_supplier_bid:false,
    payment_authorized:false,
    warning:'Aggregate only; supplier thresholds, delivery terms and each buyer payment still require separate qualification and consent.'};
}
module.exports={aggregateCollectiveDemand};
