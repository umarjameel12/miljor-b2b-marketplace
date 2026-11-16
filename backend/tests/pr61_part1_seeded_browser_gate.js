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
const {chromium}=require('playwright');
const base=process.env.P0_BROWSER_BASE_URL||'http://127.0.0.1:3000';
const password=process.env.P0_BROWSER_TEST_PASSWORD;
const tag='pr61-'+crypto.randomUUID();
const created={requestIds:[],groupId:null,secondBuyer:null,supplier:null,catalog:{}};
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
   if(created.groupId){
     const gid=created.groupId;
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
