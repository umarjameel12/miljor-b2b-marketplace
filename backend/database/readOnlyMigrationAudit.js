'use strict';
// Read-only migration-history audit, never a repair/apply operation.
// NO DDL, DML, advisory locks, temporary tables, or changes to any database.
// Usage: NODE_ENV=test DB_NAME=miljor_test_db MILJOR_TEST_ONLY_MIGRATIONS=1
//        node database/readOnlyMigrationAudit.js --test-only
const path=require('node:path');
require('dotenv').config({path:path.resolve(__dirname,'../.env')});
const {scanMigrations,checkAppliedHistory}=require('./migrationManifest');
const mysql=require('mysql2/promise');
function fail(code,message){throw Object.assign(new Error(message),{code});}
function assertTestTarget(argv=process.argv,env=process.env){
  if(!argv.includes('--test-only')||env.NODE_ENV!=='test'||
      env.MILJOR_TEST_ONLY_MIGRATIONS!=='1'||env.DB_NAME!=='miljor_test_db'||
      (env.TEST_DB_NAME&&env.TEST_DB_NAME!=='miljor_test_db'))
    fail('READ_ONLY_AUDIT_TEST_TARGET_REQUIRED',
      'Explicit --test-only, NODE_ENV=test, MILJOR_TEST_ONLY_MIGRATIONS=1, DB_NAME=miljor_test_db required');
}
async function audit({connect=mysql.createConnection,argv=process.argv,env=process.env}={}){
  assertTestTarget(argv,env);
  const manifest=scanMigrations(); // Pure no-DB verification FIRST.
  const connection=await connect({
    host:env.DB_HOST||'127.0.0.1',port:Number(env.DB_PORT)||3306,
    user:env.DB_USER||'root',password:env.DB_PASSWORD||'',
    database:'miljor_test_db',multipleStatements:false
  });
  try{
    // Only information_schema and migration audit SELECTs, no schema creation.
    const [existing]=await connection.execute(
      "SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_name IN ('schema_migrations','schema_migration_attempts')",
      ['miljor_test_db']
    );
    const names=new Set(existing.map(x=>String(x.TABLE_NAME||x.table_name)));
    if(names.size===0){
      return {status:'EMPTY_HISTORY',database:'miljor_test_db',planned:manifest.length,
        note:'No migration ledger yet; dry preflight only, no migrations applied.'};
    }
    if(!names.has('schema_migrations')||!names.has('schema_migration_attempts'))
      fail('INCOMPLETE_MIGRATION_JOURNAL','Ledger or attempt journal missing. Audit required before applying migrations.');
    const [rows]=await connection.execute('SELECT version,name FROM schema_migrations');
    const [attempts]=await connection.execute('SELECT version,filename,sha256,status FROM schema_migration_attempts');
    const checked=checkAppliedHistory(manifest,rows,attempts);
    if(rows.length>0&&attempts.length!==rows.length)
      fail('UNVERIFIED_MIGRATION_LEDGER','Every applied migration requires an exact, matching checksum journal.');
    return {status:'VERIFIED_HISTORY',database:'miljor_test_db',...checked,
      note:'Read-only manifest and journal integrity checked. No schema changes performed.'};
  }finally{await connection.end()}
}
if(require.main===module){
  audit().then(data=>console.log('MIGRATION_READ_ONLY_AUDIT_PASS',JSON.stringify(data)))
    .catch(error=>{
      console.error('MIGRATION_READ_ONLY_AUDIT_BLOCKED',
        error.code||'ERROR',String(error.message||error).slice(0,350));
      process.exitCode=1;
    });
}
module.exports={audit,assertTestTarget};
