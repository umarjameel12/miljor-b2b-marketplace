'use strict';
// Restore only into an EMPTY database on a distinct, disposable local instance.
// Original instance is SELECT/CHECKSUM-only. Never drop/reset any database.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const mysql=require('mysql2/promise');
async function main(){
  assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.TEST_DB_NAME,'miljor_test_db');
  const port=Number(process.env.UCP_RESTORE_PORT);
  assert.ok(Number.isInteger(port)&&port>3306&&port<=65535,'Distinct explicit disposable port required');
  const backup=fs.realpathSync(process.env.UCP_TEST_BACKUP||'');
  const root=fs.realpathSync(path.resolve(__dirname,'../database/backups'))+path.sep;
  assert.ok(backup.toLowerCase().startsWith(root.toLowerCase()),'Backup must be a local recorded test backup');
  const bytes=fs.readFileSync(backup),sha=crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha,process.env.UCP_TEST_BACKUP_SHA256,'Backup must match the recorded preflight hash');
  const sql=bytes.toString('utf8');
  assert.ok(!/(?:^|\n)\s*(?:USE\s+|(?:CREATE|DROP|ALTER)\s+DATABASE\s+)/i.test(sql),'Database switching DDL is forbidden in test backup');
  const config=require('dotenv').parse(fs.readFileSync(process.env.UCP_ORIGINAL_DB_CONFIG));
  const original=await mysql.createConnection({host:config.DB_HOST||'localhost',port:3306,user:config.DB_USER||'root',password:config.DB_PASSWORD||'',database:'miljor_test_db'});
  const restored=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});
  try{
    const [[sourceIdentity]]=await original.query('SELECT @@server_uuid AS id');
    const [[targetIdentity]]=await restored.query('SELECT @@server_uuid AS id,@@port AS port');
    assert.notEqual(sourceIdentity.id,targetIdentity.id);assert.equal(targetIdentity.port,port);
    const [[existing]]=await restored.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='miljor_test_db'");
    assert.equal(existing.n,0,'Restore refuses a nonempty target; no existing records may be replaced');
    await restored.query('CREATE DATABASE IF NOT EXISTS miljor_test_db');
    const fd=fs.openSync(backup,'r');let result;
    try{result=spawnSync('mysql',['--host=127.0.0.1','--port='+port,'--user=root','--database=miljor_test_db'],
      {stdio:[fd,'pipe','pipe'],timeout:60000});}finally{fs.closeSync(fd);}
    assert.equal(result.status,0,'Restore command failed; original server remains read-only');
    const [tables]=await restored.query("SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema='miljor_test_db' AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
    const definitions=(sql.match(/CREATE TABLE /g)||[]).length;
    assert.equal(tables.length,definitions,'Every dumped base table was restored');
    let matching=0;
    for(const {name} of tables){
      assert.match(name,/^[a-z0-9_]+$/i);
      const [[before]]=await original.query('CHECKSUM TABLE `miljor_test_db`.`'+name+'` EXTENDED');
      const [[after]]=await restored.query('CHECKSUM TABLE `miljor_test_db`.`'+name+'` EXTENDED');
      if(before.Checksum===after.Checksum&&after.Checksum!==null)matching++;
    }
    const evidence={database:'miljor_test_db',originalPort:3306,restorePort:port,distinctServer:true,
      backupSha256:sha,restoredTables:tables.length,matchingCurrentSourceTables:matching,
      result:matching===tables.length?'PASS':'RESTORED_SOURCE_CHANGED_SINCE_BACKUP'};
    fs.mkdirSync(path.resolve(__dirname,'../docs/evidence'),{recursive:true});
    fs.writeFileSync(path.resolve(__dirname,'../docs/evidence/ucp-backup-restore-2026-11-16.json'),JSON.stringify(evidence,null,2));
    console.log('UCP_TEST_BACKUP_RESTORE',JSON.stringify(evidence));
    assert.equal(matching,tables.length,'Restored backup differs from the current mutable test source; investigate without overwriting either');
  }finally{await original.end();await restored.end();}
}
main().catch(error=>{console.error('UCP_TEST_BACKUP_RESTORE_BLOCKED',error.code||'ASSERTION',error.message);process.exitCode=1;});
