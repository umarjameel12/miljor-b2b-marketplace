'use strict';
// Pure, DB-free migration manifest and history validation. Run BEFORE MySQL DDL.
// This is an integration safety gate, not a schema or migration auto-repair tool.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXPECTED_INTEGRATION = Object.freeze({
  '046':'046_recurring_collective_cycles.sql',
  '047':'047_procurement_delivery_runs.sql',
  '048':'048_procurement_notification_outbox.sql',
  '051':'051_expand_canonical_product_families.sql',
  '052':'052_demand_requester_role.sql',
  '053':'053_regular_pool_payment_hold_deadlines.sql'
});
const OLD_UCP_RENUMBERED = Object.freeze({
  '046':'046_expand_canonical_product_families.sql',
  '047':'047_demand_requester_role.sql',
  '048':'048_regular_pool_payment_hold_deadlines.sql'
});
function reject(code,details){const e=new Error(code+': '+details);e.code=code;throw e;}
function scanMigrations(directory=path.join(__dirname,'migrations'),options={}){
  if(!fs.existsSync(directory))reject('MIGRATION_DIRECTORY_MISSING',directory);
  const files=fs.readdirSync(directory,{withFileTypes:true})
    .filter(x=>x.isFile()&&x.name.endsWith('.sql'))
    .map(x=>x.name).sort();
  const map=new Map();
  for(const filename of files){
    // MySQL versions are ASCII decimal prefixes. Reject confusing 00x, duplicate
    // revisions, malformed names, or non-rollback files outside canonical naming.
    const m=/^([0-9]{3})_[a-z0-9_]+\.sql$/.exec(filename);
    if(!m)reject('INVALID_MIGRATION_FILENAME',filename);
    const version=m[1];
    if(map.has(version))reject('DUPLICATE_MIGRATION_VERSION',version+': '+map.get(version).filename+' vs '+filename);
    const sql=fs.readFileSync(path.join(directory,filename),'utf8');
    map.set(version,{version,filename,sha256:crypto.createHash('sha256').update(sql).digest('hex')});
  }
  if(options.requireIntegrated!==false){
    for(const [version,filename] of Object.entries(EXPECTED_INTEGRATION)){
      if(map.get(version)?.filename!==filename)
        reject('MIGRATION_CANONICAL_VERSION_MISMATCH',version+' must equal '+filename);
    }
    for(const [version,filename] of Object.entries(OLD_UCP_RENUMBERED)){
      if(map.get(version)?.filename===filename)
        reject('MIGRATION_RENUMBERED_HISTORY_REQUIRES_RECONCILIATION',filename);
    }
  }
  return Array.from(map.values());
}
function checkAppliedHistory(manifest,appliedRows,attemptRows=[]){
  const manifestMap=new Map(manifest.map(item=>[item.version,item]));
  const seen=new Set();
  for(const row of appliedRows){
    const version=String(row.version).padStart(3,'0');
    if(seen.has(version))reject('MIGRATION_HISTORY_DUPLICATE',version);
    seen.add(version);
    if(OLD_UCP_RENUMBERED[version]===row.name)
      reject('MIGRATION_RENUMBERED_HISTORY_REQUIRES_RECONCILIATION',row.name+' already applied; manual audit required');
    const item=manifestMap.get(version);
    if(!item)reject('MIGRATION_HISTORY_UNKNOWN',version+' '+row.name);
    if(item.filename!==row.name)
      reject('MIGRATION_HISTORY_FILENAME_MISMATCH',version+' applied as '+row.name+' but filesystem contains '+item.filename);
  }
  for(const row of attemptRows){
    const version=String(row.version).padStart(3,'0');
    const item=manifestMap.get(version);
    if(!item)reject('MIGRATION_JOURNAL_UNKNOWN',version);
    if(item.filename!==row.filename||item.sha256!==row.sha256)
      reject('MIGRATION_HISTORY_MISMATCH',item.filename+' journal checksum/filename changed');
    if(row.status!=='APPLIED')
      reject('MIGRATION_RECOVERY_REQUIRED',item.filename+' journal is '+row.status);
    if(!seen.has(version))
      reject('MIGRATION_JOURNAL_ORPHAN',item.filename+' marked APPLIED without ledger record');
  }
  return {applied:seen.size,planned:manifest.length};
}
if(require.main===module){
 try{
  const result=scanMigrations();
  console.log('MIGRATION_MANIFEST_PREFLIGHT_PASS',JSON.stringify({
    count:result.length,canonical:result.filter(x=>EXPECTED_INTEGRATION[x.version])
  }));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
module.exports={scanMigrations,checkAppliedHistory,EXPECTED_INTEGRATION,OLD_UCP_RENUMBERED};
