'use strict';
// =============================================================================
// backend/database/rotateAdminCredential.js
// Securely rotates the SUPER_ADMIN password without exposing it in logs or git.
// Hashes with bcryptjs (12 rounds), updates miljor_db and miljor_test_db,
// and revokes all active sessions and refresh tokens for user ID 1.
// =============================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const envPath = path.join(__dirname, '../.env');
require('dotenv').config({ path: envPath });

async function rotateAdmin() {
  console.log('🔒 Starting secure SUPER_ADMIN credential rotation...');

  // 1. Generate or read secure high-entropy admin password
  let newPassword = process.env.ADMIN_PASSWORD;
  if (!newPassword || newPassword.trim() === '' || newPassword === 'admin123' || newPassword === 'Password123') {
    const generated = crypto.randomBytes(24).toString('base64url') + '!A9';
    newPassword = generated;
    let envContent = fs.readFileSync(envPath, 'utf8');
    if (envContent.includes('ADMIN_PASSWORD=')) {
      envContent = envContent.replace(/ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${newPassword}`);
    } else {
      envContent += `\n# Rotated secure Super Admin credential (never expose)\nADMIN_PASSWORD=${newPassword}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
    process.env.ADMIN_PASSWORD = newPassword;
    console.log('✅ Generated new high-entropy admin password and persisted to local gitignored .env');
  } else {
    console.log('✅ Using existing high-entropy ADMIN_PASSWORD from .env');
  }

  // 2. Hash password with bcryptjs 12 rounds
  const passwordHash = await bcrypt.hash(newPassword, 12);
  console.log('✅ Password hashed with bcrypt (12 rounds) — plaintext never printed');

  const databases = ['miljor_db', 'miljor_test_db'];

  for (const dbName of databases) {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: dbName
    });

    try {
      await conn.beginTransaction();

      // Verify user 1
      const [rows] = await conn.query('SELECT id, email, role FROM users WHERE id = 1 FOR UPDATE');
      if (rows.length === 0 || rows[0].role !== 'SUPER_ADMIN' || rows[0].email !== 'admin@miljor.com') {
        throw new Error(`Target user 1 in ${dbName} is not admin@miljor.com with role SUPER_ADMIN`);
      }

      // Update password hash
      await conn.query(
        'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = 1 AND role = ?',
        [passwordHash, 'SUPER_ADMIN']
      );

      // Revoke all existing sessions
      const [sessResult] = await conn.query(
        'UPDATE user_sessions SET revoked_at = NOW(), revocation_reason = ? WHERE user_id = 1 AND revoked_at IS NULL',
        ['CREDENTIAL_ROTATION']
      );

      // Revoke all refresh tokens linked to user 1's sessions
      const [tokResult] = await conn.query(
        `UPDATE user_refresh_tokens 
         SET revoked_at = NOW() 
         WHERE session_id IN (SELECT session_id FROM user_sessions WHERE user_id = 1) 
           AND revoked_at IS NULL`
      );

      await conn.commit();
      console.log(`✅ [${dbName}] Admin password rotated, ${sessResult.affectedRows} sessions revoked, ${tokResult.affectedRows} tokens revoked.`);
    } catch (err) {
      await conn.rollback();
      console.error(`❌ [${dbName}] Rotation failed:`, err.message);
      throw err;
    } finally {
      await conn.end();
    }
  }

  console.log('🎉 SUPER_ADMIN credential rotation completed securely across databases.');
}

rotateAdmin().catch(err => {
  console.error('Fatal rotation error:', err.message);
  process.exit(1);
});
