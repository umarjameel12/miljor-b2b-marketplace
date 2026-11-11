'use strict';
// Historical finance order fixture: pre054 capture and post054 invariants.
// Strictly disposable MySQL. No historical commission backfill/inference.
const assert=require('node:assert/strict');
const mysql=require('mysql2/promise');
const crypto=require('node:crypto');
const {scanMigrations}=require('../database/migrationManifest');
async function main(){
  assert.equal(process.env.NODE_ENV,'test');
  assert.equal(process.env.MILJOR_TEST_ONLY_MIGRATIONS,'1');
  assert.equal(process.env.DB_NAME,'miljor_test_db');
  const stage=process.argv[2];
  assert.ok(['seed','verify'].includes(stage),'seed|verify required');
  const cn=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',
    user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',
    database:'miljor_test_db'});
  try{
    const [[db]]=await cn.execute('SELECT DATABASE() AS name');assert.equal(db.name,'miljor_test_db');
    const [v]=await cn.execute('SELECT version FROM schema_migrations WHERE version IN (?,?,?)',['052','053','054']);
    const versions=v.map(x=>String(x.version).padStart(3,'0'));
    assert.ok(versions.includes('053'),'Historical baseline must be installed to 053');
    if(stage==='seed'){
      assert.ok(!versions.includes('054'),'Never insert a fake historical order after 054');
      const [columns]=await cn.execute(
        "SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema='miljor_test_db' AND table_name='orders' AND column_name='supplier_commission_percent'");
      assert.equal(columns.length,0,'Pre054 schema must not contain commission');
      const [created]=await cn.execute(
        `INSERT INTO orders(order_code,buyer_id,supplier_id,total_qty,unit_price,
           subtotal_amount,delivery_fee,buyer_platform_fee,total_amount,currency,
           delivery_type,delivery_address,payment_status,order_status)
         VALUES('P0-HIST-054',5,2,10.0000,100.00,
                1000.00,120.00,25.00,1145.00,'PKR',
                'DOORSTEP','Historical synthetic Lahore address','AWAITING_PAYMENT','AWAITING_PAYMENT')`);
      assert.ok(created.insertId>0);
      const [[order]]=await cn.execute('SELECT * FROM orders WHERE id=?',[created.insertId]);
      const canonical={order_code:order.order_code,buyer_id:order.buyer_id,
        supplier_id:order.supplier_id,total_qty:String(order.total_qty),
        subtotal_amount:String(order.subtotal_amount),delivery_fee:String(order.delivery_fee),
        buyer_platform_fee:String(order.buyer_platform_fee),total_amount:String(order.total_amount),
        payment_status:order.payment_status,order_status:order.order_status};
      const h=crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
      await cn.execute(`CREATE TABLE IF NOT EXISTS p0_historical_order_fingerprint
        (order_id INT PRIMARY KEY,sha256 CHAR(64) NOT NULL)`);
      await cn.execute('INSERT INTO p0_historical_order_fingerprint(order_id,sha256) VALUES(?,?)',[created.insertId,h]);
      console.log('PASS pre054 immutable historical order fixture captured',JSON.stringify({order_id:created.insertId,sha256:h}));
    }else{
      assert.ok(versions.includes('054'),'054 must be applied via real guarded runner');
      const [[record]]=await cn.execute(
        `SELECT o.*,f.sha256
         FROM orders o JOIN p0_historical_order_fingerprint f ON o.id=f.order_id
         WHERE o.order_code='P0-HIST-054'`);
      assert.ok(record,'Historical order must survive migration');
      const canonical={order_code:record.order_code,buyer_id:record.buyer_id,
        supplier_id:record.supplier_id,total_qty:String(record.total_qty),
        subtotal_amount:String(record.subtotal_amount),delivery_fee:String(record.delivery_fee),
        buyer_platform_fee:String(record.buyer_platform_fee),total_amount:String(record.total_amount),
        payment_status:record.payment_status,order_status:record.order_status};
      const hash=crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
      assert.equal(hash,record.sha256,'Historical order mutated by migration 054');
      assert.equal(record.supplier_commission_percent,null,
        'Missing historical supplier agreement must remain NULL, not an invented fee');
      const [logs]=await cn.execute(
        "SELECT filename,sha256,status FROM schema_migration_attempts WHERE version='054'");
      const expected=scanMigrations().find(x=>x.version==='054');
      assert.equal(logs.length,1);
      assert.equal(logs[0].filename,expected.filename);
      assert.equal(logs[0].sha256,expected.sha256);
      assert.equal(logs[0].status,'APPLIED');
      console.log('PASS HISTORICAL 053→054 UPGRADE: order fingerprint preserved, NULL fee, exact migration checksum');
    }
  }finally{await cn.end();}
}
main().catch(e=>{console.error('FAIL HISTORICAL 054 UPGRADE',e.stack||e);process.exitCode=1});
