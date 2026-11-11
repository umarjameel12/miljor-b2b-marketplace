const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const host = process.env.DB_HOST || '127.0.0.1';
const port = process.env.DB_PORT || 3306;
const dbName = 'miljor_db';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(__dirname, '../../database/backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}
const backupPath = path.join(backupDir, `miljor_db_backup_${timestamp}.sql`);

console.log(`Backing up ${dbName} to ${backupPath}...`);
const pwdFlag = password ? ` -p"${password}"` : '';
const cmd = `mysqldump -h ${host} -P ${port} -u ${user}${pwdFlag} ${dbName} > "${backupPath}"`;

try {
  execSync(cmd, { shell: 'cmd.exe', stdio: 'inherit' });
  const stats = fs.statSync(backupPath);
  console.log(`Backup completed successfully! Size: ${stats.size} bytes`);
} catch (err) {
  console.error('Backup failed:', err.message);
  process.exit(1);
}
