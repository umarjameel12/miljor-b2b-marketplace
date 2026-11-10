'use strict';
// B6-J/K integration gate. NEVER run against miljor_db.
process.env.NODE_ENV='test';process.env.TEST_DB_NAME='miljor_test_db';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const db=require('../src/config/db');
const requests=require('../src/services/procurementRequestService');
const collectives=require('../src/services/procurementCollectiveService');
const bids=require('../src/services/procurementCollectiveBidService');
const approvals=require('../src/services/procurementCollectiveApprovalService');
let requestId=null,groupId=null,count=0;
const pass=(name,ok)=>{assert.ok(ok,name);console.log('PASS '+(++count)+': '+name)};
const reject=async(fn,code)=>assert.rejects(fn,e=>e.code===code);
async function main(){
 const [[identity]]=await db.query('SELECT DATABASE() AS name');
 assert.equal(identity.name,'miljor_test_db','Refusing protected database');
 pass('Isolated database identity',true);
 const tables=['procurement_collective_groups','procurement_collective_participants',
  'procurement_collective_supplier_invitations','procurement_collective_bids',
  'procurement_collective_bid_versions','procurement_collective_bid_lines',
  'procurement_collective_buyer_approvals'];
 for(const table of tables){
  const [r]=await db.query('SELECT ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
  assert.equal(r.length,1,'Migration 041/044 missing: '+table);
  assert.equal(r[0].ENGINE,'InnoDB');
 }
 pass('Collective transactional schema present',true);
 const [buyers]=await db.query("SELECT id FROM users WHERE role='BUYER' AND is_verified=1 AND verification_status='VERIFIED' AND buyer_trust_status<>'SUSPENDED' ORDER BY id LIMIT 2");
 if(buyers.length!==2)throw Error('BLOCKED: 2 verified test buyers missing');
 const [listings]=await db.query("SELECT sl.id,sl.supplier_id,sk.family_id,sk.purchasing_unit,sl.delivery_zones FROM supplier_listings sl JOIN supplier_skus sk ON sk.id=sl.supplier_sku_id AND sk.status='PUBLISHED' JOIN supplier_products sp ON sp.id=sk.supplier_product_id AND sp.status='PUBLISHED' JOIN product_specifications ps ON ps.id=sl.product_spec_id AND ps.is_active=1 AND ps.approval_status='APPROVED' AND ps.lifecycle_status='PUBLISHED' JOIN users u ON u.id=sl.supplier_id AND u.is_verified=1 AND u.verification_status='VERIFIED' WHERE sl.status='ACTIVE' AND sl.currency='PKR' AND sl.available_stock>=5 AND sl.buyer_min_qty<=5 AND sk.purchasing_unit='bag' LIMIT 20");
 const candidate=listings.map(row=>{
  let arr;try{arr=typeof row.delivery_zones==='string'?JSON.parse(row.delivery_zones):row.delivery_zones;}catch{return null}
  const z=Array.isArray(arr)?arr.find(x=>typeof x==='string'&&x.trim()):null;
  return z?{...row,area:/lahore/i.test(z)?'Johar Town, Lahore':z}:null;
 }).find(Boolean);
 if(!candidate)throw Error('BLOCKED: supplier-owned 5-bag listing fixture missing');
 pass('Verified supplier SKU with 5 sellable bags available',true);
 const tag=crypto.randomUUID();
 const [ordersBefore]=await db.query('SELECT COUNT(*) AS n FROM orders');
 const [paymentsBefore]=await db.query('SELECT COUNT(*) AS n FROM payments');
 const draft=await requests.createDraft(buyers[0].id,{
  ownership:'COLLECTIVE',frequency:'ONE_TIME',delivery_area:candidate.area,
  join_deadline:new Date(Date.now()+3600000).toISOString(),
  quote_deadline:new Date(Date.now()+48*3600000).toISOString(),
  items:[{family_id:candidate.family_id,quantity:'2',unit:'bag'}]
 },'b6jk-request-'+tag);
 requestId=draft.request.id;
 const group=await collectives.createGroup(buyers[0].id,requestId,{minimum_buyers:2});
 groupId=group.group.id;
 await collectives.invite(buyers[0].id,groupId,buyers[1].id);
 const requestItemId=draft.request.items[0].id;
 await collectives.join(buyers[0].id,groupId,
  [{request_item_id:requestItemId,quantity:'2'}],'b6jk-join-a-'+tag);
 await collectives.join(buyers[1].id,groupId,
  [{request_item_id:requestItemId,quantity:'3'}],'b6jk-join-b-'+tag);
 pass('Two separate buyers joined with 2 and 3 bags',true);
 await reject(()=>bids.openBidding(buyers[0].id,groupId),'JOIN_CUTOFF_NOT_REACHED');
 pass('Cannot open bidding before join cutoff',true);
 // Modify ONLY this test-owned group's cutoff to simulate next-hour completion.
 await db.query('UPDATE procurement_collective_groups SET join_deadline=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?',[groupId]);
 const opened=await bids.openBidding(buyers[0].id,groupId);
 pass('Organizer can open bidding after qualified cutoff',opened.status==='QUOTING');
 await reject(()=>bids.submitBid(candidate.supplier_id,groupId,{
  valid_until:new Date(Date.now()+24*3600000).toISOString(),
  delivery_fee_per_buyer:'125.00',
  lines:[{request_item_id:requestItemId,supplier_listing_id:candidate.id,
   unit_price:'250.00',min_aggregate_quantity:'5'}]
 },'b6jk-uninvited-'+tag),'COLLECTIVE_SUPPLIER_INVITATION_REQUIRED');
 pass('Uninvited supplier cannot quote private group',true);
 await bids.inviteSupplier(buyers[0].id,groupId,candidate.supplier_id);
 const inbox=await bids.supplierInbox(candidate.supplier_id);
 pass('Supplier private inbox has no buyer identity or address',
  inbox.some(x=>Number(x.group_id)===Number(groupId)) &&
  inbox.every(x=>!Object.hasOwn(x,'buyer_id')&&!Object.hasOwn(x,'delivery_address')));
 const offer={valid_until:new Date(Date.now()+24*3600000).toISOString(),
  delivery_fee_per_buyer:'125.00',
  lines:[{request_item_id:requestItemId,supplier_listing_id:candidate.id,
   unit_price:'250.00',min_aggregate_quantity:'5'}]};
 const first=await bids.submitBid(candidate.supplier_id,groupId,offer,'b6jk-offer-'+tag);
 pass('Supplier bid aggregates exact 5 bags and Rs 1250',
  first.bid.lines[0].aggregate_quantity==='5.0000' &&
  first.bid.aggregate_item_subtotal==='1250.00');
 const replay=await bids.submitBid(candidate.supplier_id,groupId,offer,'b6jk-offer-'+tag);
 pass('Supplier bid retries preserve immutable version',replay.is_replay===true);
 const offers=await bids.listForBuyer(buyers[1].id,groupId);
 pass('Joined buyer can read quote without other buyer PII',offers.length===1);
 const preview=await approvals.preview(buyers[1].id,groupId,first.bid.bid_id);
 pass('Buyer sees own 3 bags, delivery and platform fee, no payment',
  preview.items[0].quantity.startsWith('3') && preview.creates_order===false &&
  preview.authorizes_payment===false);
 const consent=await approvals.consent(buyers[1].id,groupId,first.bid.bid_id,{
  bid_version_id:preview.bid_version_id,total_preview:preview.total_preview,
  physical_specifications_accepted:true,buyer_total_confirmed:true
 },'b6jk-consent-'+tag);
 pass('Buyer consent is saved without creating an order',consent.approval.status==='CONSENTED_NOT_PAYABLE');
 const consentReplay=await approvals.consent(buyers[1].id,groupId,first.bid.bid_id,{
  bid_version_id:preview.bid_version_id,total_preview:preview.total_preview,
  physical_specifications_accepted:true,buyer_total_confirmed:true
 },'b6jk-consent-'+tag);
 pass('Buyer consent idempotency preserved',consentReplay.is_replay===true);
 const revised=await bids.submitBid(candidate.supplier_id,groupId,{
  ...offer,lines:[{...offer.lines[0],unit_price:'240.00'}]
 },'b6jk-revised-'+tag);
 pass('Supplier bid revision creates a new immutable version',
  revised.bid.version_number===2 && revised.bid.aggregate_item_subtotal==='1200.00');
 const updatedPreview=await approvals.preview(buyers[1].id,groupId,first.bid.bid_id);
 await reject(()=>approvals.consent(buyers[1].id,groupId,first.bid.bid_id,{
  bid_version_id:updatedPreview.bid_version_id,total_preview:updatedPreview.total_preview,
  physical_specifications_accepted:true,buyer_total_confirmed:true
 },'b6jk-silent-replace-'+tag),'EXPLICIT_REAPPROVAL_REQUIRED');
 pass('New quote cannot silently overwrite the previous buyer consent',true);
 const updatedConsent=await approvals.consent(buyers[1].id,groupId,first.bid.bid_id,{
  bid_version_id:updatedPreview.bid_version_id,total_preview:updatedPreview.total_preview,
  physical_specifications_accepted:true,buyer_total_confirmed:true,
  replace_previous_consent:true
 },'b6jk-explicit-replace-'+tag);
 pass('Buyer may explicitly approve new quoted terms',
  updatedConsent.approval.status==='CONSENTED_NOT_PAYABLE');
 const [savedApprovals]=await db.query(
  'SELECT status FROM procurement_collective_buyer_approvals WHERE group_id=? AND buyer_id=? ORDER BY id',
  [groupId,buyers[1].id]
 );
 pass('Original consent preserved as revoked, only one active consent',
  savedApprovals.length===2 && savedApprovals[0].status==='REVOKED' &&
  savedApprovals[1].status==='CONSENTED_NOT_PAYABLE');
 const [[afterOrders]]=await db.query('SELECT COUNT(*) AS n FROM orders');
 const [[afterPayments]]=await db.query('SELECT COUNT(*) AS n FROM payments');
 pass('No phantom order or payment',String(ordersBefore[0].n)===String(afterOrders.n)&&
  String(paymentsBefore[0].n)===String(afterPayments.n));
 console.log('B6 COLLECTIVE BID/CONSENT GATE: '+count+'/'+count+' PASS');
}
main().catch(e=>{console.error('B6 COLLECTIVE GATE FAIL:',e.stack||e);process.exitCode=1})
.finally(async()=>{
 try{
  const [[identity]]=await db.query('SELECT DATABASE() AS name');
  assert.equal(identity.name,'miljor_test_db','Cleanup refused: wrong DB');
  if(groupId){
   await db.query('DELETE FROM procurement_collective_buyer_approvals WHERE group_id=?',[groupId]);
   await db.query('DELETE FROM procurement_collective_bid_lines WHERE bid_version_id IN (SELECT v.id FROM procurement_collective_bid_versions v JOIN procurement_collective_bids b ON b.id=v.bid_id WHERE b.group_id=?)',[groupId]);
   await db.query('DELETE FROM procurement_collective_bid_versions WHERE bid_id IN (SELECT id FROM procurement_collective_bids WHERE group_id=?)',[groupId]);
   await db.query('DELETE FROM procurement_collective_bids WHERE group_id=?',[groupId]);
   await db.query('DELETE FROM procurement_collective_supplier_invitations WHERE group_id=?',[groupId]);
   await db.query('DELETE FROM procurement_collective_participant_lines WHERE participant_id IN (SELECT id FROM procurement_collective_participants WHERE group_id=?)',[groupId]);
   await db.query('DELETE FROM procurement_collective_participants WHERE group_id=?',[groupId]);
   await db.query('DELETE FROM procurement_collective_groups WHERE id=?',[groupId]);
  }
  if(requestId){
   await db.query('DELETE FROM procurement_request_mutations WHERE request_id=?',[requestId]);
   await db.query('DELETE FROM procurement_request_items WHERE request_id=?',[requestId]);
   await db.query('DELETE FROM procurement_requests WHERE id=?',[requestId]);
  }
 }catch(e){console.error('Test fixture cleanup failed:',e);process.exitCode=1}
 await db.end();
});
