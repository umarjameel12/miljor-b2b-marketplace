// =============================================================================
// database/runMigrations.js
// Safe, versioned migration runner tracking schema_migrations
// =============================================================================
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const crypto = require('crypto');
const {scanMigrations,checkAppliedHistory} = require('./migrationManifest');

async function runMigrations(targetDb) {
  // Static preflight has NO database connection, lock or schema mutations.
  // Failed/mismatched branch migrations must be rejected before any SQL.
  const manifest = scanMigrations();
  const selectedDb = targetDb || process.env.DB_NAME || 'miljor_db';
  if(process.env.MILJOR_TEST_ONLY_MIGRATIONS==='1' && selectedDb!=='miljor_test_db')
    throw new Error('MIGRATION_PROTECTED_DB_BLOCKED: test acceptance can only target miljor_test_db');
  // Explicit TEST-ONLY historical fixture hook; never truncate release migrations.
  const stopBefore=process.env.MILJOR_TEST_STOP_BEFORE_VERSION || null;
  if(stopBefore && !(process.env.NODE_ENV==='test' &&
       process.env.MILJOR_TEST_ONLY_MIGRATIONS==='1' &&
       selectedDb==='miljor_test_db' &&
       /^0[0-9]{2}$/.test(stopBefore)))
    throw new Error('MIGRATION_PARTIAL_RUN_FORBIDDEN: stop-before is restricted to disposable test database');
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
    // Inspect ALL applied history and in-flight journal rows before the first
    // business migration executes, not one-at-a-time after earlier DDL.
    const [appliedRows] = await connection.query('SELECT version,name FROM schema_migrations');
    const [attemptRows] = await connection.query(
      'SELECT version,filename,sha256,status FROM schema_migration_attempts'
    );
    checkAppliedHistory(manifest,appliedRows,attemptRows);
    const appliedVersions=new Set(appliedRows.map(row=>String(row.version).padStart(3,'0')));
    const attemptsByVersion=new Map(attemptRows.map(row=>[String(row.version).padStart(3,'0'),row]));
    const migrationsDir=path.join(__dirname,'migrations');
    let appliedCount=0;
    for(const item of manifest){
      const {filename:file,version,sha256}=item;
      if(stopBefore && version>=stopBefore) break;
      const sql=fs.readFileSync(path.join(migrationsDir,file),'utf8');
      const attempt=attemptsByVersion.get(version);
      if (appliedVersions.has(version)) {
        if (attempt && (attempt.status!=='APPLIED' || attempt.sha256!==sha256 || attempt.filename!==file))
          throw new Error(`MIGRATION_HISTORY_MISMATCH: ${file} differs from tracked journal. Inspect manually.`);
        continue;
      }
      if (attempt)
        throw new Error(`MIGRATION_RECOVERY_REQUIRED: ${file} previously reached ${attempt.status}. Verify schema manually before resuming.`);
      // Preflight verified every version and checksum before the first SQL migration.
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
    .catch(error => {
      // No environment variables, SQL statements, credential strings or payment data.
      console.error('MIGRATION_EXECUTION_BLOCKED:',
        error?.code || 'ERROR',
        String(error?.message || error).split('\\n')[0].slice(0,500));
      process.exitCode = 1;
    });
}

module.exports = { runMigrations };
