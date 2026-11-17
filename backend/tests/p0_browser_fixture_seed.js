'use strict';
// Disposable browser integration fixture. NO remote or shared databases.
const assert=require('node:assert/strict');
const path=require('node:path');
require('dotenv').config({path:path.resolve(__dirname,'../.env')});
assert.equal(process.env.NODE_ENV,'test','NODE_ENV must be test');
assert.equal(process.env.DB_NAME,'miljor_test_db','Must use disposable MySQL database');
assert.equal(process.env.MILJOR_TEST_ONLY_MIGRATIONS,'1');
const bcrypt=require('bcryptjs');
const db=require('../src/config/db');
async function run(){
  const [[identity]]=await db.query('SELECT DATABASE() db');
  assert.equal(identity.db,'miljor_test_db');
  const password=process.env.P0_BROWSER_TEST_PASSWORD;
  assert.ok(password&&password.length>=16,'Disposable browser password is required');
  const hash=await bcrypt.hash(password,10);
  for(const [role,email,phone] of [
    ['BUYER','p0_buyer@miljor.test','+923190000001'],
    ['SUPPLIER','p0_supplier@miljor.test','+923190000002']
  ]){
    const [existing]=await db.query('SELECT id FROM users WHERE email=?',[email]);
    if(existing.length)throw Error('Fixture already exists; do not reuse unknown sessions');
    const [created]=await db.query(
      `INSERT INTO users(full_name,email,phone,password_hash,role,
       verification_status,is_verified,buyer_trust_status,city,area,address)
       VALUES (?,?,?,?,?,'VERIFIED',1,'CONTACT_VERIFIED','Lahore','Gulberg',
       'Gulberg, Lahore, Punjab, Pakistan')`,
      ['MilJor P0 '+role,email,phone,hash,role]);
    if(role==='SUPPLIER'){
      await db.query(`INSERT INTO supplier_profiles
        (supplier_id,business_type,verification_status,subscription_plan,
         subscription_status,max_active_listings,transaction_fee_percent)
         VALUES (?,'WHOLESALER','VERIFIED','STARTER','STARTER_ACTIVE',10,2.50)`,
        [created.insertId]);
    }
  }
  // One real DB-backed poolless B6-style procurement order for Chromium rendering.
  // Keep it UNPAID; this fixture must never impersonate provider-origin payment.
  const [buyerRows]=await db.query('SELECT id FROM users WHERE email=?',['p0_buyer@miljor.test']);
  const [supplierRows]=await db.query('SELECT id FROM users WHERE email=?',['p0_supplier@miljor.test']);
  assert.equal(buyerRows.length,1);
  assert.equal(supplierRows.length,1);
  const orderCode='P0-BROWSER-B6-ORDER';
  await db.query(`INSERT INTO orders
    (order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,
     delivery_fee,buyer_platform_fee,total_amount,supplier_commission_percent,
     currency,delivery_type,delivery_address,payment_status,order_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,'PKR','DOORSTEP',?,'AWAITING_PAYMENT','AWAITING_PAYMENT')`,
    [orderCode,buyerRows[0].id,supplierRows[0].id,10,100,1000,120,25,1145,2.50,
     'Disposable Gulberg Lahore buyer address']);
  console.log('PASS P0 browser poolless order seeded UNPAID with exact PKR 1145.00');
  const [families]=await db.query("SELECT f.id FROM catalog_product_families f JOIN catalog_categories c ON c.id=f.category_id AND c.is_active=1 AND c.approval_status='APPROVED' WHERE f.is_active=1 AND f.approval_status='APPROVED' AND JSON_CONTAINS(f.allowed_purchasing_units,JSON_QUOTE('bag')) ORDER BY f.id LIMIT 1");
  assert.ok(families.length,'Recurring browser fixture requires approved bag family');
  const template=await require('../src/services/procurementRequestService').createDraft(buyerRows[0].id,{frequency:'BIWEEKLY',delivery_area:'Lahore',items:[{family_id:families[0].id,quantity:'2',unit:'bag'}]},'browser-recurring-template-20261116');
  const tomorrow=new Date(Date.now()+86400000);
  const recurring=require('../src/services/procurementRecurringService');
  const contract=await recurring.createDraft(buyerRows[0].id,template.request.id,{cadence:'BIWEEKLY',weekday_number:tomorrow.getUTCDay(),local_run_time:'23:59',starts_on:tomorrow.toISOString().slice(0,10)},'browser-recurring-contract-20261116');
  await recurring.changeStatus(buyerRows[0].id,contract.contract.id,'ACTIVATE',1,true);
  await recurring.scheduleUpcomingForBuyer(buyerRows[0].id,contract.contract.id,{limit:2});
  console.log('PASS P0 recurring browser cycles seeded without orders or payments');
  const supplier=supplierRows[0].id,buyer=buyerRows[0].id,catalog=require('../src/services/catalogService');
  const product=await catalog.createSupplierProduct(supplier,{family_id:1,is_unbranded:false,brand:'P0 GROUP',variety:'Browser collective'});
  const sku=await catalog.createSupplierSku(supplier,{supplier_product_id:product.id,packaging_type:'PP Woven Bag',pack_size:25,pack_unit:'kg',purchasing_unit:'bag'});
  await catalog.publishSupplierSku(supplier,sku.id);
  let listingResponse,listingStatus;
  await require('../src/controllers/supplierListingController').createListing({user:{id:supplier,role:'SUPPLIER'},body:{supplier_sku_id:sku.id,available_stock:5,base_unit_price:100,supplier_min_qty:1,buyer_min_qty:1,delivery_zones:['all lahore']}},{status(code){listingStatus=code;return this;},json(body){listingResponse=body;return this;}});
  assert.equal(listingStatus,201,JSON.stringify(listingResponse));const listing=listingResponse.data.listing;
  const [peer]=await db.query("INSERT INTO users(full_name,email,password_hash,role,is_verified,verification_status,buyer_trust_status) VALUES ('P0 group peer','p0_group_peer@miljor.test',?,'BUYER',1,'VERIFIED','CONTACT_VERIFIED')",[hash]);
  const requestService=require('../src/services/procurementRequestService'),collectives=require('../src/services/procurementCollectiveService'),bids=require('../src/services/procurementCollectiveBidService'),approvals=require('../src/services/procurementCollectiveApprovalService');
  const groupDraft=await requestService.createDraft(buyer,{ownership:'COLLECTIVE',delivery_area:'Lahore',join_deadline:new Date(Date.now()+3600000).toISOString(),quote_deadline:new Date(Date.now()+86400000).toISOString(),items:[{family_id:1,unit:'bag',quantity:'2'}]},'browser-group-template-20261116');
  const group=(await collectives.createGroup(buyer,groupDraft.request.id,{minimum_buyers:2})).group;
  await collectives.invite(buyer,group.id,peer.insertId);
  for(const [member,quantity] of [[buyer,'2'],[peer.insertId,'3']])await collectives.join(member,group.id,[{request_item_id:groupDraft.request.items[0].id,quantity}],'browser-group-join-'+member);
  await db.query('UPDATE procurement_collective_groups SET join_deadline=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?',[group.id]);
  await bids.openBidding(buyer,group.id);await bids.inviteSupplier(buyer,group.id,supplier);
  const bid=(await bids.submitBid(supplier,group.id,{valid_until:new Date(Date.now()+3600000).toISOString(),delivery_fee_per_buyer:'25',lines:[{request_item_id:groupDraft.request.items[0].id,supplier_listing_id:listing.id,unit_price:'100',min_aggregate_quantity:'5'}]},'browser-group-bid-20261116')).bid;
  let bidVersion;
  for(const member of [buyer,peer.insertId]){const preview=await approvals.preview(member,group.id,bid.bid_id);bidVersion=preview.bid_version_id;await approvals.consent(member,group.id,bid.bid_id,{bid_version_id:bidVersion,total_preview:preview.total_preview,physical_specifications_accepted:true,buyer_total_confirmed:true},'browser-group-consent-'+member);}
  await approvals.qualifyGroup(buyer,group.id,bidVersion);
  console.log('PASS P0 qualified collective browser fixture; no orders or payments created');
  console.log('PASS P0 browser fixtures seeded in disposable database; secrets not printed');
}
run().then(()=>process.exit(0)).catch(e=>{console.error('FAIL P0 browser fixture',e.message);process.exit(1)});
