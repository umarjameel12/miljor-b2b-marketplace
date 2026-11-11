'use strict';
// Source-only migration reconciliation acceptance; no DB connection.
const assert=require('node:assert/strict');
const {assertNoUnresolvedBranchCollisions,COLLISIONS,EXPECTED}=
  require('../database/migrationCollisionGuard');
const {migrationManifest}=require('../database/runMigrations');
assert.equal(COLLISIONS.length,3);
assert.equal(Object.keys(EXPECTED).length,7);
const liveManifest=migrationManifest();
assert.equal(assertNoUnresolvedBranchCollisions(liveManifest),true);
for(const c of COLLISIONS){
  const swapped=liveManifest.map(x=>String(x.version)===c.version?
    {...x,file:c.independent}:x);
  assert.throws(()=>assertNoUnresolvedBranchCollisions(swapped),
    /MIGRATION_BRANCH_COLLISION_UNRESOLVED/);
}
for(const version of Object.keys(EXPECTED)){
  const omitted=liveManifest.filter(x=>String(x.version)!==version);
  assert.throws(()=>assertNoUnresolvedBranchCollisions(omitted),
    /MIGRATION_BRANCH_COLLISION_UNRESOLVED/);
}
const versions=liveManifest.map(x=>x.version);
assert.equal(new Set(versions).size,versions.length);
assert.deepEqual(Object.keys(EXPECTED),
  ['046','047','048','049','050','051','052']);
console.log('PASS: reconciled 046-052 manifest maps every unique version and rejects 3 stale collisions.');
