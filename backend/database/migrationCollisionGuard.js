'use strict';
// Known unresolved *cross-branch* migration-version collisions.
// This is a deliberate deployment stop, not a repair or migration renumbering.
// Remove a hold only after both branches and actual schema_migrations histories
// have been reconciled and a replacement append-only sequence reviewed.
const COLLISIONS = Object.freeze([
  Object.freeze({
    version: '046',
    independent: '046_expand_canonical_product_families.sql',
    concurrent: '046_recurring_collective_cycles.sql'
  }),
  Object.freeze({
    version: '047',
    independent: '047_demand_requester_role.sql',
    concurrent: '047_procurement_delivery_runs.sql'
  })
]);

function assertNoUnresolvedBranchCollisions(manifest) {
  const files = new Map(manifest.map(m => [String(m.version), m.file]));
  for (const conflict of COLLISIONS) {
    const filename = files.get(conflict.version);
    if (filename === conflict.independent || filename === conflict.concurrent) {
      throw new Error(
        'MIGRATION_BRANCH_COLLISION_UNRESOLVED: version ' + conflict.version +
        ' is claimed by ' + conflict.independent + ' and ' + conflict.concurrent +
        '. Do not run migrations against any database until the active branches, ' +
        'schema_migrations records and actual tables are reconciled. ' +
        'Never bypass by renaming or editing an already-applied migration.'
      );
    }
  }
}
module.exports = { assertNoUnresolvedBranchCollisions, COLLISIONS };
