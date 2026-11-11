'use strict';
// Run only in the final consolidated MilJor backend acceptance gate.
// No network/database writes: manifest validation uses temporary SQL fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrationManifest } = require('../database/runMigrations');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'miljor-migration-manifest-'));
try {
  assert.deepEqual(migrationManifest(directory), []);
  fs.writeFileSync(path.join(directory, '046_one.sql'), 'SELECT 1;\n');
  const first = migrationManifest(directory);
  assert.equal(first.length, 1);
  assert.equal(first[0].version, '046');
  assert.equal(first[0].file, '046_one.sql');
  assert.equal(first[0].checksum.length, 64);
  fs.writeFileSync(path.join(directory, '046_two.sql'), 'SELECT 2;\n');
  assert.throws(() => migrationManifest(directory), /DUPLICATE_MIGRATION_VERSION/);
  fs.unlinkSync(path.join(directory, '046_two.sql'));
  fs.writeFileSync(path.join(directory, 'invalid.sql'), 'SELECT 2;\n');
  assert.throws(() => migrationManifest(directory), /INVALID_MIGRATION_FILENAME/);
  fs.unlinkSync(path.join(directory, 'invalid.sql'));
  fs.writeFileSync(path.join(directory, '047_empty.sql'), ' \n');
  assert.throws(() => migrationManifest(directory), /EMPTY_MIGRATION/);
  console.log('Migration manifest validation assertions passed.');
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
