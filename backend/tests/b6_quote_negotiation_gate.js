'use strict';
// B6-F acceptance gate: run ONLY after reviewed migrations 037–040
// are applied to backed-up miljor_test_db. All created rows are test-owned.
process.env.NODE_ENV='test';
process.env.TEST_DB_NAME='miljor_test_db';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const db=require('../src/config/db');
const requests=require('../src/services/procurementRequestService');
const matching=require('../src/services/procurementMatchingService');
const quotes=require('../src/services/procurementQuoteService');
const negotiations=require('../src/services/procurementNegotiationService');
const comparison=require('../src/services/procurementQuoteComparisonService');
const created=[];
let count=0;
const check=(name,value)=>{assert.ok(value,name);console.log('PASS '+(++count)+': '+name);};
const rejects=async(fn,code)=>assert.rejects(fn,error=>error.code===code,`Expected ${code}`);

async function main(){
  const [[identity]]=await db.query('SELECT DATABASE() AS name');
  assert.equal(identity.name,'miljor_test_db','FAIL CLOSED: protected DB');
  check('Test DB identity',true);
  for(const table of ['procurement_requests','procurement_request_items',
    'procurement_supplier_invitations','procurement_quotes',
    'procurement_quote_versions','procurement_quote_lines','procurement_quote_negotiations']){
    const [found]=await db.query(
      'SELECT ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
    assert.equal(found.length,1,`Migration missing: ${table}`);
    assert.equal(found[0].ENGINE,'InnoDB');
  }
  check('All required B6 tables transactional',true);
  const [buyers]=await db.query(
    "SELECT id FROM users WHERE role='BUYER' AND is_verified=1 AND verification_status='VERIFIED' LIMIT 1"
  );
  if(!buyers.length)throw Error('BLOCKED: verified buyer fixture missing');
  const [listings]=await db.query(
    `SELECT sl.id AS listing_id,sl.supplier_id,sk.family_id,sk.purchasing_unit,sl.delivery_zones
     FROM supplier_listings sl
     JOIN supplier_skus sk ON sk.id=sl.supplier_sku_id AND sk.supplier_id=sl.supplier_id AND sk.status='PUBLISHED'
     JOIN supplier_products sp ON sp.id=sk.supplier_product_id AND sp.status='PUBLISHED'
     JOIN product_specifications ps ON ps.id=sl.product_spec_id AND ps.supplier_sku_id=sk.id
       AND ps.is_active=1 AND ps.approval_status='APPROVED' AND ps.lifecycle_status='PUBLISHED'
     JOIN catalog_product_families f ON f.id=sk.family_id AND f.is_active=1 AND f.approval_status='APPROVED'
     JOIN catalog_categories c ON c.id=f.category_id AND c.is_active=1 AND c.approval_status='APPROVED'
     JOIN users u ON u.id=sl.supplier_id AND u.role='SUPPLIER' AND u.is_verified=1
       AND u.verification_status='VERIFIED'
     JOIN supplier_profiles sf ON sf.supplier_id=u.id AND sf.verification_status='VERIFIED'
     WHERE sl.status='ACTIVE' AND sl.currency='PKR' AND sl.available_stock>=1
       AND sl.buyer_min_qty<=1 ORDER BY sl.id LIMIT 40`
  );
  const fixture=listings.map(row=>{
    let zones;
    try{zones=typeof row.delivery_zones==='string'?JSON.parse(row.delivery_zones):row.delivery_zones;}catch{return null;}
    const zone=Array.isArray(zones)?zones.find(x=>typeof x==='string'&&x.trim()):null;
    return zone?{...row,area:/all lahore|lahore wide/i.test(zone)?'Johar Town, Lahore':zone}:null;
  }).find(Boolean);
  if(!fixture)throw Error('BLOCKED: eligible supplier SKU fixture missing');
  check('Eligible supplier stock and zone fixture',true);

  const tag=crypto.randomUUID(),buyerId=buyers[0].id;
  const [[ordersBefore]]=await db.query('SELECT COUNT(*) AS n FROM orders');
  const [[paymentsBefore]]=await db.query('SELECT COUNT(*) AS n FROM payments');
  const input={delivery_area:fixture.area,
    quote_deadline:new Date(Date.now()+48*3600000).toISOString(),
    items:[{family_id:fixture.family_id,quantity:'1',
      unit:String(fixture.purchasing_unit).toLowerCase(),requirements:'Exact commercial quality'}]};
  const draft=await requests.createDraft(buyerId,input,'b6f-create-'+tag);
  created.push(draft.request.id);
  await requests.publish(buyerId,draft.request.id,draft.request.version_number,'b6f-publish-'+tag);
  const invitation=await matching.invite(buyerId,draft.request.id,fixture.supplier_id);
  await matching.respond(fixture.supplier_id,invitation.id,'INTERESTED');
  check('Buyer request / supplier invitation linked',true);

  const offer={lines:[{request_item_id:draft.request.items[0].id,
    supplier_listing_id:fixture.listing_id,quantity:'1',unit_price:'250.00'}],
    delivery_fee:'500.00',delivery_lead_days:3,
    valid_until:new Date(Date.now()+24*3600000).toISOString(),
    supplier_notes:'Supplier commercial terms'};
  const first=await quotes.submit(fixture.supplier_id,draft.request.id,offer,'b6f-quote-'+tag);
  check('Published immutable version 1',first.version_number===1);
  const view=await comparison.compareForBuyer(buyerId,draft.request.id);
  check('Comparison exact supplier-delivered total',
    view.recommendations.lowest_supplier_quoted_cost?.total_delivered_cost==='750.00');
  check('No fabricated platform fee',
    view.platform_fees_calculated===false &&
    view.physical_specifications_require_buyer_review===true);
  await rejects(()=>comparison.compareForBuyer(2147483000,draft.request.id),'REQUEST_NOT_FOUND');
  check('Other buyer cannot access comparison',true);

  const improvement={version_number:1,message:'Can you improve delivery charges?',target_total:'700.00'};
  const opened=await negotiations.requestBetterOffer(
    buyerId,draft.request.id,first.quote_id,improvement,'b6f-improve-'+tag);
  check('Buyer-created non-binding improvement request',opened.negotiation.status==='OPEN');
  const replay=await negotiations.requestBetterOffer(
    buyerId,draft.request.id,first.quote_id,improvement,'b6f-improve-'+tag);
  check('Durable negotiation idempotency replay',
    replay.is_replay===true&&Number(replay.negotiation.id)===Number(opened.negotiation.id));
  await rejects(()=>negotiations.requestBetterOffer(
    buyerId,draft.request.id,first.quote_id,{...improvement,message:'Different terms'},
    'b6f-improve-'+tag),'IDEMPOTENCY_CONFLICT');
  check('Conflicting reuse of negotiation key rejected',true);
  await rejects(()=>negotiations.requestBetterOffer(
    buyerId,draft.request.id,first.quote_id,{...improvement,version_number:9},
    'b6f-stale-'+tag),'QUOTE_VERSION_CHANGED');
  check('Stale or unknown supplier quote version rejected',true);
  await rejects(()=>negotiations.requestBetterOffer(
    buyerId,draft.request.id,first.quote_id,{...improvement,message:'Call me 0300-1234567'},
    'b6f-contact-'+tag),'DIRECT_CONTACT_NOT_ALLOWED');
  check('Direct-contact requests rejected',true);
  const supplierInbox=await negotiations.forSupplier(fixture.supplier_id);
  check('Supplier inbox scopes negotiations without buyer address',
    supplierInbox.some(n=>Number(n.id)===Number(opened.negotiation.id)) &&
    !Object.hasOwn(supplierInbox[0],'buyer_id') &&
    !Object.hasOwn(supplierInbox[0],'delivery_area'));

  const revised=await quotes.submit(fixture.supplier_id,draft.request.id,
    {...offer,delivery_fee:'400.00'},'b6f-revise-'+tag);
  check('Supplier revised immutable version 2',revised.version_number===2);
  const history=await negotiations.forBuyer(buyerId,draft.request.id);
  const response=history.find(n=>Number(n.id)===Number(opened.negotiation.id));
  check('Negotiation responded atomically with version 2',
    response?.status==='RESPONDED'&&Number(response.responded_version)===2);
  const after=await comparison.compareForBuyer(buyerId,draft.request.id);
  check('Comparison reflects current immutable quote version',
    after.recommendations.lowest_supplier_quoted_cost?.total_delivered_cost==='650.00');
  const historicalReplay=await negotiations.requestBetterOffer(
    buyerId,draft.request.id,first.quote_id,improvement,'b6f-improve-'+tag);
  check('Original negotiation replay remains immutable',
    historicalReplay.is_replay===true&&historicalReplay.negotiation.status==='OPEN');
  const [[ordersAfter]]=await db.query('SELECT COUNT(*) AS n FROM orders');
  const [[paymentsAfter]]=await db.query('SELECT COUNT(*) AS n FROM payments');
  check('Negotiation creates no order or payment',
    String(ordersBefore.n)===String(ordersAfter.n)&&
    String(paymentsBefore.n)===String(paymentsAfter.n));
  console.log(`B6-F ACCEPTANCE: ${count}/${count} PASS`);
}

main().catch(err=>{console.error('B6-F GATE FAIL:',err.stack||err);process.exitCode=1;})
.finally(async()=>{
  try{
    const [[identity]]=await db.query('SELECT DATABASE() AS name');
    assert.equal(identity.name,'miljor_test_db');
    for(const rid of created){
      await db.query('DELETE FROM procurement_quote_negotiations WHERE request_id=?',[rid]);
      const [list]=await db.query('SELECT id FROM procurement_quotes WHERE request_id=?',[rid]);
      for(const row of list){
        await db.query('DELETE FROM procurement_quote_lines WHERE quote_version_id IN (SELECT id FROM procurement_quote_versions WHERE quote_id=?)',[row.id]);
        await db.query('DELETE FROM procurement_quote_versions WHERE quote_id=?',[row.id]);
      }
      await db.query('DELETE FROM procurement_quotes WHERE request_id=?',[rid]);
      await db.query('DELETE FROM procurement_supplier_invitations WHERE request_id=?',[rid]);
      await db.query('DELETE FROM procurement_request_mutations WHERE request_id=?',[rid]);
      await db.query('DELETE FROM procurement_request_items WHERE request_id=?',[rid]);
      await db.query('DELETE FROM procurement_requests WHERE id=?',[rid]);
    }
  }catch(err){console.error('Fixture cleanup failed:',err);process.exitCode=1;}
  await db.end();
});
