'use strict';
// READ-ONLY installed finance migration acceptance. No production or historical mutation.
const assert=require('node:assert/strict');
const path=require('node:path');
require('dotenv').config({path:path.join(__dirname,'../.env')});
const mysql=require('mysql2/promise');
const {scanMigrations,checkAppliedHistory}=require('../database/migrationManifest');
async function main(){
  assert.equal(process.env.NODE_ENV,'test','NODE_ENV=test required');
  assert.equal(process.env.MILJOR_TEST_ONLY_MIGRATIONS,'1','Test-only guard required');
  assert.equal(process.env.DB_NAME,'miljor_test_db','Protected databases not allowed');
  const manifest=scanMigrations();
  const expected=manifest.find(x=>x.version==='054');
  assert.equal(expected?.filename,'054_order_supplier_commission_snapshot.sql');
  const conn=await mysql.createConnection({
    host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT)||3306,
    user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',
    database:'miljor_test_db',multipleStatements:false
  });
  try{
    const [[identity]]=await conn.execute('SELECT DATABASE() AS name');
    assert.equal(identity.name,'miljor_test_db');
    const [history]=await conn.execute('SELECT version,name FROM schema_migrations');
    const [attempts]=await conn.execute('SELECT version,filename,sha256,status FROM schema_migration_attempts');
    checkAppliedHistory(manifest,history,attempts);
    assert.ok(history.some(x=>String(x.version).padStart(3,'0')==='054'&&x.name===expected.filename));
    assert.ok(attempts.some(x=>String(x.version).padStart(3,'0')==='054'&&x.sha256===expected.sha256&&x.status==='APPLIED'));
    assert.ok(!history.some(x=>['049_regular_pool_payment_hold_deadlines.sql',
      '050_expand_canonical_product_families.sql','051_demand_requester_role.sql',
      '052_order_supplier_commission_snapshot.sql'].includes(x.name)),
      'Abandoned finance aliases must not be applied');
    const [columns]=await conn.execute(
      `SELECT COLUMN_NAME,DATA_TYPE,NUMERIC_PRECISION,NUMERIC_SCALE,IS_NULLABLE
       FROM information_schema.columns
       WHERE table_schema='miljor_test_db' AND table_name='orders'
         AND column_name='supplier_commission_percent'`);
    assert.equal(columns.length,1);
    assert.equal(columns[0].DATA_TYPE.toLowerCase(),'decimal');
    assert.equal(Number(columns[0].NUMERIC_PRECISION),5);
    assert.equal(Number(columns[0].NUMERIC_SCALE),2);
    assert.equal(columns[0].IS_NULLABLE,'YES');
    const [[orders]]=await conn.execute(
      `SELECT COUNT(*) AS total_orders,
              SUM(CASE WHEN supplier_commission_percent IS NULL THEN 1 ELSE 0 END) AS historical_nulls
       FROM orders`);
    console.log('PASS finance 054 installed checksum/schema/read-only history',
      JSON.stringify({database:identity.name,total_orders:Number(orders.total_orders),
        unverified_historical_commission:Number(orders.historical_nulls||0),
        note:'Historical snapshot correctness cannot be inferred from NULL counts; upgrade needs before/after fixture comparison.'}));
  }finally{await conn.end();}
}
main().catch(e=>{console.error('FAIL finance 054 acceptance',e.message);process.exitCode=1});
