'use strict';
// Strictly isolated GitHub Actions ephemeral MySQL bootstrap for B7 integration.
// The MySQL service creates ONLY miljor_test_db and is discarded with the job.
// No production host, secrets, or business database connection allowed.
const fs=require('node:fs');
const path=require('node:path');
const mysql=require('mysql2/promise');
async function main(){
 const exact={B7_CI_EPHEMERAL_DB:'YES',GITHUB_ACTIONS:'true',NODE_ENV:'test',
  TEST_DB_NAME:'miljor_test_db',DB_NAME:'miljor_test_db',DB_HOST:'127.0.0.1',
  DB_USER:'b7_ci_test'};
 for(const [key,value] of Object.entries(exact)){
  if(process.env[key]!==value)throw Error('B7_EPHEMERAL_GUARD: '+key+' must equal '+value);
 }
 const conn=await mysql.createConnection({
  host:'127.0.0.1',user:'b7_ci_test',
  password:process.env.DB_PASSWORD,database:'miljor_test_db',
  multipleStatements:true
 });
 try{
  const [[identity]]=await conn.query('SELECT DATABASE() AS name');
  if(identity.name!=='miljor_test_db')throw Error('B7_WRONG_DATABASE');
  // The ephemeral test-only account cannot access/create protected databases.
  const [databases]=await conn.query('SHOW DATABASES');
  if(databases.some(x=>['miljor_db','miljor_sandbox_db'].includes(Object.values(x)[0])))
   throw Error('B7_PROTECTED_DATABASE_VISIBLE');
  const [existing]=await conn.query(
   "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()");
  if(existing.length)throw Error('B7_EPHEMERAL_DB_NOT_EMPTY');
  for(const name of ['schema.sql','seed.sql']){
   let sql=fs.readFileSync(path.resolve(__dirname,'../database',name),'utf8');
   // Both legacy SQL files hardcode USE miljor_db; never execute that command.
   sql=sql.replace(/^\s*USE\s+miljor_db\s*;\s*$/gim,'');
   if(/\bUSE\s+miljor_db\b/i.test(sql))
    throw Error('B7_PROTECTED_DATABASE_REFERENCE');
   if(/\bCREATE\s+DATABASE\b/i.test(sql)||/\bDROP\s+DATABASE\b/i.test(sql))
    throw Error('B7_SCHEMA_DATABASE_DDL_FORBIDDEN');
   await conn.query(sql);
   console.log('B7 ephemeral baseline '+name+' applied in miljor_test_db');
  }
 }finally{await conn.end()}
 // All migrations run only against same explicit ephemeral test schema.
 await require('../database/runMigrations').runMigrations('miljor_test_db');
 const verify=await mysql.createConnection({
  host:'127.0.0.1',user:'b7_ci_test',password:process.env.DB_PASSWORD,
  database:'miljor_test_db'
 });
 try{
  const [[db]]=await verify.query('SELECT DATABASE() AS name');
  if(db.name!=='miljor_test_db')throw Error('B7_WRONG_DATABASE_AFTER_MIGRATION');
  const [history]=await verify.query(
   "SELECT version,name FROM schema_migrations WHERE version IN ('046','047','048') ORDER BY version");
  const expected=['046_recurring_collective_cycles.sql','047_procurement_delivery_runs.sql','048_procurement_notification_outbox.sql'];
  if(history.length!==3||history.some((x,i)=>x.name!==expected[i]))
   throw Error('B7_MIGRATION_IDENTITY_MISMATCH: '+JSON.stringify(history));
  console.log('B7 ephemeral MySQL migration identity 046-048 VERIFIED. This does NOT resolve other branches.');
 }finally{await verify.end()}
}
main().catch(err=>{console.error('B7 EPHEMERAL BOOTSTRAP FAIL:',err.message);process.exitCode=1});
