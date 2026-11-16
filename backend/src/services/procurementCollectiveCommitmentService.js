'use strict';
// Collective source adapter. Canonical B6 award/payment/stock engines remain the
// sole payable path. Derived quotes preserve the supplier's immutable group bid.
const db=require('../config/db'),crypto=require('node:crypto'),exact=require('./exactDecimal');
const notifications=require('./notificationService');
const {aggregateCapacity,assertGroupFunding}=require('./procurementCollectiveCommitmentPolicy');
const decode=value=>typeof value==='string'?JSON.parse(value):value;
const fail=(code,message,statusCode=409)=>Object.assign(Error(message),{code,statusCode});
const id=value=>{if(!/^[1-9]\d*$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw fail('INVALID_COMMITMENT_ID','Positive identifier required',400);return Number(value);};
class ProcurementCollectiveCommitmentService{
 constructor(database=db,notifier=notifications){this.database=database;this.notifications=notifier;}
 async prepareMine(buyerId,groupId){
  const buyer=id(buyerId),gid=id(groupId),conn=await this.database.getConnection();
  try{
   await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
   await conn.beginTransaction();
   await require('./procurementRecurringService')._verified(conn,buyer);
   const [groups]=await conn.query('SELECT g.*,r.delivery_area,r.quote_deadline FROM procurement_collective_groups g JOIN procurement_requests r ON r.id=g.request_id WHERE g.id=? FOR UPDATE',[gid]);
   const group=groups[0],qualification=decode(group?.qualification_snapshot);
   if(!group||group.status!=='QUALIFIED'||!qualification)throw fail('GROUP_NOT_QUALIFIED','Individually consented, qualified group required');
   const [members]=await conn.query("SELECT id,buyer_id FROM procurement_collective_participants WHERE group_id=? AND status='LOCKED' ORDER BY id FOR UPDATE",[gid]);
   if(!members.some(member=>Number(member.buyer_id)===buyer))throw fail('GROUP_MEMBER_REQUIRED','Only a locked buyer may prepare their own commitment',403);
   const [approvals]=await conn.query("SELECT * FROM procurement_collective_buyer_approvals WHERE group_id=? AND bid_version_id=? AND status='CONSENTED_NOT_PAYABLE' ORDER BY participant_id FOR UPDATE",[gid,qualification.bid_version_id]);
   if(approvals.length!==members.length||approvals.length!==Number(qualification.qualified_buyer_count)||members.some(member=>!approvals.some(a=>Number(a.participant_id)===Number(member.id)&&Number(a.buyer_id)===Number(member.buyer_id))))throw fail('GROUP_CONSENT_CHANGED','Every locked buyer must retain their own exact consent');
   const [versions]=await conn.query('SELECT v.*,b.supplier_id,b.current_version,b.status FROM procurement_collective_bid_versions v JOIN procurement_collective_bids b ON b.id=v.bid_id WHERE v.id=? FOR UPDATE',[qualification.bid_version_id]);
   const version=versions[0];
   if(!version||version.status!=='ACTIVE'||Number(version.current_version)!==Number(version.version_number))throw fail('GROUP_BID_CHANGED','Supplier bid changed');
   await require('./fulfillmentService')._assertVerifiedSupplier({id:version.supplier_id,role:'SUPPLIER'},conn);
   const [existing]=await conn.query('SELECT * FROM procurement_collective_commitments WHERE group_id=? ORDER BY id FOR UPDATE',[gid]);
   if(!existing.length){
    const [[clock]]=await conn.query('SELECT LEAST(?, ?, DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 MINUTE)) AS expires_at, (? > UTC_TIMESTAMP() AND ? > UTC_TIMESTAMP()) AS live',[version.valid_until,group.quote_deadline,version.valid_until,group.quote_deadline]);
    if(Number(clock.live)!==1)throw fail('GROUP_BID_EXPIRED','Group bid expired');
    const allLines=approvals.flatMap(approval=>decode(approval.consent_snapshot).items);
    const demand=aggregateCapacity(allLines);
    if(!demand.length)throw fail('GROUP_CAPACITY_MISSING','At least one physical line is required');
    const terms=decode(version.full_snapshot);
    const quoted=aggregateCapacity(terms.lines.map(line=>({...line,quantity:line.aggregate_quantity})));
    if(JSON.stringify(demand)!==JSON.stringify(quoted))throw fail('GROUP_DEMAND_CHANGED','Approved demand no longer matches supplier aggregate bid');
    for(const needed of demand){
     const [stock]=await conn.query('SELECT available_stock,buyer_min_qty,status,supplier_id FROM supplier_listings WHERE id=? FOR UPDATE',[needed.listing_id]);
     if(!stock.length||stock[0].status!=='ACTIVE'||Number(stock[0].supplier_id)!==Number(version.supplier_id))throw fail('GROUP_LISTING_CHANGED','Listing no longer eligible');
     if(allLines.some(line=>Number(line.supplier_listing_id)===needed.listing_id&&!exact.exactDecimalGte(line.quantity,stock[0].buyer_min_qty,4)))throw fail('GROUP_BUYER_MINIMUM_UNMET','Every individual buyer must meet buyer_min_qty before any group capacity or payable order is prepared');
     const [held]=await conn.query("SELECT allocated_qty,unit FROM supplier_inventory_allocations WHERE supplier_listing_id=? AND status IN ('PENDING','COMMITTED') FOR UPDATE",[needed.listing_id]);
     if(held.some(row=>String(row.unit).toLowerCase()!==needed.unit)||!exact.exactDecimalGte(stock[0].available_stock,exact.exactDecimalSum([...held.map(row=>row.allocated_qty),needed.quantity],4),4))throw fail('GROUP_STOCK_UNAVAILABLE','Shared stock already reserved by another order or pool');
    }
    for(const approval of approvals){
     const [[stillLive]]=await conn.query('SELECT (? > UTC_TIMESTAMP()) live',[clock.expires_at]);
     if(Number(stillLive.live)!==1)throw fail('GROUP_BID_EXPIRED','Group terms expired while waiting for stock');
     const [created]=await conn.query('INSERT INTO procurement_collective_commitments(group_id,approval_id,buyer_id,bid_version_id,expires_at,consent_snapshot) VALUES (?,?,?,?,?,?)',[gid,approval.id,approval.buyer_id,approval.bid_version_id,clock.expires_at,JSON.stringify(decode(approval.consent_snapshot))]);
     const commitment=created.insertId;
     for(const needed of aggregateCapacity(decode(approval.consent_snapshot).items)){
      const [allocation]=await conn.query("INSERT INTO supplier_inventory_allocations(supplier_listing_id,allocation_type,reference_id,allocated_qty,unit,status,notes) VALUES (?,'MANUAL_HOLD',?,?,?,'PENDING',?)",[needed.listing_id,commitment,needed.quantity,needed.unit,'SMART_COLLECTIVE_HOLD:'+commitment]);
      await conn.query('INSERT INTO procurement_collective_capacity(commitment_id,supplier_listing_id,allocation_id,quantity,unit) VALUES (?,?,?,?,?)',[commitment,needed.listing_id,allocation.insertId,needed.quantity,needed.unit]);
     }
     await this.notifications.enqueueEvent(conn,{userId:approval.buyer_id,role:'BUYER',eventType:'GROUP_CAPACITY_RESERVED',eventKey:'commitment:'+commitment+':held',entityId:gid});
    }
   }
   const [ownRows]=await conn.query('SELECT * FROM procurement_collective_commitments WHERE group_id=? AND buyer_id=? FOR UPDATE',[gid,buyer]);
   const own=ownRows[0];if(!own)throw fail('GROUP_COMMITMENT_MISSING','Buyer commitment not found');
   if(own.status==='RELEASED')throw fail('GROUP_COMMITMENT_RELEASED','Commitment released; existing paid peers require independent resolution');
   if(!own.request_id){
    const [[clock]]=await conn.query('SELECT (? > UTC_TIMESTAMP()) live',[own.expires_at]);if(Number(clock.live)!==1)throw fail('GROUP_COMMITMENT_EXPIRED','Capacity hold expired');
    const snapshot=decode(own.consent_snapshot);
    const [created]=await conn.query("INSERT INTO procurement_requests(buyer_id,request_code,ownership,frequency,status,delivery_area,quote_deadline,idempotency_key,request_hash,collective_commitment_id) VALUES (?,?,'SINGLE_BUYER','ONE_TIME','OPEN',?,?,?,?,?)",[buyer,'MJ-GC-'+crypto.randomUUID(),group.delivery_area,own.expires_at,'collective-commitment:'+own.id,crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),own.id]);
    const rid=created.insertId,lines=[];
    for(const [index,line] of snapshot.items.entries()){
     const [source]=await conn.query('SELECT family_id,requirements,allow_substitutions FROM procurement_request_items WHERE id=? AND request_id=?',[line.request_item_id,group.request_id]);
     if(!source.length)throw fail('GROUP_ITEM_CHANGED','Source group line missing');
     const [item]=await conn.query('INSERT INTO procurement_request_items(request_id,line_number,family_id,quantity,unit,requirements,allow_substitutions) VALUES (?,?,?,?,?,?,?)',[rid,index+1,source[0].family_id,line.quantity,line.purchasing_unit,source[0].requirements,source[0].allow_substitutions]);
     lines.push({request_item_id:item.insertId,supplier_listing_id:line.supplier_listing_id,quantity:line.quantity,unit_price:line.unit_price,subtotal:line.subtotal,snapshot:line.physical_snapshot});
    }
    const [invitation]=await conn.query("INSERT INTO procurement_supplier_invitations(request_id,supplier_id,status,eligible_line_ids) VALUES (?,?,'INTERESTED',?)",[rid,version.supplier_id,JSON.stringify(lines.map(line=>line.request_item_id))]);
    const [quote]=await conn.query('INSERT INTO procurement_quotes(request_id,supplier_id,invitation_id) VALUES (?,?,?)',[rid,version.supplier_id,invitation.insertId]);
    const approval=approvals.find(value=>Number(value.id)===Number(own.approval_id));
    const quoteSnapshot={coverage:'FULL_BASKET',lines,collective_origin:{group_id:gid,bid_version_id:version.id,approval_id:own.approval_id}};
    const [derivedVersion]=await conn.query("INSERT INTO procurement_quote_versions(quote_id,version_number,coverage,valid_until,delivery_fee,delivery_lead_days,items_total,quoted_total,immutable_snapshot,idempotency_key,payload_hash,supplier_notes) VALUES (?,1,'FULL_BASKET',?,?,1,?,?,?,?,?,?)",[quote.insertId,own.expires_at,approval.delivery_fee,approval.item_subtotal,exact.exactDecimalSum([approval.item_subtotal,approval.delivery_fee],2),JSON.stringify(quoteSnapshot),'collective-derived:'+own.id,crypto.createHash('sha256').update(JSON.stringify(quoteSnapshot)).digest('hex'),'Derived immutable supplier collective bid '+version.id]);
    for(const line of lines)await conn.query('INSERT INTO procurement_quote_lines(quote_version_id,request_item_id,supplier_listing_id,supplier_sku_id,quantity,purchasing_unit,unit_price,subtotal,supplier_sku_snapshot) VALUES (?,?,?,?,?,?,?,?,?)',[derivedVersion.insertId,line.request_item_id,line.supplier_listing_id,line.snapshot.supplier_sku_id,line.quantity,line.snapshot.purchasing_unit,line.unit_price,line.subtotal,JSON.stringify(line.snapshot)]);
    await conn.query('UPDATE procurement_collective_commitments SET request_id=? WHERE id=?',[rid,own.id]);
    own.request_id=rid;
   }
   await conn.commit();return {commitment_id:own.id,request_id:own.request_id,status:own.status,expires_at:own.expires_at,creates_order:false,creates_payment:false,requires_individual_gated_award:true,all_group_orders_must_be_paid_before_fulfillment:true};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 }
 async lockForAward(conn,buyer,commitmentId,requestId){
  const [links]=await conn.query('SELECT group_id FROM procurement_collective_commitments WHERE id=? AND buyer_id=? AND request_id=?',[commitmentId,buyer,requestId]);
  if(!links.length)throw fail('GROUP_COMMITMENT_NOT_OWNED','Own group commitment required',403);
  const [groups]=await conn.query("SELECT status,qualification_snapshot FROM procurement_collective_groups WHERE id=? FOR UPDATE",[links[0].group_id]);
  const [rows]=await conn.query('SELECT *,expires_at>UTC_TIMESTAMP() AS live FROM procurement_collective_commitments WHERE id=? FOR UPDATE',[commitmentId]);
  const commitment=rows[0];
  if(groups[0]?.status!=='QUALIFIED'||commitment.status!=='HELD'||Number(commitment.live)!==1)throw fail('GROUP_COMMITMENT_UNAVAILABLE','Group commitment is expired, released or already ordered');
  const [sourceBids]=await conn.query("SELECT v.id,b.supplier_id FROM procurement_collective_bid_versions v JOIN procurement_collective_bids b ON b.id=v.bid_id WHERE v.id=? AND b.status='ACTIVE' AND b.current_version=v.version_number AND v.valid_until>UTC_TIMESTAMP() FOR UPDATE",[commitment.bid_version_id]);
  if(!sourceBids.length||Number(decode(groups[0].qualification_snapshot).bid_version_id)!==Number(commitment.bid_version_id))throw fail('GROUP_BID_CHANGED','Qualified supplier bid no longer current');
  const [accepted]=await conn.query("SELECT delivery_fee FROM procurement_collective_buyer_approvals WHERE id=? AND buyer_id=? AND status='CONSENTED_NOT_PAYABLE' AND bid_version_id=? FOR UPDATE",[commitment.approval_id,buyer,commitment.bid_version_id]);
  if(!accepted.length)throw fail('GROUP_CONSENT_CHANGED','Buyer group consent no longer valid');
  const [quotes]=await conn.query("SELECT v.immutable_snapshot,v.delivery_fee,q.supplier_id FROM procurement_quotes q JOIN procurement_quote_versions v ON v.quote_id=q.id AND v.version_number=q.current_version WHERE q.request_id=? AND q.status='ACTIVE' FOR UPDATE",[requestId]);
  const consent=decode(commitment.consent_snapshot),quote=quotes.length===1?decode(quotes[0].immutable_snapshot):null;
  const identity=line=>({listing:Number(line.supplier_listing_id),sku:Number(line.supplier_sku_id??line.snapshot?.supplier_sku_id),spec:Number(line.product_spec_id??line.snapshot?.product_spec_id),quantity:exact.toCanonical(line.quantity,4),unit_price:exact.toCanonical(line.unit_price,2),physical:line.physical_snapshot??line.snapshot});
  if(!quote||Number(quotes[0].supplier_id)!==Number(sourceBids[0].supplier_id)||!exact.exactDecimalEquals(quotes[0].delivery_fee,accepted[0].delivery_fee,2)||Number(quote.collective_origin?.approval_id)!==Number(commitment.approval_id)||Number(quote.collective_origin?.bid_version_id)!==Number(commitment.bid_version_id)||JSON.stringify(quote.lines.map(identity))!==JSON.stringify(consent.items.map(identity)))throw fail('GROUP_TERMS_CHANGED','Group physical terms, supplier and prices require a new collective consent');
  const [capacity]=await conn.query('SELECT * FROM procurement_collective_capacity WHERE commitment_id=? ORDER BY supplier_listing_id',[commitmentId]);
  for(const held of capacity){
   await conn.query('SELECT id FROM supplier_listings WHERE id=? FOR UPDATE',[held.supplier_listing_id]);
   const [released]=await conn.query("UPDATE supplier_inventory_allocations SET status='RELEASED' WHERE id=? AND allocation_type='MANUAL_HOLD' AND reference_id=? AND status='PENDING' AND allocated_qty=? AND unit=?",[held.allocation_id,commitmentId,held.quantity,held.unit]);
   if(released.affectedRows!==1)throw fail('GROUP_CAPACITY_CHANGED','Reserved capacity no longer available');
  }
  if(!capacity.length)throw fail('GROUP_CAPACITY_MISSING','No reserved physical capacity');
 }
 async lockGroup(conn,buyer,commitmentId,requestId){
  const [links]=await conn.query('SELECT group_id FROM procurement_collective_commitments WHERE id=? AND buyer_id=? AND request_id=?',[commitmentId,buyer,requestId]);
  if(!links.length)throw fail('GROUP_COMMITMENT_NOT_OWNED','Own group commitment required',403);
  await conn.query('SELECT id FROM procurement_collective_groups WHERE id=? FOR UPDATE',[links[0].group_id]);
 }
 async recordAward(conn,commitmentId,awardId){
  const [result]=await conn.query("UPDATE procurement_collective_commitments SET status='ORDERED',award_id=? WHERE id=? AND status='HELD'",[awardId,commitmentId]);
  if(result.affectedRows!==1)throw fail('GROUP_COMMITMENT_RACE','Commitment already changed');
 }
 async assertFunded(conn,orderId){
  const [origins]=await conn.query('SELECT c.group_id FROM procurement_collective_commitments c JOIN procurement_award_orders ao ON ao.award_id=c.award_id WHERE ao.order_id=?',[orderId]);
  if(!origins.length)return;
  const [groups]=await conn.query('SELECT qualification_snapshot FROM procurement_collective_groups WHERE id=? FOR UPDATE',[origins[0].group_id]);
  const [members]=await conn.query('SELECT c.status,o.payment_status FROM procurement_collective_commitments c LEFT JOIN procurement_award_orders ao ON ao.award_id=c.award_id LEFT JOIN orders o ON o.id=ao.order_id WHERE c.group_id=?',[origins[0].group_id]);
  assertGroupFunding(Number(decode(groups[0].qualification_snapshot).qualified_buyer_count),members);
 }
 async releaseMine(buyerId,groupId){
  const buyer=id(buyerId),gid=id(groupId),conn=await this.database.getConnection();
  try{await conn.beginTransaction();
   await conn.query('SELECT id FROM procurement_collective_groups WHERE id=? FOR UPDATE',[gid]);
   const [rows]=await conn.query('SELECT * FROM procurement_collective_commitments WHERE group_id=? AND buyer_id=? FOR UPDATE',[gid,buyer]);
   const own=rows[0];if(!own)throw fail('GROUP_COMMITMENT_NOT_FOUND','Own commitment not found',404);
   if(own.status==='ORDERED')throw fail('GROUP_ORDER_REQUIRES_RESOLUTION','Created orders require payment/refund resolution; their stock cannot be silently released');
   if(own.status!=='RELEASED'){
    const [held]=await conn.query('SELECT * FROM procurement_collective_capacity WHERE commitment_id=? ORDER BY supplier_listing_id',[own.id]);
    for(const line of held){await conn.query('SELECT id FROM supplier_listings WHERE id=? FOR UPDATE',[line.supplier_listing_id]);await conn.query("UPDATE supplier_inventory_allocations SET status='RELEASED' WHERE id=? AND allocation_type='MANUAL_HOLD' AND reference_id=? AND status='PENDING'",[line.allocation_id,own.id]);}
    await conn.query("UPDATE procurement_collective_commitments SET status='RELEASED' WHERE id=?",[own.id]);
    await this.notifications.enqueueEvent(conn,{userId:buyer,role:'BUYER',eventType:'GROUP_CAPACITY_RELEASED',eventKey:'commitment:'+own.id+':released',entityId:gid});
   }
   await conn.commit();return {commitment_id:own.id,status:'RELEASED',paid_peers_unchanged:true};
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 }
 async releaseExpiredBatch({limit=20}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw fail('INVALID_WORKER_LIMIT','Choose 1–100 commitments',400);
  const [expired]=await this.database.query("SELECT group_id,buyer_id FROM procurement_collective_commitments WHERE status='HELD' AND expires_at<=UTC_TIMESTAMP() ORDER BY expires_at,id LIMIT ?",[limit]);
  const result={checked:expired.length,released:0,failed:0};
  for(const row of expired){try{await this.releaseMine(row.buyer_id,row.group_id);result.released++;}catch(error){if(error.code!=='GROUP_ORDER_REQUIRES_RESOLUTION')result.failed++;}}
  return result;
 }
}
module.exports=new ProcurementCollectiveCommitmentService();module.exports.ProcurementCollectiveCommitmentService=ProcurementCollectiveCommitmentService;
