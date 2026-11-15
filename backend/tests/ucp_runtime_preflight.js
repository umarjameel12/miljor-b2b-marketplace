'use strict';
// Read-only audit + test-only backup. No DDL/DML; never dumps the protected DB.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const mysql=require('mysql2/promise');
const {audit,assertTestTarget}=require('../database/readOnlyMigrationAudit');
async function main(){
  assertTestTarget(['node','audit','--test-only']);
  const history=await audit({argv:['node','audit','--test-only']}).catch(error=>({
    status:'BLOCKED',code:error.code,message:String(error.message).slice(0,250)}));
  const connection=await mysql.createConnection({host:process.env.DB_HOST||'localhost',user:process.env.DB_USER||'root',
    password:process.env.DB_PASSWORD||'',database:'miljor_test_db'});
  const directory=path.resolve(__dirname,'../database/backups');
  fs.mkdirSync(directory,{recursive:true});
  try{
    const [[target]]=await connection.query('SELECT DATABASE() AS name');
    if(target.name!=='miljor_test_db')throw Error('TEST_DB_REQUIRED');
    const [tables]=await connection.query("SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema='miljor_test_db' AND TABLE_TYPE='BASE TABLE'");
    const protectedTables=['users','pools','reservations','orders','payments','platform_ledger'];
    const protectedSnapshot={};
    for(const table of protectedTables){
      const [[row]]=await connection.query('CHECKSUM TABLE miljor_db.`'+table+'` EXTENDED');
      if(row.Checksum==null)throw Error('PROTECTED_CHECKSUM_UNAVAILABLE');
      protectedSnapshot[table]=row.Checksum;
    }
    const file=path.join(directory,'ucp-test-'+Date.now()+'.sql');
    const fd=fs.openSync(file,'wx');
    let result;
    try{result=spawnSync('mysqldump',['--host='+ (process.env.DB_HOST||'localhost'),
      '--user='+ (process.env.DB_USER||'root'),'--single-transaction','--skip-lock-tables','--no-tablespaces','miljor_test_db'],
      {env:{...process.env,MYSQL_PWD:process.env.DB_PASSWORD||''},stdio:['ignore',fd,'pipe'],timeout:60000});
    }finally{fs.closeSync(fd);}
    if(result.status!==0)throw Error('TEST_BACKUP_FAILED');
    const bytes=fs.readFileSync(file);
    const text=bytes.toString('utf8');
    const definitions=(text.match(/CREATE TABLE /g)||[]).length;
    if(!text.includes('-- Dump completed on')||definitions!==tables.length)throw Error('TEST_BACKUP_INCOMPLETE');
    const evidence={history,protectedSnapshot,testBackup:{file,bytes:bytes.length,tables:definitions,
      sha256:crypto.createHash('sha256').update(bytes).digest('hex')},restoreReplay:'NOT_TESTED'};
    fs.writeFileSync(path.join(directory,'ucp-preflight.json'),JSON.stringify(evidence,null,2));
    console.log('UCP_PREFLIGHT_EVIDENCE',JSON.stringify(evidence));
    if(history.status!=='VERIFIED_HISTORY')throw Error('MIGRATION_AUDIT_BLOCKED_NO_DDL_AUTHORIZED');
  }finally{await connection.end();}
}
main().catch(e=>{console.error('UCP_PREFLIGHT_BLOCKED',e.code||'ERROR',String(e.message).slice(0,250));process.exitCode=1;});
