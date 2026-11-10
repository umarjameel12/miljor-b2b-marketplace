'use strict';
// B6-J: supplier group bids backed by verified physical listings and joined buyer demand.
// No checkout, reservation, payment or buyer PII disclosed to suppliers.
const crypto=require('node:crypto');
const db=require('../config/db');
const exact=require('./exactDecimal');
const {buildCollectiveBidPreview}=require('./procurementCollectiveBidPolicy');
const err=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
const id=v=>{if(v==null||typeof v==='boolean'||!/^[1-9]\d*$/.test(String(v))||
  !Number.isSafeInteger(Number(v)))throw err('INVALID_ID','Positive identifier required.');return Number(v)};
const idem=v=>{if(typeof v!=='string'||!/^[a-zA-Z0-9:_-]{12,120}$/.test(v))
  throw err('INVALID_IDEMPOTENCY_KEY','Provide a valid X-Idempotency-Key.');return v};
const money=v=>{try{let n=exact.toCanonical(v,2);
  if(n.split('.')[0].length>10||!exact.exactDecimalGte(n,'0.00',2))throw Error();
  return n;}catch{throw err('INVALID_PRICE','Exact nonnegative PKR required.')}};
const unpack=v=>typeof v==='string'?JSON.parse(v):v;
const groupsql="SELECT g.*,r.delivery_area,r.status AS request_status,r.quote_deadline FROM procurement_collective_groups g JOIN procurement_requests r ON r.id=g.request_id WHERE g.id=?";
const loadGroup=async(conn,gid,lock=false)=>{const [rows]=await conn.query(groupsql+(lock?' FOR UPDATE':''),[id(gid)]);
  if(!rows.length)throw err('COLLECTIVE_NOT_FOUND','Group not found.',404);return rows[0]};
