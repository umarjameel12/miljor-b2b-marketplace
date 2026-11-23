'use strict';
// Imported only by the isolated Chromium runner. No migrations, cleanup deletes,
// protected DB access, direct PAID writes, forged JWTs or runtime monkeypatches.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const tag=crypto.randomBytes(6).toString('hex');
const key=label=>'smart-paid-'+tag+'-'+label;
function assertIsolated(){
  for(const [name,value] of Object.entries({NODE_ENV:'test',DB_NAME:'miljor_test_db',TEST_DB_NAME:'miljor_test_db',MILJOR_TEST_ONLY_MIGRATIONS:'1',SAFEPAY_ENV:'sandbox',ALLOW_EXTERNAL_MONEY_MOVEMENT:'false'}))assert.equal(process.env[name],value,'Unsafe environment: '+name);
  assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.DB_HOST),'Local disposable MySQL only');
  assert.ok(process.env.JWT_SECRET?.length>=32,'Explicit disposable JWT secret required');
}
async function identity(db){assertIsolated();assert.equal((await db.query('SELECT DATABASE() db'))[0][0].db,'miljor_test_db');}
async function seed(db,{quantities=['1','2'],stock=10}={}){
  await identity(db);
  const tag=crypto.randomBytes(6).toString('hex');
  const bcrypt=require('bcryptjs');
  const password=crypto.randomBytes(24).toString('base64url'),hash=await bcrypt.hash(password,10),users=[];
  for(const [index,role] of ['BUYER','SUPPLIER','BUYER','SUPPLIER','FINANCE_ADMIN','OPERATIONS_ADMIN'].entries()){
    const email='smart-paid-'+tag+'-'+index+'@miljor.test';
    const [created]=await db.query("INSERT INTO users(full_name,email,password_hash,role,is_verified,verification_status,buyer_trust_status,city,area,address) VALUES (?,?,?,?,1,'VERIFIED','CONTACT_VERIFIED','Lahore','Gulberg','Synthetic paid-browser Lahore address')",['Synthetic browser '+role,email,hash,role]);
    users.push({id:created.insertId,email,role});
    if(role==='SUPPLIER')await db.query("INSERT INTO supplier_profiles(supplier_id,business_type,verification_status,subscription_plan,subscription_status,max_active_listings,transaction_fee_percent) VALUES (?,'WHOLESALER','VERIFIED','STARTER','STARTER_ACTIVE',10,2.50)",[created.insertId]);
  }
  const [buyer,supplier,foreignBuyer,foreignSupplier,admin,opsAdmin]=users;
  const [[family]]=await db.query("SELECT id FROM catalog_product_families WHERE is_active=1 AND approval_status='APPROVED' AND JSON_CONTAINS(allowed_purchasing_units,JSON_QUOTE('bag')) ORDER BY id LIMIT 1");
  assert.ok(family,'Approved bag family required');
  const [[cluster]]=await db.query('SELECT id FROM geographic_clusters WHERE is_active=1 ORDER BY id LIMIT 1');assert.ok(cluster,'Active Lahore cluster required');
  const address='Synthetic paid-browser '+tag+', Lahore';
  const [saved]=await db.query("INSERT INTO buyer_delivery_addresses(user_id,cluster_id,society_area,full_address,geographic_match_status) VALUES (?,?,?,?,'VERIFIED')",[buyer.id,cluster.id,'Synthetic Gulberg',address]);
  const catalog=require('../src/services/catalogService'),lines=[];
  for(let i=0;i<2;i++){
    const product=await catalog.createSupplierProduct(supplier.id,{family_id:family.id,is_unbranded:false,brand:'SMART PAID '+tag+' '+i,variety:'Browser test '+i});
    const sku=await catalog.createSupplierSku(supplier.id,{supplier_product_id:product.id,packaging_type:'PP Woven Bag',pack_size:25,pack_unit:'kg',purchasing_unit:'bag'});
    await catalog.publishSupplierSku(supplier.id,sku.id);
    let status,result;
    await require('../src/controllers/supplierListingController').createListing({user:supplier,body:{supplier_sku_id:sku.id,available_stock:stock,base_unit_price:100,supplier_min_qty:1,buyer_min_qty:1,delivery_zones:['all lahore']}},{status(code){status=code;return this;},json(body){result=body;return this;}});
    assert.equal(status,201,JSON.stringify(result));
    const listing=result.data.listing;
    const [[physical]]=await db.query('SELECT product_spec_id FROM supplier_listings WHERE id=?',[listing.id]);
    lines.push({listing:listing.id,sku:sku.id,spec:physical.product_spec_id,family:family.id});
  }
  return {tag,password,buyer,supplier,foreignBuyer,foreignSupplier,admin,opsAdmin,quantities,stock,lines,address,addressId:saved.insertId};
}
async function award(api,db,fixture){
  const {buyer,supplier,lines,address,quantities}=fixture;
  const created=await api(buyer,'POST','/procurement/requests',{delivery_area:'Lahore',quote_deadline:new Date(Date.now()+86400000).toISOString(),items:lines.map((line,i)=>({family_id:line.family,quantity:quantities[i],unit:'bag',requirements:'Synthetic grade '+i}))},201);
  const rid=created.request.id;
  lines.forEach((line,i)=>line.item=created.request.items[i].id);
  await api(buyer,'POST',`/procurement/requests/${rid}/publish`,{version_number:1});
  const invited=await api(buyer,'POST',`/procurement/requests/${rid}/invitations`,{supplier_id:supplier.id},201);
  await api(supplier,'POST',`/procurement/supplier/invitations/${invited.invitation.id}/respond`,{decision:'INTERESTED'});
  const quoted=await api(supplier,'POST',`/procurement/supplier/requests/${rid}/quotes`,{delivery_fee:'25.00',delivery_lead_days:1,valid_until:new Date(Date.now()+3600000).toISOString(),lines:lines.map((line,i)=>({request_item_id:line.item,supplier_listing_id:line.listing,quantity:quantities[i],unit_price:'100.00'}))},201);
  const quote=quoted.quote.id||quoted.quote.quote_id;
  const selections=lines.map(line=>({request_item_id:line.item,quote_id:quote,version_number:1,supplier_sku_id:line.sku,product_spec_id:line.spec,physical_specifications_accepted:true}));
  const preview=(await api(buyer,'POST',`/procurement/requests/${rid}/checkout-preview`,{selections})).preview;
  // Execute current exact fee + zero-tax contract, never pretend production tax approval.
  assert.equal(preview.tax_calculated,false);
  const exact=require('../src/services/exactDecimal');
  const subtotal=exact.exactDecimalSum(quantities.map(qty=>exact.exactMultiplyRound(qty,'100.00',2)),2);
  assert.equal(exact.toCanonical(preview.item_subtotal,2),subtotal);
  assert.equal(preview.total_payable,exact.exactDecimalSum([subtotal,'25.00',preview.buyer_platform_fee_total],2));
  const input={selections,buyer_total_confirmed:true,accepted_total_payable:preview.total_payable,delivery_address:address};
  // Prove default B6 gate is enforced over real HTTP, then enable fixture-only flags.
  await api(buyer,'POST',`/procurement/requests/${rid}/award`,input,503,'B6_FINANCIAL_GATE_BLOCKED');
  await identity(db);
  const [stock]=await db.query("SELECT l.id,l.available_stock,COALESCE(SUM(CASE WHEN a.status IN ('PENDING','COMMITTED') THEN a.allocated_qty ELSE 0 END),0) allocated FROM supplier_listings l LEFT JOIN supplier_inventory_allocations a ON a.supplier_listing_id=l.id WHERE l.id IN (?,?) GROUP BY l.id,l.available_stock",lines.map(line=>line.listing));
  assert.equal(stock.length,2);assert.ok(stock.every(row=>Number(row.available_stock)===fixture.stock&&Number(row.allocated)===0));
  process.env.B6_FINANCIAL_GATE_ENABLED='true';process.env.B6_B5_INVENTORY_RECONCILED='true';process.env.B6_TAX_POLICY_APPROVED='true';
  let accepted;
  try{accepted=(await api(buyer,'POST',`/procurement/requests/${rid}/award`,input,201)).award;}
  finally{for(const name of ['B6_FINANCIAL_GATE_ENABLED','B6_B5_INVENTORY_RECONCILED','B6_TAX_POLICY_APPROVED'])process.env[name]='false';}
  assert.equal(accepted.orders.length,1);
  const oid=Number(accepted.orders[0].order_id);
  const [[order]]=await db.query('SELECT * FROM orders WHERE id=?',[oid]);assert.equal(order.payment_status,'AWAITING_PAYMENT');
  const [allocated]=await db.query("SELECT allocated_qty,status FROM supplier_inventory_allocations WHERE allocation_type='ORDER_DIRECT' AND reference_id=? ORDER BY supplier_listing_id",[oid]);
  assert.deepEqual(allocated.map(row=>[String(row.allocated_qty),row.status]),quantities.map(qty=>[exact.toCanonical(qty,4),'PENDING']));
  fixture.order=order;fixture.award=accepted;
  return fixture;
}
async function pay(api,db,fixture){
  // Existing injected test client creates a real durable attempt, without network.
  const tag=fixture.tag,tracker='smart_synthetic_'+tag;
  await require('../src/services/safepayCheckoutService').initiateCheckout({orderId:fixture.order.id,actor:fixture.buyer,idempotencyKey:key('checkout-'+fixture.order.id),mockClient:{async init(){return {trackerToken:tracker,rawResponse:{synthetic:true}};},async createPassportToken(){return 'synthetic-passport-'+tag;}}});
  // Use the canonical completed callback; the receipt evidence join now accepts
  // all seven verified success names. Never repair or synthesize stored events.
  const payload={token:'evt_smart_'+tag,type:'payment.completed',data:{tracker:{token:tracker,amount:Number(fixture.order.total_amount),currency:'PKR'}}};
  const raw=JSON.stringify(payload);
  const headers={'X-SFPY-SIGNATURE':crypto.createHmac('sha512',process.env.SAFEPAY_WEBHOOK_SECRET).update(raw).digest('hex'),'X-SFPY-EVENT-ID':payload.token,'X-SFPY-EVENT-TYPE':payload.type,'X-SFPY-TIMESTAMP':new Date().toISOString()};
  await api(null,'POST','/webhooks/safepay',payload,401,null,{...headers,'X-SFPY-SIGNATURE':'invalid'});
  const paid=await api(null,'POST','/webhooks/safepay',payload,200,null,headers);assert.equal(paid.payment_status,'PAID');
  const replay=await Promise.all([api(null,'POST','/webhooks/safepay',payload,200,null,headers),api(null,'POST','/webhooks/safepay',payload,200,null,headers)]);
  assert.ok(replay.every(result=>result.is_duplicate===true));
  const [allocations]=await db.query("SELECT allocated_qty,status FROM supplier_inventory_allocations WHERE allocation_type='ORDER_DIRECT' AND reference_id=? ORDER BY supplier_listing_id",[fixture.order.id]);
  assert.deepEqual(allocations.map(row=>[String(row.allocated_qty),row.status]),fixture.quantities.map(qty=>[require('../src/services/exactDecimal').toCanonical(qty,4),'COMMITTED']));
  const [[count]]=await db.query('SELECT COUNT(*) n FROM payments WHERE order_id=?',[fixture.order.id]);assert.equal(Number(count.n),1);
}
module.exports={assertIsolated,identity,seed,award,pay,key};
