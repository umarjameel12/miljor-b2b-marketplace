'use strict';
// Reconciled migration file preflight, NOT proof of applied database history.
// Abort before DB connection if any conflicting branch's old filename survives.
// MySQL schema_migrations and schema_migration_attempts must still be checked
// by runMigrations; never rewrite historical rows or bypass recovery flags.
const EXPECTED = Object.freeze({
  '046': '046_recurring_collective_cycles.sql',
  '047': '047_procurement_delivery_runs.sql',
  '048': '048_procurement_notification_outbox.sql',
  '049': '049_regular_pool_payment_hold_deadlines.sql',
  '050': '050_expand_canonical_product_families.sql',
  '051': '051_demand_requester_role.sql',
  '052': '052_order_supplier_commission_snapshot.sql'
});
const COLLISIONS = Object.freeze([
  Object.freeze({version:'046',independent:'046_expand_canonical_product_families.sql',concurrent:EXPECTED['046']}),
  Object.freeze({version:'047',independent:'047_demand_requester_role.sql',concurrent:EXPECTED['047']}),
  Object.freeze({version:'048',independent:'048_regular_pool_payment_hold_deadlines.sql',concurrent:EXPECTED['048']})
]);
function assertNoUnresolvedBranchCollisions(manifest) {
  const files=new Map();
  const seenNames=new Set();
  for(const entry of manifest){
    const version=String(entry.version);
    if(files.has(version)||seenNames.has(entry.file))
      throw new Error('MIGRATION_BRANCH_COLLISION_UNRESOLVED: duplicate file or version '+version);
    files.set(version,entry.file);
    seenNames.add(entry.file);
  }
  for(const [version,expectedFile] of Object.entries(EXPECTED)){
    if(files.get(version)!==expectedFile)
      throw new Error('MIGRATION_BRANCH_COLLISION_UNRESOLVED: version '+version+
        ' must be '+expectedFile+', found '+(files.get(version)||'MISSING'));
  }
  for(const oldFile of COLLISIONS.map(c=>c.independent)){
    if(seenNames.has(oldFile))
      throw new Error('MIGRATION_BRANCH_COLLISION_UNRESOLVED: legacy colliding file '+oldFile);
  }
  return true;
}
module.exports={assertNoUnresolvedBranchCollisions,COLLISIONS,EXPECTED};
