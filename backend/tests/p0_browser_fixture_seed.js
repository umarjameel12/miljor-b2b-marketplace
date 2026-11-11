'use strict';
// Disposable browser integration fixture. NO remote or shared databases.
const assert=require('node:assert/strict');
const path=require('node:path');
require('dotenv').config({path:path.resolve(__dirname,'../.env')});
assert.equal(process.env.NODE_ENV,'test','NODE_ENV must be test');
assert.equal(process.env.DB_NAME,'miljor_test_db','Must use disposable MySQL database');
assert.equal(process.env.MILJOR_TEST_ONLY_MIGRATIONS,'1');
const bcrypt=require('bcryptjs');
const db=require('../src/config/db');
async function run(){
  const [[identity]]=await db.query('SELECT DATABASE() db');
  assert.equal(identity.db,'miljor_test_db');
  const password=process.env.P0_BROWSER_TEST_PASSWORD;
  assert.ok(password&&password.length>=16,'Disposable browser password is required');
  const hash=await bcrypt.hash(password,10);
  for(const [role,email,phone] of [
    ['BUYER','p0_buyer@miljor.test','+923190000001'],
    ['SUPPLIER','p0_supplier@miljor.test','+923190000002']
  ]){
    const [existing]=await db.query('SELECT id FROM users WHERE email=?',[email]);
    if(existing.length)throw Error('Fixture already exists; do not reuse unknown sessions');
    const [created]=await db.query(
      `INSERT INTO users(full_name,email,phone,password_hash,role,
       verification_status,is_verified,buyer_trust_status,city,area,address)
       VALUES (?,?,?,?,?,'VERIFIED',1,'CONTACT_VERIFIED','Lahore','Gulberg',
       'Gulberg, Lahore, Punjab, Pakistan')`,
      ['MilJor P0 '+role,email,phone,hash,role]);
    if(role==='SUPPLIER'){
      await db.query(`INSERT INTO supplier_profiles
        (supplier_id,business_type,verification_status,subscription_plan,
         subscription_status,max_active_listings,transaction_fee_percent)
         VALUES (?,'WHOLESALER','VERIFIED','STARTER','STARTER_ACTIVE',10,2.50)`,
        [created.insertId]);
    }
  }
  // One real DB-backed poolless B6-style procurement order for Chromium rendering.
  // Keep it UNPAID; this fixture must never impersonate provider-origin payment.
  const [buyerRows]=await db.query('SELECT id FROM users WHERE email=?',['p0_buyer@miljor.test']);
  const [supplierRows]=await db.query('SELECT id FROM users WHERE email=?',['p0_supplier@miljor.test']);
  assert.equal(buyerRows.length,1);
  assert.equal(supplierRows.length,1);
  const orderCode='P0-BROWSER-B6-ORDER';
  await db.query(`INSERT INTO orders
    (order_code,buyer_id,supplier_id,total_qty,unit_price,subtotal_amount,
     delivery_fee,buyer_platform_fee,total_amount,supplier_commission_percent,
     currency,delivery_type,delivery_address,payment_status,order_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,'PKR','DOORSTEP',?,'AWAITING_PAYMENT','AWAITING_PAYMENT')`,
    [orderCode,buyerRows[0].id,supplierRows[0].id,10,100,1000,120,25,1145,2.50,
     'Disposable Gulberg Lahore buyer address']);
  console.log('PASS P0 browser poolless order seeded UNPAID with exact PKR 1145.00');
  console.log('PASS P0 browser fixtures seeded in disposable database; secrets not printed');
}
run().then(()=>process.exit(0)).catch(e=>{console.error('FAIL P0 browser fixture',e.message);process.exit(1)});
