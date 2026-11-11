'use strict';

// B6-J/K: exact, side-effect-free supplier group-bid qualification.
// All quantities and SKU details are authoritative DB snapshots passed by the service.
const exact=require('./exactDecimal');
const fail=(code,message)=>Object.assign(new Error(message),{code,statusCode:400});
function ident(raw,label) {
  const v=String(raw??'');
  if(!/^[1-9]\d*$/.test(v)||!Number.isSafeInteger(Number(v)))
    throw fail('INVALID_COLLECTIVE_ID',label+' must be a positive safe integer.');
  return Number(v);
}
function quantity(raw,unit){
  let q;
  try{
    q=exact.toCanonical(raw,4);
    if(!exact.exactDecimalGte(q,'0.0001',4)||q.split('.')[0].length>8)
      throw Error('range');
    if(['bag','tin','carton','sack','bundle','pack'].includes(unit) &&
       !/^\d+\.0000$/.test(q))throw Error('indivisible');
  }catch{throw fail('INVALID_COLLECTIVE_QUANTITY','Quantity must be positive and discrete packages whole.');}
  return q;
}
function money(raw,positive=false){
  let v;
  try{
    v=exact.toCanonical(raw,2);
    if(v.split('.')[0].length>10||!exact.exactDecimalGte(v,positive?'0.01':'0.00',2))
      throw Error('money');
  }catch{throw fail('INVALID_COLLECTIVE_PRICE','Prices must use exact nonnegative PKR amounts.');}
  return v;
}
function unit(raw){
  const v=String(raw||'').toLowerCase().trim();
  if(!['kg','g','l','ml','bag','tin','carton','sack','bundle','pack'].includes(v))
    throw fail('INVALID_COLLECTIVE_UNIT','Unsupported purchasing unit.');
  return v;
}
/**
 * All participants are loaded under the group lock and independently consented.
 * Seller quote lines bind to the SAME immutable physical SKU and specification
 * for an item; different items and physical units are NEVER pooled together.
 */
