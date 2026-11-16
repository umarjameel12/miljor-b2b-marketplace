'use strict';
// PR61 real multi-role Chromium against disposable MySQL, real services and real HTTP.
// NO mocked invitations, no fake card data, no payment or production DB access.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const bcrypt=require('bcryptjs');
const db=require('../src/config/db');
const requests=require('../src/services/procurementRequestService');
const matching=require('../src/services/procurementMatchingService');
const collectives=require('../src/services/procurementCollectiveService');
const bids=require('../src/services/procurementCollectiveBidService');
const approvals=require('../src/services/procurementCollectiveApprovalService');
const groupOrders=require('../src/services/procurementCollectiveOrderService');
const groupDelivery=require('../src/services/procurementCollectiveDeliveryService');
const groupReceipt=require('../src/services/procurementCollectiveReceiptService');
const invoiceService=require('../src/services/invoiceService');
const {chromium}=require('playwright');
const base=process.env.P0_BROWSER_BASE_URL||'http://127.0.0.1:3000';
const password=process.env.P0_BROWSER_TEST_PASSWORD;
const tag='pr61-'+crypto.randomUUID();
const created={requestIds:[],groupId:null,secondBuyer:null,supplier:null,catalog:{},groupOrders:[],addresses:[],routeId:null};
function assertEnvironment(){
 for(const [k,v] of Object.entries({NODE_ENV:'test',DB_NAME:'miljor_test_db',MILJOR_TEST_ONLY_MIGRATIONS:'1'}))
  assert.equal(process.env[k],v,'PROTECTED_DB_ABORT '+k);
 assert.ok(password&&password.length>=16);
 assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):3000\/?$/.test(base));
}
async function seed(){
 const [[identity]]=await db.query('SELECT DATABASE() AS name');
 assert.equal(identity.name,'miljor_test_db');
 const [[firstBuyer]]=await db.query("SELECT id,email FROM users WHERE email='p0_buyer@miljor.test' AND role='BUYER' AND is_verified=1");
 assert.ok(firstBuyer,'Existing disposable browser buyer missing');
 const hash=await bcrypt.hash(password,10);
 const [createdBuyer]=await db.query(`INSERT INTO users
  (full_name,business_name,email,phone,password_hash,role,verification_status,is_verified,buyer_trust_status,city,area)
  VALUES (?,?,?,?,?,'BUYER','VERIFIED',1,'CONTACT_VERIFIED','Lahore','Johar Town')`,
  ['PR61 Buyer Two','PR61 Buyer Two Business',tag+'@miljor.test','+923190000019',hash]);
 created.secondBuyer={id:createdBuyer.insertId,email:tag+'@miljor.test'};
 // A browser-only test DB has no eligible published SKU by default.
 // Construct one fully relational canonical supplier-owned SKU exclusively in this
 // disposable MySQL instance; real matching SQL still validates every relationship.
 const [[supplierUser]]=await db.query(
   "SELECT id,email FROM users WHERE email='p0_supplier@miljor.test' AND role='SUPPLIER' AND is_verified=1 AND verification_status='VERIFIED'");
 assert.ok(supplierUser,'Canonical disposable supplier account not found');
 const productHash=crypto.createHash('sha256').update(tag+'-product').digest('hex');
 const skuHash=crypto.createHash('sha256').update(tag+'-sku').digest('hex');
 const specHash=crypto.createHash('sha256').update(tag+'-spec').digest('hex');
 const code=tag.replace(/[^a-zA-Z0-9]/g,'').slice(0,24);
 const [newProduct]=await db.query(`INSERT INTO supplier_products
   (product_code,supplier_id,category_id,family_id,title,brand,variety,quality_grade,product_identity_hash,status,published_at)
   VALUES (?,?,1,1,'PR61 Test Rice','PR61 Test','Basmati','Grade A',?,'PUBLISHED',UTC_TIMESTAMP())`,
   ['P1PROD'+code,supplierUser.id,productHash]);
 created.catalog.productId=newProduct.insertId;
 const [newSku]=await db.query(`INSERT INTO supplier_skus
   (sku_code,supplier_id,supplier_product_id,category_id,family_id,packaging_type,pack_size,pack_unit,
    purchasing_unit,sku_hash,status,published_at)
    VALUES (?,?,?,1,1,'PP Bag',25,'kg','bag',?,'PUBLISHED',UTC_TIMESTAMP())`,
   ['P1SKU'+code,supplierUser.id,newProduct.insertId,skuHash]);
 created.catalog.skuId=newSku.insertId;
 const [newSpec]=await db.query(`INSERT INTO product_specifications
   (product_id,spec_code,title,brand,variety,processing_method,quality_grade,packaging_type,
    pack_size,pack_unit,purchasing_unit,spec_hash,category_id,family_id,supplier_id,
    supplier_product_id,supplier_sku_id,is_active,approval_status,lifecycle_status)
    VALUES (1,?,'PR61 Verified Rice 25kg','PR61 Test','Basmati','Sella','Grade A',
      'PP Bag',25,'kg','bag',?,1,1,?,?,?,1,'APPROVED','PUBLISHED')`,
   ['P1SPEC'+code,specHash,supplierUser.id,newProduct.insertId,newSku.insertId]);
 created.catalog.specId=newSpec.insertId;
 const [newListing]=await db.query(`INSERT INTO supplier_listings
   (listing_code,supplier_id,product_spec_id,supplier_product_id,supplier_sku_id,
    available_stock,base_unit_price,currency,supplier_min_qty,buyer_min_qty,
    delivery_zones,delivery_fee_policy,fulfilment_lead_time_days,status)
    VALUES (?,?,?,?,?,50,2500,'PKR',1,1,JSON_ARRAY('All Lahore'),'INCLUDED_IN_PRICE',2,'ACTIVE')`,
   ['P1LIST'+code,supplierUser.id,newSpec.insertId,newProduct.insertId,newSku.insertId]);
 created.catalog.listingId=newListing.insertId;
 const supplier={supplier_id:supplierUser.id,email:supplierUser.email,
   listing_id:newListing.insertId,family_id:1,purchasing_unit:'bag',area:'Johar Town, Lahore'};
 created.supplier=supplier;
 const date=new Date(Date.now()+48*3600000).toISOString();
 const single=await requests.createDraft(firstBuyer.id,{
   delivery_area:supplier.area,quote_deadline:date,
   items:[{family_id:supplier.family_id,unit:'bag',quantity:'5',
     requirements:'PR61 real single buyer acceptance'}]
 },tag+'-single-draft');
 created.requestIds.push(single.request.id);
 await requests.publish(firstBuyer.id,single.request.id,single.request.version_number,tag+'-single-publish');
 const invite=await matching.invite(firstBuyer.id,single.request.id,supplier.supplier_id);
 assert.equal(invite.status,'INVITED');
 const grouped=await requests.createDraft(firstBuyer.id,{
   ownership:'COLLECTIVE',frequency:'ONE_TIME',delivery_area:supplier.area,
   join_deadline:new Date(Date.now()+3600000).toISOString(),
   quote_deadline:date,
   items:[{family_id:supplier.family_id,unit:'bag',quantity:'2',
     requirements:'PR61 private aggregated demand acceptance'}]
 },tag+'-group-draft');
 created.requestIds.push(grouped.request.id);
 const group=await collectives.createGroup(firstBuyer.id,grouped.request.id,{minimum_buyers:2});
 created.groupId=group.group.id;
 await collectives.invite(firstBuyer.id,group.group.id,created.secondBuyer.id);
 const itemId=grouped.request.items[0].id;
 await collectives.join(firstBuyer.id,group.group.id,[{request_item_id:itemId,quantity:'2'}],tag+'-join-first');
 await collectives.join(created.secondBuyer.id,group.group.id,[{request_item_id:itemId,quantity:'3'}],tag+'-join-second');
 await db.query('UPDATE procurement_collective_groups SET join_deadline=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?',[group.group.id]);
 await bids.openBidding(firstBuyer.id,group.group.id);
 await bids.inviteSupplier(firstBuyer.id,group.group.id,supplier.supplier_id);
 const [groupInvitations]=await db.query('SELECT id FROM procurement_collective_supplier_invitations WHERE group_id=? AND supplier_id=?',[group.group.id,supplier.supplier_id]);
 assert.equal(groupInvitations.length,1);
 return {firstBuyer,supplier,singleId:single.request.id,groupId:group.group.id};
}
async function signIn(browser,email,label){
 const context=await browser.newContext({baseURL:base});
 const page=await context.newPage();
 await page.goto(base+'/login',{waitUntil:'domcontentloaded'});
 await page.locator('input[type=email]').fill(email);
 await page.locator('input[type=password]').fill(password);
 const loginPending=page.waitForResponse(x=>x.url().includes('/api/v1/auth/login'),{timeout:20000});
 await page.getByRole('button',{name:/sign in/i}).click();
 const response=await loginPending;
 assert.equal(response.status(),200,label+' sign-in failed');
 const body=await response.json();
 assert.ok(body.data?.token,label+' missing access token');
 return {context,page,token:body.data.token};
}
async function verify(browser,fixture){
 const [supplier,buyer1,buyer2]=await Promise.all([
   signIn(browser,fixture.supplier.email,'invited supplier'),
   signIn(browser,fixture.firstBuyer.email,'organizer buyer'),
   signIn(browser,created.secondBuyer.email,'second buyer')
 ]);
 try{
   const headers={Authorization:'Bearer '+supplier.token};
   const response=await supplier.page.request.get(base+'/api/v1/procurement/supplier/opportunities?type=all',{headers});
   assert.equal(response.status(),200);
   const data=(await response.json()).data;
   assert.ok(data.items.some(x=>x.type==='single'&&Number(x.request_id)===Number(fixture.singleId)));
   const group=data.items.find(x=>x.type==='grouped'&&Number(x.group_id)===Number(fixture.groupId));
   assert.ok(group,'Real grouped invitation not visible');
   assert.equal(Number(group.participant_count),2);
   assert.equal(String(group.items[0].aggregate_quantity),'5.0000');
   assert.equal(JSON.stringify(data).includes(created.secondBuyer.email),false,'Buyer email leaked');
   assert.equal(JSON.stringify(data).includes('buyer_id'),false,'Buyer ID leaked');
   for(const buyer of [buyer1,buyer2]){
     const denied=await buyer.page.request.get(base+'/api/v1/procurement/supplier/opportunities?type=all',{
       headers:{Authorization:'Bearer '+buyer.token}});
     assert.equal(denied.status(),403,'Buyer cannot access supplier invitations');
   }
   console.log('PASS CHROMIUM: 3 live sessions, supplier-only invitations, real aggregate 2 buyers/5 bags, no buyer PII');
   await Promise.all([
     buyer1.page.goto(base+'/rfqs',{waitUntil:'domcontentloaded'}),
     buyer2.page.goto(base+'/rfqs',{waitUntil:'domcontentloaded'})
   ]);
   await buyer1.page.getByText('Smart Procurement Hub',{exact:true}).first().waitFor({timeout:18000});
   await buyer2.page.getByText('My Collective Invitations',{exact:true}).waitFor({timeout:18000});
   await buyer2.page.getByText('Group #'+fixture.groupId+' · JOINED',{exact:false}).waitFor({timeout:18000});
   const ownOnly=await buyer2.page.request.get(base+'/api/v1/procurement/requests/'+fixture.singleId,{
     headers:{Authorization:'Bearer '+buyer2.token}});
   assert.equal(ownOnly.status(),404,'Second buyer must not see organizer private one-time RFQ');
   console.log('PASS CHROMIUM: organizer Smart Procurement Hub, second buyer joined group UI, buyer-owned RFQ isolation');

   await supplier.page.goto(base+'/supplier/procurement',{waitUntil:'domcontentloaded'});
   await supplier.page.getByRole('heading',{name:'Procurement Opportunities'}).waitFor({timeout:20000});
   const singleLabel='Request '+fixture.singleId;
   const groupLabel='Group #'+fixture.groupId;
   const singleCard=supplier.page.locator('article').filter({hasText:'PR61'});
   await supplier.page.getByText(groupLabel,{exact:true}).waitFor({timeout:18000});
   assert.ok((await supplier.page.locator('article').count())>=2);
   await supplier.page.getByRole('tab',{name:/Single/}).click();
   await supplier.page.getByText(groupLabel,{exact:true}).waitFor({state:'detached',timeout:15000});
   assert.ok((await supplier.page.locator('article').count())>=1);
   await supplier.page.getByRole('tab',{name:/Grouped/}).click();
   await supplier.page.getByText(groupLabel,{exact:true}).waitFor({timeout:15000});
   await supplier.page.getByText('Participating buyers: 2',{exact:false}).waitFor({timeout:15000});
   await supplier.page.getByText('5.0000 bag',{exact:false}).waitFor({timeout:15000});
   await supplier.page.getByRole('link',{name:'Open group and bid'}).first().click();
   await supplier.page.waitForURL(/\/rfqs#supplier-collective/,{timeout:15000});
   console.log('PASS CHROMIUM: actual Single/Grouped cards, filters, quantity and canonical group-bidding navigation');
   // Actual qualified collective E2E: immutable bid, independent exact consents,
   // owner-scoped delivery address, per-buyer unpaid orders and real invoice lines.
   const quote=await bids.submitBid(fixture.supplier.supplier_id,fixture.groupId,{
     valid_until:new Date(Date.now()+24*3600000).toISOString(),
     delivery_fee_per_buyer:'125.00',
     lines:[{request_item_id:(await db.query('SELECT id FROM procurement_request_items WHERE request_id=?',[created.requestIds[1]]))[0][0].id,
       supplier_listing_id:fixture.supplier.listing_id,unit_price:'250.00',
       min_aggregate_quantity:'5'}]
   },tag+'-supplier-bid');
   for(const b of [fixture.firstBuyer,created.secondBuyer]){
     const preview=await approvals.preview(b.id,fixture.groupId,quote.bid.bid_id);
     const result=await approvals.consent(b.id,fixture.groupId,quote.bid.bid_id,{
       bid_version_id:preview.bid_version_id,total_preview:preview.total_preview,
       physical_specifications_accepted:true,buyer_total_confirmed:true
     },tag+'-approve-'+b.id);
     assert.equal(result.approval.status,'CONSENTED_NOT_PAYABLE');
   }
   const [[version]]=await db.query(`SELECT v.id FROM procurement_collective_bid_versions v
      JOIN procurement_collective_bids b ON b.id=v.bid_id
      WHERE b.group_id=? AND b.supplier_id=?`,[fixture.groupId,fixture.supplier.supplier_id]);
   const qualified=await approvals.qualifyGroup(fixture.firstBuyer.id,fixture.groupId,version.id);
   assert.equal(qualified.qualification.stock_reserved,false);
   const [clusters]=await db.query('SELECT id FROM geographic_clusters WHERE is_active=1 ORDER BY id LIMIT 1');
   assert.ok(clusters.length,'Active delivery cluster required');
   for(const b of [fixture.firstBuyer,created.secondBuyer]){
     const [added]=await db.query(`INSERT INTO buyer_delivery_addresses
       (user_id,city,cluster_id,society_area,full_address,
        geographic_match_status,user_confirmation_status,
        business_verification_status,manual_review_required,revision)
       VALUES (?,'Lahore',?,'Johar Town','PR61 Test Shop, Street 12, Johar Town Lahore',
         'VERIFIED','CONFIRMED','VERIFIED',0,1)`,[b.id,clusters[0].id]);
     created.addresses.push(added.insertId);
     const state=await groupOrders.getMine(b.id,fixture.groupId);
     assert.equal(state.payment_ready,true);
     const order=await groupOrders.prepare(b.id,fixture.groupId,{
       bid_version_id:state.approved_terms.bid_version_id,
       delivery_address_id:added.insertId,total_amount:state.approved_terms.total_amount,
       confirm_payment_terms:true,confirm_physical_specifications:true
     },tag+'-payable-'+b.id);
     assert.equal(order.order.payment_status,'AWAITING_PAYMENT');
     created.groupOrders.push(order.order.order_id);
     const replay=await groupOrders.prepare(b.id,fixture.groupId,{
       bid_version_id:state.approved_terms.bid_version_id,
       delivery_address_id:added.insertId,total_amount:state.approved_terms.total_amount,
       confirm_payment_terms:true,confirm_physical_specifications:true
     },tag+'-payable-'+b.id);
     assert.equal(replay.is_replay,true);
     const generated=await invoiceService.generateInvoiceForOrder(order.order.order_id,{id:b.id,role:'BUYER'});
     assert.ok(generated.invoice_snapshot_json,'Itemized group invoice required');
   }
   assert.equal(created.groupOrders.length,2);
   const [allocated]=await db.query(`SELECT SUM(allocated_qty) AS qty FROM supplier_inventory_allocations
     WHERE allocation_type='ORDER_DIRECT' AND reference_id IN (?,?) AND status='PENDING'`,
     created.groupOrders);
   assert.equal(String(allocated[0].qty),'5.0000');
   const detail=await groupOrders.supplierGroup(fixture.supplier.supplier_id,fixture.groupId);
   assert.equal(detail.all_paid,false);
   assert.equal(detail.unpaid_orders,2);
   await assert.rejects(async()=>{
      const connection=await db.getConnection();
      try{return await groupOrders.reconcilePaidOrder(connection,created.groupOrders[0]);}
      finally{connection.release();}
   },e=>e.code==='PROVIDER_PAYMENT_REQUIRED');
   const groupBuyerView=await buyer1.page.request.get(
     base+'/api/v1/procurement/collectives/'+fixture.groupId+'/order',
     {headers:{Authorization:'Bearer '+buyer1.token}});
   assert.equal(groupBuyerView.status(),200);
   const otherBuyerOrder=created.groupOrders[1];
   const forbidden=await buyer1.page.request.post(base+'/api/v1/orders/'+otherBuyerOrder+'/checkout',{
     headers:{Authorization:'Bearer '+buyer1.token,'X-Idempotency-Key':tag+'-other-checkout'},
     data:{}});
   assert.equal(forbidden.status(),403,'Other buyer cannot initiate Safepay checkout');
   await buyer2.page.reload({waitUntil:'domcontentloaded'});
   await buyer2.page.getByText('Your own group payment',{exact:true}).waitFor({timeout:18000});
   assert.equal(await buyer2.page.getByText('Order #'+created.groupOrders[1],{exact:false}).count(),1);
   console.log('PASS PR61 PART2: two independent approved buyer orders, exact stock and invoices; no payment spoofing or cross-buyer checkout');
   // Isolated-only fake-paid fixture: exercises group delivery controls, NOT
   // Safepay or live payment certification. No provider event is forged.
   await assert.rejects(()=>groupDelivery.propose(fixture.supplier.supplier_id,fixture.groupId,{
      delivery_day:new Date(Date.now()+3*86400000).toISOString().slice(0,10),
      delivery_window:'09:00-12:00'
   },tag+'-route'),e=>e.code==='GROUP_PAYMENTS_INCOMPLETE');
   await db.query(`UPDATE orders SET payment_status='PAID',order_status='PAID',
      fulfillment_status='AWAITING_SUPPLIER_ACKNOWLEDGEMENT' WHERE id=?`,[created.groupOrders[0]]);
   await assert.rejects(()=>groupDelivery.propose(fixture.supplier.supplier_id,fixture.groupId,{
      delivery_day:new Date(Date.now()+3*86400000).toISOString().slice(0,10),
      delivery_window:'09:00-12:00'
   },tag+'-route'),e=>e.code==='GROUP_PAYMENTS_INCOMPLETE');
   await db.query(`UPDATE orders SET payment_status='PAID',order_status='PAID',
      fulfillment_status='AWAITING_SUPPLIER_ACKNOWLEDGEMENT' WHERE id=?`,[created.groupOrders[1]]);
   const route=await groupDelivery.propose(fixture.supplier.supplier_id,fixture.groupId,{
      delivery_day:new Date(Date.now()+3*86400000).toISOString().slice(0,10),
      delivery_window:'09:00-12:00'
   },tag+'-route');
   created.routeId=route.run_id;
   assert.equal(route.status,'PROPOSED');
   await assert.rejects(()=>groupDelivery.assertDispatchReady(db,created.groupOrders[0]),
     e=>e.code==='COLLECTIVE_ROUTE_CONSENT_REQUIRED');
   const firstConsent=await groupDelivery.decide(fixture.firstBuyer.id,fixture.groupId,{
     run_id:route.run_id,decision:'ACCEPT'});
   assert.equal(firstConsent.decision,'ACCEPTED');
   await assert.rejects(()=>groupDelivery.assertDispatchReady(db,created.groupOrders[0]),
     e=>e.code==='COLLECTIVE_ROUTE_CONSENT_REQUIRED');
   await assert.rejects(()=>groupDelivery.decide(fixture.supplier.supplier_id,fixture.groupId,{
     run_id:route.run_id,decision:'ACCEPT'}),e=>e.code==='ROUTE_NOT_OWNED');
   const secondConsent=await groupDelivery.decide(created.secondBuyer.id,fixture.groupId,{
     run_id:route.run_id,decision:'ACCEPT'});
   assert.equal(secondConsent.decision,'ACCEPTED');
   assert.equal((await groupDelivery.assertDispatchReady(db,created.groupOrders[0])).is_collective,true);
   const [confirmed]=await db.query('SELECT status FROM procurement_delivery_runs WHERE id=?',[route.run_id]);
   assert.equal(confirmed[0].status,'CONFIRMED');
   const buyerRoute=await buyer2.page.request.get(
     base+'/api/v1/procurement/collectives/'+fixture.groupId+'/delivery-route',
     {headers:{Authorization:'Bearer '+buyer2.token}});
   assert.equal(buyerRoute.status(),200);
   assert.equal((await buyerRoute.json()).data.approval_status,'ACCEPTED');
   console.log('PASS ISOLATED SYNTHETIC-PAID ROUTE LOGIC: partial-payment gate, 2 buyer consents, protected schedule and dispatch; NOT genuine Safepay');
   // Test-only delivery stage setup; this section never asserts a real provider capture.
   await db.query("UPDATE orders SET fulfillment_status='SUPPLIER_DELIVERED' WHERE id IN (?,?)",created.groupOrders);
   for(const [index,oid] of created.groupOrders.entries()){
     const buyerId=index===0?fixture.firstBuyer.id:created.secondBuyer.id;
     const contract=await groupReceipt.getContract(buyerId,oid);
     assert.equal(contract.lines.length,1);
     const ordered=Number(contract.lines[0].ordered_quantity);
     const received=index===0?String(ordered-1):String(ordered);
     const response=await groupReceipt.submit(buyerId,oid,{
       lines:[{line_id:contract.lines[0].line_id,received_quantity:received}]
     },tag+'-receipt-'+buyerId);
     assert.equal(response.status,index===0?'EXCEPTION':'BUYER_CONFIRMED');
     assert.equal(response.lines[0].shortage,index===0?'1.0000':'0.0000');
     assert.equal(response.refund_executed,false);
     assert.equal(response.supplier_settlement_authorized,false);
   }
   const [finalStops]=await db.query('SELECT status FROM procurement_delivery_stops WHERE run_id=? ORDER BY order_id',[route.run_id]);
   assert.equal(finalStops.length,2);
   const [shortageDisputes]=await db.query(`SELECT id,claimed_amount,disputed_quantity
     FROM order_disputes WHERE order_id=? AND dispute_category='SHORT_QUANTITY'`,[created.groupOrders[0]]);
   assert.equal(shortageDisputes.length,1);
   assert.equal(Number(shortageDisputes[0].disputed_quantity),1);
   assert.equal(String(shortageDisputes[0].claimed_amount),'250.00');
   assert.equal(finalStops.filter(x=>x.status==='EXCEPTION').length,1);
   assert.equal(finalStops.filter(x=>x.status==='BUYER_CONFIRMED').length,1);
   const [refunds]=await db.query('SELECT COUNT(*) AS count FROM refund_obligations WHERE order_id IN (?,?)',created.groupOrders);
   assert.equal(Number(refunds[0].count),0,'Receipt shortage must not create automatic refund');
   console.log('PASS ISOLATED RECEIPT: per-item shortage 1 bag, other buyer separately confirmed, route exception and zero invented refund');



   // Buyer sessions cannot act on supplier RFQ routes, and invite is always owned.
   const buyerForbidden=await buyer2.page.request.get(base+'/api/v1/procurement/supplier/collectives/invitations',{
     headers:{Authorization:'Bearer '+buyer2.token}});
   assert.equal(buyerForbidden.status(),403);
   const [orders]=await db.query('SELECT COUNT(*) AS n FROM orders WHERE order_code LIKE ?', ['PR61-ACCEPTANCE-%']);
   assert.equal(Number(orders[0].n),0);
   console.log('PASS CHROMIUM: cross-role RBAC and no fabricated purchase/payment');
 }finally{await Promise.all([supplier.context.close(),buyer1.context.close(),buyer2.context.close()]);}
}
async function cleanup(){
 try{
   const [[identity]]=await db.query('SELECT DATABASE() AS name');
   assert.equal(identity.name,'miljor_test_db','Unsafe cleanup target');
   if(created.routeId){
     await db.query('DELETE FROM procurement_notifications WHERE event_key LIKE ?',['collective:'+created.groupId+':%']);
     await db.query('DELETE FROM procurement_collective_route_acceptances WHERE route_id IN (SELECT id FROM procurement_collective_delivery_routes WHERE run_id=?)',[created.routeId]);
     await db.query('DELETE FROM procurement_collective_delivery_routes WHERE run_id=?',[created.routeId]);
     await db.query('DELETE FROM procurement_delivery_stops WHERE run_id=?',[created.routeId]);
     await db.query('DELETE FROM procurement_delivery_runs WHERE id=?',[created.routeId]);
   }
   if(created.groupOrders.length){
     for(const oid of created.groupOrders){
       await db.query(`DELETE FROM procurement_notifications WHERE event_key LIKE ?`,
         ['collective:receipt:%']);
       await db.query(`DELETE FROM procurement_collective_receipt_lines WHERE receipt_id IN
         (SELECT id FROM procurement_collective_receipt_submissions WHERE order_id=?)`,[oid]);
       await db.query('DELETE FROM order_disputes WHERE order_id=? AND dispute_code LIKE ?',
         [oid,'DSP-P1-'+oid+'-%']);
       await db.query('DELETE FROM procurement_collective_receipt_submissions WHERE order_id=?',[oid]);
       await db.query('DELETE FROM invoices WHERE order_id=?',[oid]);
       await db.query('DELETE FROM procurement_notifications WHERE recipient_id IN (SELECT buyer_id FROM orders WHERE id=?) AND event_key LIKE ?',[oid,'collective:%']);
       await db.query('DELETE FROM supplier_inventory_allocations WHERE allocation_type=? AND reference_id=?',['ORDER_DIRECT',oid]);
       await db.query('DELETE FROM procurement_collective_order_lines WHERE collective_order_id IN (SELECT id FROM procurement_collective_buyer_orders WHERE order_id=?)',[oid]);
       await db.query('DELETE FROM procurement_collective_buyer_orders WHERE order_id=?',[oid]);
       await db.query('DELETE FROM orders WHERE id=?',[oid]);
     }
   }
   for(const aid of created.addresses)await db.query('DELETE FROM buyer_delivery_addresses WHERE id=?',[aid]);
   if(created.groupId){
     const gid=created.groupId;
     await db.query('DELETE FROM procurement_collective_buyer_approvals WHERE group_id=?',[gid]);
     await db.query(`DELETE FROM procurement_collective_bid_lines WHERE bid_version_id IN
       (SELECT v.id FROM procurement_collective_bid_versions v
        JOIN procurement_collective_bids b ON b.id=v.bid_id WHERE b.group_id=?)`,[gid]);
     await db.query(`DELETE FROM procurement_collective_bid_versions WHERE bid_id IN
       (SELECT id FROM procurement_collective_bids WHERE group_id=?)`,[gid]);
     await db.query('DELETE FROM procurement_collective_bids WHERE group_id=?',[gid]);
     await db.query('DELETE FROM procurement_collective_supplier_invitations WHERE group_id=?',[gid]);
     await db.query('DELETE FROM procurement_collective_participant_lines WHERE participant_id IN (SELECT id FROM procurement_collective_participants WHERE group_id=?)',[gid]);
     await db.query('DELETE FROM procurement_collective_participants WHERE group_id=?',[gid]);
     await db.query('DELETE FROM procurement_collective_groups WHERE id=?',[gid]);
   }
   for(const rid of created.requestIds){
     await db.query('DELETE FROM procurement_supplier_invitations WHERE request_id=?',[rid]);
     await db.query('DELETE FROM procurement_request_mutations WHERE request_id=?',[rid]);
     await db.query('DELETE FROM procurement_request_items WHERE request_id=?',[rid]);
     await db.query('DELETE FROM procurement_requests WHERE id=?',[rid]);
   }
   if(created.catalog.listingId)
     await db.query('DELETE FROM supplier_listings WHERE id=?',[created.catalog.listingId]);
   if(created.catalog.specId)
     await db.query('DELETE FROM product_specifications WHERE id=?',[created.catalog.specId]);
   if(created.catalog.skuId)
     await db.query('DELETE FROM supplier_skus WHERE id=?',[created.catalog.skuId]);
   if(created.catalog.productId)
     await db.query('DELETE FROM supplier_products WHERE id=?',[created.catalog.productId]);
   if(created.secondBuyer)await db.query('DELETE FROM users WHERE id=?',[created.secondBuyer.id]);
 }finally{await db.end();}
}
async function main(){
 assertEnvironment();let browser;
 try{
   const fixture=await seed();
   browser=await chromium.launch({headless:true,args:['--no-sandbox']});
   await verify(browser,fixture);
   console.log('PR61 SEEDED MULTI-ROLE REAL CHROMIUM PASS');
 }finally{if(browser)await browser.close();await cleanup();}
}
main().catch(e=>{console.error('PR61 SEEDED CHROMIUM FAIL',e.stack||e);process.exitCode=1;});
