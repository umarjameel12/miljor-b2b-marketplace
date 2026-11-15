'use strict';
process.env.NODE_ENV='test';process.env.TEST_DB_NAME='miljor_test_db';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const db=require('../src/config/db');
const binding=require('../src/services/procurementDeliveryBindingService');
const requests=require('../src/services/procurementRequestService');
const {assertDeliveryConsent}=require('../src/services/procurementDeliveryBindingPolicy');
const tag=crypto.randomUUID();
const users=[];let requestId,quoteId,pointId;
async function run(){
  assert.equal((await db.query('SELECT DATABASE() AS name'))[0][0].name,'miljor_test_db');
  for(const role of ['BUYER','SUPPLIER','BUYER']){
    const [created]=await db.query("INSERT INTO users(full_name,email,role,is_verified,verification_status) VALUES (?,?,?,1,'VERIFIED')",['Delivery binding fixture','delivery-'+users.length+'-'+tag+'@example.invalid',role]);users.push(created.insertId);
  }
  const [buyer,supplier,outsider]=users;
  const [clusters]=await db.query('SELECT id FROM geographic_clusters WHERE is_active=1 ORDER BY id LIMIT 1');
  assert.ok(clusters.length,'Active cluster fixture required');const cluster=clusters[0].id;
  const [families]=await db.query("SELECT id,allowed_purchasing_units FROM catalog_product_families WHERE is_active=1 AND approval_status='APPROVED' ORDER BY id LIMIT 1");
  const units=typeof families[0].allowed_purchasing_units==='string'?JSON.parse(families[0].allowed_purchasing_units):families[0].allowed_purchasing_units;
  const unit=units.find(value=>['kg','g','l','ml','bag','tin','carton','sack','bundle','pack'].includes(value));
  const draft=await requests.createDraft(buyer,{delivery_area:'Lahore',quote_deadline:new Date(Date.now()+3600000).toISOString(),items:[{family_id:families[0].id,quantity:'1',unit}]},'binding-request-'+tag);
  requestId=draft.request.id;await requests.publish(buyer,requestId,1,'binding-publish-'+tag);
  const [invitation]=await db.query("INSERT INTO procurement_supplier_invitations(request_id,supplier_id,status,eligible_line_ids) VALUES (?,?,'INTERESTED','[]')",[requestId,supplier]);
  const [quote]=await db.query('INSERT INTO procurement_quotes(request_id,supplier_id,invitation_id) VALUES (?,?,?)',[requestId,supplier,invitation.insertId]);quoteId=quote.insertId;
  await db.query("INSERT INTO procurement_quote_versions(quote_id,version_number,coverage,valid_until,delivery_fee,delivery_lead_days,items_total,quoted_total,immutable_snapshot,idempotency_key,payload_hash) VALUES (?,1,'FULL_BASKET',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR),25,1,100,125,'{}',?,?)",[quoteId,'binding-version-'+tag,'a'.repeat(64)]);
  await db.query('INSERT INTO supplier_delivery_configurations(supplier_id,standard_delivery_enabled,pickup_enabled,express_enabled) VALUES (?,0,1,0)',[supplier]);
  const [point]=await db.query('INSERT INTO supplier_pickup_points(supplier_id,point_name,cluster_id,address_line,pickup_handling_fee_pkr) VALUES (?,?,?,?,25)',[supplier,'Owned fixture pickup',cluster,'Fixture warehouse']);pointId=point.insertId;
  const input={cluster_id:cluster,mode:'PICKUP',pickup_point_id:pointId};
  await assert.rejects(()=>binding.choose(outsider,requestId,quoteId,input,'binding-foreign-'+tag),error=>error.code==='REQUEST_NOT_FOUND');
  const results=await Promise.all([binding.choose(buyer,requestId,quoteId,input,'binding-intent-'+tag),binding.choose(buyer,requestId,quoteId,input,'binding-intent-'+tag)]);
  assert.equal(results.filter(result=>result.is_replay).length,1);
  assert.equal(results[0].delivery_terms.hash,results[1].delivery_terms.hash);
  const terms=results[0].delivery_terms;
  assert.equal(terms.fee,'25.00');assert.equal(terms.pickup_snapshot.address_line,'Fixture warehouse');
  const choices=await binding.forSupplier(supplier,requestId);assert.equal(choices.length,1);
  assert.equal(Object.hasOwn(choices[0],'buyer_id'),false);
  assert.deepEqual(await binding.forSupplier(outsider,requestId),[]);
  await assert.rejects(()=>binding.choose(buyer,requestId,quoteId,{...input,cluster_id:cluster+1},'binding-intent-'+tag),error=>error.code==='IDEMPOTENCY_CONFLICT');
  const connection=await db.getConnection();
  const validate=fee=>binding.validate(connection,{buyerId:buyer,supplierId:supplier,requestId,quoteId,code:terms.quote_code,fee});
  try{
    await connection.beginTransaction();
    assert.equal((await validate('25.00')).hash,terms.hash);
    await assert.rejects(()=>validate('26.00'),error=>error.code==='DELIVERY_FEE_MISMATCH');
    assert.throws(()=>assertDeliveryConsent(terms,'stale'),error=>error.code==='DELIVERY_REAPPROVAL_REQUIRED');
    await connection.rollback();
  }finally{connection.release();}
  await db.query('UPDATE supplier_pickup_points SET address_line=? WHERE id=?',['Changed fixture warehouse',pointId]);
  const changed=await db.getConnection();
  try{await changed.beginTransaction();await assert.rejects(()=>binding.validate(changed,{buyerId:buyer,supplierId:supplier,requestId,quoteId,code:terms.quote_code,fee:'25.00'}),error=>error.code==='DELIVERY_REAPPROVAL_REQUIRED');await changed.rollback();}finally{changed.release();}
  const [events]=await db.query("SELECT id FROM procurement_notifications WHERE recipient_id=? AND event_type='DELIVERY_CHOICE_RECORDED'",[supplier]);assert.equal(events.length,1);
  await db.query('UPDATE supplier_delivery_configurations SET standard_delivery_enabled=1 WHERE supplier_id=?',[supplier]);
  await db.query("INSERT INTO supplier_delivery_cluster_rates(supplier_id,cluster_id,mode,fee_pkr) VALUES (?,?,'STANDARD_CLUSTERED',35)",[supplier,cluster]);
  const [address]=await db.query("INSERT INTO buyer_delivery_addresses(user_id,cluster_id,society_area,full_address,geographic_match_status) VALUES (?,?,?,?,'VERIFIED')",[buyer,cluster,'Fixture area','Owned fixture destination']);
  const doorstep=await binding.choose(buyer,requestId,quoteId,{cluster_id:cluster,mode:'STANDARD_CLUSTERED',address_id:address.insertId},'binding-address-'+tag);
  assert.equal(doorstep.delivery_terms.fee,'35.00');assert.equal(Object.hasOwn(doorstep.delivery_terms,'full_address'),false);
  await db.query('UPDATE buyer_delivery_addresses SET revision=revision+1 WHERE id=?',[address.insertId]);
  const destination=await db.getConnection();
  try{await destination.beginTransaction();await assert.rejects(()=>binding.validate(destination,{buyerId:buyer,supplierId:supplier,requestId,quoteId,code:doorstep.delivery_terms.quote_code,fee:'35.00'}),error=>error.code==='DELIVERY_REAPPROVAL_REQUIRED');await destination.rollback();}finally{destination.release();}
  const [[notices]]=await db.query("SELECT COUNT(*) AS total FROM procurement_notifications WHERE recipient_id=? AND event_type='DELIVERY_CHOICE_RECORDED'",[supplier]);assert.equal(Number(notices.total),2);
  console.log('PROCUREMENT_DELIVERY_BINDING_MYSQL_PASS: pickup and clustered fees; ownership; concurrent replay; supplier isolation; changed pickup/address rejects; two distinct notifications');
}
run().catch(error=>{console.error(error.code||'BINDING_GATE_FAILED',error.message);process.exitCode=1;}).finally(async()=>{
  try{
    assert.equal((await db.query('SELECT DATABASE() AS name'))[0][0].name,'miljor_test_db');
    for(const userId of users)await db.query('DELETE FROM procurement_notifications WHERE recipient_id=?',[userId]);
    if(quoteId){await db.query('DELETE FROM delivery_quotes WHERE procurement_quote_id=?',[quoteId]);await db.query('DELETE FROM procurement_quote_versions WHERE quote_id=?',[quoteId]);await db.query('DELETE FROM procurement_quotes WHERE id=?',[quoteId]);}
    if(requestId){for(const table of ['procurement_supplier_invitations','procurement_request_mutations','procurement_request_items'])await db.query('DELETE FROM '+table+' WHERE request_id=?',[requestId]);await db.query('DELETE FROM procurement_requests WHERE id=?',[requestId]);}
    if(pointId)await db.query('DELETE FROM supplier_pickup_points WHERE id=?',[pointId]);
    for(const userId of users){await db.query('DELETE FROM supplier_delivery_configurations WHERE supplier_id=?',[userId]);await db.query('DELETE FROM users WHERE id=?',[userId]);}
  }catch(error){console.error('OWNED_FIXTURE_CLEANUP_FAILED',error.code||error.message);process.exitCode=1;}
  await db.end();
});
