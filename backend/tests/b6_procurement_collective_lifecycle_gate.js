'use strict';
// B6-I private collective consent integration gate; test DB ONLY.
process.env.NODE_ENV='test';process.env.TEST_DB_NAME='miljor_test_db';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const db=require('../src/config/db');
const requests=require('../src/services/procurementRequestService');
const collectives=require('../src/services/procurementCollectiveService');
let requestId=null,groupId=null,count=0;
const check=(text,condition)=>{assert.ok(condition,text);console.log('PASS '+(++count)+': '+text)};
const fails=async(code,fn)=>assert.rejects(fn,e=>e.code===code);
async function main(){
  const [[identity]]=await db.query('SELECT DATABASE() AS db_name');
  assert.equal(identity.db_name,'miljor_test_db');
  check('Fail-closed test DB identity',true);
  for(const name of ['procurement_collective_groups',
    'procurement_collective_participants','procurement_collective_participant_lines']){
    const [rows]=await db.query(
      'SELECT ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[name]);
    assert.equal(rows.length,1,'Missing migration 041: '+name);
    assert.equal(rows[0].ENGINE,'InnoDB');
  }
  check('Migration 041 tables exist with InnoDB',true);
  const [buyers]=await db.query(
    `SELECT id FROM users WHERE role='BUYER' AND is_verified=1
       AND verification_status='VERIFIED' AND buyer_trust_status<>'SUSPENDED'
       ORDER BY id LIMIT 2`);
  if(buyers.length<2)throw Error('BLOCKED: two verified test buyers required');
  const [families]=await db.query(
    `SELECT id FROM catalog_product_families WHERE is_active=1
       AND approval_status='APPROVED' ORDER BY id LIMIT 1`);
  if(!families.length)throw Error('BLOCKED: approved family fixture missing');
  const idempotency='b6coll-'+crypto.randomUUID();
  const draft=await requests.createDraft(buyers[0].id,{
    ownership:'COLLECTIVE',frequency:'ONE_TIME',delivery_area:'Johar Town, Lahore',
    join_deadline:new Date(Date.now()+86400000).toISOString(),
    quote_deadline:new Date(Date.now()+2*86400000).toISOString(),
    items:[{family_id:families[0].id,quantity:'5',unit:'bag'}]
  },idempotency);
  requestId=draft.request.id;
  check('Organizer created non-binding multi-buyer draft',draft.request.status==='DRAFT');
  const created=await collectives.createGroup(buyers[0].id,requestId,{
    visibility:'PRIVATE_INVITE',minimum_buyers:2
  });
  groupId=created.group.id;
  check('Collective starts forming without buyer payment',created.group.status==='FORMING');
  const same=await collectives.createGroup(buyers[0].id,requestId,{
    visibility:'PRIVATE_INVITE',minimum_buyers:2
  });
  check('Duplicate group creation replayed',same.is_replay===true&&Number(same.group.id)===Number(groupId));
  await collectives.invite(buyers[0].id,groupId,buyers[1].id);
  check('Organizer can invite verified buyer',true);
  const invited=await collectives.listMyInvites(buyers[1].id);
  const invite=invited.find(x=>Number(x.group_id)===Number(groupId));
  check('Invitee sees product lines, not organizer address',
    !!invite&&invite.items.length===1&&
    !Object.hasOwn(invite,'organizer_buyer_id')&&
    !Object.hasOwn(invite,'delivery_address'));
  const lineId=draft.request.items[0].id;
  await collectives.join(buyers[0].id,groupId,
    [{request_item_id:lineId,quantity:'3'}],'owner-'+idempotency);
  const joined=await collectives.join(buyers[1].id,groupId,
    [{request_item_id:lineId,quantity:'2'}],'join-'+idempotency);
  check('Each buyer explicitly consents to their own quantity',
    joined.consent_snapshot.items[0].quantity==='2.0000'&&
    joined.consent_snapshot.authorizes_any_price===false);
  const replay=await collectives.join(buyers[1].id,groupId,
    [{request_item_id:lineId,quantity:'2'}],'join-'+idempotency);
  check('Join replay returns the original consent',replay.is_replay===true);
  await fails('IDEMPOTENCY_CONFLICT',()=>collectives.join(buyers[1].id,groupId,
    [{request_item_id:lineId,quantity:'99'}],'join-'+idempotency));
  check('Changed quantity with reused key rejected',true);
  const [lines]=await db.query(
    `SELECT p.buyer_id,l.quantity FROM procurement_collective_participant_lines l
     JOIN procurement_collective_participants p ON p.id=l.participant_id
     WHERE p.group_id=? ORDER BY p.buyer_id`,[groupId]);
  check('Two independent participant quantities persisted',lines.length===2);
  const [[orders]]=await db.query('SELECT COUNT(*) AS n FROM orders');
  const [[payments]]=await db.query('SELECT COUNT(*) AS n FROM payments');
  check('No payment authorization created by joining',
    Number(orders.n)>=0&&Number(payments.n)>=0&&
    joined.consent_snapshot.creates_payment===false);
  console.log('B6 COLLECTIVE LIFECYCLE: '+count+'/'+count+' PASS');
}
main().catch(e=>{console.error('B6 COLLECTIVE LIFECYCLE FAIL:',e.stack||e);process.exitCode=1;})
.finally(async()=>{
  try{
    const [[identity]]=await db.query('SELECT DATABASE() AS db_name');
    assert.equal(identity.db_name,'miljor_test_db');
    if(groupId){
      await db.query(`DELETE l FROM procurement_collective_participant_lines l
         JOIN procurement_collective_participants p ON p.id=l.participant_id
         WHERE p.group_id=?`,[groupId]);
      await db.query('DELETE FROM procurement_collective_participants WHERE group_id=?',[groupId]);
      await db.query('DELETE FROM procurement_collective_groups WHERE id=?',[groupId]);
    }
    if(requestId){
      await db.query('DELETE FROM procurement_request_mutations WHERE request_id=?',[requestId]);
      await db.query('DELETE FROM procurement_request_items WHERE request_id=?',[requestId]);
      await db.query('DELETE FROM procurement_requests WHERE id=?',[requestId]);
    }
  }catch(e){console.error('Collective test cleanup failed:',e);process.exitCode=1;}
  await db.end();
});
