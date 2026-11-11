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
  console.log('PASS P0 browser fixtures seeded in disposable database; secrets not printed');
}
run().then(()=>process.exit(0)).catch(e=>{console.error('FAIL P0 browser fixture',e.message);process.exit(1)});
