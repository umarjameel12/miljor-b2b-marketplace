'use strict';
// Executable no-DB reconciliation gate: no mysql services, no Safepay credentials.
// This source/preflight test must NOT be mistaken for end-to-end acceptance.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {scanMigrations}=require('../database/migrationManifest');
const {checkFinanceCompatibility,CANONICAL,FINANCE_ALTERNATE}=require('../database/financeCompatibilityGate');
const {audit,assertTestTarget}=require('../database/readOnlyMigrationAudit');
const root=path.resolve(__dirname,'..');
let passed=0;
function check(condition,message){assert.ok(condition,message);console.log('PASS',++passed,message);}
function fakeConnection(tables,rows=[],attempts=[]){
  const statements=[];
  const conn={
    execute:async(sql,args)=>{
      statements.push(sql);
      if(/information_schema\.tables/i.test(sql))
        return [tables.map(name=>({TABLE_NAME:name}))];
      if(sql.includes('FROM schema_migration_attempts'))return [attempts];
      if(sql.includes('FROM schema_migrations'))return [rows];
      throw Error('Unexpected query '+sql);
    },
    end:async()=>{}
  };
  return {conn,statements};
}
const testEnv={NODE_ENV:'test',DB_NAME:'miljor_test_db',
  TEST_DB_NAME:'miljor_test_db',MILJOR_TEST_ONLY_MIGRATIONS:'1'};
async function main(){
  const manifest=scanMigrations();
  const result=checkFinanceCompatibility();
  check(result.compatibility==='FINANCE_INTEGRATION_BLOCKED','Canonical sequence passes but finance release remains BLOCKED');
  check(['046','047','048','051','052','053'].every(v=>
    manifest.some(x=>x.version===v&&x.filename===CANONICAL[v])),
    'B6 and UCP migration owners are collision-free');
  for(const [v,alias] of Object.entries(FINANCE_ALTERNATE)){
    check(!manifest.some(x=>x.filename===alias),
      'Conflicting finance alias rejected from release manifest: '+v);
  }
  assert.throws(()=>assertTestTarget(['node','audit','--test-only'],
    {...testEnv,DB_NAME:'miljor_db'}),/miljor_test_db/);
  check(true,'Protected live database name rejected before connection');
  let opened=false;
  await assert.rejects(
    audit({env:{...testEnv,DB_NAME:'miljor_sandbox_db'},
      argv:['node','audit','--test-only'],
      connect:async()=>{opened=true;throw Error('SHOULD_NOT_CONNECT')}}),
    /miljor_test_db/
  );
  check(!opened,'Rejected protected target has zero DB connection attempts');
  const empty=fakeConnection([]);
  const emptyResult=await audit({env:testEnv,argv:['node','audit','--test-only'],
    connect:async()=>empty.conn});
  check(emptyResult.status==='EMPTY_HISTORY','Empty disposable database passes no-DDL preflight');
  check(empty.statements.every(s=>/^SELECT /i.test(s.trim())),
    'Preflight sends ONLY SELECT statements');
  const single=manifest.find(x=>x.version==='046');
  const journal=fakeConnection(['schema_migrations','schema_migration_attempts'],
    [{version:single.version,name:single.filename}],
    [{version:single.version,filename:single.filename,sha256:single.sha256,status:'APPLIED'}]);
  const validated=await audit({env:testEnv,argv:['node','audit','--test-only'],
    connect:async()=>journal.conn});
  check(validated.status==='VERIFIED_HISTORY'&&validated.applied===1,
    'Applied history and checksum journal verified without DML');
  const missing=fakeConnection(['schema_migrations'],
    [{version:single.version,name:single.filename}]);
  await assert.rejects(audit({env:testEnv,argv:['node','audit','--test-only'],
    connect:async()=>missing.conn}),/journal missing/i);
  check(true,'Incomplete journal fails closed');
  const corrupted=fakeConnection(['schema_migrations','schema_migration_attempts'],
    [{version:single.version,name:single.filename}],
    [{version:single.version,filename:single.filename,sha256:'0'.repeat(64),status:'APPLIED'}]);
  await assert.rejects(audit({env:testEnv,argv:['node','audit','--test-only'],
    connect:async()=>corrupted.conn}),/MIGRATION_HISTORY_MISMATCH/);
  check(true,'Tampered checksum fails closed');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'miljor-finance-preflight-'));
  try{
    for(const name of Object.values(CANONICAL))
      fs.copyFileSync(path.join(root,'database/migrations',name),path.join(tmp,name));
    fs.writeFileSync(path.join(tmp,FINANCE_ALTERNATE['049']),'-- collision only\nSELECT 1;\n');
    assert.throws(()=>checkFinanceCompatibility(tmp),/FINANCE_MIGRATION_VERSION_COLLISION/);
    check(true,'Competing finance 049 layout actively rejected');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  console.log('UCP_THISCHAT_RECONCILIATION_SOURCE_PASS',passed,
    'No-DB tests completed. Real MySQL/Safepay/browser release acceptance remains separate.');
}
if(require.main===module)
  main().catch(e=>{console.error('UCP_THISCHAT_RECONCILIATION_SOURCE_FAILED',e.message);process.exitCode=1});
module.exports={main};
