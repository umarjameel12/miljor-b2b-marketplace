'use strict';

// Run from backend/ with NODE_ENV=test. All writes are disposable test-owned rows.
// Never runs against miljor_db and never alters existing buyer/supplier accounts.
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../src/config/db');
const service = require('../src/services/procurementRequestService');

let checks = 0;
const pass = label => {checks++;console.log(`PASS ${checks}: ${label}`);};
const expectError = async (fn, code) => {
  await assert.rejects(fn, error => error.code === code, `Expected ${code}`);
};
const ids = [];

async function main() {
  const [[identity]] = await db.query('SELECT DATABASE() AS db_name');
  assert.equal(identity.db_name, 'miljor_test_db', 'FAIL CLOSED: incorrect database');
  pass('Connected exclusively to miljor_test_db');

  const tables = ['procurement_requests','procurement_request_items','procurement_request_mutations'];
  for (const table of tables) {
    const [rows] = await db.query(
      'SELECT TABLE_NAME,ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
      [table]
    );
    assert.equal(rows.length, 1, `Migration 037 missing: ${table}`);
    assert.equal(rows[0].ENGINE, 'InnoDB');
  }
  pass('Migration 037 tables present and transactional');

  const [buyers] = await db.query(
    "SELECT id FROM users WHERE role='BUYER' AND is_verified=1 AND verification_status='VERIFIED' AND (buyer_trust_status IS NULL OR buyer_trust_status <> 'SUSPENDED') ORDER BY id LIMIT 2"
  );
  if (!buyers.length) throw Error('BLOCKED: test DB requires an existing verified buyer fixture');
  const buyerId = buyers[0].id;
  const otherId = buyers[1]?.id || 2147483000;
  const [families] = await db.query(
    "SELECT id FROM catalog_product_families WHERE is_active=1 AND approval_status='APPROVED' ORDER BY id LIMIT 2"
  );
  if (families.length < 2) throw Error('BLOCKED: test DB requires two approved family fixtures');
  pass('Existing verified buyer and two approved families available');

  const [columns] = await db.query(
    `SELECT TABLE_NAME,COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
       ('procurement_requests','procurement_request_items','procurement_request_mutations')`
  );
  const found = new Set(columns.map(x=>`${x.TABLE_NAME}.${x.COLUMN_NAME}`));
  for (const name of [
    'procurement_requests.buyer_id','procurement_requests.idempotency_key',
    'procurement_requests.version_number','procurement_requests.request_hash',
    'procurement_requests.create_response_snapshot',
    'procurement_request_items.request_id','procurement_request_items.family_id',
    'procurement_request_items.quantity','procurement_request_mutations.response_snapshot',
    'procurement_request_mutations.idempotency_key'
  ]) assert.ok(found.has(name), `Migration 037 column missing: ${name}`);
  pass('All essential new request/line/replay columns exist');

  const beforeOrders = (await db.query('SELECT COUNT(*) AS total FROM orders'))[0][0].total;
  const beforePayments = (await db.query('SELECT COUNT(*) AS total FROM payments'))[0][0].total;
  const tag = crypto.randomUUID();
  const payload = {
    delivery_area: 'Johar Town, Lahore',
    quote_deadline: new Date(Date.now() + 2*86400000).toISOString(),
    items: [
      { family_id: families[0].id, quantity:'100.2500', unit:'kg', requirements:'Premium Sella' },
      { family_id: families[1].id, quantity:'5', unit:'tin', requirements:'Sealed commercial tin' }
    ]
  };

  const created = await service.createDraft(buyerId,payload,'req-'+tag);
  ids.push(created.request.id);
  assert.equal(created.is_replay,false);
  assert.equal(created.request.status,'DRAFT');
  assert.equal(created.request.items.length,2);
  pass('Buyer can create a transactional 2-line draft');

  const replay = await service.createDraft(buyerId,payload,'req-'+tag);
  assert.equal(replay.is_replay,true);
  assert.equal(Number(replay.request.id),Number(created.request.id));
  pass('Create retry returns same record without duplicate items');

  await expectError(
    () => service.createDraft(buyerId,{...payload,delivery_area:'Different Address'},'req-'+tag),
    'IDEMPOTENCY_CONFLICT'
  );
  pass('Reused create key with different payload rejected');

  await expectError(() => service.getMine(otherId,created.request.id),'REQUEST_NOT_FOUND');
  pass('Cross-buyer request reads fail closed');

  await expectError(
    () => service.updateDraft(buyerId,created.request.id,payload,999,'edit-'+tag),
    'REQUEST_VERSION_CONFLICT'
  );
  pass('Stale expected version cannot change draft');

  const edited = await service.updateDraft(
    buyerId,created.request.id,{...payload,delivery_area:'DHA, Lahore'},
    created.request.version_number,'edit-'+tag
  );
  assert.equal(edited.delivery_area,'DHA, Lahore');
  assert.equal(edited.items.length,2);
  assert.equal(Number(edited.version_number),Number(created.request.version_number)+1);
  pass('Draft edit atomically replaces item list and increments version');

  const originalCreateReplay = await service.createDraft(buyerId,payload,'req-'+tag);
  assert.equal(originalCreateReplay.is_replay,true);
  assert.equal(originalCreateReplay.request.delivery_area,'Johar Town, Lahore');
  assert.equal(Number(originalCreateReplay.request.version_number),Number(created.request.version_number));
  pass('Original creation snapshot stays stable after draft edits');

  const editReplay = await service.updateDraft(
    buyerId,created.request.id,{...payload,delivery_area:'DHA, Lahore'},
    created.request.version_number,'edit-'+tag
  );
  assert.equal(Number(editReplay.version_number),Number(edited.version_number));
  pass('Edit retry returns durable previous response');

  await expectError(
    () => service.updateDraft(buyerId,created.request.id,payload,created.request.version_number,'edit-'+tag),
    'IDEMPOTENCY_CONFLICT'
  );
  pass('Same edit key with changed request rejected');

  await expectError(
    () => service.createDraft(buyerId,{
      ...payload,items:[{family_id:families[0].id,quantity:'5',unit:'tin'}]
    },'badunit-'+tag),
    'INCOMPATIBLE_FAMILY_UNIT'
  );
  pass('Incompatible rice/tin purchasing unit blocked by canonical family policy');

  const published = await service.publish(buyerId,created.request.id,edited.version_number,'publish-'+tag);
  assert.equal(published.request.status,'OPEN');
  assert.equal(Number(published.request.version_number),Number(edited.version_number)+1);
  pass('Buyer publishes one-time request with authoritative server deadline');

  const publishReplay = await service.publish(buyerId,created.request.id,edited.version_number,'publish-'+tag);
  assert.equal(publishReplay.is_replay,true);
  assert.equal(publishReplay.request.status,'OPEN');
  pass('Publish retry replays immutable published snapshot');

  await expectError(
    () => service.updateDraft(buyerId,created.request.id,payload,published.request.version_number,'late-'+tag),
    'REQUEST_IMMUTABLE'
  );
  pass('Published request cannot be edited');

  const [rows] = await db.query(
    'SELECT id FROM procurement_requests WHERE buyer_id=? AND idempotency_key=?',[buyerId,'req-'+tag]
  );
  assert.equal(rows.length,1);
  assert.equal((await db.query('SELECT COUNT(*) AS total FROM orders'))[0][0].total,beforeOrders);
  assert.equal((await db.query('SELECT COUNT(*) AS total FROM payments'))[0][0].total,beforePayments);
  pass('No duplicate request or premature orders/payments');

  const mine = await service.listMine(buyerId);
  assert.ok(mine.some(row=>Number(row.id)===Number(created.request.id)));
  pass('Buyer can list only owned requests');

  console.log(`B6 BUYER PROCUREMENT LIFECYCLE: ${checks}/${checks} PASS`);
}

main().catch(err=>{console.error('B6 BUYER PROCUREMENT GATE FAIL:',err.stack||err);process.exitCode=1;})
.finally(async()=>{
  try {
    const [[identity]] = await db.query('SELECT DATABASE() AS db_name');
    if(identity.db_name !== 'miljor_test_db') throw Error('Refusing cleanup: wrong DB');
    for (const id of ids) {
      // Only test-owned IDs created by this test invocation.
      await db.query('DELETE FROM procurement_request_mutations WHERE request_id=?',[id]);
      await db.query('DELETE FROM procurement_request_items WHERE request_id=?',[id]);
      await db.query('DELETE FROM procurement_requests WHERE id=?',[id]);
    }
  }catch(err){console.error('TEST FIXTURE CLEANUP FAILED:',err);process.exitCode=1;}
  await db.end();
});
