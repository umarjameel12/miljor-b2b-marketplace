'use strict';
// MilJor B6-E test-db-only quote contract. Review migrations 037–039 first.
process.env.NODE_ENV='test';
process.env.TEST_DB_NAME='miljor_test_db';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const db=require('../src/config/db');
const requests=require('../src/services/procurementRequestService');
const matching=require('../src/services/procurementMatchingService');
const quotes=require('../src/services/procurementQuoteService');

const tracked=[];
let passed=0;
function pass(name){passed++;console.log('PASS '+String(passed).padStart(2,'0')+' '+name);}
async function rejects(fn,code){await assert.rejects(fn,err=>err.code===code);}
async function main(){
  const [[dbName]]=await db.query('SELECT DATABASE() AS name');
  assert.equal(dbName.name,'miljor_test_db','Refusing protected database');
  pass('isolated test DB identity');

  for(const table of ['procurement_requests','procurement_request_items',
    'procurement_supplier_invitations','procurement_quotes',
    'procurement_quote_versions','procurement_quote_lines']){
    const [tables]=await db.query(
      'SELECT ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
    assert.equal(tables.length,1,'Missing table '+table);
    assert.equal(tables[0].ENGINE,'InnoDB','Transactions required');
  }
  pass('migrations 037–039 transaction tables exist');
  const [[beforeOrders]]=await db.query('SELECT COUNT(*) AS n FROM orders');
  const [[beforePayments]]=await db.query('SELECT COUNT(*) AS n FROM payments');
  pass('financial tables baseline captured before quote-only operations');
  const [buyers]=await db.query(
    "SELECT id FROM users WHERE role='BUYER' AND is_verified=1 AND verification_status='VERIFIED' LIMIT 1"
  );
  if(!buyers.length)throw Error('BLOCKED: verified buyer fixture missing');
  const buyerId=buyers[0].id;
  const [listings]=await db.query(
    `SELECT sl.id AS listing_id,sl.supplier_id,sk.family_id,
            sk.purchasing_unit,sl.available_stock,sl.delivery_zones
     FROM supplier_listings sl
     JOIN supplier_skus sk ON sk.id=sl.supplier_sku_id
       AND sk.supplier_id=sl.supplier_id AND sk.status='PUBLISHED'
     JOIN supplier_products sp ON sp.id=sk.supplier_product_id
       AND sp.supplier_id=sl.supplier_id AND sp.status='PUBLISHED'
     JOIN product_specifications ps ON ps.id=sl.product_spec_id
       AND ps.supplier_id=sl.supplier_id AND ps.supplier_sku_id=sk.id
       AND ps.is_active=1 AND ps.approval_status='APPROVED' AND ps.lifecycle_status='PUBLISHED'
     JOIN users u ON u.id=sl.supplier_id AND u.role='SUPPLIER'
       AND u.is_verified=1 AND u.verification_status='VERIFIED'
     JOIN supplier_profiles sf ON sf.supplier_id=u.id AND sf.verification_status='VERIFIED'
     WHERE sl.status='ACTIVE' AND sl.currency='PKR' AND sl.available_stock>=2 AND sl.buyer_min_qty<=1
     ORDER BY sl.id LIMIT 40`
  );
  const fixture=listings.map(row=>{
    const zones=typeof row.delivery_zones==='string'?JSON.parse(row.delivery_zones):row.delivery_zones;
    const zone=Array.isArray(zones)?zones.find(z=>typeof z==='string'&&z.trim()):null;
    return zone?{...row,area:/all lahore/i.test(zone)?'Johar Town, Lahore':zone}:null;
  }).find(Boolean);
  if(!fixture)throw Error('BLOCKED: eligible supplier, stock and zone fixture missing');
  pass('supplier-owned SKU + delivered area fixture available');

  const tag=crypto.randomUUID();
  const payload={
    delivery_area:fixture.area,
    quote_deadline:new Date(Date.now()+48*3600000).toISOString(),
    items:[{family_id:fixture.family_id,quantity:'1',
      unit:String(fixture.purchasing_unit).toLowerCase(),requirements:'Commercial B2B supply'}]
  };
  const draft=await requests.createDraft(buyerId,payload,'quote-create-'+tag);
  tracked.push(draft.request.id);
  const published=await requests.publish(
    buyerId,draft.request.id,draft.request.version_number,'quote-publish-'+tag);
  assert.equal(published.request.status,'OPEN');
  pass('buyer published eligible quote request');

  const matches=await matching.findForBuyer(buyerId,draft.request.id);
  assert.ok(matches.some(x=>x.supplier_id===Number(fixture.supplier_id)));
  const invitation=await matching.invite(buyerId,draft.request.id,fixture.supplier_id);
  assert.equal(invitation.status,'INVITED');
  const interest=await matching.respond(fixture.supplier_id,invitation.id,'INTERESTED');
  assert.equal(interest.status,'INTERESTED');
  pass('verified supplier invitation accepted');

  const requestedItem=draft.request.items[0];
  const offer={
    lines:[{request_item_id:requestedItem.id,supplier_listing_id:fixture.listing_id,
      quantity:'1',unit_price:'250.00'}],
    delivery_fee:'500.00',
    delivery_lead_days:2,
    valid_until:new Date(Date.now()+24*3600000).toISOString(),
    supplier_notes:'Commercial quote only'
  };
  const created=await quotes.submit(fixture.supplier_id,draft.request.id,offer,'quote-first-'+tag);
  assert.equal(created.version_number,1);
  assert.equal(created.coverage,'FULL_BASKET');
  assert.equal(created.quoted_total,'750.00');
  assert.equal(created.lines[0].snapshot.supplier_sku_id>0,true);
  pass('first version + exact landed total + physical SKU snapshot');

  const again=await quotes.submit(fixture.supplier_id,draft.request.id,offer,'quote-first-'+tag);
  assert.equal(again.is_replay,true);
  assert.equal(again.version_number,1);
  pass('same idempotency key returns original immutable version');

  await rejects(
    ()=>quotes.submit(fixture.supplier_id,draft.request.id,
      {...offer,delivery_fee:'999.00'},'quote-first-'+tag),
    'IDEMPOTENCY_CONFLICT'
  );
  pass('same idempotency key with changed quote rejected');

  await rejects(
    ()=>quotes.submit(fixture.supplier_id,draft.request.id,
      {...offer,supplier_notes:'Contact 0300-1234567'},'quote-direct-'+tag),
    'DIRECT_CONTACT_NOT_ALLOWED'
  );
  pass('supplier off-platform contact attempts rejected');

  await rejects(
    ()=>quotes.submit(2147483000,draft.request.id,offer,'quote-outsider-'+tag),
    'INVITATION_REQUIRED'
  );
  pass('supplier without accepted invitation cannot quote');

  const updated={...offer,delivery_fee:'400.00',supplier_notes:'Revised delivery'};
  const versionTwo=await quotes.submit(
    fixture.supplier_id,draft.request.id,updated,'quote-second-'+tag);
  assert.equal(versionTwo.version_number,2);
  assert.equal(versionTwo.quoted_total,'650.00');
  pass('quote revision creates a new version and recomputes total');

  const [versions]=await db.query(
    'SELECT version_number,quoted_total FROM procurement_quote_versions WHERE quote_id=? ORDER BY version_number',[created.quote_id]);
  assert.deepEqual(versions.map(x=>x.version_number),[1,2]);
  assert.equal(String(versions[0].quoted_total),'750.00');
  pass('historical quote version and price unchanged');

  const buyerQuotes=await quotes.getForBuyer(buyerId,draft.request.id);
  assert.equal(buyerQuotes.length,1);
  assert.equal(buyerQuotes[0].current_version,2);
  assert.equal(buyerQuotes[0].quote_snapshot.lines.length,1);
  pass('buyer sees only latest supplier quote and specification snapshot');

  const history=await quotes.getVersionsForBuyer(buyerId,draft.request.id,created.quote_id);
  assert.deepEqual(history.versions.map(v=>v.version_number),[2,1]);
  assert.equal(history.versions[1].quote_snapshot.quoted_total,'750.00');
  pass('buyer sees immutable v1 and v2 price history');

  await rejects(
    ()=>quotes.getForBuyer(2147483000,draft.request.id),'REQUEST_NOT_FOUND'
  );
  pass('other buyer cannot read private quote');

  await rejects(
    ()=>quotes.submit(fixture.supplier_id,draft.request.id,
      {...offer,lines:[{...offer.lines[0],quantity:'2'}]},'quote-bad-'+tag),
    'QUOTE_QUANTITY_MISMATCH'
  );
  pass('quote quantity must cover exactly requested item volume');

  await rejects(
    ()=>quotes.submit(fixture.supplier_id,draft.request.id,
      {...offer,lines:[{...offer.lines[0],supplier_listing_id:2147483000}]},'quote-wrong-'+tag),
    'LISTING_NOT_ELIGIBLE'
  );
  pass('foreign or unavailable supplier listing rejected');

  const [[afterOrders]]=await db.query('SELECT COUNT(*) AS n FROM orders');
  const [[afterPayments]]=await db.query('SELECT COUNT(*) AS n FROM payments');
  assert.equal(String(afterOrders.n),String(beforeOrders.n),'Quote creation must not create orders');
  assert.equal(String(afterPayments.n),String(beforePayments.n),'Quote creation must not initiate payment');
  const [mutationCheck]=await db.query(
    'SELECT COUNT(*) AS total FROM procurement_quote_versions WHERE quote_id=?',[created.quote_id]);
  assert.equal(Number(mutationCheck[0].total),2);
  pass('two immutable quote versions, no orders or payment mutations');

  const withdrawn=await quotes.withdraw(
    fixture.supplier_id,created.quote_id,'quote-withdraw-'+tag
  );
  assert.equal(withdrawn.status,'WITHDRAWN');
  pass('supplier can withdraw quote without deleting versions');

  const withdrawReplay=await quotes.withdraw(
    fixture.supplier_id,created.quote_id,'quote-withdraw-'+tag
  );
  assert.equal(withdrawReplay.is_replay,true);
  pass('withdraw retry idempotently replays');

  await rejects(
    ()=>quotes.withdraw(fixture.supplier_id,created.quote_id,'different-withdraw-'+tag),
    'QUOTE_ALREADY_WITHDRAWN'
  );
  pass('withdrawal cannot be replaced with a different mutation key');

  await rejects(
    ()=>quotes.submit(fixture.supplier_id,draft.request.id,offer,'quote-third-'+tag),
    'QUOTE_WITHDRAWN'
  );
  pass('withdrawn supplier quote cannot be revised');

  console.log('B6 SUPPLIER QUOTE GATE: '+passed+'/'+passed+' PASS');
}
main().catch(e=>{console.error('B6 QUOTE GATE FAIL:',e.stack||e);process.exitCode=1;})
.finally(async()=>{
  try{
    const [[identity]]=await db.query('SELECT DATABASE() AS name');
    assert.equal(identity.name,'miljor_test_db','Cleanup refused: DB identity changed');
    for(const id of tracked){
      const [q]=await db.query('SELECT id FROM procurement_quotes WHERE request_id=?',[id]);
      for(const row of q){
        await db.query('DELETE FROM procurement_quote_lines WHERE quote_version_id IN (SELECT id FROM procurement_quote_versions WHERE quote_id=?)',[row.id]);
        await db.query('DELETE FROM procurement_quote_versions WHERE quote_id=?',[row.id]);
      }
      await db.query('DELETE FROM procurement_quotes WHERE request_id=?',[id]);
      await db.query('DELETE FROM procurement_supplier_invitations WHERE request_id=?',[id]);
      await db.query('DELETE FROM procurement_request_mutations WHERE request_id=?',[id]);
      await db.query('DELETE FROM procurement_request_items WHERE request_id=?',[id]);
      await db.query('DELETE FROM procurement_requests WHERE id=?',[id]);
    }
  }catch(e){console.error('B6 quote fixture cleanup failed:',e);process.exitCode=1;}
  await db.end();
});
