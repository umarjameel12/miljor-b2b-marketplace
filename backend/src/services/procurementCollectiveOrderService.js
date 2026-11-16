'use strict';
// PR61 Part 2: individual buyer authorization of a qualified group's exact terms.
// One buyer -> one unpaid order. Real Safepay checkout/paid proof/fulfillment uses
// existing canonical order endpoints; no fake provider events or group proxy payment.
const crypto=require('node:crypto');
const db=require('../config/db');
const exact=require('./exactDecimal');
const fees=require('./feeService');
const notify=require('./notificationService');
const fail=(code,message,statusCode=409)=>Object.assign(new Error(message),{code,statusCode});
const id=v=>{
 if(v==null||typeof v==='boolean'||!/^[1-9]\d*$/.test(String(v))||
    !Number.isSafeInteger(Number(v)))throw fail('INVALID_ID','Positive numeric ID required',400);
 return Number(v);
};
const key=v=>{
 if(typeof v!=='string'||!/^[A-Za-z0-9:_-]{12,120}$/.test(v))
   throw fail('INVALID_IDEMPOTENCY_KEY','An idempotency key (12–120 safe characters) is required',400);
 return v;
};
const unpack=v=>typeof v==='string'?JSON.parse(v):v;
const money=v=>exact.toCanonical(v,2);
const qty=v=>exact.toCanonical(v,4);
const equal=(a,b)=>exact.exactDecimalEquals(money(a),money(b),2);
const hash=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const orderView=row=>({
  group_id:Number(row.group_id),order_id:Number(row.order_id),
  buyer_id:Number(row.buyer_id),supplier_id:Number(row.supplier_id),
  bid_version_id:Number(row.bid_version_id),
  total_amount:money(row.total_amount),
  payment_status:row.payment_status,order_status:row.order_status,
  checkout_endpoint:'/api/v1/orders/'+row.order_id+'/checkout'
});
class ProcurementCollectiveOrderService {
 constructor(database=db){this.database=database;}
 async prepare(buyerId,groupId,input,rawKey){
  const buyer=id(buyerId),gid=id(groupId),idem=key(rawKey);
  if(input?.confirm_payment_terms!==true||input?.confirm_physical_specifications!==true)
    throw fail('EXPLICIT_PAYMENT_TERMS_REQUIRED','Buyer must explicitly confirm exact payable and physical specifications',400);
  const version=id(input.bid_version_id),addressId=id(input.delivery_address_id);
  const expected=money(input.total_amount);
  const requestHash=hash({buyer,gid,version,addressId,total:expected,confirmed:true});
  const conn=await this.database.getConnection();
  try{
   await conn.beginTransaction();
   const [verified]=await conn.query(
    "SELECT id FROM users WHERE id=? AND role='BUYER' AND is_verified=1 AND verification_status='VERIFIED' AND buyer_trust_status<>'SUSPENDED' FOR UPDATE",
    [buyer]);
   if(!verified.length)throw fail('BUYER_NOT_VERIFIED','Verified buyer required',403);
   // Serialize all members of this group on the same parent lock.
   const [groups]=await conn.query(`SELECT g.id,g.status,g.qualification_snapshot,r.delivery_area,
     r.quote_deadline FROM procurement_collective_groups g
     JOIN procurement_requests r ON r.id=g.request_id WHERE g.id=? FOR UPDATE`,[gid]);
   const group=groups[0];
   if(!group)throw fail('GROUP_NOT_FOUND','Group does not exist',404);
   const qualified=unpack(group.qualification_snapshot);
   if(group.status!=='QUALIFIED'||!qualified||Number(qualified.bid_version_id)!==version)
    throw fail('GROUP_NOT_PAYMENT_READY','Group is not locked to the approved bid version');
   const [previous]=await conn.query(`SELECT co.*,o.payment_status,o.order_status FROM
     procurement_collective_buyer_orders co JOIN orders o ON o.id=co.order_id
     WHERE co.group_id=? AND co.buyer_id=? FOR UPDATE`,[gid,buyer]);
   if(previous.length){
    if(previous[0].idempotency_key!==idem||previous[0].payload_hash!==requestHash)
      throw fail('GROUP_ORDER_ALREADY_LOCKED','Your group order is already locked to a prior decision');
    await conn.commit();return {order:orderView(previous[0]),is_replay:true};
   }
   const [members]=await conn.query(`SELECT id,buyer_id,status FROM procurement_collective_participants
     WHERE group_id=? AND buyer_id=? FOR UPDATE`,[gid,buyer]);
   const member=members[0];
   if(!member||member.status!=='LOCKED')
    throw fail('GROUP_BUYER_NOT_LOCKED','Only a locked qualified participant can create own payable order',403);
   const [approvals]=await conn.query(`SELECT id,bid_version_id,item_subtotal,
     delivery_fee,buyer_fee_preview,total_preview,consent_snapshot
     FROM procurement_collective_buyer_approvals
     WHERE group_id=? AND participant_id=? AND buyer_id=? AND
       bid_version_id=? AND status='CONSENTED_NOT_PAYABLE' FOR UPDATE`,
     [gid,member.id,buyer,version]);
   if(approvals.length!==1)throw fail('INDIVIDUAL_CONSENT_REQUIRED','Buyer approval for this exact bid is missing');
   const approval=approvals[0];
   if(!equal(approval.total_preview,expected))
    throw fail('PRICE_REAPPROVAL_REQUIRED','Your accepted total differs from the saved approval');
   const [bidVersions]=await conn.query(`SELECT b.supplier_id,b.status,b.current_version,
     v.version_number,v.valid_until,v.full_snapshot FROM procurement_collective_bid_versions v
     JOIN procurement_collective_bids b ON b.id=v.bid_id WHERE v.id=? AND b.group_id=? FOR UPDATE`,[version,gid]);
   const bid=bidVersions[0];
   if(!bid||bid.status!=='ACTIVE'||Number(bid.current_version)!==Number(bid.version_number))
    throw fail('BID_VERSION_CHANGED','Supplier quote has changed');
   const [[live]]=await conn.query('SELECT (? > UTC_TIMESTAMP()) AS active',[bid.valid_until]);
   if(Number(live.active)!==1)throw fail('BID_EXPIRED','Supplier bid is no longer valid');
   const terms=unpack(bid.full_snapshot);
   if(terms.coverage!=='FULL_BASKET'||Number(terms.supplier_id)!==Number(qualified.supplier_id))
    throw fail('GROUP_TERMS_CHANGED','Accepted full-basket supplier terms are no longer valid');
   const [addresses]=await conn.query(`SELECT a.id,a.user_id,a.city,a.cluster_id,a.society_area,
     a.full_address,a.revision,a.user_confirmation_status,a.manual_review_required,
     c.is_active AS cluster_active FROM buyer_delivery_addresses a
     JOIN geographic_clusters c ON c.id=a.cluster_id WHERE a.id=? AND a.user_id=? FOR UPDATE`,
     [addressId,buyer]);
   const address=addresses[0];
   if(!address||String(address.city).toLowerCase()!=='lahore'||
      address.user_confirmation_status!=='CONFIRMED'||
      Number(address.manual_review_required)!==0||Number(address.cluster_active)!==1||
      typeof address.full_address!=='string'||address.full_address.trim().length<8)
     throw fail('DELIVERY_ADDRESS_NOT_CONFIRMED','Select a valid confirmed Lahore delivery address',409);
   // Group source delivery area and buyer destination are separately bound.
   // No guessed kilometers or new delivery fee is applied at checkout.
   const [buyerLines]=await conn.query(`SELECT request_item_id,quantity,purchasing_unit
     FROM procurement_collective_participant_lines WHERE participant_id=? ORDER BY request_item_id FOR UPDATE`,[member.id]);
   const termsByItem=new Map(terms.lines.map(line=>[Number(line.request_item_id),line]));
   if(buyerLines.length!==terms.lines.length)
    throw fail('GROUP_BASKET_INCOMPLETE','Buyer quantity is missing a required group item');
   const lines=[];
   for(const line of buyerLines){
    const t=termsByItem.get(Number(line.request_item_id));
    if(!t||String(t.purchasing_unit)!==String(line.purchasing_unit).toLowerCase())
      throw fail('PHYSICAL_SPEC_MISMATCH','Buyer item does not match immutable supplier SKU');
    lines.push({request_item_id:Number(line.request_item_id),
      listing_id:id(t.supplier_listing_id),sku_id:id(t.supplier_sku_id),
      spec_id:id(t.product_spec_id),quantity:qty(line.quantity),
      unit:String(line.purchasing_unit).toLowerCase(),unit_price:money(t.unit_price),
      subtotal:exact.exactMultiplyRound(line.quantity,t.unit_price,2),
      physical_snapshot:t.physical_snapshot});
   }
   const subtotal=exact.exactDecimalSum(lines.map(l=>l.subtotal),2);
   const buyerFee=await fees.calculateBuyerFeeExact(subtotal,conn);
   const supplierFee=await fees.calculateSupplierFeeExact(bid.supplier_id,subtotal,conn);
   const delivery=money(terms.delivery_fee_per_buyer);
   const total=exact.exactDecimalSum([subtotal,delivery,buyerFee.buyer_fee],2);
   if(!equal(subtotal,approval.item_subtotal)||!equal(delivery,approval.delivery_fee)||
      !equal(buyerFee.buyer_fee,approval.buyer_fee_preview)||!equal(total,approval.total_preview)||
      !equal(total,expected))
     throw fail('BUYER_REAPPROVAL_REQUIRED','Exact price, delivery charge or platform fees changed');
   const byListing=new Map();
   for(const line of lines){
    const prev=byListing.get(line.listing_id)||'0.0000';
    byListing.set(line.listing_id,exact.exactDecimalSum([prev,line.quantity],4));
   }
   for(const [listingId,amount] of [...byListing.entries()].sort((a,b)=>a[0]-b[0])){
    const [listings]=await conn.query(`SELECT sl.id,sl.supplier_id,sl.status,sl.currency,sl.available_stock,
      sl.buyer_min_qty,sl.supplier_sku_id,sl.product_spec_id,sk.purchasing_unit,
      sk.status AS sku_status,ps.approval_status,ps.lifecycle_status,ps.is_active
      FROM supplier_listings sl
      JOIN supplier_skus sk ON sk.id=sl.supplier_sku_id AND sk.supplier_id=sl.supplier_id
      JOIN product_specifications ps ON ps.id=sl.product_spec_id AND ps.supplier_sku_id=sk.id
      WHERE sl.id=? FOR UPDATE`,[listingId]);
    const listing=listings[0],sample=lines.find(l=>l.listing_id===listingId);
    if(!listing||Number(listing.supplier_id)!==Number(bid.supplier_id)||
       listing.status!=='ACTIVE'||listing.currency!=='PKR'||listing.sku_status!=='PUBLISHED'||
       listing.approval_status!=='APPROVED'||listing.lifecycle_status!=='PUBLISHED'||
       Number(listing.is_active)!==1||Number(listing.supplier_sku_id)!==sample.sku_id||
       Number(listing.product_spec_id)!==sample.spec_id||
       String(listing.purchasing_unit).toLowerCase()!==sample.unit)
      throw fail('LISTING_CHANGED','Supplier stock/specification no longer matches the quote');
    const [existingAllocations]=await conn.query(`SELECT allocated_qty,unit FROM supplier_inventory_allocations
      WHERE supplier_listing_id=? AND status IN ('PENDING','COMMITTED') FOR UPDATE`,[listingId]);
    if(existingAllocations.some(x=>String(x.unit).toLowerCase()!==sample.unit))
      throw fail('INVENTORY_UNIT_CONFLICT','Stock allocation has mixed purchasing units');
    const required=exact.exactDecimalSum([
      amount,...existingAllocations.map(x=>String(x.allocated_qty))],4);
    if(!exact.exactDecimalGte(listing.available_stock,required,4))
      throw fail('SHARED_STOCK_EXHAUSTED','Existing reservations and group orders exceed available stock');
   }
   const code='MJC-'+crypto.randomBytes(6).toString('hex');
   const [inserted]=await conn.query(`INSERT INTO orders
     (order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,
      delivery_fee,buyer_platform_fee,total_amount,supplier_commission_percent,
      currency,delivery_type,delivery_address,payment_status,order_status,notes)
     VALUES (?,?,?,1.0000,?,?,?,?,?,?,'PKR','GROUPED_CLUSTER',?,
      'AWAITING_PAYMENT','AWAITING_PAYMENT','COLLECTIVE_INDIVIDUAL_PAYMENT')`,
     [code,buyer,bid.supplier_id,subtotal,subtotal,delivery,buyerFee.buyer_fee,total,
      supplierFee.fee_percent,address.full_address]);
   const orderId=inserted.insertId;
   const destination={address_id:address.id,cluster_id:address.cluster_id,
     address_revision:address.revision,full_address:address.full_address,
     delivery_mode:'STANDARD_CLUSTERED',delivery_fee:delivery,group_id:gid,
     bid_version_id:version};
   const immutable={group_id:gid,participant_id:member.id,
     bid_version_id:version,approval_id:approval.id,items:lines,delivery:destination,
     subtotal,delivery_fee:delivery,buyer_fee:buyerFee.buyer_fee,
     total,supplier_fee:supplierFee.supplier_fee,commission_percent:supplierFee.fee_percent};
   const [saved]=await conn.query(`INSERT INTO procurement_collective_buyer_orders
     (group_id,participant_id,buyer_id,supplier_id,bid_version_id,approval_id,order_id,
      total_amount,item_subtotal,delivery_fee,buyer_platform_fee,supplier_fee,
      supplier_commission_percent,accepted_delivery_snapshot,accepted_terms_snapshot,
      idempotency_key,payload_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
     [gid,member.id,buyer,bid.supplier_id,version,approval.id,orderId,total,subtotal,
      delivery,buyerFee.buyer_fee,supplierFee.supplier_fee,supplierFee.fee_percent,
      JSON.stringify(destination),JSON.stringify(immutable),idem,requestHash]);
   for(const line of lines){
    await conn.query(`INSERT INTO procurement_collective_order_lines
       (collective_order_id,request_item_id,supplier_listing_id,supplier_sku_id,
        product_spec_id,quantity,purchasing_unit,unit_price,subtotal,physical_snapshot)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
       [saved.insertId,line.request_item_id,line.listing_id,line.sku_id,line.spec_id,
        line.quantity,line.unit,line.unit_price,line.subtotal,JSON.stringify(line.physical_snapshot)]);
   }
   for(const [listingId,amount] of byListing){
    const sample=lines.find(l=>l.listing_id===listingId);
    await conn.query(`INSERT INTO supplier_inventory_allocations
       (supplier_listing_id,allocation_type,reference_id,allocated_qty,unit,status)
       VALUES (?,'ORDER_DIRECT',?,?,?,'PENDING')`,
       [listingId,orderId,amount,sample.unit]);
   }
   await notify.enqueueEvent(conn,{userId:buyer,role:'BUYER',eventType:'PAYMENT_PENDING',
     eventKey:'collective:'+gid+':order:'+orderId+':payment',entityId:orderId});
   await conn.commit();
   return {order:{group_id:gid,order_id:orderId,buyer_id:buyer,supplier_id:Number(bid.supplier_id),
     bid_version_id:version,total_amount:total,payment_status:'AWAITING_PAYMENT',
     order_status:'AWAITING_PAYMENT',checkout_endpoint:'/api/v1/orders/'+orderId+'/checkout'},
     is_replay:false,payment_verified:false,stock_allocation:'PENDING'};
  }catch(error){
   await conn.rollback();
   if(error.code==='ER_DUP_ENTRY')throw fail('GROUP_ORDER_CONFLICT','Concurrent buyer confirmation; refresh your order');
   throw error;
  }finally{conn.release();}
 }
 // Runs only inside the trusted provider-signed or provider-reconciled payment
 // transaction. Never accepts a caller-supplied PAID claim.
 async reconcilePaidOrder(conn,orderId){
  const oid=id(orderId);
  const [records]=await conn.query('SELECT group_id FROM procurement_collective_buyer_orders WHERE order_id=?',[oid]);
  if(!records.length)return {handled:false};
  const gid=Number(records[0].group_id);
  const [groups]=await conn.query('SELECT id,status FROM procurement_collective_groups WHERE id=? FOR UPDATE',[gid]);
  if(!groups.length||groups[0].status!=='QUALIFIED')
    throw fail('GROUP_NOT_QUALIFIED','Paid order belongs to an invalid qualified group');
  const [orders]=await conn.query(`SELECT co.order_id,o.payment_status
    FROM procurement_collective_buyer_orders co JOIN orders o ON o.id=co.order_id
    WHERE co.group_id=? ORDER BY co.order_id`,[gid]);
  if(!orders.some(o=>Number(o.order_id)===oid&&o.payment_status==='PAID'))
    throw fail('PROVIDER_PAYMENT_REQUIRED','Only verified paid orders can commit group stock');
  const [allocations]=await conn.query(`SELECT id,status FROM supplier_inventory_allocations
    WHERE allocation_type='ORDER_DIRECT' AND reference_id=? FOR UPDATE`,[oid]);
  if(!allocations.length)throw fail('COLLECTIVE_STOCK_LEDGER_MISSING','Stock allocation missing for paid group order',500);
  await conn.query(`UPDATE supplier_inventory_allocations SET status='COMMITTED'
    WHERE allocation_type='ORDER_DIRECT' AND reference_id=? AND status='PENDING'`,[oid]);
  const paid=orders.filter(o=>o.payment_status==='PAID').length;
  return {handled:true,group_id:gid,paid_orders:paid,total_orders:orders.length,
    group_payment_status:paid===orders.length?'ALL_ORDERS_PAID':'PARTIALLY_PAID',
    supplier_settlement_not_authorized:true};
 }
 async getMine(buyerId,groupId){
  const buyer=id(buyerId),gid=id(groupId);
  const [members]=await this.database.query('SELECT id FROM procurement_collective_participants WHERE group_id=? AND buyer_id=?',[gid,buyer]);
  if(!members.length)throw fail('GROUP_NOT_FOUND','No buyer participation found',404);
  const [orders]=await this.database.query(`SELECT co.*,o.payment_status,o.order_status,
    o.fulfillment_status FROM procurement_collective_buyer_orders co
    JOIN orders o ON o.id=co.order_id WHERE co.group_id=? AND co.buyer_id=?`,[gid,buyer]);
  return {group_id:gid,has_order:orders.length>0,order:orders[0]?orderView(orders[0]):null,
    payment_requires_authoritative_safepay:true,group_payment_not_auto_authorized:true};
 }
 async supplierGroup(supplierId,groupId){
  const supplier=id(supplierId),gid=id(groupId);
  const [rows]=await this.database.query(`SELECT co.order_id,co.group_id,
    co.total_amount,o.payment_status,o.order_status,o.fulfillment_status,
    JSON_EXTRACT(co.accepted_delivery_snapshot,'$.cluster_id') AS cluster_id,
    JSON_EXTRACT(co.accepted_delivery_snapshot,'$.delivery_mode') AS delivery_mode
    FROM procurement_collective_buyer_orders co JOIN orders o ON o.id=co.order_id
    WHERE co.group_id=? AND co.supplier_id=? ORDER BY co.order_id`,[gid,supplier]);
  if(!rows.length)throw fail('GROUP_NOT_FOUND','No supplier-owned group orders',404);
  const paid=rows.filter(r=>r.payment_status==='PAID').length;
  return {group_id:gid,order_count:rows.length,paid_orders:paid,
    unpaid_orders:rows.length-paid,all_paid:paid===rows.length,
    orders:rows.map(r=>({order_id:r.order_id,payment_status:r.payment_status,
      fulfillment_status:r.fulfillment_status,cluster_id:Number(r.cluster_id)||null,
      delivery_mode:String(r.delivery_mode).replaceAll('"','')})),
    automatic_settlement:false};
 }
}
module.exports=new ProcurementCollectiveOrderService();
module.exports.ProcurementCollectiveOrderService=ProcurementCollectiveOrderService;
