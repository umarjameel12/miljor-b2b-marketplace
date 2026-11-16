'use strict';
process.env.NODE_ENV='test';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const db=require('../src/config/db');
const evidence=require('../src/services/supplierVerificationDocumentService');
const profiles=require('../src/services/supplierProfileService');
const admin=require('../src/controllers/adminController');
const fail=async(fn,code)=>assert.rejects(fn,e=>e.code===code);
const response=()=>({statusCode:200,status(v){this.statusCode=v;return this},json(x){this.body=x;return this}});
async function main(){
 const [[identity]]=await db.query('SELECT DATABASE() AS name');
 assert.equal(identity.name,'miljor_test_db','PROTECTED DATABASE ABORT');
 const random=crypto.randomUUID().slice(0,12);
 const [created]=await db.query(
   "INSERT INTO users(full_name,business_name,email,phone,password_hash,role,verification_status,is_verified) VALUES (?,?,?,?,?,'SUPPLIER','UNVERIFIED',0)",
   ['Part1 Evidence','Evidence Seller','p1e_'+random+'@example.test','+923001234569','test-only-hash']);
 const sid=created.insertId;
 const [adminCreated]=await db.query(
   "INSERT INTO users(full_name,email,phone,password_hash,role,verification_status,is_verified) VALUES (?,?,?,?, 'SUPER_ADMIN','VERIFIED',1)",
   ['Part1 Admin','p1ea_'+random+'@example.test','+923001234570','test-only-hash']);
 const aid=adminCreated.insertId;
 const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
 const payload=(base64,kind='BUSINESS_LICENSE')=>({
   kind,filename:'business-proof.pdf',mime_type:'application/pdf',base64
 });
 const bytes=pdf.toString('base64');
 try{
   await db.query("INSERT INTO supplier_profiles(supplier_id,verification_status) VALUES (?,'NOT_SUBMITTED')",[sid]);
   await fail(()=>evidence.upload(sid,payload(Buffer.from('<script>bad</script>').toString('base64')),'p1-invalid-magic-123'),'DOCUMENT_TYPE_MISMATCH');
   await fail(()=>evidence.upload(sid,{...payload(bytes),mime_type:'text/html'},'p1-invalid-type-123'),'DOCUMENT_TYPE_MISMATCH');
   await fail(()=>evidence.upload(sid,payload(Buffer.alloc(1048577).toString('base64')),'p1-oversized-12345'),'INVALID_DOCUMENT_ENCODING');
   const first=await evidence.upload(sid,payload(bytes),'p1-evidence-first-123');
   assert.equal(first.version,1);
   const repeat=await evidence.upload(sid,payload(bytes),'p1-evidence-first-123');
   assert.equal(repeat.is_replay,true);
   await fail(()=>evidence.upload(sid,payload(Buffer.from('%PDF-updated\n%%EOF').toString('base64')),'p1-evidence-first-123'),'IDEMPOTENCY_CONFLICT');
   const second=await evidence.upload(sid,payload(Buffer.from('%PDF-1.5\nsecond version\n%%EOF').toString('base64')),'p1-evidence-second-123');
   assert.equal(second.version,2);
   assert.deepEqual((await evidence.download(sid,first.id)).bytes,pdf);
   await fail(()=>evidence.download(aid,first.id),'DOCUMENT_NOT_FOUND');
   console.log('PASS: magic bytes, size, replay conflicts, immutable versions, owner-scoped download');
   await profiles.updateProfile(sid,{
     business_name:'Evidence Seller',business_type:'Wholesale Commodity Distributor',
     contact_person_name:'Evidence Contact',contact_person_phone:'03001234567',
     warehouse_address:'Warehouse, Badami Bagh Lahore',
     lahore_service_area:'Badami Bagh Lahore',bank_name:'Standard Chartered Bank',
     bank_account_title:'Evidence Seller',bank_iban:'PK36SCBL0000001123456702'
   });
   const submission=await profiles.submitVerification(sid);
   assert.equal(submission.submitted_revision,1);
   const [rows]=await db.query('SELECT submitted_snapshot FROM supplier_verification_revisions WHERE supplier_id=? AND revision=1',[sid]);
   const snap=typeof rows[0].submitted_snapshot==='string'?JSON.parse(rows[0].submitted_snapshot):rows[0].submitted_snapshot;
   assert.equal(snap.documents.find(d=>d.kind==='BUSINESS_LICENSE').id,second.id);
   assert.equal(Object.hasOwn(snap,'bank_iban'),false);
   await fail(()=>evidence.upload(sid,payload(bytes),'p1-locked-doc-1234'),'DOCUMENT_UPLOAD_LOCKED');
   const decision=response();
   await admin.verifySupplier({params:{id:String(sid)},user:{id:aid,role:'SUPER_ADMIN'},body:{
     verification_status:'MORE_INFORMATION_REQUIRED',expected_revision:1,
     correction_fields:['document:BUSINESS_LICENSE'],
     correction_notes:{'document:BUSINESS_LICENSE':'Replace unreadable business license'},
     rejection_reason:'Replace business license'}},decision);
   assert.equal(decision.statusCode,200,JSON.stringify(decision.body));
   await fail(()=>profiles.submitCorrections(sid,{expected_revision:1,changes:{}},'p1-missing-doc-key12'),'DOCUMENT_CORRECTION_REQUIRED');
   await fail(()=>evidence.upload(sid,payload(bytes,'BANK_PROOF'),'p1-wrong-kind-doc12'),'DOCUMENT_UPLOAD_LOCKED');
   const corrected=await evidence.upload(sid,payload(Buffer.from('%PDF-1.6\nreplacement\n%%EOF').toString('base64')),'p1-evidence-correct-123');
   assert.equal(corrected.version,3);assert.equal(corrected.review_revision,1);
   const resubmit=await profiles.submitCorrections(sid,{expected_revision:1,changes:{}},'p1-resubmit-doc-only-123');
   assert.equal(resubmit.submitted_revision,2);
   const [revisions]=await db.query('SELECT revision,submitted_snapshot,review_action FROM supplier_verification_revisions WHERE supplier_id=? ORDER BY revision',[sid]);
   assert.equal(revisions.length,2);
   const old=typeof revisions[0].submitted_snapshot==='string'?JSON.parse(revisions[0].submitted_snapshot):revisions[0].submitted_snapshot;
   const next=typeof revisions[1].submitted_snapshot==='string'?JSON.parse(revisions[1].submitted_snapshot):revisions[1].submitted_snapshot;
   assert.equal(old.documents[0].id,second.id);
   assert.equal(next.documents[0].id,corrected.id);
   assert.equal(revisions[0].review_action,'REQUEST_INFO');
   await fail(()=>evidence.upload(sid,payload(bytes),'p1-locked-again-123'),'DOCUMENT_UPLOAD_LOCKED');
   const approve=response();
   await admin.verifySupplier({params:{id:String(sid)},user:{id:aid,role:'SUPER_ADMIN'},body:{
     verification_status:'VERIFIED',expected_revision:2}},approve);
   assert.equal(approve.statusCode,200,JSON.stringify(approve.body));
   console.log('PASS: review-anchored document correction, preserved old versions, and final approval');
   console.log('PR61 DOCUMENT VERSIONING REAL MYSQL PASS');
 }finally{
   await db.query("DELETE FROM system_audit_logs WHERE actor_id=? AND actor_role='SUPPLIER' AND action='SUPPLIER_EVIDENCE_VERSION_ADDED'",[sid]);
   await db.query("DELETE FROM system_audit_logs WHERE entity_name='supplier_profiles' AND entity_id=?",[sid]);
   await db.query('DELETE FROM supplier_verification_documents WHERE supplier_id=?',[sid]);
   await db.query('DELETE FROM supplier_verification_revisions WHERE supplier_id=?',[sid]);
   await db.query('DELETE FROM supplier_profiles WHERE supplier_id=?',[sid]);
   await db.query('DELETE FROM users WHERE id IN (?,?)',[sid,aid]);
   await db.end();
 }
}
main().catch(e=>{console.error('PR61 DOCUMENT REAL MYSQL FAIL',e.stack||e);process.exitCode=1;});
