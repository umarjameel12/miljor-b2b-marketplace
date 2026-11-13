'use strict';
// No-network/no-DB gate. It checks the pinned competing finance migration plan
// against this branch's canonical B6 046–048 + UCP 051–053 manifest.
// This does NOT approve the unrelated order commission feature or rewrite history.
const fs=require('node:fs');
const path=require('node:path');
const {scanMigrations}=require('./migrationManifest');
const CANONICAL=Object.freeze({
  '046':'046_recurring_collective_cycles.sql',
  '047':'047_procurement_delivery_runs.sql',
  '048':'048_procurement_notification_outbox.sql',
  '051':'051_expand_canonical_product_families.sql',
  '052':'052_demand_requester_role.sql',
  '053':'053_regular_pool_payment_hold_deadlines.sql'
});
const FINANCE_ALTERNATE=Object.freeze({
  '049':'049_regular_pool_payment_hold_deadlines.sql',
  '050':'050_expand_canonical_product_families.sql',
  '051':'051_demand_requester_role.sql',
  '052':'052_order_supplier_commission_snapshot.sql'
});
// Evidence from integration/p0-b6-finance-migrations-046-052 (GitHub blob SHA1).
// Alias rows carry the SAME SQL statements apart from comment/number headers;
// this does NOT make their migration journal filenames interchangeable.
const PINNED_FINANCE_BLOBS=Object.freeze({
  '049_regular_pool_payment_hold_deadlines.sql':'33ad3d13da4968e062fa71e1d859dd82ab2546c2',
  '050_expand_canonical_product_families.sql':'6971109170641835303af5fbfe53aecbcf966327',
  '051_demand_requester_role.sql':'9005d617b1d5298edb0b246ab0521c99a0ca4734',
  '052_order_supplier_commission_snapshot.sql':'e72ba905a9a223fcacd41616a842045c378c4134'
});
function invalid(code,detail){throw Object.assign(new Error(code+': '+detail),{code});}
function checkFinanceCompatibility(directory=path.join(__dirname,'migrations')){
  const manifest=scanMigrations(directory);
  const found=new Map(manifest.map(x=>[x.version,x.filename]));
  for(const [version,expected] of Object.entries(CANONICAL)){
    if(found.get(version)!==expected)
      invalid('CANONICAL_MIGRATION_MISMATCH',version+' expected '+expected+'; got '+(found.get(version)||'missing'));
  }
  // The competing finance plan's 049–052 contains three UCP DDL duplicates
  // and a fourth order commission migration: never apply these aliases after
  // UCP 051–053 or vice-versa.
  for(const [version,alias] of Object.entries(FINANCE_ALTERNATE)){
    if(found.get(version)===alias)
      invalid('FINANCE_MIGRATION_VERSION_COLLISION',version+' '+alias+' conflicts with canonical B6/UCP sequence');
    if(fs.existsSync(path.join(directory,alias)))
      invalid('FINANCE_MIGRATION_ALIAS_PRESENT',alias+' requires finance-specific reconciliation');
  }
  // 049 was deliberately assigned to persistent in-app notifications.
  // Explicitly accept only that reviewed filename and its expected DDL contract;
  // keep the competing finance alias and all other unexpected migrations blocked.
  const notificationFile='049_in_app_notifications.sql';
  if(found.has('049') && found.get('049')!==notificationFile)
    invalid('RESERVED_MIGRATION_SLOT_REQUIRES_REVIEW','049 '+found.get('049'));
  if(found.has('050'))
    invalid('RESERVED_MIGRATION_SLOT_REQUIRES_REVIEW','050 '+found.get('050'));
  const migrationSql=file=>fs.readFileSync(path.join(directory,file),'utf8');
  if(found.has('049')){
    const sql=migrationSql(notificationFile);
    for(const required of [
      /CREATE TABLE IF NOT EXISTS platform_notifications/i,
      /FOREIGN KEY \(user_id\) REFERENCES users\(id\)/i,
      /UNIQUE KEY uq_user_event_key \(user_id, event_key\)/i,
      /KEY idx_user_unread \(user_id, is_read, created_at\)/i
    ]){
      if(!required.test(sql))
        invalid('NOTIFICATION_MIGRATION_INVALID','049 must preserve recipient isolation, deduplication and unread index');
    }
  }
  if(!/CREATE TABLE IF NOT EXISTS regular_pool_payment_holds/i.test(
      migrationSql(CANONICAL['053'])))
    invalid('REGULAR_PAYMENT_HOLD_MIGRATION_INVALID','Expected B4 hold DDL in UCP 053');
  if(!/ADD COLUMN requester_role/i.test(migrationSql(CANONICAL['052'])))
    invalid('REQUESTER_ROLE_MIGRATION_INVALID','Expected requester-role ALTER in UCP 052');
  if(!/catalog_product_families/i.test(migrationSql(CANONICAL['051'])))
    invalid('CANONICAL_FAMILY_MIGRATION_INVALID','Expected family expansion in UCP 051');
  return {
    status:'CANONICAL_FILES_ONLY',
    canonical_order:Object.entries(CANONICAL).map(([version,filename])=>({version,filename})),
    finance_source:'integration/p0-b6-finance-migrations-046-052',
    finance_aliases:FINANCE_ALTERNATE,
    finance_source_blob_sha1:PINNED_FINANCE_BLOBS,
    compatibility:'FINANCE_INTEGRATION_BLOCKED',
    reason:'Finance 049-052 overlaps canonical UCP 051-053. Commission snapshot needs a separately approved unique version and verified order-writer coverage.',
    no_database_connection:true
  };
}
if(require.main===module){
  try{
    console.log('FINANCE_COMPATIBILITY_GATE_PASS',JSON.stringify(checkFinanceCompatibility()));
  }catch(e){
    console.error('FINANCE_COMPATIBILITY_GATE_BLOCKED',e.code||'ERROR',e.message);
    process.exitCode=1;
  }
}
module.exports={checkFinanceCompatibility,CANONICAL,FINANCE_ALTERNATE,PINNED_FINANCE_BLOBS};
