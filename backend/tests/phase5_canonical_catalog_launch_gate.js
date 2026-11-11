'use strict';
// Phase 5 read-only catalog acceptance gate. Runs only against miljor_test_db.
// Never executes SQL migrations, creates suppliers, or modifies historical rows.
const assert = require('node:assert/strict');
process.env.NODE_ENV='test';
process.env.TEST_DB_NAME='miljor_test_db';
const db = require('../src/config/db');
const expectedAdded=[
  'tea','salt','red-chilli','turmeric','coriander','cumin',
  'corn-starch','baking-powder','yeast','milk-powder','black-pepper','wheat-grain'
];
(async()=>{
  try {
    const [[identity]]=await db.query('SELECT DATABASE() AS db_name');
    assert.equal(identity.db_name,'miljor_test_db','Never run catalog gate outside test DB');
    const [families]=await db.query(`
      SELECT f.id,f.slug,f.name,f.category_id
      FROM catalog_product_families f
      JOIN catalog_categories c ON c.id=f.category_id
      WHERE f.is_active=1 AND f.approval_status='APPROVED'
        AND c.is_active=1 AND c.approval_status='APPROVED'
    `);
    assert.equal(families.length,25,'25 distinct approved active families required for launch');
    assert.equal(new Set(families.map(row=>row.id)).size,25,'Family IDs must be distinct');
    assert.equal(new Set(families.map(row=>row.slug)).size,25,'Family slugs must be distinct');
    for(const slug of expectedAdded){
      assert.ok(families.some(row=>row.slug===slug),`Missing family: ${slug}`);
    }
    const [categories]=await db.query(`
      SELECT COUNT(*) AS total FROM catalog_categories
      WHERE is_active=1 AND approval_status='APPROVED'
    `);
    assert.equal(Number(categories[0].total),8,'Expected 8 active canonical food categories');
    console.log('PASS: 25 active product families, including 12 launch expansion families; 8 active categories.');
  } finally {
    await db.end();
  }
})().catch(error=>{console.error('Phase 5 catalog gate failed:',error);process.exitCode=1});
