// =============================================================================
// database/runMigrations.js
// Fail-closed MySQL migration runner. DDL is not transactionally reversible:
// a failed attempt must be reconciled against the database before any retry.
// =============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const migrationsDir = path.join(__dirname, 'migrations');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

function migrationManifest(directory = migrationsDir) {
  if (!fs.existsSync(directory)) {
    throw new Error('MIGRATIONS_DIRECTORY_MISSING: migration directory must exist');
  }
  const files = fs.readdirSync(directory)
    .filter(file => file.endsWith('.sql') && !file.toLowerCase().includes('rollback'))
    .sort();
  const seen = new Set();
  return files.map(file => {
    const match = /^(\d{3,})_[A-Za-z0-9_-]+\.sql$/.exec(file);
    if (!match) throw new Error(`INVALID_MIGRATION_FILENAME: ${file}`);
    const version = match[1];
    if (seen.has(version)) throw new Error(`DUPLICATE_MIGRATION_VERSION: ${version}`);
    seen.add(version);
    const sql = fs.readFileSync(path.join(directory, file), 'utf8');
    if (!sql.trim()) throw new Error(`EMPTY_MIGRATION: ${file}`);
    return { version, file, sql, checksum: sha256(sql) };
  });
}

async function runMigrations(targetDb) {
  const selectedDb = targetDb || process.env.DB_NAME || 'miljor_db';
  if (!/^[A-Za-z0-9_]+$/.test(selectedDb)) {
    throw new Error('INVALID_DATABASE_NAME: use a simple MySQL database identifier');
  }
  // Read and check the entire migration set before touching the database.
  const manifest = migrationManifest();
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: selectedDb,
    multipleStatements: true
  });
  const lockName = 'miljor:migrate:' + sha256(selectedDb).slice(0, 24);
  let locked = false;
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
    if (Number(lock.acquired) !== 1) {
      throw new Error('MIGRATION_LOCK_UNAVAILABLE: another runner may be active');
    }
    locked = true;

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        version VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Separate durable journal because MySQL DDL implicitly commits.
    // Never assume an interrupted/failed SQL file can be safely replayed.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migration_attempts (
        version VARCHAR(50) NOT NULL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        checksum CHAR(64) NOT NULL,
        status ENUM('RUNNING','APPLIED','FAILED') NOT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP NULL DEFAULT NULL,
        error_message VARCHAR(1000) NULL
      )
    `);

    const [appliedRows] = await connection.query(
      'SELECT version, name FROM schema_migrations'
    );
    const [attemptRows] = await connection.query(
      'SELECT version, name, checksum, status FROM schema_migration_attempts'
    );
    const applied = new Map(appliedRows.map(row => [row.version, row.name]));
    const attempts = new Map(attemptRows.map(row => [row.version, row]));

    // Reject any ambiguous state BEFORE applying a single pending migration.
    for (const item of manifest) {
      const previousName = applied.get(item.version);
      const previous = attempts.get(item.version);
      if (previousName && previousName !== item.file) {
        throw new Error(`MIGRATION_HISTORY_CONFLICT: ${item.version} was recorded as ${previousName}`);
      }
      if (previous && (previous.name !== item.file || previous.checksum !== item.checksum)) {
        throw new Error(`MIGRATION_CHECKSUM_CONFLICT: ${item.file} changed after its first attempt`);
      }
      if (previous && previous.status !== 'APPLIED') {
        throw new Error(`MIGRATION_RECOVERY_REQUIRED: ${item.file} is ${previous.status}; inspect database changes and restore/reconcile manually`);
      }
      if (previous && previous.status === 'APPLIED' && !previousName) {
        throw new Error(`MIGRATION_HISTORY_MISSING: ${item.file} has an APPLIED journal but no schema_migrations row`);
      }
      if (previousName && previous && previous.status !== 'APPLIED') {
        throw new Error(`MIGRATION_HISTORY_CONFLICT: inconsistent journal for ${item.file}`);
      }
    }
    for (const row of attemptRows) {
      if (!manifest.some(item => item.version === row.version) && row.status !== 'APPLIED') {
        throw new Error(`MIGRATION_RECOVERY_REQUIRED: unknown migration ${row.version} is ${row.status}`);
      }
    }
    for (const row of appliedRows) {
      if (!manifest.some(item => item.version === row.version)) {
        throw new Error(`MIGRATION_FILE_MISSING: applied migration ${row.version} has no matching SQL file`);
      }
    }

    let count = 0;
    for (const item of manifest) {
      if (applied.has(item.version)) continue;
      console.log(`Applying migration: ${item.file}`);
      await connection.query(
        `INSERT INTO schema_migration_attempts
         (version, name, checksum, status) VALUES (?, ?, ?, 'RUNNING')`,
        [item.version, item.file, item.checksum]
      );
      try {
        await connection.query(item.sql);
        await connection.query(
          'INSERT INTO schema_migrations (version, name) VALUES (?, ?)',
          [item.version, item.file]
        );
        await connection.query(
          `UPDATE schema_migration_attempts SET status='APPLIED',
           finished_at=CURRENT_TIMESTAMP, error_message=NULL WHERE version=?`,
          [item.version]
        );
      } catch (error) {
        // Best effort: a connection drop still leaves RUNNING as a hard stop.
        try {
          await connection.query(
            `UPDATE schema_migration_attempts SET status='FAILED',
             finished_at=CURRENT_TIMESTAMP, error_message=? WHERE version=?`,
            [String(error.message).slice(0, 1000), item.version]
          );
        } catch (journalError) {
          console.error('Migration failure journal could not be finalized:', journalError.message);
        }
        throw new Error(`MIGRATION_RECOVERY_REQUIRED: ${item.file} may be partially applied: ${error.message}`);
      }
      console.log(`Applied and journaled: ${item.file}`);
      count++;
    }
    console.log(count ? `Applied ${count} migration(s).` : 'Database migration history is up-to-date.');
    return { database: selectedDb, applied: count };
  } finally {
    if (locked) {
      try { await connection.query('SELECT RELEASE_LOCK(?)', [lockName]); }
      catch (error) { console.error('Migration lock release failed:', error.message); }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(error => { console.error('Migration runner failed:', error.message); process.exit(1); });
}

module.exports = { runMigrations, migrationManifest };
