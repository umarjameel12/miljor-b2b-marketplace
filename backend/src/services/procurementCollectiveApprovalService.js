'use strict';
// B6-K: each collective buyer consents to OWN exact bid version and fee preview.
// Intentionally NO order, stock allocation or Safepay until independent settlement gate.
const crypto=require('node:crypto');
const db=require('../config/db');
const exact=require('./exactDecimal');
const feeService=require('./feeService');
const fail=(code,message,statusCode=400)=>Object.assign(new Error(message),{code,statusCode});
const id=v=>{if(v==null||typeof v==='boolean'||!/^[1-9]\d*$/.test(String(v))||
 !Number.isSafeInteger(Number(v)))throw fail('INVALID_ID','Positive numeric ID required.');return Number(v)};
const key=v=>{if(typeof v!=='string'||!/^[a-zA-Z0-9:_-]{12,120}$/.test(v))
 throw fail('INVALID_IDEMPOTENCY_KEY','Provide X-Idempotency-Key of 12–120 safe chars.');return v};
const decode=x=>typeof x==='string'?JSON.parse(x):x;
class ProcurementCollectiveApprovalService {
 constructor(database=db){this.database=database}
 async _preview(conn,buyerId,groupId,bidId,lock=false){
  const buyer=id(buyerId),gid=id(groupId),bid=id(bidId);
  const [groups]=await conn.query("SELECT g.id,g.status,g.quote_deadline,g.qualification_policy FROM procurement_collective_groups g WHERE g.id=?"+(lock?' FOR UPDATE':''),[gid]);
  if(!groups.length)throw fail('GROUP_NOT_FOUND','Collective not found.',404);
  if(groups[0].status!=='QUOTING')throw fail('GROUP_NOT_QUOTING','Collective is not accepting bid consent.',409);
  const [[clock]]=await conn.query("SELECT (? > UTC_TIMESTAMP()) AS quote_open",[groups[0].quote_deadline]);
  if(Number(clock?.quote_open)!==1)throw fail('GROUP_QUOTE_EXPIRED','Bid approval window closed.',409);
  const [members]=await conn.query("SELECT id,status,consent_at FROM procurement_collective_participants WHERE group_id=? AND buyer_id=?"+(lock?' FOR UPDATE':''),[gid,buyer]);
  const member=members[0];
  if(!member||member.status!=='JOINED'||!member.consent_at)
   throw fail('PARTICIPANT_NOT_JOINED','Only a consented group participant can approve.',403);
  const [bids]=await conn.query("SELECT b.id,b.status,b.current_version,v.id AS version_id,v.valid_until,v.full_snapshot FROM procurement_collective_bids b JOIN procurement_collective_bid_versions v ON v.bid_id=b.id AND v.version_number=b.current_version WHERE b.id=? AND b.group_id=?"+(lock?' FOR UPDATE':''),[bid,gid]);
  const current=bids[0];
  if(!current||current.status!=='ACTIVE')throw fail('BID_NOT_AVAILABLE','Supplier bid unavailable.',404);
  const [[valid]]=await conn.query('SELECT (? > UTC_TIMESTAMP()) AS bid_open',[current.valid_until]);
  if(Number(valid?.bid_open)!==1)throw fail('BID_EXPIRED','Supplier bid expired.',409);
  const bidTerms=decode(current.full_snapshot);
  if(bidTerms.coverage!=='FULL_BASKET')
   throw fail('PARTIAL_GROUP_BID_REQUIRES_CONSENT_POLICY','Partial group settlement requires additional buyer approvals.',409);
  const [rows]=await conn.query("SELECT request_item_id,quantity,purchasing_unit FROM procurement_collective_participant_lines WHERE participant_id=? ORDER BY request_item_id",[member.id]);
  if(!rows.length)throw fail('PARTICIPANT_LINES_REQUIRED','No approved buyer demand.',409);
  const offers=new Map(bidTerms.lines.map(line=>[Number(line.request_item_id),line]));
  const lines=rows.map(row=>{
   const term=offers.get(Number(row.request_item_id));
   if(!term||String(row.purchasing_unit).toLowerCase()!==term.purchasing_unit)
    throw fail('PHYSICAL_SPEC_MISMATCH','Seller bid does not match buyer requested lines.',409);
   return {request_item_id:Number(row.request_item_id),quantity:String(row.quantity),
    purchasing_unit:term.purchasing_unit,unit_price:term.unit_price,
    supplier_sku_id:term.supplier_sku_id,product_spec_id:term.product_spec_id,
    supplier_listing_id:term.supplier_listing_id,
    physical_snapshot:term.physical_snapshot,
    subtotal:exact.exactMultiplyRound(row.quantity,term.unit_price,2)};
  });
  const subtotal=exact.exactDecimalSum(lines.map(x=>x.subtotal),2);
  const fee=await feeService.calculateBuyerFeeExact(subtotal,conn);
  const total=exact.exactDecimalSum([subtotal,bidTerms.delivery_fee_per_buyer,fee.buyer_fee],2);
  return {buyer_id:buyer,group_id:gid,participant_id:member.id,bid_id:bid,
   bid_version_id:current.version_id,version_number:current.current_version,
   supplier_id:bidTerms.supplier_id,items:lines,item_subtotal:subtotal,
   supplier_delivery_fee:bidTerms.delivery_fee_per_buyer,buyer_platform_fee:fee.buyer_fee,
   total_preview:total,currency:'PKR',status:'PREVIEW_ONLY',
   requires_explicit_payment:true,creates_order:false,authorizes_payment:false};
 }
 async preview(buyerId,groupId,bidId){
  return this._preview(this.database,buyerId,groupId,bidId);
 }
 async consent(buyerId,groupId,bidId,payload,rawKey){
  const buyer=id(buyerId),gid=id(groupId),bid=id(bidId),idem=key(rawKey);
  if(payload?.physical_specifications_accepted!==true||payload?.buyer_total_confirmed!==true)
   throw fail('EXPLICIT_BUYER_CONSENT_REQUIRED','Buyer must approve exact physical SKU and own payable preview.');
  let expected;
  try{expected=exact.toCanonical(payload.total_preview,2)}
  catch{throw fail('INVALID_TOTAL','Exact buyer preview total required.')}
  const version=id(payload.bid_version_id);
  const hash=crypto.createHash('sha256').update(JSON.stringify({buyer,gid,bid,version,expected,consent:true})).digest('hex');
  const conn=await this.database.getConnection();
  try{await conn.beginTransaction();
   const [groups]=await conn.query('SELECT id FROM procurement_collective_groups WHERE id=? FOR UPDATE',[gid]);
   if(!groups.length)throw fail('GROUP_NOT_FOUND','Collective not found.',404);
   const [existing]=await conn.query('SELECT request_hash,original_response_snapshot FROM procurement_collective_buyer_approvals WHERE buyer_id=? AND idempotency_key=? FOR UPDATE',[buyer,idem]);
   if(existing.length){
    if(existing[0].request_hash!==hash)throw fail('IDEMPOTENCY_CONFLICT','Approval key already used for different terms.',409);
    await conn.commit();return {approval:decode(existing[0].original_response_snapshot),is_replay:true};
   }
   const current=await this._preview(conn,buyer,gid,bid,true);
   if(Number(current.bid_version_id)!==version)
    throw fail('BID_VERSION_CHANGED','Supplier bid changed; refresh before consenting.',409);
   if(!exact.exactDecimalEquals(current.total_preview,expected,2))
    throw fail('BUYER_REAPPROVAL_REQUIRED','Supplier quote or buyer fees changed.',409);
   const [prior]=await conn.query('SELECT id FROM procurement_collective_buyer_approvals WHERE group_id=? AND participant_id=?',[gid,current.participant_id]);
   if(prior.length)throw fail('BUYER_ALREADY_APPROVED','Buyer already selected another immutable bid.',409);
   const snapshot={buyer_id:buyer,group_id:gid,bid_version_id:version,
    physical_specifications_accepted:true,items:current.items,
    total_preview:expected,creates_payment:false};
   const [saved]=await conn.query("INSERT INTO procurement_collective_buyer_approvals(group_id,participant_id,buyer_id,bid_version_id,item_subtotal,delivery_fee,buyer_fee_preview,total_preview,consent_snapshot,idempotency_key,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",[gid,current.participant_id,buyer,version,current.item_subtotal,current.supplier_delivery_fee,current.buyer_platform_fee,expected,JSON.stringify(snapshot),idem,hash]);
   const response={approval_id:saved.insertId,group_id:gid,buyer_id:buyer,
    bid_version_id:version,status:'CONSENTED_NOT_PAYABLE',total_preview:expected,
    creates_order:false,creates_payment:false};
   await conn.query('UPDATE procurement_collective_buyer_approvals SET original_response_snapshot=? WHERE id=?',[JSON.stringify(response),saved.insertId]);
   await conn.commit();return {approval:response,is_replay:false};
  }catch(e){await conn.rollback();if(e.code==='ER_DUP_ENTRY')
    throw fail('APPROVAL_CONFLICT','Another buyer approval already exists.',409);throw e}
  finally{conn.release()}
 }
}
module.exports=new ProcurementCollectiveApprovalService();
module.exports.ProcurementCollectiveApprovalService=ProcurementCollectiveApprovalService;
