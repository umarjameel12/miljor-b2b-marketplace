'use strict';
// This gate requires no MySQL/network: safe for CI and production pre-deploy review.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {scanMigrations,checkAppliedHistory,EXPECTED_INTEGRATION}=require('../database/migrationManifest');
let passed=0;
const check=(fn,label)=>{fn();console.log('PASS',++passed,label);};
const fail=(fn,code)=>assert.throws(fn,e=>e?.code===code,`expected ${code}`);
const list=scanMigrations();
const m=new Map(list.map(i=>[i.version,i]));
check(()=>assert.equal(list.length,new Set(list.map(x=>x.version)).size),'Unique migration versions across entire canonical repository');
check(()=>{for(const [v,n] of Object.entries(EXPECTED_INTEGRATION))assert.equal(m.get(v)?.filename,n);},
  'B6 046-048 and UCP 051-053 are ordered and distinct');
const pinned=Object.freeze({
 '046':'7ec4e02088f50ff23e3df799bce0a75008b8a14f',
 '047':'d268776052e19cb7156d391c15de80f23de9f67f',
 '048':'e438a2efeb533d3270912974b5f323d389bc45fb',
 '051':'14d658207cfa8c25c1eef2e81c726e2a0efa51dd',
 '052':'78bc02c537912c19074ca0372a7a751c29222c5d',
 '053':'b411d28236bdc1adf85cf4d625af01bb10e68bab'
});
check(()=>{
 for(const [v,expected] of Object.entries(pinned)){
  const content=fs.readFileSync(path.join(__dirname,'../database/migrations',m.get(v).filename));
  const h=crypto.createHash('sha1').update('blob '+content.length+'\0').update(content).digest('hex');
  assert.equal(h,expected,'Canonical B6/UCP migration source drift at '+v);
 }
},'Pinned source blob SHA1 integrity of canonical migration SQL');
check(()=>assert.deepEqual(checkAppliedHistory(list,[]),{applied:0,planned:list.length}),'Fresh DB history is eligible');
check(()=>{
 const r=m.get('046'); const row={version:'046',name:r.filename};
 const journal={version:'046',filename:r.filename,sha256:r.sha256,status:'APPLIED'};
 assert.equal(checkAppliedHistory(list,[row],[journal]).applied,1);
},'Previously applied valid history + matching checksum is accepted');
check(()=>fail(()=>checkAppliedHistory(list,[{version:'046',name:'046_expand_canonical_product_families.sql'}]),
 'MIGRATION_RENUMBERED_HISTORY_REQUIRES_RECONCILIATION'),'Renumbered legacy UCP 046 blocks safely');
check(()=>fail(()=>checkAppliedHistory(list,[{version:'046',name:'046_wrong.sql'}]),
 'MIGRATION_HISTORY_FILENAME_MISMATCH'),'Applied migration renamed/colliding filename blocked');
check(()=>fail(()=>checkAppliedHistory(list,[{version:'999',name:'999_unknown.sql'}]),
 'MIGRATION_HISTORY_UNKNOWN'),'Unknown applied migration cannot be skipped');
check(()=>fail(()=>checkAppliedHistory(list,[],[{
 version:'046',filename:m.get('046').filename,sha256:m.get('046').sha256,status:'RUNNING'}]),
 'MIGRATION_RECOVERY_REQUIRED'),'Partially applied migration attempt must block');
check(()=>fail(()=>checkAppliedHistory(list,[{version:'046',name:m.get('046').filename}],[{
 version:'046',filename:m.get('046').filename,sha256:'bad',status:'APPLIED'}]),
 'MIGRATION_HISTORY_MISMATCH'),'SQL checksum drift blocked');
check(()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'miljor-migration-'));
 try{
  fs.writeFileSync(path.join(tmp,'046_a.sql'),'SELECT 1;');
  fs.writeFileSync(path.join(tmp,'046_b.sql'),'SELECT 2;');
  fail(()=>scanMigrations(tmp,{requireIntegrated:false}),'DUPLICATE_MIGRATION_VERSION');
 }finally{fs.rmSync(tmp,{recursive:true,force:true})}
},'Duplicate migration number blocked before database connection');
check(()=>{
 const runner=fs.readFileSync(path.join(__dirname,'../database/runMigrations.js'),'utf8');
 assert.ok(runner.indexOf('const manifest = scanMigrations()')<runner.indexOf('mysql.createConnection'));
 assert.ok(runner.indexOf('checkAppliedHistory(manifest,appliedRows,attemptRows)')<runner.indexOf('for(const item of manifest)'));
},'Migration runner checks file manifest before connection and all history before execution');
console.log('CANONICAL_MIGRATION_PREFLIGHT:',passed,'of',passed,'PASS (no database access)');
