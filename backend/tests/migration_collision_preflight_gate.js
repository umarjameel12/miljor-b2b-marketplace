'use strict';
// Deferred final acceptance: no database operations.
const assert = require('node:assert/strict');
const { assertNoUnresolvedBranchCollisions, COLLISIONS } =
  require('../database/migrationCollisionGuard');
const { migrationManifest } = require('../database/runMigrations');

assert.equal(COLLISIONS.length, 2);
for (const entry of COLLISIONS) {
  assert.throws(
    () => assertNoUnresolvedBranchCollisions([
      { version: entry.version, file: entry.independent }
    ]),
    /MIGRATION_BRANCH_COLLISION_UNRESOLVED/
  );
  assert.throws(
    () => assertNoUnresolvedBranchCollisions([
      { version: entry.version, file: entry.concurrent }
    ]),
    /MIGRATION_BRANCH_COLLISION_UNRESOLVED/
  );
}
assert.doesNotThrow(() => assertNoUnresolvedBranchCollisions([
  { version: '045', file: '045_safe.sql' }
]));
const liveManifest = migrationManifest();
assert.throws(
  () => assertNoUnresolvedBranchCollisions(liveManifest),
  /MIGRATION_BRANCH_COLLISION_UNRESOLVED/
);
console.log('PASS: collision preflight blocks divergent B6/catalog versions before DB connection.');
