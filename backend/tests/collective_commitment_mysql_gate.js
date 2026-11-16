'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.DB_NAME,'miljor_test_db');assert.equal(process.env.TEST_DB_NAME,'miljor_test_db');
const db=require('../src/config/db'),requests=require('../src/services/procurementRequestService'),groups=require('../src/services/procurementCollectiveService'),bids=require('../src/services/procurementCollectiveBidService'),approvals=require('../src/services/procurementCollectiveApprovalService'),commitments=require('../src/services/procurementCollectiveCommitmentService'),awards=require('../src/services/procurementAwardService');
const {ProcurementCollectiveCommitmentService}=require('../src/services/procurementCollectiveCommitmentService');
const tag=crypto.randomUUID(),users=[],groupIds=[],requestIds=[],fixtures={};let count=0;
const pass=label=>console.log('PASS '+(++count)+' '+label);
const denied=(fn,code)=>assert.rejects(fn,error=>error.code===code);
async function main(){
 assert.equal((await db.query('SELECT DATABASE() name'))[0][0].name,'miljor_test_db');
 const [families]=await db.query("SELECT f.id AS family_id FROM catalog_product_families f JOIN catalog_categories c ON c.id=f.category_id AND c.is_active=1 AND c.approval_status='APPROVED' WHERE f.is_active=1 AND f.approval_status='APPROVED' AND JSON_CONTAINS(f.allowed_purchasing_units,JSON_QUOTE('bag')) ORDER BY f.id LIMIT 1");assert.ok(families.length,'Approved canonical bag family required');const source=families[0];
 for(const role of ['SUPPLIER','BUYER','BUYER','BUYER']){const [u]=await db.query("INSERT INTO users(full_name,email,role,is_verified,verification_status) VALUES (?,?,?,1,'VERIFIED')",['Collective commitment fixture',users.length+'-'+tag+'@example.invalid',role]);users.push(u.insertId);}
 const [supplier,buyerA,buyerB,outsider]=users;
 await db.query("INSERT INTO supplier_profiles(supplier_id,business_type,verification_status,subscription_plan,subscription_status,transaction_fee_percent) VALUES (?,'WHOLESALER','VERIFIED','STARTER','STARTER_ACTIVE',2.5)",[supplier]);
 const catalog=require('../src/services/catalogService');
 const product=await catalog.createSupplierProduct(supplier,{family_id:source.family_id,is_unbranded:false,brand:'Gate collective',variety:tag});fixtures.product=product.id;
 const sku=await catalog.createSupplierSku(supplier,{supplier_product_id:product.id,packaging_type:'PP Woven Bag',pack_size:25,pack_unit:'kg',purchasing_unit:'bag'});fixtures.sku=sku.id;
 await catalog.publishSupplierSku(supplier,sku.id);
 let listingResponse,listingStatus;
 await require('../src/controllers/supplierListingController').createListing({user:{id:supplier,role:'SUPPLIER'},body:{supplier_sku_id:sku.id,available_stock:5,base_unit_price:100,supplier_min_qty:1,buyer_min_qty:1,delivery_zones:['all lahore']}},{status(code){listingStatus=code;return this;},json(body){listingResponse=body;return this;}});
 assert.equal(listingStatus,201,JSON.stringify(listingResponse));fixtures.listing=listingResponse.data.listing.id;
 for(let index=0;index<2;index++){
  const draft=await requests.createDraft(buyerA,{ownership:'COLLECTIVE',delivery_area:'Lahore',join_deadline:new Date(Date.now()+3600000).toISOString(),quote_deadline:new Date(Date.now()+86400000).toISOString(),items:[{family_id:source.family_id,quantity:'2',unit:'bag'}]},'gc-draft-'+index+'-'+tag);requestIds.push(draft.request.id);
  const group=(await groups.createGroup(buyerA,draft.request.id,{minimum_buyers:2})).group;groupIds.push(group.id);
  await groups.invite(buyerA,group.id,buyerB);
  for(const [buyer,quantity] of [[buyerA,'2'],[buyerB,'3']])await groups.join(buyer,group.id,[{request_item_id:draft.request.items[0].id,quantity}],'gc-join-'+buyer+'-'+group.id+'-'+tag);
  await db.query('UPDATE procurement_collective_groups SET join_deadline=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?',[group.id]);await bids.openBidding(buyerA,group.id);await bids.inviteSupplier(buyerA,group.id,supplier);
  const bid=(await bids.submitBid(supplier,group.id,{valid_until:new Date(Date.now()+3600000).toISOString(),delivery_fee_per_buyer:'25.00',lines:[{request_item_id:draft.request.items[0].id,supplier_listing_id:fixtures.listing,unit_price:'100.00',min_aggregate_quantity:'5'}]},'gc-bid-'+index+'-'+tag)).bid;
  let version;
  for(const buyer of [buyerA,buyerB]){const preview=await approvals.preview(buyer,group.id,bid.bid_id);version=preview.bid_version_id;await approvals.consent(buyer,group.id,bid.bid_id,{bid_version_id:version,total_preview:preview.total_preview,physical_specifications_accepted:true,buyer_total_confirmed:true},'gc-consent-'+buyer+'-'+group.id+'-'+tag);}
  await approvals.qualifyGroup(buyerA,group.id,version);
 }
 pass('Two independently approved competing groups use owned supplier stock');
 await denied(()=>commitments.prepareMine(outsider,groupIds[0]),'GROUP_MEMBER_REQUIRED');
 await db.query('UPDATE supplier_listings SET buyer_min_qty=3 WHERE id=?',[fixtures.listing]);
 await denied(()=>commitments.prepareMine(buyerA,groupIds[0]),'GROUP_BUYER_MINIMUM_UNMET');
 await db.query('UPDATE supplier_listings SET buyer_min_qty=1 WHERE id=?',[fixtures.listing]);pass('All individual MOQs checked before any member can create a payable order');
 const failing=new ProcurementCollectiveCommitmentService(db,{enqueueEvent:async()=>{throw Error('outbox unavailable');}});
 await assert.rejects(()=>failing.prepareMine(buyerA,groupIds[0]),/outbox unavailable/);
 assert.equal((await db.query('SELECT COUNT(*) total FROM procurement_collective_commitments WHERE group_id=?',[groupIds[0]]))[0][0].total,0);pass('Unauthorized member rejected; notification failure rolls back all capacity');
 const race=await Promise.allSettled(groupIds.map(gid=>commitments.prepareMine(buyerA,gid)));
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(race.map(r=>r.status==='rejected'?{code:r.reason.code,message:r.reason.message}:r.status)));assert.ok(race.some(r=>r.status==='rejected'&&r.reason.code==='GROUP_STOCK_UNAVAILABLE'));
 const winner=groupIds[race.findIndex(r=>r.status==='fulfilled')],loser=groupIds.find(gid=>gid!==winner);
 const one=await commitments.prepareMine(buyerA,winner),two=await commitments.prepareMine(buyerB,winner);
 assert.equal((await commitments.prepareMine(buyerA,winner)).request_id,one.request_id);
 const quoteService=require('../src/services/procurementQuoteService');
 const [[derived]]=await db.query('SELECT id FROM procurement_quotes WHERE request_id=?',[one.request_id]);
 await denied(()=>quoteService.withdraw(supplier,derived.id,'gc-withdraw-'+tag),'COLLECTIVE_DERIVED_QUOTE_IMMUTABLE');
 const ownRequest=await requests.getMine(buyerA,one.request_id);
 await denied(()=>quoteService.submit(supplier,one.request_id,{valid_until:new Date(Date.now()+600000).toISOString(),delivery_lead_days:1,delivery_fee:'25',lines:[{request_item_id:ownRequest.items[0].id,supplier_listing_id:fixtures.listing,quantity:'2',unit_price:'101'}]},'gc-revise-'+tag),'COLLECTIVE_DERIVED_QUOTE_IMMUTABLE');pass('Supplier cannot withdraw or revise frozen per-buyer copies of the group bid');
 assert.equal((await db.query("SELECT SUM(allocated_qty) total FROM supplier_inventory_allocations WHERE supplier_listing_id=? AND status IN ('PENDING','COMMITTED')",[fixtures.listing]))[0][0].total,'5.0000');pass('Competing groups cannot oversubscribe; per-buyer preparation replays');
 const createAward=async(buyer,prepared)=>{
  const request=await requests.getMine(buyer,prepared.request_id);
  const [[quote]]=await db.query('SELECT q.id,v.immutable_snapshot FROM procurement_quotes q JOIN procurement_quote_versions v ON v.quote_id=q.id AND v.version_number=q.current_version WHERE q.request_id=?',[request.id]);
  const snapshot=typeof quote.immutable_snapshot==='string'?JSON.parse(quote.immutable_snapshot):quote.immutable_snapshot;
  const selections=snapshot.lines.map(line=>({request_item_id:line.request_item_id,quote_id:quote.id,version_number:1,supplier_sku_id:line.snapshot.supplier_sku_id,product_spec_id:line.snapshot.product_spec_id,physical_specifications_accepted:true}));
  const preview=await awards.previewPayable(buyer,request.id,selections);
  const body={selections,buyer_total_confirmed:true,accepted_total_payable:preview.total_payable,delivery_address:'Owned buyer destination, Lahore'};
  return {body,run:()=>awards.accept(buyer,request.id,body,'gc-award-'+buyer+'-'+tag)};
 };
 const a=await createAward(buyerA,one),b=await createAward(buyerB,two);
 const flags={B6_FINANCIAL_GATE_ENABLED:process.env.B6_FINANCIAL_GATE_ENABLED,B6_B5_INVENTORY_RECONCILED:process.env.B6_B5_INVENTORY_RECONCILED,B6_TAX_POLICY_APPROVED:process.env.B6_TAX_POLICY_APPROVED};
 try{
  process.env.B6_FINANCIAL_GATE_ENABLED='false';await denied(a.run,'B6_FINANCIAL_GATE_BLOCKED');pass('Existing B6 checkout gate remains closed by default');
  Object.assign(process.env,{B6_FINANCIAL_GATE_ENABLED:'true',B6_B5_INVENTORY_RECONCILED:'true',B6_TAX_POLICY_APPROVED:'true'});
  await denied(()=>awards.accept(buyerA,two.request_id,b.body,'gc-foreign-'+tag),'REQUEST_NOT_FOUND');
  const [[originalVersion]]=await db.query('SELECT v.id,v.immutable_snapshot FROM procurement_quote_versions v JOIN procurement_quotes q ON q.id=v.quote_id WHERE q.request_id=?',[one.request_id]);
  const tampered=typeof originalVersion.immutable_snapshot==='string'?JSON.parse(originalVersion.immutable_snapshot):originalVersion.immutable_snapshot;
  const originalJson=JSON.stringify(tampered);tampered.lines[0].unit_price='101.00';
  await db.query('UPDATE procurement_quote_versions SET immutable_snapshot=? WHERE id=?',[JSON.stringify(tampered),originalVersion.id]);
  await denied(a.run,'GROUP_TERMS_CHANGED');await db.query('UPDATE procurement_quote_versions SET immutable_snapshot=? WHERE id=?',[originalJson,originalVersion.id]);pass('Foreign award and changed group quote cannot consume reserved peer capacity');
  const settled=await Promise.allSettled([a.run(),b.run()]);const failure=settled.find(r=>r.status==='rejected');if(failure)throw failure.reason;const results=settled.map(r=>r.value);
  assert.equal(results[0].award.buyer_id,buyerA);assert.equal(results[1].award.buyer_id,buyerB);assert.equal((await a.run()).is_replay,true);
  assert.equal((await awards.findMineByRequest(buyerA,one.request_id)).award_id,results[0].award.award_id);
  await denied(()=>awards.findMineByRequest(outsider,one.request_id),'AWARD_NOT_FOUND');pass('Lost-response recovery retrieves only the buyer-owned original award');
  assert.equal((await db.query("SELECT SUM(allocated_qty) total FROM supplier_inventory_allocations WHERE supplier_listing_id=? AND status IN ('PENDING','COMMITTED')",[fixtures.listing]))[0][0].total,'5.0000');pass('Canonical awards atomically convert only own holds, no double allocation');
  const orderIds=results.map(result=>result.award.orders[0].order_id);
  const conn=await db.getConnection();
  try{
   await conn.beginTransaction();await conn.query("UPDATE orders SET payment_status='PAID' WHERE id=?",[orderIds[0]]);
   await denied(()=>commitments.assertFunded(conn,orderIds[0]),'GROUP_FUNDING_INCOMPLETE');
   await conn.query("UPDATE orders SET payment_status='PAID' WHERE id=?",[orderIds[1]]);
   await commitments.assertFunded(conn,orderIds[0]);
   pass('Funding policy fixture: one paid member cannot release group; all paid permits policy (rolled back, not provider evidence)');
  }finally{await conn.rollback();conn.release();}
  assert.ok((await db.query('SELECT payment_status FROM orders WHERE id IN (?,?)',orderIds))[0].every(row=>row.payment_status==='AWAITING_PAYMENT'));
  await denied(()=>commitments.releaseMine(buyerA,winner),'GROUP_ORDER_REQUIRES_RESOLUTION');pass('Order-backed stock cannot be silently released; no payment was fabricated');
 }finally{for(const [name,value] of Object.entries(flags)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
 await db.query('UPDATE supplier_listings SET available_stock=10 WHERE id=?',[fixtures.listing]);
 await commitments.prepareMine(buyerA,loser);
 await db.query("UPDATE procurement_collective_commitments SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE group_id=?",[loser]);
 const scoped={getConnection:()=>db.getConnection(),query:(sql,args)=>db.query(sql.replace("WHERE status='HELD'","WHERE group_id="+Number(loser)+" AND status='HELD'"),args)};
 const expired=await new ProcurementCollectiveCommitmentService(scoped).releaseExpiredBatch();assert.equal(expired.released,2);
 assert.equal((await db.query("SELECT SUM(allocated_qty) total FROM supplier_inventory_allocations WHERE supplier_listing_id=? AND status IN ('PENDING','COMMITTED')",[fixtures.listing]))[0][0].total,'5.0000');pass('Expiry releases only unconverted own-group holds and preserves peer orders');
 console.log('COLLECTIVE_COMMITMENTS_MYSQL_PASS '+count+'/'+count+'; no provider calls, no persistent paid fixtures');
}
main().catch(error=>{console.error(error.code||'COLLECTIVE_GATE_FAILED',error.stack||error.message);process.exitCode=1;}).finally(async()=>{
 try{
  await require('./collective_commitment_fixture_cleanup')(db,users);
 }catch(error){console.error('OWNED_FIXTURE_CLEANUP_FAILED',error.code,error.message);process.exitCode=1;}
 await db.end();
});
