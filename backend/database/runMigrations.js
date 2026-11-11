// =============================================================================
// database/runMigrations.js
// Safe, versioned migration runner tracking schema_migrations
// =============================================================================
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const crypto = require('crypto');

async function runMigrations(targetDb) {
  const selectedDb = targetDb || process.env.DB_NAME || 'miljor_db';
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: selectedDb,
    multipleStatements: true
  });
  const lockName = 'miljor_migration_' + crypto.createHash('sha256').update(selectedDb).digest('hex').slice(0,36);
  let lockAcquired = false;
  try {
    // Serialize migration runners against the same database (not app traffic).
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
    if (lock.acquired !== 1) throw new Error('MIGRATION_LOCK_UNAVAILABLE: another migration runner holds the lock.');
    lockAcquired = true;
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        version VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // MySQL DDL is often implicitly committed, so a crashed half-migration is
    // NOT transactionally reversible. This journal deliberately blocks blind reruns.
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migration_attempts (
        version VARCHAR(50) PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        sha256 CHAR(64) NOT NULL,
        status ENUM('RUNNING','FAILED','APPLIED') NOT NULL,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP NULL,
        failure_message VARCHAR(1000) NULL
      )
    `);
    const [appliedRows] = await connection.query('SELECT version FROM schema_migrations');
    const appliedVersions = new Set(appliedRows.map(row => row.version));
    const migrationsDir = path.join(__dirname, 'migrations');
    if (!fs.existsSync(migrationsDir)) return;
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql') && !file.includes('rollback'))
      .sort();
    let appliedCount=0;
    for (const file of files) {
      const version=file.split('_')[0];
      const sql=fs.readFileSync(path.join(migrationsDir,file),'utf8');
      const sha256=crypto.createHash('sha256').update(sql).digest('hex');
      const [attempts]=await connection.query(
        'SELECT filename,sha256,status FROM schema_migration_attempts WHERE version=?', [version]
      );
      const attempt=attempts[0];
      if (appliedVersions.has(version)) {
        if (attempt && (attempt.status!=='APPLIED' || attempt.sha256!==sha256 || attempt.filename!==file))
          throw new Error(`MIGRATION_HISTORY_MISMATCH: ${file} differs from tracked journal. Inspect manually.`);
        continue;
      }
      if (attempt)
        throw new Error(`MIGRATION_RECOVERY_REQUIRED: ${file} previously reached ${attempt.status}. Verify schema manually before resuming.`);
      // Detect duplicate version numbers in the migration directory before running DDL.
      if (files.filter(other => other.split('_')[0] === version).length !== 1)
        throw new Error(`DUPLICATE_MIGRATION_VERSION: ${version}`);
      await connection.query(
        "INSERT INTO schema_migration_attempts(version,filename,sha256,status) VALUES(?,?,?,'RUNNING')",
        [version,file,sha256]
      );
      console.log('Applying migration:',file);
      try {
        await connection.query(sql);
        await connection.query('INSERT INTO schema_migrations(version,name) VALUES(?,?)',[version,file]);
        await connection.query(
          "UPDATE schema_migration_attempts SET status='APPLIED',finished_at=UTC_TIMESTAMP() WHERE version=?",
          [version]
        );
        appliedVersions.add(version);
        appliedCount++;
      } catch (error) {
        try {
          await connection.query(
            "UPDATE schema_migration_attempts SET status='FAILED',finished_at=UTC_TIMESTAMP(),failure_message=? WHERE version=?",
            [String(error.message||error).slice(0,1000),version]
          );
        } catch (journalError) {
          console.error('Migration failure journal could not be saved:',journalError.message);
        }
        throw new Error(`MIGRATION_RECOVERY_REQUIRED: ${file} failed; schema may be partially applied. ${error.message}`);
      }
    }
    console.log('Migration run completed; applied:',appliedCount);
  } finally {
    if (lockAcquired) {
      try { await connection.query('SELECT RELEASE_LOCK(?)',[lockName]); }
      catch (error) { console.error('Migration lock release error:',error.message); }
    }
    await connection.end();
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { runMigrations };