const eligibleArea=(raw,area)=>{
  let zones;try{zones=unpack(raw)}catch{return false}
  if(!Array.isArray(zones))return false;
  const place=String(area||'').toLowerCase().replace(/,/g,' ').replace(/\s+/g,' ').trim();
  return zones.some(z=>typeof z==='string'&&(
    (['all lahore','lahore wide'].includes(z.toLowerCase())&&/\blahore\b/.test(place))||
    place===z.toLowerCase()||place.startsWith(z.toLowerCase()+' ')));
};
class ProcurementCollectiveBidService {
 constructor(database=db){this.database=database}
 async demand(conn,group){
  const [items]=await conn.query('SELECT id,family_id,unit,requirements FROM procurement_request_items WHERE request_id=? ORDER BY line_number',[group.request_id]);
  const [participants]=await conn.query('SELECT id,buyer_id,status,consent_at,consent_snapshot FROM procurement_collective_participants WHERE group_id=? ORDER BY id',[group.id]);
  const [allLines]=await conn.query('SELECT l.participant_id,l.request_item_id,l.quantity,l.purchasing_unit FROM procurement_collective_participant_lines l JOIN procurement_collective_participants p ON p.id=l.participant_id WHERE p.group_id=?',[group.id]);
  return {items,participants:participants.map(p=>({
   buyer_id:p.buyer_id,status:p.status,
   consent_confirmed:!!p.consent_at&&unpack(p.consent_snapshot)?.explicit_join===true,
   lines:allLines.filter(l=>Number(l.participant_id)===Number(p.id)).map(l=>({
    request_item_id:l.request_item_id,quantity:l.quantity,unit:l.purchasing_unit}))
  }))};
 }
 async openBidding(buyerId,groupId){
  const actor=id(buyerId),conn=await this.database.getConnection();
  try{await conn.beginTransaction();
   const group=await loadGroup(conn,groupId,true);
   if(Number(group.organizer_buyer_id)!==actor)throw err('ORGANIZER_ONLY','Organizer required.',403);
   if(group.status==='QUOTING'){await conn.commit();return {group_id:group.id,status:'QUOTING',is_replay:true}}
   if(group.status!=='FORMING')throw err('GROUP_STATE_CONFLICT','Group must be forming.',409);
   const [[clock]]=await conn.query('SELECT (? <= UTC_TIMESTAMP()) AS join_finished,(? > UTC_TIMESTAMP()) AS quote_open',[group.join_deadline,group.quote_deadline]);
   if(Number(clock?.join_finished)!==1||Number(clock?.quote_open)!==1)
    throw err('JOIN_CUTOFF_NOT_REACHED','Joining cutoff must pass while supplier quotes remain open.',409);
   const demand=await this.demand(conn,group);
   const count=demand.participants.filter(p=>p.status==='JOINED'&&p.consent_confirmed).length;
   if(count<Number(group.minimum_buyers))throw err('GROUP_NOT_QUALIFIED','Not enough consenting buyers.',409);
   await conn.query("UPDATE procurement_collective_groups SET status='QUOTING' WHERE id=? AND status='FORMING'",[group.id]);
   await conn.commit();return {group_id:group.id,status:'QUOTING',qualified_buyers:count,is_replay:false};
  }catch(e){await conn.rollback();throw e}finally{conn.release()}
 }
 async submitBid(supplierId,groupId,payload,rawKey){
  const supplier=id(supplierId),gid=id(groupId),key=idem(rawKey);
  if(!Array.isArray(payload?.lines)||!payload.lines.length||payload.lines.length>50)
   throw err('INVALID_BID_LINES','Supply 1–50 group bid lines.');
  const date=payload.valid_until;
  if(typeof date!=='string'||!/(Z|[+-]\d\d:\d\d)$/i.test(date)||!Number.isFinite(Date.parse(date))||
   Date.parse(date)<=Date.now()+60000)throw err('INVALID_BID_EXPIRY','Future offset-aware validity required.');
  const validUntil=new Date(date).toISOString().slice(0,19).replace('T',' ');
  const delivery=money(payload.delivery_fee_per_buyer??'0.00');
  const inputs=payload.lines.map(l=>({request_item_id:id(l.request_item_id),
   supplier_listing_id:id(l.supplier_listing_id),unit_price:money(l.unit_price),
   min_aggregate_quantity:l.min_aggregate_quantity}));
  const hash=crypto.createHash('sha256').update(JSON.stringify({gid,validUntil,delivery,inputs})).digest('hex');
  const conn=await this.database.getConnection();
  try{await conn.beginTransaction();
   const group=await loadGroup(conn,gid,true);
   const [existing]=await conn.query('SELECT id,status,current_version FROM procurement_collective_bids WHERE group_id=? AND supplier_id=? FOR UPDATE',[gid,supplier]);
   let bid=existing[0];
   if(bid){
    const [old]=await conn.query('SELECT payload_hash,full_snapshot FROM procurement_collective_bid_versions WHERE bid_id=? AND idempotency_key=?',[bid.id,key]);
    if(old.length){
     if(old[0].payload_hash!==hash)throw err('IDEMPOTENCY_CONFLICT','Bid key already used.',409);
     await conn.commit();return {bid:unpack(old[0].full_snapshot),is_replay:true};
    }
   }
   if(group.status!=='QUOTING')throw err('GROUP_NOT_QUOTING','Supplier bidding is not open.',409);
   const [[clock]]=await conn.query('SELECT (? > UTC_TIMESTAMP()) AS group_open,(? > UTC_TIMESTAMP()) AS bid_valid',[group.quote_deadline,validUntil]);
   if(Number(clock?.group_open)!==1||Number(clock?.bid_valid)!==1)throw err('GROUP_EXPIRED','Bidding window expired.',409);
   const [verified]=await conn.query("SELECT u.id FROM users u JOIN supplier_profiles p ON p.supplier_id=u.id WHERE u.id=? AND u.role='SUPPLIER' AND u.is_verified=1 AND u.verification_status='VERIFIED' AND p.verification_status='VERIFIED'",[supplier]);
   if(!verified.length)throw err('SUPPLIER_NOT_VERIFIED','Verified supplier required.',403);
   const demand=await this.demand(conn,group),lines=[];
   for(const l of inputs){
    const [rows]=await conn.query("SELECT sl.id,sl.available_stock,sl.delivery_zones,sl.supplier_sku_id,sl.product_spec_id,sk.family_id,sk.purchasing_unit,sk.pack_size,sk.pack_unit,sp.title,sp.brand,sp.variety,sp.quality_grade FROM supplier_listings sl JOIN supplier_skus sk ON sk.id=sl.supplier_sku_id AND sk.supplier_id=sl.supplier_id AND sk.status='PUBLISHED' JOIN supplier_products sp ON sp.id=sk.supplier_product_id AND sp.supplier_id=sl.supplier_id AND sp.status='PUBLISHED' JOIN product_specifications ps ON ps.id=sl.product_spec_id AND ps.supplier_sku_id=sk.id AND ps.supplier_id=sl.supplier_id AND ps.is_active=1 AND ps.approval_status='APPROVED' AND ps.lifecycle_status='PUBLISHED' WHERE sl.id=? AND sl.supplier_id=? AND sl.status='ACTIVE' AND sl.currency='PKR'",[l.supplier_listing_id,supplier]);
    const record=rows[0];
    if(!record||!eligibleArea(record.delivery_zones,group.delivery_area))
     throw err('LISTING_NOT_ELIGIBLE','Supplier listing does not serve the group.',409);
    lines.push({...l,available_stock:record.available_stock,physical_snapshot:{
      supplier_sku_id:record.supplier_sku_id,product_spec_id:record.product_spec_id,
      family_id:record.family_id,purchasing_unit:record.purchasing_unit,
      title:record.title,brand:record.brand,variety:record.variety,
      quality_grade:record.quality_grade,pack_size:String(record.pack_size),pack_unit:record.pack_unit}});
   }
   const preview=buildCollectiveBidPreview({
    requestItems:demand.items,participants:demand.participants,supplierLines:lines,
    minimumBuyers:Number(group.minimum_buyers),deliveryFeePerBuyer:delivery});
   for(const line of preview.lines){
    const listed=lines.find(l=>l.supplier_listing_id===line.supplier_listing_id);
    if(!exact.exactDecimalGte(listed.available_stock,line.aggregate_quantity,4))
     throw err('GROUP_STOCK_INSUFFICIENT','Listing stock insufficient for demand.',409);
   }
   if(bid&&bid.status!=='ACTIVE')throw err('BID_WITHDRAWN','Withdrawn bid cannot be revised.',409);
   if(!bid){
    const [created]=await conn.query("INSERT INTO procurement_collective_bids(group_id,supplier_id,status,current_version) VALUES (?,?,'ACTIVE',0)",[gid,supplier]);
    bid={id:created.insertId,current_version:0};
   }
   const version=Number(bid.current_version)+1;
   const snapshot={bid_id:bid.id,group_id:gid,supplier_id:supplier,version_number:version,
    valid_until:validUntil,coverage:preview.coverage,
    delivery_fee_per_buyer:preview.delivery_fee_per_buyer,
    aggregate_item_subtotal:preview.aggregate_item_subtotal,lines:preview.lines,
    creates_order:false,authorizes_payment:false};
   const [saved]=await conn.query("INSERT INTO procurement_collective_bid_versions(bid_id,version_number,valid_until,min_group_buyers,delivery_fee_per_buyer,item_subtotal,full_snapshot,idempotency_key,payload_hash) VALUES (?,?,?,?,?,?,?,?,?)",[bid.id,version,validUntil,group.minimum_buyers,delivery,preview.aggregate_item_subtotal,JSON.stringify(snapshot),key,hash]);
   for(const l of preview.lines){
    await conn.query("INSERT INTO procurement_collective_bid_lines(bid_version_id,request_item_id,supplier_listing_id,supplier_sku_id,product_spec_id,aggregate_quantity,min_aggregate_quantity,purchasing_unit,unit_price,subtotal,physical_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?)",[saved.insertId,l.request_item_id,l.supplier_listing_id,l.supplier_sku_id,l.product_spec_id,l.aggregate_quantity,l.min_aggregate_quantity,l.purchasing_unit,l.unit_price,l.subtotal,JSON.stringify(l.physical_snapshot)]);
   }
   await conn.query('UPDATE procurement_collective_bids SET current_version=? WHERE id=?',[version,bid.id]);
   await conn.commit();return {bid:snapshot,is_replay:false};
  }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')throw err('BID_CONFLICT','Concurrent supplier bid conflict.',409);throw e}finally{conn.release()}
 }
 async listForBuyer(buyerId,groupId){
  const buyer=id(buyerId),group=await loadGroup(this.database,groupId);
  const [members]=await this.database.query('SELECT id FROM procurement_collective_participants WHERE group_id=? AND buyer_id=?',[group.id,buyer]);
  if(!members.length)throw err('GROUP_NOT_FOUND','Group invitation not found.',404);
  const [bids]=await this.database.query("SELECT b.id,b.supplier_id,b.status,b.current_version,v.id AS bid_version_id,v.valid_until,v.full_snapshot FROM procurement_collective_bids b JOIN procurement_collective_bid_versions v ON v.bid_id=b.id AND v.version_number=b.current_version WHERE b.group_id=? ORDER BY b.id",[group.id]);
  return bids.map(b=>({...b,full_snapshot:unpack(b.full_snapshot)}));
 }
}
module.exports=new ProcurementCollectiveBidService();
module.exports.ProcurementCollectiveBidService=ProcurementCollectiveBidService;
