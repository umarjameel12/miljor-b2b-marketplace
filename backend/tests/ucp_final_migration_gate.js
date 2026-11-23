'use strict';
// Read-only proof for final migration names. Never edits an old journal.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),mysql=require('mysql2/promise');
assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.TEST_DB_NAME,'miljor_test_db');
async function main(){
 const connections=[];
 const connect=async port=>{const c=await mysql.createConnection({host:'127.0.0.1',port,user:'root',database:'miljor_test_db'});connections.push(c);const [[identity]]=await c.query('SELECT @@port port,DATABASE() db');assert.equal(identity.port,port);assert.equal(identity.db,'miljor_test_db');return c;};
 const evidence={timestamp:new Date().toISOString(),runtimePort:33319,finalFreshPort:33321,finalUpgradePort:33320,result:'PASS'};
 try{
  const runtime=await connect(33319),fresh=await connect(33321),upgrade=await connect(33320);
  const snapshot=async c=>{const [tables]=await c.query('SHOW TABLES');const result={};for(const row of tables){const name=Object.values(row)[0];assert.match(name,/^[a-z0-9_]+$/i);const [[ddl]]=await c.query('SHOW CREATE TABLE `'+name+'`');result[name]=Object.values(ddl)[1].replace(/ AUTO_INCREMENT=\d+/g,'');}return result;};
  const before=await snapshot(runtime),after=await snapshot(fresh);
  assert.deepEqual(after,before,'Final fresh schema must match the schema used by the 13-group runtime gate');
  evidence.equivalentBusinessTables=Object.keys(after).length;
  evidence.schemaSha256=crypto.createHash('sha256').update(JSON.stringify(after)).digest('hex');
  for(const [label,c] of [['fresh',fresh],['upgrade',upgrade]]){
   const [history]=await c.query('SELECT version,name FROM schema_migrations ORDER BY version');assert.equal(history.length,62);
   const last=history.slice(-3);assert.deepEqual(last.map(row=>row.name),['096_ucp_recovery_cursor.sql','097_ucp_notification_controls.sql','098_ucp_notification_event_types.sql']);evidence[label+'FinalHistory']=last;
  }
  const prior=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../docs/evidence/ucp-protected-upgrade-2026-11-16.json')));
  evidence.restoredCommercialChecksums={};
  for(const [name,previous] of Object.entries(prior.restoredCommercialTables)){
   const [[row]]=await upgrade.query('CHECKSUM TABLE `'+name+'` EXTENDED');
   assert.equal(row.Checksum,previous.restoredAfterUpgrade,'Final filename reconciliation must preserve backed-up commercial rows');evidence.restoredCommercialChecksums[name]=row.Checksum;
  }
 }catch(error){evidence.result='FAIL';evidence.code=error.code||'ASSERTION';throw error;}
 finally{fs.writeFileSync(path.resolve(__dirname,'../docs/evidence/ucp-final-migrations-2026-11-16.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));for(const c of connections)await c.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