function buildCollectiveBidPreview({requestItems,participants,supplierLines,
  minimumBuyers=2,deliveryFeePerBuyer='0.00'}){
  if(!Array.isArray(requestItems)||!requestItems.length||requestItems.length>50)
    throw fail('INVALID_GROUP_ITEMS','Collective needs 1–50 request items.');
  if(!Number.isInteger(minimumBuyers)||minimumBuyers<2||minimumBuyers>1000)
    throw fail('INVALID_GROUP_MINIMUM','Collective minimum is 2–1000 buyers.');
  if(!Array.isArray(participants)||participants.length>1000)
    throw fail('INVALID_PARTICIPANTS','Participant snapshot is invalid.');
  if(!Array.isArray(supplierLines)||!supplierLines.length||supplierLines.length>50)
    throw fail('INVALID_BID_LINES','Supplier must quote 1–50 distinct items.');
  const requested=new Map();
  for(const raw of requestItems){
    const id=ident(raw.id,'Request item');
    if(requested.has(id))throw fail('DUPLICATE_GROUP_ITEM','Duplicate requested item.');
    requested.set(id,{family_id:ident(raw.family_id,'Family'),unit:unit(raw.unit),
      requirements:typeof raw.requirements==='string'?raw.requirements:null});
  }
  const buyers=new Map(),aggregate=new Map();
  for(const participant of participants){
    if(participant.status!=='JOINED'&&participant.status!=='LOCKED')continue;
    const buyer=ident(participant.buyer_id,'Buyer');
    if(buyers.has(buyer))throw fail('DUPLICATE_PARTICIPANT','A buyer cannot be counted twice.');
    if(participant.consent_confirmed!==true||!Array.isArray(participant.lines)||
      !participant.lines.length)throw fail('UNCONSENTED_PARTICIPANT','Joined buyer has not explicitly confirmed lines.');
    const entries=new Map();
    for(const raw of participant.lines){
      const itemId=ident(raw.request_item_id,'Request item');
      const item=requested.get(itemId);
      if(!item||entries.has(itemId))throw fail('INVALID_BUYER_LINES','Buyer selected an unknown or repeated group item.');
      if(unit(raw.unit||raw.purchasing_unit)!==item.unit)
        throw fail('MIXED_UNIT_COLLECTIVE','Buyer units do not match request.');
      const qty=quantity(raw.quantity,item.unit);
      entries.set(itemId,qty);
      aggregate.set(itemId,exact.exactDecimalSum([aggregate.get(itemId)||'0.0000',qty],4));
    }
    buyers.set(buyer,entries);
  }
  if(buyers.size<minimumBuyers)
    throw fail('COLLECTIVE_NOT_QUALIFIED','Not enough independently consenting business buyers.');
  const bidLines=[],seen=new Set();
  for(const input of supplierLines){
    const request_item_id=ident(input.request_item_id,'Bid item');
    const item=requested.get(request_item_id);
    if(!item||seen.has(request_item_id))throw fail('INVALID_BID_ITEM','Bid line must be unique and belong to this collective.');
    seen.add(request_item_id);
    const physical=input.physical_snapshot;
    if(!physical||typeof physical!=='object')
      throw fail('PHYSICAL_SPEC_REQUIRED','Supplier physical SKU snapshot is required.');
    const supplier_sku_id=ident(physical.supplier_sku_id,'Supplier SKU');
    const product_spec_id=ident(physical.product_spec_id,'Product specification');
    const supplier_listing_id=ident(input.supplier_listing_id,'Supplier listing');
    if(unit(physical.purchasing_unit)!==item.unit ||
      Number(physical.family_id)!==item.family_id)
      throw fail('PHYSICAL_SPEC_MISMATCH','Supplier SKU family/unit differs from requested product.');
    const agg=aggregate.get(request_item_id)||'0.0000';
    if(!exact.exactDecimalGte(agg,'0.0001',4))
      throw fail('GROUP_ITEM_HAS_NO_DEMAND','At least one joined buyer must demand the quoted item.');
    const min=quantity(input.min_aggregate_quantity,item.unit);
    if(!exact.exactDecimalGte(agg,min,4))
      throw fail('COLLECTIVE_THRESHOLD_UNMET','Supplier minimum demand not reached.');
    const price=money(input.unit_price,true);
    const subtotal=exact.exactMultiplyRound(agg,price,2);
    bidLines.push({request_item_id,family_id:item.family_id,
      supplier_listing_id,supplier_sku_id,product_spec_id,
      aggregate_quantity:agg,min_aggregate_quantity:min,
      purchasing_unit:item.unit,unit_price:price,subtotal,
      buyer_requirements:item.requirements,physical_snapshot:physical});
  }
  const delivery=money(deliveryFeePerBuyer);
  const itemTotal=exact.exactDecimalSum(bidLines.map(x=>x.subtotal),2);
  const offers=new Map(bidLines.map(x=>[x.request_item_id,x]));
  const buyersPreview=[];
  for(const [buyerId,entries] of buyers){
    const covered=[...entries].filter(([itemId])=>offers.has(itemId)).map(([itemId,qty])=>{
      const offer=offers.get(itemId);
      return {request_item_id:itemId,quantity:qty,unit:offer.purchasing_unit,
        supplier_sku_id:offer.supplier_sku_id,product_spec_id:offer.product_spec_id,
        subtotal:exact.exactMultiplyRound(qty,offer.unit_price,2)};
    });
    const allCovered=covered.length===entries.size;
    const subtotal=exact.exactDecimalSum(covered.map(x=>x.subtotal),2);
    buyersPreview.push({buyer_id:buyerId,covered_line_count:covered.length,
      all_lines_covered:allCovered,lines:covered,
      item_subtotal:subtotal,delivery_fee:delivery,
      supplier_quoted_total:exact.exactDecimalSum([subtotal,covered.length?delivery:'0.00'],2),
      authorizes_payment:false});
  }
  return {status:'PREVIEW_ONLY',qualified_buyers:buyers.size,
    min_buyers:minimumBuyers,coverage:bidLines.length===requested.size?'FULL_BASKET':'PARTIAL',
    lines:bidLines,aggregate_item_subtotal:itemTotal,
    delivery_fee_per_buyer:delivery,buyers:buyersPreview,
    payment_authorized:false,inventory_reserved:false,
    warning:'No buyer is charged; all buyers must separately accept their own physical specifications and final fee-inclusive amount.'};
}
module.exports={buildCollectiveBidPreview};
