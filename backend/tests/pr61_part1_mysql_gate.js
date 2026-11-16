'use strict';
// Real isolated MySQL acceptance for PR61 supplier verification revision lifecycle.
// NEVER run against miljor_db or any production/sandbox database.
process.env.NODE_ENV='test';
const assert=require('node:assert/strict');
const db=require('../src/config/db');
const profileService=require('../src/services/supplierProfileService');
const admin=require('../src/controllers/adminController');
const jwt=require('jsonwebtoken');
const http=require('node:http');

const random=String(Date.now())+String(Math.floor(Math.random()*100000));
const resp=()=>({statusCode:200,status(v){this.statusCode=v;return this;},json(value){this.body=value;return this;}});
const failure=(status,response)=>assert.equal(response.statusCode,status,JSON.stringify(response.body));

async function main(){
 const [[dbRow]]=await db.query('SELECT DATABASE() AS name');
 assert.equal(dbRow.name,'miljor_test_db','Refusing to run outside isolated disposable MySQL');
 const [columns]=await db.query(
   "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='supplier_profiles' AND COLUMN_NAME='submitted_revision'");
 assert.equal(columns.length,1,'migration 098 must be installed');
 const email='part1_supplier_'+random+'@example.test',adminEmail='part1_admin_'+random+'@example.test';
 const [supplierInsert]=await db.query(
  "INSERT INTO users (full_name,business_name,email,phone,password_hash,role,verification_status,is_verified) VALUES (?,?,?,?,?,'SUPPLIER','UNVERIFIED',0)",
  ['Part1 Supplier','Part1 Wholesale',email,'+923001234567','isolated_dummy_hash']);
 const sid=supplierInsert.insertId;
 const [adminInsert]=await db.query(
  "INSERT INTO users (full_name,email,phone,password_hash,role,verification_status,is_verified) VALUES (?,?,?,?, 'SUPER_ADMIN','VERIFIED',1)",
  ['Part1 Admin',adminEmail,'+923001234568','isolated_dummy_hash']);
 const aid=adminInsert.insertId;
 const adminReq=(status,extra={})=>({params:{id:String(sid)},user:{id:aid,role:'SUPER_ADMIN'},
    body:{verification_status:status,...extra}});
 try{
   await profileService.updateProfile(sid,{
     business_name:'Part1 Wholesale', business_type:'Wholesale Commodity Distributor',
     contact_person_name:'Supplier Contact', contact_person_phone:'03001234567',
     warehouse_address:'Old Badami Bagh, Lahore Warehouse',
     lahore_service_area:'Lahore Badami Bagh',bank_name:'Standard Chartered Bank',
     bank_account_title:'Part1 Wholesale',bank_iban:'PK36SCBL0000001123456702'
   });
   const first=await profileService.submitVerification(sid);
   assert.equal(first.verification_status,'PENDING_REVIEW');
   assert.equal(first.submitted_revision,1);
   const again=await profileService.submitVerification(sid);
   assert.equal(again.alreadyPending,true);
   assert.equal(again.submitted_revision,1);
   const [stored]=await db.query('SELECT submitted_snapshot FROM supplier_verification_revisions WHERE supplier_id=?',[sid]);
   assert.equal(stored.length,1);
   const snapshot=typeof stored[0].submitted_snapshot==='string'?JSON.parse(stored[0].submitted_snapshot):stored[0].submitted_snapshot;
   assert.equal(Object.hasOwn(snapshot,'bank_iban'),false);
   assert.equal(Object.hasOwn(snapshot,'bank_iban_masked'),true);
   await assert.rejects(profileService.updateProfile(sid,{warehouse_address:'Unreviewed warehouse'}),e=>e.code==='VERIFICATION_PROFILE_LOCKED');
   console.log('PASS: first submission, exact revision, replay, masked immutable snapshot, locked pending edit');
   // Genuine Express authorization and owner-scoped API over this disposable database.
   const app=require('../server');
   const server=http.createServer(app);
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   try{
     const base='http://127.0.0.1:'+server.address().port;
     const issue=(id,email,role)=>jwt.sign({id,email,role,token_version:1},
       process.env.JWT_SECRET,{issuer:'miljor-api',audience:'miljor-app',expiresIn:'15m'});
     const supplierToken=issue(sid,email,'SUPPLIER'), adminToken=issue(aid,adminEmail,'SUPER_ADMIN');
     const call=async(path,token,opts={})=>{
       const response=await fetch(base+path,{method:opts.method||'GET',
         headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',
           ...(opts.headers||{})},body:opts.body?JSON.stringify(opts.body):undefined});
       return {status:response.status,body:await response.json()};
     };
     const own=await call('/api/v1/procurement/supplier/opportunities?type=all',supplierToken);
     assert.equal(own.status,200,JSON.stringify(own.body));
     assert.equal(own.body.data.items.length,0);
     const denied=await call('/api/v1/procurement/supplier/opportunities?type=all',adminToken);
     assert.equal(denied.status,403);
     const invalid=await call('/api/v1/procurement/supplier/opportunities?type=other',supplierToken);
     assert.equal(invalid.status,400);
     const correctionForbidden=await call('/api/v1/supplier/verification/corrections',adminToken,{
       method:'POST',headers:{'X-Idempotency-Key':'pr61_role_denied_12345'},
       body:{expected_revision:1,changes:{warehouse_address:'Unauthorized attempt'}}
     });
     assert.equal(correctionForbidden.status,403);
     console.log('PASS: genuine HTTP supplier opportunities, invalid filter and role-scoped correction denial');
   }finally{
     await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
   }


   const review=resp();
   await admin.verifySupplier(adminReq('MORE_INFORMATION_REQUIRED',{
     expected_revision:1,correction_fields:['warehouse_address'],
     correction_notes:{warehouse_address:'Please enter the correct warehouse street and dispatch details'},
     rejection_reason:'Please update warehouse address'
   }),review);
   failure(200,review);
   const [[reviewed]]=await db.query(
     'SELECT verification_status,submitted_revision,subscription_plan,max_active_listings,transaction_fee_percent,correction_fields FROM supplier_profiles WHERE supplier_id=?',[sid]);
   assert.equal(reviewed.verification_status,'MORE_INFORMATION_REQUIRED');
   assert.equal(reviewed.subscription_plan,'STARTER');
   assert.equal(Number(reviewed.submitted_revision),1);
   const otherField=await profileService.submitCorrections(sid,{
     expected_revision:1,changes:{bank_name:'Unrequested Bank'}
   },'correct_wrong_field_1234').then(()=>null,e=>e);
   assert.equal(otherField.code,'CORRECTION_FIELDS_MISMATCH');
   const stale=resp();
   await admin.verifySupplier(adminReq('VERIFIED',{expected_revision:1}),stale);
   failure(409,stale);
   console.log('PASS: field-only admin review; unrequested correction and premature approval denied');

   const correction=await profileService.submitCorrections(sid,{
     expected_revision:1,changes:{warehouse_address:'Corrected Warehouse, Street 9, Badami Bagh Lahore'}
   },'correct_warehouse_replay_1234');
   assert.equal(correction.submitted_revision,2);
   const replay=await profileService.submitCorrections(sid,{
     expected_revision:1,changes:{warehouse_address:'Corrected Warehouse, Street 9, Badami Bagh Lahore'}
   },'correct_warehouse_replay_1234');
   assert.equal(replay.alreadyPending,true);
   const [versions]=await db.query('SELECT revision,review_action FROM supplier_verification_revisions WHERE supplier_id=? ORDER BY revision',[sid]);
   assert.equal(versions.length,2);
   assert.equal(versions[0].review_action,'REQUEST_INFO');
   assert.equal(versions[1].review_action,'PENDING');
   const oldRev=resp();
   await admin.verifySupplier(adminReq('VERIFIED',{expected_revision:1}),oldRev);
   failure(409,oldRev);
   const approve=resp();
   await admin.verifySupplier(adminReq('VERIFIED',{expected_revision:2,verification_level:'LEVEL_2_BUSINESS'}),approve);
   failure(200,approve);
   const [[final]]=await db.query('SELECT verification_status,subscription_plan,max_active_listings,transaction_fee_percent FROM supplier_profiles WHERE supplier_id=?',[sid]);
   assert.equal(final.verification_status,'VERIFIED');
   assert.equal(final.subscription_plan,'STARTER');
   assert.equal(Number(final.max_active_listings),4);
   const [finalRows]=await db.query('SELECT review_action FROM supplier_verification_revisions WHERE supplier_id=? AND revision=2',[sid]);
   assert.equal(finalRows[0].review_action,'APPROVED');
   console.log('PASS: correction revision 2, replay, stale approval denial, verified approval without paid entitlements');
   console.log('PR61 PART1 REAL MYSQL ACCEPTANCE PASS');
 }finally{
   await db.query('DELETE FROM system_audit_logs WHERE entity_name=? AND entity_id=?',
     ['supplier_profiles',sid]);
   await db.query('DELETE FROM supplier_verification_revisions WHERE supplier_id=?',[sid]);
   await db.query('DELETE FROM supplier_profiles WHERE supplier_id=?',[sid]);
   await db.query('DELETE FROM users WHERE id IN (?,?)',[sid,aid]);
   if(typeof db.end==='function') await db.end();
 }
}
main().catch(error=>{console.error('PR61 REAL MYSQL FAIL',error);process.exitCode=1;});
