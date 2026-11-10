'use strict';
// B5 read-only DB schema preflight. NOT the B5 runtime acceptance suite.
// This gate deliberately mutates no rows and never runs against miljor_db.
process.env.NODE_ENV = 'test';
process.env.TEST_DB_NAME = 'miljor_test_db';

const assert = require('node:assert/strict');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../src/config/db');

async function main() {
  const [identity] = await db.query('SELECT DATABASE() AS name');
  assert.equal(identity[0]?.name, 'miljor_test_db', 'FAIL CLOSED: wrong database');
  console.log('PASS 01 database identity = miljor_test_db');

  const required = {
    flash_pools: [
      'id','supplier_id','supplier_sku_id','supplier_listing_id','product_spec_id',
      'total_stock','remaining_stock','held_stock','committed_stock','selling_mode',
      'discounted_unit_price','original_unit_price','min_quantity','max_quantity_per_buyer',
      'purchase_increment','expiry_time','published_at','configured_duration_minutes',
      'snapshot_json','status','version_number'
    ],
    flash_purchase_holds: [
      'id','flash_pool_id','buyer_id','quantity','locked_unit_price','status',
      'expires_at','order_id','idempotency_key'
    ],
    supplier_inventory_allocations: [
      'supplier_listing_id','allocation_type','reference_id','allocated_qty','unit','status'
    ],
    supplier_listings: [
      'id','supplier_id','product_spec_id','available_stock','pricing_unit','base_unit_price','status'
    ],
    orders: ['id','buyer_id','supplier_id','total_amount','currency','order_status','payment_status'],
    payments: ['id','order_id','amount','status'],
    payment_attempts: ['id','order_id','provider_tracker_token'],
    product_specifications: ['id','supplier_sku_id','purchasing_unit','lifecycle_status','approval_status']
  };
  let count = 1;
  for (const [table, columns] of Object.entries(required)) {
    const [rows] = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]
    );
    const found = new Set(rows.map(x => x.COLUMN_NAME));
    const missing = columns.filter(x => !found.has(x));
    assert.deepEqual(missing, [], `Missing B5 integration columns in ${table}`);
    console.log(`PASS ${String(++count).padStart(2,'0')} ${table} schema (${columns.length} required columns)`);
  }

  const [engines] = await db.query(
    `SELECT TABLE_NAME, ENGINE FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('flash_pools','flash_purchase_holds','supplier_inventory_allocations','orders')`
  );
  assert.equal(engines.length, 4);
  assert.ok(engines.every(x => String(x.ENGINE).toUpperCase() === 'INNODB'),
    'B5 transaction tables must all be InnoDB');
  console.log(`PASS ${String(++count).padStart(2,'0')} transactional InnoDB tables`);

  const [indexes] = await db.query(
    `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flash_purchase_holds'
     GROUP BY INDEX_NAME`
  );
  assert.ok(indexes.some(x => x.INDEX_NAME === 'uq_flash_hold_idem' &&
    x.cols === 'buyer_id,idempotency_key'), 'Idempotent hold key index required');
  assert.ok(indexes.some(x => x.INDEX_NAME === 'uq_flash_hold_order' &&
    x.cols === 'order_id'), 'One hold per order index required');
  console.log(`PASS ${String(++count).padStart(2,'0')} durable idempotency indexes`);

  const [modes] = await db.query(
    `SELECT COLUMN_TYPE AS type FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flash_pools' AND COLUMN_NAME='selling_mode'`
  );
  assert.ok(modes[0]?.type.includes('MULTI_BUYER') &&
    modes[0]?.type.includes('WHOLE_LOT'), 'Selling mode enum incomplete');
  console.log(`PASS ${String(++count).padStart(2,'0')} explicit selling modes`);

  const [holds] = await db.query(
    `SELECT COUNT(*) AS violations FROM flash_pools
     WHERE total_stock < 0 OR remaining_stock < 0 OR held_stock < 0 OR committed_stock < 0
       OR remaining_stock + held_stock + committed_stock > total_stock`
  );
  assert.equal(Number(holds[0].violations), 0, 'Existing Flash stock violates conservation cap');
  console.log(`PASS ${String(++count).padStart(2,'0')} existing Flash stock conservation upper bound`);

  console.log('\nB5 READ-ONLY PREFLIGHT PASS. Full lifecycle, payment, B4 regression and UI tests are STILL REQUIRED.');
}

main().catch(e => { console.error('B5 PREFLIGHT FAIL:', e.stack || e); process.exitCode=1; })
  .finally(async () => { if (typeof db.end === 'function') await db.end(); });
