'use strict';
// Read-only original/protected SQL. The restored backup is queried read-only too.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),mysql=require('mysql2/promise');
async function main(){
 assert.equal(process.env.NODE_ENV,'test');
 const config=require('dotenv').parse(fs.readFileSync(process.env.UCP_ORIGINAL_DB_CONFIG));
 const original=await mysql.createConnection({host:config.DB_HOST||'localhost',port:3306,user:config.DB_USER||'root',password:config.DB_PASSWORD||''});
 const restore=await mysql.createConnection({host:'127.0.0.1',port:33318,user:'root',database:'miljor_test_db'});
 const expected={users:3366696221,pools:2265355547,reservations:0,orders:0,payments:0,platform_ledger:0};
 const evidence={timestamp:new Date().toISOString(),protectedDatabase:'miljor_db',originalPort:3306,restoredPort:33318,baseline:expected,checksums:{},restoredCommercialTables:{},protectedDifferences:[],restoredDifferences:[],result:'PASS'};
 try{
  for(const [table,value] of Object.entries(expected)){
   const [[protectedRow]]=await original.query('CHECKSUM TABLE miljor_db.`'+table+'` EXTENDED');
   evidence.checksums[table]=protectedRow.Checksum;
   if(protectedRow.Checksum!==value)evidence.protectedDifferences.push(table);
   const [[source]]=await original.query('CHECKSUM TABLE miljor_test_db.`'+table+'` EXTENDED');
   const [[restored]]=await restore.query('CHECKSUM TABLE miljor_test_db.`'+table+'` EXTENDED');
   evidence.restoredCommercialTables[table]={originalTest:source.Checksum,restoredAfterUpgrade:restored.Checksum};
   if(source.Checksum!==restored.Checksum)evidence.restoredDifferences.push(table);
  }
  const [[history]]=await restore.query('SELECT COUNT(*) n FROM schema_migrations');evidence.restoredAppliedMigrations=history.n;assert.equal(history.n,62);
  assert.equal(evidence.protectedDifferences.length,0,'Protected data differs from the earlier baseline; attribution undetermined: '+evidence.protectedDifferences.join(','));
  assert.equal(evidence.restoredDifferences.length,0,'Original mutable test source differs from restored backup: '+evidence.restoredDifferences.join(','));
 }catch(error){evidence.result='FAIL';throw error;}
 finally{fs.writeFileSync(path.resolve(__dirname,'../docs/evidence/ucp-protected-upgrade-2026-11-16.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));await original.end();await restore.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
