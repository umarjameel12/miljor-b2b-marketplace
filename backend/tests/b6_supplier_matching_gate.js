'use strict';
// B6-D end-to-end supplier invitation gate, deliberately scoped to test DB.
// Requires reviewed migrations 037 and 038; never runs against miljor_db.
process.env.NODE_ENV='test';
process.env.TEST_DB_NAME='miljor_test_db';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const db=require('../src/config/db');
const requests=require('../src/services/procurementRequestService');
const matching=require('../src/services/procurementMatchingService');
const created=[];
let count=0;
const check=(condition,message)=>{assert.ok(condition,message);count++;console.log('PASS '+count+': '+message)};
async function main(){
  const [[id]]=await db.query('SELECT DATABASE() AS db_name');
  assert.equal(id.db_name,'miljor_test_db','Protected DB: execution refused');
  check(true,'Test DB identity');
  for(const table of ['procurement_requests','procurement_request_items','procurement_request_mutations','procurement_supplier_invitations']){
    const [rows]=await db.query(
      'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
    check(rows.length===1,table+' migration present');
  }
  const [buyers]=await db.query(
    "SELECT id FROM users WHERE role='BUYER' AND is_verified=1 AND verification_status='VERIFIED' AND (buyer_trust_status IS NULL OR buyer_trust_status <> 'SUSPENDED') LIMIT 1"
  );
  if(!buyers.length)throw Error('BLOCKED: verified buyer fixture missing');
  // Verify matching with actual supplier-owned physical SKU, spec, verified
  // seller and delivery zone rather than bypassing the service's eligibility.
  const [listings]=await db.query(
    `SELECT sl.id AS listing_id,sl.supplier_id,sl.delivery_zones,sk.family_id,sk.purchasing_unit
     FROM supplier_listings sl
     JOIN supplier_skus sk ON sk.id=sl.supplier_sku_id AND sk.status='PUBLISHED'
     JOIN supplier_products sp ON sp.id=sk.supplier_product_id AND sp.status='PUBLISHED'
     JOIN product_specifications ps ON ps.id=sl.product_spec_id
       AND ps.supplier_sku_id=sk.id AND ps.lifecycle_status='PUBLISHED'
       AND ps.approval_status='APPROVED' AND ps.is_active=1
     JOIN users u ON u.id=sl.supplier_id AND u.role='SUPPLIER'
       AND u.is_verified=1 AND u.verification_status='VERIFIED'
     JOIN supplier_profiles pr ON pr.supplier_id=u.id AND pr.verification_status='VERIFIED'
     WHERE sl.status='ACTIVE' AND sl.available_stock>=1 AND sl.buyer_min_qty<=1 AND sl.currency='PKR'
     LIMIT 30`
  );
  let fixture=null;
  for(const row of listings){
    const zones=typeof row.delivery_zones==='string'?JSON.parse(row.delivery_zones):row.delivery_zones;
    if(!Array.isArray(zones)||!zones.length)continue;
    const valid=zones.find(x=>typeof x==='string'&&x.trim());
    if(valid){fixture={...row,area:valid.toLowerCase()==='all lahore'?'Johar Town, Lahore':valid};break;}
  }
  if(!fixture)throw Error('BLOCKED: supplier listing fixture with published SKU + delivery zone missing');
  check(true,'Existing eligible supplier-owned SKU fixture');

  const tag=crypto.randomUUID();
  const payload={
    delivery_area:fixture.area,
    quote_deadline:new Date(Date.now()+48*3600000).toISOString(),
    items:[{family_id:fixture.family_id,unit:String(fixture.purchasing_unit).toLowerCase(),quantity:'1',requirements:'Rice type or equivalent valid family specification'}]
  };
  const draft=await requests.createDraft(buyers[0].id,payload,'b6match-'+tag);
  created.push(draft.request.id);
  const pub=await requests.publish(buyers[0].id,draft.request.id,draft.request.version_number,'b6publish-'+tag);
  check(pub.request.status==='OPEN','Owned request published');

  const found=await matching.findForBuyer(buyers[0].id,draft.request.id);
  check(found.some(x=>x.supplier_id===Number(fixture.supplier_id)),'Verified supplier matched');
  const invitation=await matching.invite(buyers[0].id,draft.request.id,fixture.supplier_id);
  check(invitation.status==='INVITED','Buyer invited eligible supplier');
  const retry=await matching.invite(buyers[0].id,draft.request.id,fixture.supplier_id);
  check(Number(retry.id)===Number(invitation.id),'Duplicate invitation idempotent');
  const inbox=await matching.inbox(fixture.supplier_id);
  const selected=inbox.find(x=>Number(x.invitation_id)===Number(invitation.id));
  check(Boolean(selected),'Supplier receives private inbox invitation');
  check(Array.isArray(selected.eligible_offers) &&
    selected.eligible_offers.some(offer=>Number(offer.supplier_listing_id)===Number(fixture.listing_id)),
    'Supplier sees authorized physical SKU choices for quote preparation');
  check(!Object.hasOwn(selected,'buyer_id') && !Object.hasOwn(selected,'delivery_area') &&
    !Object.hasOwn(selected,'delivery_address'),'Buyer identity and address not leaked');
  const interested=await matching.respond(fixture.supplier_id,invitation.id,'INTERESTED');
  check(interested.status==='INTERESTED','Supplier can register interest');
  const again=await matching.respond(fixture.supplier_id,invitation.id,'INTERESTED');
  check(again.is_replay===true,'Supplier response replay safe');
  await assert.rejects(
    ()=>matching.respond(fixture.supplier_id,invitation.id,'DECLINED'),
    e=>e.code==='INVITATION_ALREADY_ANSWERED'
  );
  check(true,'Supplier cannot reverse accepted interest');
  const listed=await matching.listInvitationsForBuyer(buyers[0].id,draft.request.id);
  check(listed.length===1 && listed[0].status==='INTERESTED','Buyer sees supplier response');
  console.log('B6 SUPPLIER MATCHING GATE: '+count+'/'+count+' PASS');
}
main().catch(error=>{console.error('B6 MATCHING GATE FAIL:',error.stack||error);process.exitCode=1;})
.finally(async()=>{
  try{
    const [[id]]=await db.query('SELECT DATABASE() AS db_name');
    assert.equal(id.db_name,'miljor_test_db');
    for(const requestId of created){
      await db.query('DELETE FROM procurement_supplier_invitations WHERE request_id=?',[requestId]);
      await db.query('DELETE FROM procurement_request_mutations WHERE request_id=?',[requestId]);
      await db.query('DELETE FROM procurement_request_items WHERE request_id=?',[requestId]);
      await db.query('DELETE FROM procurement_requests WHERE id=?',[requestId]);
    }
  }catch(error){console.error('B6 fixture cleanup failed:',error);process.exitCode=1;}
  await db.end();
});
